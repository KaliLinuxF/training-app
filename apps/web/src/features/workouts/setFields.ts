/**
 * The editable fields of a set (reps, kg, sec, min, km): labels, units, bounds and stepper steps, shared by the
 * builder (§3.6) and the session (§3.9, §3.12). Values follow the op schema: kg in 0,25 kg, minutes in 0,5, km in
 * 0,01, the rest whole.
 */
import {
  KIND_FIELDS,
  LIMITS,
  fN,
  kgStep,
  num,
  type Equipment,
  type ExerciseKind,
  type SetValues,
} from '@legko/shared';

export type SetField = keyof SetValues;

export interface FieldMeta {
  /** Label above the stepper («Повторення», «Вага, кг»). */
  label: string;
  /** Unit inside the input. */
  unit: string;
  min: number;
  max: number;
  /** Stored values are multiples of this. */
  multiple: number;
  inputMode: 'numeric' | 'decimal';
  /** Empty is allowed (km). */
  optional: boolean;
}

export const FIELD_META: Readonly<Record<SetField, FieldMeta>> = {
  reps: {
    label: 'Повторення',
    unit: 'повт.',
    min: LIMITS.reps.min,
    max: LIMITS.reps.max,
    multiple: 1,
    inputMode: 'numeric',
    optional: false,
  },
  kg: {
    label: 'Вага',
    unit: 'кг',
    min: LIMITS.setKg.min,
    max: LIMITS.setKg.max,
    multiple: 0.25,
    inputMode: 'decimal',
    optional: false,
  },
  sec: {
    label: 'Секунди',
    unit: 'с',
    min: LIMITS.setSec.min,
    max: LIMITS.setSec.max,
    multiple: 1,
    inputMode: 'numeric',
    optional: false,
  },
  min: {
    label: 'Хвилини',
    unit: 'хв',
    min: LIMITS.cardioMin.min,
    max: LIMITS.cardioMin.max,
    multiple: 0.5,
    inputMode: 'decimal',
    optional: false,
  },
  km: {
    label: 'Км (за бажанням)',
    unit: 'км',
    min: LIMITS.km.min,
    max: LIMITS.km.max,
    multiple: 0.01,
    inputMode: 'decimal',
    optional: true,
  },
};

/** The fields she edits for an exercise kind (weight: reps + kg; bodyweight: reps; time: sec; cardio: min + km). */
export const fieldsOf = (kind: ExerciseKind): readonly SetField[] => KIND_FIELDS[kind];

/** Stepper step: kg by equipment (1 or 2,5), seconds by 5, km by 0,1, the rest by 1. */
export function fieldStep(field: SetField, equipment: Equipment): number {
  switch (field) {
    case 'kg':
      return kgStep(equipment);
    case 'sec':
      return 5;
    case 'km':
      return 0.1;
    default:
      return 1;
  }
}

/** Rounded to the stored multiple and clamped to the field's bounds. */
export function fitField(field: SetField, value: number): number {
  const meta = FIELD_META[field];
  const rounded = Math.round(value / meta.multiple) * meta.multiple;
  // Floating noise of the multiples (0.1 + 0.2): keep two decimals at most.
  const clean = Math.round(rounded * 100) / 100;
  return Math.min(meta.max, Math.max(meta.min, clean));
}

/** One stepper press: from the value (empty counts as 0) by `delta`. */
export const stepField = (field: SetField, value: number | null, delta: number): number =>
  fitField(field, (value ?? 0) + delta);

/** Typed text → the value to store: '' → null; not a number → undefined (keep what is stored). */
export function parseField(field: SetField, text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const n = num(text);
  if (n === null) return undefined;
  return fitField(field, n);
}

/** Stored value → input text («42,5», «» for empty). */
export const fieldText = (value: number | null): string =>
  value === null ? '' : String(value).replace('.', ',');

/** «−2,5» / «+2,5». */
export const stepText = (sign: '−' | '+', step: number): string => `${sign}${fN(step)}`;
