/**
 * View model of the «Мій прогрес» screen (prototype `renderVals`, «progress» part): every value is
 * computed by `@/lib/stats` and formatted here, so the components only lay strings out.
 */
import {
  dLong,
  f0,
  f1,
  fN,
  MINUS,
  sgn,
  type AppData,
  type ISODate,
  type MeasureKey,
} from '@legko/shared';
import {
  changeTone,
  chartGeometry,
  kcalAverages,
  kcalBars,
  kcalHistory,
  MEASURE_LABELS,
  measureSummary,
  periodMeta,
  periodStart,
  rangeStats,
  seriesInRange,
  typeRanking,
  weightSummary,
  workoutStats,
  type ChangeTone,
  type ChartGeometry,
  type DatedValue,
  type KcalBar,
  type Period,
  type PeriodMeta,
  type WeightSummary,
} from '@/lib/stats';
import type { Tone } from '@/ui';

/** Rows added by each «Показати ще» in «Історія калорій». */
export const HISTORY_PAGE = 7;

/** A labelled value: summary rows and the paper tiles. `tone` unset = inherit (ink). */
export interface ValueCell {
  label: string;
  value: string;
  tone?: Tone;
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

export interface HistoryRowModel {
  date: ISODate;
  /** «15 вересня» */
  label: string;
  /** «1 650 ккал» */
  value: string;
  pct: number;
  tone: 'acc' | 'acc2';
  ariaLabel: string;
  /** Calendar route of that day. */
  href: string;
}

export interface ProgressModel {
  period: PeriodMeta;
  summary: ValueCell[];
  weight: { tiles: ValueCell[]; chart: LineChartModel };
  measures: { rows: MeasureRowModel[]; chart: LineChartModel; chartLabel: string };
  workouts: { tiles: ValueCell[]; typesHeading: string; types: TypeBarModel[] };
  nutrition: NutritionModel;
}

export interface NutritionModel {
  /** «ціль 1 700 ккал» */
  goal: string;
  tiles: ValueCell[];
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

export interface ProgressOptions {
  period: Period;
  /** Parameter shown in the «Заміри тіла» chart. */
  measure: MeasureKey;
  /** Rows of «Історія калорій». */
  historyLimit: number;
}

const DASH = '—';
const CHART_VIEWBOX_HEIGHT = 120;
const CHANGE_TONES: Readonly<Record<ChangeTone, Tone>> = { down: 'acc2', up: 'acc', flat: 'ink' };

export const toneOfChange = (n: number | null): Tone => CHANGE_TONES[changeTone(n)];

/** «−0,4 кг» / «+1 см» / «—», toned like the prototype's `tone()`. */
function changeCell(label: string, n: number | null, unit: string, f: (x: number) => string = fN): ValueCell {
  return { label, value: n === null ? DASH : `${sgn(n, f)} ${unit}`, tone: toneOfChange(n) };
}

export function buildProgressModel(data: AppData, today: ISODate, opts: ProgressOptions): ProgressModel {
  const period = periodMeta(opts.period);
  const from = periodStart(data, opts.period, today);
  return {
    period,
    summary: summaryRows(data, from, today),
    weight: weightModel(data, from),
    measures: measuresModel(data, from, opts.measure),
    workouts: workoutsModel(data, from, today, period),
    nutrition: nutritionModel(data, today, opts, period),
  };
}

function summaryRows(data: AppData, from: ISODate, today: ISODate): ValueCell[] {
  const r = rangeStats(data, from, today);
  return [
    { label: 'Тренувань', value: String(r.trainings), tone: 'ink' },
    { label: 'Середня калорійність', value: r.avgKcal === null ? DASH : `${f0(r.avgKcal)} ккал`, tone: 'ink' },
    changeCell('Зміна ваги', r.weightChange, 'кг', f1),
    changeCell('Талія', r.waistChange, 'см'),
    changeCell('Стегна', r.hipsChange, 'см'),
    changeCell('Груди', r.chestChange, 'см'),
  ];
}

/** «Втрачено»: mint like the prototype; a gain is shown with a minus in lavender. */
function lostCell(lost: number | null): ValueCell {
  const label = 'Втрачено';
  if (lost === null) return { label, value: DASH };
  if (lost < -0.04) return { label, value: `${MINUS}${f1(-lost)} кг`, tone: 'acc' };
  return { label, value: `${f1(Math.max(0, lost))} кг`, tone: 'acc2' };
}

function weightTiles(w: WeightSummary): ValueCell[] {
  return [
    { label: 'Початкова', value: w.first ? f1(w.first.kg) : DASH },
    { label: 'Поточна', value: w.last ? f1(w.last.kg) : DASH },
    { label: 'Цільова', value: f1(w.goal) },
    lostCell(w.lost),
    { label: 'Залишилось', value: w.left === null ? DASH : `${f1(w.left)} кг` },
    // Without any weigh-in there is no way travelled yet («0%» would read as a result).
    w.last ? { label: 'Шлях', value: `${Math.round(w.pct)}%`, tone: 'acc' } : { label: 'Шлях', value: DASH },
  ];
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

function weightModel(data: AppData, from: ISODate): ProgressModel['weight'] {
  return {
    tiles: weightTiles(weightSummary(data)),
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
      deltaTone: has ? toneOfChange(delta) : 'faint',
      selected: key === selected,
      ariaLabel: has ? `${label}: ${fN(first)} → ${fN(last)} см, зміна ${deltaText}` : `${label}: замірів ще немає`,
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

function workoutsModel(
  data: AppData,
  from: ISODate,
  today: ISODate,
  period: PeriodMeta,
): ProgressModel['workouts'] {
  const w = workoutStats(data, today);
  return {
    tiles: [
      { label: 'Всього', value: String(w.total) },
      { label: 'Цього тижня', value: String(w.thisWeek) },
      { label: 'Цього місяця', value: String(w.thisMonth) },
      { label: 'В середньому / тиж.', value: fN(w.avgPerWeek) },
    ],
    typesHeading: `Найчастіше · ${period.short}`,
    types: typeRanking(data, from, today).map((t) => ({ label: t.label, value: String(t.n), pct: t.pct })),
  };
}

function nutritionModel(data: AppData, today: ISODate, opts: ProgressOptions, period: PeriodMeta): NutritionModel {
  const goal = data.settings.kcalGoal;
  const chart = kcalBars(data, opts.period, today);
  const avg = kcalAverages(data, today, opts.period);
  const history = kcalHistory(data, opts.historyLimit, chart.max);
  return {
    goal: `ціль ${f0(goal)} ккал`,
    tiles: [
      { label: 'Цей тиждень', value: f0(avg.week) },
      { label: 'Цей місяць', value: f0(avg.month) },
      { label: 'Період', value: f0(avg.period) },
    ],
    bars: chart.bars,
    goalPct: chart.goalPct,
    gap: chart.gap,
    labeled: chart.labeled,
    note: chart.note,
    hasBarData: chart.bars.some((b) => b.value !== null),
    chartLabel:
      `Калорії ${period.short}${chart.note ? ', середнє за тиждень' : ''}, ` +
      `ціль ${f0(goal)} ккал`,
    history: history.items.map(({ date, kcal, pct, tone }) => ({
      date,
      label: dLong(date),
      value: `${f0(kcal)} ккал`,
      pct,
      tone: tone === 'over' ? 'acc' : 'acc2',
      ariaLabel: `${dLong(date)}: ${f0(kcal)} ккал. Відкрити в календарі`,
      href: `/calendar?date=${date}`,
    })),
    hasMore: history.items.length < history.total,
  };
}
