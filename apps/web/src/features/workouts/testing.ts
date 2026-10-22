/**
 * Test-only fixtures of the workouts feature (imported by `*.test.ts(x)` only).
 */
import {
  emptyData,
  findExercise,
  type AppData,
  type ISODate,
  type SessionExercise,
  type SessionSet,
  type Workout,
  type WorkoutSession,
} from '@legko/shared';

/** Wednesday — «Ноги + прес» (Пн, Ср) is scheduled. */
export const TODAY: ISODate = '2026-10-14';
/** 10:00 local on TODAY. */
export const NOW = new Date(`${TODAY}T10:00:00`).getTime();
export const DEVICE = 'thisDevice0001';

export const set = (patch: Partial<SessionSet> = {}): SessionSet => ({
  reps: null,
  kg: null,
  sec: null,
  min: null,
  km: null,
  done: false,
  ...patch,
});

/** A session entry of a library exercise. */
export function entry(
  exerciseId: string,
  sets: SessionSet[],
  patch: Partial<SessionExercise> = {},
): SessionExercise {
  const ex = findExercise([], exerciseId);
  if (!ex) throw new Error(`unknown exercise ${exerciseId}`);
  return {
    key: `${exerciseId.slice(4)}-key`,
    exerciseId,
    name: ex.name,
    kind: ex.kind,
    met: ex.met,
    equipment: ex.equipment,
    primary: [...ex.primary],
    secondary: [...ex.secondary],
    restSec: ex.kind === 'cardio' ? 0 : 90,
    skipped: false,
    sets,
    ...patch,
  };
}

export function session(patch: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'session00000001',
    date: TODAY,
    workoutId: LEGS.id,
    name: 'Ноги + прес',
    createdAt: NOW,
    startedAt: NOW,
    finishedAt: null,
    durationSec: null,
    status: 'active',
    exercises: [
      entry('lib.back-squat', [
        set({ reps: 12, kg: 40 }),
        set({ reps: 12, kg: 40 }),
        set({ reps: 12, kg: 40 }),
      ]),
      entry('lib.crunch', [set({ reps: 20 }), set({ reps: 20 })], { restSec: 60 }),
    ],
    notes: '',
    rev: 0,
    deviceId: DEVICE,
    ...patch,
  };
}

export const LEGS: Workout = {
  id: 'workoutLegs0001',
  name: 'Ноги + прес',
  days: [1, 3],
  items: [
    {
      key: 'item0001',
      exerciseId: 'lib.back-squat',
      sets: [{ reps: 12, kg: 40, sec: null, min: null, km: null }],
      restSec: 90,
    },
    {
      key: 'item0002',
      exerciseId: 'lib.crunch',
      sets: [{ reps: 20, kg: null, sec: null, min: null, km: null }],
      restSec: 60,
    },
  ],
};

export const UPPER: Workout = {
  id: 'workoutUpper001',
  name: 'Верх тіла',
  days: [5],
  items: [
    {
      key: 'item0003',
      exerciseId: 'lib.biceps-curl',
      sets: [{ reps: 12, kg: 6, sec: null, min: null, km: null }],
      restSec: 60,
    },
  ],
};

/** A done «Ноги + прес» two days before TODAY: squat 3 × 12 × 40 kg every set done (the hint shows). */
export function doneLegs(patch: Partial<WorkoutSession> = {}): WorkoutSession {
  return session({
    id: 'sessionDone0001',
    date: '2026-10-12',
    createdAt: NOW - 2 * 86_400_000,
    startedAt: NOW - 2 * 86_400_000,
    finishedAt: NOW - 2 * 86_400_000 + 2_880_000,
    durationSec: 2880,
    status: 'done',
    rev: 2,
    deviceId: null,
    exercises: [
      entry(
        'lib.back-squat',
        [1, 2, 3].map(() => set({ reps: 12, kg: 40, done: true })),
      ),
      entry(
        'lib.crunch',
        [1, 2].map(() => set({ reps: 20, done: true })),
        { restSec: 60 },
      ),
    ],
    ...patch,
  });
}

/** Onboarded, two workouts, one done session, a weigh-in of 65 kg. */
export function trainingData(): AppData {
  const data = emptyData();
  data.settings.onboarded = true;
  data.workouts = [structuredClone(LEGS), structuredClone(UPPER)];
  data.sessions = [doneLegs()];
  data.weights = [{ date: '2026-10-10', kg: 65 }];
  data.settings.rem.workout = { on: true, days: [1, 3], time: '18:00' };
  return data;
}
