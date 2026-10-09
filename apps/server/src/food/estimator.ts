import { foodEstimateResultSchema, LIMITS, type FoodEstimateItem } from '@legko/shared';

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

/** The AI model behind `POST /api/food/estimate`. Tests inject a fake. */
export interface FoodEstimator {
  /** Throws `FoodAiError` on every failure. */
  estimate(input: FoodEstimateInput): Promise<FoodEstimate>;
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
  items: { name: string; portion: string; kcal: number }[];
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

/**
 * Makes model output fit the API contract (lengths, whole non-negative kcal, item count),
 * then validates it with `foodEstimateResultSchema`. Throws `ai_failed` if it still does not fit.
 */
export function sanitizeEstimate(raw: RawEstimate): FoodEstimate {
  const items = raw.items
    .map((item) => ({
      name: clip(item.name, LIMITS.foodName),
      portion: clip(item.portion, LIMITS.portion),
      kcal: clampKcal(item.kcal),
    }))
    .filter((item) => item.name !== '')
    .slice(0, MAX_ITEMS);
  const result = foodEstimateResultSchema.safeParse({ items, comment: clip(raw.comment, MAX_COMMENT) });
  if (!result.success) throw new FoodAiError('ai_failed', 'model output does not match the result schema');
  return result.data;
}

export const totalKcal = (items: readonly FoodEstimateItem[]): number =>
  items.reduce((sum, item) => sum + item.kcal, 0);
