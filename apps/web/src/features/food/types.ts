import type { FoodEstimateItem, FoodUse } from '@legko/shared';

/**
 * What the record sheet's old food block received when a meal was added (an AI estimate line or a
 * «Часті страви» chip). The meal editor no longer produces it; kept so that block still compiles
 * until it moves to the meal editor (docs/meals-macros.md §8.2).
 */
export interface FoodAdd {
  /** Ready-to-insert line for the day's food text, e.g. «Борщ (300 г), хліб (1 шматок) — 420 ккал». */
  line: string;
  /**
   * The not-yet-estimated tail of the «Що я їла» text that this estimate was made from
   * (see `unestimatedTail`). The sheet replaces that tail with `line`; '' → append `line` on a new line.
   */
  consumed: string;
  /** Calories to add to the day's total. */
  kcal: number;
  /** Stored photo to attach to the day (photo diary), when the estimate came from a photo. */
  photoId: string | null;
  items: FoodEstimateItem[];
  /**
   * «Часті страви» usage to record — the SHEET commits these as `food.use` ops when the day is
   * saved (and drops them when the draft is discarded). FoodAssist never commits them itself.
   */
  uses: FoodUse[];
}
