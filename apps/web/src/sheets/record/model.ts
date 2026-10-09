/**
 * Day / weigh-in / measurements sheet: draft initialisation, validation and the draft → ops
 * mapping. Ports the prototype's `openSheet()` and `save()` (Tracker.dc.html).
 */
import {
  isEmptyDay,
  LIMITS,
  normalizeTypeNames,
  num,
  str,
  WORKOUT_TYPES,
  type AppData,
  type DayEntry,
  type ISODate,
  type Op,
} from '@legko/shared';
import type { FoodAdd } from '@/features/food';
import type { SheetMode, SheetPatch } from '@/store/ui';
import { latestWeight } from '../helpers';
import { kcalError, kgError, measureError, measureValues, type MeasureError, type MeasureTexts } from '../validation';

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
}

/**
 * Port of `openSheet()`: the day entry, weigh-in and measurements of `date`; the weight sheet
 * pre-fills the latest weigh-in when the date has none; then the patch (e.g. `trained: true`).
 */
export function initRecordDraft(data: AppData, date: ISODate, mode: RecordMode, patch?: SheetPatch): RecordDraft {
  const e = data.days[date];
  const w = data.weights.find((x) => x.date === date);
  const m = data.measures.find((x) => x.date === date);
  const lastW = latestWeight(data);
  const draft: RecordDraft = {
    food: e?.food ?? '',
    kcal: str(e?.kcal),
    trained: e?.trained ?? null,
    types: [...(e?.types ?? [])],
    notes: e?.notes ?? '',
    photos: [...(e?.photos ?? [])],
    weight: w ? str(w.kg) : mode === 'weight' && lastW != null ? str(lastW) : '',
    chest: str(m?.chest),
    waist: str(m?.waist),
    hips: str(m?.hips),
  };
  if (patch?.trained !== undefined) draft.trained = patch.trained;
  return draft;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

/** Whether the draft differs from what was loaded (`baseline` = the draft without the open patch). */
export function isRecordDirty(baseline: RecordDraft, draft: RecordDraft): boolean {
  return (
    baseline.food !== draft.food ||
    baseline.kcal !== draft.kcal ||
    baseline.trained !== draft.trained ||
    !sameList(baseline.types, draft.types) ||
    baseline.notes !== draft.notes ||
    !sameList(baseline.photos, draft.photos) ||
    baseline.weight !== draft.weight ||
    baseline.chest !== draft.chest ||
    baseline.waist !== draft.waist ||
    baseline.hips !== draft.hips
  );
}

export interface RecordErrors {
  kcal?: string;
  weight?: string;
  measure: MeasureError;
}

/** Validates only the blocks the mode shows. */
export function validateRecord(draft: RecordDraft, mode: RecordMode): RecordErrors {
  const show = recordSections(mode);
  return {
    kcal: show.day ? kcalError(draft.kcal) : undefined,
    weight: show.weight ? kgError(draft.weight) : undefined,
    measure: show.measure ? measureError(draft) : { message: undefined, invalid: [] },
  };
}

export const hasRecordErrors = (e: RecordErrors): boolean =>
  e.kcal !== undefined || e.weight !== undefined || e.measure.message !== undefined;

/** The day entry the draft describes (`types` only when trained, photos only when there are some). */
export function draftDayEntry(draft: RecordDraft): DayEntry {
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

/**
 * Port of `save()`: day mode → the day (or its removal) + weigh-in (set or delete) + measurements
 * (set or delete); weight mode → weigh-in only; measure mode → measurements only.
 */
export function recordOps(draft: RecordDraft, date: ISODate, mode: RecordMode): Op[] {
  const show = recordSections(mode);
  const ops: Op[] = [];
  if (show.day) {
    const value = draftDayEntry(draft);
    ops.push(isEmptyDay(value) ? { kind: 'day.delete', date } : { kind: 'day.put', date, value });
  }
  if (show.weight) {
    const kg = num(draft.weight);
    ops.push(kg == null ? { kind: 'weight.delete', date } : { kind: 'weight.put', date, kg });
  }
  if (show.measure) {
    const value = measureValues(draft);
    const empty = value.chest == null && value.waist == null && value.hips == null;
    ops.push(empty ? { kind: 'measure.delete', date } : { kind: 'measure.put', date, value });
  }
  return ops;
}

// ---- workout types --------------------------------------------------------------------------

const typeKey = (name: string): string => name.trim().toLocaleLowerCase('uk');

/** Chips: built-in types, her own types, then any selected type that is in neither list. */
export function typeChoices(customTypes: readonly string[], selected: readonly string[]): string[] {
  return normalizeTypeNames([...WORKOUT_TYPES, ...customTypes, ...selected]);
}

export function toggleType(selected: readonly string[], type: string): string[] {
  return selected.includes(type) ? selected.filter((t) => t !== type) : [...selected, type];
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

/** «Додати» from FoodAssist: append the line, add the kcal, attach the photo (max 12 per day). */
export function applyFoodAdd(draft: RecordDraft, add: FoodAdd): RecordDraft {
  const base = draft.food.replace(/\s+$/, '');
  const line = add.line.trim();
  const food = !line ? draft.food : base ? `${base}\n${line}` : line;
  const kcal = String((num(draft.kcal) ?? 0) + Math.max(0, Math.round(add.kcal)));
  const photos =
    add.photoId && !draft.photos.includes(add.photoId) && draft.photos.length < LIMITS.photosPerDay
      ? [...draft.photos, add.photoId]
      : draft.photos;
  return { ...draft, food, kcal, photos };
}

export const removePhoto = (draft: RecordDraft, id: string): RecordDraft => ({
  ...draft,
  photos: draft.photos.filter((p) => p !== id),
});
