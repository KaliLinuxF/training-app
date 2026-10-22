/**
 * Device cache in IndexedDB (idb-keyval, default store; docs/multi-user.md §8.1). When IndexedDB is unavailable
 * (private mode, blocked site data, a hung open) it silently falls back to memory: the app keeps working, the data
 * just does not survive a reload.
 *
 * Keys:
 * - `legko.user` — the full `SessionUser` whose copy this device holds (the device user);
 * - `legko.data.<id>` / `legko.outbox.<id>` — that user's AppData copy / pending ops;
 * - `legko.data` / `legko.outbox` — the legacy keys (written before accounts existed, or by the old bundle during a
 *   rollback), adopted or merged by the legacy owner.
 *
 * `bindCache(owner)` picks whose keys `loadCache()` / `persist()` use. With no owner bound (the unit tests of other
 * screens never bind one) they work on the legacy keys exactly as before accounts existed.
 *
 * Writes are coalesced per full key: everything persisted in the same tick goes out as one transaction, so a user's
 * data and outbox always land together, and rebinding never mixes owners. All IndexedDB work runs in a single queue,
 * which keeps reads, writes and the wipe strictly ordered.
 */
import { sessionUserSchema, type SessionUser } from '@legko/shared';
import { delMany, getMany, keys as idbKeys, setMany } from 'idb-keyval';
import { parseOutbox } from './normalize';

/** Owner of the legacy keys `legko.data` / `legko.outbox` (the account is not known yet). */
export const LEGACY_OWNER = '';
export const LEGACY_KEYS = { data: 'legko.data', outbox: 'legko.outbox' } as const;
/** The keys used while no owner is bound (= the legacy keys). */
export const CACHE_KEYS = LEGACY_KEYS;
/** The device user (`SessionUser`). */
export const DEVICE_USER_KEY = 'legko.user';
/** Every key of this app starts with it (the wipe removes them all). */
export const KEY_PREFIX = 'legko.';
/** localStorage tombstone while a logout / switch wipe is not verified (D12). */
export const WIPE_PENDING_KEY = 'legko.wipePending';

export type CacheKind = 'data' | 'outbox';
export type CacheKeySet = Readonly<Record<CacheKind, string>>;

/** The IndexedDB database idb-keyval's default store lives in (the wipe's last resort deletes it). */
const IDB_NAME = 'keyval-store';

/** iOS has had bugs where opening IndexedDB never settles; don't let that block start-up. */
const READ_TIMEOUT_MS = 3_000;
/** Each step of the wipe (keys + delete, then the database delete) gets this long. */
export const WIPE_STEP_TIMEOUT_MS = 3_000;
/** How long the wipe waits for queued IndexedDB work before it goes ahead anyway. */
const WIPE_QUEUE_WAIT_MS = 500;
/** The wipe's verification read. */
const WIPE_VERIFY_TIMEOUT_MS = 500;
/** Upper bound for waits on queued writes (device user pointer, outbox counts) before a reload or a decision. */
const WRITE_WAIT_MS = 3_000;

/** Raw values as stored; callers validate them. `undefined` when nothing is stored. */
export interface CacheSnapshot {
  data: unknown;
  outbox: unknown;
}

const LEGACY_KEY_LIST: readonly string[] = [LEGACY_KEYS.data, LEGACY_KEYS.outbox];
const isLegacyKey = (key: string): boolean => LEGACY_KEY_LIST.includes(key);

let idbUsable = true;
/** Mirror of everything persisted in this page's lifetime; the source of truth in fallback mode. */
const memory = new Map<string, unknown>();
let dirty = new Map<string, unknown>();
let writeQueued = false;
let queue: Promise<unknown> = Promise.resolve();
/** Whose keys `loadCache` / `persist` use; null = no owner bound (the legacy keys, as before accounts). */
let bound: string | null = null;
/**
 * Legacy keys that were adopted by an account: a write to them that was already queued when the adoption ran is
 * dropped (the sync layer re-reads the account's keys and re-persists anything newer from memory).
 */
const retired = new Set<string>();

export function cacheKeys(owner: string): CacheKeySet {
  if (owner === LEGACY_OWNER) return LEGACY_KEYS;
  return { data: `${LEGACY_KEYS.data}.${owner}`, outbox: `${LEGACY_KEYS.outbox}.${owner}` };
}

const boundKeys = (): CacheKeySet => cacheKeys(bound ?? LEGACY_OWNER);

function serial<T>(task: () => Promise<T>): Promise<T> {
  const run = queue.then(task);
  queue = run.catch(() => undefined);
  return run;
}

function disableIdb(reason: unknown): void {
  if (!idbUsable) return;
  idbUsable = false;
  console.warn('[legko] IndexedDB is unavailable, keeping data in memory only', reason);
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`IndexedDB did not answer in ${ms} ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err: unknown) => {
        clearTimeout(timer);
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    );
  });
}

/** Resolves with the promise's value, or with `fallback` when it fails or takes longer than `ms`. */
function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  return withTimeout(promise, ms).catch(() => fallback);
}

/** Runs an idb-keyval call; a synchronous throw (no IndexedDB at all) becomes a rejection. */
function idb<T>(call: () => Promise<T>): Promise<T> {
  try {
    return call();
  } catch (err) {
    return Promise.reject(err instanceof Error ? err : new Error(String(err)));
  }
}

/** Reads `keyList` (IndexedDB, or the memory mirror once it failed). Call inside `serial`. */
async function readKeys(keyList: readonly string[]): Promise<unknown[]> {
  if (idbUsable) {
    try {
      return await withTimeout(
        idb(() => getMany<unknown>([...keyList])),
        READ_TIMEOUT_MS,
      );
    } catch (err) {
      disableIdb(err);
    }
  }
  return keyList.map((key) => memory.get(key));
}

function writeDirty(): Promise<void> {
  writeQueued = false;
  if (dirty.size === 0) return serial(async () => undefined);
  const entries = [...dirty];
  dirty = new Map();
  return serial(async () => {
    const live = entries.filter(([key]) => !retired.has(key));
    if (!idbUsable || live.length === 0) return;
    try {
      await idb(() => setMany(live));
    } catch (err) {
      disableIdb(err);
    }
  });
}

function persistKey(key: string, value: unknown): void {
  memory.set(key, value);
  dirty.set(key, value);
  if (writeQueued) return;
  writeQueued = true;
  queueMicrotask(() => {
    void writeDirty();
  });
}

/**
 * Picks whose copy `loadCache` / `persist` use: a user id, `LEGACY_OWNER` for the legacy keys, or null for none
 * (= the legacy keys, today's behaviour). Values already persisted keep their own keys.
 */
export function bindCache(owner: string | null): void {
  bound = owner;
  if (owner === null || owner === LEGACY_OWNER) retired.clear();
}

/** The owner `loadCache` / `persist` currently use (null = none bound). */
export const boundCacheOwner = (): string | null => bound;

/** Schedules `value` to be stored as the bound owner's `kind` (coalesced with other writes of this tick). */
export function persist(kind: CacheKind, value: unknown): void {
  persistKey(boundKeys()[kind], value);
}

/** Writes anything still pending right away and resolves once it is stored. */
export function flushCacheWrites(): Promise<void> {
  return writeDirty();
}

/** `flushCacheWrites()`, but never waits longer than `ms` (before a reload or a decision). */
export function flushCacheWritesWithin(ms = WRITE_WAIT_MS): Promise<void> {
  return within(flushCacheWrites(), ms, undefined);
}

/** The bound owner's copy. */
export function loadCache(): Promise<CacheSnapshot> {
  const keys = boundKeys();
  return serial(async () => {
    const [data, outbox] = await readKeys([keys.data, keys.outbox]);
    return { data, outbox };
  });
}

/** The device user (`legko.user`), or null when none is stored (or it is unreadable). */
export function loadDeviceUser(): Promise<SessionUser | null> {
  return serial(async () => {
    const [raw] = await readKeys([DEVICE_USER_KEY]);
    const parsed = sessionUserSchema.safeParse(raw);
    return parsed.success ? parsed.data : null;
  });
}

/** Stores the device user; resolves once written (or after a few seconds at most). */
export function saveDeviceUser(user: SessionUser): Promise<void> {
  persistKey(DEVICE_USER_KEY, user);
  return flushCacheWritesWithin();
}

/** Whether the legacy keys `legko.data` / `legko.outbox` hold anything. */
export function hasLegacyCache(): Promise<boolean> {
  return serial(async () => {
    const values = await readKeys(LEGACY_KEY_LIST);
    return values.some((value) => value !== undefined);
  });
}

/** Number of valid pending ops in `owner`'s outbox (pending writes are flushed first). */
export async function outboxSize(owner: string): Promise<number> {
  await flushCacheWritesWithin();
  const key = cacheKeys(owner).outbox;
  const read = serial(async () => (await readKeys([key]))[0]);
  const raw = await within(read, READ_TIMEOUT_MS + WRITE_WAIT_MS, memory.get(key));
  return parseOutbox(raw).length;
}

/** `legko.data.<id> := legko.data`; `legko.outbox.<id> :=` the user's items + legacy items not already there. */
async function mergeLegacyInto(id: string): Promise<void> {
  const user = cacheKeys(id);
  const [legacyData, legacyOutbox, userOutbox] = await readKeys([LEGACY_KEYS.data, LEGACY_KEYS.outbox, user.outbox]);
  if (legacyData === undefined && legacyOutbox === undefined) return;
  const items = parseOutbox(userOutbox);
  const known = new Set(items.map((item) => item.id));
  const merged = [...items, ...parseOutbox(legacyOutbox).filter((item) => !known.has(item.id))];
  const writes: [string, unknown][] = [];
  if (legacyData !== undefined) writes.push([user.data, legacyData]);
  writes.push([user.outbox, merged]);
  for (const [key, value] of writes) memory.set(key, value);
  for (const key of LEGACY_KEY_LIST) {
    memory.delete(key);
    dirty.delete(key);
  }
  if (!idbUsable) return;
  try {
    await withTimeout(
      idb(() => setMany(writes)),
      WRITE_WAIT_MS,
    );
    await withTimeout(
      idb(() => delMany([...LEGACY_KEY_LIST])),
      WRITE_WAIT_MS,
    );
  } catch (err) {
    disableIdb(err);
  }
}

/**
 * Pointer = the legacy owner and legacy keys present (the rolled-back app wrote them): their copy replaces the
 * user's, their unsent ops join the user's outbox (each op once, by `OutboxItem.id`), and the legacy keys go.
 */
export async function mergeLegacyCache(id: string): Promise<void> {
  await flushCacheWritesWithin();
  await serial(() => mergeLegacyInto(id));
}

/**
 * The legacy owner signed in on a device that holds the legacy keys: after the pending writes are flushed, copies
 * both legacy keys to the user's keys (merging the outbox like `mergeLegacyCache`), deletes them and binds the
 * cache to the user — in one serial task.
 */
export async function adoptLegacyCache(id: string): Promise<void> {
  await flushCacheWritesWithin();
  await serial(async () => {
    await mergeLegacyInto(id);
    for (const key of LEGACY_KEY_LIST) retired.add(key);
    bound = id;
  });
}

// ---- wipe (D12) -------------------------------------------------------------------------

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;

function localStore(): KeyValueStore | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

function writeTombstone(): void {
  try {
    localStore()?.setItem(WIPE_PENDING_KEY, '1');
  } catch {
    // Storage blocked: the wipe still runs, it just cannot be retried after a reload.
  }
}

function clearTombstone(): void {
  try {
    localStore()?.removeItem(WIPE_PENDING_KEY);
  } catch {
    // ignore
  }
}

/** A logout / switch wipe of this device was never verified (D12): nothing on it may be shown. */
export function hasWipeTombstone(): boolean {
  try {
    return localStore()?.getItem(WIPE_PENDING_KEY) === '1';
  } catch {
    return false;
  }
}

/** Last resort of the wipe: drop idb-keyval's whole database. */
function deleteKeyvalDatabase(ms: number): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let request: IDBOpenDBRequest;
    try {
      request = globalThis.indexedDB.deleteDatabase(IDB_NAME);
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }
    const timer = setTimeout(() => reject(new Error('IndexedDB delete timed out')), ms);
    request.onsuccess = () => {
      clearTimeout(timer);
      resolve();
    };
    request.onerror = () => {
      clearTimeout(timer);
      reject(request.error ?? new Error('IndexedDB delete failed'));
    };
    // `onblocked`: another connection is open; keep waiting until the timeout.
  });
}

async function wipeIdb(keepLegacy: boolean): Promise<boolean> {
  const doomed = (key: IDBValidKey): boolean =>
    typeof key === 'string' && key.startsWith(KEY_PREFIX) && !(keepLegacy && isLegacyKey(key));
  try {
    await withTimeout(
      (async () => {
        const targets = (await idb(() => idbKeys())).filter(doomed);
        if (targets.length > 0) await idb(() => delMany(targets));
      })(),
      WIPE_STEP_TIMEOUT_MS,
    );
  } catch {
    try {
      await deleteKeyvalDatabase(WIPE_STEP_TIMEOUT_MS);
    } catch {
      // Verified (and retried on the next start) below.
    }
  }
  try {
    const left = await withTimeout(
      idb(() => idbKeys()),
      WIPE_VERIFY_TIMEOUT_MS,
    );
    return !left.some(doomed);
  } catch {
    return false;
  }
}

/**
 * Removes this device's copy of everybody (logout, a switch to another account). `keepLegacy` keeps the legacy keys
 * (a switch to the legacy owner: her own unsent ops survive and are adopted after the reload).
 *
 * Sets the `legko.wipePending` tombstone, clears memory and pending writes, then ALWAYS tries IndexedDB — whatever
 * the memory fallback says — deleting every `legko.*` key (falling back to deleting the whole database), and
 * verifies. Resolves `true` once verified (the tombstone is removed), `false` otherwise (the tombstone stays: the
 * next start wipes again before anything is shown). Never throws; resolves within ~7 s at worst.
 */
export function wipeDevice({ keepLegacy = false }: { keepLegacy?: boolean } = {}): Promise<boolean> {
  writeTombstone();
  for (const key of [...memory.keys()]) if (!(keepLegacy && isLegacyKey(key))) memory.delete(key);
  dirty = new Map([...dirty].filter(([key]) => keepLegacy && isLegacyKey(key)));
  retired.clear();
  const previous = queue;
  const run = (async () => {
    // Let queued work land first, so a write already in flight cannot come back after the wipe (bounded).
    await within(previous, WIPE_QUEUE_WAIT_MS, undefined);
    const verified = await wipeIdb(keepLegacy).catch(() => false);
    if (verified) clearTombstone();
    else console.warn('[legko] the device wipe could not be verified; it is retried on the next start');
    return verified;
  })();
  queue = run.catch(() => undefined);
  return run;
}

/** Keeps the cache in memory for the rest of this page (an unverified wipe: nothing on the device is trusted). */
export function keepCacheInMemory(): void {
  disableIdb(new Error('the device copy is not trusted'));
}

/** Removes the bound owner's keys only (memory and IndexedDB). Pending, not yet written values are discarded. */
export function clearCache(): Promise<void> {
  const keys = boundKeys();
  const list = [keys.data, keys.outbox];
  for (const key of list) {
    memory.delete(key);
    dirty.delete(key);
  }
  return serial(async () => {
    if (!idbUsable) return;
    try {
      await idb(() => delMany(list));
    } catch (err) {
      disableIdb(err);
    }
  });
}

/** `false` once IndexedDB failed and the cache runs in memory only. */
export const isPersistent = (): boolean => idbUsable;
