/**
 * Test-only stand-in for `@/store/data` (never imported by app code): a reactive copy of the app data that
 * applies meal ops with the shared reducer, so `saveMeal` refuses exactly what the real store refuses.
 *
 *   vi.mock('@/store/data', async () => (await import('./testStore')).storeModule);
 */
import {
  emptyData,
  opSchema,
  reduceDay,
  type AppData,
  type FoodUse,
  type ISODate,
  type Meal,
  type Settings,
} from '@legko/shared';
import { useSyncExternalStore } from 'react';
import { vi } from 'vitest';

let data: AppData = emptyData();
let online = true;
let idSeq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

const ONLINE = { loaded: true, pending: 0, online: true, syncing: false, lastSyncedAt: null, error: null };
const OFFLINE = { ...ONLINE, online: false };

function saveMeal(date: ISODate, meal: Meal, _uses: readonly FoodUse[] = []): boolean {
  const parsed = opSchema.safeParse({ kind: 'meal.put', date, value: meal });
  if (!parsed.success || parsed.data.kind !== 'meal.put') return false;
  const next = reduceDay(data.days[date], parsed.data);
  if (!next?.meals?.some((m) => m.id === meal.id)) return false;
  data = { ...data, days: { ...data.days, [date]: next } };
  emit();
  return true;
}

function deleteMeal(date: ISODate, id: string): boolean {
  const next = reduceDay(data.days[date], { kind: 'meal.delete', date, id });
  const days = { ...data.days };
  if (next) days[date] = next;
  else delete days[date];
  data = { ...data, days };
  emit();
  return true;
}

function updateSettings(update: (s: Settings) => Settings): boolean {
  data = { ...data, settings: update(data.settings) };
  emit();
  return true;
}

export const dataActions = {
  saveMeal: vi.fn(saveMeal),
  deleteMeal: vi.fn(deleteMeal),
  updateSettings: vi.fn(updateSettings),
};

export const fakeStore = {
  /** Fresh data (empty by default), online, and the action spies reset to the real behaviour. */
  reset(next: AppData = emptyData()): void {
    data = next;
    online = true;
    dataActions.saveMeal.mockReset().mockImplementation(saveMeal);
    dataActions.deleteMeal.mockReset().mockImplementation(deleteMeal);
    dataActions.updateSettings.mockReset().mockImplementation(updateSettings);
    storeModule.commit.mockReset().mockReturnValue(true);
    emit();
  },
  get data(): AppData {
    return data;
  },
  setData(next: AppData): void {
    data = next;
    emit();
  },
  setOnline(value: boolean): void {
    online = value;
    emit();
  },
};

export const storeModule = {
  useAppData: (): AppData => useSyncExternalStore(subscribe, () => data),
  useSyncState: () => useSyncExternalStore(subscribe, () => (online ? ONLINE : OFFLINE)),
  getAppData: (): AppData => data,
  commit: vi.fn(() => true),
  newMealId: (): string => `testMeal${String(++idSeq).padStart(4, '0')}`,
  dataActions,
};
