import { addDays, LEGACY_MEAL_ID, mealIdSchema, type DayEntry, type Meal, type Op } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';
import { ApiError } from '../lib/api';
import { CACHE_KEYS, flushCacheWrites } from './cache';
import {
  clearSyncError,
  commit,
  dataActions,
  flushNow,
  getAppData,
  hasDeviceCache,
  newMealId,
  onUnauthorized,
  refreshFromServer,
  resetLocal,
  startSync,
  useDataStore,
} from './data';
import {
  FOCUS_REFRESH_GAP_MS,
  MAX_BATCH,
  PENDING_POLL_MS,
  REFRESH_POLL_MS,
  retryDelay,
  SYNC_ERRORS,
} from './sync';
import { deferred, DEVICE_TZ, fakeIdb, sampleData, settle, type FakeIdb } from './test-utils';

const mocks = vi.hoisted(() => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getData: vi.fn(),
    sendOps: vi.fn(),
    importData: vi.fn(),
  },
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() },
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('idb-keyval', () => mocks.idb);

const TODAY = '2026-10-09';
const networkError = () => new ApiError(0, 'network', 'offline');
const sync = () => useDataStore.getState().sync;
const sentBatches = (): Op[][] => mocks.api.sendOps.mock.calls.map((call) => call[0] as Op[]);
const weightOp = (date: string, kg: number): Op => ({ kind: 'weight.put', date, kg });

let idb: FakeIdb;
let stop: (() => void) | undefined;

function begin(): void {
  stop = startSync();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(new Date(`${TODAY}T09:00:00`));
  idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.getData.mockResolvedValue(sampleData());
  mocks.api.sendOps.mockImplementation(async (ops: Op[]) => ({ ok: true, applied: ops.length }));
  mocks.api.importData.mockResolvedValue({ ok: true });
  await resetLocal();
  mocks.idb.delMany.mockClear();
});

afterEach(async () => {
  stop?.();
  stop = undefined;
  await resetLocal();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('commit', () => {
  it('applies a change locally at once and persists data + outbox in one write', async () => {
    dataActions.setWeight(TODAY, 65.4);
    dataActions.saveDay(TODAY, { food: ' Омлет ', kcal: 1650, trained: true, types: ['Кардіо'], notes: '' });

    expect(getAppData().weights).toEqual([{ date: TODAY, kg: 65.4 }]);
    expect(getAppData().days[TODAY]?.food).toBe('Омлет');
    expect(sync().pending).toBe(2);

    await flushCacheWrites();
    expect(mocks.idb.setMany).toHaveBeenCalledTimes(1);
    expect(idb.store.get(CACHE_KEYS.data)).toMatchObject({ weights: [{ date: TODAY, kg: 65.4 }] });
    expect(idb.store.get(CACHE_KEYS.outbox)).toEqual([
      { id: expect.any(String), op: weightOp(TODAY, 65.4) },
      { id: expect.any(String), op: expect.objectContaining({ kind: 'day.put', date: TODAY }) },
    ]);
  });

  it('refuses ops that fail validation and says so', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    dataActions.setWeight(TODAY, 5);
    expect(warn).toHaveBeenCalled();
    expect(getAppData().weights).toEqual([]);
    expect(sync().pending).toBe(0);
    expect(sync().error).toBe(SYNC_ERRORS.invalidLocal);

    dataActions.setWeight(TODAY, 65);
    expect(sync().error).toBeNull();
  });

  it('does not talk to the server before startSync()', async () => {
    commit(weightOp(TODAY, 65));
    await settle();
    expect(mocks.api.sendOps).not.toHaveBeenCalled();
  });
});

describe('start-up', () => {
  it('restores the device cache before the server answers', async () => {
    const cached = sampleData({ weights: [{ date: '2026-10-01', kg: 66 }] });
    idb.store.set(CACHE_KEYS.data, cached);
    mocks.api.getData.mockReturnValue(deferred().promise);

    begin();
    await settle();

    expect(sync().loaded).toBe(true);
    expect(getAppData().weights).toEqual(cached.weights);
    expect(await hasDeviceCache()).toBe(true);
  });

  it('stays unloaded on a fresh device until the server copy arrives', async () => {
    const server = deferred<ReturnType<typeof sampleData>>();
    mocks.api.getData.mockReturnValue(server.promise);

    begin();
    await settle();
    expect(sync().loaded).toBe(false);

    server.resolve(sampleData({ weights: [{ date: '2026-10-01', kg: 66 }] }));
    await settle();
    expect(sync().loaded).toBe(true);
    expect(getAppData().weights).toEqual([{ date: '2026-10-01', kg: 66 }]);
    expect(sync().lastSyncedAt).toBe(Date.now());
  });

  it('replays still-pending ops on top of the server copy, then sends them', async () => {
    const pending = weightOp(TODAY, 65);
    idb.store.set(
      CACHE_KEYS.data,
      sampleData({
        weights: [
          { date: '2026-10-01', kg: 66 },
          { date: TODAY, kg: 65 },
        ],
      }),
    );
    idb.store.set(CACHE_KEYS.outbox, [{ id: 'a', op: pending }]);
    mocks.api.getData.mockResolvedValue(
      sampleData({
        weights: [
          { date: '2026-10-05', kg: 65.8 },
          { date: '2026-10-01', kg: 66 },
        ],
      }),
    );
    const ack = deferred<{ ok: true; applied: number }>();
    mocks.api.sendOps.mockReturnValue(ack.promise);

    begin();
    await settle();

    // Server copy (re-sorted) + the pending weigh-in, before the server acknowledged it.
    expect(getAppData().weights).toEqual([
      { date: '2026-10-01', kg: 66 },
      { date: '2026-10-05', kg: 65.8 },
      { date: TODAY, kg: 65 },
    ]);
    expect(mocks.api.getData.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.api.sendOps.mock.invocationCallOrder[0] ?? 0,
    );
    expect(sentBatches()).toEqual([[pending]]);

    ack.resolve({ ok: true, applied: 1 });
    await settle();
    expect(sync().pending).toBe(0);
    await flushCacheWrites();
    expect(idb.store.get(CACHE_KEYS.outbox)).toEqual([]);
  });

  it('keeps ops committed while the cache was still loading, after the cached ones', async () => {
    const cachedOp = weightOp('2026-10-08', 65.5);
    idb.store.set(CACHE_KEYS.data, sampleData({ weights: [{ date: '2026-10-08', kg: 65.5 }] }));
    idb.store.set(CACHE_KEYS.outbox, [{ id: 'old', op: cachedOp }]);

    begin();
    dataActions.setWeight(TODAY, 65.1);
    await settle();

    expect(getAppData().weights.map((w) => w.date)).toEqual(['2026-10-08', TODAY]);
    expect(sentBatches()).toEqual([[cachedOp, weightOp(TODAY, 65.1)]]);
  });

  it('ignores a corrupted cache instead of crashing', async () => {
    idb.store.set(CACHE_KEYS.data, 'garbage');
    idb.store.set(CACHE_KEYS.outbox, [{ id: 1 }, { id: 'x', op: { kind: 'nope' } }]);

    begin();
    await settle();

    expect(sync().loaded).toBe(true);
    expect(mocks.api.sendOps).not.toHaveBeenCalled();
  });

  it('never rewrites the settings at start-up, whatever zone this device is in', async () => {
    // The phone's zone travels with its push subscription; a laptop must not overwrite it.
    const other = DEVICE_TZ === 'Asia/Tokyo' ? 'Europe/Kyiv' : 'Asia/Tokyo';
    const server = sampleData();
    mocks.api.getData.mockResolvedValue({ ...server, settings: { ...server.settings, timezone: other } });

    begin();
    await settle();
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(mocks.api.getData).toHaveBeenCalledTimes(2);
    expect(getAppData().settings.timezone).toBe(other);
    expect(mocks.api.sendOps).not.toHaveBeenCalled();
    expect(sync().pending).toBe(0);
  });
});

describe('outbox flush', () => {
  it('sends ops in order, in batches of 100, one request at a time', async () => {
    const acks = [deferred<unknown>(), deferred<unknown>(), deferred<unknown>()];
    let call = 0;
    mocks.api.sendOps.mockImplementation(() => acks[call++]?.promise);
    const ops = Array.from({ length: 250 }, (_, i) => weightOp(addDays('2026-01-01', i), 60 + (i % 10)));

    begin();
    await settle();
    commit(...ops);
    await settle();

    expect(sentBatches()).toEqual([ops.slice(0, MAX_BATCH)]);
    acks[0]?.resolve({ ok: true });
    await settle();
    expect(sentBatches()).toEqual([ops.slice(0, 100), ops.slice(100, 200)]);
    expect(sync().pending).toBe(150);
    expect(sync().syncing).toBe(true);

    acks[1]?.resolve({ ok: true });
    await settle();
    acks[2]?.resolve({ ok: true });
    await settle();

    expect(sentBatches()).toEqual([ops.slice(0, 100), ops.slice(100, 200), ops.slice(200)]);
    expect(sync().pending).toBe(0);
    expect(sync().syncing).toBe(false);
  });

  it('keeps ops on network errors and retries with exponential backoff', async () => {
    mocks.api.sendOps
      .mockRejectedValueOnce(networkError())
      .mockRejectedValueOnce(new ApiError(502, 'internal', 'Bad Gateway'))
      .mockResolvedValue({ ok: true, applied: 1 });

    begin();
    await settle();
    commit(weightOp(TODAY, 65));
    await settle();
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(1);
    expect(sync().pending).toBe(1);
    expect(sync().error).toBeNull();

    await vi.advanceTimersByTimeAsync(retryDelay(1) - 1);
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(retryDelay(2) - 1);
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(3);
    expect(sync().pending).toBe(0);
  });

  it('caps the backoff at 60 s', () => {
    expect([1, 2, 3, 4, 5, 6, 7, 20].map(retryDelay)).toEqual([
      2_000, 4_000, 8_000, 16_000, 32_000, 60_000, 60_000, 60_000,
    ]);
  });

  it('retries right away when the network comes back', async () => {
    mocks.api.sendOps.mockRejectedValueOnce(networkError()).mockResolvedValue({ ok: true, applied: 1 });

    begin();
    await settle();
    commit(weightOp(TODAY, 65));
    await settle();
    window.dispatchEvent(new Event('offline'));
    expect(sync().online).toBe(false);

    window.dispatchEvent(new Event('online'));
    await settle();
    expect(sync().online).toBe(true);
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(2);
    expect(sync().pending).toBe(0);
  });

  it('keeps retrying while pending, but the 30 s poll never cuts a backoff wait short', async () => {
    mocks.api.sendOps.mockRejectedValue(networkError());

    begin();
    await settle();
    commit(weightOp(TODAY, 65));
    await settle();
    // Grow the backoff to its 60 s cap (2 + 4 + 8 + 16 + 32 + 60 s of failures).
    for (let i = 1; i <= 6; i++) {
      await vi.advanceTimersByTimeAsync(retryDelay(i));
      await settle();
    }
    const calls = mocks.api.sendOps.mock.calls.length;
    expect(calls).toBe(7);

    await vi.advanceTimersByTimeAsync(PENDING_POLL_MS);
    await settle();
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(calls);

    await vi.advanceTimersByTimeAsync(60_000 - PENDING_POLL_MS);
    await settle();
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(calls + 1);
    expect(sync().pending).toBe(1);
  });

  it('drops an op the server rejects, reports it and carries on', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const ops = [weightOp('2026-10-07', 65), weightOp('2026-10-08', 64.9), weightOp(TODAY, 64.8)];
    mocks.api.sendOps
      .mockRejectedValueOnce(new ApiError(400, 'invalid_op', 'Invalid op', 1))
      .mockResolvedValue({ ok: true, applied: 2 });

    begin();
    await settle();
    commit(...ops);
    await settle();

    expect(sentBatches()).toEqual([ops, [ops[0], ops[2]]]);
    expect(sync().pending).toBe(0);
    expect(sync().error).toBe(SYNC_ERRORS.rejected);
    // Reconciles the optimistic state with the server.
    expect(mocks.api.getData).toHaveBeenCalledTimes(2);

    clearSyncError();
    expect(sync().error).toBeNull();
  });

  it('surfaces unexpected errors, keeps the ops and clears the error once it works', async () => {
    mocks.api.sendOps
      .mockRejectedValueOnce(new ApiError(403, 'forbidden_origin', 'Forbidden'))
      .mockResolvedValue({ ok: true, applied: 1 });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

    begin();
    await settle();
    commit(weightOp(TODAY, 65));
    await settle();
    expect(sync().error).toBe(SYNC_ERRORS.failed);
    expect(sync().pending).toBe(1);

    await vi.advanceTimersByTimeAsync(retryDelay(1));
    await settle();
    expect(sync().pending).toBe(0);
    expect(sync().error).toBeNull();
  });

  it('stops and notifies the auth layer on 401', async () => {
    mocks.api.sendOps.mockRejectedValue(new ApiError(401, 'unauthorized', 'Unauthorized'));
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    begin();
    await settle();
    commit(weightOp(TODAY, 65));
    await settle();

    expect(listener).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    window.dispatchEvent(new Event('online'));
    await settle();
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(1);
    expect(sync().pending).toBe(1);
    unsubscribe();
  });

  it('treats a 401 on the initial load the same way', async () => {
    mocks.api.getData.mockRejectedValue(new ApiError(401, 'unauthorized', 'Unauthorized'));
    const listener = vi.fn();
    const unsubscribe = onUnauthorized(listener);

    begin();
    await settle();
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
  });

  it('flushNow() reports whether everything reached the server', async () => {
    mocks.api.sendOps.mockRejectedValueOnce(networkError()).mockResolvedValue({ ok: true, applied: 1 });
    commit(weightOp(TODAY, 65));

    expect(await flushNow()).toBe(false);
    expect(await flushNow()).toBe(true);
    expect(mocks.api.sendOps).toHaveBeenCalledTimes(2);
  });
});

describe('foreground refresh', () => {
  it('re-reads the server when the app comes back and nothing is pending', async () => {
    begin();
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(1);

    mocks.api.getData.mockResolvedValue(sampleData({ weights: [{ date: TODAY, kg: 64 }] }));
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(mocks.api.getData).toHaveBeenCalledTimes(2);
    expect(getAppData().weights).toEqual([{ date: TODAY, kg: 64 }]);
  });

  it('sends pending ops first and refreshes afterwards', async () => {
    mocks.api.sendOps.mockRejectedValueOnce(networkError()).mockResolvedValue({ ok: true, applied: 1 });
    begin();
    await settle();
    commit(weightOp(TODAY, 65));
    await settle();

    document.dispatchEvent(new Event('visibilitychange'));
    await settle();

    expect(mocks.api.sendOps).toHaveBeenCalledTimes(2);
    expect(mocks.api.getData).toHaveBeenCalledTimes(2);
    expect(mocks.api.sendOps.mock.invocationCallOrder[1]).toBeLessThan(
      mocks.api.getData.mock.invocationCallOrder[1] ?? 0,
    );
  });

  it('re-reads the server every minute while visible and nothing is pending', async () => {
    begin();
    await settle();
    mocks.api.getData.mockResolvedValue(sampleData({ weights: [{ date: TODAY, kg: 64.8 }] }));

    await vi.advanceTimersByTimeAsync(REFRESH_POLL_MS - 1);
    expect(mocks.api.getData).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(2);
    expect(getAppData().weights).toEqual([{ date: TODAY, kg: 64.8 }]);

    await vi.advanceTimersByTimeAsync(REFRESH_POLL_MS);
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(3);
  });

  it('does not poll the server while hidden or while changes are waiting to be sent', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    begin();
    await settle();
    await vi.advanceTimersByTimeAsync(3 * REFRESH_POLL_MS);
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue('visible');
    mocks.api.sendOps.mockRejectedValue(networkError());
    commit(weightOp(TODAY, 65));
    await settle();
    await vi.advanceTimersByTimeAsync(3 * REFRESH_POLL_MS);
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(1);
    expect(mocks.api.sendOps.mock.calls.length).toBeGreaterThan(1);
  });

  it('re-reads the server when the window gets focus, but not right after another load', async () => {
    begin();
    await settle();

    // Focus usually arrives together with visibilitychange: one load is enough.
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_GAP_MS);
    mocks.api.getData.mockResolvedValue(sampleData({ weights: [{ date: TODAY, kg: 64.9 }] }));
    window.dispatchEvent(new Event('focus'));
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(2);
    expect(getAppData().weights).toEqual([{ date: TODAY, kg: 64.9 }]);
  });

  it('re-reads the server when the page comes back from the back/forward cache', async () => {
    begin();
    await settle();
    await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_GAP_MS);

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(1);

    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(2);
  });

  it('follows a load that was already in flight with a fresh one when asked to refresh', async () => {
    const first = deferred<ReturnType<typeof sampleData>>();
    mocks.api.getData.mockReturnValueOnce(first.promise);
    begin();
    await settle();

    // E.g. the server changed settings.timezone after this request was answered.
    refreshFromServer();
    mocks.api.getData.mockResolvedValue(sampleData({ weights: [{ date: TODAY, kg: 64.7 }] }));
    first.resolve(sampleData());
    await settle();

    expect(mocks.api.getData).toHaveBeenCalledTimes(2);
    expect(getAppData().weights).toEqual([{ date: TODAY, kg: 64.7 }]);
  });

  it('retries a failed refresh with backoff and ignores refresh requests without a session', async () => {
    refreshFromServer();
    await settle();
    expect(mocks.api.getData).not.toHaveBeenCalled();

    mocks.api.getData.mockRejectedValueOnce(networkError());
    begin();
    await settle();
    expect(sync().loaded).toBe(false);

    await vi.advanceTimersByTimeAsync(retryDelay(1));
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(2);
    expect(sync().loaded).toBe(true);
  });

  it('stops listening after cleanup', async () => {
    begin();
    await settle();
    stop?.();
    await vi.advanceTimersByTimeAsync(FOCUS_REFRESH_GAP_MS);
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(2 * REFRESH_POLL_MS);
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledTimes(1);
  });
});

describe('importAll', () => {
  const backup = sampleData({ weights: [{ date: '2026-09-01', kg: 70 }] });

  it('flushes first, uploads, then replaces local data and clears the outbox', async () => {
    mocks.api.sendOps.mockRejectedValueOnce(networkError()).mockResolvedValue({ ok: true, applied: 1 });
    begin();
    await settle();
    commit(weightOp(TODAY, 65));
    await settle();

    await dataActions.importAll(backup);

    expect(mocks.api.sendOps.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.api.importData.mock.invocationCallOrder[0] ?? 0,
    );
    expect(mocks.api.importData).toHaveBeenCalledWith(backup);
    expect(getAppData()).toEqual(backup);
    expect(sync().pending).toBe(0);
    await flushCacheWrites();
    expect(idb.store.get(CACHE_KEYS.data)).toEqual(backup);
    expect(idb.store.get(CACHE_KEYS.outbox)).toEqual([]);
  });

  it('drops pending ops the server never got: the backup replaces them', async () => {
    mocks.api.sendOps.mockRejectedValue(networkError());
    commit(weightOp(TODAY, 65));

    await dataActions.importAll(backup);

    expect(getAppData().weights).toEqual(backup.weights);
    expect(sync().pending).toBe(0);
  });

  it('throws ApiError and keeps local data when the upload fails', async () => {
    mocks.api.importData.mockRejectedValue(networkError());
    commit(weightOp(TODAY, 65));
    await flushNow();

    await expect(dataActions.importAll(backup)).rejects.toMatchObject({ code: 'network' });
    expect(getAppData().weights).toEqual([{ date: TODAY, kg: 65 }]);
  });

  it('rejects a file that is not a backup without uploading it', async () => {
    const broken = { ...backup, weights: [{ date: 'yesterday', kg: 70 }] };
    await expect(dataActions.importAll(broken)).rejects.toBeInstanceOf(ApiError);
    await expect(dataActions.importAll(broken)).rejects.toMatchObject({ code: 'bad_request' });
    expect(mocks.api.importData).not.toHaveBeenCalled();
  });
});

describe('resetLocal', () => {
  it('wipes memory and the device cache', async () => {
    idb.store.set(CACHE_KEYS.data, sampleData({ weights: [{ date: '2026-10-01', kg: 66 }] }));
    begin();
    await settle();
    commit(weightOp(TODAY, 65));

    await resetLocal();

    expect(getAppData().weights).toEqual([]);
    expect(sync()).toMatchObject({ loaded: false, pending: 0, error: null });
    expect(mocks.idb.delMany).toHaveBeenCalledWith([CACHE_KEYS.data, CACHE_KEYS.outbox]);
    expect(idb.store.size).toBe(0);
    expect(await hasDeviceCache()).toBe(false);
  });
});

describe('meals: saveMeal / deleteMeal / setDayMeta', () => {
  const meal = (patch: Partial<Meal> = {}): Meal => ({
    id: 'breakfast001',
    type: 'Сніданок',
    time: '08:30',
    text: 'Тост з тунцем',
    kcal: 420,
    protein: 27,
    fat: 11,
    carbs: 36,
    ...patch,
  });
  const outbox = async (): Promise<Op[]> => {
    await flushCacheWrites();
    return ((idb.store.get(CACHE_KEYS.outbox) ?? []) as { op: Op }[]).map((item) => item.op);
  };

  it('saveMeal applies optimistically, converts a legacy day and queues meal.put + food.use', async () => {
    useDataStore.setState({
      data: sampleData({
        days: { [TODAY]: { food: 'Борщ', kcal: 500, trained: null, types: [], notes: '' } },
      }),
    });
    const uses = [{ name: 'Тост', portion: '2 шт', kcal: 310, protein: 24 }];
    expect(dataActions.saveMeal(TODAY, meal(), uses)).toBe(true);
    expect(getAppData().days[TODAY]).toMatchObject({ food: 'Сніданок: Тост з тунцем\nБорщ', kcal: 920 });
    expect(getAppData().days[TODAY]?.meals?.map((m) => m.id)).toEqual(['breakfast001', LEGACY_MEAL_ID]);
    expect(getAppData().foods).toMatchObject([{ name: 'Тост', count: 1, protein: 24 }]);
    expect(await outbox()).toEqual([
      { kind: 'meal.put', date: TODAY, value: meal() },
      { kind: 'food.use', date: TODAY, value: uses[0] },
    ]);
    expect(sync().pending).toBe(2);
  });

  it('leaves out an invalid dish use instead of blocking the meal', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const uses = [
      { name: '  ', portion: '', kcal: 100 },
      { name: 'Кава', portion: '', kcal: 40, fat: 0.3 },
      { name: 'Чай', portion: '', kcal: 2 },
    ];
    expect(dataActions.saveMeal(TODAY, meal(), uses)).toBe(true);
    expect((await outbox()).map((op) => op.kind)).toEqual(['meal.put', 'food.use']);
    expect(getAppData().foods.map((f) => f.name)).toEqual(['Чай']);
    expect(sync().error).toBeNull();
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns false and queues nothing for the 21st meal of a day; an existing meal can still be saved', async () => {
    for (let i = 0; i < 20; i++)
      expect(dataActions.saveMeal(TODAY, meal({ id: `meal${i}`, time: null }))).toBe(true);
    const before = getAppData();
    const queuedBefore = (await outbox()).length;
    expect(
      dataActions.saveMeal(TODAY, meal({ id: 'meal20' }), [{ name: 'Тост', portion: '', kcal: 1 }]),
    ).toBe(false);
    expect(getAppData()).toBe(before);
    expect(await outbox()).toHaveLength(queuedBefore);
    expect(sync().error).toBeNull();
    expect(dataActions.saveMeal(TODAY, meal({ id: 'meal3', time: null, text: 'Омлет' }))).toBe(true);
    expect(getAppData().days[TODAY]?.meals?.[3]?.text).toBe('Омлет');
  });

  it('returns false for an invalid meal (and says so); an empty meal deletes it', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(dataActions.saveMeal(TODAY, meal({ protein: 12.3 }))).toBe(false);
    expect(sync().error).toBe(SYNC_ERRORS.invalidLocal);
    expect(warn).toHaveBeenCalled();
    expect(getAppData().days).toEqual({});

    expect(dataActions.saveMeal(TODAY, meal())).toBe(true);
    expect(
      dataActions.saveMeal(TODAY, meal({ text: '', kcal: null, protein: null, fat: null, carbs: null })),
    ).toBe(true);
    expect(getAppData().days).toEqual({});
  });

  it('deleteMeal queues meal.delete and removes the meal at once', async () => {
    dataActions.saveMeal(TODAY, meal());
    dataActions.saveMeal(
      TODAY,
      meal({ id: 'lunch0000001', type: 'Обід', time: '13:00', text: 'Суп', kcal: 200 }),
    );
    expect(dataActions.deleteMeal(TODAY, 'breakfast001')).toBe(true);
    expect(getAppData().days[TODAY]).toMatchObject({ food: 'Обід: Суп', kcal: 200 });
    expect((await outbox()).at(-1)).toEqual({ kind: 'meal.delete', date: TODAY, id: 'breakfast001' });
  });

  it('setDayMeta sends only the keys given and keeps the meals', async () => {
    dataActions.saveMeal(TODAY, meal());
    expect(dataActions.setDayMeta(TODAY, { notes: 'Сон 8 год', types: undefined })).toBe(true);
    expect(dataActions.setDayMeta(TODAY, { trained: true, types: ['Кардіо'] })).toBe(true);
    expect(getAppData().days[TODAY]).toMatchObject({ trained: true, types: ['Кардіо'], notes: 'Сон 8 год' });
    expect(getAppData().days[TODAY]?.meals).toEqual([meal()]);
    const ops = await outbox();
    expect(ops.slice(1)).toEqual([
      { kind: 'day.meta', date: TODAY, value: { notes: 'Сон 8 год' } },
      { kind: 'day.meta', date: TODAY, value: { trained: true, types: ['Кардіо'] } },
    ]);
    expect(Object.keys((ops[1] as { value: object }).value)).toEqual(['notes']);
  });

  it('the deprecated saveDay strips meals: the day.put op is legacy-shaped', async () => {
    dataActions.saveMeal(TODAY, meal());
    const stored = getAppData().days[TODAY];
    expect(dataActions.saveDay(TODAY, { ...(stored as DayEntry), trained: true })).toBe(true);
    const put = (await outbox()).at(-1);
    expect(put).toMatchObject({ kind: 'day.put' });
    expect(put && 'value' in put ? put.value : {}).not.toHaveProperty('meals');
    // Rule L keeps the meals locally as the server does.
    expect(getAppData().days[TODAY]?.meals).toEqual([meal()]);
  });

  it('newMealId: 12 characters a meal id may have, different every time', () => {
    const ids = new Set(Array.from({ length: 300 }, newMealId));
    expect(ids.size).toBe(300);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
      expect(mealIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('newMealId works without Web Crypto', () => {
    vi.stubGlobal('crypto', undefined);
    try {
      expect(newMealId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
