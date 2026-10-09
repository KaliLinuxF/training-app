import type { AppData, ISODate, MeasureKey } from '@legko/shared';
import { useCallback, useMemo, useState } from 'react';
import type { Period } from '@/lib/stats';
import { buildProgressModel, HISTORY_PAGE, type ProgressModel } from './model';
import { usePeriod } from './period';

export interface ProgressController {
  model: ProgressModel;
  period: Period;
  setPeriod: (period: Period) => void;
  setMeasure: (key: MeasureKey) => void;
  showMoreHistory: () => void;
}

/** Screen state (period, chart parameter, history length) + the derived view model. */
export function useProgressModel(data: AppData, today: ISODate): ProgressController {
  const [period, setPeriod] = usePeriod();
  const [measure, setMeasure] = useState<MeasureKey>('waist');
  const [historyLimit, setHistoryLimit] = useState(HISTORY_PAGE);
  const model = useMemo(
    () => buildProgressModel(data, today, { period, measure, historyLimit }),
    [data, today, period, measure, historyLimit],
  );
  const showMoreHistory = useCallback(() => setHistoryLimit((n) => n + HISTORY_PAGE), []);
  return { model, period, setPeriod, setMeasure, showMoreHistory };
}
