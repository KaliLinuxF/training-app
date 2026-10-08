/**
 * Device cache in IndexedDB (idb-keyval, default store). When IndexedDB is unavailable
 * (private mode, blocked site data, a hung open) it silently falls back to memory: the app
 * keeps working, the data just does not survive a reload.
 *
 * Writes are coalesced: everything persisted in the same tick goes out as one transaction,
 * so `legko.data` and `legko.outbox` always land together. All IndexedDB work runs in a
 * single queue, which keeps reads, writes and the logout wipe strictly ordered.
 */
import { delMany, getMany, setMany } from 'idb-keyval';

export const CACHE_KEYS = { data: 'legko.data', outbox: 'legko.outbox' } as const;
export type CacheKey = (typeof CACHE_KEYS)[keyof typeof CACHE_KEYS];

const ALL_KEYS: CacheKey[] = [CACHE_KEYS.data, CACHE_KEYS.outbox];

/** iOS has had bugs where opening IndexedDB never settles; don't let that block start-up. */
const READ_TIMEOUT_MS = 3_000;

/** Raw values as stored; callers validate them. `undefined` when nothing is stored. */
export interface CacheSnapshot {
  data: unknown;
  outbox: unknown;
}

let idbUsable = true;
/** Mirror of everything persisted in this page's lifetime; the source of truth in fallback mode. */
const memory = new Map<CacheKey, unknown>();
let dirty = new Map<CacheKey, unknown>();
let writeQueued = false;
let queue: Promise<unknown> = Promise.resolve();

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

function writeDirty(): Promise<void> {
  writeQueued = false;
  if (dirty.size === 0) return serial(async () => undefined);
  const entries = [...dirty];
  dirty = new Map();
  return serial(async () => {
    if (!idbUsable) return;
    try {
      await setMany(entries);
    } catch (err) {
      disableIdb(err);
    }
  });
}

/** Schedules `value` to be stored under `key` (coalesced with other writes of this tick). */
export function persist(key: CacheKey, value: unknown): void {
  memory.set(key, value);
  dirty.set(key, value);
  if (writeQueued) return;
  writeQueued = true;
  queueMicrotask(() => {
    void writeDirty();
  });
}

/** Writes anything still pending right away and resolves once it is stored. */
export function flushCacheWrites(): Promise<void> {
  return writeDirty();
}

export function loadCache(): Promise<CacheSnapshot> {
  return serial(async () => {
    if (idbUsable) {
      try {
        const [data, outbox] = await withTimeout(getMany<unknown>(ALL_KEYS), READ_TIMEOUT_MS);
        return { data, outbox };
      } catch (err) {
        disableIdb(err);
      }
    }
    return { data: memory.get(CACHE_KEYS.data), outbox: memory.get(CACHE_KEYS.outbox) };
  });
}

/** Removes both keys (logout). Pending, not yet written values are discarded. */
export function clearCache(): Promise<void> {
  memory.clear();
  dirty = new Map();
  return serial(async () => {
    if (!idbUsable) return;
    try {
      await delMany(ALL_KEYS);
    } catch (err) {
      disableIdb(err);
    }
  });
}

/** `false` once IndexedDB failed and the cache runs in memory only. */
export const isPersistent = (): boolean => idbUsable;
