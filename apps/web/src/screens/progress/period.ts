import { useCallback, useState } from 'react';
import { isPeriod, type Period } from '@/lib/stats';

/** sessionStorage key of the selected summary period (kept while the app stays open). */
export const PERIOD_STORAGE_KEY = 'legko.period';
export const DEFAULT_PERIOD: Period = 'week';

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

/** Selected period of the «Мій прогрес» screen, remembered for the session. */
export function usePeriod(): [Period, (period: Period) => void] {
  const [period, setPeriod] = useState<Period>(readStoredPeriod);
  const change = useCallback((next: Period) => {
    setPeriod(next);
    storePeriod(next);
  }, []);
  return [period, change];
}
