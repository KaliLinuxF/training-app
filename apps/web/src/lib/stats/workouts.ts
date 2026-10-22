import {
  addDays,
  bodyWeightOn,
  compareSessions,
  countedSets,
  diffDays,
  DOW_SHORT,
  findExercise,
  mondayOf,
  sessionKcal,
  sessionVolume,
  type AppData,
  type ISODate,
  type WorkoutSession,
} from '@legko/shared';
import { daysInRange, sortedDayKeys } from './common';
import { earliestDate, periodStart, type Period } from './periods';

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

// ---- sessions (docs/workouts-steps-rebrand.md §3.15) ---------------------------------------------

/** Done sessions with `from <= date <= to`, in `compareSessions` order. */
export function doneSessionsIn(data: Pick<AppData, 'sessions'>, from: ISODate, to: ISODate): WorkoutSession[] {
  return (data.sessions ?? [])
    .filter((s) => s.status === 'done' && s.date >= from && s.date <= to)
    .sort(compareSessions);
}

/** «Тренування | Обʼєм» of the progress chart. */
export type WorkoutChartMetric = 'trainings' | 'volume';

export interface WorkoutBucket {
  from: ISODate;
  to: ISODate;
  /** «Пн»…«Нд» for the week's daily buckets, '' otherwise. */
  label: string;
  /** Trained days (`trained === true`, with or without details). */
  trainings: number;
  /** Σ session volume (kg × reps) of the done sessions. */
  volume: number;
}

const MAX_MONTH_BUCKETS = 12;

const monthStart = (date: ISODate): ISODate => `${date.slice(0, 7)}-01`;
const nextMonth = (first: ISODate): ISODate => {
  const y = Number(first.slice(0, 4));
  const m = Number(first.slice(5, 7));
  return m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, '0')}-01`;
};

/** The bucket ranges of a period: week → 7 days; month / 3 months → weeks from Monday; all → months (≤ 12, latest). */
function bucketRanges(data: AppData, period: Period, today: ISODate): { from: ISODate; to: ISODate; label: string }[] {
  const out: { from: ISODate; to: ISODate; label: string }[] = [];
  if (period === 'week') {
    const monday = mondayOf(today);
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      out.push({ from: date, to: date, label: DOW_SHORT[(i + 1) % 7] ?? '' });
    }
    return out;
  }
  if (period === 'all') {
    let first = monthStart(earliestDate(data, today));
    while (first <= today) {
      const next = nextMonth(first);
      out.push({ from: first, to: addDays(next, -1), label: '' });
      first = next;
    }
    return out.slice(-MAX_MONTH_BUCKETS);
  }
  let monday = mondayOf(periodStart(data, period, today));
  while (monday <= today) {
    out.push({ from: monday, to: addDays(monday, 6), label: '' });
    monday = addDays(monday, 7);
  }
  return out;
}

/** Trained days and volume per bucket of the period (days after today simply count nothing). */
export function workoutBuckets(data: AppData, period: Period, today: ISODate): WorkoutBucket[] {
  const sessions = doneSessionsIn(data, '0000-01-01', today);
  return bucketRanges(data, period, today).map(({ from, to, label }) => {
    const end = to < today ? to : today;
    const trainings = daysInRange(data, from, end).filter((d) => d.entry.trained === true).length;
    const volume = sessions
      .filter((s) => s.date >= from && s.date <= end)
      .reduce((sum, s) => sum + sessionVolume(s), 0);
    return { from, to, label, trainings, volume };
  });
}

export interface WorkoutChartBar {
  date: ISODate;
  value: number;
  heightPct: number;
  /** `idle` (a neutral value: no goal judgement), `empty` for 0. */
  tone: 'idle' | 'empty';
  label: string;
}

/** Bars of one metric over the buckets: heights relative to the largest value, a 3% stub for 0. */
export function workoutChartBars(buckets: readonly WorkoutBucket[], metric: WorkoutChartMetric): WorkoutChartBar[] {
  const values = buckets.map((b) => (metric === 'trainings' ? b.trainings : b.volume));
  const max = Math.max(1, ...values);
  return buckets.map((b, i) => {
    const value = values[i] ?? 0;
    return {
      date: b.from,
      value,
      heightPct: value > 0 ? Number(((value / max) * 100).toFixed(1)) : 3,
      tone: value > 0 ? 'idle' : 'empty',
      label: b.label,
    };
  });
}

/** Σ kcal of the done sessions in [from, to] (each at her body weight on its date). */
export function sessionsKcalIn(data: AppData, from: ISODate, to: ISODate): number {
  return doneSessionsIn(data, from, to).reduce(
    (sum, s) => sum + sessionKcal(s, bodyWeightOn(data.weights, s.date)),
    0,
  );
}

export interface ExerciseRank {
  exerciseId: string;
  /** The current name (library / her own exercise), else the latest snapshot. */
  name: string;
  /** Sessions of the period in which it was done (an exercise added twice counts once). */
  n: number;
  /** Bar width relative to the most frequent one, 0–100. */
  pct: number;
}

/** The most frequent exercises of the done sessions in [from, to], most frequent first (ties: first done first). */
export function topExercises(data: AppData, from: ISODate, to: ISODate, limit: number): ExerciseRank[] {
  const counts = new Map<string, { n: number; name: string }>();
  for (const s of doneSessionsIn(data, from, to)) {
    const seen = new Set<string>();
    for (const ex of s.exercises) {
      if (seen.has(ex.exerciseId) || countedSets(ex).length === 0) continue;
      seen.add(ex.exerciseId);
      const prev = counts.get(ex.exerciseId);
      counts.set(ex.exerciseId, { n: (prev?.n ?? 0) + 1, name: ex.name });
    }
  }
  const ranked = [...counts].sort((a, b) => b[1].n - a[1].n).slice(0, Math.max(0, limit));
  const top = ranked[0]?.[1].n ?? 1;
  return ranked.map(([exerciseId, { n, name }]) => ({
    exerciseId,
    name: findExercise(data.exercises ?? [], exerciseId)?.name ?? name,
    n,
    pct: (n / top) * 100,
  }));
}
