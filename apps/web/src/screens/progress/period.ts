import { useCallback, useEffect, useState } from 'react';
import { useSearchParams } from 'wouter';
import { isPeriod, type Period } from '@/lib/stats';

/** sessionStorage key of the selected summary period (kept while the app stays open). */
export const PERIOD_STORAGE_KEY = 'legko.period';
export const DEFAULT_PERIOD: Period = 'week';
/** `/progress?period=week|month|q|all` (Home week row, bookmarks): selects and stores the period. */
export const PERIOD_PARAM = 'period';

/** The remembered period; storage can be missing or throw (private mode, blocked site data). */
export function readStoredPeriod(): Period {
  try {
    const value = window.sessionStorage.getItem(PERIOD_STORAGE_KEY);
    return isPeriod(value) ? value : DEFAULT_PERIOD;
  } catch {
    return DEFAULT_PERIOD;
  }
}

export function storePeriod(period: Period): void {
  try {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, period);
  } catch {
    // Not remembering the choice is fine.
  }
}

/**
 * Selected period of the «Мій прогрес» screen, remembered for the session. A valid `?period=` wins over the
 * remembered one and is remembered itself; the parameter (valid or not) is then removed from the URL with
 * `replace`, so a reload or «back» does not re-apply it over a later choice.
 */
export function usePeriod(): [Period, (period: Period) => void] {
  const [params, setParams] = useSearchParams();
  const raw = params.get(PERIOD_PARAM);
  const linked = isPeriod(raw) ? raw : null;
  const [period, setPeriod] = useState<Period>(() => linked ?? readStoredPeriod());

  // A link followed while the screen is open (`?period=` again) also wins: derived-state reset during render.
  const [adopted, setAdopted] = useState<Period | null>(linked);
  if (linked !== adopted) {
    setAdopted(linked);
    if (linked) setPeriod(linked);
  }

  useEffect(() => {
    if (raw === null) return;
    if (isPeriod(raw)) storePeriod(raw);
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.delete(PERIOD_PARAM);
        return next;
      },
      // Keep the entry's state (the `legkoFrom` stamp of the link that opened it).
      { replace: true, state: window.history.state as unknown },
    );
  }, [raw, setParams]);

  const change = useCallback((next: Period) => {
    setPeriod(next);
    storePeriod(next);
  }, []);
  return [period, change];
}
