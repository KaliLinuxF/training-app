/**
 * Pure view helpers for meals and macros (Б · Ж · В): totals of a day, short lines, screen-reader sentences and
 * goal states. Screens only lay these out (docs/meals-macros.md §6.2).
 *
 * Line breaks: every part keeps its letter, number and unit together with NO-BREAK SPACEs («Б 68», «132 г»,
 * «3 прийоми»), and a NO-BREAK SPACE also precedes each « ·» separator, with a normal space after it — so a line
 * can only wrap right after a «·». The copy never says «БЖУ»: always «Б · Ж · В» or the words.
 */
import {
  dayMacroComplete,
  dayMacros,
  f0,
  fN,
  hasLegacyFood,
  LEGACY_MEAL_ID,
  MACRO_KEYS,
  mealsOf,
  mealTypeKey,
  ok,
  type DayEntry,
  type MacroGoals,
  type MacroGrams,
  type MacroKey,
  type Meal,
} from '@legko/shared';

/** U+00A0: keeps a number with its letter or unit on one line. */
export const NBSP = ' ';
/** « · » between parts: the only place a macro line may wrap (after the dot). */
export const PART_SEPARATOR = `${NBSP}· `;

export interface MacroLabel {
  /** «Білки» — headings, field labels. */
  name: string;
  /** «Б» — compact lines. */
  abbr: string;
  /** «білки» — inside sentences (screen reader). */
  lower: string;
}

export const MACRO_LABELS: Readonly<Record<MacroKey, MacroLabel>> = {
  protein: { name: 'Білки', abbr: 'Б', lower: 'білки' },
  fat: { name: 'Жири', abbr: 'Ж', lower: 'жири' },
  carbs: { name: 'Вуглеводи', abbr: 'В', lower: 'вуглеводи' },
};

const known = (g: number | null | undefined): g is number => ok(g);

/** Grams for display: whole grams with digit grouping («68», «1 240»), or «12,5» when `precise`; unknown → «—». */
export function gramsText(g: number | null | undefined, precise = false): string {
  if (!known(g)) return '—';
  return precise ? fN(g) : f0(g);
}

export interface DayNutrition {
  /** What the day lists: its meals, or the legacy block as one pseudo-meal, or none. */
  meals: Meal[];
  /** The food was logged before meals existed (one untyped block «Їжа за день»). */
  legacy: boolean;
  count: number;
  /** The day's kcal (derived from the meals), null when none has kcal. */
  kcal: number | null;
  /** Sums of what is known per macronutrient. */
  macros: MacroGrams;
  /** Some macronutrient is known. */
  hasMacros: boolean;
  /** D22: per macronutrient, every meal is complete (`dayMacroComplete`). */
  complete: Record<MacroKey, boolean>;
}

export function dayNutrition(day: DayEntry | undefined): DayNutrition {
  const meals = mealsOf(day);
  const macros = dayMacros(day);
  const kcal = day?.kcal;
  return {
    meals,
    legacy: hasLegacyFood(day),
    count: meals.length,
    kcal: known(kcal) ? kcal : null,
    macros,
    hasMacros: MACRO_KEYS.some((k) => macros[k] !== null),
    complete: {
      protein: dayMacroComplete(day, 'protein'),
      fat: dayMacroComplete(day, 'fat'),
      carbs: dayMacroComplete(day, 'carbs'),
    },
  };
}

export interface MacroPart {
  key: MacroKey;
  abbr: string;
  name: string;
  /** «68», or «—» when unknown. */
  value: string;
  /** The goal as text («90»), or null without a goal. */
  goal: string | null;
  known: boolean;
  /** Known, with a goal, and the rounded value is above it (styled like kcal over: lavender, never red). */
  over: boolean;
  /** Known, but some meal with energy lacks this macronutrient (the sum is a lower bound, D22). */
  partial: boolean;
}

/** Always three parts, in the order Б · Ж · В. */
export function macroParts(
  m: MacroGrams,
  goals?: MacroGoals,
  complete?: Record<MacroKey, boolean>,
): MacroPart[] {
  return MACRO_KEYS.map((key): MacroPart => {
    const grams = m[key];
    const goal = goals?.[key] ?? null;
    const isKnown = known(grams);
    return {
      key,
      abbr: MACRO_LABELS[key].abbr,
      name: MACRO_LABELS[key].name,
      value: gramsText(grams),
      goal: known(goal) ? f0(goal) : null,
      known: isKnown,
      over: isKnown && known(goal) && Math.round(grams) > goal,
      partial: isKnown && complete?.[key] === false,
    };
  });
}

/**
 * «Б 68 · Ж 41 · В 132 г»; with goals «Б 68/90 · Ж 41/60 · В 132 г» (a goal only on the parts that have one and a
 * value); an unknown part is «Б —»; the unit follows the last known part. Null when none is known.
 */
export function macroLine(m: MacroGrams, goals?: MacroGoals): string | null {
  const parts = macroParts(m, goals);
  let lastKnown = -1;
  parts.forEach((p, i) => {
    if (p.known) lastKnown = i;
  });
  if (lastKnown < 0) return null;
  return parts
    .map((p, i) => {
      const value = p.known && p.goal !== null ? `${p.value}/${p.goal}` : p.value;
      return `${p.abbr}${NBSP}${value}${i === lastKnown ? `${NBSP}г` : ''}`;
    })
    .join(PART_SEPARATOR);
}

/**
 * For accessible names: «білки 68 з 90 г, жири 41 з 60 г, вуглеводи 132 г»; an over-goal part adds
 * « (більше цілі)» (no colour-only meaning); unknown parts are left out; null when none is known.
 */
export function macroSpeech(m: MacroGrams, goals?: MacroGoals): string | null {
  const parts = macroParts(m, goals).filter((p) => p.known);
  if (!parts.length) return null;
  return parts
    .map((p) => {
      const goal = p.goal !== null ? ` з ${p.goal}` : '';
      return `${MACRO_LABELS[p.key].lower} ${p.value}${goal} г${p.over ? ' (більше цілі)' : ''}`;
    })
    .join(', ');
}

/** none = no goal · empty = no value · ok = below · reached = equal · over = above (rounded grams). */
export type MacroGoalState = 'none' | 'empty' | 'ok' | 'reached' | 'over';

export interface MacroGoalView {
  state: MacroGoalState;
  /** Bar fill 0–100 (capped; 0 without a goal or a value). */
  pct: number;
  /** «68», or «—». */
  value: string;
  /** «90», or null without a goal. */
  goal: string | null;
  /** «Білки: 68 з 90 г» · «Білки: 68 г» · «Білки: 95 з 90 г, більше цілі» · «Білки: ще не пораховано, ціль 90 г». */
  label: string;
}

export function macroGoalView(key: MacroKey, grams: number | null, goal: number | null): MacroGoalView {
  const { name } = MACRO_LABELS[key];
  const value = gramsText(grams);
  const g = known(goal) && goal > 0 ? goal : null;
  const goalText = g !== null ? f0(g) : null;
  if (!known(grams)) {
    return {
      state: g === null ? 'none' : 'empty',
      pct: 0,
      value,
      goal: goalText,
      label: g === null ? `${name}: ще не пораховано` : `${name}: ще не пораховано, ціль ${goalText} г`,
    };
  }
  if (g === null) return { state: 'none', pct: 0, value, goal: null, label: `${name}: ${value} г` };
  const rounded = Math.round(grams);
  const state: MacroGoalState = rounded > g ? 'over' : rounded === g ? 'reached' : 'ok';
  return {
    state,
    pct: Math.min(100, Math.max(0, (rounded / g) * 100)),
    value,
    goal: goalText,
    label: `${name}: ${value} з ${goalText} г${state === 'over' ? ', більше цілі' : ''}`,
  };
}

/** The meal's heading: its type, else «Їжа за день» for a legacy / old-client block, else «Прийом їжі». */
export function mealTitle(meal: Meal): string {
  if (meal.type.trim()) return meal.type;
  if (meal.id === LEGACY_MEAL_ID || meal.id.startsWith('old-')) return 'Їжа за день';
  return 'Прийом їжі';
}

/** «1 прийом», «3 прийоми», «5 прийомів», «11 прийомів», «21 прийом» (number and word joined by a NBSP). */
export function mealCountText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'прийом'
      : mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)
        ? 'прийоми'
        : 'прийомів';
  return `${n}${NBSP}${word}`;
}

/** The type chips of the meal editor: her list, plus the meal's own label when it is not in it (any case). */
export function mealTypeChoices(mealTypes: readonly string[], current: string): string[] {
  const label = current.trim();
  if (!label || mealTypes.some((t) => mealTypeKey(t) === mealTypeKey(label))) return [...mealTypes];
  return [...mealTypes, label];
}
