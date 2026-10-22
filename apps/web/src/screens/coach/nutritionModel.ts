/**
 * «Харчування» of a client (docs/coach-cabinet.md §6.6), pure: one kcal bar per day of the last `n` days (today
 * included) against the goal, the average over the full days before today, the Б · Ж · В of each day with food in
 * that window, and the meal journal (every day with food, newest first).
 */
import {
  addDays,
  dLong,
  DOW_SHORT,
  dayMacroComplete,
  dayMacros,
  f0,
  MACRO_KEYS,
  mealContent,
  mealsOf,
  ok,
  parse,
  type AppData,
  type CoachPeriod,
  type DayEntry,
  type ISODate,
  type MacroGoals,
  type MacroKey,
} from '@legko/shared';
import { mealTitle, NBSP } from '@/lib/nutrition';
import { EMPTY_BAR_PCT, kcalTone, type KcalBar } from '@/lib/stats';
import type { StatItem, Tone } from '@/ui';
import { avgFullDays, COACH_COPY } from './copy';

const DASH = '—';
const GOAL_HEADROOM = 1.25;

export interface MacroDayCell {
  key: MacroKey;
  /** «92», or «—». */
  text: string;
  /** Lavender above the goal; muted on a partial day. */
  tone: Tone;
  /** Not every meal with energy has this macronutrient: shown with «*». */
  partial: boolean;
}

export interface MacroDayRow {
  date: ISODate;
  /** «Вт, 13 жовтня». */
  label: string;
  /** «1 740», or «—». */
  kcal: string;
  kcalTone: Tone;
  cells: MacroDayCell[];
}

export interface JournalMeal {
  id: string;
  /** «Сніданок · 08:30». */
  title: string;
  /** «420 ккал», or «—». */
  value: string;
  hasKcal: boolean;
  /** «Тост з тунцем, кава», or ''. */
  content: string;
}

export interface JournalDay {
  date: ISODate;
  /** «Вт, 13 жовтня». */
  title: string;
  /** «1 740 ккал», or null without kcal. */
  kcal: string | null;
  meals: JournalMeal[];
}

export interface NutritionPanelModel {
  n: CoachPeriod;
  goal: number;
  /** «ціль 1 700 ккал». */
  goalText: string;
  bars: KcalBar[];
  goalPct: number;
  gap: string;
  labeled: boolean;
  hasBarData: boolean;
  chartLabel: string;
  /** «Сер. за 7 повних днів» · «Днів із калоріями». */
  stats: StatItem[];
  /** «ціль 90» per macronutrient with a goal. */
  goals: MacroGoals;
  /** Days with food in the window, newest first. */
  macroRows: MacroDayRow[];
  /** Some shown macro value is partial: show the footnote. */
  hasPartial: boolean;
  /** Every day with food up to today, newest first. */
  journal: JournalDay[];
}

/** «Вт, 13 жовтня». */
export const dayLabel = (date: ISODate): string => `${DOW_SHORT[parse(date).getDay()] ?? ''}, ${dLong(date)}`;

const hasFood = (day: DayEntry | undefined): day is DayEntry =>
  day !== undefined && (mealsOf(day).length > 0 || ok(day.kcal));

const kcalOf = (day: DayEntry | undefined): number | null => (day && ok(day.kcal) ? day.kcal : null);

export function nutritionModel(data: AppData, today: ISODate, n: CoachPeriod): NutritionPanelModel {
  const goal = data.settings.kcalGoal;
  const goals = data.settings.macroGoals;

  // Bars over [today − n + 1, today].
  const raw: { date: ISODate; value: number | null; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const date = addDays(today, -i);
    raw.push({
      date,
      value: kcalOf(data.days[date]),
      label: n === 7 ? (DOW_SHORT[parse(date).getDay()] ?? '') : '',
    });
  }
  const max = Math.max(goal * GOAL_HEADROOM, ...raw.map((b) => b.value ?? 0));
  const bars = raw.map(
    (b): KcalBar => ({
      ...b,
      heightPct: b.value ? Number(((b.value / max) * 100).toFixed(1)) : EMPTY_BAR_PCT,
      tone: kcalTone(b.value, goal),
    }),
  );

  // The average of the full days before today (as the table and «Огляд»).
  const full: number[] = [];
  for (let i = n; i >= 1; i--) {
    const v = kcalOf(data.days[addDays(today, -i)]);
    if (v !== null) full.push(v);
  }
  const avg = full.length ? full.reduce((a, b) => a + b, 0) / full.length : null;
  const stats: StatItem[] = [
    {
      label: avgFullDays(n),
      value: f0(avg),
      unit: avg === null ? undefined : 'ккал',
      tone: avg === null ? undefined : avg > goal ? 'acc' : 'acc2',
    },
    { label: COACH_COPY.daysWithKcal, value: String(full.length) },
  ];

  // Б · Ж · В per day with food in the window, newest first.
  const macroRows: MacroDayRow[] = [];
  let hasPartial = false;
  for (let i = 0; i < n; i++) {
    const date = addDays(today, -i);
    const day = data.days[date];
    if (!hasFood(day)) continue;
    const totals = dayMacros(day);
    const kcal = kcalOf(day);
    const cells = MACRO_KEYS.map((key): MacroDayCell => {
      const v = totals[key];
      const g = goals[key];
      const partial = v !== null && !dayMacroComplete(day, key);
      if (partial) hasPartial = true;
      const over = v !== null && g !== null && Math.round(v) > g;
      return {
        key,
        text: v === null ? DASH : f0(v),
        tone: v === null ? 'faint' : partial ? 'muted' : over ? 'acc' : 'ink',
        partial,
      };
    });
    macroRows.push({
      date,
      label: dayLabel(date),
      kcal: kcal === null ? DASH : f0(kcal),
      kcalTone: kcal === null ? 'faint' : kcal > goal ? 'acc' : 'ink',
      cells,
    });
  }

  // The journal: every day with food up to today, newest first.
  const journal: JournalDay[] = Object.keys(data.days)
    .filter((date) => date <= today && hasFood(data.days[date]))
    .sort()
    .reverse()
    .map((date) => {
      const day = data.days[date] as DayEntry;
      const kcal = kcalOf(day);
      return {
        date,
        title: dayLabel(date),
        kcal: kcal === null ? null : `${f0(kcal)}${NBSP}ккал`,
        meals: mealsOf(day).map((meal) => ({
          id: meal.id,
          title: meal.time ? `${mealTitle(meal)} · ${meal.time}` : mealTitle(meal),
          value: ok(meal.kcal) ? `${f0(meal.kcal)}${NBSP}ккал` : DASH,
          hasKcal: ok(meal.kcal),
          content: mealContent(meal),
        })),
      };
    });

  return {
    n,
    goal,
    goalText: `ціль ${f0(goal)}${NBSP}ккал`,
    bars,
    goalPct: (goal / max) * 100,
    gap: n === 7 ? '8px' : '3px',
    labeled: n === 7,
    hasBarData: bars.some((b) => b.value !== null),
    chartLabel: `Калорії за ${n} днів, ціль ${f0(goal)} ккал`,
    stats,
    goals,
    macroRows,
    hasPartial,
    journal,
  };
}
