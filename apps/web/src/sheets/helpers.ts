import { DOW_LONG, dLong, dLongYear, f1, fN, num, ok, weekdayOf, type AppData, type ISODate } from '@legko/shared';
import type { ConfirmOptions } from '@/store/ui';
import { MEASURE_KEYS, type MeasureTexts } from './validation';

/** Asked (in the app's own dialog) before a dirty draft is thrown away: close, backdrop, Escape, drag, deep link. */
export const DISCARD_CONFIRM: Readonly<ConfirmOptions> = {
  title: 'Є незбережені зміни',
  body: 'Закрити без збереження?',
  confirmLabel: 'Закрити',
  cancelLabel: 'Залишитись',
  destructive: true,
};

/** The same question when ‹ › moves the sheet to another day (it stays open, so «Закрити» would be wrong). */
export const DISCARD_ON_NAVIGATE_CONFIRM: Readonly<ConfirmOptions> = {
  ...DISCARD_CONFIRM,
  body: 'Перейти до іншого дня без збереження?',
  confirmLabel: 'Перейти',
};

/** Fallback base for the weight stepper when there is no weigh-in at all (prototype: 60). */
export const DEFAULT_STEP_WEIGHT = 60;

type WeighIn = AppData['weights'][number];

/** Latest weigh-in overall, kg. */
export function latestWeight(data: AppData): number | null {
  const last = data.weights[data.weights.length - 1];
  return last && ok(last.kg) ? last.kg : null;
}

/** Last weigh-in strictly before `date` (weights are kept sorted by date). */
function weighInBefore(data: AppData, date: ISODate): WeighIn | undefined {
  let prev: WeighIn | undefined;
  for (const w of data.weights) if (w.date < date && ok(w.kg)) prev = w;
  return prev;
}

/** kg of the last weigh-in before `date`: what the weigh-in sheet offers on a day without one. */
export function weightBefore(data: AppData, date: ISODate): number | null {
  return weighInBefore(data, date)?.kg ?? null;
}

/** «Попереднє: 3 жовтня — 65,6 кг» (last weigh-in before `date`) or the morning tip. */
export function weightHint(data: AppData, date: ISODate): string {
  const prev = weighInBefore(data, date);
  return prev ? `Попереднє: ${dLong(prev.date)} — ${f1(prev.kg)} кг` : 'Найточніше — зранку, натщесерце';
}

/** Where ± starts on an empty weight input: the weigh-in before that day, else the latest one. */
export function stepBaseWeight(data: AppData, date: ISODate): number | null {
  return weightBefore(data, date) ?? latestWeight(data);
}

/** Placeholders of the measurement tiles: the previous value of each parameter before `date`, else «—». */
export function measurePlaceholders(data: AppData, date: ISODate): MeasureTexts {
  const out: MeasureTexts = { chest: '—', waist: '—', hips: '—' };
  for (const key of MEASURE_KEYS) {
    for (const m of data.measures) {
      const v = m[key];
      if (m.date < date && ok(v)) out[key] = fN(v);
    }
  }
  return out;
}

/** Bounds a stepper keeps its result within (the goals use `GOAL_LIMITS`). */
export interface StepRange {
  min: number;
  max: number;
}

const clampTo = (n: number, range: StepRange | undefined): number =>
  range ? Math.min(range.max, Math.max(range.min, n)) : n;

/** ±step on a weight input; empty input starts from `base` (latest weigh-in, else 60). Result «65,5». */
export function stepWeight(text: string, base: number | null, delta: number, range?: StepRange): string {
  return f1(clampTo((num(text) ?? base ?? DEFAULT_STEP_WEIGHT) + delta, range));
}

/** ±50 on the kcal input, never below zero (nor outside `range` when given). */
export function stepKcal(text: string, delta: number, range?: StepRange): string {
  return String(clampTo(Math.max(0, (num(text) ?? 0) + delta), range));
}

/** Sheet header: «10 жовтня 2026» and «субота · сьогодні». */
export function sheetDateLabels(date: ISODate, today: ISODate): { date: string; weekday: string } {
  return {
    date: dLongYear(date),
    weekday: `${DOW_LONG[weekdayOf(date)]}${date === today ? ' · сьогодні' : ''}`,
  };
}
