/**
 * The record sheet — the full «Запис дня», the day's meal list «Їжа», the new-meal editor «Прийом їжі» and the short
 * «Тренування» / «Контрольне зважування» / «Заміри тіла» / «Кроки» sheets: draft initialisation, validation and the
 * draft → ops mapping. Ports the prototype's `openSheet()` and `save()` (Tracker.dc.html), except that a save only
 * writes what she changed in the blocks the sheet shows (two devices, or two short sheets, must not erase each
 * other's records). The food is never part of this draft: every meal saves on its own in the meal editor
 * (docs/meals-macros.md D3, D15), so a day save sends at most one partial `day.meta` (never `day.put` / `day.delete`).
 */
import {
  isEmptyMeasure,
  LIMITS,
  normalizeTypeNames,
  num,
  str,
  WORKOUT_TYPES,
  type AppData,
  type DayMeta,
  type ISODate,
  type MeasureKey,
  type MeasureValues,
  type Op,
} from '@legko/shared';
import type { SheetMode, SheetPatch } from '@/store/ui';
import { stepsCount, weightBefore } from '../helpers';
import {
  FIELD_ERRORS,
  kgError,
  MEASURE_KEYS,
  measureError,
  stepsError,
  textError,
  type MeasureError,
  type MeasureTexts,
} from '../validation';

/** The sheets with content of their own: the full day, the day's meal list, the new meal and the short sheets. */
export type RecordMode = Extract<SheetMode, 'day' | 'food' | 'meal' | 'workout' | 'weight' | 'measure' | 'steps'>;

const RECORD_MODES: readonly RecordMode[] = ['day', 'food', 'meal', 'workout', 'weight', 'measure', 'steps'];

export const isRecordMode = (mode: SheetMode): mode is RecordMode => RECORD_MODES.some((m) => m === mode);

/** Everything the record sheet renders: a form, or the «Що записати?» menu that swaps to one in place. */
export type CaptureMode = RecordMode | 'menu';

export const isCaptureMode = (mode: SheetMode): mode is CaptureMode => mode === 'menu' || isRecordMode(mode);

/** Heading (and dialog name) of the «+» menu. */
export const MENU_HEADING = 'Що записати?';

export const RECORD_HEADINGS: Readonly<Record<RecordMode, string>> = {
  day: 'Запис дня',
  food: 'Їжа',
  meal: 'Прийом їжі',
  workout: 'Тренування',
  weight: 'Контрольне зважування',
  measure: 'Заміри тіла',
  steps: 'Кроки',
};

/** The stored steps of `date` as the input's text («8400»), '' without any. */
function stepsTextOf(data: AppData, date: ISODate): string {
  const entry = (data.steps ?? []).find((x) => x.date === date);
  return entry ? String(entry.steps) : '';
}

/** The blocks a sheet shows; it validates and writes only these. */
export interface RecordSections {
  /** ✓ / ✕ and the workout types. */
  workout: boolean;
  /** The day's meals: totals and one row per meal (each opens the stacked meal editor). */
  food: boolean;
  /** The new-meal editor «Прийом їжі» (its own draft and «Зберегти», `useMealEditor`). */
  meal: boolean;
  notes: boolean;
  weight: boolean;
  measure: boolean;
  /** The day's steps (one number, typed by hand). */
  steps: boolean;
}

const NONE: Readonly<RecordSections> = {
  workout: false,
  food: false,
  meal: false,
  notes: false,
  weight: false,
  measure: false,
  steps: false,
};

const SECTIONS: Readonly<Record<RecordMode, Readonly<RecordSections>>> = {
  day: { ...NONE, workout: true, food: true, notes: true, weight: true, measure: true, steps: true },
  food: { ...NONE, food: true },
  meal: { ...NONE, meal: true },
  workout: { ...NONE, workout: true, notes: true },
  weight: { ...NONE, weight: true },
  measure: { ...NONE, measure: true },
  steps: { ...NONE, steps: true },
};

/** Which blocks a mode shows (prototype `showDay` / `showWeight` / `showMeasure`, plus the short sheets). */
export function recordSections(mode: RecordMode): RecordSections {
  return { ...SECTIONS[mode] };
}

/** Everything the sheet edits, as raw input text where it is typed. The food is not here (meals save themselves). */
export interface RecordDraft extends MeasureTexts {
  trained: boolean | null;
  types: string[];
  notes: string;
  /** «65,4» */
  weight: string;
  /** Digits only («8400»); '' = none. */
  steps: string;
}

/**
 * Port of `openSheet()`: the workout mark, types, notes, weigh-in and measurements of `date`; on a day without a
 * weigh-in the weight sheet offers the one before that day; then the patch (`trained: true` from the workout push),
 * only in a sheet that shows the workout.
 */
export function initRecordDraft(
  data: AppData,
  date: ISODate,
  mode: RecordMode,
  patch?: SheetPatch,
): RecordDraft {
  const e = data.days[date];
  const w = data.weights.find((x) => x.date === date);
  const m = data.measures.find((x) => x.date === date);
  const draft: RecordDraft = {
    trained: e?.trained ?? null,
    types: [...(e?.types ?? [])],
    notes: e?.notes ?? '',
    weight: w ? str(w.kg) : mode === 'weight' ? str(weightBefore(data, date)) : '',
    chest: str(m?.chest),
    waist: str(m?.waist),
    hips: str(m?.hips),
    steps: stepsTextOf(data, date),
  };
  if (patch?.trained !== undefined && SECTIONS[mode].workout) draft.trained = patch.trained;
  return draft;
}

const sameList = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((x, i) => x === b[i]);

type DayField = 'trained' | 'types' | 'notes';
const DAY_FIELDS: readonly DayField[] = ['trained', 'types', 'notes'];

/** The block that edits each field of the day entry. */
const DAY_FIELD_SECTION: Readonly<Record<DayField, 'workout' | 'notes'>> = {
  trained: 'workout',
  types: 'workout',
  notes: 'notes',
};

function fieldChanged(a: RecordDraft, b: RecordDraft, key: DayField | 'weight' | 'steps' | MeasureKey): boolean {
  const x = a[key];
  const y = b[key];
  return Array.isArray(x) && Array.isArray(y) ? !sameList(x, y) : x !== y;
}

/** Whether the draft differs from what was loaded (`baseline` = the draft without the open patch). */
export function isRecordDirty(baseline: RecordDraft, draft: RecordDraft): boolean {
  return (
    DAY_FIELDS.some((k) => fieldChanged(baseline, draft, k)) ||
    fieldChanged(baseline, draft, 'weight') ||
    fieldChanged(baseline, draft, 'steps') ||
    MEASURE_KEYS.some((k) => fieldChanged(baseline, draft, k))
  );
}

export interface RecordErrors {
  weight?: string;
  measure: MeasureError;
  notes?: string;
  types?: string;
  steps?: string;
}

/** Validates only the blocks the mode shows, against the limits the server enforces. */
export function validateRecord(draft: RecordDraft, mode: RecordMode): RecordErrors {
  const show = recordSections(mode);
  return {
    weight: show.weight ? kgError(draft.weight) : undefined,
    measure: show.measure ? measureError(draft) : { message: undefined, invalid: [] },
    notes: show.notes ? textError(draft.notes) : undefined,
    steps: show.steps ? stepsError(draft.steps) : undefined,
    // Types are dropped unless trained, so only then do they count.
    types:
      show.workout && draft.trained === true && draft.types.length > LIMITS.types
        ? FIELD_ERRORS.types
        : undefined,
  };
}

export const hasRecordErrors = (e: RecordErrors): boolean =>
  e.weight !== undefined ||
  e.measure.message !== undefined ||
  e.notes !== undefined ||
  e.types !== undefined ||
  e.steps !== undefined;

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
 * The partial `day.meta` of a save: only the fields she changed in the blocks this sheet shows, each taken from the
 * draft (notes trimmed). Types go along only when she changed them and the day stays trained (✕ sends `{ trained }`
 * and the reducer drops the types). `null` when nothing she changed differs from what is stored now.
 */
export function dayMetaOf({ baseline, draft, data, date, mode }: RecordSave): DayMeta | null {
  const show = recordSections(mode);
  const mine = (k: DayField): boolean => show[DAY_FIELD_SECTION[k]] && fieldChanged(baseline, draft, k);
  // What is stored for the date right now (it may have changed on another device since the sheet opened).
  const stored = initRecordDraft(data, date, 'day');
  const meta: DayMeta = {};
  if (mine('trained')) meta.trained = draft.trained;
  const trained = meta.trained !== undefined ? meta.trained : stored.trained;
  if (mine('types') && trained === true) meta.types = [...draft.types];
  if (mine('notes')) meta.notes = draft.notes.trim();

  const differs =
    (meta.trained !== undefined && meta.trained !== stored.trained) ||
    (meta.types !== undefined && !sameList(meta.types, stored.types)) ||
    (meta.notes !== undefined && meta.notes !== stored.notes.trim());
  return differs ? meta : null;
}

/**
 * Port of `save()`, written per field: whatever she changed in a block this sheet shows wins, everything else keeps
 * what is stored *now*, and a section is written only when the result differs from the store. So a day saved on a
 * stale device never deletes a weigh-in or measurements recorded elsewhere, nor rewrites the day's other fields (its
 * meals least of all: `day.meta` never touches the food), and a short sheet («Тренування») never touches the fields
 * it does not show. The weigh-in sheet always records its value (the offered weight means «this is the weight of
 * that day»). An all-empty day after the `day.meta` is deleted by the reducer.
 */
export function recordOps(save: RecordSave): Op[] {
  const { baseline, draft, data, date, mode } = save;
  const show = recordSections(mode);
  const stored = initRecordDraft(data, date, 'day');
  const changed = (k: 'weight' | 'steps' | MeasureKey): boolean => fieldChanged(baseline, draft, k);
  const ops: Op[] = [];

  if (show.workout || show.notes) {
    const value = dayMetaOf(save);
    if (value) ops.push({ kind: 'day.meta', date, value });
  }

  if (show.weight) {
    const storedKg = num(stored.weight);
    const kg = mode === 'weight' || changed('weight') ? num(draft.weight) : storedKg;
    if (kg !== storedKg)
      ops.push(kg == null ? { kind: 'weight.delete', date } : { kind: 'weight.put', date, kg });
  }

  if (show.measure) {
    const pick = (k: MeasureKey): number | null => num(changed(k) ? draft[k] : stored[k]);
    const value: MeasureValues = { chest: pick('chest'), waist: pick('waist'), hips: pick('hips') };
    const before: MeasureValues = {
      chest: num(stored.chest),
      waist: num(stored.waist),
      hips: num(stored.hips),
    };
    if (!sameMeasure(value, before)) {
      ops.push(
        isEmptyMeasure(value) ? { kind: 'measure.delete', date } : { kind: 'measure.put', date, value },
      );
    }
  }

  // Steps: only when she changed them (two devices must not erase each other's count); empty or 0 deletes.
  if (show.steps && changed('steps')) {
    const before = stepsCount(stored.steps);
    const steps = stepsCount(draft.steps);
    if (steps !== before)
      ops.push(steps === null ? { kind: 'steps.delete', date } : { kind: 'steps.put', date, steps });
  }
  return ops;
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
