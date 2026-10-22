/**
 * View model of the «Мій прогрес» screen (prototype `renderVals`, «progress» part): every value is
 * computed by `@/lib/stats` and formatted here, so the components only lay strings out.
 */
import {
  diffDays,
  dLong,
  DOW_SHORT,
  f0,
  f1,
  fN,
  sgn,
  weekdayOf,
  type AppData,
  type ISODate,
  type MeasureKey,
} from '@legko/shared';
import { macroParts, NBSP, PART_SEPARATOR } from '@/lib/nutrition';
import {
  chartGeometry,
  doneSessionsIn,
  hasAnySteps,
  sessionsKcalIn,
  stepsChart,
  stepsSummary,
  topExercises,
  workoutBuckets,
  workoutChartBars,
  kcalAverages,
  kcalBars,
  kcalHistory,
  kcalTone,
  macroAverages,
  MEASURE_LABELS,
  measureSummary,
  periodMeta,
  periodStart,
  rangeStats,
  seriesInRange,
  typeRanking,
  weightSummary,
  workoutStats,
  type ChartGeometry,
  type DatedValue,
  type KcalBar,
  type Period,
  type PeriodMeta,
  type WorkoutChartMetric,
} from '@/lib/stats';
import { deltaTone, type ChartBar, type PillTone, type StatItem, type Tone } from '@/ui';

/** Rows of «Історія калорій» before the first «Показати ще». */
export const HISTORY_FIRST = 3;
/** Rows added by each «Показати ще». */
export const HISTORY_PAGE = 7;
/** Workout types listed under «Найчастіше». */
export const TYPES_SHOWN = 5;
/** Exercises listed under «Найчастіші вправи». */
export const EXERCISES_SHOWN = 5;

/** Accessible name of the «Б · Ж · В» strip. */
export const MACROS_LABEL = 'Білки, жири, вуглеводи — середнє за день';
/** Instead of the «Б · Ж · В» strip when no day of the period has complete macros. */
export const NO_MACROS_IN_PERIOD = 'За цей період білків, жирів і вуглеводів ще не записано';

/**
 * Period of the «Б · Ж · В» caption. Shorter than `PeriodMeta.short` («за останні 30 днів», «за весь період») so
 * «Б · Ж · В — середнє за день · за 30 днів» stays on one phone line. Each phrase is joined with NBSP, so on a
 * narrow line (320px) it moves down whole instead of leaving «тижня» alone.
 */
const MACRO_PERIOD: Readonly<Record<Period, string>> = {
  week: `цього${NBSP}тижня`,
  month: `за${NBSP}30${NBSP}днів`,
  q: `за${NBSP}3${NBSP}місяці`,
  all: `за${NBSP}весь${NBSP}час`,
};

/** «Б · Ж · В —» never splits; a wrap of the caption can only fall inside «середнє за день» or after its « ·». */
const MACROS_CAPTION = `Б${NBSP}·${NBSP}Ж${NBSP}·${NBSP}В${NBSP}— середнє за день${PART_SEPARATOR}`;

const DASH = '—';
const CHART_VIEWBOX_HEIGHT = 120;

export type SummaryKey = 'workouts' | 'kcal' | 'weight' | 'waist' | 'hips' | 'chest';

/** One «label number unit» part of the summary sentence («вага −0,3 кг»). */
export interface SummaryItem {
  key: SummaryKey;
  /** «Тренувань», then lower-case inside the sentence: «сер. калорійність», «вага», «талія»… */
  label: string;
  /** «2», «1 795», «−0,3», or «—» without data. */
  value: string;
  /** «ккал», «кг», «см»; '' for the count and for a missing value. */
  unit: string;
  /** Colour of the number: changes via `deltaTone`, counts `ink`, a missing value `faint`. */
  tone: Tone;
}

export interface SummaryModel {
  /** Period title, also the region name: «Цього тижня», «За 3 місяці»… */
  title: string;
  items: SummaryItem[];
}

export interface LineChartModel {
  geometry: ChartGeometry;
  /** At least two points; otherwise the screen shows «Ще недостатньо даних». */
  enough: boolean;
  /** Second line of the placeholder. */
  emptyHint: string;
  /** Text alternative of the chart ('' when not `enough`). */
  ariaLabel: string;
}

export interface WeightModel {
  /** Latest weigh-in «65,4», or «—». */
  current: string;
  /** All-time change «−2,9 кг від старту» (lost → mint, gained → lavender); null below two weigh-ins. */
  change: { text: string; tone: PillTone } | null;
  /** First weigh-in «68,3», or «—». */
  start: string;
  /** Goal from the settings «60,0». */
  goal: string;
  /** «ще 5,4 кг», or '' without weigh-ins. */
  left: string;
  /** Way travelled towards the goal, 0–100 (bar width). */
  pct: number;
  /** «35% шляху», or '' without weigh-ins. */
  pctLabel: string;
  chart: LineChartModel;
}

export interface MeasureRowModel {
  key: MeasureKey;
  /** «Талія» */
  label: string;
  /** «74 → 70 см», or «ще немає» */
  range: string;
  /** «−4 см» or «—» */
  delta: string;
  deltaTone: Tone;
  selected: boolean;
  ariaLabel: string;
}

export interface TypeBarModel {
  label: string;
  value: string;
  pct: number;
}

/** One bar chart of the progress cards (no goal judgement unless `goalPct`). */
export interface BarChartModel {
  bars: ChartBar[];
  /** Dashed goal line; null = none. */
  goalPct: number | null;
  gap: string;
  labeled: boolean;
  /** Text alternative. */
  label: string;
  /** Some bar has a value. */
  hasData: boolean;
}

/** «Найчастіші вправи»: one rank row per exercise, linked to its detail when the screen allows it. */
export interface ExerciseRankModel {
  exerciseId: string;
  label: string;
  /** «6» (sessions of the period). */
  value: string;
  pct: number;
  /** «Присідання зі штангою: 6 тренувань». */
  ariaLabel: string;
}

export interface WorkoutsModel {
  /** Всього · Цього тижня · Цього місяця · В сер. / тиж. */
  stats: StatItem[];
  /** «Тренування | Обʼєм» per bucket of the period (week → days, month / 3 months → weeks, all → months). */
  charts: Record<WorkoutChartMetric, BarChartModel>;
  /** «Спалено на тренуваннях ≈ 1 240 ккал · в сер. 177 ккал/день»; null without a done session in the period. */
  burned: string | null;
  /** Top exercises of the done sessions of the period (empty without sessions). */
  exercises: ExerciseRankModel[];
  /** «Найчастіше · цього тижня» */
  typesHeading: string;
  /** The `TYPES_SHOWN` most frequent types of the period. */
  types: TypeBarModel[];
}

export interface HistoryRowModel {
  date: ISODate;
  /** «Вт, 13 жовтня» */
  label: string;
  /** «1 650 ккал» */
  value: string;
  /** Dot colour: within the kcal goal (mint) or above it (lavender). */
  tone: 'ok' | 'over';
  ariaLabel: string;
  /** Where the row leads: `ProgressOptions.dayHref` of that day (her calendar by default). */
  href: string;
}

/** «Б · Ж · В»: the average grams per day of the selected period, over the days complete for each (D22). */
export interface MacroStripModel {
  /** «Б · Ж · В — середнє за день · цього тижня» */
  caption: string;
  /**
   * Білки · Жири · Вуглеводи: value in whole grams with the unit «г» (a goal goes into the label: «Білки · ціль
   * 90 г»), lavender above its goal; «—» for a macronutrient no complete day has. Null when no day counts.
   */
  items: StatItem[] | null;
  /** Shown instead of the strip when `items` is null. */
  empty: string | null;
  /** Accessible name of the strip. */
  label: string;
}

export interface NutritionModel {
  /** «ціль 1 700 ккал» */
  goal: string;
  /** «Сер. цього тижня» · «Сер. цього місяця» */
  stats: StatItem[];
  macros: MacroStripModel;
  bars: KcalBar[];
  goalPct: number;
  gap: string;
  labeled: boolean;
  /** «· середнє за тиждень» or '' */
  note: string;
  /** Some bar has data; otherwise the chart shows an empty-state line. */
  hasBarData: boolean;
  chartLabel: string;
  history: HistoryRowModel[];
  /** More days with kcal exist than `history` shows. */
  hasMore: boolean;
}

/** «Кроки»: null when she never logged steps (the card is hidden). */
export interface StepsModel {
  /** «7 850 В сер. за день» · «10 000 Ціль» · «3 з 7 Днів з ціллю» (without a goal: «Днів записано»). */
  stats: StatItem[];
  chart: BarChartModel;
  /** «Спалено ≈ 275 ккал на день»; null without steps in the period. */
  burned: string | null;
}

export interface ProgressModel {
  period: PeriodMeta;
  summary: SummaryModel;
  weight: WeightModel;
  measures: { rows: MeasureRowModel[]; chart: LineChartModel; chartLabel: string };
  workouts: WorkoutsModel;
  steps: StepsModel | null;
  nutrition: NutritionModel;
}

/** Who looks at the screen: she herself, or the coach's read-only view of a client. */
export type ProgressAudience = 'self' | 'coach';

/** Calendar route of a day: where an «Історія калорій» row of her own screen leads. */
export const calendarDayHref = (date: ISODate): string => `/calendar?date=${date}`;

/**
 * Empty-chart hints for the coach (third person: the coach cannot record anything for the client). The «only one
 * reading» hints stay the same for both audiences.
 */
export const COACH_CHART_HINTS = {
  weightNone: 'Зважувань ще немає',
  measureNone: 'Замірів ще немає',
} as const;

const SELF_CHART_HINTS: Readonly<Record<keyof typeof COACH_CHART_HINTS, string>> = {
  weightNone: 'Запиши перше зважування, щоб бачити динаміку',
  measureNone: 'Запиши заміри, щоб бачити динаміку',
};

export interface ProgressOptions {
  period: Period;
  /** Parameter shown in the «Заміри тіла» chart. */
  measure: MeasureKey;
  /** Rows of «Історія калорій». */
  historyLimit: number;
  /** 'coach': third-person empty-chart hints (`COACH_CHART_HINTS`). Default 'self'. */
  audience?: ProgressAudience;
  /** Where an «Історія калорій» row leads. Default `calendarDayHref`. */
  dayHref?: (date: ISODate) => string;
}

export function buildProgressModel(data: AppData, today: ISODate, opts: ProgressOptions): ProgressModel {
  const period = periodMeta(opts.period);
  const from = periodStart(data, opts.period, today);
  const hints = opts.audience === 'coach' ? COACH_CHART_HINTS : SELF_CHART_HINTS;
  return {
    period,
    summary: summaryModel(data, from, today, period),
    weight: weightModel(data, from, hints.weightNone),
    measures: measuresModel(data, from, opts.measure, hints.measureNone),
    workouts: workoutsModel(data, from, today, period),
    steps: stepsModel(data, today, period),
    nutrition: nutritionModel(data, from, today, opts, period),
  };
}

const missing = (key: SummaryKey, label: string): SummaryItem => ({
  key,
  label,
  value: DASH,
  unit: '',
  tone: 'faint',
});

/** A signed change of the period («вага −0,3 кг»), toned like the prototype's `tone()`. */
function changeItem(
  key: SummaryKey,
  label: string,
  n: number | null,
  unit: string,
  f: (x: number) => string = fN,
): SummaryItem {
  return n === null ? missing(key, label) : { key, label, value: sgn(n, f), unit, tone: deltaTone(n) };
}

/** SPEC §1.1 #7 as one sentence: «Тренувань 2 · сер. калорійність 1 795 ккал · вага −0,3 кг · талія …». */
function summaryModel(data: AppData, from: ISODate, today: ISODate, period: PeriodMeta): SummaryModel {
  const r = rangeStats(data, from, today);
  return {
    title: period.title,
    items: [
      // No day recorded in the period: «—» rather than a «0» that reads like a result.
      r.entries === 0
        ? missing('workouts', 'Тренувань')
        : { key: 'workouts', label: 'Тренувань', value: f0(r.trainings), unit: '', tone: 'ink' },
      r.avgKcal === null
        ? missing('kcal', 'сер. калорійність')
        : { key: 'kcal', label: 'сер. калорійність', value: f0(r.avgKcal), unit: 'ккал', tone: 'ink' },
      changeItem('weight', 'вага', r.weightChange, 'кг', f1),
      changeItem('waist', 'талія', r.waistChange, 'см'),
      changeItem('hips', 'стегна', r.hipsChange, 'см'),
      changeItem('chest', 'груди', r.chestChange, 'см'),
    ],
  };
}

/** Pill tone of the all-time change: lost → mint, gained → lavender, about the same → neutral. */
function changePillTone(delta: number): PillTone {
  const tone = deltaTone(delta);
  return tone === 'acc2' ? 'acc2' : tone === 'acc' ? 'acc' : 'neutral';
}

interface ChartCopy {
  /** «Вага», «Талія» */
  title: string;
  unit: string;
  format: (n: number) => string;
  /** Placeholder hint without any reading / with a single one. */
  hintNone: string;
  hintOne: string;
}

function lineChart(points: readonly DatedValue[], copy: ChartCopy): LineChartModel {
  const geometry = chartGeometry(points, CHART_VIEWBOX_HEIGHT);
  const first = points[0];
  const last = points.at(-1);
  const enough = points.length >= 2;
  return {
    geometry,
    enough,
    emptyHint: points.length === 0 ? copy.hintNone : copy.hintOne,
    ariaLabel:
      enough && first && last
        ? `${copy.title}: з ${dLong(first.date)} по ${dLong(last.date)}, ` +
          `від ${copy.format(first.value)} до ${copy.format(last.value)} ${copy.unit}`
        : '',
  };
}

function weightModel(data: AppData, from: ISODate, hintNone: string): WeightModel {
  const w = weightSummary(data);
  const { first, last } = w;
  // A single weigh-in is the start itself: «0,0 кг від старту» would be noise.
  const change =
    first && last && data.weights.length >= 2
      ? { text: `${sgn(last.kg - first.kg, f1)} кг від старту`, tone: changePillTone(last.kg - first.kg) }
      : null;
  return {
    current: last ? f1(last.kg) : DASH,
    change,
    start: first ? f1(first.kg) : DASH,
    goal: f1(w.goal),
    left: w.left === null ? '' : `ще ${f1(w.left)} кг`,
    pct: w.pct,
    // Without any weigh-in there is no way travelled yet («0%» would read as a result).
    pctLabel: last ? `${Math.round(w.pct)}% шляху` : '',
    chart: lineChart(seriesInRange(data, 'kg', from), {
      title: 'Вага',
      unit: 'кг',
      format: f1,
      hintNone,
      hintOne: 'Потрібно щонайменше два зважування',
    }),
  };
}

function measuresModel(
  data: AppData,
  from: ISODate,
  selected: MeasureKey,
  hintNone: string,
): ProgressModel['measures'] {
  const rows = measureSummary(data).params.map(({ key, label, first, last, delta }): MeasureRowModel => {
    const has = first !== null && last !== null;
    const range = has ? `${fN(first)} → ${fN(last)} см` : 'ще немає';
    const deltaText = has && delta !== null ? `${sgn(delta)} см` : DASH;
    return {
      key,
      label,
      range,
      delta: deltaText,
      deltaTone: has ? deltaTone(delta) : 'faint',
      selected: key === selected,
      ariaLabel: has
        ? `${label}: ${fN(first)} → ${fN(last)} см, зміна ${deltaText}`
        : `${label}: замірів ще немає`,
    };
  });
  const label = MEASURE_LABELS[selected];
  return {
    rows,
    chartLabel: `${label}, см`,
    chart: lineChart(seriesInRange(data, selected, from), {
      title: label,
      unit: 'см',
      format: fN,
      hintNone,
      hintOne: 'Потрібно щонайменше два заміри',
    }),
  };
}

/** «2 тренування», «5 тренувань» after a number. */
function trainingsWord(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  return mod10 >= 1 && mod10 <= 4 && !(mod100 >= 11 && mod100 <= 14) ? 'тренування' : 'тренувань';
}

function workoutCharts(data: AppData, today: ISODate, period: PeriodMeta): Record<WorkoutChartMetric, BarChartModel> {
  const buckets = workoutBuckets(data, period.id, today);
  const per = period.id === 'week' ? 'по днях' : period.id === 'all' ? 'по місяцях' : 'по тижнях';
  const chart = (metric: WorkoutChartMetric): BarChartModel => {
    const bars = workoutChartBars(buckets, metric);
    const total = bars.reduce((sum, b) => sum + b.value, 0);
    const label =
      metric === 'trainings'
        ? `Тренування ${period.short} ${per}: усього ${f0(total)}`
        : `Обʼєм ${period.short} ${per}: усього ${f0(total)} кг`;
    return {
      bars,
      goalPct: null,
      gap: period.id === 'week' ? '8px' : '6px',
      labeled: period.id === 'week',
      label,
      hasData: bars.some((b) => b.value > 0),
    };
  };
  return { trainings: chart('trainings'), volume: chart('volume') };
}

function workoutsModel(data: AppData, from: ISODate, today: ISODate, period: PeriodMeta): WorkoutsModel {
  const w = workoutStats(data, today);
  const kcal = doneSessionsIn(data, from, today).length > 0 ? sessionsKcalIn(data, from, today) : null;
  const days = diffDays(from, today) + 1;
  return {
    stats: [
      { label: 'Всього', value: f0(w.total) },
      { label: 'Цього тижня', value: f0(w.thisWeek) },
      { label: 'Цього місяця', value: f0(w.thisMonth) },
      { label: 'В сер. / тиж.', value: fN(w.avgPerWeek) },
    ],
    charts: workoutCharts(data, today, period),
    burned:
      kcal === null
        ? null
        : `Спалено на тренуваннях ≈${NBSP}${f0(kcal)}${NBSP}ккал · в сер. ${f0(kcal / days)}${NBSP}ккал/день`,
    exercises: topExercises(data, from, today, EXERCISES_SHOWN).map((e) => ({
      exerciseId: e.exerciseId,
      label: e.name,
      value: String(e.n),
      pct: e.pct,
      ariaLabel: `${e.name}: ${e.n} ${trainingsWord(e.n)}`,
    })),
    typesHeading: `Найчастіше · ${period.short}`,
    types: typeRanking(data, from, today)
      .slice(0, TYPES_SHOWN)
      .map((t) => ({ label: t.label, value: String(t.n), pct: t.pct })),
  };
}

function stepsModel(data: AppData, today: ISODate, period: PeriodMeta): StepsModel | null {
  if (!hasAnySteps(data)) return null;
  const sum = stepsSummary(data, period.id, today);
  const chart = stepsChart(data, period.id, today);
  const avg: StatItem =
    sum.avg === null
      ? { label: 'В сер. за день', value: DASH, tone: 'faint' }
      : { label: 'В сер. за день', value: f0(sum.avg) };
  const stats: StatItem[] =
    sum.goal !== null
      ? [
          avg,
          { label: 'Ціль', value: f0(sum.goal) },
          {
            label: 'Днів з ціллю',
            value: sum.days ? `${sum.goalDays} з ${sum.days}` : DASH,
            tone: sum.goalDays > 0 ? 'acc2' : undefined,
          },
        ]
      : [avg, { label: 'Днів записано', value: f0(sum.days) }];
  const goalText = sum.goal !== null ? `, ціль ${f0(sum.goal)}` : '';
  return {
    stats,
    chart: {
      bars: chart.bars,
      goalPct: chart.goalPct,
      gap: chart.gap,
      labeled: chart.labeled,
      label: `Кроки ${period.short}${chart.weekly ? ', середнє за тиждень' : ''}${goalText}`,
      hasData: chart.bars.some((b) => b.value !== null),
    },
    burned: sum.kcalPerDay === null ? null : `Спалено ≈${NBSP}${f0(sum.kcalPerDay)}${NBSP}ккал на день`,
  };
}

/** An average-kcal cell: lavender above the goal, mint within it, a faint «—» without data. */
function kcalStat(label: string, avg: number | null, goal: number): StatItem {
  if (avg === null) return { label, value: DASH, tone: 'faint' };
  return { label, value: f0(avg), unit: 'ккал', tone: kcalTone(avg, goal) === 'over' ? 'acc' : 'acc2' };
}

/**
 * D19: average Б · Ж · В per day of [from, today], each over the days where that macronutrient is known for every
 * meal (`macroAverages`, D22), so a legacy block or a hand-typed meal without macros never reads as a low day.
 */
function macroStrip(data: AppData, from: ISODate, today: ISODate, period: Period): MacroStripModel {
  const avg = macroAverages(data, from, today);
  const base = { caption: MACROS_CAPTION + MACRO_PERIOD[period], label: MACROS_LABEL };
  if (avg.days === 0) return { ...base, items: null, empty: NO_MACROS_IN_PERIOD };
  // Same goal rule as the day totals (`macroParts`): over = the rounded average is above the goal.
  const items = macroParts(avg, data.settings.macroGoals).map((p): StatItem => {
    // «Білки · ціль 90 г»: the label wraps only after the dot; the unit stays «г» so the value fits a 320px column.
    const label = p.goal === null ? p.name : `${p.name}${PART_SEPARATOR}ціль${NBSP}${p.goal}${NBSP}г`;
    if (!p.known) return { label, value: p.value, tone: 'faint' };
    return { label, value: p.value, unit: 'г', tone: p.over ? 'acc' : 'ink' };
  });
  return { ...base, items, empty: null };
}

function nutritionModel(
  data: AppData,
  from: ISODate,
  today: ISODate,
  opts: ProgressOptions,
  period: PeriodMeta,
): NutritionModel {
  const goal = data.settings.kcalGoal;
  const chart = kcalBars(data, opts.period, today);
  const avg = kcalAverages(data, today, opts.period);
  const history = kcalHistory(data, opts.historyLimit, chart.max);
  const dayHref = opts.dayHref ?? calendarDayHref;
  return {
    goal: `ціль ${f0(goal)} ккал`,
    // The period's own average is in the summary sentence above, so it is not repeated here.
    stats: [kcalStat('Сер. цього тижня', avg.week, goal), kcalStat('Сер. цього місяця', avg.month, goal)],
    macros: macroStrip(data, from, today, opts.period),
    bars: chart.bars,
    goalPct: chart.goalPct,
    gap: chart.gap,
    labeled: chart.labeled,
    note: chart.note,
    hasBarData: chart.bars.some((b) => b.value !== null),
    chartLabel:
      `Калорії ${period.short}${chart.note ? ', середнє за тиждень' : ''}, ` + `ціль ${f0(goal)} ккал`,
    history: history.items.map(({ date, kcal, tone }) => ({
      date,
      label: `${DOW_SHORT[weekdayOf(date)]}, ${dLong(date)}`,
      value: `${f0(kcal)} ккал`,
      tone,
      ariaLabel: `${dLong(date)}: ${f0(kcal)} ккал. Відкрити в календарі`,
      href: dayHref(date),
    })),
    hasMore: history.items.length < history.total,
  };
}
