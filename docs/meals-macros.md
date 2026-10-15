# «Прийоми їжі та БЖУ» — meals, macros and user-managed meal types

Owner request (Anna, 2026-10-15): «Хочу щоб мені писало скільки я з'їла БЖУ за день, та хочу щоб мої прийоми їжі
були в окремих рамках типу: сніданок тост з тунцем, потім обід і вечерю вписувати в іншу строчку». Owner addition:
«сделай чтобы она сама выбирала, что за приём пищи, а не тупо 3 захардкоженых».

This plan turns a day's food into a **list of meals** (each its own framed row: type, what she ate, photos, kcal,
Б/Ж/В, optional AI positions), adds **protein / fat / carbs** everywhere calories are shown, makes **meal types her
own list** (Settings → «Прийоми їжі», plus «+ Свій» inline) and keeps **every existing record, client, outbox op and
backup working**. Same 1b «Свіжість» look and redesign-A patterns (`docs/redesign-a.md`): `ListGroup` / `ListRow`,
`Icon`, stacked `Sheet` (incl. `size="compact"`), ≥ 44px targets, inputs ≥ 16px, light + dark, desktop sensible.

Reading order for engineers: §1 decisions → §2 data model → §3 compatibility → the section of your package → §8
work packages (your brief in the orchestration output is self-contained; this file has the sketches and the reasons).

---

## 0. Summary

| Area | Before | After |
| --- | --- | --- |
| Day food | one free text + day kcal + day photos | `meals[]`: type label · time · text · photos · kcal · Б/Ж/В · AI positions; day `food`/`kcal`/`photos` **derived** |
| Meal types | — | `settings.mealTypes` (defaults Сніданок · Обід · Вечеря · Перекус), add / rename / reorder / delete, «+ Свій» in the editor; preselected by time of day |
| Macros | — | per AI position (model returns grams), per meal, per day; «Часті страви» remember them; manual entry possible |
| Goals | weight, kcal | + optional Білки / Жири / Вуглеводи grams per day |
| «+» → Їжа | short sheet with day text + FoodAssist + day kcal | **new meal editor directly** (type preselected, text focused, AI buttons above the text so the keyboard never hides them) — 2 taps to the keyboard |
| Home «Їжа» row | «1 240 / 1 700 ккал» + meter | same + sub «Б 68 · Ж 41 · В 132 г · 3 прийоми» → opens the day's meal list (an empty day opens the new-meal editor) |
| «Їжа» sheet | food text, FoodAssist, kcal | day totals card (kcal + Б/Ж/В vs goals) + meal rows + «+ Прийом їжі» |
| Calendar day | Їжа row with the text | Їжа row with one line per meal («Сніданок · 520 ккал · Тост з авокадо», one line, ellipsis) + macros line |
| Progress «Харчування» | kcal averages | + average Б/Ж/В per day for the selected period (complete days only, vs goals) |
| Ops | `day.put` whole day | + `meal.put` / `meal.delete` (per meal), `day.meta` (only the given workout / notes fields); `day.put` kept for old clients (never carries meals) |
| Server DB | `days(food, kcal, photos, …)` | + `days.meals` JSON (NULL = legacy day), `foods.protein/fat/carbs` — additive migration v3, automatic pre-migration snapshot, tested `downgrade-schema` CLI for rollback |

---

## 1. Decisions

| # | Topic | Decision | Why |
| --- | --- | --- | --- |
| D1 | Where meals live | Inside `DayEntry` as `meals?: Meal[]`. When present, the day's `food`, `kcal`, `photos` are **derived** from the meals by `normalizeDay()` (shared reducer, server and client). | Every existing reader (kcal goal line, calendar fills, day status, stats, progress, reminders, old clients) keeps working with zero changes; the photo GC keeps finding photos in `days.photos`. |
| D2 | Legacy days | A day **without** `meals` is a legacy day. It is never migrated. The UI shows its food as one pseudo-meal `{ id: 'legacy', type: '' }` titled «Їжа за день» (`mealsOf(day)`). Editing it or adding a meal to that day converts it (reducer) into an untyped meal with id `legacy`. | No destructive migration; old data stays byte-identical until she touches it; conversion is lossless (meal text max = day text max). |
| D3 | Ops | New per-meal ops `meal.put` (upsert by id) / `meal.delete`, and `day.meta` (a **partial** write of `trained` / `types` / `notes`: only the keys present are applied). **The new client never sends `day.put` or `day.delete`.** The `day.put` op value cannot carry `meals` (stripped by its schema). | Two devices adding meals to the same day never erase each other (a whole-day put would); a ✓ on one device and a notes edit on another do not overwrite each other. Same per-field philosophy as `recordOps` today. |
| D4 | Old-shape `day.put` / `day.delete` on a day with meals (old PWA, old outbox) | **Rule L**: keep the stored meals, take `trained`/`types`/`notes` from the op, and add whatever new food content the op carries (lines, photos, extra kcal) as one extra untyped meal (deterministic id; at the 20-meal cap merged into the last meal without positions). Removals from an old client are ignored on meal days; an old `day.delete` on a meal day keeps the meals and clears only the workout mark, types and notes. | An old client only knows the derived text; it must never wipe meals. Known limits (§2.6): a stale old client can bring back a meal deleted on a new device, and its own kcal increase is lost when meals were added elsewhere — both only in the reload window, both visible and editable. |
| D5 | `settings.put` without the new fields | Missing `mealTypes` / `macroGoals` = keep the stored values. | Old clients strip unknown keys (zod) before sending. |
| D6 | Meal type | Stored as a **label** on the meal (≤ 30 chars, `''` = untyped). `settings.mealTypes` is her ordered list (≤ 12; may be empty). Renaming / deleting a type never touches past meals. A meal is untyped only when her list is empty, or for a legacy / old-client block until she picks a chip: tapping the selected chip again keeps it (no silent «no type»). | Owner: past meals keep their label; she chooses the type herself. |
| D7 | Type preselection | `suggestMealType()` (§2.8): keyword slots Сніданок 04–10, Обід 11–15, Вечеря 17–21 (and 22–23 while no dinner is logged), otherwise Перекус; a slot type already logged that day → Перекус; without a snack type the nearest earlier main slot wins (16:xx → lunch, late evening / night → dinner); renamed lists degrade to keyword match, then positional; past dates → first type not yet logged, then the snack type. Always changeable. The Settings note is generated from the same function. | Works with her own names, degrades gracefully when she renames or deletes defaults, never blocks. |
| D8 | Fastest logging flow | «+» → «Їжа» swaps the menu **in place** to the new-meal editor «Прийом їжі» (type preselected, «Що я їла» focused inside the tap; the AI buttons sit **above** the text so the iPhone keyboard never covers them). On a day with **no food** the Home «Їжа» row and the calendar row («Додати») open the same new-meal editor for that date; on a day with food they (and `/?sheet=food`) open the day's list «Їжа». The editor shows the live day total and «Усі прийоми за день →». | 2 taps to the keyboard instead of 3; the first meal of the morning is one tap from Home; reviewing a day with food stays one tap from Home / the calendar. §6.1, §7.1. |
| D9 | AI positions | The estimate result **is** the meal's position list (`Meal.items`): no «Додати N ккал» step. When a meal has positions, its kcal and Б/Ж/В are the sums (recomputed by the reducer); manual kcal/macro fields show only for a meal without positions. Adding the first position to a meal with manual numbers turns them into a position «Інше» (nothing silently lost) — except an estimate of the very text those numbers covered, which replaces them (no double count; «Прибрати ці позиції» restores them, §7.3). | One list, one item editor; totals can never disagree with positions. |
| D10 | Macro precision | Stored in grams, multiples of **0.5 g**. Position ≤ 1 000 g, meal ≤ 3 000 g. Displayed as whole grams in totals and rows («Б 68»), with 0.5 in the item editor and manual fields («12,5»). | Small items (coffee 0,5 g) stay meaningful, rows stay calm. |
| D11 | Macro goals | `settings.macroGoals` — three optional whole-gram goals (1–1 000), empty = no goal. Over a goal = lavender like kcal over (`--acc` bar, `--accD` number); never red. | Owner decision 4. |
| D12 | Photos | Belong to a meal (`Meal.photos`); the day cap stays **12** across meals (the derived `day.photos` is the union, first 12). The GC also scans `days.meals`. | No limit change for old clients; nothing referenced is collected. |
| D13 | «Часті страви» macros | `FoodItem`/`food.use` gain optional `protein`/`fat`/`carbs` (a key is omitted when unknown, never `null`). A use without macros (old client) keeps the stored macros only when its kcal equals the stored kcal, otherwise drops them. The rule lives **inside `useFood()`** (the server calls it directly, not through `applyOp`). | Backwards-compatible, no stale macros on a changed dish, client and server agree. |
| D14 | Meal order | By `time` ascending; meals without time after the timed ones, in insertion order (stable). | Natural reading order; past days (no time) keep the order she logged. |
| D15 | «Запис дня» | Its food block becomes the live meal list (each meal saves on its own «Зберегти» in the stacked editor). The day sheet's «Зберегти» covers workout, notes, weight, measurements (`day.meta`, `weight.*`, `measure.*`). The day-level «Калорії за день» field is gone. | One way to edit food; no half-saved day drafts. |
| D16 | Stack depth | «Їжа» (depth 0) → «Прийом їжі» (1) → «Позиція» (2) → z-index 60/62/64 (cap 68, below photo viewer 70, toast 80, confirm 90). The stacked `MealSheet` is rendered **inside** the parent sheet's content (React tree) so it stacks above it. | Works with `ui/sheet/stack.ts` unchanged. |
| D17 | Demo / e2e seed | `demoData()`: today stays a **legacy** day (food text, no kcal — keeps the e2e anchors «Записано»), today−6 … today−1 get 3–4 typed meals with macros (same day kcal, so every Progress number stays), older days stay legacy. New seed `'meals'`: demo + today with two meals + macro goals. | Exercises legacy and meals paths; minimal e2e churn. |
| D18 | Kit | **No changes to `apps/web/src/ui/**`.** The totals card and meal rows are capture-local compositions of `Card`, `ListGroup`, `ListRow`, `ProgressBar`. | Keeps the kit stable during parallel work. |
| D19 | Progress | New «Б · Ж · В» strip: average per day for the selected period, per macronutrient over the days where it is **complete** (D22). The one-line period summary (SPEC §1.1 #7 wording) is unchanged. | Requirement wording stays exact; macros get their own place; partial days do not drag the average down. |
| D20 | Dialog names | Static: «Їжа» (day list), «Прийом їжі» (meal editor, new or existing), «Позиція» / «Нова позиція» (item editor), «Що записати?», «Запис дня». | Stable names for e2e and VoiceOver. |
| D21 | DB | Migration **v3** is additive (nullable columns only). `openDatabase` writes `backups/legko-pre-v3-<date>.db` **before** migrating. Rollback = stop the app, run the new image's tested `downgrade-schema` CLI (drops the four new columns, `user_version` 2 — keeps every day's derived food text, kcal and photos), then `deploy/deploy.sh rollback`; the pre-migration snapshot is the fallback. | No rewrite of existing rows; a rollback keeps what she logged after the deploy. |
| D22 | Partial macros | A meal is *complete* for a macronutrient when every position with kcal > 0 has it (with positions) or the meal has it (without); meals without energy and positions are ignored. A day is complete when all its meals are. Totals show the sum of what is known (over-goal is still true on a partial sum); the «Їжа» totals card notes «Б · Ж · В пораховано не для всіх прийомів»; averages use complete days only. | A legacy block or a hand-typed meal without macros must not make a day look like 12 g of protein. |
| D23 | Limits in the editor | New meal at 20 meals → «Зберегти» disabled («Не більше 20 прийомів на день»), `saveMeal` returns false when the reducer refused the append (no false «Збережено»); positions ≤ 30 (an estimate appends only what fits; AI buttons disabled at 30). | No silent loss. |

---

## 2. Data model (`packages/shared`)

### 2.1 Types (`types.ts`)

```ts
export type MacroKey = 'protein' | 'fat' | 'carbs';

/** Grams of protein / fat / carbohydrate; `null` = unknown. Multiples of 0.5. */
export interface MacroGrams {
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}

/** Daily goals in whole grams; `null` = no goal for that macronutrient. */
export type MacroGoals = MacroGrams;

/** One position of a meal: an AI-estimate row, a «Часті страви» dish, or one she typed. */
export interface MealItem extends MacroGrams {
  name: string;
  portion: string;
  kcal: number;
}

/** One meal of a day («Сніданок · 08:30 · тост з тунцем»). */
export interface Meal extends MacroGrams {
  /** Client-generated, unique within the day (`LEGACY_MEAL_ID` for a converted legacy day). */
  id: string;
  /** Type label as chosen when it was saved; '' = no type («Їжа за день» / «Прийом їжі»). */
  type: string;
  /** Local wall-clock time `HH:MM`, or null (past days, or she removed it). */
  time: HM | null;
  /** What she ate, as she wrote it (may be empty when there are positions or a photo). */
  text: string;
  /** With `items`: their sum (recomputed by `normalizeMeal`); otherwise typed by her or null. */
  kcal: number | null;
  /** Food photo ids, oldest first; omitted when none. */
  photos?: string[];
  /** AI / dish / manual positions; omitted when none. With positions, kcal and macros are their sums. */
  items?: MealItem[];
}

export interface DayEntry {
  /** Legacy day: what she ate (free text). Day with meals: DERIVED digest (§2.5) — never edited directly. */
  food: string;
  /** Legacy day: day kcal. Day with meals: DERIVED sum of meal kcal (null when no meal has kcal). */
  kcal: number | null;
  trained: boolean | null;
  types: string[];
  notes: string;
  /** Legacy day: day photos. Day with meals: DERIVED union of meal photos (first 12). */
  photos?: string[];
  /** Present (non-empty) only on a day with meals; absent = legacy day. */
  meals?: Meal[];
}

/**
 * What `day.meta` writes: any of the workout mark, its types and the notes (never the food).
 * Partial: only the keys present are applied (at least one key; `types` is kept only while trained).
 */
export interface DayMeta {
  trained?: boolean | null;
  types?: string[];
  notes?: string;
}

export interface FoodItem {
  name: string; portion: string; kcal: number; count: number; lastUsed: ISODate;
  /** Optional, omitted when unknown (older dishes, old clients). */
  protein?: number;
  fat?: number;
  carbs?: number;
}

export interface Settings {
  /* …goal, kcalGoal, rem, timezone, customTypes, onboarded unchanged… */
  /** Her meal types, in chip order (defaults: DEFAULT_MEAL_TYPES); may be empty. */
  mealTypes: string[];
  macroGoals: MacroGoals;
}

/** `settings.put` value: the new fields are optional — absent means «keep what is stored» (old clients). */
export type SettingsPut = Omit<Settings, 'mealTypes' | 'macroGoals'> &
  Partial<Pick<Settings, 'mealTypes' | 'macroGoals'>>;
```

`api.ts`: `FoodEstimateItem` gains **required** `protein: number | null; fat: number | null; carbs: number | null`
(the new server always sets all three; required so tsc flags every place that rebuilds an item field by field —
`clampItem`, `estimateItems`, `buildFrequentDishes`, `applyRecalc`, the server's `applyRecalculation` — instead of
silently dropping the macros; the resulting break in `features/food` is fixed by the food package, §8.2).
`FoodUse` (schemas.ts) gains the same three keys as optional numbers (a key is omitted when unknown, never `null`).

### 2.2 Limits (`schemas.ts → LIMITS`, additions)

```ts
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
```

Meal text max = `LIMITS.text` (5 000, same as the legacy day text, so a conversion never truncates). Meal kcal max =
`LIMITS.kcal.max` (20 000). Day photo cap stays `LIMITS.photosPerDay` = 12 (union over meals).

### 2.3 Schemas (`schemas.ts`)

```ts
const halfGram = (max: number) =>
  z.number().min(0).max(max).refine((v) => Number.isInteger(v * 2), 'Expected a multiple of 0.5 g');
export const itemMacroSchema = halfGram(LIMITS.macro.max).nullable();
export const mealMacroSchema = halfGram(LIMITS.mealMacro.max).nullable();
export const mealIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Invalid meal id');

export const mealItemSchema = z.object({
  name: foodName,                                         // trim, 1–80
  portion: z.string().trim().max(LIMITS.portion),
  kcal: kcalValue,                                        // int 0–20000
  protein: itemMacroSchema.default(null),
  fat: itemMacroSchema.default(null),
  carbs: itemMacroSchema.default(null),
});

export const mealSchema = z.object({
  id: mealIdSchema,
  type: z.string().trim().max(LIMITS.mealTypeName),       // '' allowed
  time: hmSchema.nullable(),
  text: z.string().max(LIMITS.text),
  kcal: kcalValue.nullable(),
  protein: mealMacroSchema,
  fat: mealMacroSchema,
  carbs: mealMacroSchema,
  photos: z.array(photoIdSchema).max(LIMITS.photosPerDay).optional(),
  items: z.array(mealItemSchema).max(LIMITS.mealItems).optional(),
});

const uniqueIds = (meals: { id: string }[]) => new Set(meals.map((m) => m.id)).size === meals.length;

/** Stored / cached / exported / imported day (AppData). An empty `meals` array means a legacy day (§2.5). */
export const dayEntrySchema = z.object({
  /* food, kcal, trained, types, notes, photos — unchanged */
  meals: z.array(mealSchema).max(LIMITS.mealsPerDay).refine(uniqueIds, 'Duplicate meal ids').optional(),
});
/** The `day.put` op value: never carries meals (zod strips the key) — every day.put is legacy-shaped (§2.6). */
export const dayPutValueSchema = dayEntrySchema.omit({ meals: true });

export const dayMetaSchema = z
  .object({
    trained: z.boolean().nullable(),
    types: z.array(typeName).max(LIMITS.types),
    notes: z.string().max(LIMITS.text),
  })
  .partial()
  .refine((v) => v.trained !== undefined || v.types !== undefined || v.notes !== undefined, 'Empty day.meta');

const macroGoal = z.number().int().min(LIMITS.macroGoal.min).max(LIMITS.macroGoal.max).nullable();
export const macroGoalsSchema = z.object({ protein: macroGoal, fat: macroGoal, carbs: macroGoal });
const mealTypesSchema = z
  .array(z.string().trim().min(1).max(LIMITS.mealTypeName))
  .max(LIMITS.mealTypes)
  .transform(normalizeTypeNames);

export const settingsSchema = z.object({
  /* …existing fields… */
  // Defaults make old stored settings and old backups valid.
  mealTypes: mealTypesSchema.default(() => [...DEFAULT_MEAL_TYPES]),
  macroGoals: macroGoalsSchema.default(() => emptyMacroGoals()),
});
/** The op value: no defaults — absent = keep (D5). */
export const settingsPutSchema = settingsSchema.extend({
  mealTypes: mealTypesSchema.optional(),
  macroGoals: macroGoalsSchema.optional(),
});

// foodUseSchema and foodItemSchema: + protein / fat / carbs: halfGram(LIMITS.macro.max).optional()

// opSchema (discriminated union) — added / changed members:
z.object({ kind: z.literal('day.put'), date: isoDateSchema, value: dayPutValueSchema }),
z.object({ kind: z.literal('day.meta'), date: isoDateSchema, value: dayMetaSchema }),
z.object({ kind: z.literal('meal.put'), date: isoDateSchema, value: mealSchema }),
z.object({ kind: z.literal('meal.delete'), date: isoDateSchema, id: mealIdSchema }),
z.object({ kind: z.literal('settings.put'), value: settingsPutSchema }),

// foodEstimateResultSchema items: + protein / fat / carbs: z.number().min(0).max(LIMITS.macro.max).nullable()
```

`defaults.ts`: `DEFAULT_MEAL_TYPES = ['Сніданок', 'Обід', 'Вечеря', 'Перекус'] as const`, `emptyMacroGoals()`,
`defaultSettings()` includes `mealTypes: [...DEFAULT_MEAL_TYPES]` and `macroGoals: emptyMacroGoals()`,
`normalizeSettings()` fills `mealTypes` (`s.mealTypes ?? defaults`, normalised; an explicit `[]` stays `[]`) and
`macroGoals` (`{ ...emptyMacroGoals(), ...s.macroGoals }`).

### 2.4 Meal helpers (`meals.ts`, new, exported from `index.ts`)

```ts
export const LEGACY_MEAL_ID = 'legacy';
export const MACRO_KEYS: readonly MacroKey[] = ['protein', 'fat', 'carbs'];
export const emptyMacros = (): MacroGrams;
/** Rounds to 0.5 g and clamps to [0, max]; non-finite / null / undefined → null. */
export function roundMacro(v: number | null | undefined, max?: number): number | null;
/** Per key: sum of the known values (rounded, clamped to `max`), null when none is known. */
export function sumMacros(list: readonly MacroGrams[], max?: number): MacroGrams;
/** Trimmed position with clamped kcal and rounded macros; null for a nameless one. */
export function normalizeMealItem(item: MealItem): MealItem | null;
/**
 * Trimmed type (single spaces, ≤ 30) and text, valid time or null, de-duplicated photos (omitted when none),
 * normalised positions (omitted when none); with positions kcal and macros are their sums (kcal clamped to
 * LIMITS.kcal.max, macros to LIMITS.mealMacro.max). Returns null for an EMPTY meal: no text, no kcal, no macro,
 * no photo, no position (a type alone is empty).
 */
export function normalizeMeal(meal: Meal): Meal | null;
export const isEmptyMeal: (meal: Meal) => boolean;
/** No `meals` and some food text, kcal or photos. */
export function hasLegacyFood(day: DayEntry | undefined): boolean;
/** The legacy food as a pseudo-meal { id: LEGACY_MEAL_ID, type: '', time: null, text: food, kcal, photos, macros null }. */
export function legacyMeal(day: DayEntry): Meal | null;
/** What every UI lists: `day.meals`, or `[legacyMeal(day)]`, or []. Defensive (non-array → []). */
export function mealsOf(day: DayEntry | undefined): Meal[];
/** «тост з тунцем, кава»: the text on one line (newlines → «, »), else the position names joined by «, ». */
export function mealContent(meal: Meal): string;
/** §2.5: the derived day food / kcal / photos of a list of normalised meals. */
export function deriveDayFood(meals: readonly Meal[]): { food: string; kcal: number | null; photos: string[] };
/** Sum of the meals' macros (legacy day → all null). */
export function dayMacros(day: DayEntry | undefined): MacroGrams;
/**
 * D22. With positions: every position with kcal > 0 has `key`. Without: `meal[key] !== null`. A meal with
 * (kcal ?? 0) === 0 and no positions is ignored (true).
 */
export function mealMacroComplete(meal: Meal, key: MacroKey): boolean;
/** Every meal of `mealsOf(day)` is complete for `key` (an empty / missing day → true). */
export function dayMacroComplete(day: DayEntry | undefined, key: MacroKey): boolean;
/** §2.8. */
export function suggestMealType(input: { types: readonly string[]; logged: readonly string[]; time: HM | null }): string;
```

Day reducers live in `ops.ts` next to `normalizeDay` (no import cycle: `meals.ts` never imports `ops.ts`):

```ts
export type DayOp = Extract<Op, { kind: 'day.put' | 'day.delete' | 'day.meta' | 'meal.put' | 'meal.delete' }>;
export const isDayOp: (op: Op) => op is DayOp;
/** Pure: the stored day (or undefined) after one day op; undefined = the day is deleted. */
export function reduceDay(stored: DayEntry | undefined, op: DayOp): DayEntry | undefined;
export function putMeal(stored: DayEntry | undefined, meal: Meal): DayEntry | undefined;
export function deleteMeal(stored: DayEntry | undefined, id: string): DayEntry | undefined;
export function setDayMeta(stored: DayEntry | undefined, meta: DayMeta): DayEntry | undefined;
export function mergeLegacyDayPut(stored: DayEntry | undefined, value: DayEntry): DayEntry | undefined;
export function mergeSettingsPut(stored: Settings, value: SettingsPut): Settings;
// private: withMeals(base, meals) — normalises the meals; none left → legacy-shaped day with food '', kcal null,
// no photos, no `meals` key (so removing the last meal never leaves the old derived text behind); else normalizeDay.
```

### 2.5 `normalizeDay()` and the derived fields

```
normalizeDay(e):
  base = { food: e.food.trim(), kcal: e.kcal, trained, types (only when trained, trimmed, unique), notes: trim }
  if e.meals is undefined, not an array or []: → legacy day, exactly today's rules (photos de-duplicated, omitted
                                         when none). An empty array in parsed data never erases food.
  else:                                → meals day; any food / kcal / photos given in `e` are IGNORED
    meals = e.meals → normalizeMeal each → drop nulls → keep the first of duplicate ids
            → stable sort by time (HH:MM asc, null after timed) → first LIMITS.mealsPerDay
    { food, kcal, photos } = deriveDayFood(meals)
    no meal left → no `meals` key, food '', kcal null, no photos (back to an empty legacy-shaped day)
  Reducers that remove meals go through withMeals() (§2.4), never through normalizeDay({ ...base, meals: [] }).
isEmptyDay(e) = today's rule AND !e.meals?.length
normalizeDay(normalizeDay(x)) deep-equals normalizeDay(x)                       (unit-tested)
```

`deriveDayFood(meals)`:

- `food`: one entry per meal joined by `\n`: typed meal → `${type}: ${mealContent(m)}` (just `type` when the content is
  empty); untyped meal → its text **as is** (multi-line kept; position names when the text is empty; «Прийом їжі»
  when it has neither — e.g. a photo- or macros-only meal — so `hasFood`, the menu status and the calendar fill still
  see it). Cut to `LIMITS.text` (the derived text is informational: old clients, `hasFood`, search).
- `kcal`: sum of meal kcal over meals that have kcal, clamped to 20 000; `null` when none has kcal.
- `photos`: union in meal order, de-duplicated, first 12 (meals keep their own photos even beyond that; the GC scans
  them too).

Example — the derived day an old client would see:

```
food  = "Сніданок: Тост з тунцем, кава\nОбід: Борщ, хліб житній\nВечеря: Салат з куркою"
kcal  = 1240        photos = ["a…", "b…"]       meals = [ …3 meals… ]
```

### 2.6 Op semantics (`reduceDay`, mirrored exactly by the server)

| Op | Semantics |
| --- | --- |
| `day.put` (value never has `meals`: `dayPutValueSchema`), stored day has no meals | Exactly today's legacy semantics. |
| `day.put`, stored day **has** meals | **Rule L** (`mergeLegacyDayPut`): keep the stored meals; `trained`, `types`, `notes` from the op; then `extra = legacyExtra(stored, value)`; when `extra` is non-null and its id is not stored yet: < 20 meals → append it; at 20 → merge it into the last meal **without positions** whose id is `legacy` / `old-*`, else into the last meal without positions (text appended on a new line, kcal added, photos within the day cap); when every meal has positions it is dropped. `normalizeDay`; empty → delete. |
| `day.delete`, stored day has no meals | Deletes the day, as today. |
| `day.delete`, stored day **has** meals | Only old clients / old outboxes send it (the new client never does): keep the meals, clear `trained` (null), `types`, `notes`; `normalizeDay`. |
| `day.meta` | Apply only the keys present: `normalizeDay({ ...(stored ?? EMPTY_DAY), ...meta })` (types are dropped unless trained, as today) — meals / legacy food untouched; empty → delete (a meta op on a missing day with nothing set creates nothing). |
| `meal.put` | Base = stored ?? EMPTY_DAY. Meals = `base.meals` ?? (`hasLegacyFood(base)` ? `[legacyMeal(base)]` : `[]`) — **this converts a legacy day**. Replace the meal with the same id, else append when < 20 (else **no change** — `saveMeal` reports false, D23). `withMeals(base, meals)` (an empty meal is dropped = deleted). Empty day → delete. |
| `meal.delete` | Meals day: remove that id (`withMeals`; the last one gone → empty food, kcal null, no photos). Legacy day and `id === 'legacy'`: clear `food`, `kcal`, `photos` (stays legacy-shaped). Unknown id: no change. Empty → delete. |
| `settings.put` | `mergeSettingsPut(stored, value)` = `{ ...value, customTypes: normalizeTypeNames(value.customTypes), mealTypes: normalizeTypeNames(value.mealTypes ?? stored.mealTypes), macroGoals: value.macroGoals ?? stored.macroGoals }`. |
| `food.use` | `useFood()` (the server calls it directly, so the rule lives there); macros: the use's when it has any macro key; else the stored dish's when `stored.kcal === use.kcal`; else none (D13). |

`legacyExtra(stored, value)` — the additive part of an old-client write (pure, deterministic, idempotent):

```
fold(s)      = s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk')
known        = fold of: every line of stored.food (derived), every line of every meal text,
               every mealContent(meal), every position name
extraLines   = lines of value.food (trimmed, non-empty) whose fold is not in known
extraPhotos  = unique(value.photos ?? []) not in any meal's photos (only as many as keep the day ≤ 12)
extraKcal    = value.kcal != null && value.kcal > (stored.kcal ?? 0) ? value.kcal − (stored.kcal ?? 0) : null
all empty    → null
else         → { id: 'old-' + fnv1a32(JSON.stringify([extraLines, extraKcal, extraPhotos])).toString(36),
                 type: '', time: null, text: extraLines.join('\n'), kcal: extraKcal,
                 protein: null, fat: null, carbs: null, photos?: extraPhotos }
```

Replaying the same old op adds nothing the second time (its lines, photos and kcal are now known). Worked examples
(unit tests): (a) old client marks ✓ on a meal day → op carries the derived food/kcal/photos → no extra, meals kept,
`trained: true`; (b) old client appends «Салат — 200 ккал» and raises kcal by 200 → one untyped meal «Салат — 200
ккал», 200 kcal; (c) old client deletes text → ignored; (d) an old outbox op from before the day was converted on
another device («борщ», 500 kcal vs meal «Обід: борщ» 500) → no extra; (g) an old `day.delete` on a meal day keeps
the meals and clears the mark / types / notes; (h) at 20 meals the extra merges into the last meal without positions
and a replay adds nothing.

**Known limits** (documented, tested as current behaviour, not «fixed»): `known` is built from the *current* stored
meals and `extraKcal` from the current derived total, so (e) a stale old client that still shows a meal she deleted on
the phone («Вечеря: Салат», 500 kcal) brings it back as an untyped «Їжа за день» meal with that text and up to its
kcal when it saves anything; (f) a legacy «борщ» 500 converted on the phone and joined by «Обід» 300 (800 stored),
then edited on the old client to «борщ, хліб» 650 → the whole line is added as a duplicate untyped meal without kcal
(650 < 800), so the old client's +150 kcal is lost. Both need an outdated client inside the reload window (or an old
offline outbox); nothing she logged on a new client is deleted, and the extra meal is visible and editable.

### 2.7 `normalizeDay` is the single source of truth

The server's repository (`apps/server/src/db/data.ts`) calls `reduceDay(readDay(date), op)` for every day op and
stores the result (or deletes the row), so client optimistic state and server state are equal by construction; the
existing parity test (`apps/server/test/ops.test.ts` «server persistence matches applyOps()») is extended with random
`meal.put` / `meal.delete` / partial `day.meta` / legacy `day.put` / `day.delete` on meal days / `food.use` with and
without macro keys (incl. a changed kcal for the same dish) ops.

### 2.8 `suggestMealType({ types, logged, time })`

```
fold(s)     = trim, single spaces, toLocaleLowerCase('uk');  logged(t) = fold(t) ∈ fold(logged);  n = types.length
types empty                         → ''
KEYWORDS: breakfast /сніданок|ранк|ранок|завтрак|breakfast/ · lunch /обід|обед|ланч|lunch/ ·
          dinner /вечер|вечір|ужин|dinner|supper/ · snack /перекус|полуденок|полудник|підвечір|полдник|snack/
          (whole snack words, so «Полудень» = noon is not a snack)
S       = the first type matching snack; a snack type never counts as a main meal («Підвечірок», «Перекус після обіду»)
B, L, D = her type whose fold equals the default name (Сніданок / Обід / Вечеря), else the first non-snack type
          containing the keyword; a slot still undefined takes types[0] / types[1] / types[2] if that type is not
          already B / L / D / S (positional pick: [Ранок, День, Вечір, Перекус] → L = День)
time === null (not today)           → first of `types` (her order) not logged, else S ?? types[n−1]
period(time) = breakfast 04:00–10:59 · lunch 11:00–15:59 · afternoon 16:00–16:59 · dinner 17:00–21:59 ·
               late 22:00–23:59 · night 00:00–03:59
if any of B, L, D, S exists (by name):
  primary  = breakfast → B · lunch → L · dinner → D · late → D · afternoon / night → none
  primary exists and not logged      → primary
  primary logged                     → the first unlogged non-snack type matching the same keyword (Другий сніданок)
  fallback = nearest earlier main slot: breakfast → B · lunch, afternoon → L · dinner, late, night → D
  otherwise                          → S ?? fallback ?? types[0]
else (all custom names) → positional: breakfast → types[0] · lunch → types[min(1,n−1)] · dinner, late →
                          types[min(2,n−1)] · afternoon, night → types[n−1]
```

Table (shared `meals.test.ts`, defaults unless stated): 10:00 → Сніданок · 10:00 with Сніданок logged → Перекус ·
13:00 → Обід · 16:30 → Перекус · 22:30 → Вечеря · 22:30 with Вечеря logged → Перекус · 00:30 → Перекус ·
[Сніданок, Обід, Вечеря]: 16:30 → Обід, 23:00 → Вечеря, 10:00 with Сніданок logged → Сніданок · renamed «Ланч» at
13:00 → Ланч · all-custom 4 names → positional · [] → '' · time null → first unlogged; all logged → Перекус; all
logged without a snack type → the last type · [Сніданок, Обід, Вечір, Перекус] 19:00 → Вечір · «Вечірній прийом»
19:00 → Вечірній прийом · [Ранок, День, Вечір, Перекус] 13:00 → День, 19:00 → Вечір · [Завтрак, Обед, Ужин,
Перекус] 08:00 → Завтрак, 19:00 → Ужин · [Сніданок, Другий сніданок, Обід, Полуденок, Вечеря] 16:30 → Полуденок,
10:00 with Сніданок logged → Другий сніданок · [Сніданок, Після тренування, Вечеря, Перекуси] 13:00 → Після тренування
(positional lunch).

The client calls it with `time` = device-local `HH:MM` only when the date is today (`useToday()`), `logged` = types
of the day's meals. e2e clock (Wed 14 Oct 2026 10:00) → «Сніданок». The Settings note (§7.10) is generated by probing
it at 08:00, 13:00, 16:30, 19:00 with `logged = []`, so it is true for her own list.

---

## 3. Compatibility & versioning

**Wire format v2 = v1 + additions.** The server accepts every op and backup the previous client produced, forever.
No field is removed or renamed; every new field is optional on input; absence never deletes anything.

| Situation | What happens |
| --- | --- |
| Old cached PWA after deploy | `pwa/update.ts` reloads it the next time it comes to the foreground idle. Until then: it reads derived `food`/`kcal`/`photos` (meal days look like one text «Сніданок: …» block, kcal and photos right); its `day.put` goes through Rule L (meals kept); its `day.delete` (sent when she clears the whole day in the old sheet) keeps the meals on a meal day and clears only mark / types / notes; its `settings.put` lacks the new keys (zod strips them) → kept (D5); its `food.use` lacks macros → D13. Known limits (e) / (f) of §2.6 apply. |
| Old outbox ops in IndexedDB replayed by the new client | `parseOutbox` validates with the new `opSchema`: an old `day.put` is valid (meals optional), an old `settings.put` is valid (`settingsPutSchema`); `applyOps` uses the same Rule L / D5 locally; the server agrees. |
| Old `legko.data` device cache | `normalizeAppData` → `normalizeSettings` fills `mealTypes` / `macroGoals`; days stay legacy (shown via `mealsOf`). |
| Old JSON backups (no `meals`, `mealTypes`, `macroGoals`, food macros) | `appDataSchema` accepts them (optional / defaulted fields); import → legacy days, default meal types, no goals. |
| New backups | Export = `GET /api/data` incl. `meals`, `mealTypes`, `macroGoals`, food macros; import re-normalises (derived fields recomputed). |
| Database | Migration **v3** (append-only): `ALTER TABLE days ADD COLUMN meals TEXT` (NULL = legacy day; JSON array otherwise); `ALTER TABLE foods ADD COLUMN protein REAL; … fat REAL; … carbs REAL` (NULL = unknown). Existing rows untouched. |
| Pre-migration snapshot | The start-up backup is taken **after** `openDatabase()` migrated (and only when today's file is missing), so it cannot serve a rollback. New: `openDatabase(file)` writes `DATA_DIR/backups/legko-pre-v3-<YYYY-MM-DD>.db` (`VACUUM INTO`, tmp + rename) **before** applying migrations whenever `0 < user_version < MIGRATIONS.length` (generic: `legko-pre-v<target>-…`); the name does not match `BACKUP_RE`, so pruning keeps it. |
| Rollback | The previous build refuses `user_version` 3 (`migrate()` throws), so `deploy/deploy.sh rollback` alone fails its health check. Procedure (DEPLOY.md): `docker compose stop app` → `docker compose run --rm --no-deps app node /app/server/cli.js downgrade-schema` (new image: snapshot `legko-pre-down-v3-<date>.db`, then in one transaction `ALTER TABLE days DROP COLUMN meals; ALTER TABLE foods DROP COLUMN protein; … fat; … carbs; PRAGMA user_version = 2`) → `deploy/deploy.sh rollback`. Lost: meal structure and macros only (each day keeps its derived food text, kcal and first 12 photos; a photo referenced only by a meal beyond those 12 becomes collectable). A later re-upgrade re-adds NULL columns (days become legacy). Fallback: restore `legko-pre-v3-*.db` (loses what was logged after the deploy). Do **not** just lower `user_version`: the v3 `ADD COLUMN` would then fail and a stale `meals` JSON would override newer food. Unsent `meal.put` / `day.meta` ops of new clients are answered `invalid_op` by the old server and dropped by `sync.ts`. |
| New client vs old server | Not possible in normal operation (web and server ship in one image); only during a rollback (above). |
| Corrupt `days.meals` JSON | `dayFromRow` validates with `z.array(mealSchema)`; on failure logs a warning (no user content) and serves the row as a legacy day (the derived columns still hold the food text, kcal and photos); the next meal op re-converts. The photo GC guards `json_each` with `json_valid` and **skips the whole run** (warning) while such a row exists, because photos referenced only by it must not be deleted. |

There is **no data migration and no version flag**: a day's shape (`meals` present or not) is its version.

---

## 4. Server (`apps/server`)

- `db/migrations.ts`: append v3 (above). `db/db.test.ts`: v2 → v3 keeps data and adds the columns; v3 schema on a
  fresh DB.
- `db/open.ts`: the pre-migration snapshot (§3) — file DBs only, never `:memory:`, never on a fresh DB (version 0) or
  an up-to-date one. Tests: a v2 file DB opened by this build leaves `backups/legko-pre-v3-<date>.db` with
  `user_version` 2; fresh and v3 DBs write none; `pruneBackups` keeps it.
- `cli/run.ts`: command `downgrade-schema` (USAGE updated): opens the DB **without** migrating, refuses unless
  `user_version === 3` (clear message), writes `backups/legko-pre-down-v3-<date>.db`, runs the down step in one
  transaction, prints what was dropped. `cli.test.ts`: a v3 DB with a meal day → v2, the day keeps food / kcal /
  photos, the columns are gone; `migrate()` afterwards → v3 again with `meals` NULL; refusing a v2 DB.
- `db/data.ts`: `allDays`/`getDay` select `meals`; `dayFromRow` parses it (§3); `writeDay(date, entry)` stores
  `food, kcal, trained, types, notes, photos` (derived) **and** `meals` (`JSON.stringify(entry.meals)` or NULL) — in
  the INSERT **and** the `ON CONFLICT DO UPDATE` list (else a stale `meals` survives a legacy write);
  `applyRowOp` handles `day.put | day.delete | day.meta | meal.put | meal.delete` as
  `const next = reduceDay(readDay(date), op); next ? writeDay(date, next, at) : deleteDay(date)`; `settings.put` →
  `writeSettings(mergeSettingsPut(readSettings(), op.value))`; foods read/write the macro columns (NULL ↔ omitted
  key; `useFood()` carries the D13 rule); `replaceAll` writes `normalizeDay(entry)` (skip empty). `isDone('workout')`
  unchanged.
- `photos/store.ts` GC query also keeps photos referenced by meals; `json_each` on malformed text throws
  («malformed JSON», verified on Node 24 / SQLite 3.53), so the meals subquery is guarded and the run is skipped while
  a corrupt row exists:

  ```sql
  -- skip the run (logger.warn, no content) when this returns a row:
  SELECT 1 FROM days WHERE meals IS NOT NULL AND NOT json_valid(meals) LIMIT 1;

  SELECT id FROM photos p WHERE p.created_at < ?
    AND NOT EXISTS (SELECT 1 FROM days d, json_each(d.photos) j WHERE j.value = p.id)
    AND NOT EXISTS (SELECT 1 FROM days d,
                      json_each(CASE WHEN json_valid(d.meals) THEN d.meals ELSE '[]' END) m,
                      json_each(m.value, '$.photos') j
                    WHERE j.value = p.id)
  ```

- Estimate (§5): `food/claude.ts`, `food/estimator.ts`, `http/routes/food.ts`.
- `scripts/seed-demo.ts` (§6.5).
- Tests: `test/ops.test.ts` (new ops, Rule L examples a–h incl. the known limits e/f as current behaviour, day.delete
  on a meal day, partial day.meta, settings merge, food.use macros, `day.put` with a `meals` key is stripped, parity
  incl. meal ops), `test/export-import.test.ts` (old backup imports; new round-trip; a backup day with `meals: []`
  keeps its food), `test/food.test.ts` (macros in responses, recalculation macros, clamping), `photos/store.test.ts`
  (meal-referenced photo survives GC; a corrupt `meals` row skips the run), `food/claude.test.ts` /
  `estimator.test.ts` (prompt + schema fields, sanitising), `db.test.ts` / `cli.test.ts` (snapshot, downgrade).

---

## 5. AI contract (estimate + recalculation)

Unchanged: endpoint, request schema, modes, budget (one call per estimate or recalculation, 60/day), photo storage,
model / effort / fallback / timeout, `stop_reason` handling.

**System prompt** (`SYSTEM_PROMPT`, «How to answer»), after the `kcal` line add:

```
- protein, fat, carbs: grams of protein, fat and carbohydrate in that portion, to the nearest 0.5 g. Keep them
  consistent with kcal (about 4 kcal per gram of protein or carbohydrate and 9 per gram of fat; alcohol adds energy
  without macronutrients). Water, black coffee, plain tea and other drinks without energy: 0, 0, 0.
```

**Recalculation prompt** (`RECALC_SYSTEM_PROMPT`): replace the `kcal:` rule with

```
- kcal, protein, fat, carbs: the energy and the macronutrients of exactly that food in exactly that portion. Where a
  line has no portion, assume a typical home portion in Ukraine.
```

**Model output schema** (`modelOutputSchema`, kept permissive — no numeric bounds in the JSON schema; the sanitiser
enforces them): each item `{ name, portion, kcal, protein, fat, carbs }`, the three new fields
`z.number().describe('Protein in this portion, grams')` / `'Fat …'` / `'Carbohydrate …'`. `RawEstimate` items gain
the three numbers.

**Sanitising** (`estimator.ts`): `clampMacro(v)` = non-finite → `null`, else `roundMacro(v, LIMITS.macro.max)`
(0.5 g steps, 0–1000). `sanitizeEstimate` sets all three on every item; `FoodRecalculation` becomes
`{ kcal: number[]; macros: MacroGrams[]; comment }` (by index); `applyRecalculation` returns her names/portions with the
new kcal **and** macros. `foodEstimateResultSchema` validates the macros (`nullable`). No kcal ↔ macro consistency
rewriting on the server (alcohol would break it); the prompt asks for consistency.

**Response**: `FoodEstimateResponse.items[i]` = `{ name, portion, kcal, protein, fat, carbs }` (numbers, or null when
the model gave a non-finite value); `totalKcal` unchanged.

Client rescaling on the device (no model call), SPEC §3.7 extended: when only the amount changes within a comparable
unit group, kcal **and** the three macros scale by the same ratio from the last model-confirmed values (macros rounded
to 0.5 g). A position she prices by hand keeps her numbers on «✨ Перерахувати» (kcal pin and macro pin are separate).
When she **types kcal** and the macros are not pinned, the macros follow by `typedKcal / referenceKcal` (reference =
the device-known kcal for that name and amount: the confirmed base or `scaleItem`), rounded to 0.5 g; reference 0 or
unknown → macros null («—»). A «Часті страви» dish without macros sets the macros to null unless they are pinned. So
a position's macros never describe a different amount than its kcal.

---

## 6. Web core APIs (package `core`)

### 6.1 Store (`apps/web/src/store/data.ts`)

```ts
dataActions.saveMeal(date: ISODate, meal: Meal, uses?: readonly FoodUse[]): boolean;
//   commit(meal.put, ...food.use) — invalid uses are left out (they must not block the meal); false = refused by
//   the schema, OR the meal is non-empty and the reduced day does not contain its id (append refused at 20, D23)
dataActions.deleteMeal(date: ISODate, id: string): boolean;          // meal.delete
dataActions.setDayMeta(date: ISODate, meta: DayMeta): boolean;       // day.meta, only the keys given
dataActions.saveDay(date, entry)                                     // @deprecated: kept, no new caller (meals stripped)
export function newMealId(): string;  // 12 chars [A-Za-z0-9_-], crypto.getRandomValues with a Math.random fallback
```

`store/ui.ts`: `SheetMode` gains `'meal'` — «Прийом їжі»: a new meal for `date` (the «+» menu's Їжа row swaps to it;
Home / calendar open it for an empty day). New `ui.moveSheet(date)`: changes the open sheet's date keeping `mode`,
`key` and `patch` (no-op without a sheet) — used by the new-meal date nav so the draft moves with her (§8.1).
`store/dayMarks.ts`: `setTrainedMark` writes `setDayMeta(date, { trained })` only — the reducer keeps the stored types
on ✓ and drops them on ✕ (normalizeDay keeps types only while trained); never touches food, types or notes on the
wire; `markTrained` / `markNoTraining` return `DayMeta`. `store/normalize.ts`:
unchanged logic (settings normalised by the shared `normalizeSettings`); tests for old caches and old outbox ops.

### 6.2 Nutrition view helpers (`apps/web/src/lib/nutrition.ts`, pure)

```ts
export const MACRO_LABELS: Readonly<Record<MacroKey, { name: string; abbr: string; lower: string }>>;
//   protein { 'Білки', 'Б', 'білки' } · fat { 'Жири', 'Ж', 'жири' } · carbs { 'Вуглеводи', 'В', 'вуглеводи' }
export function gramsText(g: number | null | undefined, precise?: boolean): string; // 68 → «68», 12.5 → «13» | precise «12,5», null → «—»
export interface DayNutrition {
  meals: Meal[]; legacy: boolean; count: number; kcal: number | null; macros: MacroGrams; hasMacros: boolean;
  /** D22: per macronutrient, every meal is complete (`dayMacroComplete`). */
  complete: Record<MacroKey, boolean>;
}
export function dayNutrition(day: DayEntry | undefined): DayNutrition;       // mealsOf + derived kcal + dayMacros
export interface MacroPart { key: MacroKey; abbr: string; name: string; value: string; goal: string | null; known: boolean; over: boolean; partial: boolean }
export function macroParts(m: MacroGrams, goals?: MacroGoals, complete?: Record<MacroKey, boolean>): MacroPart[]; // always 3, Б Ж В; partial = known && complete?.[key] === false
// Line breaks: NBSP (U+00A0) inside each part and before units («Б 68», «132 г», «3 прийоми») and before « ·», a
// normal space after it — a line can only break after «·». Unit tests use the NBSP; e2e text matching normalises \s.
export function macroLine(m: MacroGrams, goals?: MacroGoals): string | null; // «Б 68 · Ж 41 · В 132 г» · «Б 68/90 · Ж 41/60 · В 132 г» · null when none known
export function macroSpeech(m: MacroGrams, goals?: MacroGoals): string | null; // «білки 68 з 90 г, жири 41 з 60 г, вуглеводи 132 г»
export type MacroGoalState = 'none' | 'empty' | 'ok' | 'reached' | 'over';
export interface MacroGoalView { state: MacroGoalState; pct: number; value: string; goal: string | null; label: string }
export function macroGoalView(key: MacroKey, grams: number | null, goal: number | null): MacroGoalView;
//   none = no goal · empty = no value · over = rounded value > goal · reached = equal · pct = min(100, value / goal × 100)
export function mealTitle(meal: Meal): string;   // type || «Їжа за день» (ids 'legacy' / 'old-*') || «Прийом їжі»
export function mealCountText(n: number): string; // «1 прийом», «3 прийоми», «5 прийомів»
export function mealTypeChoices(mealTypes: readonly string[], current: string): string[]; // her list + `current` when not in it
```

### 6.3 Stats (`apps/web/src/lib/stats/nutrition.ts`, exported from `lib/stats.ts`)

```ts
export interface MacroAverages extends MacroGrams { /** Days in range counted for at least one macronutrient. */ days: number }
/**
 * Per macronutrient: mean of the day totals over the days in [from, to] where that total is known AND the day is
 * complete for it (`dayMacroComplete`, D22) — a legacy block or a hand-typed meal without macros excludes the day.
 */
export function macroAverages(data: AppData, from: ISODate, to: ISODate): MacroAverages;
```

Every existing stat keeps reading `entry.kcal` (derived) — unchanged.

### 6.4 e2e support (`e2e/support/**`)

- `app.ts`: `SheetName` += `'Прийом їжі' | 'Позиція' | 'Нова позиція'`; `RECORD_SHEETS['Їжа'] = 'Прийом їжі'`;
  `SettingsSection` += `'Прийоми їжі'`, `SETTINGS_SLUGS['Прийоми їжі'] = 'meals'`; new methods
  `mealList(sheet)` (region «Прийоми їжі» — present in both the «Їжа» list and the «Запис дня» food field),
  `mealRow(sheet, title)` (button whose name starts with `title`),
  `addMealButton(sheet)` (button «Додати прийом їжі»), `mealType(sheet, label)` (pressed-state chip in group «Тип
  прийому їжі»), `openFoodDay()` (Home «Їжа» row → sheet «Їжа»), `newMeal()` (= `record('Їжа')`),
  `saveMeal(sheet)` (clicks «Зберегти» in that dialog, waits for it to close and for «Збережено»).
- `food.ts`: `TEXT_ESTIMATE` / `PHOTO_ESTIMATE` carry macros (Борщ 300 г 180 ккал Б 6 Ж 9 В 19; Хліб житній 2 скибки
  140 Б 4,5 Ж 1 В 28; Сирники зі сметаною 3 шт 420 Б 22 Ж 22 В 33); `recalcAnswer(items)` builds a recalculation reply.
- `server.ts`: `ServerApi.sendOps(ops: unknown[]): Promise<APIResponse>` for API-level compat tests.

### 6.5 Seeds

`apps/server/scripts/seed-demo.ts` — **must not consume the shared `rnd()`** (every existing number stays): after the
loop, for each day `d` in [today−6, today−1] with food and kcal, split `e.food` by «, » into 3 or 4 dishes →
types `[Сніданок, Обід, Вечеря]` / `[Сніданок, Обід, Перекус, Вечеря]`, times `08:30 · 13:00 · (16:30) · 19:30`,
kcal shares `[.3,.4,.3]` / `[.25,.35,.1,.3]` rounded to 10 with the last meal taking the remainder (sum = the day's
kcal exactly), macros by type (% of kcal P/F/C: Сніданок 18/30/52, Обід 28/32/40, Перекус 12/35/53, Вечеря
32/35/33; grams = round(kcal·p/4), round(kcal·f/9), round(kcal·c/4)), ids `demo-${d}-${i}`, text = dish with an
upper-case first letter; yesterday's breakfast also gets one position mirroring it (portion «1 порція»). Store
`normalizeDay({ ...e, meals })` so export/import round-trips deep-equal. Foods: Вівсянка з бананом 250 г 320 (Б 9 Ж 6 В
58), Кава з молоком 1 чашка 60 (Б 3 Ж 3 В 5), Борщ 300 г 180 (Б 6 Ж 9 В 19), Курка з рисом 350 г 520 (Б 38 Ж 14 В
60), Яблуко 1 шт 80 (no macros). Today stays legacy («Вівсянка з бананом, кава», no kcal).

`e2e/fixtures/data.ts`: `SeedName` += `'meals'` = demo + today replaced by `normalizeDay` of two meals —
Сніданок 08:15 «Вівсянка з бананом, кава з молоком» with positions [Вівсянка з бананом 250 г 320 / 9 · 6 · 58, Кава з
молоком 1 чашка 60 / 3 · 3 · 5] (380 ккал, Б 12 Ж 9 В 63) and Перекус 09:40 «Яблуко» 80 ккал (no macros) → day 460
ккал, Б 12 · Ж 9 · В 63; `settings.macroGoals = { protein: 90, fat: 60, carbs: null }`. Exports
`MEALS_TODAY` and `MEALS_GOALS` for assertions.

---

## 7. UX (phone 390×844 first; desktop = the same content in the 560px centred modal)

### 7.1 Flows

```
 Log a meal now            «+» ─▶ Що записати? ─▶ [Їжа] ═▶ Прийом їжі (new; type preselected; «Що я їла» focused)
                                                            └─ Зберегти → sheet closes, toast «Збережено»
 First meal of the day     Home «Їжа» row (nothing logged) ─▶ Прийом їжі (new, same editor; 1 tap to the keyboard)
 Review / edit today       Home «Їжа» row ─▶ Їжа (totals + meals) ─▶ meal row ═▶ Прийом їжі (stacked) ═▶ Позиція (stacked)
 A past day                Calendar day ─▶ Їжа row ─▶ Їжа (that date; «Додати» on an empty day ─▶ Прийом їжі) …
                           «Запис дня» food block ─▶ Прийом їжі (stacked)
 From the new-meal editor  «Усі прийоми за день →» swaps the same dialog to «Їжа» (asks first if she typed)
 Wrong date in the editor  ‹ › move the new-meal draft to that date (nothing typed is lost, no prompt)
 ═▶ stacked sheet over the one below (D16)   ─▶ swap or navigate
```

Why the menu goes straight to the editor (D8): the «+» menu is the "record something now" path — its food row is a
new meal almost every time; opening the list first costs a tap and a scan before the keyboard. Reviewing a day with
food (totals, editing an earlier meal) starts from Home or the calendar, where the list is one tap; on a day with
nothing logged that list would be empty, so those rows open the editor directly. The editor still links to the list,
so nothing is hidden.

Opening with the keyboard (iOS): every open of a **new** meal focuses «Що я їла» inside the tap. The opener wraps
the open in `flushSync` (the «+» menu row, Home / calendar empty-day rows, FoodDayPanel «+ Прийом їжі»), so the
textarea's `autoFocus` runs in the same task as the tap (the NotesBlock pattern). Existing meals open without focus.

### 7.2 «Їжа» — the day's list (`SheetMode 'food'`, capture)

```
 ┌──────────────────── ▬ ──────────────────────┐
 │ Їжа                                     (✕) │   heading = dialog name «Їжа»
 │ ‹        14 жовтня 2026        ›            │   date nav (unchanged)
 │          середа · сьогодні                  │
 │ ┌─────────────────────────────────────────┐ │   DayNutritionCard: Card (no header), section «Підсумок дня»
 │ │ 1 240 / 1 700 ккал                      │ │   number 28/700 tabular; « / 1 700 ккал» 15/500 --ink2
 │ │ ████████████████████░░░░░░  (md, mint)  │ │   ProgressBar md: acc2 ≤ goal, acc over; decorative
 │ │ Залишилось 460 з 1 700 ккал             │ │   13 --ink2 = kcalGoalView(kcal, goal).text
 │ │                                         │ │
 │ │ Білки        68 / 90 г   ███████░░  sm  │ │   <dl> grid: name 15/600 | value 15/700 tabular | bar
 │ │ Жири         41 / 60 г   ██████░░░  sm  │ │   bar only with a goal (sm 6, acc2 / acc over)
 │ │ Вуглеводи    132 г                      │ │   no goal → value only; unknown → «—»
 │ └─────────────────────────────────────────┘ │
 │ Прийоми їжі                                 │   ListGroup caption (region «Прийоми їжі»)
 │ ┌─────────────────────────────────────────┐ │
 │ │ Сніданок · 08:30            420 ккал  › │ │   ListRow md, no icon; title + « · 08:30» (--muted)
 │ │ Тост з тунцем, кава                     │ │   sub line 1: mealContent, 1 line, ellipsis
 │ │ Б 27 · Ж 11 · В 36 г                    │ │   sub line 2: macroLine (omitted when none known)
 │ │ [th][th]                                │ │   children: PhotoStrip sm (only with photos)
 │ │─────────────────────────────────────────│ │
 │ │ Обід · 13:10                560 ккал  › │ │
 │ │ Борщ, хліб житній                       │ │
 │ │ Б 21 · Ж 19 · В 64 г                    │ │
 │ │─────────────────────────────────────────│ │
 │ │ Перекус                       —       › │ │   value «—» when the meal has no kcal (soft)
 │ │ Яблуко                                  │ │
 │ └─────────────────────────────────────────┘ │
 ├─────────────────────────────────────────────┤
 │ [            + Прийом їжі              ]    │   sticky footer: solid Button, aria-label «Додати прийом їжі»
 └─────────────────────────────────────────────┘
```

States and copy:

- Empty day (reached by `/?sheet=food` or «Усі прийоми за день →»): no list, muted «Ще нічого не записано за цей
  день» under the card; the kcal card shows «— / 1 700 ккал», meter 0, «Ціль — 1 700 ккал на день»; macro block
  hidden unless a macro goal exists (then «— / 90 г»).
- Macro block: shown when any macro is known or any goal is set. Over goal: value `--accD`, bar `acc`; equal: value
  `--acc2D`; never red. Partial (D22: some meal with energy lacks that macronutrient): the sum of what is known plus,
  once under the grid, a 13 `--ink2` note «Б · Ж · В пораховано не для всіх прийомів».
- Legacy day: one row «Їжа за день» (sub = the text, value kcal) + ListGroup note «Запис зі старої версії — відкрий
  його, щоб обрати тип прийому.»
- 20 meals: footer button `aria-disabled` + note «Не більше 20 прийомів на день».
- Row accessible name: «Сніданок о 08:30: тост з тунцем, кава. 420 ккал, білки 27, жири 11, вуглеводи 36 г» +
  `aria-haspopup="dialog"`.
- The totals card value markup (so visible text and e2e text stay «68 / 90 г» while VoiceOver reads «68 з 90 г»):
  `<dd><span aria-hidden="true">68 / 90 г</span><span class="visuallyHidden">68 з 90 г</span></dd>`; e2e asserts on
  the `aria-hidden` span (or by regex), a component test fixes the markup.
- Desktop: the same in the 560px modal.

### 7.3 «Прийом їжі» — the meal editor (food package; hosted by capture)

```
 ┌──────────────────── ▬ ──────────────────────┐
 │ Прийом їжі                              (✕) │   dialog «Прийом їжі» (new and existing)
 │ ‹        14 жовтня 2026        ›            │   date nav only in mode 'meal' (menu / Home / calendar hosted)
 │ 13 жовтня · вівторок                        │   instead, when stacked and date ≠ today: 13 --muted line
 │ (Сніданок)(Обід)(Вечеря)(Пере… ⟩ (+ Свій)   │   ChipGroup «Тип прийому їжі», single select (aria-pressed),
 │                                             │   ONE row: the chips scroll sideways on touch (edges fade over
 │                                             │   the 18 / 20px paddings only, snap to a chip's start; wrap with
 │                                             │   a mouse); «+ Свій» sits OUTSIDE the scroller at the row's end,
 │                                             │   always on screen; selected chip scrolled into view, whole
 │ [ ✨ Порахувати ]   [ 📷 Фото ]              │   AI row ABOVE the text (hidden without AI) — stays visible
 │                                             │   over the iPhone keyboard while «Що я їла» is focused
 │ ┌ Тост з тунцем, кава                     ┐ │   TextArea aria-label «Що я їла», 2 rows → grows to 6,
 │ └                                         ┘ │   placeholder «Напр.: тост з тунцем, кава»; new meal: focused
 │ Ще не пораховано: яблуко                    │   13 --ink2, only with positions and a pending tail
 │ [thumb][thumb]                              │   PhotoStrip md with remove
 │ ┌ Позиції ───────────── 2 позиції ────────┐ │   positions card (§7.4) when there are positions or loading
 │ │ Тост з тунцем          2 шт   310 ккал ›│ │
 │ │ Б 24 · Ж 8 · В 31                       │ │
 │ │ Кава з молоком      1 чашка    60 ккал ›│ │
 │ │ Б 3 · Ж 3 · В 5                         │ │
 │ │ + позиція                               │ │
 │ │ Разом  370 ккал · Б 27 · Ж 11 · В 36 г  │ │
 │ │ [ ✨ Перерахувати ]   (only when needed) │ │
 │ │ Прибрати ці позиції                     │ │   ghost, right after an estimate (undo of that estimate)
 │ └─────────────────────────────────────────┘ │
 │ ── without positions instead of the card ── │
 │ Калорії   [        ] ккал                   │   inputmode numeric, 16px
 │ + Б · Ж · В                                 │   ghost; opens the 3 inputs (open when the meal has macros)
 │ [ Білки  г ] [ Жири  г ] [ Вуглеводи  г ]   │   3 columns, inputmode decimal, comma ok, 0,5 g steps
 │ ─────────────────────────────────────────── │
 │ Часті страви: (Вівсянка з бананом · 320)…   │   chips add a position (with the dish's macros)
 │ За день: 1 240 / 1 700 ккал                 │   13, live (other meals + this draft); over → --accD
 │ Усі прийоми за день →                       │   ghost, mode 'meal' only and the day has other meals
 │ Час 10:02 (✕)                    or + Час   │   one compact row at the bottom; TimeInput 44; ✕ «Прибрати час»
 │ ─────────────────────────────────────────── │   `.danger` section (6px + 18px, 1px --line top border)
 │ [           Видалити прийом             ]   │   full-width outline Button --accD (item editor's «Видалити
 │                                             │   позицію» pattern), existing meals only (confirm)
 ├─────────────────────────────────────────────┤
 │ [                Зберегти                ]  │   disabled until there is content (hint above, aria-describedby)
 └─────────────────────────────────────────────┘
```

**Height budget** (390×797 web view, sheet capped at 92dvh = 733px, top at y ≈ 64): header with date nav ≈ 138,
chips row 44 + 12, AI row 44 + 12, text 76 → the textarea ends ≈ 326px below the sheet top (y ≈ 390), above the
iPhone keyboard with its accessory bar (covers y > ≈ 417). iOS reveals the focused field on any sheet height, and the
row right above it stays on screen, so the photo / estimate buttons are always reachable without «Готово». Everything
below the text is optional and scrolls; a new meal without positions is ≈ 690px (no clutter: the macro inputs and
the time are folded / compact).

- Opening: new meal → `type = suggestMealType(...)`, `time` = now (today) or null (another day), focus «Що я їла»
  inside the opening tap (`autoFocus`; the host opens with `flushSync`, §7.1). Existing → its values, no focus;
  chips = her types, then the meal's own label when it is not in the list (selected), then labels picked in this
  session (`MealDraft.pickedTypes`, by `mealTypeKey`), so a renamed label or a name «лише для цього прийому» stays a
  chip after she taps another one and the order never shifts. Legacy pseudo-meal → no chip
  selected, hint «Це запис зі старої версії. Обери тип — і він стане окремим прийомом їжі.»
- Type chips: single select; tapping the selected chip again **keeps** it (D6). With an empty `mealTypes` list only
  «+ Свій» shows and the meal is untyped («Прийом їжі»).
- «+ Свій» (aria-label «Додати свій тип прийому їжі») → inline input (placeholder «Назва», aria «Новий тип прийому
  їжі», ✓ «Додати тип», Escape cancels without closing the sheet); the name is added to `settings.mealTypes` at once
  (≤ 12; an existing spelling wins) and selected. At 12 types it is used for this meal only and a `role="status"`
  line says «У списку вже 12 типів — ця назва лише для цього прийому».
- AI row: «✨ Порахувати» (accessible name «Порахувати калорії») estimates the text — aria-disabled with hint «Опиши,
  що їла» while the text is empty; «📷 Фото» (accessible name «Порахувати калорії за фото») — hint text sent along.
  Results are **appended** as positions (at most 30 − current rows; the announcement says how many were added; focus
  to the card title, «Знайдено 2 позиції, разом 370 ккал» announced). With positions the first button is:
  «✨ Порахувати решту» (accessible «Порахувати решту: яблуко») when a pending tail exists — it estimates that tail
  directly, no composer — else «✨ Додати ще» (accessible «Додати ще: порахувати калорії») → composer «Що ще
  порахувати?». Pending tail = the text after the last estimated text when the text still starts with it (leading
  «,;» and spaces trimmed), else none. Offline / budget hints unchanged. Caps: 12 photos per day across meals → «📷
  Фото» aria-disabled with «Не більше 12 фото на день»; 30 positions → both aria-disabled with «Не більше 30
  позицій». The emoji are `aria-hidden`.
- Undo of an estimate: rows added by one estimate carry its `estimateId`; right after it the card shows the ghost
  «Прибрати ці позиції» (accessible «Прибрати ці позиції — останній підрахунок», so the name starts with the visible
  words, WCAG 2.5.3) which removes exactly those rows and the photo that estimate attached in this session, announces
  «Позиції прибрано» and moves focus to the AI row. It disappears once one of those rows is edited, another estimate
  runs or the meal is saved.
- Manual numbers: «Калорії» always; «+ Б · Ж · В» opens the three inputs (`flushSync` + focus «Білки» inside the
  tap, the NotesBlock pattern); open from the start when the meal already has a typed macro. Manual → positions
  (D9):
  - An estimate that re-prices **the same text** her typed numbers covered (no positions yet, and the estimate
    counted the whole «Що я їла» — «✨ Порахувати», or «📷 Фото» with her text as the hint) **replaces** her typed
    kcal / Б · Ж · В with its rows (no double count, e.g. an old «Їжа за день» block with 1 880 ккал). Her numbers are
    kept in the undo state (`UndoState.manual`): «Прибрати ці позиції» puts them back in their fields (or as «Інше»
    if a dish chip was added since). An estimate that finds nothing leaves them as they are.
  - Every other first position — a «Часті страви» chip, «+ позиція», a photo without her text — turns the typed
    numbers into a position «Інше» (pinned, «вручну»).
- Day line: «За день: 1 240 / 1 700 ккал» = kcal of the day's other meals (this meal's stored kcal left out) + this
  draft's kcal, against `settings.kcalGoal` (state via `kcalGoalView`: over → `--accD`); hidden while the total is 0.
- «Усі прийоми за день →»: the visible text is the accessible name (no aria-label); the host swaps to «Їжа» through
  its guard.
- Validation: «Зберегти» needs text, a photo, kcal, a macro or a position; disabled hint «Опиши, що їла, або додай
  калорії чи фото»; kcal > 20 000 «Калорії — не більше 20 000 ккал»; macro > 3 000 «Не більше 3 000 г»; a new meal on
  a day that already has 20 → «Не більше 20 прийомів на день»; disabled while «Рахую…».
- Save: `dataActions.saveMeal(date, meal, uses)` (uses = positions added from estimates / dishes in this session, with
  final names, portions, kcal and only the known macro keys) → host closes, toast «Збережено». Refused → «Не вдалося
  зберегти — перевір дані й спробуй ще раз» stays until she edits.
- Delete: `ui.confirm({ title: 'Видалити прийом їжі?', body: 'Сніданок · 420 ккал', confirmLabel: 'Видалити',
  cancelLabel: 'Залишити', destructive: true })` → `deleteMeal` → host closes, toast «Прийом видалено».
- Date nav (mode 'meal', new meal): ‹ › call `ui.moveSheet(newDate)` — the draft moves to that date (text, photos,
  positions, manual numbers kept; type and time re-suggested only if she has not touched them; photos over the new
  day's capacity block «Зберегти» with the photo hint). No discard prompt.
- Close with changes (✕, backdrop, Escape, drag, «Усі прийоми за день →»): «Є незбережені зміни / Закрити без
  збереження?» (DISCARD). Dirty = draft differs from what was loaded, an estimate is loading, or the item editor
  holds changes.

### 7.4 Positions card and «Позиція» (food package)

The former «Оцінка калорій» card becomes the meal's positions card «Позиції» (subtitle «2 позиції · можна
виправити»): rows `name (+ змінено / вручну)` · second line `portion · Б 24 · Ж 8 · В 31` · `kcal ›`; «+ позиція»;
«Разом 370 ккал» + macro line; «✨ Перерахувати» when a row needs the model; «Прибрати ці позиції» right after an
estimate; model comment. No «Додати N ккал» and no «Скасувати» (positions are part of the draft; «Видалити позицію»
in the item editor removes one). At most 30 rows (`MAX_ROWS === LIMITS.mealItems`).

```
 «Позиція» (size="compact", depth 1 or 2)
 ┌──────────────────── ▬ ──────────────────────┐
 │ Позиція                                 (✕) │
 │ Назва  [ Тост з тунцем                 ]    │  (unchanged: suggestions, «повернути: …»)
 │ Кількість  [−] [ 2 ] [+]  (г)(мл)(шт)…      │  (unchanged)
 │ 310 ккал                                    │  32/700
 │ Б 24 · Ж 8 · В 31 г                         │  NEW 15/600 --ink2, aria-live with the kcal line
 │ перераховано за кількістю                   │  note (covers kcal and macros)
 │ Вписати вручну                              │  → kcal input + 3 macro inputs (Білки / Жири / Вуглеводи, г)
 │ Видалити позицію                            │
 ├─────────────────────────────────────────────┤
 │ [ ✨ Перерахувати ]        [   Готово   ]    │
 └─────────────────────────────────────────────┘
```

Rules: a name or portion change releases both pins and, when the device can compare the amounts, rescales kcal and
macros from the model's last values; otherwise the old numbers stay and the row is «змінено». Typing kcal pins kcal
and, while the macros are not pinned, rescales them by typed / reference kcal (§5; reference unknown or 0 → «—»;
note «Б · Ж · В перераховано за калоріями»); typing a macro pins the macros (as a set); a pinned value survives
«✨ Перерахувати». A «Часті страви» dish sets its kcal and macros (null when the dish has none, unless pinned) and
they follow her amount like the kcal do today.

### 7.5 «Запис дня» (capture)

```
 Тренування  [✓ Було] [✕ Не було]  (types)
 Їжа                                                Field label
 ┌─────────────────────────────────────────┐        flush ListGroup, aria-label «Прийоми їжі» (region,
 │ Сніданок · 08:30              420 ккал ›│        same name as in «Їжа» so the e2e helpers work in both);
 │ Тост з тунцем, кава                     │        same rows as §7.2 (no photos strip in rows here)
 │ Б 27 · Ж 11 · В 36 г                    │
 │ Обід · 13:10                  560 ккал ›│
 └─────────────────────────────────────────┘
 Разом 980 / 1 700 ккал · Б 48 · Ж 30 · В 100 г     14 --ink2 (one line, wraps after «·» only)
 [ + Прийом їжі ]                                   outline md, aria «Додати прийом їжі»; aria-disabled at 20
 Вага (за бажанням) · Заміри (за бажанням) · Нотатки   (unchanged)
 ─────────────────────────────────────────────────
 [ Зберегти ]   → day.meta (only the changed fields) + weight / measure, never the food
```

Empty: «Ще нічого не записано» + the button. Meal rows and the button open the stacked «Прийом їжі». At 20 meals the
button is `aria-disabled` with the note «Не більше 20 прийомів на день».

### 7.6 «Що записати?» menu (capture)

Row «Їжа»: sub «Новий прийом їжі», status unchanged («1 240 ккал», lavender when over, «Записано» for food without
kcal); tap → `flushSync(() => ui.openSheet(date, 'meal'))` (same dialog swaps to «Прийом їжі», keyboard opens).

### 7.7 Home «Сьогодні» → Їжа row (home)

```
 [F] Їжа                          1 240 / 1 700 ккал ›
     Б 68 · Ж 41 · В 132 г · 3 прийоми                 no goals (--ink2)
     Б 68/90 · Ж 41/60 · В 132 г                       with goals (no count); an over part «95» in --accD
     ██████████████████░░░░░                           meter (kit order: title · sub · meter)
```

The kit's ListRow orders the areas title / sub / meter (`.hasSub.hasMeter`), so the macro line sits **above** the
meter (D18: no kit change); shots 14 / 15 are judged against this order. The macro sub uses the default `--ink2`
(`subTone` is `acc` only for the «Калорії не вказані» note); only an over part gets `--accD`. NBSP inside every part
and before units («Б 68», «132 г», «3 прийоми»), so at 320px the line breaks only after «·».

States: empty → unchanged look, but the row opens the **new-meal editor** (`'meal'`, opened with `flushSync`);
recorded (no kcal) → unchanged «Записано» + «Калорії не вказані», opens «Їжа»; kcal without macros → sub «3 прийоми»
(meals day) or none (legacy); kcal + macros → the macro sub above. Accessible name «Їжа: 1 240 з 1 700 ккал,
залишилось 460. Білки 68 з 90 г, жири 41 з 60 г, вуглеводи 132 г. 3 прийоми їжі» (+ « (не для всіх прийомів)» after
the macro sentence when a part is partial, D22). One-screen budget: +19px for the sub line (slack ~43 → ~24px);
320px wraps the goal form to 2 lines (clamped). The worst case (meal day with sub + meter, the 2-line «Заміри» sub,
two workout types) is tested as one combination.

### 7.8 Calendar day card → Їжа row (calendar)

```
 [F] Їжа                                1 740 ккал ›
     Сніданок · 520 ккал · Тост з авокадо
     Обід · 700 ккал · Салат з куркою
     Вечеря · 520 ккал · Індичка з броколі
     Б 114 · Ж 62 · В 181 г
     [th][th]
```

(The demo seed's 13 October: 1 740 kcal split 520 / 700 / 520, macros by the §6.5 type shares.)

At 390px the sub is ≈ 242px wide and «Сніданок — Тост з авокадо · 520 ккал» (≈ 247px) would wrap and leave «ккал»
alone, so: **one line per meal** `${mealTitle} · ${kcal} ккал · ${mealContent}` (« · … ккал» omitted without kcal;
« · content» omitted when empty), each line a block span with `white-space: nowrap; overflow: hidden;
text-overflow: ellipsis` (calendar-local CSS in DayCard, no kit change; NBSP in «520 ккал»), then the macro line (no
goals here). The full lines go to the row's description (`describeSub`) and the full content stays one tap away in
«Їжа». Legacy day: the text as today. Label «Їжа: 1 740 ккал, 3 прийоми» (+ «, більше цілі»; no kcal → «Їжа:
калорії не вказані, 2 прийоми»). The row opens «Їжа» for that date; an empty day («Додати») opens the new-meal editor
`'meal'` for that date (`flushSync`).

### 7.9 Progress «Харчування» (progress)

```
 Харчування                          ціль 1 700 ккал
 Сер. цього тижня  1 795 ккал · Сер. цього місяця 1 692 ккал     (unchanged StatStrip)
 Б · Ж · В — середнє за день · цього тижня                       13/600 --ink2 caption
 Білки · ціль 90 г   Жири · ціль 60 г   Вуглеводи                StatStrip columns 3 (labels wrap)
 72 г                48 г               160 г                    over a goal → tone acc
 [bar chart] [legend] [Історія калорій …]                         (unchanged)
```

Period = the selected one (week / 30 days / 90 days / all, as the bar chart). Averages over complete days only (D22).
The unit is always «г» (a «/ 300 г» unit overflows a 74px column at 320px); a goal goes into the label. No macros in
the period → «За цей період білків, жирів і вуглеводів ще не записано» instead of the strip. Strip aria-label
«Білки, жири, вуглеводи — середнє за день».

### 7.10 Settings → «Прийоми їжі» (`/settings/meals`, settings)

```
 Phone list: group 1 = Нагадування · Цілі · Типи тренувань · [food] Прийоми їжі   4 типи ›   (icon food, acc2)
 ┌ ‹ Налаштування ────────────────────────────┐
 │ Прийоми їжі                         (h1)   │
 │ ┌────────────────────────────────────────┐ │  Card section «Мої прийоми їжі»
 │ │ Типи, які можна вибрати    [ Змінити ] │ │  intro 14 --ink2 + ghost toggle (aria-pressed)
 │ │ Сніданок                               │ │  VIEW mode: the ordered names, rows ≥ 44px, no controls
 │ │ Обід                                   │ │
 │ │ Вечеря                                 │ │
 │ │ Перекус                                │ │
 │ │ [ Новий тип прийому їжі      ] [Додати]│ │  ≤ 30 chars, ≤ 12 types (both modes)
 │ │ Повернути стандартні                   │ │  ghost; only when a default is missing; re-adds them at the end
 │ └────────────────────────────────────────┘ │
 │ Тип нового прийому підказується за часом:  │  note 13 --ink2, generated from suggestMealType (§2.8);
 │ 08:00 — Сніданок · 13:00 — Обід ·          │  each «time — type» pair is held together with NBSPs
 │ 16:30 — Перекус · 19:00 — Вечеря. Його     │  (`${time}␣—␣${type}`, pairs joined by `PART_SEPARATOR`
 │ завжди можна змінити. Перейменування не    │  = NBSP + «· »), so a line wraps only after «·» or inside
 │ змінює вже записані прийоми.               │  a type name; `overflow-wrap: anywhere` for long names
 └─────────────────────────────────────────────┘

 EDIT mode («Готово» pressed):
 │ │ [ Сніданок        ] [↑] [↓] [✕]        │ │  input aria «Назва: Сніданок» (rename on blur / Enter,
 │ │ [ Обід            ] [↑] [↓] [✕]        │ │  Escape reverts with stopPropagation); ↑/↓ «Вище: Обід» /
 │ │ …                                      │ │  «Нижче: Обід» (aria-disabled at the ends); ✕ «Видалити «Обід»»
```

View mode is calm (her list, like «Типи тренувань»); «Змінити» / «Готово» (ghost, `aria-pressed`, as in
FrequentDishes) switches every row to edit mode, so ✕ is a deliberate action (no confirm: past meals keep the label).
Errors (role=alert): «Такий тип уже є», «Не більше 12 типів», «Назва — до 30 символів». Moving / renaming / deleting
announces «Обід — вище», «Обід → Ланч», «Обід видалено» via a polite status. Note: probe times whose result equals the
previous one are dropped; an empty list shows «Без типів новий прийом буде без назви.» instead of the time sentence.
Empty list allowed: then new meals are untyped («Прийом їжі»). Desktop: the pane of the split view.

### 7.11 Settings → «Цілі» (settings)

```
 ┌ Мої цілі ─────────────────────────────────┐   (unchanged steppers)
 │ Цільова вага          [−] 60,0 кг [+]     │
 │ Калорії на день       [−] 1 700 ккал [+]  │
 └───────────────────────────────────────────┘
 ┌ Б · Ж · В на день ────────────────────────┐   Card section aria «Цілі: білки, жири, вуглеводи», title 16/700
 │ Білки                  [   90 ] г         │   input inputmode numeric, 16px, width ~96, placeholder «—»
 │ Жири                   [   60 ] г         │   aria-label «Ціль: білки, г на день»
 │ Вуглеводи              [      ] г         │
 │ Порожнє поле — без цілі.                  │   13 --ink2
 └───────────────────────────────────────────┘
```

Saved on blur and on Enter (`updateSettings`, whole grams 1–1 000; empty → null); invalid → «Від 1 до 1 000 г»
(role=alert) and nothing saved. The list summary «60 кг · 1 700 ккал» stays.

### 7.12 Accessibility & look (all packages)

Tokens only, light + dark, `prefers-reduced-motion` honoured, inputs ≥ 16px, targets ≥ 44px, real buttons, visible
focus, no control inside another control, dialog names from §1 D20, live announcements for estimate / recalc /
reorder, no colour-only meaning (over-goal parts also say «більше цілі» in labels), accessible names contain the
visible label (WCAG 2.5.3: «Порахувати решту: …», «Додати ще: …», no aria-label on «Усі прийоми за день →»), no
«БЖУ» in copy (always «Б · Ж · В» or the words).

---

## 8. Work packages

```
                ┌──────┐
                │ core │  shared · server · store · lib/stats · lib/nutrition · e2e/support · fixtures · seed
                └──┬───┘
   ┌────────┬──────┼─────────┬──────────┐
  food     home  calendar  progress  settings          (parallel)
   │
 capture                                               (after food: hosts its MealSheet / editor)
   └────────┴──────┴─────────┴──────────┘
                   │
             ┌─────▼──────┐
             │ e2e-visual │  a11y · visual · cross-cutting specs · SPEC.md · DEPLOY.md · full gate
             └────────────┘
```

| Package | Owned paths |
| --- | --- |
| core | `packages/shared/**`, `apps/server/**`, `apps/web/src/store/**`, `apps/web/src/lib/stats.ts`, `apps/web/src/lib/stats.test.ts`, `apps/web/src/lib/stats/**`, `apps/web/src/lib/nutrition.ts`, `apps/web/src/lib/nutrition.test.ts`, `e2e/support/**`, `e2e/fixtures/**`, `e2e/compat.spec.ts` |
| food | `apps/web/src/features/food/**`, `e2e/food.spec.ts` |
| capture | `apps/web/src/sheets/**`, `e2e/capture.spec.ts`, `e2e/day-record.spec.ts`, `e2e/deep-links.spec.ts`, `e2e/weight-measure.spec.ts`, `e2e/meals.spec.ts` |
| home | `apps/web/src/screens/home/**`, `e2e/home.spec.ts` |
| calendar | `apps/web/src/screens/calendar/**`, `e2e/calendar.spec.ts` |
| progress | `apps/web/src/screens/progress/**`, `e2e/progress.spec.ts` |
| settings | `apps/web/src/screens/settings/**`, `e2e/settings.spec.ts`, `e2e/backup.spec.ts` |
| e2e-visual | `e2e/a11y.spec.ts`, `e2e/visual.spec.ts`, `e2e/gestures.spec.ts`, `e2e/auth.spec.ts`, `e2e/sync.spec.ts`, `e2e/offline.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/shell.spec.ts`, `e2e/README.md`, `e2e/__screenshots__/**`, `docs/SPEC.md`, `docs/DEPLOY.md`, `docs/redesign-a.md`; plus test-only fixes during the final gate in any `e2e/*.spec.ts` **and** in `e2e/support/**` / `e2e/fixtures/**` (selectors, waits, fixtures — never app code, never weakening a test's intent; each logged as file:line + owning package + reason) |

Nobody edits `apps/web/src/ui/**`, `apps/web/src/shell/**`, `apps/web/src/features/goal/**`, `apps/web/src/App.tsx`,
`apps/web/src/lib/api.ts` (no change needed; `@/features/goal` `kcalGoalView` is imported read-only by food,
capture and home). Only e2e-visual runs Playwright (port 3399, one run at a time).

### 8.1 Contract food → capture (exported from `@/features/food`)

```ts
export const MEAL_SHEET_HEADING = 'Прийом їжі';
export interface MealTarget {
  date: ISODate;
  /** An existing meal id (LEGACY_MEAL_ID for the legacy block), or null for a new meal. */
  mealId: string | null;
  /**
   * New on every open (SheetState.key or a local counter): the draft starts afresh. A change of `date` alone (same
   * key, new meal) RETARGETS the draft (text, photos, positions, manual numbers kept; type / time re-suggested only
   * when untouched) — the 'meal' date nav uses `ui.moveSheet`, which keeps the key.
   */
  key: number;
}
export interface MealEditor {
  readonly target: MealTarget | null;
  readonly isNew: boolean;
  /** Something would be lost on close: draft changed, estimate loading, item editor changes. */
  readonly dirty: boolean;
  /** «Зберегти» can act (content, valid, no recalculation running). */
  readonly canSave: boolean;
  /** Why «Зберегти» is disabled (for aria-describedby / a hint line), else undefined. */
  readonly saveHint?: string;
  /** The store refused the last save (cleared on the next edit). */
  readonly saveError?: string;
  /** Commits meal.put (+ food.use); false keeps the draft. */
  save(): boolean;
  /** Existing meals: confirm → meal.delete; true when deleted. */
  remove(): Promise<boolean>;
  /* + opaque state the body reads */
}
/** Call unconditionally; `null` = idle (no state, never dirty). */
export function useMealEditor(target: MealTarget | null): MealEditor;
export interface MealEditorBodyProps {
  editor: MealEditor;
  /** Mode 'meal' (menu / Home / calendar hosted) on a day with other meals: «Усі прийоми за день →» (host swaps to 'food', guarded). */
  onShowDay?: () => void;
  /** After «Видалити прийом» went through (the host closes). */
  onDeleted?: () => void;
  /** Stacked over «Їжа» / «Запис дня» (no date nav above): shows «13 жовтня · вівторок» when date ≠ today. */
  stacked?: boolean;
}
export function MealEditorBody(props: MealEditorBodyProps): JSX.Element;
export interface MealSheetProps {
  /** null = closed (keeps itself mounted during the exit animation). */
  target: MealTarget | null;
  onClose: () => void;
}
/** Stacked editor: Sheet «Прийом їжі», footer «Зберегти» (+ hint/error), own discard guard, toasts. */
export function MealSheet(props: MealSheetProps): JSX.Element;
// still exported: PhotoStrip, PhotoViewer (calendar uses PhotoStrip)
```

RecordSheet `'meal'` mode: `const meal = useMealEditor(mode === 'meal' ? { date, mealId: null, key } : null)`; body
`<MealEditorBody editor={meal} onShowDay={…} />`; footer `SaveFooter` («Зберегти», `disabled={!meal.canSave}`,
`error={meal.saveError}`, hint `meal.saveHint`); guard `useSheetGuard(dirty || meal.dirty, open)`; ‹ › →
`ui.moveSheet(newDate)` (no guard: the draft moves); save → `meal.save()` → `ui.closeSheet()` +
`ui.flash('Збережено')`. RecordSheet `'food'` / `'day'`: local `mealTarget` state; rows / «+ Прийом їжі» set it
inside `flushSync` (keyboard for a new meal); `<MealSheet target={mealTarget} onClose={() => setMealTarget(null)} />`
rendered inside the RecordSheet body (MealSheet passes `stacked` to its body).

### 8.2 Transient breaks (expected, by order of landing)

- After **food**: `apps/web/src/sheets/record/blocks.tsx` and `sheets/record/model.ts` fail typecheck (old
  `FoodAssist` props / `FoodAdd`) until capture lands. `insertEstimate`, `unestimatedTail`, `formatFoodLine`, `FoodAdd`
  stay exported to keep the break small.
- After **core**: test files elsewhere that build `Settings` literals without `mealTypes`/`macroGoals` fail typecheck —
  each owner fixes theirs (spread `defaultSettings()`); `features/food` fails on the now-required `FoodEstimateItem`
  macros until food lands; specs that use renamed helpers may fail until their owners land.
- Parallel packages filter **both** the web `tsc` and the e2e `tsc` output to their own paths (plus `e2e/support`,
  `e2e/fixtures`) and report the rest; only e2e-visual requires fully clean runs.

---

## 9. Test matrix

| Behaviour | Unit | e2e (owner) |
| --- | --- | --- |
| normalizeMeal / normalizeDay / derive (incl. «Прийом їжі» for content-less untyped meals, `meals: []` = legacy) / idempotence / ordering / limits / completeness | shared `meals.test.ts`, `shared.test.ts` | — |
| meal.put / meal.delete / partial day.meta / day.delete on meal days / Rule L (a–h, known limits e–f) / day.put strips `meals` / settings merge / food.use macros in `useFood` | shared + server `ops.test.ts` (parity) | `compat.spec.ts` (core, API-level) |
| migration v3, pre-migration snapshot, `downgrade-schema`, corrupt meals JSON, GC keeps meal photos / skips on corrupt rows | server `db.test.ts`, `cli.test.ts`, `store.test.ts` | — |
| AI macros (prompt, schema, sanitise, recalc) | server `claude.test.ts`, `estimator.test.ts`, `food.test.ts` | `food.spec.ts` (food, mocked) |
| old backup / old cache / old outbox | server `export-import.test.ts`, web `store/*.test.ts` | `backup.spec.ts` (settings), `compat.spec.ts` |
| store actions (saveMeal false at the cap), dayMarks → partial day.meta, `ui.moveSheet` | `store/data.test.ts`, `dayMarks.test.ts`, `ui.test.ts` | `home.spec.ts` ✓/✕ keeps meals |
| nutrition helpers (NBSP, partial), macroAverages (complete days only) | `lib/nutrition.test.ts`, `lib/stats.test.ts` | — |
| type preselection (§2.8 table) | shared `meals.test.ts` | `meals.spec.ts` (capture: 10:00 → Сніданок) |
| meal editor draft, positions, undo of an estimate, pending tail, manual → «Інше», macro rescale on typed kcal, caps 20 / 30 / 12, retarget on ‹ ›, validation | food `meal/*.test.ts`, `drafts.test.ts`, `estimate.test.ts`, `itemEditorModel.test.ts` | `food.spec.ts`, `meals.spec.ts` |
| list sheet, day sheet, menu, legacy conversion, stack depth 2, focus inside the tap (`flushSync`) | capture model/component tests | `meals.spec.ts`, `capture.spec.ts`, `day-record.spec.ts` |
| Home sub (tone, NBSP), empty → editor, fit (combined worst case) | home model/component tests | `home.spec.ts` |
| Calendar lines (one line each), empty → editor | calendar model tests | `calendar.spec.ts` (no wrapped line at 390 / 320) |
| Progress macro strip | progress model tests | `progress.spec.ts` |
| Settings meal types (view / edit mode), generated note, macro goals | settings model/component tests | `settings.spec.ts` |
| a11y (targets, inputs, names incl. WCAG 2.5.3, nesting), visuals light/dark iPhone/desktop, gestures | — | `a11y.spec.ts`, `visual.spec.ts`, `gestures.spec.ts` (e2e-visual) |

---

## 10. SPEC.md update (applied by e2e-visual)

- **§1.1 additions** (after the AI paragraph): «**Meals and macros** — a day's food is a list of meals (her own meal
  types, default Сніданок / Обід / Вечеря / Перекус, managed in Settings → «Прийоми їжі»), each with text, photos, kcal
  and protein / fat / carbs (grams); the day's kcal is their sum; optional daily goals for Білки / Жири / Вуглеводи
  (Settings → «Цілі»). Plan: `docs/meals-macros.md`.»
- **§3.1**: AppData adds `foods`, `days[].meals?` (when present the day's `food`/`kcal`/`photos` are derived by
  `normalizeDay`; an empty array = legacy day), `settings.mealTypes`, `settings.macroGoals`. Ops: `day.put | day.delete |
  day.meta | meal.put | meal.delete | weight.* | measure.* | settings.put | food.use | food.delete`; the semantics table
  of `docs/meals-macros.md` §2.6 (incl. Rule L and its known limits, `day.delete` keeping meals, partial `day.meta`,
  `day.put` never carrying meals, «absent settings fields are kept»). The client never sends `day.put` / `day.delete`
  any more; the server accepts them forever.
- **§3.4**: SQLite schema v3 (`days.meals`, `foods.protein/fat/carbs`); automatic pre-migration snapshot
  `backups/legko-pre-v3-<date>.db`; rollback = `downgrade-schema` CLI then `deploy.sh rollback` (DEPLOY.md).
- **§3.5**: `SheetMode` adds `'meal'` («Прийом їжі», a new meal; the «+» menu's Їжа row and empty-day Home / calendar
  rows); `'food'` = the day's meal list «Їжа»; stacked «Прийом їжі» / «Позиція» sheets; `dataActions.saveMeal /
  deleteMeal / setDayMeta`; `ui.moveSheet`; `/settings/meals`.
- **§3.6**: macro averages per day for the selected period (per macronutrient, over days where it is known and
  complete); day macros = sum of meal macros.
- **§3.7**: the model returns protein / fat / carbs per item (0.5 g), recalculation too; on-device rescale includes the
  macros (and typed kcal rescales unpinned macros); the estimate result becomes the meal's positions (no «Додати N
  ккал»; «Прибрати ці позиції» undoes the last estimate); photos belong to meals (12 per day); «Часті страви» remember
  macros; GC also scans meal photos (guarded against corrupt JSON).

---

## 11. Risks

1. **Rule L heuristics** can create an extra untyped meal with partly duplicated text when an outdated client edits
   the derived text of a meal day (only during the reload window or from an old offline outbox), can **bring back** a
   meal deleted on a new device (known limit e), and can lose the old client's own kcal increase when meals were added
   elsewhere (known limit f). Nothing logged on a new client is deleted; tested as current behaviour; visible and
   editable as «Їжа за день».
2. **Food refactor** (estimate result → persistent positions, macros through drafts / item editor / recalc, undo of an
   estimate, pending tail, retarget on ‹ ›) touches the most intricate code (focus management, recalc ownership
   between card and editor). Mitigation: keep the reducer's recalc / editor rules, move only the «result» phase into
   the meal draft; required `FoodEstimateItem` macros make tsc flag every field-by-field rebuild; the existing unit
   tests are adapted, not dropped.
3. **Home one-screen budget**: the macro sub adds ~19px (slack ~43 → ~24px; ≈ 10px in the combined worst case);
   offline pill or a 2-line banner can push the week row under the tab bar. Guarded by one combined `home.spec` fit
   test at 390×763.
4. **Three stacked sheets on the iPhone** (list → meal → position) with the keyboard open: viewport / drag-dismiss
   edge cases; keyboard focus inside the tap depends on `flushSync` at every opener. `gestures.spec` and `meals.spec`
   cover Escape / drag closing only the top sheet; the real keyboard is only checked on the device.
5. **Specs written without running Playwright** in parallel packages; e2e-visual runs once and may fix test-only stale
   assertions, helpers and fixtures (logged).
6. **Transient typecheck breaks** between packages (§8.2).
7. **Model macro accuracy** varies; values are estimates, rounded to 0.5 g; alcohol breaks the kcal ↔ macro identity
   (expected). Partial days (D22) show the known sum with a note and are left out of averages.
8. **DB rollback** is a manual procedure (stop → `downgrade-schema` → `deploy.sh rollback`); meal structure and macros
   are lost on the way down, and new clients' unsent meal ops are dropped by the old server.
9. **Derived text truncation** at 5 000 chars on extreme days (informational field only).
10. **Photos beyond 12** cannot be added through the UI; an imported backup with more keeps them in meals (GC-safe) but
    the derived day list shows the first 12 (and a schema downgrade would make the rest collectable).
11. **Corrupt `days.meals`** pauses photo GC until the row is rewritten (warning logged every run).

---

## 12. Owner questions (для владельца)

1. «+» → «Їжа» сразу открывает новый приём пищи (тип подставлен по времени, курсор в «Що я їла», кнопки «✨ Порахувати»
   и «📷 Фото» над полем — клавиатура их не закрывает). С главной/из календаря в пустой день — тоже сразу новый приём;
   в день с едой — список дня. Так удобно, или из «+» лучше сначала список дня?
2. Тип по времени: 04–10 — сніданок, 11–15 — обід, 16:xx — перекус, 17–21 — вечеря, 22–23 — вечеря, если её ещё нет,
   ночью — перекус; если тип слота уже записан — перекус. Подходит такая логика?
3. Старые дни (до обновления) показываем одним блоком «Їжа за день» без типа; он становится приёмом пищи, когда она его
   откроет и выберет тип. Массово раскладывать старые дни по типам не будем — ок?
4. На главной в строке «Їжа»: «Б 68 · Ж 41 · В 132 г · 3 прийоми», а с целями — «Б 68/90 · Ж 41/60 · В 132 г» (строка
   над полоской калорий). Читается?
5. Превышение цели по белку подсвечиваем лавандовым, как калории. Для белка перебор обычно не страшен — подсвечивать
   только калории/жиры/углеводы?
6. После «✨ Порахувати» позиции сразу становятся частью приёма (без кнопки «Додати N ккал»); если подсчёт ошибся —
   «Прибрати ці позиції» убирает весь последний подсчёт. Ок?
7. Время приёма: для сегодня подставляем текущее, для прошлых дней пусто (компактная строка внизу, можно указать).
   Нужно ли время вообще?
8. В однострочную сводку на «Прогрес» Б · Ж · В не добавляем (она и так длинная) — отдельной полосой в «Харчування».
   Ок?
9. Цели Б · Ж · В она вводит сама (пустое поле — без цели). Нужна ли подсказка/автоподсчёт из калорий (например
   30/30/40)?
10. Удаление типа приёма в настройках — в режиме «Змінити», без подтверждения (уже записанные приёмы сохраняют
    название). Ок?
11. Если у части приёмов дня нет Б · Ж · В (старый блок, калории вписаны вручную), показываем сумму известного с
    пометкой «пораховано не для всіх прийомів», а в средних на «Прогрес» такие дни не учитываем. Ок?

---

## 13. Critique log (finalizer)

Three reviews were checked against the code (`apps/server/src/index.ts` + `db/open.ts` + `backup.ts`, `photos/store.ts`
with a local SQLite 3.53 run, `sheets/record/model.ts`, `features/food/model.ts` + `drafts.ts`, `db/data.ts`,
`ui/sheet/*`, `ui/lists/*`, `screens/home/TodayCard.tsx`, `store/ui.ts`, `store/sync.ts`, `http/bodyLimit.ts`).

**Applied** (merged duplicates): iOS keyboard → AI row above the text, one-row chips, height budget (§7.3, D8);
clutter → folded «+ Б · Ж · В», compact time row at the bottom; empty day → Home / calendar open the editor (D8, §7.7,
§7.8); calendar lines one line each with ellipsis + NBSP (§7.8, modified, see below); undo of an estimate «Прибрати ці
позиції»; live day budget line in the editor; `suggestMealType` degradation + generated Settings note (§2.8, §7.10);
chip re-tap keeps the type (D6); Settings view / edit mode (§7.10); Home sub tone + kit order + NBSP + combined fit
test (§7.7); WCAG 2.5.3 names; Progress unit «г» with the goal in the label; no «БЖУ» copy; `flushSync` at every
opener; pending tail «Порахувати решту» (modified); date line in a stacked editor; ‹ › retargets the new-meal draft
(`ui.moveSheet`); 12-type limit message; rollback (pre-migration snapshot + tested `downgrade-schema`, D21, §3, §4);
partial macros (D22); old `day.delete` on meal days keeps meals; Rule L known limits documented + cap merge (§2.6);
required `FoodEstimateItem` macros; typed kcal rescales unpinned macros, dish without macros → null (§5, §7.4);
`day.put` never carries meals, `meals: []` = legacy (§2.3, §2.5); GC `json_valid` guard + skip (§4); content-less
untyped meal derives «Прийом їжі» (§2.5); partial `day.meta` (D3); field-variant region «Прийоми їжі» (§7.5);
e2e-visual may fix `e2e/support` / `e2e/fixtures` (§8); filtered checks (§8.2); 20-meal cap with `saveMeal` false
(D23); 30-position cap; `mealUses` omits null macro keys (D13); D13 inside `useFood()`; hidden «з» markup (§7.2);
`docs/redesign-a.md` owned by e2e-visual.

### Rejected critique

- **Rule L per-day hash list of recent derived triples** (optional mitigation) — adds hidden server state and breaks
  client/server parity for a case limited to the reload window; documented as known limits (e)/(f) instead.
- **Calendar: content only in the description, title · kcal only** — losing what she ate from the calendar costs a tap
  on every past-day review; one line per meal with ellipsis keeps the content and never wraps.
- **Tail button reading «✨ Порахувати „яблуко“»** — a long tail would overflow the button; «✨ Порахувати решту» with
  the tail in the accessible name and in the muted line above keeps the 1-tap behaviour.
- **Suppress «досягнуто» / over-goal for incomplete macros** — a partial sum is a lower bound, so «over» is still
  true; marking it as partial (note + label) is enough.
- **Rollback via export → restore pre-v3 snapshot → rollback → import** — the tested `downgrade-schema` step is
  shorter and keeps everything the old schema can hold; the pre-v3 snapshot stays as the fallback.
- **`.min(1)` on `meals` in the AppData schema** — would reject a whole import over one hand-edited day; an empty array
  is treated as a legacy day instead.
- **Option B (no autofocus when AI is available)** — costs a tap on the most common text flow; option A keeps both.
