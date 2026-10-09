import { LIMITS, num, type MeasureKey } from '@legko/shared';

/** Inline error copy shown under a field (13px, `--accD`). */
export const FIELD_ERRORS = {
  kg: `Вага — від ${LIMITS.kg.min} до ${LIMITS.kg.max} кг`,
  cm: `Заміри — від ${LIMITS.cm.min} до ${LIMITS.cm.max} см`,
  kcal: 'Калорії — не більше 20 000 ккал',
  kcalGoal: 'Від 500 до 10 000 ккал на день',
  goalRequired: 'Вкажи цільову вагу',
  kcalGoalRequired: 'Вкажи калорії на день',
} as const;

/** Measurement inputs in display order (chest · waist · hips). */
export const MEASURE_KEYS: readonly MeasureKey[] = ['chest', 'waist', 'hips'];

export type MeasureTexts = Record<MeasureKey, string>;

const inRange = (n: number | null, min: number, max: number): boolean => n != null && n >= min && n <= max;

/** Optional number field: empty is fine, otherwise it must parse and fall within [min, max]. */
function optionalRange(text: string, min: number, max: number, message: string): string | undefined {
  if (!text.trim()) return undefined;
  return inRange(num(text), min, max) ? undefined : message;
}

export const kgError = (text: string): string | undefined =>
  optionalRange(text, LIMITS.kg.min, LIMITS.kg.max, FIELD_ERRORS.kg);

export const kcalError = (text: string): string | undefined =>
  optionalRange(text, LIMITS.kcal.min, LIMITS.kcal.max, FIELD_ERRORS.kcal);

export const cmError = (text: string): string | undefined =>
  optionalRange(text, LIMITS.cm.min, LIMITS.cm.max, FIELD_ERRORS.cm);

/** The three tiles share one message; `invalid` lists the tiles to mark `aria-invalid`. */
export interface MeasureError {
  message: string | undefined;
  invalid: MeasureKey[];
}

export function measureError(values: Readonly<MeasureTexts>): MeasureError {
  const invalid = MEASURE_KEYS.filter((k) => cmError(values[k]) !== undefined);
  return { message: invalid.length ? FIELD_ERRORS.cm : undefined, invalid };
}

/** Parsed measurement values, `null` for empty inputs. */
export function measureValues(values: Readonly<MeasureTexts>): Record<MeasureKey, number | null> {
  return { chest: num(values.chest), waist: num(values.waist), hips: num(values.hips) };
}

/** Kcal input accepts digits only (the prototype's `onKcal`). */
export const digitsOnly = (text: string): string => text.replace(/[^\d]/g, '');
