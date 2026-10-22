/**
 * Sync engine behind `store/data.ts`: optimistic commits, the persistent outbox and the
 * server round-trips (SPEC §3.5).
 *
 * A single worker talks to the server, so a `GET /api/data` and a `POST /api/ops` never
 * overlap: a server copy can never miss ops that were acknowledged while it was in flight,
 * and replaying the still-pending outbox on top of it is always correct.
 *
 * Accounts (docs/multi-user.md §8.3): the engine works for one **owner** at a time — the device user, bound with
 * `bindOwner(id)` / `startSync(id)`. Every request carries the owner (`X-Legko-User`), so a session that belongs to
 * someone else answers 409 `user_mismatch` and nothing of this copy reaches their account; the worker then stops and
 * tells the auth layer (`onUserMismatch`). The worker only runs for a real user id: with the legacy owner bound (the
 * provisional legacy copy) or no owner at all (unit tests of other screens) changes are applied and persisted
 * locally only.
 */
import { appDataSchema, applyOps, emptyData, opSchema, type AppData, type Op } from '@legko/shared';
import { api, ApiError } from '../lib/api';
import { adoptLegacyCache, bindCache, LEGACY_OWNER, loadCache, persist, wipeDevice } from './cache';
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

/** Thrown by `importAll` when no account is bound to this copy (nothing is uploaded). */
export const NO_OWNER_MESSAGE = 'На цьому пристрої ввійдено в інший акаунт';

/** Delay before retry number `attempt` (1-based): 2 s, 4 s, 8 s … capped at 60 s. */
export function retryDelay(attempt: number): number {
  return Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
}

// ---- module state ----------------------------------------------------------------------

/** Whose copy memory holds: a user id, `LEGACY_OWNER` (the provisional legacy copy) or null (none bound). */
let owner: string | null = null;
/** Set by a 409 `user_mismatch`: nothing is sent until `resumeSync()` or another owner is bound. */
let paused = false;

let outbox: readonly OutboxItem[] = [];
/** Bumped by `resetLocal()` and by binding another owner; async results that started under an older one are dropped. */
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
const mismatchListeners = new Set<() => void>();

/** The owner requests are made for: a real user id only (never the legacy owner, never none). */
const syncOwner = (): string | null => (owner !== null && owner !== LEGACY_OWNER ? owner : null);

// ---- local state helpers ---------------------------------------------------------------

function setOutbox(next: readonly OutboxItem[]): void {
  outbox = next;
  persist('outbox', next);
  patchSync({ pending: next.length });
}

function setData(data: AppData, sync: Partial<SyncState> = {}): void {
  useDataStore.setState((s) => ({ data, sync: { ...s.sync, ...sync } }));
  persist('data', data);
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
        persist('data', data);
        persist('outbox', merged);
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

/** Forgets everything in memory (not on the device): another owner, or a logout. */
function resetMemory(): void {
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
  paused = false;
  useDataStore.setState({ data: emptyData(), sync: initialSyncState() });
}

// ---- worker ----------------------------------------------------------------------------

function kick(force = false): void {
  const who = syncOwner();
  if (who === null || paused) return;
  if (!active && !force) return;
  if (worker) {
    rekick = true;
    rekickForced ||= force;
    return;
  }
  const gen = generation;
  const run: Promise<void> = Promise.resolve()
    .then(() => work(gen, who))
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

async function work(gen: number, who: string): Promise<void> {
  await hydrate();
  try {
    while (gen === generation && !blocked && !paused && Date.now() >= retryAt) {
      if (active && wantLoad && (!loadedThisSession || outbox.length === 0)) {
        if (!(await loadFromServer(gen, who))) return;
      } else if (outbox.length > 0) {
        if (!(await sendNextBatch(gen, who))) return;
      } else {
        return;
      }
    }
  } finally {
    if (gen === generation) patchSync({ syncing: false });
  }
}

async function loadFromServer(gen: number, who: string): Promise<boolean> {
  patchSync({ syncing: true });
  // Cleared before the request: a refresh asked for while it is in flight needs a newer copy.
  wantLoad = false;
  lastLoadAt = Date.now();
  let server: AppData;
  try {
    server = await api.getData(who);
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

async function sendNextBatch(gen: number, who: string): Promise<boolean> {
  const batch = outbox.slice(0, MAX_BATCH);
  patchSync({ syncing: true });
  try {
    await api.sendOps(
      batch.map((item) => item.op),
      who,
    );
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

const isMismatch = (err: unknown): boolean => err instanceof ApiError && err.code === 'user_mismatch';

function handleFailure(err: unknown): void {
  if (err instanceof ApiError && err.status === 401) {
    handleUnauthorized();
    return;
  }
  if (isMismatch(err)) {
    handleMismatch();
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

/**
 * The session belongs to another account than this copy (another tab signed in, D11). Nothing was applied, and
 * nothing is sent again (no retry) until the auth layer has decided whose device this is.
 */
function handleMismatch(): void {
  paused = true;
  wantLoad = false;
  clearTimeout(retryTimer);
  retryTimer = undefined;
  for (const listener of [...mismatchListeners]) listener();
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
  persist('data', data);
  persist('outbox', outbox);
  kick();
  return true;
}

/**
 * Makes `next` the owner of the in-memory copy and of the device cache keys: a user id, `LEGACY_OWNER` (the
 * provisional legacy copy) or null (none). Binding another owner stops the session and forgets the memory copy
 * (never another person's data on screen or in a request); binding the same owner again changes nothing.
 */
export function bindOwner(next: string | null): void {
  if (next === owner) return;
  resetMemory();
  owner = next;
  bindCache(next);
}

/** The owner bound now (null = none). */
export const boundOwner = (): string | null => owner;

/**
 * Starts syncing for `id` (the device user, after login): device cache → `GET /api/data` → pending ops replayed on
 * top, then keeps the outbox flowing. Returns a cleanup that stops this session.
 */
export function startSync(id: string): () => void {
  bindOwner(id);
  stopSession();
  paused = false;
  const session = ++sessionSeq;
  sessionId = session;
  active = true;
  loadedThisSession = false;
  wantLoad = true;
  retryAt = 0;
  patchSync({ online: typeof navigator === 'undefined' ? true : navigator.onLine });
  detachTriggers = attachTriggers();
  kick();
  return () => {
    if (sessionId === session) stopSession();
  };
}

/** Stops the running session (listeners, retries); memory and the device copy stay. */
export function stopSync(): void {
  stopSession();
}

/** Whether a 409 `user_mismatch` stopped the worker (cleared by `resumeSync`, `startSync` or another owner). */
export const isSyncPaused = (): boolean => paused;

/** After a 409 `user_mismatch` the auth layer found the session is the device user's after all: carry on. */
export function resumeSync(): void {
  if (!paused) return;
  paused = false;
  wantLoad = true;
  retryNow();
}

/**
 * The legacy owner signed in on a device with the legacy copy: the legacy keys become `id`'s (merged with anything
 * already stored for `id`), memory is kept (it is the same person's copy) and merged with the cache again.
 */
export async function adoptLegacy(id: string): Promise<void> {
  if (owner !== null && owner !== LEGACY_OWNER && owner !== id) bindOwner(id);
  await adoptLegacyCache(id);
  owner = id;
  paused = false;
  bindCache(id);
  await rehydrate();
}

/**
 * Re-reads the bound owner's device copy and merges it with memory (after `mergeLegacyCache` / an adoption changed
 * it under a running app), then refreshes from the server when a session runs.
 */
export async function rehydrate(): Promise<void> {
  hydrated = false;
  hydrating = null;
  await hydrate();
  if (active) {
    wantLoad = true;
    retryNow();
  }
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
  if (syncOwner() === null || paused) {
    // Nobody to send for (or the session is someone else's): report what is waiting.
    await hydrate();
    return outbox.length === 0;
  }
  retryNow(true);
  while (worker) await worker;
  return hydrated && outbox.length === 0;
}

/** Backup restore: flushes, replaces everything on the server, then locally. Throws `ApiError`. */
export async function importAll(input: AppData): Promise<void> {
  const parsed = appDataSchema.safeParse(input);
  if (!parsed.success) throw new ApiError(400, 'bad_request', SYNC_ERRORS.importInvalid);
  const who = syncOwner();
  if (who === null || paused) throw new ApiError(409, 'user_mismatch', NO_OWNER_MESSAGE);
  await flushNow();
  blocked = true;
  try {
    while (worker) await worker;
    const gen = generation;
    // Whatever is still queued now predates the backup and is replaced by it.
    const superseded = new Set(outbox.map((item) => item.id));
    try {
      await api.importData(parsed.data, who);
    } catch (err) {
      if (gen === generation) {
        if (err instanceof ApiError && err.status === 401) handleUnauthorized();
        else if (isMismatch(err)) handleMismatch();
      }
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

/**
 * Forgets everything on this device (logout, a switch to another account): stops syncing, clears memory and wipes
 * the device cache of every account (`wipeDevice`; `keepLegacy` keeps the legacy keys). Resolves `true` once the
 * wipe is verified; never throws.
 */
export async function resetLocal(opts: { keepLegacy?: boolean } = {}): Promise<boolean> {
  resetMemory();
  return wipeDevice(opts);
}

/** Called when the server says the session is gone (401). Returns an unsubscribe function. */
export function onUnauthorized(listener: () => void): () => void {
  unauthorizedListeners.add(listener);
  return () => {
    unauthorizedListeners.delete(listener);
  };
}

/**
 * Called when the server says the session belongs to another account (409 `user_mismatch`); the worker has stopped
 * and sends nothing more. Returns an unsubscribe function.
 */
export function onUserMismatch(listener: () => void): () => void {
  mismatchListeners.add(listener);
  return () => {
    mismatchListeners.delete(listener);
  };
}

/** Whether there is data of the bound owner to work with offline (device cache or an earlier server load). */
export async function hasDeviceCache(): Promise<boolean> {
  await hydrate();
  return useDataStore.getState().sync.loaded;
}

/** Dismisses `sync.error` (e.g. after the UI showed it). */
export function clearSyncError(): void {
  errorKind = null;
  patchSync({ error: null });
}
