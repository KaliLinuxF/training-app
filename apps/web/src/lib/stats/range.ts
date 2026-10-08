import { mondayOf, ok, type AppData, type ISODate } from '@legko/shared';
import { daysInRange, mean, readings, type DatedValue, type Metric } from './common';

/**
 * Change of a reading over `[from, to]`: last value in the range − baseline, where the baseline
 * is the last value **before** `from` if there is one, else the first value in the range.
 * `null` when the range has no readings, or a single one and nothing before it.
 * `values` must be sorted by date ascending (see `readings`).
 */
export function valueChange(values: readonly DatedValue[], from: ISODate, to: ISODate): number | null {
  let before: number | null = null;
  let first: number | null = null;
  let last: number | null = null;
  let inRange = 0;
  for (const { date, value } of values) {
    if (date < from) before = value;
    else if (date <= to) {
      first ??= value;
      last = value;
      inRange++;
    }
  }
  if (last === null) return null;
  if (before !== null) return last - before;
  return inRange > 1 && first !== null ? last - first : null;
}

/** Change of one metric over `[from, to]` (see `valueChange`). */
export const metricChange = (data: AppData, metric: Metric, from: ISODate, to: ISODate): number | null =>
  valueChange(readings(data, metric), from, to);

export interface RangeStats {
  /** Number of day records in `[from, to]`. */
  entries: number;
  /** Days marked `trained === true`. */
  trainings: number;
  /** Average kcal over the days that have kcal; `null` if none. */
  avgKcal: number | null;
  /** kg; negative = lost. `null` = not enough data (see `valueChange`). */
  weightChange: number | null;
  /** cm, same rule. */
  chestChange: number | null;
  waistChange: number | null;
  hipsChange: number | null;
}

/** The prototype's `statsFor(from)`: everything recorded between `from` and `today`, inclusive. */
export function rangeStats(data: AppData, from: ISODate, today: ISODate): RangeStats {
  const days = daysInRange(data, from, today);
  const kcal: number[] = [];
  let trainings = 0;
  for (const { entry } of days) {
    if (entry.trained === true) trainings++;
    if (ok(entry.kcal)) kcal.push(entry.kcal);
  }
  return {
    entries: days.length,
    trainings,
    avgKcal: mean(kcal),
    weightChange: metricChange(data, 'kg', from, today),
    chestChange: metricChange(data, 'chest', from, today),
    waistChange: metricChange(data, 'waist', from, today),
    hipsChange: metricChange(data, 'hips', from, today),
  };
}

export interface WeekSummary extends RangeStats {
  /** Workout days planned per week (`settings.rem.workout.days.length`), for «з N». */
  plannedPerWeek: number;
}

/** Home «Цей тиждень» tiles: stats from Monday of the current week to today. */
export function weekSummary(data: AppData, today: ISODate): WeekSummary {
  return {
    ...rangeStats(data, mondayOf(today), today),
    plannedPerWeek: data.settings.rem.workout.days.length,
  };
}

/** Minimum number of points a chart shows; fewer in the period → the last N overall. */
export const MIN_CHART_POINTS = 4;

/**
 * Chart points of a metric from `from` on (no upper bound, as in the prototype).
 * If fewer than 4 fall in the period, the last 4 readings overall are used instead
 * (fewer if there are not that many).
 */
export function seriesInRange(data: AppData, metric: Metric, from: ISODate): DatedValue[] {
  const all = readings(data, metric);
  const inPeriod = all.filter((p) => p.date >= from);
  return inPeriod.length < MIN_CHART_POINTS ? all.slice(-MIN_CHART_POINTS) : inPeriod;
}
