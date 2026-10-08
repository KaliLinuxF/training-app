/**
 * The zustand store behind `store/data.ts`. Kept in its own module so the sync engine
 * and the public facade can both import it without a circular dependency.
 */
import { emptyData, type AppData } from '@legko/shared';
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

export interface DataStore {
  data: AppData;
  sync: SyncState;
}

export function initialSyncState(): SyncState {
  return {
    loaded: false,
    pending: 0,
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    syncing: false,
    lastSyncedAt: null,
    error: null,
  };
}

export const useDataStore = create<DataStore>(() => ({
  data: emptyData(),
  sync: initialSyncState(),
}));

/** Merges a partial sync state; skips the update (and re-renders) when nothing changes. */
export function patchSync(patch: Partial<SyncState>): void {
  const current = useDataStore.getState().sync;
  const changed = (Object.keys(patch) as (keyof SyncState)[]).some((k) => patch[k] !== current[k]);
  if (changed) useDataStore.setState({ sync: { ...current, ...patch } });
}
