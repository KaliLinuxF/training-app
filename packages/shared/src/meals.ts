/**
 * Meals of a day and their macronutrients (docs/meals-macros.md §2.4, §2.5, §2.8). Pure helpers shared by the
 * client and the server. The day reducers that use them live in `ops.ts` (this module never imports it).
 */
import { isValidHM, minutesOf } from './dates';
import { LIMITS } from './schemas';
import type { DayEntry, HM, MacroGrams, MacroKey, Meal, MealItem } from './types';

/** Id of the meal a legacy day's food becomes (and of the pseudo-meal that shows it). */
export const LEGACY_MEAL_ID = 'legacy';

/** Б · Ж · В order. */
export const MACRO_KEYS: readonly MacroKey[] = ['protein', 'fat', 'carbs'];

/** Title of an untyped meal that has neither text nor positions (in the derived day text). */
const UNNAMED_MEAL = 'Прийом їжі';

export const emptyMacros = (): MacroGrams => ({ protein: null, fat: null, carbs: null });

/** `-0` never leaves these helpers (JSON would turn it into `0` and break deep equality). */
const noNegZero = (n: number): number => (n === 0 ? 0 : n);

/** Rounds to 0.5 g and clamps to [0, max]; non-finite / null / undefined → null. */
export function roundMacro(v: number | null | undefined, max: number = LIMITS.macro.max): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return noNegZero(Math.min(max, Math.max(0, Math.round(v * 2) / 2)));
}

/** Per key: sum of the known values (rounded, clamped to `max`), null when none is known. */
export function sumMacros(list: readonly MacroGrams[], max: number = Number.POSITIVE_INFINITY): MacroGrams {
  const out = emptyMacros();
  for (const key of MACRO_KEYS) {
    let sum: number | null = null;
    for (const m of list) {
      const v = m[key];
      if (typeof v === 'number' && Number.isFinite(v)) sum = (sum ?? 0) + v;
    }
    out[key] = roundMacro(sum, max);
  }
  return out;
}

/** Whole kcal within the schema limits; non-finite → null. */
function clampKcal(v: number | null | undefined): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null;
  return noNegZero(Math.min(LIMITS.kcal.max, Math.max(LIMITS.kcal.min, Math.round(v))));
}

/** Trims and cuts to `max` UTF-16 units without leaving half of a surrogate pair. */
function clip(value: string, max: number): string {
  let s = value.trim();
  if (s.length <= max) return s;
  s = s.slice(0, max);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return s.trim();
}

/** Trimmed position with clamped kcal and rounded macros; null for a nameless one. */
export function normalizeMealItem(item: MealItem): MealItem | null {
  const name = typeof item.name === 'string' ? clip(item.name, LIMITS.foodName) : '';
  if (!name) return null;
  return {
    name,
    portion: typeof item.portion === 'string' ? clip(item.portion, LIMITS.portion) : '',
    kcal: clampKcal(item.kcal) ?? 0,
    protein: roundMacro(item.protein),
    fat: roundMacro(item.fat),
    carbs: roundMacro(item.carbs),
  };
}

/**
 * Trimmed type (single spaces, ≤ 30) and text, valid time or null, de-duplicated photos (omitted when none),
 * normalised positions (omitted when none); with positions kcal and macros are their sums (kcal clamped to
 * LIMITS.kcal.max, macros to LIMITS.mealMacro.max). Returns null for an EMPTY meal: no text, no kcal, no macro,
 * no photo, no position (a type alone is empty).
 */
export function normalizeMeal(meal: Meal): Meal | null {
  const type = clip(String(meal.type ?? '').replace(/\s+/g, ' '), LIMITS.mealTypeName);
  const text = clip(String(meal.text ?? ''), LIMITS.text);
  const time = typeof meal.time === 'string' && isValidHM(meal.time) ? meal.time : null;
  const photos = [...new Set(Array.isArray(meal.photos) ? meal.photos : [])].slice(0, LIMITS.photosPerDay);
  const items = (Array.isArray(meal.items) ? meal.items : [])
    .map(normalizeMealItem)
    .filter((i): i is MealItem => i !== null)
    .slice(0, LIMITS.mealItems);

  let kcal: number | null;
  let macros: MacroGrams;
  if (items.length) {
    kcal = clampKcal(items.reduce((sum, i) => sum + i.kcal, 0));
    macros = sumMacros(items, LIMITS.mealMacro.max);
  } else {
    kcal = clampKcal(meal.kcal);
    macros = {
      protein: roundMacro(meal.protein, LIMITS.mealMacro.max),
      fat: roundMacro(meal.fat, LIMITS.mealMacro.max),
      carbs: roundMacro(meal.carbs, LIMITS.mealMacro.max),
    };
  }

  const empty =
    !text &&
    kcal === null &&
    MACRO_KEYS.every((k) => macros[k] === null) &&
    photos.length === 0 &&
    items.length === 0;
  if (empty) return null;

  const out: Meal = { id: meal.id, type, time, text, kcal, ...macros };
  if (photos.length) out.photos = photos;
  if (items.length) out.items = items;
  return out;
}

/** No text, no kcal, no macro, no photo, no position (see `normalizeMeal`). */
export const isEmptyMeal = (meal: Meal): boolean => normalizeMeal(meal) === null;

/** The day carries a (non-empty) meal list. */
export const hasMeals = (day: DayEntry | undefined): day is DayEntry & { meals: Meal[] } =>
  !!day && Array.isArray(day.meals) && day.meals.length > 0;

/** No `meals` and some food text, kcal or photos. */
export function hasLegacyFood(day: DayEntry | undefined): boolean {
  if (!day || hasMeals(day)) return false;
  return (
    (typeof day.food === 'string' && day.food.trim() !== '') ||
    day.kcal != null ||
    (day.photos?.length ?? 0) > 0
  );
}

/** The legacy food as a pseudo-meal { id: LEGACY_MEAL_ID, type: '', time: null, text: food, kcal, photos, macros null }. */
export function legacyMeal(day: DayEntry): Meal | null {
  if (!hasLegacyFood(day)) return null;
  const meal: Meal = {
    id: LEGACY_MEAL_ID,
    type: '',
    time: null,
    text: typeof day.food === 'string' ? day.food.trim() : '',
    kcal: day.kcal,
    ...emptyMacros(),
  };
  if (day.photos?.length) meal.photos = [...day.photos];
  return meal;
}

/** What every UI lists: `day.meals`, or `[legacyMeal(day)]`, or []. Defensive (non-array → legacy / []). */
export function mealsOf(day: DayEntry | undefined): Meal[] {
  if (!day) return [];
  if (hasMeals(day)) return day.meals;
  const legacy = legacyMeal(day);
  return legacy ? [legacy] : [];
}

/**
 * «тост з тунцем, кава»: the text on one line (each non-empty line, a trailing «,» / «;» dropped, joined by «, »),
 * else the position names joined by «, », else ''.
 */
export const mealContent = (meal: Meal): string => mealContentParts(meal).join(', ');

/** The parts `mealContent` joins: the non-empty text lines (trailing «,» / «;» dropped), else the position names. */
export function mealContentParts(meal: Meal): string[] {
  const lines = String(meal.text ?? '')
    .split('\n')
    .map((line) =>
      line
        .trim()
        .replace(/[,;]+$/, '')
        .trim(),
    )
    .filter(Boolean);
  if (lines.length) return lines;
  return (meal.items ?? []).map((i) => i.name.trim()).filter(Boolean);
}

/** One line (or block) of the derived day text for a meal. */
function mealDigest(meal: Meal): string {
  if (meal.type) {
    const content = mealContent(meal);
    return content ? `${meal.type}: ${content}` : meal.type;
  }
  const text = meal.text.trim();
  if (text) return text;
  return mealContent(meal) || UNNAMED_MEAL;
}

/** §2.5: the derived day food / kcal / photos of a list of normalised meals. */
export function deriveDayFood(meals: readonly Meal[]): {
  food: string;
  kcal: number | null;
  photos: string[];
} {
  const food = clip(meals.map(mealDigest).join('\n'), LIMITS.text);
  let kcal: number | null = null;
  for (const m of meals)
    if (typeof m.kcal === 'number' && Number.isFinite(m.kcal)) kcal = (kcal ?? 0) + m.kcal;
  const photos = [...new Set(meals.flatMap((m) => m.photos ?? []))].slice(0, LIMITS.photosPerDay);
  return { food, kcal: clampKcal(kcal), photos };
}

/** Sum of the meals' macros (legacy day → all null). */
export const dayMacros = (day: DayEntry | undefined): MacroGrams => sumMacros(mealsOf(day));

/**
 * D22. With positions: every position with kcal > 0 has `key`. Without: `meal[key] !== null`. A meal with
 * (kcal ?? 0) === 0 and no positions is ignored (true).
 */
export function mealMacroComplete(meal: Meal, key: MacroKey): boolean {
  if (meal.items?.length) return meal.items.every((i) => !(i.kcal > 0) || i[key] !== null);
  if ((meal.kcal ?? 0) === 0) return true;
  return meal[key] !== null;
}

/** Every meal of `mealsOf(day)` is complete for `key` (an empty / missing day → true). */
export const dayMacroComplete = (day: DayEntry | undefined, key: MacroKey): boolean =>
  mealsOf(day).every((m) => mealMacroComplete(m, key));

// ---- type preselection (§2.8) ----------------------------------------------------------------

/** Case- and spacing-insensitive identity of a meal type label. */
export const mealTypeKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');

type Period = 'breakfast' | 'lunch' | 'afternoon' | 'dinner' | 'late' | 'night';

/** breakfast 04:00–10:59 · lunch 11:00–15:59 · afternoon 16:00–16:59 · dinner 17:00–21:59 · late 22:00–23:59 · night 00:00–03:59 */
function periodOf(time: HM): Period {
  const m = minutesOf(time);
  if (m < 4 * 60) return 'night';
  if (m < 11 * 60) return 'breakfast';
  if (m < 16 * 60) return 'lunch';
  if (m < 17 * 60) return 'afternoon';
  if (m < 22 * 60) return 'dinner';
  return 'late';
}

/** The three main meals, in the order their default types come in (also their positions in an all-custom list). */
const SLOTS = ['breakfast', 'lunch', 'dinner'] as const;
type Slot = (typeof SLOTS)[number];

/** Stems matched against the folded label (Ukrainian first, then Russian and English). */
const KEYWORDS: Record<Slot | 'snack', RegExp> = {
  breakfast: /сніданок|ранк|ранок|завтрак|breakfast/,
  lunch: /обід|обед|ланч|lunch/,
  // «вечер» covers «Вечеря» and the Russian «Вечер»; «вечір» covers «Вечір», «Вечірній прийом», «Вечірня їжа».
  dinner: /вечер|вечір|ужин|dinner|supper/,
  // Afternoon snacks: «Полуденок», «Полудник», «Підвечірок» (uk), «Полдник» (ru). «Полудень» (noon) is not one.
  snack: /перекус|полуденок|полудник|підвечір|полдник|snack/,
};

/** The exact default name of each main meal (it wins over an earlier keyword match). */
const SLOT_DEFAULT: Record<Slot, string> = { breakfast: 'Сніданок', lunch: 'Обід', dinner: 'Вечеря' };

/** The main meal a period asks for (16:xx and the night ask for none). */
const PRIMARY: Record<Period, Slot | null> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  afternoon: null,
  dinner: 'dinner',
  late: 'dinner',
  night: null,
};

/** The nearest earlier main meal, used when the period's own one is taken and she has no snack type. */
const FALLBACK: Record<Period, Slot> = {
  breakfast: 'breakfast',
  lunch: 'lunch',
  afternoon: 'lunch',
  dinner: 'dinner',
  late: 'dinner',
  night: 'dinner',
};

export interface SuggestMealTypeInput {
  /** Her meal types, in chip order. */
  types: readonly string[];
  /** Types of the day's meals already logged. */
  logged: readonly string[];
  /** Device-local `HH:MM` when the date is today, otherwise null. */
  time: HM | null;
}

/**
 * The type a new meal starts with (always changeable), docs/meals-macros.md §2.8.
 *
 * - Main meals: Сніданок 04–10, Обід 11–15, Вечеря 17–23. Each is her type with the default name, else the first
 *   one whose name has the meal's stem (snack types never count as a main meal). A main meal no name matches takes
 *   the type at its position (1st / 2nd / 3rd) unless that type already is another meal's, so a renamed list like
 *   «Ранок · День · Вечір» still gets «День» at lunch time.
 * - The period's main meal already logged → another type of the same meal not logged yet («Другий сніданок»), else
 *   the snack type; 16:xx and the night → the snack type; without one, the nearest earlier main meal.
 * - All-custom names → by position. No time (not today) → the first type not logged yet. `[]` → ''.
 */
export function suggestMealType({ types, logged, time }: SuggestMealTypeInput): string {
  const n = types.length;
  if (n === 0) return '';
  const last = types[n - 1] ?? '';
  const loggedKeys = new Set(logged.map(mealTypeKey));
  const isLogged = (t: string): boolean => loggedKeys.has(mealTypeKey(t));
  const isSnack = (t: string): boolean => KEYWORDS.snack.test(mealTypeKey(t));
  /** «Перекус після обіду» and «Підвечірок» are snacks, not a lunch / a dinner. */
  const isMeal = (t: string, slot: Slot): boolean => !isSnack(t) && KEYWORDS[slot].test(mealTypeKey(t));
  const byName = (slot: Slot): string | undefined =>
    types.find((t) => mealTypeKey(t) === mealTypeKey(SLOT_DEFAULT[slot])) ?? types.find((t) => isMeal(t, slot));

  const named: Record<Slot, string | undefined> = {
    breakfast: byName('breakfast'),
    lunch: byName('lunch'),
    dinner: byName('dinner'),
  };
  const S = types.find(isSnack);

  if (time === null || !isValidHM(time)) return types.find((t) => !isLogged(t)) ?? S ?? last;

  const period = periodOf(time);
  const known = [named.breakfast, named.lunch, named.dinner, S].filter((t): t is string => t !== undefined);
  if (known.length) {
    const claimed = new Set(known.map(mealTypeKey));
    /** The named type of a main meal, else the type at its position when no other meal has it. */
    const typeOf = (slot: Slot): string | undefined => {
      const byPosition = types[SLOTS.indexOf(slot)];
      return (
        named[slot] ?? (byPosition !== undefined && !claimed.has(mealTypeKey(byPosition)) ? byPosition : undefined)
      );
    };
    const wanted = PRIMARY[period];
    if (wanted !== null) {
      const main = typeOf(wanted);
      if (main !== undefined && !isLogged(main)) return main;
      const another = types.find((t) => !isLogged(t) && isMeal(t, wanted));
      if (another !== undefined) return another;
    }
    return S ?? typeOf(FALLBACK[period]) ?? types[0] ?? '';
  }

  // All custom names: by position.
  const at = (i: number): string => types[Math.min(i, n - 1)] ?? last;
  switch (period) {
    case 'breakfast':
      return at(0);
    case 'lunch':
      return at(1);
    case 'dinner':
    case 'late':
      return at(2);
    case 'afternoon':
    case 'night':
      return last;
  }
}
