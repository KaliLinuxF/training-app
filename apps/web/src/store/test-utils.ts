/**
 * Test helpers for the data layer (imported by `*.test.ts(x)` only, never by app code).
 */
import { emptyData, type AppData } from '@legko/shared';

/** Captured before any test installs fake timers. */
const realSetTimeout = globalThis.setTimeout;

/** Lets every pending promise callback run (one real macrotask), even under fake timers. */
export function settle(): Promise<void> {
  return new Promise((resolve) => realSetTimeout(resolve, 0));
}

export interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

export function deferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = () => undefined;
  let reject: (reason: unknown) => void = () => undefined;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** In-memory stand-in for the idb-keyval functions the cache uses. */
export interface FakeIdb {
  store: Map<string, unknown>;
  getMany: (keys: string[]) => Promise<unknown[]>;
  setMany: (entries: [string, unknown][]) => Promise<void>;
  delMany: (keys: string[]) => Promise<void>;
}

export function fakeIdb(): FakeIdb {
  const store = new Map<string, unknown>();
  return {
    store,
    getMany: async (keys) => keys.map((k) => structuredClone(store.get(k))),
    setMany: async (entries) => {
      for (const [k, v] of entries) store.set(k, structuredClone(v));
    },
    delMany: async (keys) => {
      for (const k of keys) store.delete(k);
    },
  };
}

/** This device's zone: fixtures look like data whose zone was set by this phone's push subscription. */
export const DEVICE_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

export function sampleData(patch: Partial<AppData> = {}): AppData {
  const base = emptyData();
  return { ...base, settings: { ...base.settings, timezone: DEVICE_TZ, onboarded: true }, ...patch };
}
