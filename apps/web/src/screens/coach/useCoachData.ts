/**
 * Loading the coach data (docs/coach-cabinet.md §5.3, C8): component state only — never IndexedDB, local / session
 * storage, the app store or the outbox, so another person's records never outlive the page.
 *
 * Fetched on mount, again when the device date changes (a new window) and when the page comes back to the
 * foreground with a copy older than `STALE_MS`. Only the newest request may write its answer. A failed refresh keeps
 * the copy on screen. A 403 means the role changed elsewhere: the account is asked again
 * (`authActions.refreshUser`) and the screen leaves.
 */
import {
  coachWindow,
  iso,
  withDataDefaults,
  type AppData,
  type CoachClientResponse,
  type CoachClientsResponse,
} from '@legko/shared';
import { useCallback, useEffect, useRef, useState } from 'react';
import { authActions } from '@/auth/auth';
import { api, ApiError } from '@/lib/api';

export type Load<T> =
  | { status: 'loading' }
  | { status: 'ready'; value: T; at: number }
  | { status: 'error'; offline: boolean }
  | { status: 'notFound' }
  | { status: 'forbidden' };

export interface Loader<T> {
  state: Load<T>;
  /** «Спробувати ще раз»: shows «Завантажую…» and asks again. */
  reload: () => void;
}

/** A foreground return reloads a copy older than this. */
export const STALE_MS = 2 * 60_000;
/** `useNow` ticks this often. */
export const NOW_TICK_MS = 60_000;

const LOADING = { status: 'loading' } as const;

const isOffline = (err: unknown): boolean =>
  (err instanceof ApiError && err.code === 'network') ||
  (typeof navigator !== 'undefined' && navigator.onLine === false);

/**
 * The current instant, re-read every minute and whenever the page regains focus or becomes visible (the client's
 * «today» and «last 7 days» follow the clock while the page stays open).
 */
export function useNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const tick = () => setNow(new Date());
    const timer = window.setInterval(tick, NOW_TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    window.addEventListener('focus', tick);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', tick);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);
  return now;
}

/**
 * Shared loader. `identity` names what is loaded (another one shows «Завантажую…» at once); a change of `refresh`
 * asks again in the background.
 */
function useLoad<T>(fetcher: () => Promise<T>, identity: string, refresh: string): Loader<T> {
  const [entry, setEntry] = useState<{ key: string; load: Load<T> }>({ key: identity, load: LOADING });
  const seq = useRef(0);
  const at = useRef(0);

  const run = useCallback(
    (key: string) => {
      const mine = ++seq.current;
      fetcher().then(
        (value) => {
          if (mine !== seq.current) return;
          at.current = Date.now();
          setEntry({ key, load: { status: 'ready', value, at: at.current } });
        },
        (err: unknown) => {
          if (mine !== seq.current) return;
          if (err instanceof ApiError && err.code === 'forbidden') {
            void authActions.refreshUser().finally(() => {
              if (mine === seq.current) setEntry({ key, load: { status: 'forbidden' } });
            });
            return;
          }
          if (err instanceof ApiError && err.code === 'not_found') {
            setEntry({ key, load: { status: 'notFound' } });
            return;
          }
          const failed: Load<T> = { status: 'error', offline: isOffline(err) };
          // A failed refresh keeps the copy on screen.
          setEntry((prev) => (prev.key === key && prev.load.status === 'ready' ? prev : { key, load: failed }));
        },
      );
    },
    [fetcher],
  );

  useEffect(() => {
    const requests = seq;
    run(identity);
    return () => {
      // The answer of a request for an unmounted page (or for the previous identity / date) is dropped.
      requests.current++;
    };
  }, [run, identity, refresh]);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      if (at.current > 0 && Date.now() - at.current >= STALE_MS) run(identity);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [run, identity]);

  const reload = useCallback(() => {
    setEntry({ key: identity, load: LOADING });
    run(identity);
  }, [run, identity]);

  return { state: entry.key === identity ? entry.load : LOADING, reload };
}

/** `GET /api/coach/clients` for the window of the device's today (`coachWindow(new Date())`). */
export function useCoachClients(): Loader<CoachClientsResponse> {
  const date = iso(useNow());
  const fetcher = useCallback(() => api.coach.clients(coachWindow(new Date())), []);
  return useLoad(fetcher, 'clients', date);
}

/**
 * The detail answer with the newer data keys filled in (shared `withDataDefaults`): the response is not zod-parsed,
 * and a server from before schema v5 sends no exercises / workouts / sessions / steps and no `settings.stepsGoal`.
 */
export const withClientDefaults = (response: CoachClientResponse): CoachClientResponse => ({
  ...response,
  data: withDataDefaults(response.data as Partial<AppData>),
});

/** `GET /api/coach/clients/:id`. */
export function useCoachClient(id: string): Loader<CoachClientResponse> {
  const date = iso(useNow());
  const fetcher = useCallback(() => api.coach.client(id).then(withClientDefaults), [id]);
  return useLoad(fetcher, id, date);
}
