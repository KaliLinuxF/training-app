import { normalizeTypeNames } from './defaults';
import {
  deriveDayFood,
  hasLegacyFood,
  hasMeals,
  LEGACY_MEAL_ID,
  legacyMeal,
  MACRO_KEYS,
  mealContent,
  mealContentParts,
  normalizeMeal,
} from './meals';
import { LIMITS, type FoodUse, type Op } from './schemas';
import type {
  AppData,
  DayEntry,
  DayMeta,
  FoodItem,
  ISODate,
  MacroKey,
  Meal,
  MeasureValues,
  Settings,
  SettingsPut,
} from './types';

const byDate = <T extends { date: string }>(a: T, b: T): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/** Meals without a time go after the timed ones (stable: insertion order otherwise). */
const byTime = (a: Meal, b: Meal): number => {
  if (a.time === b.time) return 0;
  if (a.time === null) return 1;
  if (b.time === null) return -1;
  return a.time < b.time ? -1 : 1;
};

/** normalizeMeal each → drop empty ones → keep the first of duplicate ids → by time → at most 20. */
function normalizeMeals(meals: readonly Meal[]): Meal[] {
  const seen = new Set<string>();
  const out: Meal[] = [];
  for (const raw of meals) {
    if (typeof raw !== 'object' || raw === null) continue;
    const meal = normalizeMeal(raw);
    if (!meal || seen.has(meal.id)) continue;
    seen.add(meal.id);
    out.push(meal);
  }
  return out.sort(byTime).slice(0, LIMITS.mealsPerDay);
}

/**
 * Trims text fields, drops workout types unless a workout was marked, de-duplicates photos.
 * A day with a non-empty `meals` list: the meals are normalised (§2.5) and the day's food / kcal / photos are
 * DERIVED from them (any given values are ignored). `meals` undefined, not an array or `[]` → a legacy day,
 * exactly as before meals existed (an empty array never erases food).
 */
export function normalizeDay(e: DayEntry): DayEntry {
  const base: DayEntry = {
    food: e.food.trim(),
    kcal: e.kcal,
    trained: e.trained,
    types: e.trained === true ? [...new Set(e.types.map((t) => t.trim()).filter(Boolean))] : [],
    notes: e.notes.trim(),
  };
  if (!Array.isArray(e.meals) || e.meals.length === 0) {
    const photos = [...new Set(e.photos ?? [])];
    if (photos.length) base.photos = photos;
    return base;
  }
  const meals = normalizeMeals(e.meals);
  if (!meals.length) return { ...base, food: '', kcal: null };
  const derived = deriveDayFood(meals);
  const day: DayEntry = { ...base, food: derived.food, kcal: derived.kcal };
  if (derived.photos.length) day.photos = derived.photos;
  day.meals = meals;
  return day;
}

/** A day with nothing recorded is not stored at all. */
export const isEmptyDay = (e: DayEntry): boolean =>
  !e.food.trim() &&
  e.kcal == null &&
  e.trained === null &&
  !e.notes.trim() &&
  !e.photos?.length &&
  !(Array.isArray(e.meals) && e.meals.length > 0);

export const isEmptyMeasure = (m: MeasureValues): boolean =>
  m.chest == null && m.waist == null && m.hips == null;

// ---- day reducers (docs/meals-macros.md §2.6) -------------------------------------------------

/** The ops that change one day; `reduceDay` gives their meaning (client and server alike). */
export type DayOp = Extract<Op, { kind: 'day.put' | 'day.delete' | 'day.meta' | 'meal.put' | 'meal.delete' }>;

const DAY_OP_KINDS: ReadonlySet<Op['kind']> = new Set([
  'day.put',
  'day.delete',
  'day.meta',
  'meal.put',
  'meal.delete',
]);

export const isDayOp = (op: Op): op is DayOp => DAY_OP_KINDS.has(op.kind);

const EMPTY_DAY: DayEntry = { food: '', kcal: null, trained: null, types: [], notes: '' };

/** `undefined` = the day is deleted (nothing recorded). */
const keep = (day: DayEntry): DayEntry | undefined => (isEmptyDay(day) ? undefined : day);

/** The day without its food fields (food, kcal, photos, meals). */
function withoutFood(day: DayEntry): DayEntry {
  return { food: '', kcal: null, trained: day.trained, types: day.types, notes: day.notes };
}

/**
 * `base` with `meals` as its food. No meal left → a legacy-shaped day with food '', kcal null, no photos and no
 * `meals` key (so removing the last meal never leaves the old derived text behind).
 */
function withMeals(base: DayEntry, meals: readonly Meal[]): DayEntry {
  const kept = normalizeMeals(meals);
  if (!kept.length) return normalizeDay(withoutFood(base));
  return normalizeDay({ ...withoutFood(base), meals: kept });
}

/** The day's meals for a meal op: its list, or the legacy food converted into the untyped meal `legacy`. */
function mealsForEdit(day: DayEntry): Meal[] {
  if (hasMeals(day)) return [...day.meals];
  const legacy = legacyMeal(day);
  return legacy ? [legacy] : [];
}

/**
 * `meal.put`: replaces the meal with the same id, else appends it while the day has fewer than 20 meals (else no
 * change). A legacy day is converted first (its food becomes the untyped meal `legacy`). An empty meal is
 * dropped, i.e. deleted. Returns undefined when the day ends up empty.
 */
export function putMeal(stored: DayEntry | undefined, meal: Meal): DayEntry | undefined {
  const base = stored ?? EMPTY_DAY;
  const meals = mealsForEdit(base);
  const i = meals.findIndex((m) => m.id === meal.id);
  if (i >= 0) {
    meals[i] = meal;
  } else {
    // Nothing to add (an empty new meal) or the day is full: no change at all.
    if (normalizeMeal(meal) === null || meals.length >= LIMITS.mealsPerDay) return stored;
    meals.push(meal);
  }
  return keep(withMeals(base, meals));
}

/**
 * `meal.delete`: removes that meal (the last one gone → no food, kcal or photos left). On a legacy day the id
 * `legacy` clears its food, kcal and photos. Unknown id: no change.
 */
export function deleteMeal(stored: DayEntry | undefined, id: string): DayEntry | undefined {
  if (!stored) return undefined;
  if (hasMeals(stored)) {
    if (!stored.meals.some((m) => m.id === id)) return stored;
    return keep(
      withMeals(
        stored,
        stored.meals.filter((m) => m.id !== id),
      ),
    );
  }
  if (id === LEGACY_MEAL_ID && hasLegacyFood(stored)) return keep(normalizeDay(withoutFood(stored)));
  return stored;
}

/**
 * `day.meta`: applies only the keys present (types are kept only while trained); the food is never touched.
 * Creates no day when nothing ends up recorded.
 */
export function setDayMeta(stored: DayEntry | undefined, meta: DayMeta): DayEntry | undefined {
  const next: DayEntry = { ...(stored ?? EMPTY_DAY) };
  if (meta.trained !== undefined) next.trained = meta.trained;
  if (meta.types !== undefined) next.types = meta.types;
  if (meta.notes !== undefined) next.notes = meta.notes;
  return keep(normalizeDay(next));
}

/** Old clients' `day.delete`: deletes a legacy day; on a day with meals it clears only the mark, types and notes. */
function clearDay(stored: DayEntry | undefined): DayEntry | undefined {
  if (!stored || !hasMeals(stored)) return undefined;
  return keep(normalizeDay({ ...stored, trained: null, types: [], notes: '' }));
}

const lineKey = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');

/** 32-bit FNV-1a over UTF-16 code units: a short, deterministic id for a Rule-L meal. */
function fnv1a32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * The additive part of an old client's `day.put` on a day with meals: lines, photos and kcal the stored meals do
 * not know yet, as one untyped meal with a deterministic id (`old-…`). Pure and idempotent: once applied, the same
 * value yields null. Removals are never seen here.
 */
function legacyExtra(stored: DayEntry & { meals: Meal[] }, value: DayEntry): Meal | null {
  const known = new Set<string>();
  const learn = (s: string): void => {
    const key = lineKey(s);
    if (key) known.add(key);
  };
  for (const line of stored.food.split('\n')) learn(line);
  for (const meal of stored.meals) {
    for (const line of meal.text.split('\n')) learn(line);
    learn(mealContent(meal));
    for (const item of meal.items ?? []) learn(item.name);
    if (meal.type) {
      // Every derived line this meal had while lines were appended to it («Сніданок: тост», then
      // «Сніданок: тост, Салат» after a cap merge): an old client may still send any of them.
      learn(meal.type);
      let prefix = '';
      for (const part of mealContentParts(meal)) {
        prefix = prefix ? `${prefix}, ${part}` : part;
        learn(`${meal.type}: ${prefix}`);
      }
    }
  }

  const lines = value.food
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line !== '' && !known.has(lineKey(line)));

  const mealPhotos = new Set(stored.meals.flatMap((m) => m.photos ?? []));
  const room = Math.max(0, LIMITS.photosPerDay - mealPhotos.size);
  const photos = [...new Set(value.photos ?? [])].filter((p) => !mealPhotos.has(p)).slice(0, room);

  const storedKcal = stored.kcal ?? 0;
  const kcal = value.kcal != null && value.kcal > storedKcal ? value.kcal - storedKcal : null;

  if (!lines.length && kcal === null && !photos.length) return null;
  const meal: Meal = {
    id: `old-${fnv1a32(JSON.stringify([lines, kcal, photos])).toString(36)}`,
    type: '',
    time: null,
    text: lines.join('\n'),
    kcal,
    protein: null,
    fat: null,
    carbs: null,
  };
  if (photos.length) meal.photos = photos;
  return meal;
}

/** Index of the last meal that matches, or -1. */
function lastIndex(meals: readonly Meal[], match: (m: Meal) => boolean): number {
  for (let i = meals.length - 1; i >= 0; i--) if (match(meals[i] as Meal)) return i;
  return -1;
}

const isOldClientMeal = (m: Meal): boolean => m.id === LEGACY_MEAL_ID || m.id.startsWith('old-');

/** The extra merged into a meal without positions (at the 20-meal cap): text on a new line, kcal added, photos. */
function mergeInto(meal: Meal, extra: Meal): Meal {
  const text = [meal.text, extra.text].filter((t) => t.trim() !== '').join('\n');
  const kcal = extra.kcal === null ? meal.kcal : (meal.kcal ?? 0) + extra.kcal;
  const merged: Meal = { ...meal, text, kcal };
  const photos = [...new Set([...(meal.photos ?? []), ...(extra.photos ?? [])])];
  if (photos.length) merged.photos = photos;
  return merged;
}

/**
 * `day.put` (never carries meals). Legacy stored day (or none): today's legacy semantics. Stored day with meals:
 * **Rule L** — keep the meals, take `trained` / `types` / `notes` from the value, and add whatever new food the
 * value carries as one untyped meal (at 20 meals merged into the last meal without positions, preferring a
 * `legacy` / `old-*` one; dropped when every meal has positions).
 *
 * Known limits (tested as current behaviour): a stale old client can bring back a meal deleted elsewhere (its
 * text is unknown to the stored meals), and its own kcal increase is lost when meals were added elsewhere.
 */
export function mergeLegacyDayPut(stored: DayEntry | undefined, value: DayEntry): DayEntry | undefined {
  const { meals: _ignored, ...legacy } = value;
  if (!hasMeals(stored)) return keep(normalizeDay(legacy));

  const base: DayEntry = { ...stored, trained: legacy.trained, types: legacy.types, notes: legacy.notes };
  const meals = [...stored.meals];
  const extra = legacyExtra(stored, legacy);
  if (extra && !meals.some((m) => m.id === extra.id)) {
    if (meals.length < LIMITS.mealsPerDay) {
      meals.push(extra);
    } else {
      const plain = (m: Meal): boolean => !m.items?.length;
      let target = lastIndex(meals, (m) => plain(m) && isOldClientMeal(m));
      if (target < 0) target = lastIndex(meals, plain);
      if (target >= 0) meals[target] = mergeInto(meals[target] as Meal, extra);
    }
  }
  return keep(withMeals(base, meals));
}

/** Pure: the stored day (or undefined) after one day op; undefined = the day is deleted. */
export function reduceDay(stored: DayEntry | undefined, op: DayOp): DayEntry | undefined {
  switch (op.kind) {
    case 'day.put':
      return mergeLegacyDayPut(stored, op.value);
    case 'day.delete':
      return clearDay(stored);
    case 'day.meta':
      return setDayMeta(stored, op.value);
    case 'meal.put':
      return putMeal(stored, op.value);
    case 'meal.delete':
      return deleteMeal(stored, op.id);
  }
}

/** `settings.put`: an absent `mealTypes` / `macroGoals` (old clients) keeps the stored value. */
export function mergeSettingsPut(stored: Settings, value: SettingsPut): Settings {
  return {
    ...value,
    customTypes: normalizeTypeNames(value.customTypes),
    mealTypes: normalizeTypeNames(value.mealTypes ?? stored.mealTypes),
    macroGoals: value.macroGoals ?? stored.macroGoals,
  };
}

// ---- «Часті страви» ------------------------------------------------------------------------------

/** Case-insensitive identity of a dish name. */
export const foodKey = (name: string): string => name.trim().toLocaleLowerCase('uk');

type DishMacros = Partial<Record<MacroKey, number>>;

/** The macro keys a dish / use carries (a key is omitted when unknown). */
function dishMacros(src: DishMacros): DishMacros {
  const out: DishMacros = {};
  for (const key of MACRO_KEYS) {
    const v = src[key];
    if (typeof v === 'number' && Number.isFinite(v)) out[key] = v;
  }
  return out;
}

/**
 * Upserts a dish: count + 1, latest spelling/portion/kcal, newest `lastUsed`; keeps at most `LIMITS.foods`.
 * Macros (D13): the use's when it has any macro key; else the stored dish's when its kcal is unchanged; else none.
 */
export function useFood(foods: readonly FoodItem[], use: FoodUse, date: ISODate): FoodItem[] {
  const key = foodKey(use.name);
  const prev = foods.find((f) => foodKey(f.name) === key);
  const own = dishMacros(use);
  const macros = Object.keys(own).length ? own : prev && prev.kcal === use.kcal ? dishMacros(prev) : {};
  const next: FoodItem = {
    name: use.name.trim(),
    portion: use.portion.trim(),
    kcal: use.kcal,
    count: (prev?.count ?? 0) + 1,
    lastUsed: prev && prev.lastUsed > date ? prev.lastUsed : date,
    ...macros,
  };
  const out = foods.filter((f) => foodKey(f.name) !== key);
  out.push(next);
  if (out.length <= LIMITS.foods) return out;
  // Evict the least useful dish: fewest uses, then least recently used.
  const victim = [...out].sort((a, b) => a.count - b.count || (a.lastUsed < b.lastUsed ? -1 : 1))[0];
  return out.filter((f) => f !== victim);
}

/** «Часті страви» order: most used first, then most recently used, then name. */
export function rankFoods(foods: readonly FoodItem[]): FoodItem[] {
  return [...foods].sort(
    (a, b) =>
      b.count - a.count ||
      (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0) ||
      a.name.localeCompare(b.name, 'uk'),
  );
}

/**
 * Pure reducer shared by the client (optimistic updates, replaying the offline queue)
 * and the server (which persists the result of the same `reduceDay` / `useFood` / `mergeSettingsPut`).
 * A day op that leaves nothing recorded deletes the day; `measure.put` with no values behaves as a delete.
 */
export function applyOp(data: AppData, op: Op): AppData {
  switch (op.kind) {
    case 'day.put':
    case 'day.delete':
    case 'day.meta':
    case 'meal.put':
    case 'meal.delete': {
      const stored = data.days[op.date];
      const next = reduceDay(stored, op);
      if (next === stored) return data;
      const days = { ...data.days };
      if (next) days[op.date] = next;
      else delete days[op.date];
      return { ...data, days };
    }
    case 'weight.put': {
      const weights = data.weights.filter((w) => w.date !== op.date);
      weights.push({ date: op.date, kg: op.kg });
      weights.sort(byDate);
      return { ...data, weights };
    }
    case 'weight.delete':
      return { ...data, weights: data.weights.filter((w) => w.date !== op.date) };
    case 'measure.put': {
      const measures = data.measures.filter((m) => m.date !== op.date);
      if (!isEmptyMeasure(op.value)) measures.push({ date: op.date, ...op.value });
      measures.sort(byDate);
      return { ...data, measures };
    }
    case 'measure.delete':
      return { ...data, measures: data.measures.filter((m) => m.date !== op.date) };
    case 'settings.put':
      return { ...data, settings: mergeSettingsPut(data.settings, op.value) };
    case 'food.use':
      return { ...data, foods: useFood(data.foods, op.value, op.date) };
    case 'food.delete': {
      const key = foodKey(op.name);
      return { ...data, foods: data.foods.filter((f) => foodKey(f.name) !== key) };
    }
  }
}

export const applyOps = (data: AppData, ops: readonly Op[]): AppData => ops.reduce(applyOp, data);
