import type { HM, ISODate, Weekday } from './types';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar date of a `Date`. */
export const iso = (d: Date): ISODate => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Local midnight of an ISO date. */
export function parse(s: ISODate): Date {
  const m = ISO_RE.exec(s);
  if (!m) throw new RangeError(`Invalid ISO date: ${s}`);
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

export function isValidISODate(s: string): boolean {
  const m = ISO_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(y, mo - 1, d);
  return dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d;
}

export const isValidHM = (s: string): boolean => HM_RE.test(s);

/** Calendar arithmetic (DST-safe because it goes through local `Date#setDate`). */
export function addDays(s: ISODate, n: number): ISODate {
  const d = parse(s);
  d.setDate(d.getDate() + n);
  return iso(d);
}

export const todayISO = (now: Date = new Date()): ISODate => iso(now);

export const weekdayOf = (s: ISODate): Weekday => parse(s).getDay() as Weekday;

/** Whole days from `a` to `b` (positive when `b` is later). */
export function diffDays(a: ISODate, b: ISODate): number {
  const ua = Date.UTC(...ymd(a));
  const ub = Date.UTC(...ymd(b));
  return Math.round((ub - ua) / 86_400_000);
}

function ymd(s: ISODate): [number, number, number] {
  const d = parse(s);
  return [d.getFullYear(), d.getMonth(), d.getDate()];
}

/** Monday of the week containing `s` (weeks start on Monday, as in Ukraine). */
export const mondayOf = (s: ISODate): ISODate => addDays(s, -((weekdayOf(s) + 6) % 7));

export const minutesOf = (hm: HM): number => {
  const m = HM_RE.exec(hm);
  if (!m) throw new RangeError(`Invalid time: ${hm}`);
  return Number(m[1]) * 60 + Number(m[2]);
};

export interface ZonedNow {
  date: ISODate;
  hm: HM;
  weekday: Weekday;
  /** Minutes since local midnight. */
  minutes: number;
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock date and time in an IANA zone (used by the server to fire reminders). */
export function zonedNow(timeZone: string, now: Date = new Date()): ZonedNow {
  let fmt = zonedFormatters.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    zonedFormatters.set(timeZone, fmt);
  }
  const parts: Record<string, string> = {};
  for (const p of fmt.formatToParts(now)) parts[p.type] = p.value;
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const hm = `${parts.hour}:${parts.minute}`;
  return { date, hm, weekday: weekdayOf(date), minutes: minutesOf(hm) };
}

export function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}
