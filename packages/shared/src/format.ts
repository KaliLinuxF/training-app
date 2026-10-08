import { parse, pad } from './dates';
import type { ISODate } from './types';

/** Genitive month names: «10 жовтня». */
export const MONTHS_GEN = [
  'січня',
  'лютого',
  'березня',
  'квітня',
  'травня',
  'червня',
  'липня',
  'серпня',
  'вересня',
  'жовтня',
  'листопада',
  'грудня',
] as const;

/** Nominative month names: «Жовтень 2026». */
export const MONTHS_NOM = [
  'Січень',
  'Лютий',
  'Березень',
  'Квітень',
  'Травень',
  'Червень',
  'Липень',
  'Серпень',
  'Вересень',
  'Жовтень',
  'Листопад',
  'Грудень',
] as const;

export const MONTHS_SHORT = [
  'січ',
  'лют',
  'бер',
  'кві',
  'тра',
  'чер',
  'лип',
  'сер',
  'вер',
  'жов',
  'лис',
  'гру',
] as const;

/** Indexed by `Date#getDay()`. */
export const DOW_SHORT = ['Нд', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;
export const DOW_LONG = ['неділя', 'понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота'] as const;
/** Monday-first order of weekday numbers, for pickers and calendar headers. */
export const WEEK_ORDER = [1, 2, 3, 4, 5, 6, 0] as const;

/** Typographic minus used for negative deltas («−0,4 кг»). */
export const MINUS = '−';

export const ok = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** One decimal, comma separator: 65.4 → «65,4». Missing → «—». */
export const f1 = (n: number | null | undefined): string =>
  ok(n) ? (Math.round(n * 10) / 10).toFixed(1).replace('.', ',') : '—';

/** Up to one decimal, integers without «,0»: 70 → «70», 70.5 → «70,5». */
export function fN(n: number | null | undefined): string {
  if (!ok(n)) return '—';
  const r = Math.round(n * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1).replace('.', ',');
}

/** Integer with Ukrainian digit grouping: 1650 → «1 650». */
export const f0 = (n: number | null | undefined): string =>
  ok(n) ? Math.round(n).toLocaleString('uk-UA') : '—';

/** Signed value: «+0,4», «−1», «0». Values within ±0.04 are shown without a sign. */
export function sgn(n: number | null | undefined, f: (x: number) => string = fN): string {
  if (!ok(n)) return '—';
  const sign = n > 0.04 ? '+' : n < -0.04 ? MINUS : '';
  return sign + f(Math.abs(n));
}

/** «10 жовтня» */
export function dLong(s: ISODate): string {
  const d = parse(s);
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}`;
}

/** «10 жовтня 2026» */
export const dLongYear = (s: ISODate): string => `${dLong(s)} ${parse(s).getFullYear()}`;

/** «10.10» */
export function dShort(s: ISODate): string {
  const d = parse(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

/** «10.10.2026» */
export function dNumeric(s: ISODate): string {
  const d = parse(s);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** «Субота, 10 жовтня» */
export function dWeekdayLong(s: ISODate): string {
  const w = DOW_LONG[parse(s).getDay()]!;
  return `${w[0]!.toUpperCase()}${w.slice(1)}, ${dLong(s)}`;
}

/** Parses user input that may use a comma as decimal separator. Empty/invalid → null. */
export function num(v: string | number | null | undefined): number | null {
  if (v === '' || v == null) return null;
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(',', '.').trim());
  return Number.isFinite(n) ? n : null;
}

/** Number → input string with a comma: 65.4 → «65,4», null → «». */
export const str = (v: number | null | undefined): string => (v == null ? '' : String(v).replace('.', ','));
