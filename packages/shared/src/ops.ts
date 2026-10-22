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
import { WEEK_ORDER } from './format';
import { findExercise } from './exerciseLibrary';
import { LIMITS, type FoodUse, type Op } from './schemas';
import { compareSessions, setForKind } from './workouts';
import type {
  AppData,
  DayEntry,
  DayMeta,
  Exercise,
  FoodItem,
  ISODate,
  MacroKey,
  Meal,
  MeasureValues,
  MuscleId,
  Settings,
  SettingsPut,
  StepsEntry,
  Weekday,
  Workout,
  WorkoutItem,
  WorkoutSession,
  SessionExercise,
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

/** `settings.put`: an absent `mealTypes` / `macroGoals` / `stepsGoal` (old clients) keeps the stored value. */
export function mergeSettingsPut(stored: Settings, value: SettingsPut): Settings {
  return {
    ...value,
    customTypes: normalizeTypeNames(value.customTypes),
    mealTypes: normalizeTypeNames(value.mealTypes ?? stored.mealTypes),
    macroGoals: value.macroGoals ?? stored.macroGoals,
    stepsGoal: value.stepsGoal === undefined ? stored.stepsGoal : value.stepsGoal,
  };
}

// ---- workouts and steps (docs/workouts-steps-rebrand.md §1.3) ----------------------------------

/** Trimmed, single spaces, at most `max` characters. */
const cleanName = (name: string, max: number): string => name.trim().replace(/\s+/g, ' ').slice(0, max).trim();

const uniqueList = <T>(list: readonly T[]): T[] => [...new Set(list)];

/** Primary unique (≤ 6); secondary unique, minus primary (≤ 8). */
function cleanMuscles(primary: readonly MuscleId[], secondary: readonly MuscleId[]): Pick<Exercise, 'primary' | 'secondary'> {
  const p = uniqueList(primary).slice(0, LIMITS.primaryMuscles);
  const s = uniqueList(secondary)
    .filter((m) => !p.includes(m))
    .slice(0, LIMITS.secondaryMuscles);
  return { primary: p, secondary: s };
}

const cleanMet = (met: number): number => clampNum(Math.round(met * 10) / 10, LIMITS.met.min, LIMITS.met.max);

function clampNum(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

/** Name cleaned, muscles unique and disjoint, MET to one decimal in bounds. */
export function normalizeExercise(e: Exercise): Exercise {
  return {
    id: e.id,
    name: cleanName(e.name, LIMITS.exerciseName),
    kind: e.kind,
    ...cleanMuscles(e.primary, e.secondary),
    equipment: e.equipment,
    met: cleanMet(e.met),
  };
}

const firstOfKey = <T extends { key: string }>(list: readonly T[]): T[] => {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.key) ? false : (seen.add(x.key), true)));
};

/**
 * Name cleaned, days unique in WEEK_ORDER, duplicate item keys → first wins, ≤ 30 items / 20 sets. Items of a
 * library exercise keep only the set fields of its kind (an own exercise's kind is not known here: kept as sent).
 */
export function normalizeWorkout(w: Workout): Workout {
  const days = WEEK_ORDER.filter((d) => w.days.includes(d)) as Weekday[];
  const items = firstOfKey(w.items)
    .slice(0, LIMITS.workoutItems)
    .map((item): WorkoutItem => {
      const kind = findExercise([], item.exerciseId)?.kind;
      const sets = item.sets.slice(0, LIMITS.plannedSets).map((s) => (kind ? setForKind(kind, s) : { ...s }));
      return {
        key: item.key,
        exerciseId: item.exerciseId,
        sets,
        restSec: clampNum(Math.round(item.restSec), LIMITS.restSec.min, LIMITS.restSec.max),
      };
    });
  return { id: w.id, name: cleanName(w.name, LIMITS.workoutName), days, items };
}

function normalizeSessionExercise(e: SessionExercise): SessionExercise {
  return {
    key: e.key,
    exerciseId: e.exerciseId,
    name: cleanName(e.name, LIMITS.exerciseName),
    kind: e.kind,
    met: cleanMet(e.met),
    equipment: e.equipment,
    ...cleanMuscles(e.primary, e.secondary),
    restSec: clampNum(Math.round(e.restSec), LIMITS.restSec.min, LIMITS.restSec.max),
    skipped: e.skipped === true,
    sets: e.sets.slice(0, LIMITS.sessionSets).map((s) => ({ ...setForKind(e.kind, s), done: s.done === true })),
  };
}

/**
 * Names cleaned, duplicate exercise keys → first wins, set fields of the snapshot kind only, `status: 'active'`
 * forces `finishedAt: null`, `durationSec` rounded and clamped to 0…86 400, missing `rev` → 0, missing `deviceId` →
 * null, notes ≤ 1000.
 */
export function normalizeSession(s: WorkoutSession): WorkoutSession {
  const duration =
    typeof s.durationSec === 'number' && Number.isFinite(s.durationSec)
      ? clampNum(Math.round(s.durationSec), LIMITS.sessionSec.min, LIMITS.sessionSec.max)
      : null;
  const rev = typeof s.rev === 'number' && Number.isFinite(s.rev) ? clampNum(Math.floor(s.rev), 0, LIMITS.rev.max) : 0;
  return {
    id: s.id,
    date: s.date,
    workoutId: s.workoutId ?? null,
    name: cleanName(s.name, LIMITS.workoutName),
    createdAt: s.createdAt,
    startedAt: s.startedAt ?? null,
    finishedAt: s.status === 'active' ? null : (s.finishedAt ?? null),
    durationSec: duration,
    status: s.status,
    exercises: firstOfKey(s.exercises).slice(0, LIMITS.sessionExercises).map(normalizeSessionExercise),
    notes: (s.notes ?? '').slice(0, LIMITS.sessionNotes),
    rev,
    deviceId: s.deviceId ?? null,
  };
}

export type ExerciseOp = Extract<Op, { kind: 'exercise.put' | 'exercise.delete' }>;
export type WorkoutOp = Extract<Op, { kind: 'workout.put' | 'workout.delete' }>;
export type SessionOp = Extract<Op, { kind: 'session.put' | 'session.delete' }>;
export type StepsOp = Extract<Op, { kind: 'steps.put' | 'steps.delete' }>;

/** Upsert by id in place; a new one is appended only below `max` (else no change). */
function upsertById<T extends { id: string }>(list: readonly T[], value: T, max: number): readonly T[] {
  const i = list.findIndex((x) => x.id === value.id);
  if (i >= 0) {
    const next = [...list];
    next[i] = value;
    return next;
  }
  if (list.length >= max) return list;
  return [...list, value];
}

/** Her own exercises: put = upsert (a new one beyond 300 → no change), delete = remove (no cascade). */
export function reduceExercises(list: readonly Exercise[], op: ExerciseOp): Exercise[] {
  if (op.kind === 'exercise.delete') return list.filter((e) => e.id !== op.id);
  return [...upsertById(list, normalizeExercise(op.value), LIMITS.customExercises)];
}

/** Her workouts: put = upsert keeping the position (a new one beyond 50 → no change), delete = remove. */
export function reduceWorkouts(list: readonly Workout[], op: WorkoutOp): Workout[] {
  if (op.kind === 'workout.delete') return list.filter((w) => w.id !== op.id);
  return [...upsertById(list, normalizeWorkout(op.value), LIMITS.workouts)];
}

export interface SessionState {
  sessions: WorkoutSession[];
  deletedSessions: string[];
}

/** Tombstones are kept sorted by id (a canonical order both sides store); beyond the cap the smallest ids go. */
function addTombstone(list: readonly string[], id: string): string[] {
  if (list.includes(id)) return [...list];
  const next = [...list, id].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  return next.length > LIMITS.deletedSessions ? next.slice(next.length - LIMITS.deletedSessions) : next;
}

/**
 * Why a `session.put` of `value` (normalised) is a no-op over `stored` (W13), or null when it applies: the id has a
 * tombstone; a lower `rev`; an `active` put over a stored `done`; a NEW session on a date that already has 10.
 * Shared by the client reducer and the server's row path.
 */
export function sessionPutBlocked(
  value: WorkoutSession,
  stored: WorkoutSession | undefined,
  tombstoned: boolean,
  sessionsOnDate: number,
): 'deleted' | 'stale_rev' | 'reopen' | 'day_full' | null {
  if (tombstoned) return 'deleted';
  if (stored) {
    if (value.rev < stored.rev) return 'stale_rev';
    if (value.status === 'active' && stored.status === 'done') return 'reopen';
    return null;
  }
  return sessionsOnDate >= LIMITS.sessionsPerDay ? 'day_full' : null;
}

/** Sessions with the monotonic merge rules (W13); `session.delete` removes it and keeps a tombstone. */
export function reduceSessions(state: SessionState, op: SessionOp): SessionState {
  if (op.kind === 'session.delete') {
    return {
      sessions: state.sessions.filter((s) => s.id !== op.id),
      deletedSessions: addTombstone(state.deletedSessions, op.id),
    };
  }
  const value = normalizeSession(op.value);
  const stored = state.sessions.find((s) => s.id === value.id);
  const onDate = state.sessions.filter((s) => s.date === value.date).length;
  if (sessionPutBlocked(value, stored, state.deletedSessions.includes(value.id), onDate)) return state;
  const sessions = state.sessions.filter((s) => s.id !== value.id);
  sessions.push(value);
  sessions.sort(compareSessions);
  return { sessions, deletedSessions: state.deletedSessions };
}

/** Steps: put = upsert by date (sorted by date), delete = remove. */
export function reduceSteps(list: readonly StepsEntry[], op: StepsOp): StepsEntry[] {
  const rest = list.filter((s) => s.date !== op.date);
  if (op.kind === 'steps.put') {
    rest.push({ date: op.date, steps: op.steps });
    rest.sort(byDate);
  }
  return rest;
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
    case 'exercise.put':
    case 'exercise.delete':
      return { ...data, exercises: reduceExercises(data.exercises ?? [], op) };
    case 'workout.put':
    case 'workout.delete':
      return { ...data, workouts: reduceWorkouts(data.workouts ?? [], op) };
    case 'session.put':
    case 'session.delete': {
      const next = reduceSessions(
        { sessions: data.sessions ?? [], deletedSessions: data.deletedSessions ?? [] },
        op,
      );
      return { ...data, sessions: next.sessions, deletedSessions: next.deletedSessions };
    }
    case 'steps.put':
    case 'steps.delete':
      return { ...data, steps: reduceSteps(data.steps ?? [], op) };
  }
}

export const applyOps = (data: AppData, ops: readonly Op[]): AppData => ops.reduce(applyOp, data);
