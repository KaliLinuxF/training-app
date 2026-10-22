import { normalizeDay, type DayEntry, type Meal, type Op } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CACHE_KEYS, flushCacheWrites } from './cache';
import { dataActions, getAppData, resetLocal, useDataStore } from './data';
import { markNoTraining, markTrained, NO_TRAINING_TOAST, setTrainedMark, TRAINED_TOAST } from './dayMarks';
import { fakeIdb, sampleData, type FakeIdb } from './test-utils';
import { ui } from './ui';

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
}));
vi.mock('idb-keyval', () => mocks.idb);

const DATE = '2026-10-08';

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

const FULL_DAY = day({
  food: 'Омлет, борщ',
  kcal: 1740,
  trained: true,
  types: ['Кардіо', 'Прес'],
  notes: 'Сон 8 год',
  photos: ['photo0000000000001', 'photo0000000000002'],
});

const MEAL: Meal = {
  id: 'breakfast001',
  type: 'Сніданок',
  time: '08:30',
  text: 'Тост з тунцем',
  kcal: 420,
  protein: 27,
  fat: 11,
  carbs: 36,
};
const MEAL_DAY = normalizeDay(day({ trained: false, notes: 'Сон 8 год', meals: [MEAL] }));

let idb: FakeIdb;

beforeEach(async () => {
  idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  mocks.idb.keys.mockReset().mockImplementation(idb.keys);
  await resetLocal();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetLocal();
});

/** The ops waiting for the server (what goes on the wire). */
async function queued(): Promise<Op[]> {
  await flushCacheWrites();
  return ((idb.store.get(CACHE_KEYS.outbox) ?? []) as { op: Op }[]).map((item) => item.op);
}

describe('markTrained / markNoTraining', () => {
  it('carry the workout mark only', () => {
    expect(markTrained()).toEqual({ trained: true });
    expect(markNoTraining()).toEqual({ trained: false });
  });
});

describe('setTrainedMark', () => {
  function seed(entry?: DayEntry) {
    useDataStore.setState({ data: sampleData({ days: entry ? { [DATE]: entry } : {} }) });
  }

  it('✓ sends { trained } only, keeps the day and toasts', async () => {
    seed(day({ food: 'Каша', kcal: 400 }));
    const flash = vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, true)).toBe(true);
    expect(getAppData().days[DATE]).toEqual(day({ food: 'Каша', kcal: 400, trained: true }));
    expect(flash).toHaveBeenCalledExactlyOnceWith(TRAINED_TOAST);
    expect(await queued()).toEqual([{ kind: 'day.meta', date: DATE, value: { trained: true } }]);
  });

  it('✕ drops the types, keeps food, kcal, notes and photos, and toasts', async () => {
    seed(FULL_DAY);
    const flash = vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, false)).toBe(true);
    expect(getAppData().days[DATE]).toEqual({ ...FULL_DAY, trained: false, types: [] });
    expect(flash).toHaveBeenCalledExactlyOnceWith(NO_TRAINING_TOAST);
    expect(await queued()).toEqual([{ kind: 'day.meta', date: DATE, value: { trained: false } }]);
  });

  it('✓ on a day with meals leaves the meals and the notes untouched (nothing of them is sent)', async () => {
    seed(MEAL_DAY);
    vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, true)).toBe(true);
    expect(getAppData().days[DATE]).toEqual({ ...MEAL_DAY, trained: true });
    const [op] = await queued();
    expect(op).toEqual({ kind: 'day.meta', date: DATE, value: { trained: true } });
    expect(JSON.stringify(op)).not.toContain('Тост');
    expect(JSON.stringify(op)).not.toContain('Сон');
  });

  it('marks a day that has no record yet', () => {
    seed();
    vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, false)).toBe(true);
    expect(getAppData().days[DATE]).toEqual(day({ trained: false }));
  });

  it('does nothing when the day is already marked that way', () => {
    seed(FULL_DAY);
    const save = vi.spyOn(dataActions, 'setDayMeta');
    const flash = vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, true)).toBe(false);
    seed(day({ trained: false }));
    expect(setTrainedMark(DATE, false)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(flash).not.toHaveBeenCalled();
  });

  it('does not toast when the save is refused (the sync notice already shows)', () => {
    seed();
    const save = vi.spyOn(dataActions, 'setDayMeta').mockReturnValue(false);
    const flash = vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, true)).toBe(false);
    expect(save).toHaveBeenCalledExactlyOnceWith(DATE, { trained: true });
    expect(flash).not.toHaveBeenCalled();
  });

  it('never uses the legacy whole-day write', () => {
    seed(FULL_DAY);
    vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    const legacy = vi.spyOn(dataActions, 'saveDay');
    setTrainedMark(DATE, false);
    expect(legacy).not.toHaveBeenCalled();
  });
});
