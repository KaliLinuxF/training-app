import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';
import {
  adoptLegacyCache,
  bindCache,
  cacheKeys,
  CACHE_KEYS,
  clearCache,
  DEVICE_USER_KEY,
  flushCacheWrites,
  hasLegacyCache,
  hasWipeTombstone,
  isPersistent,
  LEGACY_KEYS,
  LEGACY_OWNER,
  loadCache,
  loadDeviceUser,
  mergeLegacyCache,
  outboxSize,
  persist,
  saveDeviceUser,
  WIPE_PENDING_KEY,
  wipeDevice,
} from './cache';
import { bindOwner, dataActions, getAppData, resetLocal, startSync, useDataStore } from './data';
import { fakeIdb, sampleData, sessionUser, settle, type FakeIdb } from './test-utils';

const mocks = vi.hoisted(() => ({
  api: { getData: vi.fn(), sendOps: vi.fn() },
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('idb-keyval', () => mocks.idb);

const A = 'a1'.padEnd(32, '0');
const B = 'b2'.padEnd(32, '0');
const item = (id: string, kg = 65) => ({ id, op: { kind: 'weight.put', date: '2026-10-09', kg } });

let idb: FakeIdb;

function useFakeIdb(): void {
  idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  mocks.idb.keys.mockReset().mockImplementation(idb.keys);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  localStorage.clear();
});

// These need a working IndexedDB; the fallback is one-way for the page's lifetime, so they run first.
describe('per-user keys', () => {
  beforeEach(async () => {
    useFakeIdb();
    bindOwner(null);
    bindCache(null);
    await flushCacheWrites();
  });

  it('names the keys per owner; the legacy owner keeps the old keys', () => {
    expect(cacheKeys(A)).toEqual({ data: `legko.data.${A}`, outbox: `legko.outbox.${A}` });
    expect(cacheKeys(LEGACY_OWNER)).toEqual(LEGACY_KEYS);
    expect(CACHE_KEYS).toEqual({ data: 'legko.data', outbox: 'legko.outbox' });
  });

  it('without an owner bound works on the legacy keys exactly as before accounts', async () => {
    persist('data', { a: 1 });
    persist('outbox', []);
    await flushCacheWrites();
    expect(mocks.idb.setMany).toHaveBeenCalledTimes(1);
    expect(mocks.idb.setMany).toHaveBeenCalledWith([
      [CACHE_KEYS.data, { a: 1 }],
      [CACHE_KEYS.outbox, []],
    ]);
    expect(await loadCache()).toEqual({ data: { a: 1 }, outbox: [] });
    expect(isPersistent()).toBe(true);
  });

  it('reads and writes the bound owner’s keys only, and never mixes owners', async () => {
    idb.store.set(cacheKeys(B).data, { owner: 'B' });
    bindCache(A);
    persist('data', { owner: 'A' });
    persist('outbox', [item('a')]);
    // Rebinding in the same tick: the pending writes keep their own (A's) keys.
    bindCache(B);
    persist('outbox', [item('b')]);
    await flushCacheWrites();

    expect(idb.store.get(cacheKeys(A).data)).toEqual({ owner: 'A' });
    expect(idb.store.get(cacheKeys(A).outbox)).toEqual([item('a')]);
    expect(idb.store.get(cacheKeys(B).outbox)).toEqual([item('b')]);
    expect(await loadCache()).toEqual({ data: { owner: 'B' }, outbox: [item('b')] });
    bindCache(A);
    expect(await loadCache()).toEqual({ data: { owner: 'A' }, outbox: [item('a')] });
    expect(idb.store.has(LEGACY_KEYS.data)).toBe(false);
  });

  it('stores the full device user and ignores a broken one', async () => {
    const user = sessionUser({ id: A, username: 'olya', role: 'admin' });
    expect(await loadDeviceUser()).toBeNull();
    await saveDeviceUser(user);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(user);
    expect(await loadDeviceUser()).toEqual(user);

    idb.store.set(DEVICE_USER_KEY, { id: 'nope' });
    expect(await loadDeviceUser()).toBeNull();
  });

  it('counts the pending ops of an owner, pending writes included', async () => {
    idb.store.set(cacheKeys(B).outbox, [item('b1'), { id: 'broken' }]);
    bindCache(A);
    persist('outbox', [item('a1'), item('a2')]);
    expect(await outboxSize(A)).toBe(2);
    expect(await outboxSize(B)).toBe(1);
    expect(await outboxSize(LEGACY_OWNER)).toBe(0);
  });

  it('knows whether the legacy keys hold anything', async () => {
    expect(await hasLegacyCache()).toBe(false);
    idb.store.set(LEGACY_KEYS.outbox, []);
    expect(await hasLegacyCache()).toBe(true);
  });

  it('adopts the legacy copy: flushed first, copied, deleted, and the cache rebound', async () => {
    bindCache(LEGACY_OWNER);
    persist('data', sampleData({ weights: [{ date: '2026-10-01', kg: 66 }] }));
    persist('outbox', [item('legacy-op')]);
    // Not flushed yet: the adoption does it first.
    await adoptLegacyCache(A);

    expect(idb.store.get(cacheKeys(A).data)).toMatchObject({ weights: [{ date: '2026-10-01', kg: 66 }] });
    expect(idb.store.get(cacheKeys(A).outbox)).toEqual([item('legacy-op')]);
    expect(idb.store.has(LEGACY_KEYS.data)).toBe(false);
    expect(idb.store.has(LEGACY_KEYS.outbox)).toBe(false);
    // Bound to the adopter now.
    persist('data', { after: true });
    await flushCacheWrites();
    expect(idb.store.get(cacheKeys(A).data)).toEqual({ after: true });
    expect(idb.store.has(LEGACY_KEYS.data)).toBe(false);
  });

  it('merges legacy keys into the user’s: legacy data, each op once (by id), legacy keys gone', async () => {
    idb.store.set(cacheKeys(A).data, { old: true });
    idb.store.set(cacheKeys(A).outbox, [item('shared'), item('mine')]);
    idb.store.set(LEGACY_KEYS.data, { rolledBack: true });
    idb.store.set(LEGACY_KEYS.outbox, [item('shared'), item('legacy')]);

    await mergeLegacyCache(A);

    expect(idb.store.get(cacheKeys(A).data)).toEqual({ rolledBack: true });
    expect(idb.store.get(cacheKeys(A).outbox)).toEqual([item('shared'), item('mine'), item('legacy')]);
    expect(idb.store.has(LEGACY_KEYS.data)).toBe(false);
    expect(idb.store.has(LEGACY_KEYS.outbox)).toBe(false);
    // Nothing else touched.
    expect([...idb.store.keys()].sort()).toEqual([cacheKeys(A).data, cacheKeys(A).outbox].sort());
  });

  it('a legacy outbox without legacy data keeps the user’s data', async () => {
    idb.store.set(cacheKeys(A).data, { mine: true });
    idb.store.set(LEGACY_KEYS.outbox, [item('legacy')]);
    await mergeLegacyCache(A);
    expect(idb.store.get(cacheKeys(A).data)).toEqual({ mine: true });
    expect(idb.store.get(cacheKeys(A).outbox)).toEqual([item('legacy')]);
  });

  it('wipes every legko.* key and nothing else, and leaves no tombstone once verified', async () => {
    idb.store.set(DEVICE_USER_KEY, sessionUser({ id: A }));
    idb.store.set(cacheKeys(A).data, {});
    idb.store.set(cacheKeys(B).outbox, []);
    idb.store.set(LEGACY_KEYS.data, {});
    idb.store.set('other-app', 1);
    bindCache(A);
    persist('data', { pending: true });

    expect(await wipeDevice()).toBe(true);

    expect([...idb.store.keys()]).toEqual(['other-app']);
    expect(hasWipeTombstone()).toBe(false);
    expect(localStorage.getItem(WIPE_PENDING_KEY)).toBeNull();
    expect(await loadCache()).toEqual({ data: undefined, outbox: undefined });
    // The pending write was discarded, not written after the wipe.
    await flushCacheWrites();
    expect(idb.store.has(cacheKeys(A).data)).toBe(false);
  });

  it('keeps the legacy keys with keepLegacy (a switch to the legacy owner)', async () => {
    idb.store.set(DEVICE_USER_KEY, sessionUser({ id: B }));
    idb.store.set(cacheKeys(B).data, {});
    idb.store.set(LEGACY_KEYS.data, { legacy: true });
    idb.store.set(LEGACY_KEYS.outbox, [item('legacy')]);

    expect(await wipeDevice({ keepLegacy: true })).toBe(true);

    expect([...idb.store.keys()].sort()).toEqual([LEGACY_KEYS.data, LEGACY_KEYS.outbox]);
  });

  it('keeps the tombstone when the wipe cannot be verified (never throws)', async () => {
    idb.store.set(cacheKeys(A).data, {});
    mocks.idb.delMany.mockRejectedValue(new Error('broken'));
    vi.stubGlobal('indexedDB', {
      deleteDatabase: () => {
        throw new Error('no');
      },
    });

    expect(await wipeDevice()).toBe(false);

    expect(hasWipeTombstone()).toBe(true);
    expect(idb.store.has(cacheKeys(A).data)).toBe(true);
    vi.unstubAllGlobals();
  });

  it('falls back to deleting the whole database when the keys cannot be deleted', async () => {
    idb.store.set(cacheKeys(A).data, {});
    mocks.idb.delMany.mockRejectedValue(new Error('broken'));
    const deleteDatabase = vi.fn((name: string) => {
      const request: { onsuccess?: () => void; onerror?: () => void } = {};
      queueMicrotask(() => {
        if (name === 'keyval-store') idb.store.clear();
        request.onsuccess?.();
      });
      return request;
    });
    vi.stubGlobal('indexedDB', { deleteDatabase });

    expect(await wipeDevice()).toBe(true);

    expect(deleteDatabase).toHaveBeenCalledWith('keyval-store');
    expect(idb.store.size).toBe(0);
    expect(hasWipeTombstone()).toBe(false);
    vi.unstubAllGlobals();
  });

  it('is bounded when IndexedDB hangs (about 7 s at worst)', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.idb.keys.mockReturnValue(new Promise(() => undefined));
    vi.stubGlobal('indexedDB', { deleteDatabase: () => ({}) });
    let result: boolean | undefined;
    void wipeDevice().then((ok) => {
      result = ok;
    });

    await vi.advanceTimersByTimeAsync(7_000);
    expect(result).toBe(false);
    expect(hasWipeTombstone()).toBe(true);
    vi.unstubAllGlobals();
  });

  it('clearCache removes the bound owner’s keys only', async () => {
    idb.store.set(cacheKeys(A).data, {});
    idb.store.set(cacheKeys(B).data, {});
    bindCache(A);
    await clearCache();
    expect([...idb.store.keys()]).toEqual([cacheKeys(B).data]);
  });
});

describe('wipe without IndexedDB in use (idbUsable = false)', () => {
  it('still deletes the keys: the wipe always tries IndexedDB', async () => {
    useFakeIdb();
    bindCache(null);
    // A hung read switches the cache to memory only for the rest of the page.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.idb.getMany.mockReturnValue(new Promise(() => undefined));
    const snapshot = loadCache();
    await vi.advanceTimersByTimeAsync(3_000);
    await snapshot;
    vi.useRealTimers();
    expect(isPersistent()).toBe(false);

    // Later the store answers again; what an earlier page wrote is still on the device.
    mocks.idb.getMany.mockImplementation(idb.getMany);
    idb.store.set(DEVICE_USER_KEY, sessionUser({ id: A }));
    idb.store.set(cacheKeys(A).data, { a: 1 });
    idb.store.set(cacheKeys(A).outbox, [item('a')]);

    expect(await wipeDevice()).toBe(true);
    expect(idb.store.size).toBe(0);
    expect(hasWipeTombstone()).toBe(false);
  });
});

// The IndexedDB fallback is one-way for the page's lifetime, so these run in order in one file.
describe('device cache without IndexedDB', () => {
  it('times out a hung IndexedDB read and falls back to memory', async () => {
    useFakeIdb();
    bindCache(null);
    persist('data', { a: 1 });
    persist('outbox', []);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    mocks.idb.getMany.mockReturnValue(new Promise(() => undefined));
    const snapshot = loadCache();
    await vi.advanceTimersByTimeAsync(3_000);
    // The memory mirror still holds what this page persisted.
    await expect(snapshot).resolves.toEqual({ data: { a: 1 }, outbox: [] });
    expect(isPersistent()).toBe(false);
  });

  it('keeps working in memory: no more IndexedDB writes, no crash', async () => {
    mocks.idb.setMany.mockClear();
    persist('data', { b: 2 });
    await flushCacheWrites();
    expect(mocks.idb.setMany).not.toHaveBeenCalled();
    expect(await loadCache()).toEqual({ data: { b: 2 }, outbox: [] });

    await clearCache();
    expect(await loadCache()).toEqual({ data: undefined, outbox: undefined });
  });

  it('keeps the device user and the per-user keys apart in memory', async () => {
    const user = sessionUser({ id: A });
    await saveDeviceUser(user);
    expect(await loadDeviceUser()).toEqual(user);
    bindCache(A);
    persist('outbox', [item('a')]);
    expect(await outboxSize(A)).toBe(1);
    bindCache(B);
    expect(await loadCache()).toEqual({ data: undefined, outbox: undefined });
    await wipeDevice();
    expect(await loadDeviceUser()).toBeNull();
    bindCache(null);
  });

  it('lets the store commit and sync as usual', async () => {
    mocks.api.getData.mockResolvedValue(sampleData());
    mocks.api.sendOps.mockResolvedValue({ ok: true, applied: 1 });
    const stop = startSync(A);
    await settle();

    dataActions.setWeight('2026-10-09', 65);
    await settle();

    expect(getAppData().weights).toEqual([{ date: '2026-10-09', kg: 65 }]);
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(1);
    expect(mocks.api.sendOps).toHaveBeenCalledWith([{ kind: 'weight.put', date: '2026-10-09', kg: 65 }], A);
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

  it('a wipe there resolves false (unverified) instead of throwing', async () => {
    vi.resetModules();
    const fresh = await import('./cache');
    mocks.idb.keys.mockImplementation(() => {
      throw new ReferenceError('indexedDB is not defined');
    });
    vi.stubGlobal('indexedDB', undefined);
    await expect(fresh.wipeDevice()).resolves.toBe(false);
    expect(fresh.hasWipeTombstone()).toBe(true);
    vi.unstubAllGlobals();
  });
});
