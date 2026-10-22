import {
  applyOps,
  findExercise,
  MAX_SESSION_SEC,
  opSchema,
  type AppData,
  type Op,
  type Workout,
  type WorkoutSession,
} from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as SyncModule from './sync';
import { sampleData } from './test-utils';

/** The data actions of workouts and steps (docs/workouts-steps-rebrand.md §1.3.1): what each one commits. */

const committed = vi.hoisted(() => ({ batches: [] as Op[][] }));

vi.mock('./sync', async (importOriginal) => {
  const actual = await importOriginal<typeof SyncModule>();
  const { useDataStore } = await import('./state');
  return {
    ...actual,
    // Same contract as the real one: all or nothing, validated, applied with the shared reducer.
    commitOps: (ops: readonly Op[]): boolean => {
      if (!ops.every((op) => opSchema.safeParse(op).success)) return false;
      const parsed = ops.map((op) => opSchema.parse(op));
      committed.batches.push(parsed);
      useDataStore.setState((s) => ({ data: applyOps(s.data, parsed) }));
      return true;
    },
  };
});

const { dataActions, deviceId, getAppData, newId, newMealId, useDataStore } = await import('./data');

const TODAY = '2026-10-14';
const T = new Date(2026, 9, 14, 18, 0).getTime();
const last = (): Op[] => committed.batches.at(-1) ?? [];

const legs: Workout = {
  id: 'workout00001',
  name: 'Ноги + прес',
  days: [1, 3],
  items: [
    { key: 'item1', exerciseId: 'lib.back-squat', sets: [{ reps: 12, kg: 40, sec: null, min: null, km: null }], restSec: 90 },
    { key: 'item2', exerciseId: 'ownExercise01', sets: [{ reps: null, kg: null, sec: null, min: 20, km: null }], restSec: 0 },
  ],
};
const own = {
  id: 'ownExercise01',
  name: 'Степ-аеробіка',
  kind: 'cardio' as const,
  primary: ['quads' as const],
  secondary: [],
  equipment: 'other' as const,
  met: 7,
};

function seed(patch: Partial<AppData> = {}): void {
  const data = sampleData(patch);
  data.settings.rem.workout.days = [1, 5];
  useDataStore.setState({ data });
}

beforeEach(() => {
  committed.batches = [];
  localStorage.clear();
  seed({ exercises: [own], workouts: [legs] });
});
afterEach(() => vi.restoreAllMocks());

describe('ids', () => {
  it('newId is 12 base64url characters like newMealId; deviceId is stable in localStorage', () => {
    expect(newId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(newMealId()).toMatch(/^[A-Za-z0-9_-]{12}$/);
    const id = deviceId();
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(deviceId()).toBe(id);
    expect(localStorage.getItem('legko.deviceId')).toBe(id);
  });

  it('deviceId falls back to a per-tab id when storage throws', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const a = deviceId();
    expect(a).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(deviceId()).toBe(a);
  });
});

describe('exercises and workouts', () => {
  it('saveExercise commits exercise.put; a lib.* id is refused', () => {
    expect(dataActions.saveExercise({ ...own, name: 'Степ' })).toBe(true);
    expect(last()).toEqual([{ kind: 'exercise.put', value: { ...own, name: 'Степ' } }]);
    expect(dataActions.saveExercise({ ...own, id: 'lib.plank' })).toBe(false);
    expect(committed.batches).toHaveLength(1);
  });

  it('a new 301st exercise is refused, an edit is not', () => {
    const many = Array.from({ length: 300 }, (_, i) => ({ ...own, id: `ownExercise${String(i).padStart(3, '0')}x` }));
    seed({ exercises: many });
    expect(dataActions.saveExercise({ ...own, id: 'brandNewOne01' })).toBe(false);
    expect(dataActions.saveExercise({ ...many[0]!, name: 'Інша' })).toBe(true);
  });

  it('deleteExercise cascades into every workout that used it, in one commit', () => {
    const other: Workout = { ...legs, id: 'workout00002', name: 'Без неї', items: [legs.items[0]!] };
    seed({ exercises: [own], workouts: [legs, other] });
    expect(dataActions.deleteExercise(own.id)).toBe(true);
    expect(last()).toEqual([
      { kind: 'exercise.delete', id: own.id },
      { kind: 'workout.put', value: { ...legs, items: [legs.items[0]] } },
    ]);
    expect(getAppData().workouts[0]?.items.map((i) => i.exerciseId)).toEqual(['lib.back-squat']);
  });

  it('saveWorkout adds its days to the plan (Monday-first union); removing days never removes plan days', () => {
    expect(dataActions.saveWorkout({ ...legs, days: [3, 0] })).toBe(true);
    const [put, settings] = last();
    expect(put).toMatchObject({ kind: 'workout.put' });
    expect(settings).toMatchObject({ kind: 'settings.put', value: { rem: { workout: { days: [1, 3, 5, 0] } } } });
    expect(getAppData().settings.rem.workout.days).toEqual([1, 3, 5, 0]);
    // Days already in the plan: no settings.put.
    expect(dataActions.saveWorkout({ ...legs, days: [1] })).toBe(true);
    expect(last().map((op) => op.kind)).toEqual(['workout.put']);
    expect(getAppData().settings.rem.workout.days).toEqual([1, 3, 5, 0]);
  });

  it('deleteWorkout commits only workout.delete', () => {
    expect(dataActions.deleteWorkout(legs.id)).toBe(true);
    expect(last()).toEqual([{ kind: 'workout.delete', id: legs.id }]);
    expect(getAppData().settings.rem.workout.days).toEqual([1, 5]);
  });
});

describe('sessions', () => {
  it('startSession commits an active put (rev 0, this device) prefilled from the plan; a second call commits nothing', () => {
    const id = dataActions.startSession(TODAY, legs.id, T);
    expect(id).toMatch(/^[A-Za-z0-9_-]{12}$/);
    expect(committed.batches).toHaveLength(1);
    const [op] = last();
    expect(op?.kind).toBe('session.put');
    const s = (op as Extract<Op, { kind: 'session.put' }>).value;
    expect(s).toMatchObject({ id, date: TODAY, status: 'active', startedAt: T, rev: 0, deviceId: deviceId() });
    expect(s.exercises.map((e) => e.exerciseId)).toEqual(['lib.back-squat', 'ownExercise01']);
    expect(s.exercises[0]?.sets[0]).toMatchObject({ reps: 12, kg: 40, done: false });

    expect(dataActions.startSession(TODAY, null, T + 1000)).toBe(id);
    expect(committed.batches).toHaveLength(1);
  });

  it('startSession refuses an unknown workout', () => {
    expect(dataActions.startSession(TODAY, 'nopeWorkout01', T)).toBeNull();
    expect(committed.batches).toHaveLength(0);
  });

  it('draftSession is not committed: done, every set done, no start', () => {
    const d = dataActions.draftSession('2026-10-12', legs.id, T);
    expect(committed.batches).toHaveLength(0);
    expect(d).toMatchObject({ status: 'done', startedAt: null, finishedAt: null, date: '2026-10-12' });
    expect(d.exercises.every((e) => e.sets.every((x) => x.done))).toBe(true);
    expect(dataActions.draftSession('2026-10-12', null, T).name).toBe('Вільне тренування');
  });

  const started = (): WorkoutSession => {
    const id = dataActions.startSession(TODAY, legs.id, T) as string;
    return getAppData().sessions.find((s) => s.id === id) as WorkoutSession;
  };

  it('saveSession sends the stored rev + 1', () => {
    const s = started();
    const edited = { ...s, exercises: s.exercises.map((e, i) => (i ? e : { ...e, sets: e.sets.map((x) => ({ ...x, done: true })) })) };
    expect(dataActions.saveSession(edited)).toBe(true);
    expect(last()[0]).toMatchObject({ kind: 'session.put', value: { rev: 1 } });
    expect(dataActions.saveSession({ ...edited, rev: 0 })).toBe(true);
    expect(getAppData().sessions[0]?.rev).toBe(2);
  });

  it('takeOverSession: this device becomes the writer, rev + 1', () => {
    const s = started();
    useDataStore.setState((st) => ({ data: { ...st.data, sessions: [{ ...s, deviceId: 'otherDevice01' }] } }));
    expect(dataActions.takeOverSession(s.id)).toBe(true);
    expect(last()[0]).toMatchObject({ value: { deviceId: deviceId(), rev: 1 } });
    expect(dataActions.takeOverSession('missingSess01')).toBe(false);
  });

  it('finishSession: done, elapsed duration, no writer; the day is marked trained with merged types', () => {
    seed({
      exercises: [own],
      workouts: [legs],
      days: { [TODAY]: { food: '', kcal: null, trained: true, types: ['Розтяжка'], notes: 'добре' } },
    });
    const s = started();
    const done = { ...s, exercises: [{ ...s.exercises[0]!, sets: s.exercises[0]!.sets.map((x) => ({ ...x, done: true })) }, s.exercises[1]!] };
    dataActions.saveSession(done);
    const at = T + 48 * 60_000 + 400;
    expect(dataActions.finishSession(s.id, at)).toBe(true);
    const [put, meta] = last();
    expect(put).toMatchObject({
      kind: 'session.put',
      value: { status: 'done', finishedAt: at, durationSec: 2880, deviceId: null, rev: 2 },
    });
    expect(meta).toEqual({ kind: 'day.meta', date: TODAY, value: { trained: true, types: ['Розтяжка', 'Низ тіла'] } });
    expect(getAppData().days[TODAY]).toMatchObject({ trained: true, notes: 'добре' });
    // Finishing twice is refused.
    expect(dataActions.finishSession(s.id, at)).toBe(false);
  });

  it('started 23:50, finished 00:20 the next day: 30 min on its own date', () => {
    const start = new Date(2026, 9, 14, 23, 50).getTime();
    const id = dataActions.startSession(TODAY, null, start) as string;
    expect(dataActions.finishSession(id, start + 30 * 60_000)).toBe(true);
    expect(last()[0]).toMatchObject({ value: { date: TODAY, durationSec: 1800 } });
    expect(last()[1]).toMatchObject({ kind: 'day.meta', date: TODAY });
  });

  it('a start in the future (clock skew) finishes with 0 s, not a refused op; a stale one with null', () => {
    const id = dataActions.startSession(TODAY, null, T + 60_000) as string;
    expect(dataActions.finishSession(id, T)).toBe(true);
    expect(last()[0]).toMatchObject({ value: { durationSec: 0 } });

    const stale = dataActions.startSession(TODAY, null, T) as string;
    expect(dataActions.finishSession(stale, T + MAX_SESSION_SEC * 1000 + 1)).toBe(true);
    expect(last()[0]).toMatchObject({ value: { status: 'done', durationSec: null } });
  });

  it('saveDoneSession: rev + 1 and the day.meta; deleteSession: only session.delete; a deleted id stays deleted', () => {
    const draft = dataActions.draftSession('2026-10-12', legs.id, T);
    expect(dataActions.saveDoneSession({ ...draft, durationSec: 2700 })).toBe(true);
    expect(last()[0]).toMatchObject({ kind: 'session.put', value: { rev: 1, status: 'done', durationSec: 2700 } });
    expect(last()[1]).toMatchObject({ kind: 'day.meta', date: '2026-10-12', value: { trained: true } });
    expect(dataActions.deleteSession(draft.id)).toBe(true);
    expect(last()).toEqual([{ kind: 'session.delete', id: draft.id }]);
    expect(getAppData().days['2026-10-12']?.trained).toBe(true);
    expect(dataActions.saveDoneSession(draft)).toBe(false);
  });

  it('an active save over a finished session is refused (it is never reopened)', () => {
    const s = started();
    dataActions.finishSession(s.id, T + 60_000);
    expect(dataActions.saveSession({ ...s, status: 'active' })).toBe(false);
    expect(getAppData().sessions[0]?.status).toBe('done');
  });

  it('the prefill uses last time: the library squat at 40 kg from a done session', () => {
    expect(findExercise([], 'lib.back-squat')).toBeDefined();
    const draft = dataActions.draftSession('2026-10-12', legs.id, T);
    const prev = { ...draft, exercises: [{ ...draft.exercises[0]!, sets: draft.exercises[0]!.sets.map((x) => ({ ...x, kg: 42.5 })) }] };
    dataActions.saveDoneSession(prev);
    const id = dataActions.startSession(TODAY, legs.id, T) as string;
    const live = getAppData().sessions.find((x) => x.id === id);
    expect(live?.exercises[0]?.sets[0]).toMatchObject({ kg: 42.5, done: false });
  });
});

describe('steps', () => {
  it('setSteps puts, and null or 0 deletes; out of range is refused', () => {
    expect(dataActions.setSteps(TODAY, 8400)).toBe(true);
    expect(last()).toEqual([{ kind: 'steps.put', date: TODAY, steps: 8400 }]);
    expect(getAppData().steps).toEqual([{ date: TODAY, steps: 8400 }]);
    expect(dataActions.setSteps(TODAY, 0)).toBe(true);
    expect(last()).toEqual([{ kind: 'steps.delete', date: TODAY }]);
    expect(dataActions.setSteps(TODAY, null)).toBe(true);
    expect(dataActions.setSteps(TODAY, 100_001)).toBe(false);
    expect(dataActions.setSteps(TODAY, 12.5)).toBe(false);
    expect(getAppData().steps).toEqual([]);
  });
});
