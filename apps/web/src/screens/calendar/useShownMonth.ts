import type { ISODate } from '@legko/shared';
import { useState } from 'react';
import { monthOf, type MonthKey } from './model';

/**
 * The month on screen (prototype `calY` / `calM`). It jumps to the selected day's month whenever the
 * selection changes — a day tap, «Сьогодні», a `?date=` link, today rolling over at midnight —
 * and otherwise only moves with ‹ ›.
 *
 * Store-free on purpose (React + the calendar model only): the calendar screen and the coach's read-only view of a
 * client's month share it, and the coach pages must not pull in the client's own data store.
 */
export function useShownMonth(selected: ISODate): [MonthKey, (month: MonthKey) => void] {
  const [view, setView] = useState(() => ({ anchor: selected, month: monthOf(selected) }));
  if (view.anchor !== selected) {
    // Derived-state reset during render (React re-renders right away, before painting).
    const next = { anchor: selected, month: monthOf(selected) };
    setView(next);
    return [next.month, (month) => setView({ anchor: selected, month })];
  }
  return [view.month, (month) => setView({ anchor: selected, month })];
}
