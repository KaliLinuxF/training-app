import type { FoodEstimateItem } from '@legko/shared';

/** What the day sheet receives when a meal is added (AI estimate line or a «Часті страви» chip). */
export interface FoodAdd {
  /** Ready-to-append line for the day's food text, e.g. «Борщ (300 г), хліб (1 шматок) — 420 ккал». */
  line: string;
  /** Calories to add to the day's total. */
  kcal: number;
  /** Stored photo to attach to the day (photo diary), when the estimate came from a photo. */
  photoId: string | null;
  items: FoodEstimateItem[];
}
