import { diffDays, mondayOf, type AppData, type ISODate } from '@legko/shared';
import { daysInRange, sortedDayKeys } from './common';
import { earliestDate } from './periods';

export interface WorkoutStats {
  /** Workout days ever recorded. */
  total: number;
  /** Workout days from Monday of this week to today. */
  thisWeek: number;
  /** Workout days in the current calendar month. */
  thisMonth: number;
  /**
   * `total / weeks since the first record` (at least one week), unrounded — format with `fN`.
   * Weeks are counted in whole calendar days / 7, so DST shifts do not skew it.
   */
  avgPerWeek: number;
  /** Workout days planned per week (`settings.rem.workout.days.length`), for «з N». */
  plannedPerWeek: number;
}

/** «Тренування» tiles of the progress screen. */
export function workoutStats(data: AppData, today: ISODate): WorkoutStats {
  const trainedDays = sortedDayKeys(data).filter((d) => data.days[d]?.trained === true);
  const monthKey = today.slice(0, 7);
  const weekStart = mondayOf(today);
  const weeks = Math.max(1, diffDays(earliestDate(data, today), today) / 7);
  return {
    total: trainedDays.length,
    thisWeek: trainedDays.filter((d) => d >= weekStart && d <= today).length,
    thisMonth: trainedDays.filter((d) => d.startsWith(monthKey)).length,
    avgPerWeek: trainedDays.length / weeks,
    plannedPerWeek: data.settings.rem.workout.days.length,
  };
}

export interface TypeRank {
  /** Workout type, e.g. «Кардіо». */
  label: string;
  /** Days with this type in the period. */
  n: number;
  /** Bar width relative to the most frequent type, 0–100. */
  pct: number;
}

/**
 * Most frequent workout types among trained days in `[from, today]`, most frequent first.
 * Ties keep the order in which the types first appeared (chronologically).
 */
export function typeRanking(data: AppData, from: ISODate, today: ISODate): TypeRank[] {
  // A Map keeps insertion order for every key (a plain object would hoist numeric-looking names).
  const counts = new Map<string, number>();
  for (const { entry } of daysInRange(data, from, today)) {
    if (entry.trained !== true) continue;
    for (const t of entry.types) counts.set(t, (counts.get(t) ?? 0) + 1);
  }
  const ranked = [...counts].sort((a, b) => b[1] - a[1]);
  const top = ranked[0]?.[1] ?? 1;
  return ranked.map(([label, n]) => ({ label, n, pct: (n / top) * 100 }));
}
