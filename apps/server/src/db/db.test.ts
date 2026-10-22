import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyOps,
  defaultSettings,
  emptyData,
  normalizeDay,
  type DayEntry,
  type Meal,
  type Op,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { preMigrationBackupName, pruneBackups } from '../backup';
import { createLogger, type Logger } from '../logger';
import { createDataRepos, type DataRepo } from './data';
import { getKv, KV, setKv } from './kv';
import { migrate, MIGRATIONS, schemaVersion } from './migrations';
import { openDatabase } from './open';
import { sqlite, type Database } from './sqlite';
import { transaction } from './tx';
import { createUserRepo, type UserId } from './users';

/** The id of the database's legacy owner / «anna», created on first use. */
function annaId(db: Database): UserId {
  const users = createUserRepo(db);
  return (
    users.legacyOwner()?.id ??
    users.byKey('anna')?.id ??
    users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0, legacyOwner: true }).id
  );
}

/** anna's data repo (the single-account cases of the v3 suite). */
function createDataRepo(db: Database, now: () => number = Date.now, logger?: Logger): DataRepo {
  return createDataRepos(db, now, logger).forUser(annaId(db));
}

/** Raw `user_settings.value` of anna, or null. */
const rawSettings = (db: Database): string | null => {
  const row = db.prepare('SELECT value FROM user_settings WHERE user_id = ?').get(annaId(db));
  return row ? String(row.value) : null;
};

const putRawSettings = (db: Database, value: string): void => {
  db.prepare(
    `INSERT INTO user_settings (user_id, value, updated_at) VALUES (?, ?, 0)
     ON CONFLICT (user_id) DO UPDATE SET value = excluded.value`,
  ).run(annaId(db), value);
};

describe('openDatabase', () => {
  it('creates the file in WAL mode with the latest schema', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legko-db-'));
    try {
      const db = openDatabase(join(dir, 'nested', 'legko.db'));
      expect(db.prepare('PRAGMA journal_mode').get()).toEqual({ journal_mode: 'wal' });
      expect(schemaVersion(db)).toBe(MIGRATIONS.length);
      db.close();
      // Re-opening is a no-op migration.
      const again = openDatabase(join(dir, 'nested', 'legko.db'));
      expect(schemaVersion(again)).toBe(MIGRATIONS.length);
      again.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('migrate', () => {
  const fresh = () => new (sqlite().DatabaseSync)(':memory:');

  it('applies pending migrations in order and records user_version', () => {
    const db = fresh();
    expect(migrate(db, ['CREATE TABLE a (x INTEGER)', 'CREATE TABLE b (y INTEGER)'])).toBe(2);
    expect(schemaVersion(db)).toBe(2);
    expect(
      migrate(db, ['CREATE TABLE a (x INTEGER)', 'CREATE TABLE b (y INTEGER)', 'ALTER TABLE a ADD z TEXT']),
    ).toBe(3);
    expect(db.prepare('SELECT z FROM a').all()).toEqual([]);
  });

  it('rolls back a failing migration', () => {
    const db = fresh();
    expect(() => migrate(db, ['CREATE TABLE a (x INTEGER); CREATE TABLE a (x INTEGER)'])).toThrow();
    expect(schemaVersion(db)).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'a'").get()).toBeUndefined();
  });

  it('refuses a database from a newer build', () => {
    const db = fresh();
    db.exec('PRAGMA user_version = 99');
    expect(() => migrate(db)).toThrow(/newer/);
  });
});

describe('transaction', () => {
  it('commits on success and rolls back on error', () => {
    const db = openDatabase(':memory:');
    transaction(db, () => setKv(db, KV.aiLimits, 'a'));
    expect(() =>
      transaction(db, () => {
        setKv(db, KV.aiLimits, 'b');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(getKv(db, KV.aiLimits)).toBe('a');
    expect(db.isTransaction).toBe(false);
  });
});

describe('data repo', () => {
  it('serves defaults for corrupt stored settings', () => {
    const db = openDatabase(':memory:');
    putRawSettings(db, '{"goal": "heavy"}');
    expect(createDataRepo(db).settings().goal).toBe(60);
    putRawSettings(db, 'not json');
    expect(createDataRepo(db).settings().goal).toBe(60);
  });

  it('fills in fields missing from older stored settings', () => {
    const db = openDatabase(':memory:');
    putRawSettings(
      db,
      JSON.stringify({ goal: 57, kcalGoal: 1500, timezone: 'Europe/Kyiv', onboarded: true }),
    );
    const s = createDataRepo(db).settings();
    expect(s.goal).toBe(57);
    expect(s.rem.weigh).toEqual({ on: true, day: 1, time: '08:00' });
    expect(s.customTypes).toEqual([]);
  });

  it('applies all ops of a batch or none', () => {
    const db = openDatabase(':memory:');
    const repo = createDataRepo(db);
    db.exec(
      `CREATE TRIGGER no_2027 BEFORE INSERT ON weights WHEN NEW.date LIKE '2027-%' BEGIN SELECT RAISE(ABORT, 'nope'); END`,
    );
    expect(() =>
      repo.apply([
        { kind: 'weight.put', date: '2026-10-10', kg: 65 },
        { kind: 'weight.put', date: '2027-01-01', kg: 64 },
      ]),
    ).toThrow();
    expect(repo.read().weights).toEqual([]);
  });

  it('reports whether a reminder’s action is done', () => {
    const repo = createDataRepo(openDatabase(':memory:'));
    repo.apply([
      { kind: 'weight.put', date: '2026-10-12', kg: 65 },
      {
        kind: 'day.put',
        date: '2026-10-12',
        value: { food: 'x', kcal: null, trained: null, types: [], notes: '' },
      },
      {
        kind: 'day.put',
        date: '2026-10-13',
        value: { food: '', kcal: null, trained: true, types: [], notes: '' },
      },
    ]);
    expect(repo.isDone('weigh', '2026-10-12')).toBe(true);
    expect(repo.isDone('weigh', '2026-10-13')).toBe(false);
    expect(repo.isDone('measure', '2026-10-12')).toBe(false);
    expect(repo.isDone('workout', '2026-10-12')).toBe(false);
    expect(repo.isDone('workout', '2026-10-13')).toBe(true);
    expect(repo.isDone('workout', '2026-10-14')).toBe(false);
  });

  it('setTimezone stores a new zone once, canonicalised; aliases of the stored zone change nothing', () => {
    const db = openDatabase(':memory:');
    const repo = createDataRepo(db);
    const raw = () => rawSettings(db);
    expect(repo.setTimezone('Europe/Kyiv')).toBeNull();
    expect(repo.setTimezone('Europe/Kiev')).toBeNull();
    expect(raw()).toBeNull(); // defaults were never written

    expect(repo.setTimezone('Europe/Warsaw')).toBe('Europe/Warsaw');
    expect(repo.settings().timezone).toBe('Europe/Warsaw');
    const stored = raw();
    expect(repo.setTimezone('Europe/Warsaw')).toBeNull();
    expect(repo.setTimezone('europe/warsaw')).toBeNull();
    expect(raw()).toBe(stored);

    // Chrome reports the legacy id; the current IANA name is stored.
    expect(repo.setTimezone('Europe/Kiev')).toBe('Europe/Kyiv');
    expect(repo.settings().timezone).toBe('Europe/Kyiv');
    expect(repo.setTimezone('US/Eastern')).toBe('America/New_York');
  });

  it('setTimezone leaves a legacy spelling alone when the zone is the same', () => {
    const repo = createDataRepo(openDatabase(':memory:'));
    repo.apply([{ kind: 'settings.put', value: { ...defaultSettings(), timezone: 'Europe/Kiev' } }]);
    expect(repo.setTimezone('Europe/Kyiv')).toBeNull();
    expect(repo.settings().timezone).toBe('Europe/Kiev');
  });
});

describe('migration v1 → v2 (photos, foods)', () => {
  it('keeps existing data and adds the new columns and tables', () => {
    const dir = mkdtempSync(join(tmpdir(), 'legko-db-v1-'));
    const file = join(dir, 'legko.db');
    try {
      // A database as the first release left it.
      const v1 = new (sqlite().DatabaseSync)(file);
      expect(migrate(v1, MIGRATIONS.slice(0, 1))).toBe(1);
      v1.exec(`
        INSERT INTO days (date, food, kcal, trained, types, notes, updated_at)
          VALUES ('2026-10-01', 'Омлет', 1500, 1, '["Кардіо"]', 'легко', 1);
        INSERT INTO weights (date, kg, updated_at) VALUES ('2026-10-01', 65.4, 1);
        INSERT INTO measures (date, chest, waist, hips, updated_at) VALUES ('2026-10-01', 90, 70, NULL, 1);
        INSERT INTO kv (key, value) VALUES ('password_hash', 'scrypt$hash');
        INSERT INTO kv (key, value) VALUES ('settings', '{"goal":57,"kcalGoal":1500,"onboarded":true}');
      `);
      v1.close();

      const db = openDatabase(file);
      expect(schemaVersion(db)).toBe(MIGRATIONS.length);
      const data = createDataRepo(db).read();
      expect(data.days).toEqual({
        '2026-10-01': { food: 'Омлет', kcal: 1500, trained: true, types: ['Кардіо'], notes: 'легко' },
      });
      expect(data.days['2026-10-01']).not.toHaveProperty('photos');
      expect(data.weights).toEqual([{ date: '2026-10-01', kg: 65.4 }]);
      expect(data.measures).toEqual([{ date: '2026-10-01', chest: 90, waist: 70, hips: null }]);
      expect(data.foods).toEqual([]);
      expect(data.settings.goal).toBe(57);
      expect(createUserRepo(db).legacyOwner()?.passwordHash).toBe('scrypt$hash');
      expect(db.prepare('SELECT photos FROM days').get()).toEqual({ photos: '[]' });
      expect(db.prepare('SELECT COUNT(*) AS n FROM photos').get()).toEqual({ n: 0 });
      db.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('data repo: photos and foods', () => {
  const a = 'AAAAAAAAAAAAAAAAAAAAAA';

  it('round-trips day photos and keeps the order of foods', () => {
    const repo = createDataRepo(openDatabase(':memory:'));
    repo.apply([
      {
        kind: 'day.put',
        date: '2026-10-10',
        value: { food: '', kcal: null, trained: null, types: [], notes: '', photos: [a, a] },
      },
      { kind: 'food.use', date: '2026-10-10', value: { name: 'Борщ', portion: '300 г', kcal: 180 } },
      { kind: 'food.use', date: '2026-10-10', value: { name: 'Кава', portion: '', kcal: 40 } },
      { kind: 'food.use', date: '2026-10-11', value: { name: 'борщ', portion: '300 г', kcal: 190 } },
    ]);
    const data = repo.read();
    expect(data.days['2026-10-10']).toEqual({
      food: '',
      kcal: null,
      trained: null,
      types: [],
      notes: '',
      photos: [a],
    });
    expect(data.foods.map((f) => [f.name, f.count])).toEqual([
      ['Кава', 1],
      ['борщ', 2],
    ]);
  });

  it('replaceAll replaces foods', () => {
    const repo = createDataRepo(openDatabase(':memory:'));
    repo.apply([{ kind: 'food.use', date: '2026-10-10', value: { name: 'Борщ', portion: '', kcal: 180 } }]);
    const foods = [
      { name: 'Сирники', portion: '3 шт.', kcal: 420, count: 2, lastUsed: '2026-10-09' },
      { name: 'Гречка', portion: '200 г', kcal: 220, count: 5, lastUsed: '2026-10-08' },
    ];
    repo.replaceAll({ ...repo.read(), foods });
    expect(repo.read().foods).toEqual(foods);
  });

  it('a failing batch leaves foods untouched', () => {
    const db = openDatabase(':memory:');
    const repo = createDataRepo(db);
    repo.apply([{ kind: 'food.use', date: '2026-10-10', value: { name: 'Борщ', portion: '', kcal: 180 } }]);
    db.exec(
      `CREATE TRIGGER no_2027 BEFORE INSERT ON weights WHEN NEW.date LIKE '2027-%' BEGIN SELECT RAISE(ABORT, 'nope'); END`,
    );
    expect(() =>
      repo.apply([
        { kind: 'food.delete', name: 'борщ' },
        { kind: 'weight.put', date: '2027-01-01', kg: 64 },
      ]),
    ).toThrow();
    expect(repo.read().foods.map((f) => f.name)).toEqual(['Борщ']);
  });
});

/** A temp dir with `legko.db` inside; removed afterwards (every handle must be closed by then). */
function withTempDb(prefix: string, fn: (file: string, dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  try {
    fn(join(dir, 'legko.db'), dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** A file database at schema `version` (by the released migrations), closed again. */
function createAt(file: string, version: number, seed = ''): void {
  const db = new (sqlite().DatabaseSync)(file);
  try {
    expect(migrate(db, MIGRATIONS.slice(0, version))).toBe(version);
    if (seed) db.exec(seed);
  } finally {
    db.close();
  }
}

const meal = (patch: Partial<Meal> = {}): Meal => ({
  id: 'breakfast001',
  type: 'Сніданок',
  time: '08:30',
  text: 'Тост з тунцем',
  kcal: 420,
  protein: 27,
  fat: 11.5,
  carbs: 36,
  ...patch,
});

const V2_SEED = `
  INSERT INTO days (date, food, kcal, trained, types, notes, photos, updated_at)
    VALUES ('2026-10-01', 'Омлет', 1500, 1, '["Кардіо"]', 'легко', '["AAAAAAAAAAAAAAAAAAAAAA"]', 1);
  INSERT INTO foods (key, position, name, portion, kcal, count, last_used)
    VALUES ('борщ', 0, 'Борщ', '300 г', 180, 2, '2026-10-01');
`;

describe('migration v2 → v3 (meals, macros)', () => {
  it('keeps every row (through to v4): days become legacy days (meals NULL), dishes have no macros', () => {
    withTempDb('legko-db-v2-', (file) => {
      createAt(file, 2, V2_SEED);
      const db = openDatabase(file);
      try {
        expect(schemaVersion(db)).toBe(MIGRATIONS.length);
        expect(db.prepare('SELECT meals FROM days').get()).toEqual({ meals: null });
        expect(db.prepare('SELECT protein, fat, carbs FROM foods').get()).toEqual({
          protein: null,
          fat: null,
          carbs: null,
        });
        const data = createDataRepo(db).read();
        expect(data.days).toEqual({
          '2026-10-01': {
            food: 'Омлет',
            kcal: 1500,
            trained: true,
            types: ['Кардіо'],
            notes: 'легко',
            photos: ['AAAAAAAAAAAAAAAAAAAAAA'],
          },
        });
        expect(data.foods).toEqual([
          { name: 'Борщ', portion: '300 г', kcal: 180, count: 2, lastUsed: '2026-10-01' },
        ]);
        expect(data.settings.mealTypes).toEqual(['Сніданок', 'Обід', 'Вечеря', 'Перекус']);
      } finally {
        db.close();
      }
    });
  });

  it('creates the latest schema (meals, macros) on a fresh database', () => {
    const db = openDatabase(':memory:');
    expect(schemaVersion(db)).toBe(MIGRATIONS.length);
    const columns = (table: string) =>
      db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((c) => c.name);
    expect(columns('days')).toContain('meals');
    expect(columns('foods')).toEqual(expect.arrayContaining(['protein', 'fat', 'carbs']));
  });
});

describe('pre-migration snapshot', () => {
  const now = () => new Date('2026-10-15T09:00:00Z');
  const snapshotName = preMigrationBackupName(MIGRATIONS.length, '2026-10-15');

  it('saves the v2 database as it was before migrating it', () => {
    withTempDb('legko-db-snap-', (file, dir) => {
      createAt(file, 2, V2_SEED);
      const lines: string[] = [];
      openDatabase(file, { now, logger: createLogger('info', (line) => lines.push(line)) }).close();
      const backups = join(dir, 'backups');
      expect(readdirSync(backups)).toEqual([snapshotName]);
      expect(snapshotName).toBe('legko-pre-v4-2026-10-15.db');
      const copy = new (sqlite().DatabaseSync)(join(backups, snapshotName), { readOnly: true });
      try {
        expect(schemaVersion(copy)).toBe(2);
        expect(copy.prepare('SELECT food FROM days').get()).toEqual({ food: 'Омлет' });
      } finally {
        copy.close();
      }
      expect(lines.some((l) => l.includes(snapshotName))).toBe(true);
      // Daily pruning never removes it.
      expect(pruneBackups(backups, 0)).toEqual([]);
      expect(readdirSync(backups)).toEqual([snapshotName]);
      // Opening again (already v3) writes nothing new.
      openDatabase(file, { now: () => new Date('2026-10-16T09:00:00Z') }).close();
      expect(readdirSync(backups)).toEqual([snapshotName]);
    });
  });

  it('writes nothing for a fresh database or an up-to-date one', () => {
    withTempDb('legko-db-nosnap-', (file, dir) => {
      openDatabase(file, { now }).close();
      openDatabase(file, { now }).close();
      expect(existsSync(join(dir, 'backups'))).toBe(false);
    });
  });
});

describe('data repo: meals and dish macros', () => {
  const D = '2026-10-10';

  it('round-trips a day with meals (positions, photos, macros) and its derived columns', () => {
    const db = openDatabase(':memory:');
    const repo = createDataRepo(db);
    const ops: Op[] = [
      {
        kind: 'day.put',
        date: D,
        value: { food: 'Борщ', kcal: 500, trained: true, types: ['Кардіо'], notes: '' },
      },
      {
        kind: 'meal.put',
        date: D,
        value: meal({
          photos: ['AAAAAAAAAAAAAAAAAAAAAA'],
          items: [{ name: 'Тост', portion: '2 шт', kcal: 310, protein: 24, fat: 8.5, carbs: null }],
        }),
      },
    ];
    repo.apply(ops);
    const expected = applyOps(emptyData(), ops);
    expect(repo.read().days).toEqual(expected.days);
    const row = db.prepare('SELECT food, kcal, photos, meals FROM days').get();
    expect(row).toMatchObject({
      food: 'Сніданок: Тост з тунцем\nБорщ',
      kcal: 810,
      photos: '["AAAAAAAAAAAAAAAAAAAAAA"]',
    });
    expect(JSON.parse(String(row?.meals))).toEqual(expected.days[D]?.meals);
  });

  it('a legacy write clears the stored meals column (ON CONFLICT updates meals too)', () => {
    const db = openDatabase(':memory:');
    const repo = createDataRepo(db);
    repo.apply([{ kind: 'meal.put', date: D, value: meal() }]);
    expect(db.prepare('SELECT meals FROM days').get()?.meals).not.toBeNull();
    // The last meal gone, the day still marked: a legacy-shaped row without stale meals.
    repo.apply([
      { kind: 'day.meta', date: D, value: { trained: false } },
      { kind: 'meal.delete', date: D, id: 'breakfast001' },
    ]);
    expect(db.prepare('SELECT food, kcal, meals FROM days').get()).toEqual({
      food: '',
      kcal: null,
      meals: null,
    });
    expect(repo.read().days[D]).toEqual({ food: '', kcal: null, trained: false, types: [], notes: '' });
  });

  it('serves a day with corrupt meals JSON as a legacy day, with a warning that holds no content', () => {
    const lines: string[] = [];
    const db = openDatabase(':memory:');
    const repo = createDataRepo(
      db,
      Date.now,
      createLogger('warn', (line) => lines.push(line)),
    );
    repo.apply([{ kind: 'meal.put', date: D, value: meal() }]);
    const stored = repo.read().days[D] as DayEntry;
    for (const bad of ['{not json', '[{"id":"x"}]', '"text"']) {
      db.prepare('UPDATE days SET meals = ?').run(bad);
      expect(repo.read().days[D]).toEqual({
        food: stored.food,
        kcal: stored.kcal,
        trained: null,
        types: [],
        notes: '',
      });
    }
    expect(lines.length).toBeGreaterThan(0);
    for (const line of lines) {
      expect(line).toContain('days.meals');
      expect(line).not.toContain('Тост');
    }
    // The next meal op re-converts it from the derived columns.
    repo.apply([
      {
        kind: 'meal.put',
        date: D,
        value: meal({ id: 'lunch0000001', type: 'Обід', time: '13:00', text: 'Суп' }),
      },
    ]);
    expect(repo.read().days[D]?.meals?.map((m) => m.id)).toEqual(['lunch0000001', 'legacy']);
  });

  it('round-trips dish macros (NULL ↔ omitted key) and keeps the dish order', () => {
    const repo = createDataRepo(openDatabase(':memory:'));
    const ops: Op[] = [
      {
        kind: 'food.use',
        date: D,
        value: { name: 'Борщ', portion: '300 г', kcal: 180, protein: 6, fat: 9.5, carbs: 19 },
      },
      { kind: 'food.use', date: D, value: { name: 'Яблуко', portion: '1 шт', kcal: 80 } },
      { kind: 'food.use', date: D, value: { name: 'Кава', portion: '', kcal: 40, fat: 2 } },
    ];
    repo.apply(ops);
    expect(repo.read().foods).toEqual(applyOps(emptyData(), ops).foods);
    expect(repo.read().foods[1]).not.toHaveProperty('protein');
    const foods = [
      {
        name: 'Сирники',
        portion: '3 шт',
        kcal: 420,
        count: 2,
        lastUsed: '2026-10-09',
        protein: 22,
        fat: 22,
        carbs: 33,
      },
      { name: 'Гречка', portion: '200 г', kcal: 220, count: 5, lastUsed: '2026-10-08' },
    ];
    repo.replaceAll({ ...repo.read(), foods });
    expect(repo.read().foods).toEqual(foods);
  });

  it('replaceAll re-normalises days: derived fields recomputed, meals: [] is a legacy day, empty days skipped', () => {
    const repo = createDataRepo(openDatabase(':memory:'));
    const withMeals = { food: 'stale', kcal: 1, trained: null, types: [], notes: '', meals: [meal()] };
    repo.replaceAll({
      ...emptyData(),
      days: {
        '2026-10-01': withMeals,
        '2026-10-02': { food: 'Суп', kcal: 300, trained: null, types: [], notes: '', meals: [] },
        '2026-10-03': { food: ' ', kcal: null, trained: null, types: [], notes: '', meals: [] },
      },
    });
    expect(repo.read().days).toEqual({
      '2026-10-01': normalizeDay(withMeals),
      '2026-10-02': { food: 'Суп', kcal: 300, trained: null, types: [], notes: '' },
    });
    expect(repo.read().days['2026-10-01']).toMatchObject({ food: 'Сніданок: Тост з тунцем', kcal: 420 });
  });
});

describe('data repo: two users on the same dates', () => {
  const D = '2026-10-10';
  const setup = () => {
    const db = openDatabase(':memory:');
    const users = createUserRepo(db);
    const a = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 }).id;
    const b = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
    const repos = createDataRepos(db, () => 5);
    return { db, a, b, A: repos.forUser(a), B: repos.forUser(b) };
  };
  const day = (food: string) => ({ food, kcal: 100, trained: null, types: [], notes: '' });

  it('keeps every table separate: days, meals, weights, measures, foods, settings', () => {
    const { A, B } = setup();
    A.apply([
      { kind: 'day.put', date: D, value: day('A') },
      { kind: 'meal.put', date: '2026-10-11', value: meal() },
      { kind: 'weight.put', date: D, kg: 65 },
      { kind: 'measure.put', date: D, value: { chest: 90, waist: 70, hips: 95 } },
      { kind: 'food.use', date: D, value: { name: 'Борщ', portion: '', kcal: 180 } },
      { kind: 'settings.put', value: { ...defaultSettings(), goal: 57 } },
    ]);
    B.apply([
      { kind: 'day.put', date: D, value: day('B') },
      { kind: 'weight.put', date: D, kg: 80 },
      { kind: 'food.use', date: D, value: { name: 'борщ', portion: '', kcal: 200 } },
    ]);

    const a = A.read();
    const b = B.read();
    expect(a.days[D]?.food).toBe('A');
    expect(b.days[D]?.food).toBe('B');
    expect(Object.keys(b.days)).toEqual([D]);
    expect(a.weights).toEqual([{ date: D, kg: 65 }]);
    expect(b.weights).toEqual([{ date: D, kg: 80 }]);
    expect(b.measures).toEqual([]);
    // Same dish key, separate rows (and counts).
    expect(a.foods.map((f) => [f.name, f.count, f.kcal])).toEqual([['Борщ', 1, 180]]);
    expect(b.foods.map((f) => [f.name, f.count, f.kcal])).toEqual([['борщ', 1, 200]]);
    expect(a.settings.goal).toBe(57);
    expect(b.settings.goal).toBe(60);
    expect(B.isDone('measure', D)).toBe(false);
    expect(A.isDone('measure', D)).toBe(true);
  });

  it('deletes and food ops of one user never touch the other', () => {
    const { A, B } = setup();
    for (const repo of [A, B]) {
      repo.apply([
        { kind: 'day.put', date: D, value: day('x') },
        { kind: 'weight.put', date: D, kg: 70 },
        { kind: 'food.use', date: D, value: { name: 'Кава', portion: '', kcal: 40 } },
      ]);
    }
    B.apply([
      { kind: 'day.delete', date: D },
      { kind: 'weight.delete', date: D },
      { kind: 'food.delete', name: 'кава' },
    ]);
    expect(A.read().days[D]?.food).toBe('x');
    expect(A.read().weights).toHaveLength(1);
    expect(A.read().foods).toHaveLength(1);
    expect(B.read()).toMatchObject({ days: {}, weights: [], foods: [] });
  });

  it('replaceAll (import) replaces only the importer’s data', () => {
    const { A, B } = setup();
    A.apply([
      { kind: 'day.put', date: D, value: day('A') },
      { kind: 'weight.put', date: D, kg: 65 },
      { kind: 'food.use', date: D, value: { name: 'Борщ', portion: '', kcal: 180 } },
      { kind: 'settings.put', value: { ...defaultSettings(), goal: 57 } },
    ]);
    const before = A.read();
    B.replaceAll({ ...emptyData(), days: { [D]: day('B') }, settings: { ...defaultSettings(), goal: 70 } });
    expect(A.read()).toEqual(before);
    expect(B.read().days[D]?.food).toBe('B');
    expect(B.read().settings.goal).toBe(70);
    B.replaceAll(emptyData());
    expect(A.read()).toEqual(before);
  });

  it('setTimezone changes only that user’s settings', () => {
    const { A, B } = setup();
    expect(B.setTimezone('Europe/Warsaw')).toBe('Europe/Warsaw');
    expect(B.settings().timezone).toBe('Europe/Warsaw');
    expect(A.settings().timezone).toBe('Europe/Kyiv');
  });

  it('deleting a user removes all of their rows (cascade) and nothing of the other', () => {
    const { db, a, b, A, B } = setup();
    for (const repo of [A, B]) {
      repo.apply([
        { kind: 'day.put', date: D, value: day('x') },
        { kind: 'weight.put', date: D, kg: 70 },
        { kind: 'measure.put', date: D, value: { chest: 1, waist: null, hips: null } },
        { kind: 'food.use', date: D, value: { name: 'Кава', portion: '', kcal: 40 } },
        { kind: 'settings.put', value: defaultSettings() },
      ]);
    }
    transaction(db, () => createUserRepo(db).delete(b));
    for (const table of ['days', 'weights', 'measures', 'foods', 'user_settings']) {
      const rows = db.prepare(`SELECT user_id FROM ${table}`).all();
      expect(
        rows.map((r) => r.user_id),
        table,
      ).toEqual([a]);
    }
  });
});
