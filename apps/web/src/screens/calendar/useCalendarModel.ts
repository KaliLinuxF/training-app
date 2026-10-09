import type { ISODate } from '@legko/shared';
import { useMemo, useState } from 'react';
import { useSearchParams } from 'wouter';
import { useToday } from '@/lib/useToday';
import { useAppData } from '@/store/data';
import { setTrainedMark } from '@/store/dayMarks';
import { ui, type SheetMode } from '@/store/ui';
import {
  buildDayDetail,
  buildMonth,
  monthOf,
  resolveSelected,
  showTodayShortcut,
  stepMonth,
  type DayDetail,
  type MonthKey,
  type MonthModel,
} from './model';

export interface CalendarModel {
  /** Selected day (`?date=`, today by default): drives the day card. Never a future day. */
  selected: ISODate;
  /** The shown month: starts at the selected day's month, ‹ › move it without touching the selection. */
  month: MonthModel;
  detail: DayDetail;
  /** The header «Сьогодні» shortcut: another day is selected or another month is shown. */
  showToday: boolean;
  /**
   * Bumped by every day-cell tap (only then): the day card scrolls itself into view. Not on load with `?date=`,
   * not on ‹ › / a swipe, not on «Сьогодні».
   */
  revealTick: number;
  /** A day cell was tapped: select that day (replaced URL) and reveal its card. */
  select: (date: ISODate) => void;
  /** Shows the previous / next month (no-op past the current month); the selection stays. */
  step: (delta: -1 | 1) => void;
  /** «Сьогодні»: drops `?date=` (replaced URL) and shows today's month. */
  goToday: () => void;
  /** A day row: opens its sheet for the selected day. */
  open: (mode: SheetMode) => void;
  /** The inline ✓ / ✕ of the Тренування row: saves the mark for the selected day (toast, no sheet). */
  setTrained: (trained: boolean) => void;
}

/**
 * The month on screen (prototype `calY` / `calM`). It jumps to the selected day's month whenever the
 * selection changes — a day tap, «Сьогодні», a `?date=` link, today rolling over at midnight —
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
  const [revealTick, setRevealTick] = useState(0);

  const month = useMemo(() => buildMonth(data, shown, selected, today), [data, shown, selected, today]);
  const detail = useMemo(() => buildDayDetail(data, selected, today), [data, selected, today]);

  // `replace`: picking days must not flood the back stack.
  const setDateParam = (date: ISODate | null) =>
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (date) next.set('date', date);
        else next.delete('date');
        return next;
      },
      { replace: true },
    );

  return {
    selected,
    month,
    detail,
    showToday: showTodayShortcut(selected, shown, today),
    revealTick,
    select: (date) => {
      setDateParam(date);
      setRevealTick((n) => n + 1);
    },
    step: (delta) => {
      const next = stepMonth(shown, delta, today);
      if (next) setShown(next);
    },
    goToday: () => {
      setDateParam(null);
      // Also when today is already selected but she has browsed to another month.
      setShown(monthOf(today));
    },
    open: (mode) => ui.openSheet(selected, mode),
    // `resolveSelected` never yields a future day, so this marks today or a past day.
    setTrained: (trained) => {
      setTrainedMark(selected, trained);
    },
  };
}
