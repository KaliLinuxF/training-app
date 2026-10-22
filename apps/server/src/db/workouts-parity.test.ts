import {
  applyOps,
  emptyData,
  opSchema,
  type AppData,
  type Exercise,
  type Op,
  type Weekday,
  type WorkoutSession,
} from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Logger } from '../logger';
import { createDataRepos, type DataRepo } from './data';
import { openDatabase } from './open';
import type { Database } from './sqlite';
import { createUserRepo } from './users';

/**
 * The server's row path for exercises / workouts / sessions / steps equals the shared reducers (`applyOp`) for any op
 * sequence, in any batching (docs/workouts-steps-rebrand.md §1.3, §1.8, W13).
 */

const pick = <K extends keyof AppData>(data: AppData, keys: readonly K[]): Pick<AppData, K> =>
  Object.fromEntries(keys.map((k) => [k, data[k]])) as Pick<AppData, K>;
const KEYS = ['exercises', 'workouts', 'sessions', 'steps', 'deletedSessions'] as const;

/** Deterministic PRNG (mulberry32). */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const session = (over: Partial<WorkoutSession>): WorkoutSession => ({
  id: 'session00001',
  date: '2026-10-12',
  workoutId: null,
  name: 'Вільне тренування',
  createdAt: 1,
  startedAt: null,
  finishedAt: null,
  durationSec: null,
  status: 'done',
  exercises: [],
  notes: '',
  rev: 0,
  deviceId: null,
  ...over,
});

const exercise = (n: number, name: string): Exercise => ({
  id: `ownExercise${String(n).padStart(2, '0')}`,
  name,
  kind: n % 2 ? 'cardio' : 'weight',
  primary: ['quads'],
  secondary: ['glutes', 'quads'],
  equipment: 'other',
  met: 4 + n / 10,
});

function randomOp(r: () => number): Op {
  const int = (n: number) => Math.floor(r() * n);
  const date = `2026-10-1${int(3)}`;
  switch (int(8)) {
    case 0:
      return { kind: 'exercise.put', value: exercise(int(4), `  Вправа   ${int(9)} `) };
    case 1:
      return { kind: 'exercise.delete', id: exercise(int(4), 'x').id };
    case 2:
      return {
        kind: 'workout.put',
        value: {
          id: `workout0000${int(3)}`,
          name: `Тренування ${int(9)}`,
          days: [int(7), int(7)].filter((d, i, a) => a.indexOf(d) === i) as Weekday[],
          items: [
            {
              key: 'item1',
              exerciseId: 'lib.plank',
              sets: [{ reps: 5, kg: null, sec: 30 + int(5), min: null, km: null }],
              restSec: 45,
            },
          ],
        },
      };
    case 3:
      return { kind: 'workout.delete', id: `workout0000${int(3)}` };
    case 4:
    case 5: {
      const status = r() < 0.5 ? 'active' : 'done';
      return {
        kind: 'session.put',
        value: session({
          id: `session000${String(int(14)).padStart(2, '0')}`,
          date,
          createdAt: int(5),
          status,
          startedAt: status === 'active' ? 100 : null,
          rev: int(4),
          name: `Сесія ${int(9)}`,
          exercises: [
            {
              key: 'ex01',
              exerciseId: 'lib.back-squat',
              name: 'Присідання зі штангою',
              kind: 'weight',
              met: 5,
              equipment: 'barbell',
              primary: ['quads'],
              secondary: [],
              restSec: 90,
              skipped: false,
              sets: [{ reps: 10, kg: 40 + int(3) * 2.5, sec: null, min: null, km: null, done: r() < 0.5 }],
            },
          ],
        }),
      };
    }
    case 6:
      return { kind: 'session.delete', id: `session000${String(int(14)).padStart(2, '0')}` };
    default:
      return r() < 0.7 ? { kind: 'steps.put', date, steps: 1000 + int(9000) } : { kind: 'steps.delete', date };
  }
}

let db: Database;
let repo: DataRepo;
beforeEach(() => {
  db = openDatabase(':memory:');
  const id = createUserRepo(db).create({ username: 'anna', role: 'user', passwordHash: null, now: 0 }).id;
  repo = createDataRepos(db, () => 1).forUser(id);
});
afterEach(() => db.close());

/** Validated like the ops route does. */
const valid = (ops: readonly Op[]): Op[] => ops.map((op) => opSchema.parse(op));

describe('repo parity with applyOp (workouts and steps)', () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8])('random sequence %i, applied in random batches', (seed) => {
    const r = rng(seed);
    const ops = valid(Array.from({ length: 120 }, () => randomOp(r)));
    let i = 0;
    while (i < ops.length) {
      const size = 1 + Math.floor(r() * 9);
      repo.apply(ops.slice(i, i + size));
      i += size;
    }
    expect(pick(repo.read(), KEYS)).toEqual(pick(applyOps(emptyData(), ops), KEYS));
    // Replaying the whole sequence changes nothing (idempotent on both sides).
    repo.apply(ops);
    expect(pick(repo.read(), KEYS)).toEqual(pick(applyOps(applyOps(emptyData(), ops), ops), KEYS));
  });

  it('W13: [put active r3, put done r4, put active r3] stays done r4', () => {
    const active = session({ status: 'active', rev: 3, startedAt: 5 });
    const done = session({ status: 'done', rev: 4, finishedAt: 9, durationSec: 4 });
    const ops = valid([
      { kind: 'session.put', value: active },
      { kind: 'session.put', value: done },
      { kind: 'session.put', value: active },
    ]);
    for (const op of ops) repo.apply([op]);
    expect(repo.read().sessions).toEqual([done]);
    expect(pick(repo.read(), KEYS)).toEqual(pick(applyOps(emptyData(), ops), KEYS));
  });

  it('W13: [put, delete, put] stays deleted; the tombstone keeps the date', () => {
    const s = session({ rev: 0 });
    const ops = valid([
      { kind: 'session.put', value: s },
      { kind: 'session.delete', id: s.id },
      { kind: 'session.put', value: { ...s, rev: 5 } },
    ]);
    repo.apply(ops);
    expect(repo.read()).toMatchObject({ sessions: [], deletedSessions: [s.id] });
    expect(db.prepare('SELECT date, status, value FROM workout_sessions').all().map((x) => ({ ...x }))).toEqual([
      { date: '2026-10-12', status: 'deleted', value: '{}' },
    ]);
    expect(repo.isDone('workout', '2026-10-12')).toBe(false);
  });

  it('a new 11th session on a date is ignored; tombstones do not count toward the 10', () => {
    const ops: Op[] = [];
    for (let i = 0; i < 10; i++) ops.push({ kind: 'session.put', value: session({ id: `session000${String(i).padStart(2, '0')}` }) });
    ops.push({ kind: 'session.put', value: session({ id: 'session00010' }) });
    repo.apply(valid(ops));
    expect(repo.read().sessions).toHaveLength(10);
    repo.apply(valid([{ kind: 'session.delete', id: 'session00000' }, { kind: 'session.put', value: session({ id: 'session00010' }) }]));
    expect(repo.read().sessions.map((s) => s.id)).toContain('session00010');
    expect(repo.read().sessions).toHaveLength(10);
  });

  it('a stored row with unusable JSON is skipped with a content-free warning', () => {
    const lines: string[] = [];
    const logger: Logger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (line: string) => void lines.push(line),
      error: () => undefined,
    };
    const id = createUserRepo(db).create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
    db.prepare(
      "INSERT INTO workout_sessions (user_id, id, date, status, value, updated_at) VALUES (?, 'brokenSession1', '2026-10-12', 'done', '{\"name\":\"Секрет\"}', 1)",
    ).run(id);
    const data = createDataRepos(db, () => 1, logger).forUser(id).read();
    expect(data.sessions).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('Секрет');
  });
});
