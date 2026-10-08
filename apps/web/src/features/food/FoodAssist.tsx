import type { ISODate } from '@legko/shared';
import type { FoodAdd } from './types';

export interface FoodAssistProps {
  /** Day being edited (sent with the estimate request; used for «Часті страви» `lastUsed`). */
  date: ISODate;
  /** Called when she confirms an estimate or taps a frequent dish. FoodAssist records `food.use` itself. */
  onAdd: (add: FoodAdd) => void;
}

/**
 * «✨ Порахувати» / «📷 Фото» + «Часті страви» block under the «Що я їла» textarea (SPEC §3.7).
 * Phase stub — implemented by the food-web task. Renders nothing until then.
 */
export function FoodAssist(_props: FoodAssistProps) {
  return null;
}
