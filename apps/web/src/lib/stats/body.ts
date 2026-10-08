import { ok, type AppData, type MeasureEntry, type MeasureKey, type WeightEntry } from '@legko/shared';
import { byDateAsc, readings } from './common';

/** Body measurements in display order with their Ukrainian labels. */
export const MEASURE_PARAMS: readonly { key: MeasureKey; label: string }[] = [
  { key: 'chest', label: 'Груди' },
  { key: 'waist', label: 'Талія' },
  { key: 'hips', label: 'Стегна' },
];

export const MEASURE_LABELS: Readonly<Record<MeasureKey, string>> = {
  chest: 'Груди',
  waist: 'Талія',
  hips: 'Стегна',
};

export interface WeightSummary {
  /** Earliest weigh-in (start weight). */
  first: WeightEntry | null;
  /** Latest weigh-in (current weight). */
  last: WeightEntry | null;
  /** Target weight from settings, kg. */
  goal: number;
  /** `first − last` (positive = lost); `null` without weigh-ins. */
  lost: number | null;
  /** `max(0, last − goal)`; `null` without weigh-ins. */
  left: number | null;
  /**
   * Progress towards the goal, 0–100, unrounded (use it as a bar width; round it for the label).
   * 0 when the start weight is not above the goal.
   */
  pct: number;
}

/** Start / current / goal weight and the way travelled so far. */
export function weightSummary(data: AppData): WeightSummary {
  const weights = byDateAsc(data.weights);
  const first = weights[0] ?? null;
  const last = weights.at(-1) ?? null;
  const goal = data.settings.goal;
  if (!first || !last) return { first: null, last: null, goal, lost: null, left: null, pct: 0 };
  const lost = first.kg - last.kg;
  const pct = first.kg > goal ? clamp((lost / (first.kg - goal)) * 100, 0, 100) : 0;
  return { first, last, goal, lost, left: Math.max(0, last.kg - goal), pct };
}

export interface MeasureParamSummary {
  key: MeasureKey;
  /** «Груди» | «Талія» | «Стегна» */
  label: string;
  /** First recorded value of this parameter, cm. */
  first: number | null;
  /** Latest recorded value of this parameter, cm. */
  last: number | null;
  /** `last − first` (negative = smaller); `null` when never recorded, 0 with a single reading. */
  delta: number | null;
}

export interface MeasureSummary {
  /** chest, waist, hips — in display order. */
  params: MeasureParamSummary[];
  /** The latest measurement entry (any parameter), e.g. for «останні заміри 6 жовтня». */
  lastEntry: MeasureEntry | null;
}

/**
 * First and latest value per parameter. Each parameter is looked up on its own, so an entry
 * that only has the waist does not hide the previous chest/hips values.
 */
export function measureSummary(data: AppData): MeasureSummary {
  const params = MEASURE_PARAMS.map(({ key, label }): MeasureParamSummary => {
    const values = readings(data, key);
    const first = values[0]?.value ?? null;
    const last = values.at(-1)?.value ?? null;
    return { key, label, first, last, delta: ok(first) && ok(last) ? last - first : null };
  });
  return { params, lastEntry: byDateAsc(data.measures).at(-1) ?? null };
}

/**
 * Colour role of a weight/measurement change (the prototype's `tone()`):
 * `down` (smaller — good, `--acc2D`), `up` (bigger, `--accD`), `flat` (|n| ≤ 0.04 or missing, `--ink`).
 */
export type ChangeTone = 'down' | 'up' | 'flat';

export function changeTone(n: number | null | undefined): ChangeTone {
  if (!ok(n)) return 'flat';
  return n < -0.04 ? 'down' : n > 0.04 ? 'up' : 'flat';
}

const clamp = (n: number, min: number, max: number): number => Math.max(min, Math.min(max, n));
