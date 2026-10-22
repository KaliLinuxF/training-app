import type { AppData, ISODate, MeasureKey } from '@legko/shared';
import { useCallback, useMemo, useState } from 'react';
import type { Period } from '@/lib/stats';
import {
  buildProgressModel,
  HISTORY_FIRST,
  HISTORY_PAGE,
  type ProgressAudience,
  type ProgressModel,
} from './model';

export interface ProgressController {
  model: ProgressModel;
  setMeasure: (key: MeasureKey) => void;
  showMoreHistory: () => void;
}

export interface ProgressModelOptions {
  /** 'coach': third-person empty-chart hints. Default 'self'. */
  audience?: ProgressAudience;
  /** Where an «Історія калорій» row leads. Default her calendar (`calendarDayHref`). */
  dayHref?: (date: ISODate) => string;
}

/**
 * Screen state (chart parameter, history length) + the derived view model for a period owned by the caller
 * (`usePeriod()` on her own screen, the coach page's own selector). Pass a stable `dayHref` (module function or
 * memoized), or the model is rebuilt on every render.
 */
export function useProgressModel(
  data: AppData,
  today: ISODate,
  period: Period,
  opts: ProgressModelOptions = {},
): ProgressController {
  const { audience, dayHref } = opts;
  const [measure, setMeasure] = useState<MeasureKey>('waist');
  const [historyLimit, setHistoryLimit] = useState(HISTORY_FIRST);
  const model = useMemo(
    () => buildProgressModel(data, today, { period, measure, historyLimit, audience, dayHref }),
    [data, today, period, measure, historyLimit, audience, dayHref],
  );
  const showMoreHistory = useCallback(() => setHistoryLimit((n) => n + HISTORY_PAGE), []);
  return { model, setMeasure, showMoreHistory };
}
