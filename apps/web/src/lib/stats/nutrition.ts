import {
  dayMacroComplete,
  dayMacros,
  MACRO_KEYS,
  type AppData,
  type ISODate,
  type MacroGrams,
  type MacroKey,
} from '@legko/shared';
import { daysInRange, mean } from './common';

export interface MacroAverages extends MacroGrams {
  /** Days in range counted for at least one macronutrient. */
  days: number;
}

/**
 * Average Б · Ж · В per day over [from, to]. Per macronutrient: the mean of the day totals over the days where that
 * total is known AND the day is complete for it (`dayMacroComplete`, D22) — a legacy block or a hand-typed meal
 * without macros leaves the day out, so a partial day never drags the average down. `null` = no such day.
 */
export function macroAverages(data: AppData, from: ISODate, to: ISODate): MacroAverages {
  const values: Record<MacroKey, number[]> = { protein: [], fat: [], carbs: [] };
  let days = 0;
  for (const { entry } of daysInRange(data, from, to)) {
    const totals = dayMacros(entry);
    let counted = false;
    for (const key of MACRO_KEYS) {
      const v = totals[key];
      if (v === null || !dayMacroComplete(entry, key)) continue;
      values[key].push(v);
      counted = true;
    }
    if (counted) days++;
  }
  return { protein: mean(values.protein), fat: mean(values.fat), carbs: mean(values.carbs), days };
}
