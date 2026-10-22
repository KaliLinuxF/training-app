/**
 * Steps and burned calories (docs/workouts-steps-rebrand.md §1.7, §3.15, §3.16): pure, every date passed in. The
 * numbers come from the shared formulas (`stepsStats`, `stepsKcal`, `bodyWeightOn`, `dayBurned`), so Home, the
 * calendar, Progress and the coach show the same values.
 */
import {
  addDays,
  bodyWeightOn,
  DOW_SHORT,
  f0,
  mondayOf,
  stepsKcal,
  stepsStats,
  type AppData,
  type ISODate,
  type StepsEntry,
} from '@legko/shared';
import type { BarTone } from '@/ui';
import { mean } from './common';
import { periodStart, type Period } from './periods';

/** No-break space (U+00A0): a number stays with its unit. */
const NB = '\u00a0';

/** «1 крок», «2 кроки», «5 кроків», «11 кроків», «8 400 кроків». */
export function stepsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'крок';
  if (mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)) return 'кроки';
  return 'кроків';
}

/** «8 400 кроків» (the number grouped, a no-break space before the word). */
export const stepsText = (n: number): string => `${f0(n)}${NB}${stepsWord(n)}`;

/** The steps of `date`, or null. */
export const stepsOn = (data: Pick<AppData, 'steps'>, date: ISODate): number | null =>
  (data.steps ?? []).find((s) => s.date === date)?.steps ?? null;

/** Whether she ever logged steps (Progress hides the «Кроки» card otherwise). */
export const hasAnySteps = (data: Pick<AppData, 'steps'>): boolean => (data.steps ?? []).length > 0;

/** kcal of the steps of `date` with her body weight on that day (null without steps). */
export function stepsKcalOn(data: Pick<AppData, 'steps' | 'weights'>, date: ISODate): number | null {
  const steps = stepsOn(data, date);
  return steps === null ? null : stepsKcal(steps, bodyWeightOn(data.weights, date));
}

/** What is left to the goal: «Ціль 10 000 — ще 1 600», «Ціль виконано ✓»; null without a goal or steps. */
export interface StepsGoalView {
  /** The steps reached the goal. */
  reached: boolean;
  text: string;
}

export function stepsGoalView(steps: number | null, goal: number | null): StepsGoalView | null {
  if (goal === null) return null;
  if (steps !== null && steps >= goal) return { reached: true, text: 'Ціль виконано ✓' };
  return { reached: false, text: `Ціль ${f0(goal)} — ще ${f0(goal - (steps ?? 0))}` };
}

// ---- Progress «Кроки» ---------------------------------------------------------------------------

export interface StepsBar {
  /** The day, or the Monday of the week for weekly averages. */
  date: ISODate;
  /** Steps of the day / the weekly average of the logged days; null = nothing logged. */
  value: number | null;
  /** % of the plot (1 decimal); 3 for a bar without a value. */
  heightPct: number;
  /** `ok` (mint) at or above the goal, `idle` below it or without a goal, `empty` without data. */
  tone: BarTone;
  /** «Пн»…«Нд» in the week view, '' otherwise. */
  label: string;
}

export interface StepsChart {
  bars: StepsBar[];
  /** Dashed goal line, % from the bottom; null without a goal (no line at all). */
  goalPct: number | null;
  labeled: boolean;
  gap: string;
  /** Weekly averages (3 months / all time). */
  weekly: boolean;
}

const EMPTY_BAR_PCT = 3;
const GOAL_HEADROOM = 1.25;

interface RawBar {
  date: ISODate;
  value: number | null;
  label: string;
}

function weekAverage(steps: readonly StepsEntry[], monday: ISODate): number | null {
  const sunday = addDays(monday, 6);
  return mean(steps.filter((s) => s.date >= monday && s.date <= sunday).map((s) => s.steps));
}

/**
 * Daily steps bars for the week (Mon…Sun) and the month (30 days ending today); weekly averages of the logged days
 * for 3 months and all time — the same buckets as the kcal chart.
 */
export function stepsChart(data: AppData, period: Period, today: ISODate): StepsChart {
  const steps = data.steps ?? [];
  const goal = data.settings.stepsGoal ?? null;
  const raw: RawBar[] = [];
  if (period === 'week') {
    const monday = mondayOf(today);
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      raw.push({ date, value: stepsOn(data, date), label: DOW_SHORT[(i + 1) % 7] ?? '' });
    }
  } else if (period === 'month') {
    for (let i = 29; i >= 0; i--) {
      const date = addDays(today, -i);
      raw.push({ date, value: stepsOn(data, date), label: '' });
    }
  } else {
    let monday = mondayOf(periodStart(data, period, today));
    while (monday <= today) {
      const avg = weekAverage(steps, monday);
      raw.push({ date: monday, value: avg === null ? null : Math.round(avg), label: '' });
      monday = addDays(monday, 7);
    }
  }
  const max = Math.max(goal !== null ? goal * GOAL_HEADROOM : 0, ...raw.map((b) => b.value ?? 0), 1);
  const bars = raw.map(
    (b): StepsBar => ({
      ...b,
      heightPct: b.value ? Number(((b.value / max) * 100).toFixed(1)) : EMPTY_BAR_PCT,
      tone: b.value === null ? 'empty' : goal !== null && b.value >= goal ? 'ok' : 'idle',
    }),
  );
  return {
    bars,
    goalPct: goal !== null ? (goal / max) * 100 : null,
    labeled: period === 'week',
    gap: period === 'week' ? '8px' : '3px',
    weekly: period === 'q' || period === 'all',
  };
}

export interface StepsSummary {
  /** Average steps of the logged days of the period (shared `stepsStats`); null without any. */
  avg: number | null;
  /** Logged days in the period. */
  days: number;
  /** Days at or above the goal (0 without a goal). */
  goalDays: number;
  goal: number | null;
  /** Average kcal of the steps per logged day (each day at her weight of that day); null without any. */
  kcalPerDay: number | null;
}

/** The «Кроки» numbers of the period [periodStart, today], via the shared `stepsStats` (same as the coach). */
export function stepsSummary(data: AppData, period: Period, today: ISODate): StepsSummary {
  const from = periodStart(data, period, today);
  const goal = data.settings.stepsGoal ?? null;
  const stats = stepsStats(data.steps ?? [], from, today, goal);
  const kcal = (data.steps ?? [])
    .filter((s) => s.date >= from && s.date <= today)
    .map((s) => stepsKcal(s.steps, bodyWeightOn(data.weights, s.date)));
  const avgKcal = mean(kcal);
  return { ...stats, goal, kcalPerDay: avgKcal === null ? null : Math.round(avgKcal) };
}
