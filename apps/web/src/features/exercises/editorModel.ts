/**
 * The own-exercise editor's draft and validation (docs/workouts-steps-rebrand.md §3.4). Pure.
 */
import {
  allExercises,
  INTENSITY_MET,
  intensityOf,
  LIMITS,
  type Equipment,
  type Exercise,
  type ExerciseKind,
  type Intensity,
  type MuscleId,
} from '@legko/shared';
import { normalizeText } from './libraryModel';

export interface ExerciseDraft {
  name: string;
  kind: ExerciseKind;
  primary: MuscleId[];
  secondary: MuscleId[];
  equipment: Equipment;
  intensity: Intensity;
}

export interface DraftErrors {
  name?: string;
  muscles?: string;
}

export const NAME_REQUIRED = 'Дай вправі назву';
export const NAME_TAKEN = 'Така вправа вже є';
export const PRIMARY_REQUIRED = 'Обери хоча б один основний мʼяз';
export const SAVE_FAILED = 'Не вдалося зберегти вправу. Спробуй ще раз.';

export const NAME_MAX = LIMITS.exerciseName;

/** A new exercise (name pre-filled from the search), or the one being edited. */
export function draftOf(exercise?: Exercise, initialName = ''): ExerciseDraft {
  if (exercise) {
    return {
      name: exercise.name,
      kind: exercise.kind,
      primary: [...exercise.primary],
      secondary: [...exercise.secondary],
      equipment: exercise.equipment,
      intensity: intensityOf(exercise.kind, exercise.met),
    };
  }
  return {
    name: initialName.trim().slice(0, NAME_MAX),
    kind: 'weight',
    primary: [],
    secondary: [],
    equipment: 'dumbbell',
    intensity: 'moderate',
  };
}

/**
 * Name required and unique among the library and her exercises (case-insensitive, the edited one aside); at least
 * one primary muscle unless the kind is cardio.
 */
export function validateDraft(draft: ExerciseDraft, own: readonly Exercise[], selfId?: string): DraftErrors {
  const errors: DraftErrors = {};
  const name = normalizeText(draft.name);
  if (!name) errors.name = NAME_REQUIRED;
  else if (allExercises(own).some((e) => e.id !== selfId && normalizeText(e.name) === name)) errors.name = NAME_TAKEN;
  if (draft.kind !== 'cardio' && draft.primary.length === 0) errors.muscles = PRIMARY_REQUIRED;
  return errors;
}

export const hasErrors = (errors: DraftErrors): boolean => errors.name !== undefined || errors.muscles !== undefined;

/** The exercise to save: trimmed name, MET from the intensity preset of the kind. */
export function exerciseFromDraft(draft: ExerciseDraft, id: string): Exercise {
  return {
    id,
    name: draft.name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX),
    kind: draft.kind,
    primary: [...draft.primary],
    secondary: draft.secondary.filter((m) => !draft.primary.includes(m)),
    equipment: draft.equipment,
    met: INTENSITY_MET[draft.kind][draft.intensity],
  };
}
