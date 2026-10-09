import { f0, ok } from '@legko/shared';

/** Where a day's calories stand against the daily goal. */
export type KcalGoalState = 'empty' | 'ok' | 'reached' | 'over';

export interface KcalGoalView {
  state: KcalGoalState;
  /** Bar fill 0–100 (capped; an over-goal day shows a full bar in the «over» colour). */
  pct: number;
  /** Ukrainian line under the bar. */
  text: string;
  /** Short screen-reader summary. */
  label: string;
}

/** `kcal` = the day's calories (null/0 when nothing is recorded yet), `goal` = settings.kcalGoal. */
export function kcalGoalView(kcal: number | null | undefined, goal: number): KcalGoalView {
  const g = f0(goal);
  if (!ok(kcal) || kcal <= 0 || !(goal > 0)) {
    return { state: 'empty', pct: 0, text: `Ціль — ${g} ккал на день`, label: `Ціль ${g} ккал на день` };
  }
  const pct = Math.min(100, (kcal / goal) * 100);
  const diff = Math.round(kcal - goal);
  if (diff > 0) {
    return {
      state: 'over',
      pct: 100,
      text: `Перевищено на ${f0(diff)} ккал · ціль ${g}`,
      label: `Перевищено ціль на ${f0(diff)} ккал: ${f0(kcal)} з ${g} ккал`,
    };
  }
  if (diff === 0) {
    return { state: 'reached', pct: 100, text: `Ціль досягнута — ${g} ккал`, label: `Ціль досягнута: ${g} ккал` };
  }
  return {
    state: 'ok',
    pct,
    text: `Залишилось ${f0(-diff)} з ${g} ккал`,
    label: `${f0(kcal)} з ${g} ккал, залишилось ${f0(-diff)}`,
  };
}
