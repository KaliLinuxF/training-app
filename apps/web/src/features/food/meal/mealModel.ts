/**
 * The meal editor «Прийом їжі» as a pure model (docs/meals-macros.md §7.3): one meal's draft — type,
 * time, what she ate, photos, manual kcal / Б · Ж · В or the positions (see `estimate.ts`) —, its
 * validation, the meal it saves and the «Часті страви» uses it records. No React, no I/O.
 */
import {
  emptyMacros,
  f0,
  LEGACY_MEAL_ID,
  LIMITS,
  MACRO_KEYS,
  mealsOf,
  mealTypeKey,
  sumMacros,
  suggestMealType,
  type AppData,
  type FoodEstimateItem,
  type FoodUse,
  type HM,
  type ISODate,
  type MacroGrams,
  type MacroKey,
  type Meal,
} from '@legko/shared';
import { kcalGoalView } from '@/features/goal';
import { mealTypeChoices } from '@/lib/nutrition';
import { newMealId } from '@/store/data';
import {
  draftMacros,
  draftsToItems,
  draftsTotals,
  fromMealItems,
  isNamed,
  sameDraft,
  type DraftItem,
} from '../drafts';
import {
  estimateReducer,
  initialPositions,
  type EstimateAction,
  type ManualNumbers,
  type PositionsState,
} from '../estimate';
import { editorChanged } from '../itemEditorModel';
import {
  COMPOSER_CLOSED,
  composerEdited,
  macroInputText,
  openComposer,
  parseKcal,
  parseMacroInput,
  sanitizeKcalInput,
  sanitizeMacroInput,
  type ComposerState,
} from '../model';

/** What the host opens the editor on. */
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

export type MacroTexts = Record<MacroKey, string>;

/** What the editor loaded (the draft is dirty when it differs from this). */
interface MealSnapshot {
  type: string;
  time: HM | null;
  text: string;
  photos: readonly string[];
  kcalText: string;
  macroTexts: MacroTexts;
  drafts: readonly DraftItem[];
}

export interface MealDraft {
  id: string;
  isNew: boolean;
  /** An untyped block from before meals («Їжа за день»): the hint asks her to pick a type. */
  legacy: boolean;
  /** '' = untyped. */
  type: string;
  /** She picked the type herself (a date change no longer re-suggests it). */
  typeTouched: boolean;
  /**
   * Every label she selected in this session, in order. One that is not in her list (a name «+ Свій» gave for
   * this meal only at 12 types) stays a chip while the editor is open, so a tap on another chip never takes it
   * away (see `mealChips`).
   */
  pickedTypes: string[];
  time: HM | null;
  timeTouched: boolean;
  /** «Що я їла». */
  text: string;
  /** The meal text the last text estimate counted: what follows it is «Ще не пораховано». */
  estimatedText: string;
  photos: string[];
  /** Manual kcal (a meal without positions). */
  kcalText: string;
  /** Manual Б · Ж · В (a meal without positions). */
  macroTexts: MacroTexts;
  /** The three macro inputs are shown (she opened them, or the meal has a typed macro). */
  macrosOpen: boolean;
  positions: PositionsState;
  /** «✨ Додати ще» → «Що ще порахувати?». */
  composer: ComposerState;
  initial: MealSnapshot;
}

// ---------------------------------------------------------------------------------------------
// Copy

/** «20000» → «20 000» (validation copy groups thousands with a plain space). */
const grouped = (n: number): string => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ');

export const MEAL_HINTS = {
  content: 'Опиши, що їла, або додай калорії чи фото',
  kcal: `Калорії — не більше ${grouped(LIMITS.kcal.max)} ккал`,
  macro: `Не більше ${grouped(LIMITS.mealMacro.max)} г`,
  mealsCap: `Не більше ${LIMITS.mealsPerDay} прийомів на день`,
  photoCap: `Не більше ${LIMITS.photosPerDay} фото на день`,
  busy: 'Рахую калорії…',
  saveError: 'Не вдалося зберегти — перевір дані й спробуй ще раз',
} as const;

export const TYPES_CAP_NOTE = `У списку вже ${LIMITS.mealTypes} типів — ця назва лише для цього прийому`;
export const LEGACY_HINT = 'Це запис зі старої версії. Обери тип — і він стане окремим прийомом їжі.';
/** The position her manual numbers become when the first position is added. */
export const OTHER_POSITION = 'Інше';

/** Device-local wall-clock time «HH:MM». */
export function nowHM(now: Date = new Date()): HM {
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}

const emptyMacroTexts = (): MacroTexts => ({ protein: '', fat: '', carbs: '' });

const macroTextsOf = (m: MacroGrams): MacroTexts => ({
  protein: macroInputText(m.protein),
  fat: macroInputText(m.fat),
  carbs: macroInputText(m.carbs),
});

// ---------------------------------------------------------------------------------------------
// Opening

interface DraftSeed {
  id: string;
  isNew: boolean;
  legacy: boolean;
  type: string;
  time: HM | null;
  text: string;
  estimatedText: string;
  photos: string[];
  kcalText: string;
  macroTexts: MacroTexts;
  drafts: DraftItem[];
}

function draftOf(seed: DraftSeed): MealDraft {
  const { drafts, ...rest } = seed;
  return {
    ...rest,
    typeTouched: false,
    pickedTypes: [],
    timeTouched: false,
    macrosOpen: MACRO_KEYS.some((k) => seed.macroTexts[k] !== ''),
    positions: initialPositions(drafts),
    composer: COMPOSER_CLOSED,
    initial: {
      type: seed.type,
      time: seed.time,
      text: seed.text,
      photos: seed.photos,
      kcalText: seed.kcalText,
      macroTexts: seed.macroTexts,
      drafts,
    },
  };
}

/** A legacy day's block or an old client's extra meal, still without a type («Їжа за день»). */
const isLegacyBlock = (meal: Meal): boolean =>
  meal.type.trim() === '' && (meal.id === LEGACY_MEAL_ID || meal.id.startsWith('old-'));

/**
 * The draft for `target`:
 * - a new meal (`mealId` null, or an id the day no longer has): type suggested by the time of day
 *   (today) or by what is logged already (another day); time = now for today, else none;
 * - an existing meal (the legacy block too): its values, positions from its items.
 */
export function initMealDraft(
  data: AppData,
  target: MealTarget,
  now: HM,
  today: ISODate,
  newId: () => string = newMealId,
): MealDraft {
  const meals = mealsOf(data.days[target.date]);
  const meal = target.mealId === null ? undefined : meals.find((m) => m.id === target.mealId);
  if (!meal) {
    const time = target.date === today ? now : null;
    return draftOf({
      id: newId(),
      isNew: true,
      legacy: false,
      type: suggestMealType({ types: data.settings.mealTypes, logged: meals.map((m) => m.type), time }),
      time,
      text: '',
      estimatedText: '',
      photos: [],
      kcalText: '',
      macroTexts: emptyMacroTexts(),
      drafts: [],
    });
  }
  const items = meal.items ?? [];
  const withItems = items.length > 0;
  return draftOf({
    id: meal.id,
    isNew: false,
    legacy: isLegacyBlock(meal),
    type: meal.type,
    time: meal.time,
    text: meal.text,
    // Positions describe the text she had: only what she adds after it is «not counted yet».
    estimatedText: withItems ? meal.text : '',
    photos: [...(meal.photos ?? [])],
    kcalText: withItems || meal.kcal === null ? '' : String(meal.kcal),
    macroTexts: withItems ? emptyMacroTexts() : macroTextsOf(meal),
    drafts: fromMealItems(items),
  });
}

/**
 * The new-meal draft moved to `date` (‹ › in the editor): text, photos, positions and manual
 * numbers stay; type and time are suggested again for that day unless she set them herself.
 */
export function retargetMealDraft(
  draft: MealDraft,
  data: AppData,
  date: ISODate,
  now: HM,
  today: ISODate,
): MealDraft {
  if (!draft.isNew) return draft;
  const logged = mealsOf(data.days[date])
    .filter((m) => m.id !== draft.id)
    .map((m) => m.type);
  const time = date === today ? now : null;
  return {
    ...draft,
    type: draft.typeTouched ? draft.type : suggestMealType({ types: data.settings.mealTypes, logged, time }),
    time: draft.timeTouched ? draft.time : time,
  };
}

// ---------------------------------------------------------------------------------------------
// What she has written

const namedPositions = (d: MealDraft): DraftItem[] => d.positions.drafts.filter(isNamed);

/** The meal has positions (their sums are its numbers; the manual fields are hidden). */
export const hasPositions = (d: MealDraft): boolean => d.positions.drafts.length > 0;

/** Content rule: text, a photo, kcal, a macro or a named position. */
export function hasMealContent(d: MealDraft): boolean {
  return (
    d.text.trim() !== '' ||
    d.photos.length > 0 ||
    namedPositions(d).length > 0 ||
    (!hasPositions(d) && (d.kcalText !== '' || MACRO_KEYS.some((k) => d.macroTexts[k].trim() !== '')))
  );
}

/** The meal's kcal as it would save: positions' sum, else the typed number, else null. */
export function mealKcal(d: MealDraft): number | null {
  if (namedPositions(d).length) return draftsTotals(d.positions.drafts).kcal;
  if (hasPositions(d) || d.kcalText === '') return null;
  return parseInt(sanitizeKcalInput(d.kcalText), 10);
}

/** The meal's Б · Ж · В as they would save (before the 3 000 g limit). */
export function mealMacros(d: MealDraft): MacroGrams {
  if (namedPositions(d).length) return draftsTotals(d.positions.drafts).macros;
  if (hasPositions(d)) return emptyMacros();
  return {
    protein: parseMacroInput(d.macroTexts.protein, Number.POSITIVE_INFINITY),
    fat: parseMacroInput(d.macroTexts.fat, Number.POSITIVE_INFINITY),
    carbs: parseMacroInput(d.macroTexts.carbs, Number.POSITIVE_INFINITY),
  };
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const sameDrafts = (a: readonly DraftItem[], b: readonly DraftItem[]): boolean =>
  a.length === b.length &&
  a.every((d, i) => {
    const other = b[i];
    return other !== undefined && sameDraft(d, other);
  });

/**
 * Something would be lost on close: the draft differs from what was loaded (a new meal: once it has
 * content — a suggested type and time alone are not worth asking about), an estimate is loading,
 * the item editor holds changes, or the composer holds text she typed.
 */
export function mealDraftDirty(d: MealDraft): boolean {
  const p = d.positions;
  if (p.loading) return true;
  if (p.editor && editorChanged(p.editor)) return true;
  if (d.composer.open && composerEdited(d.composer)) return true;
  if (d.isNew) return hasMealContent(d);
  const i = d.initial;
  return (
    d.type !== i.type ||
    d.time !== i.time ||
    d.text !== i.text ||
    !sameList(d.photos, i.photos) ||
    d.kcalText !== i.kcalText ||
    MACRO_KEYS.some((k) => d.macroTexts[k] !== i.macroTexts[k]) ||
    !sameDrafts(p.drafts, i.drafts)
  );
}

/** The other meals of the day (this one left out by id). */
const otherMeals = (data: AppData, date: ISODate, d: MealDraft): Meal[] =>
  mealsOf(data.days[date]).filter((m) => m.id !== d.id);

/** How many other meals the day has (this one left out). */
export const otherMealCount = (data: AppData, date: ISODate, d: MealDraft): number =>
  otherMeals(data, date, d).length;

/** Photos this meal may hold: the day's 12 minus the other meals' photos. */
export function photoCapacity(data: AppData, date: ISODate, d: MealDraft): number {
  const others = new Set(otherMeals(data, date, d).flatMap((m) => m.photos ?? []));
  for (const id of d.photos) others.delete(id);
  return Math.max(0, LIMITS.photosPerDay - others.size);
}

export interface MealValidation {
  /** Why «Зберегти» cannot act (the first reason), else undefined. */
  hint?: string;
  /** Under «Калорії» (typed kcal above the limit). */
  kcal?: string;
  /** Under the macro inputs (a macronutrient above the limit). */
  macro?: string;
}

/** Validation copy: content, the limits of kcal / grams / meals per day / photos per day, a running request. */
export function validateMeal(data: AppData, date: ISODate, d: MealDraft): MealValidation {
  const kcal = mealKcal(d);
  const macros = mealMacros(d);
  const kcalError = kcal !== null && kcal > LIMITS.kcal.max ? MEAL_HINTS.kcal : undefined;
  const macroError = MACRO_KEYS.some((k) => (macros[k] ?? 0) > LIMITS.mealMacro.max)
    ? MEAL_HINTS.macro
    : undefined;
  const busy = d.positions.loading !== null || d.positions.recalc.pending !== null;
  let hint: string | undefined;
  if (!hasMealContent(d)) hint = MEAL_HINTS.content;
  else if (kcalError) hint = kcalError;
  else if (macroError) hint = macroError;
  else if (d.isNew && mealsOf(data.days[date]).length >= LIMITS.mealsPerDay) hint = MEAL_HINTS.mealsCap;
  else if (d.photos.length > photoCapacity(data, date, d)) hint = MEAL_HINTS.photoCap;
  else if (busy) hint = MEAL_HINTS.busy;
  return {
    ...(hint !== undefined ? { hint } : {}),
    ...(kcalError && !hasPositions(d) ? { kcal: kcalError } : {}),
    ...(macroError && !hasPositions(d) ? { macro: macroError } : {}),
  };
}

/** Trimmed, single spaces, within the type length. */
const cleanType = (s: string): string => s.trim().replace(/\s+/g, ' ').slice(0, LIMITS.mealTypeName).trim();

/** The meal `meal.put` saves: positions with their sums, else her manual numbers (normalizeMeal-compatible). */
export function buildMeal(d: MealDraft): Meal {
  const items = draftsToItems(d.positions.drafts);
  const base = {
    id: d.id,
    type: cleanType(d.type),
    time: d.time,
    text: d.text.trim().slice(0, LIMITS.text),
    ...(d.photos.length ? { photos: [...d.photos] } : {}),
  };
  if (items.length) {
    const kcal = Math.min(
      LIMITS.kcal.max,
      items.reduce((sum, i) => sum + i.kcal, 0),
    );
    return { ...base, kcal, ...sumMacros(items, LIMITS.mealMacro.max), items };
  }
  const kcal = d.kcalText === '' ? null : Math.min(LIMITS.kcal.max, parseKcal(d.kcalText));
  return {
    ...base,
    kcal,
    protein: parseMacroInput(d.macroTexts.protein, LIMITS.mealMacro.max),
    fat: parseMacroInput(d.macroTexts.fat, LIMITS.mealMacro.max),
    carbs: parseMacroInput(d.macroTexts.carbs, LIMITS.mealMacro.max),
  };
}

/**
 * The «Часті страви» uses the save records: the named positions added in this session (estimate,
 * dish chip, «+ позиція»), with her final names, portions and kcal and only the known macros (a
 * key is omitted when unknown, never null).
 */
export function mealUses(d: MealDraft): FoodUse[] {
  return d.positions.drafts
    .filter((row) => row.fresh === true && isNamed(row))
    .map((row) => {
      const macros = draftMacros(row);
      const use: FoodUse = {
        name: row.name.trim(),
        portion: row.portion.trim(),
        kcal: parseKcal(row.kcalText),
      };
      for (const k of MACRO_KEYS) {
        const v = macros[k];
        if (v !== null) use[k] = v;
      }
      return use;
    });
}

/**
 * Her manual numbers as a position «Інше» (pinned, «вручну»), for when the first position is added
 * to a meal she priced by hand — nothing is silently lost. Null without manual numbers. (An estimate
 * of the very text her numbers were for replaces them instead: see `repricesManual`.)
 */
export function manualToPosition(d: Pick<ManualNumbers, 'kcalText' | 'macroTexts'>): DraftItem | null {
  const typedMacro = MACRO_KEYS.some((k) => d.macroTexts[k].trim() !== '');
  if (d.kcalText === '' && !typedMacro) return null;
  return {
    id: 'manual',
    name: OTHER_POSITION,
    portion: '',
    kcalText: d.kcalText === '' ? '' : String(parseKcal(d.kcalText)),
    proteinText: d.macroTexts.protein,
    fatText: d.macroTexts.fat,
    carbsText: d.macroTexts.carbs,
    base: null,
    pinned: true,
    macrosPinned: typedMacro,
  };
}

/**
 * The type chips: her list, then the meal's own label and the labels she picked in this session when they are
 * not in it (any case). Those stay while the editor is open — the label of a type she has renamed or deleted
 * since, a name for this meal only —, so tapping another chip never takes one away and the row keeps its order.
 */
export const mealChips = (mealTypes: readonly string[], d: MealDraft): string[] =>
  [d.initial.type, ...d.pickedTypes, d.type].reduce<string[]>(
    (chips, label) => mealTypeChoices(chips, label),
    [...mealTypes],
  );

export interface AddedType {
  /** The label the meal gets (an existing spelling wins). */
  name: string;
  /** Her list with it added, or null when the list stays as it is. */
  mealTypes: string[] | null;
  /** Why it was not added to the list. */
  note?: string;
}

/**
 * «+ Свій»: a type she adds to her list (≤ 12 types, ≤ 30 chars); a name she already has (any case)
 * is that type. At 12 it is used for this meal only. Null for an empty name.
 */
export function addCustomMealType(input: string, mealTypes: readonly string[]): AddedType | null {
  const name = cleanType(input);
  if (!name) return null;
  const existing = mealTypes.find((t) => mealTypeKey(t) === mealTypeKey(name));
  if (existing !== undefined) return { name: existing, mealTypes: null };
  if (mealTypes.length >= LIMITS.mealTypes) return { name, mealTypes: null, note: TYPES_CAP_NOTE };
  return { name, mealTypes: [...mealTypes, name] };
}

/** «тост, кава»: lines of text on one line (trailing «,» / «;» dropped, joined by «, »). */
function oneLine(text: string): string {
  return text
    .split('\n')
    .map((l) =>
      l
        .trim()
        .replace(/[,;]+$/, '')
        .trim(),
    )
    .filter(Boolean)
    .join(', ');
}

/**
 * «Ще не пораховано»: with positions, what she wrote after the text the last estimate counted (when
 * the text still starts with it; leading «,» / «;» and spaces trimmed), else ''.
 */
export function pendingTail(d: MealDraft): string {
  if (namedPositions(d).length === 0) return '';
  if (!d.text.startsWith(d.estimatedText)) return '';
  return oneLine(d.text.slice(d.estimatedText.length).replace(/^[\s,;]+/, ''));
}

export interface DayBudget {
  /** «За день: 1 240 / 1 700 ккал». */
  text: string;
  over: boolean;
}

/** The day's kcal with this draft (its stored kcal left out) against her goal; null while the total is 0. */
export function dayBudget(data: AppData, date: ISODate, d: MealDraft): DayBudget | null {
  const others = otherMeals(data, date, d).reduce((sum, m) => sum + (m.kcal ?? 0), 0);
  const total = others + (mealKcal(d) ?? 0);
  if (!(total > 0)) return null;
  const goal = data.settings.kcalGoal;
  return {
    text: `За день: ${f0(total)} / ${f0(goal)} ккал`,
    over: kcalGoalView(total, goal).state === 'over',
  };
}

/** The photo a recalculation sends for context: the last one estimated in this session, else the meal's last. */
export function contextPhoto(d: MealDraft): string | null {
  return d.positions.estimatedPhoto ?? d.photos.at(-1) ?? null;
}

// ---------------------------------------------------------------------------------------------
// Changes

export type MealAction =
  /** A type chip (or a type she just added). The selected chip again keeps it. */
  | { type: 'type'; value: string }
  | { type: 'text'; value: string }
  | { type: 'time'; value: HM | null }
  | { type: 'removePhoto'; id: string }
  | { type: 'kcal'; value: string }
  | { type: 'macro'; key: MacroKey; value: string }
  /** «+ Б · Ж · В». */
  | { type: 'openMacros' }
  /** «✨ Додати ще»: opens (pre-filled with the pending tail) or folds the composer. */
  | { type: 'composer'; open: boolean }
  | { type: 'composerText'; text: string }
  /** `capacity`: photos this meal may hold right now (`photoCapacity`), for a photo estimate's answer. */
  | { type: 'estimate'; action: EstimateAction; capacity?: number };

/** The manual fields emptied (her numbers went into positions). */
const noManualNumbers = (): ManualNumbers => ({
  kcalText: '',
  macroTexts: emptyMacroTexts(),
  macrosOpen: false,
});

/** Adds to the positions; when it is the first one on a meal she priced by hand, her numbers become «Інше». */
function addingPositions(d: MealDraft, apply: (p: PositionsState) => PositionsState): MealDraft {
  const before = d.positions;
  const other = before.drafts.length === 0 ? manualToPosition(d) : null;
  const plain = apply(before);
  if (!other || plain.drafts.length === 0) return { ...d, positions: plain };
  return {
    ...d,
    positions: apply({ ...before, drafts: [other] }),
    ...noManualNumbers(),
    // Her numbers covered what she had written.
    estimatedText: d.text,
  };
}

/**
 * The estimate in flight prices again the food her typed numbers were for: the meal has no positions yet and
 * it counts «Що я їла» as a whole (`counts`: «✨ Порахувати», or «📷 Фото» with her text as the hint) — an old
 * «Їжа за день» block with its kcal, typically. A photo without her text, a dish chip or «+ позиція» add food
 * on top of what she priced instead (`addingPositions`).
 */
function repricesManual(d: MealDraft): boolean {
  const { loading, drafts } = d.positions;
  return drafts.length === 0 && !!loading?.counts?.trim() && manualToPosition(d) !== null;
}

/**
 * The estimate's rows REPLACE her typed kcal / Б · Ж · В (adding them as «Інше» would count the meal twice).
 * Her numbers are kept with «Прибрати ці позиції», which puts them back. Nothing found: they stay.
 */
function replacingManual(d: MealDraft, apply: (p: PositionsState) => PositionsState): MealDraft {
  const positions = apply(d.positions);
  if (positions.drafts.length === 0 || !positions.undo) return { ...d, positions };
  const manual: ManualNumbers = { kcalText: d.kcalText, macroTexts: d.macroTexts, macrosOpen: d.macrosOpen };
  return {
    ...d,
    positions: { ...positions, undo: { ...positions.undo, manual } },
    ...noManualNumbers(),
  };
}

/**
 * «Прибрати ці позиції» after an estimate that replaced her numbers: they come back — in their fields, or as
 * «Інше» when other positions (a dish chip she added since) stay.
 */
function restoringManual(d: MealDraft, manual: ManualNumbers | undefined): MealDraft {
  if (!manual) return d;
  const { positions } = d;
  if (positions.drafts.length === 0) return { ...d, ...manual };
  const other = manualToPosition(manual);
  return other ? { ...d, positions: { ...positions, drafts: [other, ...positions.drafts] } } : d;
}

function estimate(d: MealDraft, action: EstimateAction, capacity: number): MealDraft {
  const p = d.positions;
  switch (action.type) {
    case 'resolve': {
      if (p.loading?.id !== action.id) return d;
      const photoId = action.res.photoId ?? null;
      const attached =
        p.loading.photo && photoId !== null && !d.photos.includes(photoId) && d.photos.length < capacity;
      const apply = (s: PositionsState) => estimateReducer(s, { ...action, attached });
      const next = repricesManual(d) ? replacingManual(d, apply) : addingPositions(d, apply);
      return {
        ...next,
        photos: attached ? [...d.photos, photoId] : d.photos,
        estimatedText: p.loading.counts ?? next.estimatedText,
        composer: COMPOSER_CLOSED,
      };
    }
    case 'dish':
    case 'saveItem':
      return addingPositions(d, (s) => estimateReducer(s, action));
    case 'undo': {
      const photoId = p.undo?.photoId ?? null;
      const undone: MealDraft = {
        ...d,
        positions: estimateReducer(p, action),
        photos: photoId ? d.photos.filter((id) => id !== photoId) : d.photos,
      };
      return restoringManual(undone, p.undo?.manual);
    }
    case 'photoGone':
      if (p.recalc.pending !== action.id) return d;
      return {
        ...d,
        positions: estimateReducer(p, action),
        // Its file is gone: the meal must not point at it.
        photos: d.photos.filter((id) => id !== action.photoId),
      };
    default:
      return { ...d, positions: estimateReducer(p, action) };
  }
}

export function mealReducer(d: MealDraft, action: MealAction): MealDraft {
  switch (action.type) {
    case 'type':
      // Tapping the selected chip keeps it: no silent untyped meal.
      if (action.value === d.type) return d;
      return {
        ...d,
        type: action.value,
        typeTouched: true,
        pickedTypes: d.pickedTypes.some((t) => mealTypeKey(t) === mealTypeKey(action.value))
          ? d.pickedTypes
          : [...d.pickedTypes, action.value],
      };
    case 'text':
      return { ...d, text: action.value.slice(0, LIMITS.text) };
    case 'time':
      return { ...d, time: action.value, timeTouched: true };
    case 'removePhoto': {
      if (!d.photos.includes(action.id)) return d;
      const { undo } = d.positions;
      return {
        ...d,
        photos: d.photos.filter((id) => id !== action.id),
        positions:
          undo?.photoId === action.id ? { ...d.positions, undo: { ...undo, photoId: null } } : d.positions,
      };
    }
    case 'kcal':
      return { ...d, kcalText: sanitizeKcalInput(action.value) };
    case 'macro':
      return { ...d, macroTexts: { ...d.macroTexts, [action.key]: sanitizeMacroInput(action.value) } };
    case 'openMacros':
      return d.macrosOpen ? d : { ...d, macrosOpen: true };
    case 'composer':
      return {
        ...d,
        composer: action.open ? openComposer(d.composer, pendingTail(d)) : { ...d.composer, open: false },
      };
    case 'composerText':
      return { ...d, composer: { ...d.composer, text: action.text } };
    case 'estimate':
      return estimate(d, action.action, action.capacity ?? LIMITS.photosPerDay);
  }
}

/** A «Часті страви» dish as a new position. */
export const dishAction = (itemId: string, dish: FoodEstimateItem): MealAction => ({
  type: 'estimate',
  action: { type: 'dish', itemId, dish },
});
