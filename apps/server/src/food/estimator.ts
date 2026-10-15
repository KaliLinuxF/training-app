import {
  foodEstimateResultSchema,
  LIMITS,
  roundMacro,
  type FoodEstimateItem,
  type FoodRecalcItem,
  type MacroGrams,
} from '@legko/shared';

/** What the estimate is made from: a description, a photo, or both. */
export interface FoodEstimateInput {
  /** What she wrote, already trimmed; may be empty when a photo is sent. */
  text: string;
  /** Full-size JPEG as base64 (no `data:` prefix). */
  imageBase64: string | null;
}

export interface FoodEstimate {
  items: FoodEstimateItem[];
  comment: string;
}

/** Her corrected positions to price again (SPEC §3.7, «✨ Перерахувати»). */
export interface FoodRecalcInput {
  /** Names and portions exactly as she wrote them (trimmed), 1–30 items. They are authoritative. */
  items: readonly FoodRecalcItem[];
  /** The stored full-size JPEG as base64, for context only (how it was cooked), or null. */
  imageBase64: string | null;
}

/** New energy and macros for the sent items: `kcal[i]` and `macros[i]` belong to `items[i]`. */
export interface FoodRecalculation {
  kcal: number[];
  macros: MacroGrams[];
  comment: string;
}

/** The AI model behind `POST /api/food/estimate`. Tests inject a fake. */
export interface FoodEstimator {
  /** Identifies the items in a description and/or photo. Throws `FoodAiError` on every failure. */
  estimate(input: FoodEstimateInput): Promise<FoodEstimate>;
  /**
   * Prices exactly the given items without renaming, merging, splitting or reordering them:
   * one kcal value and one set of macros per item, same order. Throws `FoodAiError` on every failure.
   */
  recalculate(input: FoodRecalcInput): Promise<FoodRecalculation>;
}

export type FoodAiErrorCode = 'ai_unavailable' | 'ai_failed';

/** `ai_unavailable` → 503 (e.g. the key was rejected), `ai_failed` → 502 (try again / describe in text). */
export class FoodAiError extends Error {
  override name = 'FoodAiError';
  constructor(
    readonly code: FoodAiErrorCode,
    /** Short reason for the server log; never contains user content. */
    readonly reason: string,
  ) {
    super(`${code}: ${reason}`);
  }
}

/** Raw model output, before clean-up (shape of the structured-output schema). */
export interface RawEstimate {
  items: { name: string; portion: string; kcal: number; protein: number; fat: number; carbs: number }[];
  comment: string;
}

const MAX_ITEMS = 30;
const MAX_COMMENT = 300;

/** Trims and cuts to `max` UTF-16 units without leaving half of a surrogate pair. */
export function clip(value: string, max: number): string {
  let s = value.trim();
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return s.trim();
}

export function clampKcal(kcal: number): number {
  if (!Number.isFinite(kcal)) return 0;
  return Math.min(LIMITS.kcal.max, Math.max(LIMITS.kcal.min, Math.round(kcal)));
}

/** Grams of one macronutrient: 0.5 g steps within 0–1 000 g; anything that is not a finite number → null. */
export function clampMacro(grams: unknown): number | null {
  return typeof grams === 'number' && Number.isFinite(grams) ? roundMacro(grams, LIMITS.macro.max) : null;
}

/** The three macros of one model item (a missing or non-finite value → null). */
const macrosOf = (item: { protein?: unknown; fat?: unknown; carbs?: unknown }): MacroGrams => ({
  protein: clampMacro(item.protein),
  fat: clampMacro(item.fat),
  carbs: clampMacro(item.carbs),
});

/**
 * Makes model output fit the API contract (lengths, whole non-negative kcal, 0.5 g macros, item count),
 * then validates it with `foodEstimateResultSchema`. Throws `ai_failed` if it still does not fit.
 * No kcal ↔ macro consistency rewriting (alcohol has energy without macros); the prompt asks for it.
 */
export function sanitizeEstimate(raw: RawEstimate): FoodEstimate {
  const items = raw.items
    .map((item) => ({
      name: clip(item.name, LIMITS.foodName),
      portion: clip(item.portion, LIMITS.portion),
      kcal: clampKcal(item.kcal),
      ...macrosOf(item),
    }))
    .filter((item) => item.name !== '')
    .slice(0, MAX_ITEMS);
  const result = foodEstimateResultSchema.safeParse({ items, comment: clip(raw.comment, MAX_COMMENT) });
  if (!result.success) throw new FoodAiError('ai_failed', 'model output does not match the result schema');
  return result.data;
}

/**
 * Model output for a recalculation → one whole kcal and one set of macros per sent item, taken by index
 * (the model's own names and portions are ignored). Throws `ai_failed` unless there is exactly one item each.
 */
export function sanitizeRecalculation(raw: RawEstimate, expected: number): FoodRecalculation {
  if (raw.items.length !== expected) {
    throw new FoodAiError('ai_failed', `model returned ${raw.items.length} items for ${expected}`);
  }
  return {
    kcal: raw.items.map((item) => clampKcal(item.kcal)),
    macros: raw.items.map(macrosOf),
    comment: clip(raw.comment, MAX_COMMENT),
  };
}

/**
 * Her items with the new energy and macros: names and portions exactly as sent (trimmed), same order,
 * `kcal[i]` / `macros[i]` clamped to the API limits (missing macros → null). Throws `ai_failed` when the
 * kcal count differs.
 */
export function applyRecalculation(
  items: readonly FoodRecalcItem[],
  recalc: FoodRecalculation,
): FoodEstimate {
  if (recalc.kcal.length !== items.length) {
    throw new FoodAiError('ai_failed', `got ${recalc.kcal.length} kcal values for ${items.length} items`);
  }
  return {
    items: items.map((item, i): FoodEstimateItem => ({
      name: item.name.trim(),
      portion: item.portion.trim(),
      kcal: clampKcal(recalc.kcal[i] ?? Number.NaN),
      ...macrosOf(recalc.macros[i] ?? {}),
    })),
    comment: clip(recalc.comment, MAX_COMMENT),
  };
}

export const totalKcal = (items: readonly FoodEstimateItem[]): number =>
  items.reduce((sum, item) => sum + item.kcal, 0);
