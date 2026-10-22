/**
 * The seed exercise library (docs/workouts-steps-rebrand.md §1.6): static code, ids `lib.<slug>` are a stable
 * contract (sessions snapshot what they used, so improving a row in a release never changes history). MET ≈
 * Compendium of Physical Activities 2024 (strength METs include the rests of a normal session).
 */
import { LIBRARY_ID_RE } from './schemas';
import type { Equipment, Exercise, ExerciseKind, MuscleId } from './types';

type Row = readonly [
  slug: string,
  name: string,
  kind: ExerciseKind,
  primary: readonly MuscleId[],
  secondary: readonly MuscleId[],
  equipment: Equipment,
  met: number,
];

const ROWS: readonly Row[] = [
  // legs and glutes
  ['back-squat', 'Присідання зі штангою', 'weight', ['quads', 'glutes'], ['hamstrings', 'adductors', 'lowerBack'], 'barbell', 5.0],
  ['goblet-squat', 'Гоблет-присідання', 'weight', ['quads', 'glutes'], ['adductors', 'abs'], 'dumbbell', 5.0],
  ['bodyweight-squat', 'Присідання', 'bodyweight', ['quads', 'glutes'], ['hamstrings', 'calves'], 'bodyweight', 5.0],
  ['sumo-squat', 'Сумо-присідання', 'weight', ['adductors', 'glutes', 'quads'], ['hamstrings'], 'dumbbell', 5.0],
  ['leg-press', 'Жим ногами', 'weight', ['quads', 'glutes'], ['hamstrings', 'adductors'], 'machine', 5.0],
  ['lunge', 'Випади', 'bodyweight', ['quads', 'glutes'], ['hamstrings', 'adductors', 'calves'], 'bodyweight', 4.0],
  ['dumbbell-lunge', 'Випади з гантелями', 'weight', ['quads', 'glutes'], ['hamstrings', 'adductors', 'calves'], 'dumbbell', 5.0],
  ['bulgarian-split-squat', 'Болгарські присідання', 'weight', ['quads', 'glutes'], ['hamstrings', 'adductors'], 'dumbbell', 5.0],
  ['step-up', 'Зашагування на платформу', 'weight', ['quads', 'glutes'], ['hamstrings', 'calves'], 'dumbbell', 5.0],
  ['romanian-deadlift', 'Румунська тяга', 'weight', ['hamstrings', 'glutes'], ['lowerBack', 'forearms'], 'barbell', 5.0],
  ['deadlift', 'Станова тяга', 'weight', ['hamstrings', 'glutes', 'lowerBack'], ['quads', 'traps', 'forearms'], 'barbell', 6.0],
  ['hip-thrust', 'Ягідний міст зі штангою', 'weight', ['glutes'], ['hamstrings'], 'barbell', 5.0],
  ['glute-bridge', 'Сідничний міст', 'bodyweight', ['glutes'], ['hamstrings', 'abs'], 'bodyweight', 3.5],
  ['cable-kickback', 'Відведення ноги назад у кросовері', 'weight', ['glutes'], ['hamstrings'], 'cable', 3.5],
  ['hip-abduction', 'Розведення ніг у тренажері', 'weight', ['glutes'], [], 'machine', 3.5],
  ['hip-adduction', 'Зведення ніг у тренажері', 'weight', ['adductors'], [], 'machine', 3.5],
  ['leg-extension', 'Розгинання ніг у тренажері', 'weight', ['quads'], [], 'machine', 3.5],
  ['leg-curl', 'Згинання ніг у тренажері', 'weight', ['hamstrings'], ['calves'], 'machine', 3.5],
  ['calf-raise', 'Підйоми на носки', 'weight', ['calves'], [], 'machine', 3.5],
  ['wall-sit', 'Стільчик біля стіни', 'time', ['quads'], ['glutes'], 'bodyweight', 3.5],
  // chest
  ['bench-press', 'Жим лежачи', 'weight', ['chest'], ['triceps', 'shoulders'], 'barbell', 5.0],
  ['dumbbell-bench-press', 'Жим гантелей лежачи', 'weight', ['chest'], ['triceps', 'shoulders'], 'dumbbell', 5.0],
  ['incline-dumbbell-press', 'Жим гантелей на похилій лаві', 'weight', ['chest', 'shoulders'], ['triceps'], 'dumbbell', 5.0],
  ['chest-fly', 'Розведення гантелей лежачи', 'weight', ['chest'], ['shoulders'], 'dumbbell', 3.5],
  ['pec-deck', 'Зведення рук у тренажері', 'weight', ['chest'], ['shoulders'], 'machine', 3.5],
  ['push-up', 'Віджимання', 'bodyweight', ['chest', 'triceps'], ['shoulders', 'abs'], 'bodyweight', 3.8],
  ['knee-push-up', 'Віджимання з колін', 'bodyweight', ['chest', 'triceps'], ['shoulders'], 'bodyweight', 3.5],
  // back
  ['lat-pulldown', 'Тяга верхнього блока', 'weight', ['lats'], ['biceps', 'traps', 'forearms'], 'cable', 3.5],
  ['seated-row', 'Тяга нижнього блока', 'weight', ['lats', 'traps'], ['biceps', 'lowerBack'], 'cable', 3.5],
  ['bent-over-row', 'Тяга штанги в нахилі', 'weight', ['lats', 'traps'], ['biceps', 'lowerBack', 'forearms'], 'barbell', 5.0],
  ['dumbbell-row', 'Тяга гантелі однією рукою', 'weight', ['lats'], ['biceps', 'traps'], 'dumbbell', 3.5],
  ['pull-up', 'Підтягування', 'bodyweight', ['lats'], ['biceps', 'forearms', 'traps'], 'bodyweight', 8.0],
  // The gravitron's counterweight helps rather than loads: tracked by reps.
  ['assisted-pull-up', 'Підтягування в гравітроні', 'bodyweight', ['lats'], ['biceps'], 'machine', 5.0],
  ['back-extension', 'Гіперекстензія', 'bodyweight', ['lowerBack'], ['glutes', 'hamstrings'], 'bodyweight', 3.5],
  ['face-pull', 'Тяга до обличчя', 'weight', ['shoulders', 'traps'], ['biceps'], 'cable', 3.5],
  ['shrug', 'Шраги з гантелями', 'weight', ['traps'], ['forearms'], 'dumbbell', 3.5],
  // shoulders
  ['overhead-press', 'Жим штанги стоячи', 'weight', ['shoulders'], ['triceps', 'traps', 'abs'], 'barbell', 5.0],
  ['dumbbell-shoulder-press', 'Жим гантелей сидячи', 'weight', ['shoulders'], ['triceps'], 'dumbbell', 5.0],
  ['lateral-raise', 'Махи гантелями в сторони', 'weight', ['shoulders'], ['traps'], 'dumbbell', 3.5],
  ['front-raise', 'Підйоми гантелей перед собою', 'weight', ['shoulders'], ['chest'], 'dumbbell', 3.5],
  ['rear-delt-fly', 'Розведення в нахилі', 'weight', ['shoulders'], ['traps'], 'dumbbell', 3.5],
  // arms
  ['biceps-curl', 'Згинання рук з гантелями', 'weight', ['biceps'], ['forearms'], 'dumbbell', 3.5],
  ['hammer-curl', 'Молоткові згинання', 'weight', ['biceps', 'forearms'], [], 'dumbbell', 3.5],
  ['barbell-curl', 'Згинання рук зі штангою', 'weight', ['biceps'], ['forearms'], 'barbell', 3.5],
  ['triceps-pushdown', 'Розгинання рук на блоці', 'weight', ['triceps'], [], 'cable', 3.5],
  ['overhead-triceps-extension', 'Французький жим з гантеллю', 'weight', ['triceps'], [], 'dumbbell', 3.5],
  ['bench-dip', 'Зворотні віджимання від лави', 'bodyweight', ['triceps'], ['chest', 'shoulders'], 'bodyweight', 3.8],
  // A band's pull is not measured in kg: tracked by reps.
  ['band-pull-apart', 'Розведення резинки', 'bodyweight', ['shoulders', 'traps'], [], 'band', 3.0],
  // core
  ['crunch', 'Скручування', 'bodyweight', ['abs'], [], 'bodyweight', 3.8],
  ['bicycle-crunch', 'Скручування «велосипед»', 'bodyweight', ['abs', 'obliques'], [], 'bodyweight', 3.8],
  ['leg-raise', 'Підйоми ніг лежачи', 'bodyweight', ['abs'], ['adductors'], 'bodyweight', 3.8],
  ['hanging-knee-raise', 'Підйоми колін у висі', 'bodyweight', ['abs'], ['forearms'], 'bodyweight', 3.8],
  ['russian-twist', 'Повороти корпусу сидячи', 'bodyweight', ['obliques'], ['abs'], 'bodyweight', 3.8],
  ['dead-bug', 'Мертвий жук', 'bodyweight', ['abs'], [], 'bodyweight', 3.0],
  ['plank', 'Планка', 'time', ['abs'], ['shoulders', 'obliques', 'lowerBack'], 'bodyweight', 3.0],
  ['side-plank', 'Бічна планка', 'time', ['obliques'], ['abs', 'shoulders'], 'bodyweight', 3.0],
  ['mountain-climber', 'Скелелаз', 'time', ['abs'], ['shoulders', 'quads'], 'bodyweight', 8.0],
  // full body
  ['burpee', 'Берпі', 'bodyweight', ['quads', 'chest'], ['shoulders', 'abs', 'triceps'], 'bodyweight', 8.0],
  ['jumping-jack', 'Стрибки «зірочка»', 'time', ['calves'], ['shoulders', 'quads', 'glutes'], 'bodyweight', 7.7],
  ['kettlebell-swing', 'Махи гирею', 'weight', ['glutes', 'hamstrings'], ['lowerBack', 'shoulders', 'abs'], 'kettlebell', 9.8],
  // cardio
  ['walk', 'Ходьба', 'cardio', ['calves', 'quads'], ['glutes', 'hamstrings'], 'other', 3.5],
  ['incline-walk', 'Ходьба під нахилом', 'cardio', ['glutes', 'calves'], ['quads', 'hamstrings'], 'cardio', 6.0],
  ['run', 'Біг', 'cardio', ['quads', 'calves'], ['glutes', 'hamstrings'], 'other', 8.3],
  ['stationary-bike', 'Велотренажер', 'cardio', ['quads'], ['glutes', 'calves', 'hamstrings'], 'cardio', 6.8],
  ['cycling', 'Їзда на велосипеді', 'cardio', ['quads'], ['glutes', 'calves', 'hamstrings'], 'other', 7.5],
  ['elliptical', 'Еліптичний тренажер', 'cardio', ['quads', 'glutes'], ['calves', 'hamstrings'], 'cardio', 5.0],
  ['rowing-machine', 'Гребний тренажер', 'cardio', ['lats', 'quads'], ['biceps', 'glutes', 'hamstrings', 'abs'], 'cardio', 7.0],
  ['stair-climber', 'Степер', 'cardio', ['glutes', 'quads'], ['calves', 'hamstrings'], 'cardio', 9.0],
  ['jump-rope', 'Скакалка', 'cardio', ['calves'], ['quads', 'shoulders'], 'other', 8.8],
  ['swimming', 'Плавання', 'cardio', ['lats', 'shoulders'], ['chest', 'triceps', 'quads'], 'other', 6.0],
  ['dance', 'Танці / аеробіка', 'cardio', ['quads', 'calves'], ['glutes'], 'other', 7.3],
];

const freezeExercise = ([slug, name, kind, primary, secondary, equipment, met]: Row): Readonly<Exercise> =>
  Object.freeze({
    id: `lib.${slug}`,
    name,
    kind,
    primary: Object.freeze([...primary]) as MuscleId[],
    secondary: Object.freeze([...secondary]) as MuscleId[],
    equipment,
    met,
  });

/** The seed library, frozen (rows and their muscle lists). */
export const EXERCISE_LIBRARY: readonly Readonly<Exercise>[] = Object.freeze(ROWS.map(freezeExercise));

const LIBRARY_BY_ID: ReadonlyMap<string, Readonly<Exercise>> = new Map(EXERCISE_LIBRARY.map((e) => [e.id, e]));

/** `lib.<slug>` (a seed id: never one of her own, which cannot contain a dot). */
export const isLibraryExerciseId = (id: string): boolean => LIBRARY_ID_RE.test(id);

/** A library or own exercise by id; undefined when gone (a deleted own one, an unknown seed id). */
export function findExercise(own: readonly Exercise[], id: string): Exercise | undefined {
  if (isLibraryExerciseId(id)) return LIBRARY_BY_ID.get(id);
  return own.find((e) => e.id === id);
}

/** The library, then her own exercises (the UI sorts each with `localeCompare(…, 'uk')`). */
export const allExercises = (own: readonly Exercise[]): Exercise[] => [...EXERCISE_LIBRARY, ...own];

/**
 * Activities a phone step counter already counts: their kcal is left out of the day's total when the day has
 * steps (`dayBurned`), so a logged walk is not counted twice.
 */
export const STEP_COUNTED_EXERCISES: readonly string[] = Object.freeze(['lib.walk', 'lib.incline-walk', 'lib.run']);
