import { z } from 'zod';

// No eval-based fast path: the web app runs under a strict CSP without 'unsafe-eval'.
z.config({ jitless: true });
import { DEFAULT_MEAL_TYPES, emptyMacroGoals, normalizeTypeNames } from './defaults';
import { isValidHM, isValidISODate, isValidTimeZone } from './dates';
import type {
  AppData,
  DayEntry,
  DayMeta,
  FoodItem,
  MacroGoals,
  Meal,
  MealItem,
  MeasureValues,
  Settings,
  SettingsPut,
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
}) satisfies z.ZodType<Settings>;

/** The `settings.put` op value: no defaults — an absent `mealTypes` / `macroGoals` keeps the stored one (old clients). */
export const settingsPutSchema = settingsSchema.extend({
  mealTypes: mealTypesSchema.optional(),
  macroGoals: macroGoalsSchema.optional(),
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
]);

export type Op = z.infer<typeof opSchema>;
export type OpKind = Op['kind'];

export const MAX_OPS_PER_REQUEST = 500;

export const opsRequestSchema = z.object({
  ops: z.array(opSchema).min(1).max(MAX_OPS_PER_REQUEST),
});

const uniqueDates = (arr: { date: string }[]) => new Set(arr.map((x) => x.date)).size === arr.length;

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
}) satisfies z.ZodType<AppData>;

export const loginRequestSchema = z.object({ password: z.string().min(1).max(200) });

export const pushSubscribeRequestSchema = z.object({
  subscription: z.object({
    endpoint: z.url().max(2000),
    expirationTime: z.number().nullable().optional(),
    keys: z.object({ p256dh: z.string().min(1).max(200), auth: z.string().min(1).max(100) }),
  }),
  timezone: z.string().max(64).refine(isValidTimeZone, 'Unknown time zone').optional(),
});

export const pushUnsubscribeRequestSchema = z.object({ endpoint: z.url().max(2000) });

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
