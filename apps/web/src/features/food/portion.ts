/**
 * Portions the device can rescale by itself: one amount in a measurable unit (г/кг or мл/л).
 * «2 скибки», «1 шт» or «тарілка» are not measurable here — the model prices those (SPEC §3.7).
 */
import { LIMITS } from '@legko/shared';

export type PortionGroup = 'mass' | 'volume';

export interface PortionAmount {
  /** Grams for `mass`, millilitres for `volume`. */
  amount: number;
  group: PortionGroup;
}

interface Unit {
  group: PortionGroup;
  /** Multiplier to grams / millilitres. */
  factor: number;
}

const GRAM: Unit = { group: 'mass', factor: 1 };
const KILO: Unit = { group: 'mass', factor: 1000 };
const ML: Unit = { group: 'volume', factor: 1 };
const LITRE: Unit = { group: 'volume', factor: 1000 };

/** Ukrainian spellings first; Russian and Latin ones she may type out of habit. */
const UNITS: ReadonlyMap<string, Unit> = new Map([
  ...['г', 'гр', 'грам', 'грама', 'грами', 'грамів', 'грамм', 'грамма', 'граммов', 'g', 'gr'].map(
    (u) => [u, GRAM] as const,
  ),
  ...['кг', 'kg'].map((u) => [u, KILO] as const),
  ...['мл', 'ml'].map((u) => [u, ML] as const),
  ...['л', 'l', 'літр', 'літра', 'літри', 'літрів'].map((u) => [u, LITRE] as const),
]);

/** «~250 гр», «≈ 1,5 кг», «300мл», «250 г.»: an optional «about» sign, one number, one unit. */
const PORTION = /^[~≈]?\s*(\d+(?:[.,]\d+)?)\s*(\p{L}+)\.?$/u;

/** Amount of a measurable portion, or null when it is not one number in г/кг/мл/л. */
export function parsePortion(portion: string): PortionAmount | null {
  const text = portion.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');
  const match = PORTION.exec(text);
  if (!match) return null;
  const [, value = '', unitText = ''] = match;
  const unit = UNITS.get(unitText);
  if (!unit) return null;
  const amount = Number(value.replace(',', '.')) * unit.factor;
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, group: unit.group };
}

/**
 * Kcal for `portion` scaled from a confirmed `base` (same dish), or null when the two portions
 * cannot be compared on the device (not measurable, or grams against millilitres).
 */
export function scaleKcal(base: { portion: string; kcal: number }, portion: string): number | null {
  const from = parsePortion(base.portion);
  const to = parsePortion(portion);
  if (!from || !to || from.group !== to.group) return null;
  const kcal = Math.round((base.kcal * to.amount) / from.amount);
  return Math.min(LIMITS.kcal.max, Math.max(LIMITS.kcal.min, kcal));
}
