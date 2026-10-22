import { z } from 'zod';

// No eval-based fast path: the web app runs under a strict CSP without 'unsafe-eval'.
z.config({ jitless: true });
import { DEFAULT_MEAL_TYPES, emptyMacroGoals, normalizeTypeNames } from './defaults';
import { isValidHM, isValidISODate, isValidTimeZone } from './dates';
import type { MeResponse } from './api';
import {
  AI_LIMIT_BOUNDS,
  INVITE_NOTE_MAX,
  PASSWORD_LIMITS,
  USER_ROLES,
  usernameProblem,
  type AiLimits,
  type SessionUser,
} from './users';
import { EQUIPMENT, EXERCISE_KINDS, MUSCLES } from './exercises';
import type {
  AppData,
  DayEntry,
  DayMeta,
  Exercise,
  FoodItem,
  MacroGoals,
  Meal,
  MealItem,
  MeasureValues,
  SessionExercise,
  SessionSet,
  SetValues,
  Settings,
  SettingsPut,
  StepsEntry,
  Workout,
  WorkoutItem,
  WorkoutSession,
} from './types';

export const LIMITS = {
  text: 5000,
  typeName: 40,
  types: 20,
  customTypes: 30,
  kcal: { min: 0, max: 20000 },
  kg: { min: 20, max: 400 },
  cm: { min: 10, max: 300 },
  goalKcal: { min: 500, max: 10000 },
  /** Per day; with meals, the union of the meals' photos. */
  photosPerDay: 12,
  foods: 200,
  foodName: 80,
  portion: 60,
  foodText: 1000,
  /** Base64 characters (≈ 3/4 bytes): full photo ≈ 2 MB, thumbnail ≈ 300 KB. */
  photoB64: 2_800_000,
  thumbB64: 400_000,
  mealsPerDay: 20,
  mealTypeName: 30,
  mealTypes: 12,
  mealItems: 30,
  /** Grams of one macronutrient in one position. */
  macro: { min: 0, max: 1000 },
  /** Grams of one macronutrient in one meal (sum of positions, or typed by hand). */
  mealMacro: { min: 0, max: 3000 },
  /** Daily macro goal, whole grams. */
  macroGoal: { min: 1, max: 1000 },
  // workouts and steps (docs/workouts-steps-rebrand.md §1.2)
  exerciseName: 60,
  workoutName: 40,
  customExercises: 300,
  workouts: 50,
  workoutItems: 30,
  plannedSets: 20,
  sessionExercises: 30,
  sessionSets: 30,
  sessionsPerDay: 10,
  sessionNotes: 1000,
  primaryMuscles: 6,
  secondaryMuscles: 8,
  reps: { min: 0, max: 1000 },
  setKg: { min: 0, max: 1000 },
  setSec: { min: 0, max: 36000 },
  cardioMin: { min: 0, max: 1440 },
  km: { min: 0, max: 500 },
  restSec: { min: 0, max: 900 },
  met: { min: 1, max: 25 },
  steps: { min: 1, max: 100000 },
  stepsGoal: { min: 1000, max: 50000 },
  sessionSec: { min: 0, max: 86400 },
  rev: { min: 0, max: 1e9 },
  deletedSessions: 10000,
} as const;

export const isoDateSchema = z.string().refine(isValidISODate, 'Expected a YYYY-MM-DD date');
export const hmSchema = z.string().refine(isValidHM, 'Expected HH:MM');
export const weekdaySchema = z.literal([0, 1, 2, 3, 4, 5, 6]);

const typeName = z.string().trim().min(1).max(LIMITS.typeName);

/** Server-generated random id of a stored food photo. */
export const photoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,40}$/, 'Invalid photo id');

const foodName = z.string().trim().min(1).max(LIMITS.foodName);
const kcalValue = z.number().int().min(LIMITS.kcal.min).max(LIMITS.kcal.max);

/** Grams in steps of 0.5 g, 0…max. */
const halfGram = (max: number) =>
  z
    .number()
    .min(0)
    .max(max)
    .refine((v) => Number.isInteger(v * 2), 'Expected a multiple of 0.5 g');

/** Grams of one macronutrient in one position (null = unknown). */
export const itemMacroSchema = halfGram(LIMITS.macro.max).nullable();
/** Grams of one macronutrient in one meal (null = unknown). */
export const mealMacroSchema = halfGram(LIMITS.mealMacro.max).nullable();
/** Client-generated meal id: `legacy`, `old-<base36>` (Rule L) or 12 random base64url characters. */
export const mealIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Invalid meal id');

export const mealItemSchema = z.object({
  name: foodName,
  portion: z.string().trim().max(LIMITS.portion),
  kcal: kcalValue,
  protein: itemMacroSchema.default(null),
  fat: itemMacroSchema.default(null),
  carbs: itemMacroSchema.default(null),
}) satisfies z.ZodType<MealItem>;

export const mealSchema = z.object({
  id: mealIdSchema,
  /** '' = untyped. */
  type: z.string().trim().max(LIMITS.mealTypeName),
  time: hmSchema.nullable(),
  text: z.string().max(LIMITS.text),
  kcal: kcalValue.nullable(),
  protein: mealMacroSchema,
  fat: mealMacroSchema,
  carbs: mealMacroSchema,
  photos: z.array(photoIdSchema).max(LIMITS.photosPerDay).optional(),
  items: z.array(mealItemSchema).max(LIMITS.mealItems).optional(),
}) satisfies z.ZodType<Meal>;

const uniqueIds = (meals: readonly { id: string }[]): boolean => new Set(meals.map((m) => m.id)).size === meals.length;

/**
 * Stored / cached / exported / imported day (AppData). With `meals`, the day's food / kcal / photos are derived
 * from them by `normalizeDay`; an empty `meals` array means a legacy day (its food is kept).
 */
export const dayEntrySchema = z.object({
  food: z.string().max(LIMITS.text),
  kcal: kcalValue.nullable(),
  trained: z.boolean().nullable(),
  types: z.array(typeName).max(LIMITS.types),
  notes: z.string().max(LIMITS.text),
  photos: z.array(photoIdSchema).max(LIMITS.photosPerDay).optional(),
  meals: z.array(mealSchema).max(LIMITS.mealsPerDay).refine(uniqueIds, 'Duplicate meal ids').optional(),
}) satisfies z.ZodType<DayEntry>;

/** The `day.put` op value: never carries meals (zod strips the key), so every day.put is legacy-shaped. */
export const dayPutValueSchema = dayEntrySchema.omit({ meals: true });

/** The `day.meta` op value: only the keys present are applied (at least one). */
export const dayMetaSchema = z
  .object({
    trained: z.boolean().nullable(),
    types: z.array(typeName).max(LIMITS.types),
    notes: z.string().max(LIMITS.text),
  })
  .partial()
  .refine((v) => v.trained !== undefined || v.types !== undefined || v.notes !== undefined, 'Empty day.meta') satisfies z.ZodType<DayMeta>;

export const kgSchema = z.number().min(LIMITS.kg.min).max(LIMITS.kg.max);
const cmSchema = z.number().min(LIMITS.cm.min).max(LIMITS.cm.max).nullable();

export const measureValuesSchema = z
  .object({ chest: cmSchema, waist: cmSchema, hips: cmSchema })
  .refine((m) => m.chest != null || m.waist != null || m.hips != null, 'At least one measurement is required') satisfies z.ZodType<MeasureValues>;

const macroGoal = z.number().int().min(LIMITS.macroGoal.min).max(LIMITS.macroGoal.max).nullable();
export const macroGoalsSchema = z.object({
  protein: macroGoal,
  fat: macroGoal,
  carbs: macroGoal,
}) satisfies z.ZodType<MacroGoals>;

/** Her meal types: trimmed 1–30 characters, at most 12, de-duplicated case-insensitively (first spelling wins). */
export const mealTypesSchema = z
  .array(z.string().trim().min(1).max(LIMITS.mealTypeName))
  .max(LIMITS.mealTypes)
  .transform(normalizeTypeNames);

/**
 * Daily steps goal (null = none). NO default here: zod 4 applies a default nested inside `.optional()`, which would
 * turn an old client's settings.put (no key) into `stepsGoal: null` and erase her goal. So the default lives in
 * `settingsSchema` only and `settingsPutSchema` uses `.optional()`.
 */
export const stepsGoalSchema = z
  .number()
  .int()
  .min(LIMITS.stepsGoal.min)
  .max(LIMITS.stepsGoal.max)
  .nullable();

// ── workouts and steps (docs/workouts-steps-rebrand.md §1.2) ───────────────────────────────────────────────────────

/** Her own exercises, workouts and sessions: 12–40 base64url characters (never contains a dot). */
export const OWN_ID_RE = /^[A-Za-z0-9_-]{12,40}$/;
/** Seed library exercises: `lib.<slug>`. */
export const LIBRARY_ID_RE = /^lib\.[a-z0-9-]{2,40}$/;

export const ownIdSchema = z.string().regex(OWN_ID_RE, 'Invalid id');
export const libraryExerciseIdSchema = z.string().regex(LIBRARY_ID_RE, 'Invalid library exercise id');
/** A library or an own exercise id. */
export const exerciseIdSchema = z
  .string()
  .refine((v) => OWN_ID_RE.test(v) || LIBRARY_ID_RE.test(v), 'Invalid exercise id');
/** Key of a workout item / session exercise (unique within its list). */
export const itemKeySchema = z.string().regex(/^[A-Za-z0-9_-]{4,40}$/, 'Invalid key');

export const muscleSchema = z.enum(MUSCLES);
export const equipmentSchema = z.enum(EQUIPMENT);
export const exerciseKindSchema = z.enum(EXERCISE_KINDS);

const unique = (arr: readonly unknown[]): boolean => new Set(arr).size === arr.length;
const uniqueBy =
  <T>(key: (x: T) => unknown) =>
  (arr: readonly T[]): boolean =>
    new Set(arr.map(key)).size === arr.length;
/** `v × factor` is (almost exactly) whole: floating point of 42.5 × 4 or 3.21 × 100. */
const multipleOf = (factor: number) => (v: number) => Math.abs(v * factor - Math.round(v * factor)) < 1e-6;

const muscleList = (max: number) => z.array(muscleSchema).max(max).refine(unique, 'Duplicate muscles');
const metSchema = z
  .number()
  .min(LIMITS.met.min)
  .max(LIMITS.met.max)
  .refine(multipleOf(10), 'Expected one decimal');

const exerciseShape = {
  name: z.string().trim().min(1).max(LIMITS.exerciseName),
  kind: exerciseKindSchema,
  primary: muscleList(LIMITS.primaryMuscles),
  secondary: muscleList(LIMITS.secondaryMuscles),
  equipment: equipmentSchema,
  met: metSchema,
};

/** Her own exercise (stored, `exercise.put`): an own id — a `lib.*` id is invalid here. */
export const exerciseSchema = z.object({ id: ownIdSchema, ...exerciseShape }) satisfies z.ZodType<Exercise>;
/** A seed library row (the library integrity test). */
export const libraryExerciseSchema = z.object({
  id: libraryExerciseIdSchema,
  ...exerciseShape,
}) satisfies z.ZodType<Exercise>;

const repsSchema = z.number().int().min(LIMITS.reps.min).max(LIMITS.reps.max).nullable().default(null);
const setKgSchema = z
  .number()
  .min(LIMITS.setKg.min)
  .max(LIMITS.setKg.max)
  .refine(multipleOf(4), 'Expected a multiple of 0.25 kg')
  .nullable()
  .default(null);
const setSecSchema = z.number().int().min(LIMITS.setSec.min).max(LIMITS.setSec.max).nullable().default(null);
const cardioMinSchema = z
  .number()
  .min(LIMITS.cardioMin.min)
  .max(LIMITS.cardioMin.max)
  .refine(multipleOf(2), 'Expected a multiple of 0.5 min')
  .nullable()
  .default(null);
const kmSchema = z
  .number()
  .min(LIMITS.km.min)
  .max(LIMITS.km.max)
  .refine(multipleOf(100), 'Expected a multiple of 0.01 km')
  .nullable()
  .default(null);

export const setValuesSchema = z.object({
  reps: repsSchema,
  kg: setKgSchema,
  sec: setSecSchema,
  min: cardioMinSchema,
  km: kmSchema,
}) satisfies z.ZodType<SetValues>;

export const sessionSetSchema = setValuesSchema.extend({ done: z.boolean() }) satisfies z.ZodType<SessionSet>;

const restSecSchema = z.number().int().min(LIMITS.restSec.min).max(LIMITS.restSec.max);

export const workoutItemSchema = z.object({
  key: itemKeySchema,
  exerciseId: exerciseIdSchema,
  sets: z.array(setValuesSchema).min(1).max(LIMITS.plannedSets),
  restSec: restSecSchema,
}) satisfies z.ZodType<WorkoutItem>;

export const workoutSchema = z.object({
  id: ownIdSchema,
  name: z.string().trim().min(1).max(LIMITS.workoutName),
  days: z.array(weekdaySchema).max(7).refine(unique, 'Duplicate days'),
  items: z
    .array(workoutItemSchema)
    .max(LIMITS.workoutItems)
    .refine(uniqueBy((i: WorkoutItem) => i.key), 'Duplicate item keys'),
}) satisfies z.ZodType<Workout>;

export const sessionExerciseSchema = z.object({
  key: itemKeySchema,
  exerciseId: exerciseIdSchema,
  ...exerciseShape,
  restSec: restSecSchema,
  skipped: z.boolean(),
  sets: z.array(sessionSetSchema).max(LIMITS.sessionSets),
}) satisfies z.ZodType<SessionExercise>;

const epochMs = z.number().int().min(0);

export const sessionSchema = z.object({
  id: ownIdSchema,
  date: isoDateSchema,
  workoutId: ownIdSchema.nullable(),
  name: z.string().trim().min(1).max(LIMITS.workoutName),
  createdAt: epochMs,
  startedAt: epochMs.nullable(),
  finishedAt: epochMs.nullable(),
  durationSec: z.number().int().min(LIMITS.sessionSec.min).max(LIMITS.sessionSec.max).nullable(),
  status: z.enum(['active', 'done']),
  exercises: z
    .array(sessionExerciseSchema)
    .max(LIMITS.sessionExercises)
    .refine(uniqueBy((e: SessionExercise) => e.key), 'Duplicate exercise keys'),
  notes: z.string().max(LIMITS.sessionNotes),
  rev: z.number().int().min(LIMITS.rev.min).max(LIMITS.rev.max).default(0),
  deviceId: ownIdSchema.nullable().default(null),
}) satisfies z.ZodType<WorkoutSession>;

export const stepsCountSchema = z.number().int().min(LIMITS.steps.min).max(LIMITS.steps.max);

export const stepsEntrySchema = z.object({
  date: isoDateSchema,
  steps: stepsCountSchema,
}) satisfies z.ZodType<StepsEntry>;

export const settingsSchema = z.object({
  goal: kgSchema,
  kcalGoal: z.number().int().min(LIMITS.goalKcal.min).max(LIMITS.goalKcal.max),
  rem: z.object({
    workout: z.object({ on: z.boolean(), days: z.array(weekdaySchema).max(7), time: hmSchema }),
    weigh: z.object({ on: z.boolean(), day: weekdaySchema, time: hmSchema }),
    measure: z.object({ on: z.boolean(), day: weekdaySchema, time: hmSchema }),
  }),
  timezone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone'),
  customTypes: z.array(typeName).max(LIMITS.customTypes).transform(normalizeTypeNames),
  onboarded: z.boolean(),
  // Defaults keep settings stored before meal types existed (and old backups) valid.
  mealTypes: mealTypesSchema.default(() => [...DEFAULT_MEAL_TYPES]),
  macroGoals: macroGoalsSchema.default(() => emptyMacroGoals()),
  stepsGoal: stepsGoalSchema.default(null),
}) satisfies z.ZodType<Settings>;

/** The `settings.put` op value: no defaults — an absent `mealTypes` / `macroGoals` keeps the stored one (old clients). */
export const settingsPutSchema = settingsSchema.extend({
  mealTypes: mealTypesSchema.optional(),
  macroGoals: macroGoalsSchema.optional(),
  stepsGoal: stepsGoalSchema.optional(),
}) satisfies z.ZodType<SettingsPut>;

/** Grams of one macronutrient in a «Часті страви» dish / a use of it; the key is omitted when unknown (never null). */
const dishMacro = halfGram(LIMITS.macro.max).optional();

/** What gets recorded when a dish is added to a day (estimate line or quick-add chip). */
export const foodUseSchema = z.object({
  name: foodName,
  portion: z.string().trim().max(LIMITS.portion),
  kcal: kcalValue,
  protein: dishMacro,
  fat: dishMacro,
  carbs: dishMacro,
});
export type FoodUse = z.infer<typeof foodUseSchema>;

export const foodItemSchema = z.object({
  name: foodName,
  portion: z.string().trim().max(LIMITS.portion),
  kcal: kcalValue,
  count: z.number().int().min(1),
  lastUsed: isoDateSchema,
  protein: dishMacro,
  fat: dishMacro,
  carbs: dishMacro,
}) satisfies z.ZodType<FoodItem>;

/**
 * A single idempotent change. The client queues these offline and the server applies them in order.
 * Wire v2 = v1 + additions: every v1 op stays valid forever (see `reduceDay` for the semantics on days with meals).
 */
export const opSchema = z.discriminatedUnion('kind', [
  /** Legacy whole-day write (old clients and old outboxes; the current client never sends it). */
  z.object({ kind: z.literal('day.put'), date: isoDateSchema, value: dayPutValueSchema }),
  /** Old clients only: on a day with meals it keeps the meals and clears the workout mark, types and notes. */
  z.object({ kind: z.literal('day.delete'), date: isoDateSchema }),
  /** Partial write of the workout mark / types / notes (never the food). */
  z.object({ kind: z.literal('day.meta'), date: isoDateSchema, value: dayMetaSchema }),
  /** Upserts one meal by id (converts a legacy day first); an empty meal deletes it. */
  z.object({ kind: z.literal('meal.put'), date: isoDateSchema, value: mealSchema }),
  z.object({ kind: z.literal('meal.delete'), date: isoDateSchema, id: mealIdSchema }),
  z.object({ kind: z.literal('weight.put'), date: isoDateSchema, kg: kgSchema }),
  z.object({ kind: z.literal('weight.delete'), date: isoDateSchema }),
  z.object({ kind: z.literal('measure.put'), date: isoDateSchema, value: measureValuesSchema }),
  z.object({ kind: z.literal('measure.delete'), date: isoDateSchema }),
  z.object({ kind: z.literal('settings.put'), value: settingsPutSchema }),
  /** Not strictly idempotent: a replay bumps `count` once more (harmless for ranking). */
  z.object({ kind: z.literal('food.use'), date: isoDateSchema, value: foodUseSchema }),
  z.object({ kind: z.literal('food.delete'), name: foodName }),
  // Wire v3 (docs/workouts-steps-rebrand.md §1.3): old clients never send these, old servers answer invalid_op.
  /** Her own exercise, upsert by id; a NEW one beyond 300 is ignored. */
  z.object({ kind: z.literal('exercise.put'), value: exerciseSchema }),
  /** No cascade in the reducer (the client rewrites the workouts that used it). */
  z.object({ kind: z.literal('exercise.delete'), id: ownIdSchema }),
  /** Upsert by id keeping its position; a NEW one beyond 50 is ignored. */
  z.object({ kind: z.literal('workout.put'), value: workoutSchema }),
  z.object({ kind: z.literal('workout.delete'), id: ownIdSchema }),
  /** Upsert by id with the monotonic rules of `reduceSessions` (W13). */
  z.object({ kind: z.literal('session.put'), value: sessionSchema }),
  /** Removes the session and keeps a tombstone of its id. */
  z.object({ kind: z.literal('session.delete'), id: ownIdSchema }),
  z.object({ kind: z.literal('steps.put'), date: isoDateSchema, steps: stepsCountSchema }),
  z.object({ kind: z.literal('steps.delete'), date: isoDateSchema }),
]);

export type Op = z.infer<typeof opSchema>;
export type OpKind = Op['kind'];

export const MAX_OPS_PER_REQUEST = 500;

export const opsRequestSchema = z.object({
  ops: z.array(opSchema).min(1).max(MAX_OPS_PER_REQUEST),
});

const uniqueDates = (arr: { date: string }[]) => new Set(arr.map((x) => x.date)).size === arr.length;

function sessionsPerDayOk(arr: readonly { date: string }[]): boolean {
  const perDay = new Map<string, number>();
  for (const s of arr) {
    const n = (perDay.get(s.date) ?? 0) + 1;
    if (n > LIMITS.sessionsPerDay) return false;
    perDay.set(s.date, n);
  }
  return true;
}

/** Full data set, as returned by `GET /api/data` and accepted by `POST /api/import`. */
export const appDataSchema = z.object({
  days: z.record(isoDateSchema, dayEntrySchema),
  weights: z
    .array(z.object({ date: isoDateSchema, kg: kgSchema }))
    .refine(uniqueDates, 'Duplicate weight dates'),
  measures: z
    .array(z.object({ date: isoDateSchema, chest: cmSchema, waist: cmSchema, hips: cmSchema }))
    .refine(uniqueDates, 'Duplicate measurement dates'),
  /** Optional so that backups made before «Часті страви» existed still import. */
  foods: z
    .array(foodItemSchema)
    .max(LIMITS.foods)
    .refine((arr) => new Set(arr.map((f) => f.name.toLocaleLowerCase('uk'))).size === arr.length, 'Duplicate dish names')
    .default([]),
  settings: settingsSchema,
  // The workouts / steps keys are optional so that every older backup still imports (§1.4).
  exercises: z
    .array(exerciseSchema)
    .max(LIMITS.customExercises)
    .refine(uniqueBy((e: Exercise) => e.id), 'Duplicate exercise ids')
    .default([]),
  workouts: z
    .array(workoutSchema)
    .max(LIMITS.workouts)
    .refine(uniqueBy((w: Workout) => w.id), 'Duplicate workout ids')
    .default([]),
  sessions: z
    .array(sessionSchema)
    .refine(uniqueBy((s: WorkoutSession) => s.id), 'Duplicate session ids')
    .refine(sessionsPerDayOk, 'Too many sessions on one day')
    .default([]),
  steps: z.array(stepsEntrySchema).refine(uniqueDates, 'Duplicate steps dates').default([]),
  deletedSessions: z
    .array(ownIdSchema)
    .max(LIMITS.deletedSessions)
    .refine(unique, 'Duplicate session tombstones')
    .default([]),
}) satisfies z.ZodType<AppData>;

export const pushSubscribeRequestSchema = z.object({
  subscription: z.object({
    endpoint: z.url().max(2000),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
  timezone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
});

/**
 * `auth` = the browser subscription's own `keys.auth` (D15): with it the row is removed whoever owns it; without it
 * (old clients) only the caller's own row.
 */
export const pushUnsubscribeRequestSchema = z.object({
  endpoint: z.url().max(2000),
  auth: z.string().min(1).max(100).optional(),
});

const base64 = (max: number) => z.string().min(16).max(max).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'Expected base64');

/** `POST /api/food/estimate`: a text description, a photo (JPEG, downscaled on the device), or both. */
/** One corrected position she sends back for recalculation; her name and portion are authoritative. */
export const foodRecalcItemSchema = z.object({
  name: z.string().trim().min(1).max(LIMITS.foodName),
  portion: z.string().trim().max(LIMITS.portion),
});
export type FoodRecalcItem = z.infer<typeof foodRecalcItemSchema>;

/**
 * Two modes:
 * - **estimate**: `text` and/or a new `image` → the model identifies the items (the photo is stored first);
 * - **recalculate**: `items` (her corrected names/portions, same order back) + optional `photoId` of the
 *   already stored photo for context (not stored again) → the model only prices those items.
 */
export const foodEstimateRequestSchema = z
  .object({
    date: isoDateSchema,
    text: z.string().trim().max(LIMITS.foodText).optional(),
    image: z.object({ full: base64(LIMITS.photoB64), thumb: base64(LIMITS.thumbB64) }).optional(),
    items: z.array(foodRecalcItemSchema).min(1).max(30).optional(),
    photoId: photoIdSchema.optional(),
  })
  .refine((r) => Boolean(r.text) || r.image !== undefined || r.items !== undefined, 'Describe the food or attach a photo')
  .refine((r) => !(r.items && r.image), 'Send either a new photo or items to recalculate, not both')
  .refine((r) => r.photoId === undefined || r.items !== undefined, 'photoId is only used when recalculating items');
export type FoodEstimateRequest = z.input<typeof foodEstimateRequestSchema>;

/** What the model must return (validated on the server before it reaches the client). */
export const foodEstimateResultSchema = z.object({
  items: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(LIMITS.foodName),
        portion: z.string().trim().max(LIMITS.portion),
        kcal: kcalValue,
        protein: z.number().min(LIMITS.macro.min).max(LIMITS.macro.max).nullable(),
        fat: z.number().min(LIMITS.macro.min).max(LIMITS.macro.max).nullable(),
        carbs: z.number().min(LIMITS.macro.min).max(LIMITS.macro.max).nullable(),
      }),
    )
    .max(LIMITS.mealItems),
  comment: z.string().trim().max(300),
});

// ── Accounts (docs/multi-user.md §6.1) ──────────────────────────────────────────────────────────────────────────
// Username / new-password rules are checked in the routes with `usernameProblem` / `passwordProblem`, so they map to
// `invalid_username` / `weak_password` instead of a generic `bad_request`: the request schemas only cap the sizes.

/** User ids (and invite / reset link ids): 32 lowercase hex characters. */
export const userIdSchema = z.string().regex(/^[0-9a-f]{32}$/, 'Invalid id');
/** One-time link token: 32 random bytes in base64url (43 characters). */
export const linkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Invalid link token');
/** A username someone may register or rename to (trimmed; `admin` and `legko` are reserved). */
export const usernameSchema = z
  .string()
  .trim()
  .refine((v) => usernameProblem(v) === null, 'Invalid username');
export const newPasswordSchema = z.string().min(PASSWORD_LIMITS.min).max(PASSWORD_LIMITS.max);

/**
 * `POST /api/auth/login`. The name is not format-checked (an invalid name answers exactly like a wrong one); an absent
 * `username` (the pre-v4 bundle sends only the password) means the alias `legko` = the legacy owner (D24).
 */
export const loginRequestSchema = z.object({
  username: z.string().trim().min(1).max(64).optional(),
  password: z.string().min(1).max(200),
});

const passwordChangeViaSchema = z.enum(['self', 'reset', 'setup', 'cli']);

export const sessionUserSchema = z.object({
  id: userIdSchema,
  username: z.string().min(1).max(64),
  role: z.enum(USER_ROLES),
  createdAt: z.number(),
  legacyOwner: z.boolean(),
  passwordChange: z
    .object({ at: z.number(), via: passwordChangeViaSchema, by: z.string().nullable() })
    .nullable(),
}) satisfies z.ZodType<SessionUser>;

/**
 * The client validates every `MeResponse` / `LoginResponse` with this: a 2xx without a valid `user` (an old v3 server
 * during a rollback answers `{ ok: true }`) is the client's `outdated_server`.
 */
export const meResponseSchema = z.object({
  ok: z.literal(true),
  user: sessionUserSchema,
}) satisfies z.ZodType<MeResponse>;

/** `POST /api/auth/invite/check`, `POST /api/auth/reset/check`. */
export const linkCheckRequestSchema = z.object({ token: linkTokenSchema });
export const inviteAcceptRequestSchema = z.object({
  token: linkTokenSchema,
  username: z.string().max(64),
  password: z.string().max(200),
});
export const resetCompleteRequestSchema = z.object({ token: linkTokenSchema, password: z.string().max(200) });

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: z.string().max(200),
});
export const renameRequestSchema = z.object({ username: z.string().max(64), password: z.string().min(1).max(200) });

export const createInviteRequestSchema = z.object({ note: z.string().trim().max(INVITE_NOTE_MAX).default('') });
/** Invite ids use the same 32-hex format as user ids. */
export const inviteIdRequestSchema = z.object({ id: userIdSchema });
export const userTargetRequestSchema = z.object({ userId: userIdSchema });
export const setRoleRequestSchema = z.object({ userId: userIdSchema, role: z.enum(USER_ROLES) });
export const setDisabledRequestSchema = z.object({ userId: userIdSchema, disabled: z.boolean() });
/** `confirmUsername` must equal the target's username (case-insensitive; checked in the route). */
export const deleteUserRequestSchema = z.object({ userId: userIdSchema, confirmUsername: z.string().max(64) });

export const aiLimitsSchema = z.object({
  perUser: z.number().int().min(AI_LIMIT_BOUNDS.perUser.min).max(AI_LIMIT_BOUNDS.perUser.max),
  global: z.number().int().min(AI_LIMIT_BOUNDS.global.min).max(AI_LIMIT_BOUNDS.global.max),
}) satisfies z.ZodType<AiLimits>;
/** `limit` null = back to the default per-user limit. */
export const userAiLimitRequestSchema = z.object({
  userId: userIdSchema,
  limit: z.number().int().min(AI_LIMIT_BOUNDS.perUser.min).max(AI_LIMIT_BOUNDS.perUser.max).nullable(),
});
