import { addDays, DOW_SHORT, mondayOf, ok, type AppData, type ISODate } from '@legko/shared';
import { daysInRange, kcalOn, mean, sortedDayKeys } from './common';
import { periodStart, type Period } from './periods';

/** Bar colour role: no data → `--line`, within the goal → `--acc2`, above the goal → `--acc`. */
export type KcalTone = 'empty' | 'ok' | 'over';

export interface KcalBar {
  /** The day, or the Monday of the week for weekly averages. */
  date: ISODate;
  /** kcal of the day / weekly average; `null` = no data. */
  value: number | null;
  /** Bar height in % of the chart (1 decimal); 3 for bars without a value. */
  heightPct: number;
  tone: KcalTone;
  /** Weekday under the bar («Пн»…«Нд») for the week view; '' otherwise. */
  label: string;
}

export interface KcalBars {
  bars: KcalBar[];
  /** Dashed goal line position, % from the bottom. */
  goalPct: number;
  /** Top of the scale: `max(goal × 1.25, largest bar)`. Pass it to `kcalHistory`. */
  max: number;
  /** Show the weekday labels row (week view only). */
  labeled: boolean;
  /** «· середнє за тиждень» for 3 months / all time (weekly averages), '' otherwise. */
  note: string;
  /** CSS gap between bars: '8px' for the week, '3px' otherwise. */
  gap: string;
}

/** Height of a bar without data, % (a visible stub). */
export const EMPTY_BAR_PCT = 3;
const GOAL_HEADROOM = 1.25;

export function kcalTone(value: number | null, goal: number): KcalTone {
  if (value === null) return 'empty';
  return value > goal ? 'over' : 'ok';
}

/** Average kcal over days in `[from, to]` that have kcal; `null` if none. */
export function averageKcal(data: AppData, from: ISODate, to: ISODate): number | null {
  const values: number[] = [];
  for (const { entry } of daysInRange(data, from, to)) if (ok(entry.kcal)) values.push(entry.kcal);
  return mean(values);
}

interface RawBar {
  date: ISODate;
  value: number | null;
  label: string;
}

function rawBars(data: AppData, period: Period, today: ISODate): RawBar[] {
  const bars: RawBar[] = [];
  if (period === 'week') {
    const monday = mondayOf(today);
    for (let i = 0; i < 7; i++) {
      const date = addDays(monday, i);
      bars.push({ date, value: kcalOn(data, date), label: DOW_SHORT[(i + 1) % 7] ?? '' });
    }
  } else if (period === 'month') {
    for (let i = 29; i >= 0; i--) {
      const date = addDays(today, -i);
      bars.push({ date, value: kcalOn(data, date), label: '' });
    }
  } else {
    // Weekly averages, weeks from Monday; the first week may start before the period.
    let monday = mondayOf(periodStart(data, period, today));
    while (monday <= today) {
      bars.push({ date: monday, value: weekAverage(data, monday), label: '' });
      monday = addDays(monday, 7);
    }
  }
  return bars;
}

/** Average kcal of the 7 days starting at `monday` (days after today simply have no data). */
function weekAverage(data: AppData, monday: ISODate): number | null {
  const values: number[] = [];
  for (let i = 0; i < 7; i++) {
    const kcal = kcalOn(data, addDays(monday, i));
    if (kcal !== null) values.push(kcal);
  }
  return mean(values);
}

/**
 * Kcal bar chart of the «Харчування» card: week → 7 daily bars Mon…Sun; month → 30 daily bars
 * ending today; 3 months / all time → weekly averages.
 */
export function kcalBars(data: AppData, period: Period, today: ISODate): KcalBars {
  const goal = data.settings.kcalGoal;
  const raw = rawBars(data, period, today);
  const max = Math.max(goal * GOAL_HEADROOM, ...raw.map((b) => b.value ?? 0));
  const bars = raw.map((b): KcalBar => ({
    ...b,
    // A 0 kcal day gets the stub height too (as in the prototype), but keeps its «ok» tone.
    heightPct: b.value ? Number(((b.value / max) * 100).toFixed(1)) : EMPTY_BAR_PCT,
    tone: kcalTone(b.value, goal),
  }));
  return {
    bars,
    goalPct: (goal / max) * 100,
    max,
    labeled: period === 'week',
    note: period === 'q' || period === 'all' ? '· середнє за тиждень' : '',
    gap: period === 'week' ? '8px' : '3px',
  };
}

export interface KcalAverages {
  /** Monday of this week … today. */
  week: number | null;
  /** 1st of the current calendar month … today. */
  month: number | null;
  /** Start of the selected period … today. */
  period: number | null;
}

/** The three «Цей тиждень / Цей місяць / Період» kcal tiles. */
export function kcalAverages(data: AppData, today: ISODate, period: Period): KcalAverages {
  return {
    week: averageKcal(data, mondayOf(today), today),
    month: averageKcal(data, `${today.slice(0, 7)}-01`, today),
    period: averageKcal(data, periodStart(data, period, today), today),
  };
}

export interface KcalHistoryItem {
  date: ISODate;
  kcal: number;
  /** Bar width, % of the scale (capped at 100). */
  pct: number;
  /** 'over' above the goal, else 'ok'. */
  tone: Exclude<KcalTone, 'empty'>;
}

export interface KcalHistory {
  /** Newest first, at most `limit`. */
  items: KcalHistoryItem[];
  /** All days with kcal — show «Показати ще» while `items.length < total`. */
  total: number;
}

/**
 * «Історія калорій»: days with kcal, newest first.
 * `scaleMax` should be `kcalBars(...).max` of the selected period, so the history bars share the
 * chart's scale exactly like in the prototype (where both use `maxV`).
 */
export function kcalHistory(data: AppData, limit: number, scaleMax: number): KcalHistory {
  const goal = data.settings.kcalGoal;
  const withKcal: { date: ISODate; kcal: number }[] = [];
  for (const date of sortedDayKeys(data)) {
    const kcal = kcalOn(data, date);
    if (kcal !== null) withKcal.push({ date, kcal });
  }
  const items = withKcal
    .reverse()
    .slice(0, Math.max(0, limit))
    .map(({ date, kcal }): KcalHistoryItem => ({
      date,
      kcal,
      pct: scaleMax > 0 ? Math.min(100, (kcal / scaleMax) * 100) : 0,
      tone: kcal > goal ? 'over' : 'ok',
    }));
  return { items, total: withKcal.length };
}
