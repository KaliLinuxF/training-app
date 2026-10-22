/**
 * Test-only fixtures of the exercises feature (imported by `*.test.ts(x)` only).
 */
import {
  emptyData,
  findExercise,
  type AppData,
  type Exercise,
  type ISODate,
  type SessionExercise,
  type SessionSet,
  type Workout,
  type WorkoutSession,
} from '@legko/shared';

export const TODAY: ISODate = '2026-10-14';

export const STEP: Exercise = {
  id: 'ownExercise01',
  name: 'Степ-аеробіка',
  kind: 'cardio',
  primary: ['quads'],
  secondary: ['calves'],
  equipment: 'other',
  met: 7,
};

export const set = (patch: Partial<SessionSet>): SessionSet => ({
  reps: null,
  kg: null,
  sec: null,
  min: null,
  km: null,
  done: true,
  ...patch,
});

/** A session exercise snapshot of a library / own exercise. */
export function entry(exerciseId: string, sets: SessionSet[], own: Exercise[] = [STEP], patch: Partial<SessionExercise> = {}): SessionExercise {
  const ex = findExercise(own, exerciseId);
  if (!ex) throw new Error(`unknown exercise ${exerciseId}`);
  return {
    key: `${exerciseId}-k`,
    exerciseId,
    name: ex.name,
    kind: ex.kind,
    met: ex.met,
    equipment: ex.equipment,
    primary: [...ex.primary],
    secondary: [...ex.secondary],
    restSec: 90,
    skipped: false,
    sets,
    ...patch,
  };
}

let seq = 0;
export function session(date: ISODate, exercises: SessionExercise[], patch: Partial<WorkoutSession> = {}): WorkoutSession {
  seq += 1;
  return {
    id: `session${String(seq).padStart(6, '0')}`,
    date,
    workoutId: 'workoutLegs01',
    name: 'Ноги + прес',
    createdAt: new Date(`${date}T18:00:00`).getTime(),
    startedAt: null,
    finishedAt: null,
    durationSec: 3000,
    status: 'done',
    exercises,
    notes: '',
    rev: 1,
    deviceId: null,
    ...patch,
  };
}

const squat = (kg: number, done = true) => [12, 12, 12].map((reps) => set({ reps, kg, done }));

export const LEGS: Workout = {
  id: 'workoutLegs01',
  name: 'Ноги + прес',
  days: [1, 3],
  items: [
    { key: 'item1', exerciseId: 'lib.back-squat', sets: [{ reps: 12, kg: 40, sec: null, min: null, km: null }], restSec: 90 },
    { key: 'item2', exerciseId: STEP.id, sets: [{ reps: null, kg: null, sec: null, min: 20, km: null }], restSec: 0 },
  ],
};

export const UPPER: Workout = {
  id: 'workoutUpper1',
  name: 'Верх тіла',
  days: [5],
  items: [{ key: 'item1', exerciseId: STEP.id, sets: [{ reps: null, kg: null, sec: null, min: 15, km: null }], restSec: 0 }],
};

/** Squat 35 → 37,5 → 40 kg (12 Oct, every set done), a step session with minutes only, one active session. */
export function trainingData(): AppData {
  const data = emptyData();
  data.settings.onboarded = true;
  data.exercises = [STEP];
  data.workouts = [LEGS, UPPER];
  data.sessions = [
    session('2026-09-30', [entry('lib.back-squat', squat(35))]),
    session('2026-10-05', [entry('lib.back-squat', squat(37.5)), entry(STEP.id, [set({ min: 20 })])]),
    session('2026-10-07', [entry('lib.back-squat', squat(35))]),
    session('2026-10-12', [entry('lib.back-squat', squat(40)), entry(STEP.id, [set({ min: 25 })])]),
    session('2026-10-14', [entry('lib.back-squat', squat(45, false))], { status: 'active', startedAt: Date.now() }),
  ];
  return data;
}
