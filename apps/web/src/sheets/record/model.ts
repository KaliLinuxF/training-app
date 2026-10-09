/**
 * Day / weigh-in / measurements sheet: draft initialisation, validation and the draft → ops
 * mapping. Ports the prototype's `openSheet()` and `save()` (Tracker.dc.html), except that a save
 * only writes what she changed (two devices must not erase each other's records).
 */
import {
  isEmptyDay,
  isEmptyMeasure,
  LIMITS,
  normalizeTypeNames,
  num,
  opSchema,
  str,
  WORKOUT_TYPES,
  type AppData,
  type DayEntry,
  type FoodUse,
  type ISODate,
  type MeasureKey,
  type MeasureValues,
  type Op,
} from '@legko/shared';
import { insertEstimate, type FoodAdd } from '@/features/food';
import type { SheetMode, SheetPatch } from '@/store/ui';
import { weightBefore } from '../helpers';
import {
  FIELD_ERRORS,
  kcalError,
  kgError,
  MEASURE_KEYS,
  measureError,
  textError,
  type MeasureError,
  type MeasureTexts,
} from '../validation';

export type RecordMode = Extract<SheetMode, 'day' | 'weight' | 'measure'>;

export const isRecordMode = (mode: SheetMode): mode is RecordMode =>
  mode === 'day' || mode === 'weight' || mode === 'measure';

export const RECORD_HEADINGS: Readonly<Record<RecordMode, string>> = {
  day: 'Запис дня',
  weight: 'Контрольне зважування',
  measure: 'Заміри тіла',
};

/** Which blocks a mode shows (prototype `showDay` / `showWeight` / `showMeasure`). */
export function recordSections(mode: RecordMode): { day: boolean; weight: boolean; measure: boolean } {
  return { day: mode === 'day', weight: mode !== 'measure', measure: mode !== 'weight' };
}

/** Everything the sheet edits, as raw input text where it is typed. */
export interface RecordDraft extends MeasureTexts {
  food: string;
  /** Digits only. */
  kcal: string;
  trained: boolean | null;
  types: string[];
  notes: string;
  photos: string[];
  /** «65,4» */
  weight: string;
  /** «Часті страви» usage of the meals added in this sheet; recorded only when the day is saved. */
  foodUses: FoodUse[];
}

/**
 * Port of `openSheet()`: the day entry, weigh-in and measurements of `date`; on a day without a
 * weigh-in the weight sheet offers the one before that day; then the patch (e.g. `trained: true`).
 */
export function initRecordDraft(data: AppData, date: ISODate, mode: RecordMode, patch?: SheetPatch): RecordDraft {
  const e = data.days[date];
  const w = data.weights.find((x) => x.date === date);
  const m = data.measures.find((x) => x.date === date);
  const draft: RecordDraft = {
    food: e?.food ?? '',
    kcal: str(e?.kcal),
    trained: e?.trained ?? null,
    types: [...(e?.types ?? [])],
    notes: e?.notes ?? '',
    photos: [...(e?.photos ?? [])],
    weight: w ? str(w.kg) : mode === 'weight' ? str(weightBefore(data, date)) : '',
    chest: str(m?.chest),
    waist: str(m?.waist),
    hips: str(m?.hips),
    foodUses: [],
  };
  if (patch?.trained !== undefined) draft.trained = patch.trained;
  return draft;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

type DayField = 'food' | 'kcal' | 'trained' | 'types' | 'notes' | 'photos';
const DAY_FIELDS: readonly DayField[] = ['food', 'kcal', 'trained', 'types', 'notes', 'photos'];

function fieldChanged(a: RecordDraft, b: RecordDraft, key: DayField | 'weight' | MeasureKey): boolean {
  const x = a[key];
  const y = b[key];
  return Array.isArray(x) && Array.isArray(y) ? !sameList(x, y) : x !== y;
}

/** Whether the draft differs from what was loaded (`baseline` = the draft without the open patch). */
export function isRecordDirty(baseline: RecordDraft, draft: RecordDraft): boolean {
  return (
    DAY_FIELDS.some((k) => fieldChanged(baseline, draft, k)) ||
    fieldChanged(baseline, draft, 'weight') ||
    MEASURE_KEYS.some((k) => fieldChanged(baseline, draft, k)) ||
    baseline.foodUses.length !== draft.foodUses.length
  );
}

export interface RecordErrors {
  kcal?: string;
  weight?: string;
  measure: MeasureError;
  food?: string;
  notes?: string;
  types?: string;
}

/** Validates only the blocks the mode shows, against the limits the server enforces. */
export function validateRecord(draft: RecordDraft, mode: RecordMode): RecordErrors {
  const show = recordSections(mode);
  return {
    kcal: show.day ? kcalError(draft.kcal) : undefined,
    weight: show.weight ? kgError(draft.weight) : undefined,
    measure: show.measure ? measureError(draft) : { message: undefined, invalid: [] },
    food: show.day ? textError(draft.food) : undefined,
    notes: show.day ? textError(draft.notes) : undefined,
    // Types are dropped unless trained, so only then do they count.
    types: show.day && draft.trained === true && draft.types.length > LIMITS.types ? FIELD_ERRORS.types : undefined,
  };
}

export const hasRecordErrors = (e: RecordErrors): boolean =>
  e.kcal !== undefined ||
  e.weight !== undefined ||
  e.measure.message !== undefined ||
  e.food !== undefined ||
  e.notes !== undefined ||
  e.types !== undefined;

/** The day entry the draft describes (`types` only when trained, photos only when there are some). */
export function draftDayEntry(draft: Pick<RecordDraft, DayField>): DayEntry {
  const entry: DayEntry = {
    food: draft.food.trim(),
    kcal: num(draft.kcal),
    trained: draft.trained,
    types: draft.trained === true ? [...draft.types] : [],
    notes: draft.notes.trim(),
  };
  if (draft.photos.length) entry.photos = [...draft.photos];
  return entry;
}

const sameDay = (a: DayEntry, b: DayEntry): boolean =>
  a.food === b.food &&
  a.kcal === b.kcal &&
  a.trained === b.trained &&
  sameList(a.types, b.types) &&
  a.notes === b.notes &&
  sameList(a.photos ?? [], b.photos ?? []);

const sameMeasure = (a: MeasureValues, b: MeasureValues): boolean => MEASURE_KEYS.every((k) => a[k] === b[k]);

export interface RecordSave {
  /** What the sheet loaded (with the weight sheet's pre-fill, without the open patch). */
  baseline: RecordDraft;
  draft: RecordDraft;
  /** The store at save time; it may have been refreshed from the server since the sheet opened. */
  data: AppData;
  date: ISODate;
  mode: RecordMode;
}

/**
 * Port of `save()`, written per field: whatever she changed in this sheet wins, everything else
 * keeps what is stored *now*, and a section is written only when the result differs from the
 * store. So a day saved on a stale device never deletes a weigh-in or measurements recorded
 * elsewhere, nor rewrites the day's other fields. The weigh-in sheet always records its value
 * (the offered weight means «this is the weight of that day»).
 */
export function recordOps({ baseline, draft, data, date, mode }: RecordSave): Op[] {
  const show = recordSections(mode);
  // What is stored for the date right now, as input text (no pre-fill, no patch).
  const stored = initRecordDraft(data, date, 'day');
  const changed = (k: DayField | 'weight' | MeasureKey): boolean => fieldChanged(baseline, draft, k);
  const ops: Op[] = [];

  if (show.day) {
    const merged: Pick<RecordDraft, DayField> = {
      food: changed('food') ? draft.food : stored.food,
      kcal: changed('kcal') ? draft.kcal : stored.kcal,
      trained: changed('trained') ? draft.trained : stored.trained,
      types: changed('types') ? draft.types : stored.types,
      notes: changed('notes') ? draft.notes : stored.notes,
      photos: changed('photos') ? draft.photos : stored.photos,
    };
    const value = draftDayEntry(merged);
    if (!sameDay(value, draftDayEntry(stored))) {
      ops.push(isEmptyDay(value) ? { kind: 'day.delete', date } : { kind: 'day.put', date, value });
    }
  }

  if (show.weight) {
    const storedKg = num(stored.weight);
    const kg = mode === 'weight' || changed('weight') ? num(draft.weight) : storedKg;
    if (kg !== storedKg) ops.push(kg == null ? { kind: 'weight.delete', date } : { kind: 'weight.put', date, kg });
  }

  if (show.measure) {
    const pick = (k: MeasureKey): number | null => num(changed(k) ? draft[k] : stored[k]);
    const value: MeasureValues = { chest: pick('chest'), waist: pick('waist'), hips: pick('hips') };
    const before: MeasureValues = { chest: num(stored.chest), waist: num(stored.waist), hips: num(stored.hips) };
    if (!sameMeasure(value, before)) {
      ops.push(isEmptyMeasure(value) ? { kind: 'measure.delete', date } : { kind: 'measure.put', date, value });
    }
  }
  return ops;
}

/**
 * `food.use` for the meals added in this sheet, saved together with the day. A use the server
 * would refuse (e.g. an over-long dish name) is left out rather than blocking the whole save.
 */
export function foodUseOps(draft: RecordDraft, date: ISODate): Op[] {
  return draft.foodUses
    .map((value): Op => ({ kind: 'food.use', date, value }))
    .filter((op) => opSchema.safeParse(op).success);
}

// ---- workout types --------------------------------------------------------------------------

const typeKey = (name: string): string => name.trim().toLocaleLowerCase('uk');

/** Chips: built-in types, her own types, then any selected type that is in neither list. */
export function typeChoices(customTypes: readonly string[], selected: readonly string[]): string[] {
  return normalizeTypeNames([...WORKOUT_TYPES, ...customTypes, ...selected]);
}

/** Selects or deselects a chip; never more than `LIMITS.types` at once. */
export function toggleType(selected: readonly string[], type: string): string[] {
  if (selected.includes(type)) return selected.filter((t) => t !== type);
  return selected.length >= LIMITS.types ? [...selected] : [...selected, type];
}

export interface CustomTypeResult {
  /** The chip to select (an existing spelling wins over the typed one). */
  name: string;
  /** New `settings.customTypes`, or `null` when they stay as they are. */
  customTypes: string[] | null;
  /** New selection for the draft. */
  types: string[];
}

/** «+ Свій тип»: adds the typed name to her types (unless it already exists) and selects it. */
export function addCustomType(
  input: string,
  customTypes: readonly string[],
  selected: readonly string[],
): CustomTypeResult | null {
  const typed = input.trim().replace(/\s+/g, ' ').slice(0, LIMITS.typeName).trim();
  if (!typed) return null;
  const key = typeKey(typed);
  const known = [...WORKOUT_TYPES, ...customTypes].find((t) => typeKey(t) === key);
  const name = known ?? selected.find((t) => typeKey(t) === key) ?? typed;
  const canStore = known === undefined && customTypes.length < LIMITS.customTypes;
  const already = selected.includes(name);
  return {
    name,
    customTypes: canStore ? normalizeTypeNames([...customTypes, name]) : null,
    types: already || selected.length >= LIMITS.types ? [...selected] : [...selected, name],
  };
}

// ---- food assist ----------------------------------------------------------------------------

/**
 * «Додати» from FoodAssist (an estimate or a «Часті страви» chip): the line replaces the meal
 * text it was estimated from (or is appended on a new line), the kcal are added, the photo is
 * attached (max 12 per day) and the dish usage waits for «Зберегти».
 */
export function applyFoodAdd(draft: RecordDraft, add: FoodAdd): RecordDraft {
  const line = add.line.trim();
  const food = line ? insertEstimate(draft.food, line, add.consumed) : draft.food;
  const kcal = String((num(draft.kcal) ?? 0) + Math.max(0, Math.round(add.kcal)));
  const photos =
    add.photoId && !draft.photos.includes(add.photoId) && draft.photos.length < LIMITS.photosPerDay
      ? [...draft.photos, add.photoId]
      : draft.photos;
  return { ...draft, food, kcal, photos, foodUses: [...draft.foodUses, ...add.uses] };
}

export const removePhoto = (draft: RecordDraft, id: string): RecordDraft => ({
  ...draft,
  photos: draft.photos.filter((p) => p !== id),
});
