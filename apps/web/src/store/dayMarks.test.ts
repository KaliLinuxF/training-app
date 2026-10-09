import type { DayEntry } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { dataActions, getAppData, resetLocal, useDataStore } from './data';
import { markNoTraining, markTrained, NO_TRAINING_TOAST, setTrainedMark, TRAINED_TOAST } from './dayMarks';
import { fakeIdb, sampleData } from './test-utils';
import { ui } from './ui';

const mocks = vi.hoisted(() => ({ idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() } }));
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

beforeEach(async () => {
  const idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  await resetLocal();
});

afterEach(async () => {
  vi.restoreAllMocks();
  await resetLocal();
});

describe('markTrained / markNoTraining', () => {
  it('start an unrecorded day from an empty entry', () => {
    expect(markTrained(undefined)).toEqual(day({ trained: true }));
    expect(markNoTraining(undefined)).toEqual(day({ trained: false }));
  });

  it('✓ keeps types, food, kcal, notes and photos', () => {
    const entry = { ...FULL_DAY, trained: false };
    expect(markTrained(entry)).toEqual({ ...entry, trained: true });
  });

  it('✕ clears only the workout types', () => {
    expect(markNoTraining(FULL_DAY)).toEqual({ ...FULL_DAY, trained: false, types: [] });
  });

  it('never mutates the stored entry', () => {
    const entry = structuredClone(FULL_DAY);
    markNoTraining(entry);
    markTrained(entry);
    expect(entry).toEqual(FULL_DAY);
  });
});

describe('setTrainedMark', () => {
  function seed(entry?: DayEntry) {
    useDataStore.setState({ data: sampleData({ days: entry ? { [DATE]: entry } : {} }) });
  }

  it('✓ saves the day and toasts', () => {
    seed(day({ food: 'Каша', kcal: 400 }));
    const flash = vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, true)).toBe(true);
    expect(getAppData().days[DATE]).toEqual(day({ food: 'Каша', kcal: 400, trained: true }));
    expect(flash).toHaveBeenCalledExactlyOnceWith(TRAINED_TOAST);
  });

  it('✕ saves the day without types and toasts', () => {
    seed(FULL_DAY);
    const flash = vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, false)).toBe(true);
    expect(getAppData().days[DATE]).toEqual({ ...FULL_DAY, trained: false, types: [] });
    expect(flash).toHaveBeenCalledExactlyOnceWith(NO_TRAINING_TOAST);
  });

  it('marks a day that has no record yet', () => {
    seed();
    vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, false)).toBe(true);
    expect(getAppData().days[DATE]).toEqual(day({ trained: false }));
  });

  it('does nothing when the day is already marked that way', () => {
    seed(FULL_DAY);
    const save = vi.spyOn(dataActions, 'saveDay');
    const flash = vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, true)).toBe(false);
    seed(day({ trained: false }));
    expect(setTrainedMark(DATE, false)).toBe(false);
    expect(save).not.toHaveBeenCalled();
    expect(flash).not.toHaveBeenCalled();
  });

  it('does not toast when the save is refused (the sync notice already shows)', () => {
    seed();
    const save = vi.spyOn(dataActions, 'saveDay').mockReturnValue(false);
    const flash = vi.spyOn(ui, 'flash').mockImplementation(() => undefined);
    expect(setTrainedMark(DATE, true)).toBe(false);
    expect(save).toHaveBeenCalledExactlyOnceWith(DATE, day({ trained: true }));
    expect(flash).not.toHaveBeenCalled();
  });
});
