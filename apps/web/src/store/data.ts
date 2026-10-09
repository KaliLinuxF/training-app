/**
 * App data store — the single source of truth the screens read from.
 *
 * Contract (keep these exports stable, screens depend on them):
 * - `useAppData()` / `useSettings()` / `useSyncState()` — React hooks.
 * - `dataActions.*` — every change goes through here: it is applied optimistically,
 *   persisted on the device (IndexedDB) and queued for the server (works offline).
 * - `startSync()` — called by `AuthGate` after login; loads the device cache, then the server
 *   copy, and keeps flushing the queue. Returns a cleanup function.
 * - `flushNow()`, `resetLocal()`, `onUnauthorized()`, `hasDeviceCache()`, `clearSyncError()` —
 *   used by the auth layer and settings screens.
 *
 * Implementation: `state.ts` (zustand), `cache.ts` (IndexedDB), `sync.ts` (outbox + server).
 */
import type { AppData, DayEntry, ISODate, MeasureValues, Op, Settings } from '@legko/shared';
import { useDataStore, type SyncState } from './state';
import { commitOps, importAll } from './sync';

export { useDataStore, type DataStore, type SyncState } from './state';
export { clearSyncError, flushNow, hasDeviceCache, onUnauthorized, resetLocal, startSync } from './sync';

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

export const dataActions = {
  /** Saves the whole day; an empty entry deletes the day. */
  saveDay(date: ISODate, entry: DayEntry): boolean {
    return commit({ kind: 'day.put', date, value: entry });
  },
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
