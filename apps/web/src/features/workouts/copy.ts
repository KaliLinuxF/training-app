/**
 * Small Ukrainian text helpers of the workouts screens (docs/workouts-steps-rebrand.md §3.5–§3.12).
 */
import { DOW_SHORT, WEEK_ORDER, type Weekday } from '@legko/shared';

/** 1 вправа, 2 вправи, 5 вправ (Ukrainian plural by the last digits). */
export function plural(n: number, one: string, few: string, many: string): string {
  const abs = Math.abs(Math.trunc(n));
  const d10 = abs % 10;
  const d100 = abs % 100;
  if (d10 === 1 && d100 !== 11) return one;
  if (d10 >= 2 && d10 <= 4 && (d100 < 12 || d100 > 14)) return few;
  return many;
}

export const countText = (n: number, one: string, few: string, many: string): string =>
  `${n} ${plural(n, one, few, many)}`;

export const exercisesText = (n: number): string => countText(n, 'вправа', 'вправи', 'вправ');
export const setsText = (n: number): string => countText(n, 'підхід', 'підходи', 'підходів');
export const recordsText = (n: number): string => countText(n, 'запис', 'записи', 'записів');

/** «Пн, Ср» in Monday-first order; '' without days. */
export const weekdaysText = (days: readonly Weekday[]): string =>
  WEEK_ORDER.filter((d) => days.includes(d))
    .map((d) => DOW_SHORT[d])
    .join(', ');

/** Seconds as a clock: 90 → «1:30», 5 → «0:05», 3725 → «62:05». */
export function clockText(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

/** Elapsed time of a live session: «23:41», «1:05:09» past an hour. */
export function elapsedText(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  if (h === 0) return clockText(sec);
  const m = Math.floor((sec % 3600) / 60);
  return `${h}:${String(m).padStart(2, '0')}:${String(sec % 60).padStart(2, '0')}`;
}

const NBSP_RE = new RegExp(String.fromCharCode(0xa0), 'g');

/** No-break spaces read as ordinary spaces (accessible names, plain-text comparisons). */
export const spoken = (text: string): string => text.replace(NBSP_RE, ' ');
