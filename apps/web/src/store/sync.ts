/**
 * Sync engine behind `store/data.ts`: optimistic commits, the persistent outbox and the
 * server round-trips (SPEC §3.5).
 *
 * A single worker talks to the server, so a `GET /api/data` and a `POST /api/ops` never
 * overlap: a server copy can never miss ops that were acknowledged while it was in flight,
 * and replaying the still-pending outbox on top of it is always correct.
 */
import { appDataSchema, applyOps, emptyData, opSchema, type AppData, type Op } from '@legko/shared';
import { api, ApiError } from '../lib/api';
import { CACHE_KEYS, clearCache, loadCache, persist } from './cache';
import { newOutboxId, normalizeAppData, parseCachedData, parseOutbox, type OutboxItem } from './normalize';
import { initialSyncState, patchSync, useDataStore, type SyncState } from './state';

/** Ops per `POST /api/ops` (the server accepts up to `MAX_OPS_PER_REQUEST`). */
export const MAX_BATCH = 100;
const RETRY_BASE_MS = 2_000;
const RETRY_MAX_MS = 60_000;
/** Safety net while ops are pending (timers can be lost while iOS suspends the app). */
export const PENDING_POLL_MS = 30_000;
/** A visible page with nothing pending re-reads the server this often (a desktop tab can stay open for days). */
export const REFRESH_POLL_MS = 60_000;
/**
 * `focus` / `pageshow` this soon after the last load (they often arrive together with
 * `visibilitychange`) do not start another one.
 */
export const FOCUS_REFRESH_GAP_MS = 5_000;

export const SYNC_ERRORS = {
  invalidLocal: 'Некоректні дані — зміну не збережено',
  rejected: 'Сервер відхилив одну зміну — її не збережено',
  failed: 'Не вдалося синхронізувати — спробую ще раз',
  importInvalid: 'Файл не схожий на резервну копію «Легко»',
} as const;

/** Delay before retry number `attempt` (1-based): 2 s, 4 s, 8 s … capped at 60 s. */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

// ---- module state ----------------------------------------------------------------------

let outbox: readonly OutboxItem[] = [];
/** Bumped by `resetLocal()`; async results that started under an older generation are dropped. */
let generation = 0;
let hydrated = false;
let hydrating: Promise<void> | null = null;

/** A `startSync()` session is running (listeners attached, retries scheduled). */
let active = false;
let sessionSeq = 0;
let sessionId = 0;
let detachTriggers: (() => void) | null = null;
let loadedThisSession = false;
let wantLoad = false;
/** When the last `GET /api/data` started (`Date.now()`); 0 before the first one. */
let lastLoadAt = 0;

let worker: Promise<void> | null = null;
let rekick = false;
let rekickForced = false;
/** Set while `importAll()` owns the server connection. */
let blocked = false;
let attempt = 0;
let retryAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | undefined;
/** `notice` errors stay until the next commit; `retry` errors clear on the next success. */
let errorKind: 'notice' | 'retry' | null = null;

const unauthorizedListeners = new Set<() => void>();

// ---- local state helpers ---------------------------------------------------------------

function setOutbox(next: readonly OutboxItem[]): void {
  outbox = next;
  persist(CACHE_KEYS.outbox, next);
  patchSync({ pending: next.length });
}

function setData(data: AppData, sync: Partial<SyncState> = {}): void {
  useDataStore.setState((s) => ({ data, sync: { ...s.sync, ...sync } }));
  persist(CACHE_KEYS.data, data);
}

function setError(message: string, kind: 'notice' | 'retry'): void {
  errorKind = kind;
  patchSync({ error: message });
}

const pendingOps = (): Op[] => outbox.map((item) => item.op);

/** Merges the device cache into memory once per local lifetime (memory is never older than the cache). */
function hydrate(): Promise<void> {
  if (hydrated) return Promise.resolve();
  if (hydrating) return hydrating;
  const gen = generation;
  const run = loadCache()
    .then((snapshot) => {
      if (gen !== generation) return;
      const cachedData = parseCachedData(snapshot.data);
      const cachedOutbox = parseOutbox(snapshot.outbox);
      // Ops committed while the cache was loading are not in it yet.
      const known = new Set(cachedOutbox.map((item) => item.id));
      const fresh = outbox.filter((item) => !known.has(item.id));
      const merged = [...cachedOutbox, ...fresh];
      // Cached data already contains the cached outbox ops; without it, replay everything on empty data.
      const replay = cachedData ? fresh : merged;
      const data = applyOps(
        cachedData ?? emptyData(),
        replay.map((item) => item.op),
      );
      outbox = merged;
      hydrated = true;
      useDataStore.setState((s) => ({
        data,
        sync: { ...s.sync, loaded: s.sync.loaded || cachedData !== null, pending: merged.length },
      }));
      if (fresh.length > 0) {
        persist(CACHE_KEYS.data, data);
        persist(CACHE_KEYS.outbox, merged);
      }
    })
    .catch((err: unknown) => {
      // A broken cache must never block syncing: carry on with what is in memory.
      console.error('[legko] could not restore the device cache', err);
      if (gen === generation) hydrated = true;
    })
    .finally(() => {
      if (hydrating === run) hydrating = null;
    });
  hydrating = run;
  return run;
}

// ---- worker ----------------------------------------------------------------------------

function kick(force = false): void {
  if (!active && !force) return;
  if (worker) {
    rekick = true;
    rekickForced ||= force;
    return;
  }
  const gen = generation;
  const run: Promise<void> = Promise.resolve()
    .then(() => work(gen))
    .catch((err: unknown) => console.error('[legko] sync worker crashed', err))
    .finally(() => {
      if (worker === run) worker = null;
      if (rekick) {
        const forced = rekickForced;
        rekick = false;
        rekickForced = false;
        kick(forced);
      }
    });
  worker = run;
}

async function work(gen: number): Promise<void> {
  await hydrate();
  try {
    while (gen === generation && !blocked && Date.now() >= retryAt) {
      if (active && wantLoad && (!loadedThisSession || outbox.length === 0)) {
        if (!(await loadFromServer(gen))) return;
      } else if (outbox.length > 0) {
        if (!(await sendNextBatch(gen))) return;
      } else {
        return;
      }
    }
  } finally {
    if (gen === generation) patchSync({ syncing: false });
  }
}

async function loadFromServer(gen: number): Promise<boolean> {
  patchSync({ syncing: true });
  // Cleared before the request: a refresh asked for while it is in flight needs a newer copy.
  wantLoad = false;
  lastLoadAt = Date.now();
  let server: AppData;
  try {
    server = await api.getData();
  } catch (err) {
    if (gen === generation) {
      wantLoad = true;
      handleFailure(err);
    }
    return false;
  }
  if (gen !== generation) return false;
  const data = applyOps(normalizeAppData(server), pendingOps());
  loadedThisSession = true;
  setData(data, { loaded: true });
  markSuccess();
  return true;
}

async function sendNextBatch(gen: number): Promise<boolean> {
  const batch = outbox.slice(0, MAX_BATCH);
  patchSync({ syncing: true });
  try {
    await api.sendOps(batch.map((item) => item.op));
  } catch (err) {
    if (gen !== generation) return false;
    const rejected =
      err instanceof ApiError && err.code === 'invalid_op' && err.index !== undefined
        ? batch[err.index]
        : undefined;
    if (rejected) {
      dropRejected(rejected);
      return true;
    }
    handleFailure(err);
    return false;
  }
  if (gen !== generation) return false;
  const sent = new Set(batch.map((item) => item.id));
  setOutbox(outbox.filter((item) => !sent.has(item.id)));
  markSuccess();
  return true;
}

function dropRejected(item: OutboxItem): void {
  console.warn('[legko] server rejected an op, dropping it', item.op);
  setOutbox(outbox.filter((i) => i.id !== item.id));
  setError(SYNC_ERRORS.rejected, 'notice');
  // The optimistic state still shows the rejected change: re-read the server once the queue drains.
  wantLoad = true;
}

function markSuccess(): void {
  attempt = 0;
  retryAt = 0;
  const patch: Partial<SyncState> = { lastSyncedAt: Date.now() };
  if (errorKind === 'retry') {
    errorKind = null;
    patch.error = null;
  }
  patchSync(patch);
}

function handleFailure(err: unknown): void {
  if (err instanceof ApiError && err.status === 401) {
    handleUnauthorized();
    return;
  }
  if (!(err instanceof ApiError && err.isNetwork)) {
    console.error('[legko] sync request failed', err);
    setError(SYNC_ERRORS.failed, 'retry');
  }
  scheduleRetry();
}

function scheduleRetry(): void {
  attempt += 1;
  const delay = retryDelay(attempt);
  retryAt = Date.now() + delay;
  clearTimeout(retryTimer);
  retryTimer = active
    ? setTimeout(() => {
        // Open the gate explicitly: a timer may fire a hair before Date.now() reaches retryAt.
        retryTimer = undefined;
        retryAt = 0;
        kick();
      }, delay)
    : undefined;
}

/** Skips the backoff wait (network is back, app is in front, or a caller insists). */
function retryNow(force = false): void {
  retryAt = 0;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  kick(force);
}

function handleUnauthorized(): void {
  stopSession();
  for (const listener of [...unauthorizedListeners]) listener();
}

// ---- session ---------------------------------------------------------------------------

const isVisible = (): boolean => document.visibilityState === 'visible';

/**
 * Keeps the outbox flowing and the copy fresh: another device may have changed the data, and a
 * save built on a stale copy would overwrite it. Pending ops always go first (the worker sends
 * them before it re-reads the server).
 */
function attachTriggers(): () => void {
  const onOnline = () => {
    patchSync({ online: true });
    retryNow();
  };
  const onOffline = () => patchSync({ online: false });
  /** Back in front (this is how iOS resumes a suspended app): send what is pending, then re-read. */
  const onVisibility = () => {
    if (!isVisible()) return;
    wantLoad = true;
    retryNow();
  };
  /** A desktop window focused again (the tab stayed visible all along). */
  const onFocus = () => {
    if (Date.now() - lastLoadAt < FOCUS_REFRESH_GAP_MS) return;
    wantLoad = true;
    retryNow();
  };
  /** A page restored from the back/forward cache (the first `pageshow` is the initial load). */
  const onPageShow = (e: PageTransitionEvent) => {
    if (e.persisted) onFocus();
  };
  const pendingPoll = setInterval(() => {
    if (outbox.length > 0) kick();
  }, PENDING_POLL_MS);
  // `kick()` respects the backoff: a failing server is not hit more often than the retries allow.
  const refreshPoll = setInterval(() => {
    if (outbox.length > 0 || !isVisible()) return;
    wantLoad = true;
    kick();
  }, REFRESH_POLL_MS);
  window.addEventListener('online', onOnline);
  window.addEventListener('offline', onOffline);
  window.addEventListener('focus', onFocus);
  window.addEventListener('pageshow', onPageShow);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('online', onOnline);
    window.removeEventListener('offline', onOffline);
    window.removeEventListener('focus', onFocus);
    window.removeEventListener('pageshow', onPageShow);
    document.removeEventListener('visibilitychange', onVisibility);
    clearInterval(pendingPoll);
    clearInterval(refreshPoll);
  };
}

function stopSession(): void {
  active = false;
  sessionId = 0;
  wantLoad = false;
  detachTriggers?.();
  detachTriggers = null;
  clearTimeout(retryTimer);
  retryTimer = undefined;
}

// ---- public API ------------------------------------------------------------------------

/** Applies ops locally right away, persists them and queues them for the server. */
/** Returns `false` when any op was refused locally (invalid) — nothing of the batch is applied then. */
export function commitOps(ops: readonly Op[]): boolean {
  // A new change from the user retires the previous one-off notice.
  if (errorKind === 'notice') {
    errorKind = null;
    patchSync({ error: null });
  }
  return enqueue(ops);
}

function enqueue(ops: readonly Op[]): boolean {
  const valid: Op[] = [];
  for (const op of ops) {
    const parsed = opSchema.safeParse(op);
    if (parsed.success) valid.push(parsed.data);
    else console.warn('[legko] refusing an invalid op', op, parsed.error.issues);
  }
  // All or nothing: a half-applied save (e.g. the day without its weigh-in) would be worse than none.
  if (valid.length < ops.length) {
    setError(SYNC_ERRORS.invalidLocal, 'notice');
    return false;
  }
  if (valid.length === 0) return true;

  outbox = [...outbox, ...valid.map((op) => ({ id: newOutboxId(), op }))];
  const data = applyOps(useDataStore.getState().data, valid);
  useDataStore.setState((s) => ({ data, sync: { ...s.sync, pending: outbox.length } }));
  persist(CACHE_KEYS.data, data);
  persist(CACHE_KEYS.outbox, outbox);
  kick();
  return true;
}

/**
 * Starts syncing (after login): device cache → `GET /api/data` → pending ops replayed on top,
 * then keeps the outbox flowing. Returns a cleanup that stops this session.
 */
export function startSync(): () => void {
  stopSession();
  const id = ++sessionSeq;
  sessionId = id;
  active = true;
  loadedThisSession = false;
  wantLoad = true;
  retryAt = 0;
  patchSync({ online: typeof navigator === 'undefined' ? true : navigator.onLine });
  detachTriggers = attachTriggers();
  kick();
  return () => {
    if (sessionId === id) stopSession();
  };
}

/**
 * Re-reads the server copy now (after anything pending is sent), e.g. after the server changed
 * something on its own. A load already in flight is followed by a fresh one. No-op without a session.
 */
export function refreshFromServer(): void {
  if (!active) return;
  wantLoad = true;
  retryNow();
}

/**
 * Tries to send everything pending right now (ignores the backoff wait).
 * Resolves `true` when nothing is left in the outbox.
 */
export async function flushNow(): Promise<boolean> {
  if (hydrated && outbox.length === 0) return true;
  retryNow(true);
  while (worker) await worker;
  return hydrated && outbox.length === 0;
}

/** Backup restore: flushes, replaces everything on the server, then locally. Throws `ApiError`. */
export async function importAll(input: AppData): Promise<void> {
  const parsed = appDataSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'bad_request', SYNC_ERRORS.importInvalid);
  await flushNow();
  blocked = true;
  try {
    while (worker) await worker;
    const gen = generation;
    // Whatever is still queued now predates the backup and is replaced by it.
    const superseded = new Set(outbox.map((item) => item.id));
    try {
      await api.importData(parsed.data);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401 && gen === generation) handleUnauthorized();
      throw err;
    }
    if (gen !== generation) return;
    // Changes made while the upload was running still apply on top of the restored data.
    const kept = outbox.filter((item) => !superseded.has(item.id));
    errorKind = null;
    attempt = 0;
    retryAt = 0;
    setOutbox(kept);
    setData(
      applyOps(
        normalizeAppData(parsed.data),
        kept.map((item) => item.op),
      ),
      {
        loaded: true,
        lastSyncedAt: Date.now(),
        error: null,
      },
    );
  } finally {
    blocked = false;
    kick();
  }
}

/** Forgets everything on this device: stops syncing, clears memory and IndexedDB (logout). */
export async function resetLocal(): Promise<void> {
  stopSession();
  generation += 1;
  outbox = [];
  hydrated = false;
  hydrating = null;
  worker = null;
  rekick = false;
  rekickForced = false;
  blocked = false;
  attempt = 0;
  retryAt = 0;
  lastLoadAt = 0;
  errorKind = null;
  useDataStore.setState({ data: emptyData(), sync: initialSyncState() });
  await clearCache();
}

/** Called when the server says the session is gone (401). Returns an unsubscribe function. */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/** Whether there is data to work with offline (device cache or an earlier server load). */
export async function hasDeviceCache(): Promise<boolean> {
  await hydrate();
  return useDataStore.getState().sync.loaded;
}

/** Dismisses `sync.error` (e.g. after the UI showed it). */
export function clearSyncError(): void {
  errorKind = null;
  patchSync({ error: null });
}
