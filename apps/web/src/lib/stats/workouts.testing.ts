/**
 * Test builders for workouts, sessions and steps (unit tests only, never imported by app code). Values mirror the
 * shared library: «Присідання зі штангою» `lib.back-squat` (weight, MET 5), «Планка» `lib.plank` (time), «Ходьба»
 * `lib.walk` (cardio).
 */
import type {
  SessionExercise,
  SessionSet,
  SetValues,
  Workout,
  WorkoutItem,
  WorkoutSession,
} from '@legko/shared';

export const set = (over: Partial<SessionSet> = {}): SessionSet => ({
  reps: null,
  kg: null,
  sec: null,
  min: null,
  km: null,
  done: true,
  ...over,
});

export const planned = (over: Partial<SetValues> = {}): SetValues => ({
  reps: null,
  kg: null,
  sec: null,
  min: null,
  km: null,
  ...over,
});

/** Squats, 3 × 12 × 40 kg, all done. */
export function squat(over: Partial<SessionExercise> = {}): SessionExercise {
  return {
    key: 'k-squat',
    exerciseId: 'lib.back-squat',
    name: 'Присідання зі штангою',
    kind: 'weight',
    met: 5,
    equipment: 'barbell',
    primary: ['quads', 'glutes'],
    secondary: ['hamstrings'],
    restSec: 90,
    skipped: false,
    sets: [set({ reps: 12, kg: 40 }), set({ reps: 12, kg: 40 }), set({ reps: 12, kg: 40 })],
    ...over,
  };
}

/** A 40-minute walk. */
export function walk(over: Partial<SessionExercise> = {}): SessionExercise {
  return {
    key: 'k-walk',
    exerciseId: 'lib.walk',
    name: 'Ходьба',
    kind: 'cardio',
    met: 3.5,
    equipment: 'cardio',
    primary: ['quads'],
    secondary: [],
    restSec: 0,
    skipped: false,
    sets: [set({ min: 40 })],
    ...over,
  };
}

let seq = 0;

/** A done session (48 min) of «Ноги + прес» with squats; `over` replaces any field. */
export function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
  seq += 1;
  return {
    id: `session${String(seq).padStart(6, '0')}`,
    date: '2026-10-14',
    workoutId: 'workoutLegs01',
    name: 'Ноги + прес',
    createdAt: Date.UTC(2026, 9, 14, 7) + seq,
    startedAt: null,
    finishedAt: null,
    durationSec: 48 * 60,
    status: 'done',
    exercises: [squat()],
    notes: '',
    rev: 1,
    deviceId: null,
    ...over,
  };
}

export const item = (exerciseId: string, sets: SetValues[], restSec = 90, key = exerciseId): WorkoutItem => ({
  key,
  exerciseId,
  sets,
  restSec,
});

/** «Ноги + прес» on Mon / Wed: squats 3 × 12 × 40 and a plank 3 × 45 s. */
export function workout(over: Partial<Workout> = {}): Workout {
  return {
    id: 'workoutLegs01',
    name: 'Ноги + прес',
    days: [1, 3],
    items: [
      item('lib.back-squat', [planned({ reps: 12, kg: 40 }), planned({ reps: 12, kg: 40 }), planned({ reps: 12, kg: 40 })]),
      item('lib.plank', [planned({ sec: 45 }), planned({ sec: 45 }), planned({ sec: 45 })], 60),
    ],
    ...over,
  };
}
