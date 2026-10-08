/**
 * App data store — the single source of truth the screens read from.
 *
 * Contract (keep these exports stable, screens depend on them):
 * - `useAppData()` / `useSettings()` / `useSyncState()` — React hooks.
 * - `dataActions.*` — every change goes through here: it is applied optimistically,
 *   persisted on the device and queued for the server (works offline).
 * - `startSync()` — called once after login; loads the device cache, then the server copy,
 *   and keeps flushing the queue. Returns a cleanup function.
 *
 * NOTE: this is the Phase-0 in-memory implementation; persistence + outbox + server sync
 * are filled in by the data-layer task without changing the exported API.
 */
import {
  applyOp,
  emptyData,
  type AppData,
  type DayEntry,
  type ISODate,
  type MeasureValues,
  type Op,
  type Settings,
} from '@legko/shared';
import { create } from 'zustand';

export interface SyncState {
  /** Device cache or server data has been loaded at least once. */
  loaded: boolean;
  /** Ops waiting to reach the server. */
  pending: number;
  online: boolean;
  syncing: boolean;
  lastSyncedAt: number | null;
  /** Last non-network sync problem, human readable (Ukrainian). */
  error: string | null;
}

interface DataStore {
  data: AppData;
  sync: SyncState;
}

export const useDataStore = create<DataStore>(() => ({
  data: emptyData(),
  sync: {
    loaded: true,
    pending: 0,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncing: false,
    lastSyncedAt: null,
    error: null,
  },
}));

export const useAppData = (): AppData => useDataStore((s) => s.data);
export const useSettings = (): Settings => useDataStore((s) => s.data.settings);
export const useSyncState = (): SyncState => useDataStore((s) => s.sync);
export const getAppData = (): AppData => useDataStore.getState().data;

/** Applies ops locally right away and queues them for the server. */
export function commit(...ops: Op[]): void {
  useDataStore.setState((s) => ({ data: ops.reduce(applyOp, s.data) }));
}

export const dataActions = {
  /** Saves the whole day; an empty entry deletes the day. */
  saveDay(date: ISODate, entry: DayEntry): void {
    commit({ kind: 'day.put', date, value: entry });
  },
  deleteDay(date: ISODate): void {
    commit({ kind: 'day.delete', date });
  },
  /** `null` removes the weigh-in for that date. */
  setWeight(date: ISODate, kg: number | null): void {
    commit(kg == null ? { kind: 'weight.delete', date } : { kind: 'weight.put', date, kg });
  },
  /** `null` (or all three values empty) removes the measurements for that date. */
  setMeasure(date: ISODate, m: MeasureValues | null): void {
    commit(
      m == null || (m.chest == null && m.waist == null && m.hips == null)
        ? { kind: 'measure.delete', date }
        : { kind: 'measure.put', date, value: m },
    );
  },
  updateSettings(update: (s: Settings) => Settings): void {
    commit({ kind: 'settings.put', value: update(getAppData().settings) });
  },
  /** Replaces everything (backup restore). Resolves once the server accepted it. */
  async importAll(data: AppData): Promise<void> {
    useDataStore.setState({ data });
  },
};

export function startSync(): () => void {
  return () => {};
}
