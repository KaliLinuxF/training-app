/**
 * Dates of «Акаунт» and «Користувачі» (docs/multi-user.md §9.5, §9.6): server timestamps (ms) shown in this device's
 * time zone with the `@legko/shared` format helpers. The server clock may be ahead of the device: a timestamp later
 * than «now» is shown as its own date (never «завтра», never a negative count), and «сьогодні» only for today.
 */
import { addDays, dLong, dLongYear, iso, pad, todayISO } from '@legko/shared';

/** «9 жовтня 2026». */
export function longDate(ms: number): string {
  return dLongYear(iso(new Date(ms)));
}

/** «28 жовтня». */
export function shortDate(ms: number): string {
  return dLong(iso(new Date(ms)));
}

/** «14:05». */
export function clockTime(ms: number): string {
  const d = new Date(ms);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «28 жовтня, 14:05» (when a one-time link stops working). */
export function untilDateTime(ms: number): string {
  return `${shortDate(ms)}, ${clockTime(ms)}`;
}

/** «21 жовтня» in the year of `now`, «21 жовтня 2025» in any other year. */
export function calendarDate(ms: number, now: number = Date.now()): string {
  return new Date(ms).getFullYear() === new Date(now).getFullYear() ? shortDate(ms) : longDate(ms);
}

/**
 * The day of `ms` relative to `now`: «сьогодні», «вчора», otherwise `calendarDate` («21 жовтня», «21 жовтня 2025»).
 * A day after today (server clock ahead) is its date too.
 */
export function dayWord(ms: number, now: number = Date.now()): string {
  const day = iso(new Date(ms));
  const today = todayISO(new Date(now));
  if (day === today) return 'сьогодні';
  if (day === addDays(today, -1)) return 'вчора';
  return calendarDate(ms, now);
}

/** «сьогодні, 09:12», «вчора, 18:40», «21 жовтня, 09:12». */
export function dayTime(ms: number, now: number = Date.now()): string {
  return `${dayWord(ms, now)}, ${clockTime(ms)}`;
}
