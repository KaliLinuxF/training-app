/**
 * `GET /api/admin/users` for «Користувачі» (docs/multi-user.md §9.6): one shared copy for the page and the list's
 * «N акаунтів» row (on desktop both are on screen at once), fetched on mount and again after every change.
 * Online only (D20): nothing is cached on the device.
 *
 * A 403 `forbidden` from any admin call means the role changed elsewhere: the copy is dropped, the auth layer asks
 * the server again who is signed in (the list loses the row, `/settings/users` redirects) and the page leaves.
 */
import type { AdminOverview } from '@legko/shared';
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { authActions } from '@/auth/auth';
import { api, ApiError } from '@/lib/api';

export type OverviewStatus = 'idle' | 'loading' | 'ready' | 'error';

interface OverviewState {
  /** The admin whose overview this is; another signed-in account never sees it. */
  owner: string | null;
  overview: AdminOverview | null;
  status: OverviewStatus;
  /** The last load failed (an older overview may still be shown). */
  failed: boolean;
  /** Bumped on every 403: a page that sees it grow while mounted leaves. */
  forbidden: number;
}

const INITIAL: OverviewState = { owner: null, overview: null, status: 'idle', failed: false, forbidden: 0 };

export const useOverviewStore = create<OverviewState>(() => INITIAL);

let inFlight: { owner: string; promise: Promise<void> } | null = null;
/** Numbers the loads: only the newest one may write its answer. */
let seq = 0;

export function isForbidden(err: unknown): boolean {
  return err instanceof ApiError && err.code === 'forbidden';
}

/** An admin call answered 403: forget the overview, re-check the account (the role is no longer admin). */
export function noteForbidden(): void {
  seq += 1;
  inFlight = null;
  useOverviewStore.setState((st) => ({
    overview: null,
    status: 'idle',
    failed: false,
    forbidden: st.forbidden + 1,
  }));
  void authActions.refreshUser();
}

/**
 * Loads the overview for `owner` (the signed-in admin's id). A load already running for them is shared unless
 * `fresh` (after a change: an answer sent before it would be stale).
 */
export function loadOverview(owner: string, fresh = false): Promise<void> {
  if (!fresh && inFlight?.owner === owner) return inFlight.promise;
  const mine = ++seq;
  const current = useOverviewStore.getState();
  if (current.owner !== owner) {
    useOverviewStore.setState({ owner, overview: null, status: 'loading', failed: false });
  } else if (current.overview === null) {
    useOverviewStore.setState({ status: 'loading', failed: false });
  }
  const promise = (async () => {
    try {
      const overview = await api.admin.overview();
      if (mine !== seq) return;
      useOverviewStore.setState({ owner, overview, status: 'ready', failed: false });
    } catch (err) {
      if (mine !== seq) return;
      if (isForbidden(err)) {
        noteForbidden();
        return;
      }
      useOverviewStore.setState((st) => ({ status: st.overview ? 'ready' : 'error', failed: true }));
    } finally {
      if (inFlight?.owner === owner && mine === seq) inFlight = null;
    }
  })();
  inFlight = { owner, promise };
  return promise;
}

export interface AdminOverviewView {
  overview: AdminOverview | null;
  status: OverviewStatus;
  failed: boolean;
  /** A 403 arrived while this component was mounted. */
  forbidden: boolean;
  /** Fetches a fresh copy (after a change, «Спробувати ще раз»). */
  reload: () => Promise<void>;
}

/**
 * The overview of `owner` (null = not an admin / not known: nothing is fetched). Fetches on mount; shows the copy
 * already loaded meanwhile.
 */
export function useAdminOverview(owner: string | null): AdminOverviewView {
  const state = useOverviewStore();
  const [forbiddenAtMount] = useState(() => useOverviewStore.getState().forbidden);
  useEffect(() => {
    if (owner !== null) void loadOverview(owner);
  }, [owner]);
  const mine = owner !== null && state.owner === owner;
  return {
    overview: mine ? state.overview : null,
    status: mine ? state.status : owner === null ? 'idle' : 'loading',
    failed: mine && state.failed,
    forbidden: state.forbidden > forbiddenAtMount,
    reload: () => (owner === null ? Promise.resolve() : loadOverview(owner, true)),
  };
}

/** Test helper: forget the overview and any load in flight. */
export function resetAdminOverview(): void {
  seq += 1;
  inFlight = null;
  useOverviewStore.setState(INITIAL);
}
