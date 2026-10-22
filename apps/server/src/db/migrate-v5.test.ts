import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings, type Op, type WorkoutSession } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { preMigrationBackupName } from '../backup';
import { createDataRepos } from './data';
import { downgradeSchemaV4, downgradeSchemaV5, DowngradeRefused } from './downgrade';
import { migrate, MIGRATIONS, schemaVersion } from './migrations';
import { openDatabase } from './open';
import { sqlite, type Database, type Row } from './sqlite';
import { createUserRepo, type UserId } from './users';

/** Schema v5 (docs/workouts-steps-rebrand.md §1.8): additive tables, the pre-v5 snapshot, the v5 → v4 downgrade. */

const V4_TABLES = [
  'kv',
  'users',
  'sessions',
  'days',
  'weights',
  'measures',
  'foods',
  'photos',
  'push_subscriptions',
  'reminder_log',
  'user_settings',
  'ai_usage',
  'invites',
  'password_resets',
] as const;
const V5_TABLES = ['exercises', 'workouts', 'workout_sessions', 'steps'] as const;
const DATE = '2026-10-22';
const now = () => new Date('2026-10-22T09:00:00Z');

const V4_OPS: Op[] = [
  { kind: 'day.meta', date: '2026-10-12', value: { trained: true, types: ['Низ тіла'], notes: 'ноги' } },
  {
    kind: 'meal.put',
    date: '2026-10-12',
    value: { id: 'breakfast001', type: 'Сніданок', time: '08:30', text: 'Тост', kcal: 420, protein: 27, fat: null, carbs: 36 },
  },
  { kind: 'weight.put', date: '2026-10-12', kg: 66.4 },
  { kind: 'measure.put', date: '2026-10-12', value: { chest: 90, waist: 70, hips: 98 } },
  { kind: 'food.use', date: '2026-10-12', value: { name: 'Тост', portion: '2 шт', kcal: 420 } },
  { kind: 'settings.put', value: { ...defaultSettings(), goal: 58, onboarded: true } },
];

const session = (over: Partial<WorkoutSession> = {}): WorkoutSession => ({
  id: 'session00001',
  date: '2026-10-12',
  workoutId: null,
  name: 'Вільне тренування',
  createdAt: 1,
  startedAt: null,
  finishedAt: null,
  durationSec: 1800,
  status: 'done',
  exercises: [],
  notes: '',
  rev: 0,
  deviceId: null,
  ...over,
});

const V5_OPS: Op[] = [
  {
    kind: 'exercise.put',
    value: { id: 'ownExercise01', name: 'Степ', kind: 'cardio', primary: ['quads'], secondary: [], equipment: 'other', met: 7 },
  },
  { kind: 'workout.put', value: { id: 'workout00001', name: 'Ноги', days: [1], items: [] } },
  { kind: 'session.put', value: session() },
  { kind: 'session.delete', id: 'session00002' },
  { kind: 'steps.put', date: '2026-10-12', steps: 8400 },
];

const rows = (db: Database, table: string): Row[] =>
  db
    .prepare(`SELECT * FROM ${table} ORDER BY 1, 2`)
    .all()
    .map((r: Row) => ({ ...r }));
const tableNames = (db: Database): string[] =>
  db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .all()
    .map((r) => String(r.name));
const columns = (db: Database, table: string): string[] =>
  db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map((c) => `${String(c.name)} ${String(c.type)}${c.notnull ? ' NN' : ''}${c.pk ? ` pk${String(c.pk)}` : ''}`);

let dir: string;
let file: string;
let backups: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legko-v5-'));
  file = join(dir, 'legko.db');
  backups = join(dir, 'backups');
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

/** A v4 file as production holds it: two accounts with rows in the v4 tables. */
function v4File(): { anna: UserId; olya: UserId } {
  const db = new (sqlite().DatabaseSync)(file, { enableForeignKeyConstraints: true });
  try {
    migrate(db, MIGRATIONS.slice(0, 4));
    const users = createUserRepo(db);
    const anna = users.create({ username: 'anna', role: 'user', passwordHash: 'scrypt$a', now: 1 }).id;
    const olya = users.create({ username: 'olya', role: 'user', passwordHash: 'scrypt$o', now: 2 }).id;
    createDataRepos(db, () => 5).forUser(anna).apply(V4_OPS);
    createDataRepos(db, () => 6).forUser(olya).apply([{ kind: 'weight.put', date: '2026-10-11', kg: 70 }]);
    return { anna, olya };
  } finally {
    db.close();
  }
}

describe('migration v4 → v5', () => {
  it('writes legko-pre-v5-<date>.db first; every v4 row is unchanged; the four tables are added', () => {
    const { anna } = v4File();
    const raw = new (sqlite().DatabaseSync)(file);
    const before = Object.fromEntries(V4_TABLES.map((t) => [t, rows(raw, t)]));
    raw.close();

    const db = openDatabase(file, { now });
    try {
      expect(schemaVersion(db)).toBe(5);
      expect(MIGRATIONS).toHaveLength(5);
      for (const t of V4_TABLES) expect(rows(db, t), t).toEqual(before[t]);
      for (const t of V5_TABLES) {
        expect(tableNames(db)).toContain(t);
        expect(rows(db, t)).toEqual([]);
      }
      expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
      // The repo reads the same v4 data, with empty workouts and steps.
      const data = createDataRepos(db).forUser(anna).read();
      expect(data).toMatchObject({ exercises: [], workouts: [], sessions: [], steps: [], deletedSessions: [] });
      expect(data.settings.stepsGoal).toBeNull();
      expect(data.days['2026-10-12']).toMatchObject({ trained: true, types: ['Низ тіла'] });
    } finally {
      db.close();
    }
    const name = preMigrationBackupName(5, DATE);
    expect(name).toBe('legko-pre-v5-2026-10-22.db');
    expect(readdirSync(backups)).toEqual([name]);
    const copy = new (sqlite().DatabaseSync)(join(backups, name), { readOnly: true });
    try {
      expect(schemaVersion(copy)).toBe(4);
      for (const t of V4_TABLES) expect(rows(copy, t), t).toEqual(before[t]);
    } finally {
      copy.close();
    }
  });

  it('matches the §1.8 shapes and checks', () => {
    const db = openDatabase(':memory:');
    try {
      expect(columns(db, 'exercises')).toEqual([
        'user_id TEXT NN pk1',
        'id TEXT NN pk2',
        'position INTEGER NN',
        'value TEXT NN',
        'updated_at INTEGER NN',
      ]);
      expect(columns(db, 'workouts')).toEqual(columns(db, 'exercises'));
      expect(columns(db, 'workout_sessions')).toEqual([
        'user_id TEXT NN pk1',
        'id TEXT NN pk2',
        'date TEXT NN',
        'status TEXT NN',
        'value TEXT NN',
        'updated_at INTEGER NN',
      ]);
      expect(columns(db, 'steps')).toEqual([
        'user_id TEXT NN pk1',
        'date TEXT NN pk2',
        'steps INTEGER NN',
        'updated_at INTEGER NN',
      ]);
      const indexes = db
        .prepare('PRAGMA index_list(workout_sessions)')
        .all()
        .map((i) => String(i.name));
      expect(indexes).toContain('workout_sessions_by_date');
      const id = createUserRepo(db).create({ username: 'anna', role: 'user', passwordHash: null, now: 1 }).id;
      const insert = db.prepare(
        'INSERT INTO workout_sessions (user_id, id, date, status, value, updated_at) VALUES (?, ?, ?, ?, ?, 1)',
      );
      insert.run(id, 'a', '2026-10-12', 'deleted', '{}');
      expect(() => insert.run(id, 'b', '2026-10-12', 'paused', '{}')).toThrow();
      const steps = db.prepare('INSERT INTO steps (user_id, date, steps, updated_at) VALUES (?, ?, ?, 1)');
      expect(() => steps.run(id, '2026-10-12', 0)).toThrow();
      expect(() => steps.run(id, '2026-10-12', 100_001)).toThrow();
      expect(() => steps.run('f'.repeat(32), '2026-10-12', 10)).toThrow(); // no such user
    } finally {
      db.close();
    }
  });

  it('deleting an account removes its exercises, workouts, sessions (and tombstones) and steps', () => {
    const db = openDatabase(':memory:');
    try {
      const users = createUserRepo(db);
      const anna = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 1 }).id;
      const olya = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 1 }).id;
      createDataRepos(db).forUser(anna).apply(V5_OPS);
      createDataRepos(db).forUser(olya).apply(V5_OPS);
      users.delete(anna);
      for (const t of V5_TABLES) {
        const owners = rows(db, t).map((r) => r.user_id);
        expect(owners.length, t).toBeGreaterThan(0);
        expect(owners.every((o) => o === olya), t).toBe(true);
      }
    } finally {
      db.close();
    }
  });
});

describe('downgrade-schema v5 → v4', () => {
  function v5File(): { anna: UserId; olya: UserId } {
    const ids = v4File();
    const db = openDatabase(file, { now });
    try {
      createDataRepos(db).forUser(ids.anna).apply(V5_OPS);
      createDataRepos(db).forUser(ids.olya).apply([{ kind: 'steps.put', date: '2026-10-11', steps: 3000 }]);
      db.prepare('UPDATE user_settings SET value = json_set(value, ?, 8000) WHERE user_id = ?').run(
        '$.stepsGoal',
        ids.anna,
      );
    } finally {
      db.close();
    }
    return ids;
  }

  it('snapshots, drops the four tables, reports per account; a re-open migrates back to v5 cleanly', () => {
    const { anna, olya } = v5File();
    const db = new (sqlite().DatabaseSync)(file, { enableForeignKeyConstraints: true });
    let before: Record<string, Row[]>;
    try {
      before = Object.fromEntries(V4_TABLES.map((t) => [t, rows(db, t)]));
      const report = downgradeSchemaV5(db, backups, DATE);
      expect(report.snapshot).toBe(join(backups, 'legko-pre-down-v5-2026-10-22.db'));
      expect(report.dropped).toEqual([
        { id: anna, username: 'anna', counts: { workout_sessions: 1, workouts: 1, exercises: 1, steps: 1 } },
        { id: olya, username: 'olya', counts: { workout_sessions: 0, workouts: 0, exercises: 0, steps: 1 } },
      ]);
      expect(schemaVersion(db)).toBe(4);
      for (const t of V5_TABLES) expect(tableNames(db)).not.toContain(t);
      for (const t of V4_TABLES) expect(rows(db, t), t).toEqual(before[t]);
      // What the v4 build does on this file still works (its statements and ops; stepsGoal stays in the JSON).
      const repo = createDataRepos(db).forUser(anna);
      repo.apply([{ kind: 'weight.put', date: '2026-10-13', kg: 66 }]);
      expect(repo.read().weights.map((w) => w.date)).toEqual(['2026-10-12', '2026-10-13']);
      expect(() => downgradeSchemaV5(db, backups, DATE)).toThrow(DowngradeRefused);
    } finally {
      db.close();
    }
    // The snapshot holds the v5 data.
    const copy = new (sqlite().DatabaseSync)(join(backups, 'legko-pre-down-v5-2026-10-22.db'), { readOnly: true });
    try {
      expect(schemaVersion(copy)).toBe(5);
      expect(rows(copy, 'steps')).toHaveLength(2);
    } finally {
      copy.close();
    }

    const again = openDatabase(file, { now });
    try {
      expect(schemaVersion(again)).toBe(5);
      const data = createDataRepos(again).forUser(anna).read();
      expect(data).toMatchObject({ exercises: [], workouts: [], sessions: [], steps: [] });
      expect(data.settings.stepsGoal).toBe(8000);
      expect(data.weights).toHaveLength(2);
    } finally {
      again.close();
    }
    expect(readdirSync(backups).sort()).toEqual([
      'legko-pre-down-v5-2026-10-22.db',
      'legko-pre-v5-2026-10-22-2.db',
      'legko-pre-v5-2026-10-22.db',
    ]);
  });

  it('v5 → v4 → v3 chain, and a second v5 → v4 on the same date never replaces the first snapshot', () => {
    v5File();
    const db = new (sqlite().DatabaseSync)(file, { enableForeignKeyConstraints: true });
    try {
      downgradeSchemaV5(db, backups, DATE);
      const first = readFileSync(join(backups, 'legko-pre-down-v5-2026-10-22.db'));
      migrate(db);
      expect(schemaVersion(db)).toBe(5);
      expect(downgradeSchemaV5(db, backups, DATE).snapshot).toBe(join(backups, 'legko-pre-down-v5-2026-10-22-2.db'));
      expect(readFileSync(join(backups, 'legko-pre-down-v5-2026-10-22.db')).equals(first)).toBe(true);

      downgradeSchemaV4(db, backups, DATE, { keep: 'anna', dropOthers: true });
      expect(schemaVersion(db)).toBe(3);
      expect(existsSync(join(backups, 'legko-pre-down-v4-2026-10-22.db'))).toBe(true);
      expect(db.prepare('SELECT COUNT(*) AS n FROM days').get()).toEqual({ n: 1 });
    } finally {
      db.close();
    }
  });

  it('refuses anything but v5 with nothing changed', () => {
    v4File();
    const db = new (sqlite().DatabaseSync)(file, { enableForeignKeyConstraints: true });
    try {
      expect(() => downgradeSchemaV5(db, backups, DATE)).toThrow(/only works on schema v5; this database is v4/);
      expect(schemaVersion(db)).toBe(4);
      expect(existsSync(backups)).toBe(false);
    } finally {
      db.close();
    }
  });
});
