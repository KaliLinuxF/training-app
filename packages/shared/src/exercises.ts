/**
 * Muscles, library groups, equipment, kinds and per-kind defaults of the workouts feature
 * (docs/workouts-steps-rebrand.md §1.5). Pure constants: no clock, no data.
 */
import type { Equipment, ExerciseKind, MuscleId, SetValues } from './types';

/** Every muscle the body map draws, in a stable order (front-ish first). */
export const MUSCLES = [
  'chest',
  'shoulders',
  'biceps',
  'triceps',
  'forearms',
  'abs',
  'obliques',
  'traps',
  'lats',
  'lowerBack',
  'glutes',
  'quads',
  'hamstrings',
  'adductors',
  'calves',
] as const satisfies readonly MuscleId[];

export const MUSCLE_LABELS: Readonly<Record<MuscleId, string>> = {
  chest: 'Груди',
  shoulders: 'Плечі',
  biceps: 'Біцепс',
  triceps: 'Трицепс',
  forearms: 'Передпліччя',
  abs: 'Прес',
  obliques: 'Косі мʼязи',
  traps: 'Трапеції',
  lats: 'Найширші',
  lowerBack: 'Поперек',
  glutes: 'Сідниці',
  quads: 'Квадрицепс',
  hamstrings: 'Задня поверхня стегна',
  adductors: 'Привідні',
  calves: 'Литки',
};

export type BodyView = 'front' | 'back';

/** Which body-map silhouette(s) draw the muscle. */
export const MUSCLE_VIEW: Readonly<Record<MuscleId, readonly BodyView[]>> = {
  chest: ['front'],
  shoulders: ['front', 'back'],
  biceps: ['front'],
  triceps: ['back'],
  forearms: ['front', 'back'],
  abs: ['front'],
  obliques: ['front'],
  traps: ['back'],
  lats: ['back'],
  lowerBack: ['back'],
  glutes: ['back'],
  quads: ['front'],
  hamstrings: ['back'],
  adductors: ['front'],
  calves: ['front', 'back'],
};

export type MuscleBucket = 'upper' | 'lower' | 'core';

/** The derived workout type bucket of a primary muscle (§1.7); the lower back counts toward none. */
export const MUSCLE_BUCKET: Readonly<Record<MuscleId, MuscleBucket | null>> = {
  chest: 'upper',
  shoulders: 'upper',
  biceps: 'upper',
  triceps: 'upper',
  forearms: 'upper',
  abs: 'core',
  obliques: 'core',
  traps: 'upper',
  lats: 'upper',
  lowerBack: null,
  glutes: 'lower',
  quads: 'lower',
  hamstrings: 'lower',
  adductors: 'lower',
  calves: 'lower',
};

export type ExerciseGroupId =
  | 'chest'
  | 'back'
  | 'shoulders'
  | 'arms'
  | 'core'
  | 'legs'
  | 'glutes'
  | 'cardio'
  | 'mine';

export interface ExerciseGroup {
  id: ExerciseGroupId;
  label: string;
  /**
   * Membership = any PRIMARY muscle in this list. Empty for the two UI-only filters: `cardio` (kind cardio) and
   * `mine` (her own exercises).
   */
  muscles: readonly MuscleId[];
}

/** Library chips, in order. */
export const EXERCISE_GROUPS: readonly ExerciseGroup[] = [
  { id: 'chest', label: 'Груди', muscles: ['chest'] },
  { id: 'back', label: 'Спина', muscles: ['traps', 'lats', 'lowerBack'] },
  { id: 'shoulders', label: 'Плечі', muscles: ['shoulders'] },
  { id: 'arms', label: 'Руки', muscles: ['biceps', 'triceps', 'forearms'] },
  { id: 'core', label: 'Прес', muscles: ['abs', 'obliques'] },
  { id: 'legs', label: 'Ноги', muscles: ['quads', 'hamstrings', 'adductors', 'calves'] },
  { id: 'glutes', label: 'Сідниці', muscles: ['glutes'] },
  { id: 'cardio', label: 'Кардіо', muscles: [] },
  { id: 'mine', label: 'Мої', muscles: [] },
];

export const EQUIPMENT = [
  'barbell',
  'dumbbell',
  'kettlebell',
  'machine',
  'cable',
  'band',
  'bodyweight',
  'cardio',
  'other',
] as const satisfies readonly Equipment[];

export const EQUIPMENT_LABELS: Readonly<Record<Equipment, string>> = {
  barbell: 'Штанга',
  dumbbell: 'Гантелі',
  kettlebell: 'Гиря',
  machine: 'Тренажер',
  cable: 'Блок',
  band: 'Резинка',
  bodyweight: 'Власна вага',
  cardio: 'Кардіотренажер',
  other: 'Інше',
};

export const EXERCISE_KINDS = ['weight', 'bodyweight', 'time', 'cardio'] as const satisfies readonly ExerciseKind[];

export const EXERCISE_KIND_LABELS: Readonly<Record<ExerciseKind, string>> = {
  weight: 'З вагою',
  bodyweight: 'Власна вага',
  time: 'На час',
  cardio: 'Кардіо',
};

export type Intensity = 'light' | 'moderate' | 'high';
export const INTENSITIES = ['light', 'moderate', 'high'] as const satisfies readonly Intensity[];
export const INTENSITY_LABELS: Readonly<Record<Intensity, string>> = {
  light: 'Легка',
  moderate: 'Помірна',
  high: 'Висока',
};

/** MET of her own exercises by «Інтенсивність» (the editor's three presets). */
export const INTENSITY_MET: Readonly<Record<ExerciseKind, Readonly<Record<Intensity, number>>>> = {
  weight: { light: 3.5, moderate: 5.0, high: 6.0 },
  bodyweight: { light: 2.8, moderate: 3.8, high: 8.0 },
  time: { light: 2.8, moderate: 3.8, high: 8.0 },
  cardio: { light: 4.0, moderate: 7.0, high: 10.0 },
};

/** The preset nearest to `met` (a tie goes to the lighter one): shows a seed's MET as words. */
export function intensityOf(kind: ExerciseKind, met: number): Intensity {
  const presets = INTENSITY_MET[kind];
  let best: Intensity = 'light';
  for (const level of INTENSITIES) {
    if (Math.abs(presets[level] - met) < Math.abs(presets[best] - met)) best = level;
  }
  return best;
}

/** MET of a new own exercise of that kind (moderate). */
export const defaultMet = (kind: ExerciseKind): number => INTENSITY_MET[kind].moderate;

export const DEFAULT_REST_SEC: Readonly<Record<ExerciseKind, number>> = {
  weight: 90,
  bodyweight: 60,
  time: 45,
  cardio: 0,
};

/** Weight stepper step: 1 kg for dumbbells and kettlebells, 2.5 kg otherwise. */
export const kgStep = (equipment: Equipment): number =>
  equipment === 'dumbbell' || equipment === 'kettlebell' ? 1 : 2.5;

const set = (over: Partial<SetValues>): SetValues => ({
  reps: null,
  kg: null,
  sec: null,
  min: null,
  km: null,
  ...over,
});

/** The values of a set of an exercise added without a plan or history. */
export const DEFAULT_SET: Readonly<Record<ExerciseKind, Readonly<SetValues>>> = {
  weight: set({ reps: 10 }),
  bodyweight: set({ reps: 12 }),
  time: set({ sec: 30 }),
  cardio: set({ min: 20 }),
};

/** Set count of an exercise added without a plan or history. */
export const DEFAULT_SET_COUNT: Readonly<Record<ExerciseKind, number>> = {
  weight: 3,
  bodyweight: 3,
  time: 3,
  cardio: 1,
};

/** The set fields an exercise kind uses (the others are always null). */
export const KIND_FIELDS: Readonly<Record<ExerciseKind, readonly (keyof SetValues)[]>> = {
  weight: ['reps', 'kg'],
  bodyweight: ['reps'],
  time: ['sec'],
  cardio: ['min', 'km'],
};
