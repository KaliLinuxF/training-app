import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';
import { CACHE_KEYS, clearCache, flushCacheWrites, isPersistent, loadCache, persist } from './cache';
import { dataActions, getAppData, resetLocal, startSync, useDataStore } from './data';
import { sampleData, settle } from './test-utils';

const mocks = vi.hoisted(() => ({
  api: { getData: vi.fn(), sendOps: vi.fn() },
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() },
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('idb-keyval', () => mocks.idb);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// The IndexedDB fallback is one-way for the page's lifetime, so these run in order in one file.
describe('device cache without IndexedDB', () => {
  it('writes both keys in one transaction while IndexedDB works', async () => {
    mocks.idb.setMany.mockResolvedValue(undefined);
    persist(CACHE_KEYS.data, { a: 1 });
    persist(CACHE_KEYS.outbox, []);
    await flushCacheWrites();
    expect(mocks.idb.setMany).toHaveBeenCalledTimes(1);
    expect(mocks.idb.setMany).toHaveBeenCalledWith([
      [CACHE_KEYS.data, { a: 1 }],
      [CACHE_KEYS.outbox, []],
    ]);
    expect(isPersistent()).toBe(true);
  });

  it('times out a hung IndexedDB read and falls back to memory', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.idb.getMany.mockReturnValue(new Promise(() => undefined));
    const snapshot = loadCache();
    await vi.advanceTimersByTimeAsync(3_000);
    // The memory mirror still holds what this page persisted.
    await expect(snapshot).resolves.toEqual({ data: { a: 1 }, outbox: [] });
    expect(isPersistent()).toBe(false);
  });

  it('keeps working in memory: no more IndexedDB calls, no crash', async () => {
    mocks.idb.setMany.mockClear();
    persist(CACHE_KEYS.data, { b: 2 });
    await flushCacheWrites();
    expect(mocks.idb.setMany).not.toHaveBeenCalled();
    expect(await loadCache()).toEqual({ data: { b: 2 }, outbox: [] });

    await clearCache();
    expect(await loadCache()).toEqual({ data: undefined, outbox: undefined });
  });

  it('lets the store commit and sync as usual', async () => {
    mocks.api.getData.mockResolvedValue(sampleData());
    mocks.api.sendOps.mockResolvedValue({ ok: true, applied: 1 });
    const stop = startSync();
    await settle();

    dataActions.setWeight('2026-10-09', 65);
    await settle();

    expect(getAppData().weights).toEqual([{ date: '2026-10-09', kg: 65 }]);
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(1);
    expect(useDataStore.getState().sync.pending).toBe(0);
    stop();
    await resetLocal();
  });
});

describe('IndexedDB missing entirely', () => {
  it('falls back to memory when idb-keyval throws synchronously', async () => {
    vi.resetModules();
    const fresh = await import('./cache');
    mocks.idb.getMany.mockImplementation(() => {
      throw new ReferenceError('indexedDB is not defined');
    });
    await expect(fresh.loadCache()).resolves.toEqual({ data: undefined, outbox: undefined });
    expect(fresh.isPersistent()).toBe(false);
  });
});
