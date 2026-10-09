/**
 * View model of the «Мій прогрес» screen (prototype `renderVals`, «progress» part): every value is
 * computed by `@/lib/stats` and formatted here, so the components only lay strings out.
 */
import {
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
import {
  chartGeometry,
  kcalAverages,
  kcalBars,
  kcalHistory,
  kcalTone,
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
} from '@/lib/stats';
import { deltaTone, type PillTone, type StatItem, type Tone } from '@/ui';

/** Rows of «Історія калорій» before the first «Показати ще». */
export const HISTORY_FIRST = 3;
/** Rows added by each «Показати ще». */
export const HISTORY_PAGE = 7;
/** Workout types listed under «Найчастіше». */
export const TYPES_SHOWN = 5;

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

export interface WorkoutsModel {
  /** Всього · Цього тижня · Цього місяця · В сер. / тиж. */
  stats: StatItem[];
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
  /** Calendar route of that day. */
  href: string;
}

export interface NutritionModel {
  /** «ціль 1 700 ккал» */
  goal: string;
  /** «Сер. цього тижня» · «Сер. цього місяця» */
  stats: StatItem[];
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

export interface ProgressModel {
  period: PeriodMeta;
  summary: SummaryModel;
  weight: WeightModel;
  measures: { rows: MeasureRowModel[]; chart: LineChartModel; chartLabel: string };
  workouts: WorkoutsModel;
  nutrition: NutritionModel;
}

export interface ProgressOptions {
  period: Period;
  /** Parameter shown in the «Заміри тіла» chart. */
  measure: MeasureKey;
  /** Rows of «Історія калорій». */
  historyLimit: number;
}

export function buildProgressModel(data: AppData, today: ISODate, opts: ProgressOptions): ProgressModel {
  const period = periodMeta(opts.period);
  const from = periodStart(data, opts.period, today);
  return {
    period,
    summary: summaryModel(data, from, today, period),
    weight: weightModel(data, from),
    measures: measuresModel(data, from, opts.measure),
    workouts: workoutsModel(data, from, today, period),
    nutrition: nutritionModel(data, today, opts, period),
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

function weightModel(data: AppData, from: ISODate): WeightModel {
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
      hintNone: 'Запиши перше зважування, щоб бачити динаміку',
      hintOne: 'Потрібно щонайменше два зважування',
    }),
  };
}

function measuresModel(data: AppData, from: ISODate, selected: MeasureKey): ProgressModel['measures'] {
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
      hintNone: 'Запиши заміри, щоб бачити динаміку',
      hintOne: 'Потрібно щонайменше два заміри',
    }),
  };
}

function workoutsModel(data: AppData, from: ISODate, today: ISODate, period: PeriodMeta): WorkoutsModel {
  const w = workoutStats(data, today);
  return {
    stats: [
      { label: 'Всього', value: f0(w.total) },
      { label: 'Цього тижня', value: f0(w.thisWeek) },
      { label: 'Цього місяця', value: f0(w.thisMonth) },
      { label: 'В сер. / тиж.', value: fN(w.avgPerWeek) },
    ],
    typesHeading: `Найчастіше · ${period.short}`,
    types: typeRanking(data, from, today)
      .slice(0, TYPES_SHOWN)
      .map((t) => ({ label: t.label, value: String(t.n), pct: t.pct })),
  };
}

/** An average-kcal cell: lavender above the goal, mint within it, a faint «—» without data. */
function kcalStat(label: string, avg: number | null, goal: number): StatItem {
  if (avg === null) return { label, value: DASH, tone: 'faint' };
  return { label, value: f0(avg), unit: 'ккал', tone: kcalTone(avg, goal) === 'over' ? 'acc' : 'acc2' };
}

function nutritionModel(
  data: AppData,
  today: ISODate,
  opts: ProgressOptions,
  period: PeriodMeta,
): NutritionModel {
  const goal = data.settings.kcalGoal;
  const chart = kcalBars(data, opts.period, today);
  const avg = kcalAverages(data, today, opts.period);
  const history = kcalHistory(data, opts.historyLimit, chart.max);
  return {
    goal: `ціль ${f0(goal)} ккал`,
    // The period's own average is in the summary sentence above, so it is not repeated here.
    stats: [kcalStat('Сер. цього тижня', avg.week, goal), kcalStat('Сер. цього місяця', avg.month, goal)],
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
      href: `/calendar?date=${date}`,
    })),
    hasMore: history.items.length < history.total,
  };
}
