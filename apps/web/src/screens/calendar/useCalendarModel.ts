import type { ISODate } from '@legko/shared';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'wouter';
import { useToday } from '@/lib/useToday';
import { useAppData } from '@/store/data';
import {
  buildDayDetail,
  buildHistory,
  buildMonth,
  HISTORY_PAGE,
  resolveSelected,
  stepMonth,
  type DayDetail,
  type HistoryModel,
  type MonthModel,
} from './model';

export interface CalendarModel {
  /** Selected day (`?date=`, today by default); the shown month is the month that contains it. */
  selected: ISODate;
  month: MonthModel;
  detail: DayDetail;
  history: HistoryModel;
  select: (date: ISODate) => void;
  /** Moves the calendar by a month (no-op past the current month). */
  step: (delta: -1 | 1) => void;
  /** «Останні записи» row: select that day and bring the calendar back into view. */
  openFromHistory: (date: ISODate) => void;
  showMore: () => void;
}

function scrollToTop(): void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

export function useCalendarModel(): CalendarModel {
  const data = useAppData();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const selected = resolveSelected(params.get('date'), today);
  const [limit, setLimit] = useState(HISTORY_PAGE);

  const month = useMemo(() => buildMonth(data, selected, today), [data, selected, today]);
  const detail = useMemo(() => buildDayDetail(data, selected, today), [data, selected, today]);
  const history = useMemo(() => buildHistory(data, limit), [data, limit]);

  // `replace`: picking days must not flood the back stack.
  const select = (date: ISODate) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        next.set('date', date);
        return next;
      },
      { replace: true },
    );

  return {
    selected,
    month,
    detail,
    history,
    select,
    step: (delta) => {
      const next = stepMonth(selected, delta, today);
      if (next) select(next);
    },
    openFromHistory: (date) => {
      select(date);
      scrollToTop();
    },
    showMore: () => setLimit((n) => n + HISTORY_PAGE),
  };
}
