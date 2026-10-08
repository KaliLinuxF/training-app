import { ok, type AppData, type DayEntry, type ISODate, type MeasureKey } from '@legko/shared';

/** A dated numeric reading (a weigh-in or one body measurement). */
export interface DatedValue {
  date: ISODate;
  value: number;
}

/** A day record together with its date. */
export interface DatedDay {
  date: ISODate;
  entry: DayEntry;
}

/** What a series / change can be computed for: body weight or one measurement. */
export type Metric = 'kg' | MeasureKey;

const compareDates = <T extends { date: ISODate }>(a: T, b: T): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/**
 * `AppData` keeps weights/measures sorted by date, but imported backups are not re-sorted by
 * the schema, so we guard cheaply: the array is returned as is when already sorted.
 */
export function byDateAsc<T extends { date: ISODate }>(items: readonly T[]): readonly T[] {
  for (let i = 1; i < items.length; i++) {
    const prev = items[i - 1];
    const cur = items[i];
    if (prev && cur && prev.date > cur.date) return [...items].sort(compareDates);
  }
  return items;
}

/** All day keys, oldest first (ISO dates sort lexicographically = chronologically). */
export const sortedDayKeys = (data: AppData): ISODate[] => Object.keys(data.days).sort();

/** Day records with `from <= date <= to`, oldest first. */
export function daysInRange(data: AppData, from: ISODate, to: ISODate): DatedDay[] {
  const out: DatedDay[] = [];
  for (const date of sortedDayKeys(data)) {
    const entry = data.days[date];
    if (entry && date >= from && date <= to) out.push({ date, entry });
  }
  return out;
}

/** Calories of a day, or `null` when the day or its kcal is missing. */
export function kcalOn(data: AppData, date: ISODate): number | null {
  const kcal = data.days[date]?.kcal;
  return ok(kcal) ? kcal : null;
}

/** Arithmetic mean, `null` for an empty list. */
export function mean(values: readonly number[]): number | null {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Valid readings of one metric, oldest first. */
export function readings(data: AppData, metric: Metric): DatedValue[] {
  const out: DatedValue[] = [];
  if (metric === 'kg') {
    for (const w of byDateAsc(data.weights)) if (ok(w.kg)) out.push({ date: w.date, value: w.kg });
  } else {
    for (const m of byDateAsc(data.measures)) {
      const v = m[metric];
      if (ok(v)) out.push({ date: m.date, value: v });
    }
  }
  return out;
}
