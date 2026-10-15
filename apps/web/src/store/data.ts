/**
 * App data store — the single source of truth the screens read from.
 *
 * Contract (keep these exports stable, screens depend on them):
 * - `useAppData()` / `useSettings()` / `useSyncState()` — React hooks.
 * - `dataActions.*` — every change goes through here: it is applied optimistically,
 *   persisted on the device (IndexedDB) and queued for the server (works offline).
 * - `startSync()` — called by `AuthGate` after login; loads the device cache, then the server
 *   copy, and keeps flushing the queue. Returns a cleanup function.
 * - `flushNow()`, `resetLocal()`, `onUnauthorized()`, `hasDeviceCache()`, `refreshFromServer()`,
 *   `clearSyncError()` — used by the auth layer and settings screens.
 *
 * Implementation: `state.ts` (zustand), `cache.ts` (IndexedDB), `sync.ts` (outbox + server).
 */
import {
  normalizeMeal,
  opSchema,
  reduceDay,
  type AppData,
  type DayEntry,
  type DayMeta,
  type FoodUse,
  type ISODate,
  type Meal,
  type MeasureValues,
  type Op,
  type Settings,
} from '@legko/shared';
import { useDataStore, type SyncState } from './state';
import { commitOps, importAll } from './sync';

export { useDataStore, type DataStore, type SyncState } from './state';
export {
  clearSyncError,
  flushNow,
  hasDeviceCache,
  onUnauthorized,
  refreshFromServer,
  resetLocal,
  startSync,
} from './sync';

export const useAppData = (): AppData => useDataStore((s) => s.data);
export const useSettings = (): Settings => useDataStore((s) => s.data.settings);
export const useSyncState = (): SyncState => useDataStore((s) => s.sync);
export const getAppData = (): AppData => useDataStore.getState().data;

/**
 * Applies ops locally right away and queues them for the server.
 * Returns `false` (and applies nothing) when an op is invalid — callers should keep the user's input then.
 */
export function commit(...ops: Op[]): boolean {
  return commitOps(ops);
}

const MEAL_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A new meal's id: 12 random base64url characters (72 bits). `crypto.getRandomValues` works on LAN http too;
 * `Math.random` is only the fallback for environments without Web Crypto.
 */
export function newMealId(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
    crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => MEAL_ID_ALPHABET[b & 63] ?? 'A').join('');
}

/** Only the keys that are set: `day.meta` applies exactly what it carries. */
function metaValue(meta: DayMeta): DayMeta {
  const value: DayMeta = {};
  if (meta.trained !== undefined) value.trained = meta.trained;
  if (meta.types !== undefined) value.types = meta.types;
  if (meta.notes !== undefined) value.notes = meta.notes;
  return value;
}

export const dataActions = {
  /**
   * Saves one meal of `date` (upsert by `meal.id`; a legacy day is converted; an empty meal deletes it), plus a
   * `food.use` for each dish of `uses` (an invalid use is left out: it must never block the meal).
   * Returns `false` and commits nothing when the meal is refused: invalid (the sync notice says so), or a new
   * meal on a day that already has 20 (the reducer would not add it).
   */
  saveMeal(date: ISODate, meal: Meal, uses: readonly FoodUse[] = []): boolean {
    const op: Op = { kind: 'meal.put', date, value: meal };
    const parsed = opSchema.safeParse(op);
    if (parsed.success && parsed.data.kind === 'meal.put' && normalizeMeal(parsed.data.value) !== null) {
      // A non-empty meal that the reducer would not keep: the 21st meal of the day.
      const next = reduceDay(getAppData().days[date], parsed.data);
      if (!next?.meals?.some((m) => m.id === meal.id)) return false;
    }
    const useOps = uses
      .map((value): Op => ({ kind: 'food.use', date, value }))
      .filter((use) => opSchema.safeParse(use).success);
    return commit(op, ...useOps);
  },
  /** Removes one meal (`LEGACY_MEAL_ID` clears a legacy day's food). */
  deleteMeal(date: ISODate, id: string): boolean {
    return commit({ kind: 'meal.delete', date, id });
  },
  /** Workout mark / types / notes of `date`: only the keys given are written (never the food). */
  setDayMeta(date: ISODate, meta: DayMeta): boolean {
    return commit({ kind: 'day.meta', date, value: metaValue(meta) });
  },
  /**
   * @deprecated Whole-day legacy write (`day.put`): no new callers — use `saveMeal` / `setDayMeta`. Meals in
   * `entry` are stripped by the op schema; on a day with meals the server keeps them (Rule L).
   */
  saveDay(date: ISODate, entry: DayEntry): boolean {
    return commit({ kind: 'day.put', date, value: entry });
  },
  /**
   * @deprecated Legacy `day.delete`: on a day with meals it keeps the meals and clears only the workout mark,
   * types and notes. No new callers.
   */
  deleteDay(date: ISODate): boolean {
    return commit({ kind: 'day.delete', date });
  },
  /** `null` removes the weigh-in for that date. */
  setWeight(date: ISODate, kg: number | null): boolean {
    return commit(kg == null ? { kind: 'weight.delete', date } : { kind: 'weight.put', date, kg });
  },
  /** `null` (or all three values empty) removes the measurements for that date. */
  setMeasure(date: ISODate, m: MeasureValues | null): boolean {
    return commit(
      m == null || (m.chest == null && m.waist == null && m.hips == null)
        ? { kind: 'measure.delete', date }
        : { kind: 'measure.put', date, value: m },
    );
  },
  updateSettings(update: (s: Settings) => Settings): boolean {
    return commit({ kind: 'settings.put', value: update(getAppData().settings) });
  },
  /**
   * Replaces everything (backup restore): flushes pending changes, uploads the backup,
   * then swaps the local copy. Resolves once the server accepted it; throws `ApiError`
   * (`bad_request` for a file that is not a valid backup, `network`, …) otherwise.
   */
  async importAll(data: AppData): Promise<void> {
    await importAll(data);
  },
};
