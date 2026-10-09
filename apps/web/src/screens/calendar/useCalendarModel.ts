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
  monthOf,
  resolveSelected,
  stepMonth,
  type DayDetail,
  type HistoryModel,
  type MonthKey,
  type MonthModel,
} from './model';

export interface CalendarModel {
  /** Selected day (`?date=`, today by default): drives the day card. */
  selected: ISODate;
  /** The shown month: starts at the selected day's month, ‹ › move it without touching the selection. */
  month: MonthModel;
  detail: DayDetail;
  history: HistoryModel;
  select: (date: ISODate) => void;
  /** Shows the previous / next month (no-op past the current month); the selection stays. */
  step: (delta: -1 | 1) => void;
  /** «Останні записи» row: select that day, show its month and bring the calendar back into view. */
  openFromHistory: (date: ISODate) => void;
  showMore: () => void;
}

function scrollToTop(): void {
  const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;
  window.scrollTo({ top: 0, behavior: reduce ? 'auto' : 'smooth' });
}

/**
 * The month on screen (prototype `calY` / `calM`). It jumps to the selected day's month whenever the
 * selection changes — a day tap, a history row, a `?date=` link, today rolling over at midnight —
 * and otherwise only moves with ‹ ›.
 */
function useShownMonth(selected: ISODate): [MonthKey, (month: MonthKey) => void] {
  const [view, setView] = useState(() => ({ anchor: selected, month: monthOf(selected) }));
  if (view.anchor !== selected) {
    // Derived-state reset during render (React re-renders right away, before painting).
    const next = { anchor: selected, month: monthOf(selected) };
    setView(next);
    return [next.month, (month) => setView({ anchor: selected, month })];
  }
  return [view.month, (month) => setView({ anchor: selected, month })];
}

export function useCalendarModel(): CalendarModel {
  const data = useAppData();
  const today = useToday();
  const [params, setParams] = useSearchParams();
  const selected = resolveSelected(params.get('date'), today);
  const [shown, setShown] = useShownMonth(selected);
  const [limit, setLimit] = useState(HISTORY_PAGE);

  const month = useMemo(() => buildMonth(data, shown, selected, today), [data, shown, selected, today]);
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
      const next = stepMonth(shown, delta, today);
      if (next) setShown(next);
    },
    openFromHistory: (date) => {
      select(date);
      // Also when `date` is already selected but she has browsed to another month.
      setShown(monthOf(date));
      scrollToTop();
    },
    showMore: () => setLimit((n) => n + HISTORY_PAGE),
  };
}
