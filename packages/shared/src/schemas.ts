import { z } from 'zod';

// No eval-based fast path: the web app runs under a strict CSP without 'unsafe-eval'.
z.config({ jitless: true });
import { normalizeTypeNames } from './defaults';
import { isValidHM, isValidISODate, isValidTimeZone } from './dates';
import type { AppData, DayEntry, FoodItem, MeasureValues, Settings } from './types';

export const LIMITS = {
  text: 5000,
  typeName: 40,
  types: 20,
  customTypes: 30,
  kcal: { min: 0, max: 20000 },
  kg: { min: 20, max: 400 },
  cm: { min: 10, max: 300 },
  goalKcal: { min: 500, max: 10000 },
  photosPerDay: 12,
  foods: 200,
  foodName: 80,
  portion: 60,
  foodText: 1000,
  /** Base64 characters (≈ 3/4 bytes): full photo ≈ 2 MB, thumbnail ≈ 300 KB. */
  photoB64: 2_800_000,
  thumbB64: 400_000,
} as const;

export const isoDateSchema = z.string().refine(isValidISODate, 'Expected a YYYY-MM-DD date');
export const hmSchema = z.string().refine(isValidHM, 'Expected HH:MM');
export const weekdaySchema = z.literal([0, 1, 2, 3, 4, 5, 6]);

const typeName = z.string().trim().min(1).max(LIMITS.typeName);

/** Server-generated random id of a stored food photo. */
export const photoIdSchema = z.string().regex(/^[A-Za-z0-9_-]{16,40}$/, 'Invalid photo id');

export const dayEntrySchema = z.object({
  food: z.string().max(LIMITS.text),
  kcal: z.number().int().min(LIMITS.kcal.min).max(LIMITS.kcal.max).nullable(),
  trained: z.boolean().nullable(),
  types: z.array(typeName).max(LIMITS.types),
  notes: z.string().max(LIMITS.text),
  photos: z.array(photoIdSchema).max(LIMITS.photosPerDay).optional(),
}) satisfies z.ZodType<DayEntry>;

export const kgSchema = z.number().min(LIMITS.kg.min).max(LIMITS.kg.max);
const cmSchema = z.number().min(LIMITS.cm.min).max(LIMITS.cm.max).nullable();

export const measureValuesSchema = z
  .object({ chest: cmSchema, waist: cmSchema, hips: cmSchema })
  .refine((m) => m.chest != null || m.waist != null || m.hips != null, 'At least one measurement is required') satisfies z.ZodType<MeasureValues>;

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
}) satisfies z.ZodType<Settings>;

const foodName = z.string().trim().min(1).max(LIMITS.foodName);
const kcalValue = z.number().int().min(LIMITS.kcal.min).max(LIMITS.kcal.max);

/** What gets recorded when a dish is added to a day (estimate line or quick-add chip). */
export const foodUseSchema = z.object({
  name: foodName,
  portion: z.string().trim().max(LIMITS.portion),
  kcal: kcalValue,
});
export type FoodUse = z.infer<typeof foodUseSchema>;

export const foodItemSchema = z.object({
  name: foodName,
  portion: z.string().trim().max(LIMITS.portion),
  kcal: kcalValue,
  count: z.number().int().min(1),
  lastUsed: isoDateSchema,
}) satisfies z.ZodType<FoodItem>;

/** A single idempotent change. The client queues these offline and the server applies them in order. */
export const opSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('day.put'), date: isoDateSchema, value: dayEntrySchema }),
  z.object({ kind: z.literal('day.delete'), date: isoDateSchema }),
  z.object({ kind: z.literal('weight.put'), date: isoDateSchema, kg: kgSchema }),
  z.object({ kind: z.literal('weight.delete'), date: isoDateSchema }),
  z.object({ kind: z.literal('measure.put'), date: isoDateSchema, value: measureValuesSchema }),
  z.object({ kind: z.literal('measure.delete'), date: isoDateSchema }),
  z.object({ kind: z.literal('settings.put'), value: settingsSchema }),
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
      }),
    )
    .max(30),
  comment: z.string().trim().max(300),
});
