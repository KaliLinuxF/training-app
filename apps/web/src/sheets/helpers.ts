import { DOW_LONG, dLong, dLongYear, f1, fN, num, ok, weekdayOf, type AppData, type ISODate } from '@legko/shared';
import { MEASURE_KEYS, type MeasureTexts } from './validation';

/** Asked before a dirty draft is thrown away (close, backdrop, Escape, drag, day navigation). */
export const DISCARD_PROMPT = 'Є незбережені зміни. Закрити без збереження?';

/** `true` when it is fine to drop the draft: nothing changed, or she confirmed. */
export function confirmDiscard(dirty: boolean): boolean {
  return !dirty || window.confirm(DISCARD_PROMPT);
}

/** Fallback base for the weight stepper when there is no weigh-in at all (prototype: 60). */
export const DEFAULT_STEP_WEIGHT = 60;

/** Latest weigh-in overall, kg. */
export function latestWeight(data: AppData): number | null {
  const last = data.weights[data.weights.length - 1];
  return last && ok(last.kg) ? last.kg : null;
}

/** «Попереднє: 3 жовтня — 65,6 кг» (last weigh-in before `date`) or the morning tip. */
export function weightHint(data: AppData, date: ISODate): string {
  let prev: AppData['weights'][number] | undefined;
  for (const w of data.weights) if (w.date < date && ok(w.kg)) prev = w;
  return prev ? `Попереднє: ${dLong(prev.date)} — ${f1(prev.kg)} кг` : 'Найточніше — зранку, натщесерце';
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

/** ±step on a weight input; empty input starts from `base` (latest weigh-in, else 60). Result «65,5». */
export function stepWeight(text: string, base: number | null, delta: number): string {
  return f1((num(text) ?? base ?? DEFAULT_STEP_WEIGHT) + delta);
}

/** ±50 on the kcal input, never below zero. */
export function stepKcal(text: string, delta: number): string {
  return String(Math.max(0, (num(text) ?? 0) + delta));
}

/** Sheet header: «10 жовтня 2026» and «субота · сьогодні». */
export function sheetDateLabels(date: ISODate, today: ISODate): { date: string; weekday: string } {
  return {
    date: dLongYear(date),
    weekday: `${DOW_LONG[weekdayOf(date)]}${date === today ? ' · сьогодні' : ''}`,
  };
}
