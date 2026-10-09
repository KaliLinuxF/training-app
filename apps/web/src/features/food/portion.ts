/**
 * Portions as «<amount> <unit>» (SPEC §3.7): what the device reads, rescales and composes back.
 * - mass (г/кг) and volume (мл/л) compare across the units of their group («0,5 кг» = «500 г»);
 * - counts (шт, скибка, ложка, порція, чашка, склянка, тарілка, шматок) compare only within one unit
 *   («2 скибки» → «3 скибки», never «скибка» → «шт»).
 * Anything else («2 ст. л.», «велика тарілка», «пів л», «200-250 г») is free text the model prices.
 * Pure; no React.
 */
import { LIMITS, num } from '@legko/shared';
import { pluralUk } from './model';

/** Units the device converts between (grams, millilitres). */
export type PortionGroup = 'mass' | 'volume';
export type UnitGroup = PortionGroup | 'count';

/** Canonical units: the editor's chips and how a portion is composed («150 г», «2 скибки»). */
export type UnitKey =
  'г' | 'кг' | 'мл' | 'л' | 'шт' | 'скибка' | 'ложка' | 'порція' | 'чашка' | 'склянка' | 'тарілка' | 'шматок';

interface UnitInfo {
  group: UnitGroup;
  /** To grams / millilitres; 1 for counts. */
  factor: number;
  /** After a number: 1 · 2–4 · 5+ · a fraction («1,5 порції», «0,5 шматка»). */
  forms: readonly [one: string, few: string, many: string, fraction: string];
  /** What − / + add or take away. */
  step: number;
  /** − does not go below it (she can still type less). */
  min: number;
  /** Decimals an amount is rounded to. */
  decimals: number;
  /** + from an empty amount. */
  start: number;
  /** Ways she (or the model) may spell it: Ukrainian first, then Russian and Latin out of habit. */
  aliases: readonly string[];
}

const same = (u: string) => [u, u, u, u] as const;

const UNITS: Readonly<Record<UnitKey, UnitInfo>> = {
  г: {
    group: 'mass',
    factor: 1,
    forms: same('г'),
    step: 10,
    min: 10,
    decimals: 0,
    start: 100,
    aliases: ['г', 'гр', 'грам', 'грама', 'грами', 'грамів', 'грамм', 'грамма', 'граммов', 'g', 'gr'],
  },
  кг: {
    group: 'mass',
    factor: 1000,
    forms: same('кг'),
    step: 0.1,
    min: 0.1,
    decimals: 2,
    start: 0.5,
    aliases: ['кг', 'kg'],
  },
  мл: {
    group: 'volume',
    factor: 1,
    forms: same('мл'),
    step: 50,
    min: 50,
    decimals: 0,
    start: 250,
    aliases: ['мл', 'ml'],
  },
  л: {
    group: 'volume',
    factor: 1000,
    forms: same('л'),
    step: 0.1,
    min: 0.1,
    decimals: 2,
    start: 0.5,
    aliases: ['л', 'l', 'літр', 'літра', 'літри', 'літрів'],
  },
  шт: {
    group: 'count',
    factor: 1,
    forms: same('шт'),
    step: 1,
    min: 1,
    decimals: 2,
    start: 1,
    aliases: ['шт', 'штука', 'штуки', 'штук', 'штуку', 'pcs'],
  },
  скибка: {
    group: 'count',
    factor: 1,
    forms: ['скибка', 'скибки', 'скибок', 'скибки'],
    step: 1,
    min: 1,
    decimals: 2,
    start: 1,
    aliases: ['скибка', 'скибки', 'скибок', 'скибку', 'ломтик', 'ломтика', 'ломтиков'],
  },
  ложка: {
    group: 'count',
    factor: 1,
    forms: ['ложка', 'ложки', 'ложок', 'ложки'],
    step: 1,
    // «пів ложки» is a usual amount.
    min: 0.5,
    decimals: 2,
    start: 1,
    aliases: ['ложка', 'ложки', 'ложок', 'ложку'],
  },
  порція: {
    group: 'count',
    factor: 1,
    forms: ['порція', 'порції', 'порцій', 'порції'],
    step: 1,
    // «пів порції» too.
    min: 0.5,
    decimals: 2,
    start: 1,
    aliases: ['порція', 'порції', 'порцій', 'порцію', 'порция', 'порции', 'порций'],
  },
  чашка: {
    group: 'count',
    factor: 1,
    forms: ['чашка', 'чашки', 'чашок', 'чашки'],
    step: 1,
    min: 1,
    decimals: 2,
    start: 1,
    aliases: ['чашка', 'чашки', 'чашок', 'чашку'],
  },
  склянка: {
    group: 'count',
    factor: 1,
    forms: ['склянка', 'склянки', 'склянок', 'склянки'],
    step: 1,
    min: 1,
    decimals: 2,
    start: 1,
    aliases: ['склянка', 'склянки', 'склянок', 'склянку', 'стакан', 'стакана', 'стаканов'],
  },
  тарілка: {
    group: 'count',
    factor: 1,
    forms: ['тарілка', 'тарілки', 'тарілок', 'тарілки'],
    step: 1,
    min: 1,
    decimals: 2,
    start: 1,
    aliases: ['тарілка', 'тарілки', 'тарілок', 'тарілку', 'тарелка', 'тарелки', 'тарелок'],
  },
  шматок: {
    group: 'count',
    factor: 1,
    forms: ['шматок', 'шматки', 'шматків', 'шматка'],
    step: 1,
    min: 1,
    decimals: 2,
    start: 1,
    aliases: ['шматок', 'шматки', 'шматків', 'шматка', 'кусок', 'куска', 'кусков'],
  },
};

/** The editor's unit chips, in this order (any other unit of the portion is shown after them). */
export const BASIC_UNITS: readonly UnitKey[] = ['г', 'мл', 'шт', 'ложка', 'скибка', 'порція'];

const ALIASES: ReadonlyMap<string, UnitKey> = new Map(
  (Object.keys(UNITS) as UnitKey[]).flatMap((key) =>
    UNITS[key].aliases.map((alias) => [alias, key] as const),
  ),
);

/** Larger amounts are not food portions (and keep the composed text short). */
export const MAX_AMOUNT = 9999;

export interface PortionParts {
  /** As written: 1.5 for «1,5 кг», 2 for «2 скибки». */
  amount: number;
  unit: UnitKey;
}

export interface PortionAmount {
  /** Grams for `mass`, millilitres for `volume`. */
  amount: number;
  group: PortionGroup;
}

/**
 * «~250 гр», «≈ 1,5 кг», «300мл», «250 г.», «2 скибки», «шт.», «тарілка»: an optional «about» sign,
 * one number (optional before a count), one unit word.
 */
const PORTION = /^[~≈]?\s*(?:(\d+(?:[.,]\d+)?)\s*)?(\p{L}+)\.?$/u;

/** Amount and unit of a portion, or null when it is not one number and one known unit. */
export function readPortion(portion: string): PortionParts | null {
  const text = portion.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');
  const match = PORTION.exec(text);
  if (!match) return null;
  const [, value, unitText = ''] = match;
  const unit = ALIASES.get(unitText);
  if (!unit) return null;
  // A bare count is one of it («тарілка»); a bare «г» says nothing.
  if (value === undefined) return UNITS[unit].group === 'count' ? { amount: 1, unit } : null;
  const amount = Number(value.replace(',', '.'));
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return { amount, unit };
}

/** Amount of a measurable portion, or null when it is not one number in г/кг/мл/л. */
export function parsePortion(portion: string): PortionAmount | null {
  const parts = readPortion(portion);
  if (!parts) return null;
  const { group, factor } = UNITS[parts.unit];
  if (group === 'count') return null;
  return { amount: parts.amount * factor, group };
}

export const unitGroup = (unit: UnitKey): UnitGroup => UNITS[unit].group;

/** `to` as a multiple of `from`, or null when they cannot be compared (other group, or another count). */
export function portionRatio(from: PortionParts, to: PortionParts): number | null {
  const a = UNITS[from.unit];
  const b = UNITS[to.unit];
  if (a.group !== b.group) return null;
  if (a.group === 'count' && from.unit !== to.unit) return null;
  return (to.amount * b.factor) / (from.amount * a.factor);
}

/**
 * Kcal for `portion` scaled from a confirmed `base` (same dish), or null when the two portions
 * cannot be compared on the device (free text, grams against millilitres, «шт» against «скибки»).
 */
export function scaleKcal(base: { portion: string; kcal: number }, portion: string): number | null {
  const from = readPortion(base.portion);
  const to = readPortion(portion);
  const ratio = from && to ? portionRatio(from, to) : null;
  if (ratio === null) return null;
  const kcal = Math.round(base.kcal * ratio);
  return Math.min(LIMITS.kcal.max, Math.max(LIMITS.kcal.min, kcal));
}

const round = (n: number, decimals: number): number => {
  const k = 10 ** decimals;
  return Math.round(n * k) / k;
};

/** An amount rounded the way the unit is written (whole grams, up to 2 decimals otherwise). */
export const roundAmount = (amount: number, unit: UnitKey): number => round(amount, UNITS[unit].decimals);

/** «1,5», «0,15», «300»: comma decimals, no trailing zeros. */
export function formatAmount(amount: number): string {
  return String(round(amount, 2)).replace('.', ',');
}

/** The unit's form after `amount`: 1 скибка · 2 скибки · 5 скибок · 1,5 скибки; «г», «шт» never change. */
export function unitForm(unit: UnitKey, amount: number): string {
  const [one, few, many, fraction] = UNITS[unit].forms;
  const n = round(amount, 2);
  if (!Number.isInteger(n)) return fraction;
  return pluralUk(n, one, few, many);
}

/** The portion text: «150 г», «2 скибки», «1,5 порції». */
export function composePortion(amount: number, unit: UnitKey): string {
  const n = roundAmount(amount, unit);
  return `${formatAmount(n)} ${unitForm(unit, n)}`;
}

/** − / + step of a unit: г 10, мл 50, кг and л 0,1, counts 1. */
export const amountStep = (unit: UnitKey): number => UNITS[unit].step;

/**
 * The amount after − (dir −1) or + (dir 1): the next multiple of the step (125 г + → 130 г), or null
 * when that way is closed (− at the smallest amount, + at the largest). + from nothing starts the
 * unit's usual amount (100 г, 1 шт).
 */
export function stepAmount(amount: number | null, unit: UnitKey, dir: 1 | -1): number | null {
  const { step, min, start } = UNITS[unit];
  // Float noise: 0,3 / 0,1 is 2,9999…
  const eps = 1e-9;
  if (amount === null || amount <= 0) return dir > 0 ? start : null;
  if (dir > 0) {
    if (amount >= MAX_AMOUNT) return null;
    return Math.min(MAX_AMOUNT, round(Math.floor(amount / step + eps) * step + step, 2));
  }
  const down = round(Math.ceil(amount / step - eps) * step - step, 2);
  if (down >= min) return down;
  return amount > min ? min : null;
}

/** «½ · ×1 · 1½ · ×2» of the amount the model (or the frequent dish) gave. */
export const MULTIPLIERS = [
  { factor: 0.5, label: '½' },
  { factor: 1, label: '×1' },
  { factor: 1.5, label: '1½' },
  { factor: 2, label: '×2' },
] as const;

/**
 * `ref` times `factor`, or null when that makes no sense for the unit: half of «1 шт» or «1 скибка»
 * (halves are fine for «порція» and «ложка», and for «3 шт» → «1,5 шт»).
 */
export function multiplyAmount(ref: PortionParts, factor: number): PortionParts | null {
  const amount = roundAmount(ref.amount * factor, ref.unit);
  const { group, min } = UNITS[ref.unit];
  if (amount <= 0 || amount > MAX_AMOUNT || (group === 'count' && amount < min)) return null;
  return { amount, unit: ref.unit };
}

/**
 * The amount when she picks another unit: converted within its group (300 г → 0,3 кг), kept between
 * counts (2 скибки → 2 шт), else the new unit's usual amount (300 г → 1 шт). Empty stays empty.
 */
export function convertAmount(amount: number | null, from: UnitKey, to: UnitKey): number | null {
  if (amount === null) return null;
  const a = UNITS[from];
  const b = UNITS[to];
  if (from === to) return amount;
  if (a.group === 'count' && b.group === 'count') return amount;
  if (a.group === b.group) return Math.min(MAX_AMOUNT, roundAmount((amount * a.factor) / b.factor, to));
  return b.start;
}

/** What the amount field keeps: digits and one decimal separator, at most 4 + 2 digits. */
export function sanitizeAmountInput(text: string): string {
  const cleaned = text.replace(/[^\d.,]/g, '');
  const sep = cleaned.search(/[.,]/);
  if (sep < 0) return cleaned.slice(0, 4);
  const whole = cleaned.slice(0, sep).slice(0, 4);
  const fraction = cleaned
    .slice(sep + 1)
    .replace(/[.,]/g, '')
    .slice(0, 2);
  return `${whole}${cleaned[sep]}${fraction}`;
}

/** The amount field as a number: positive, else null («», «0», «,»). */
export function parseAmount(text: string): number | null {
  const n = num(text);
  return n !== null && n > 0 ? n : null;
}
