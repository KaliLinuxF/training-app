import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { createDataRepo } from './data';
import { getKv, KV, setKv } from './kv';
import { migrate, MIGRATIONS, schemaVersion } from './migrations';
import { openDatabase } from './open';
import { sqlite } from './sqlite';
import { transaction } from './tx';

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
    transaction(db, () => setKv(db, KV.settings, 'a'));
    expect(() =>
      transaction(db, () => {
        setKv(db, KV.settings, 'b');
        throw new Error('boom');
      }),
    ).toThrow('boom');
    expect(getKv(db, KV.settings)).toBe('a');
    expect(db.isTransaction).toBe(false);
  });
});

describe('data repo', () => {
  it('serves defaults for corrupt stored settings', () => {
    const db = openDatabase(':memory:');
    setKv(db, KV.settings, '{"goal": "heavy"}');
    expect(createDataRepo(db).settings().goal).toBe(60);
    setKv(db, KV.settings, 'not json');
    expect(createDataRepo(db).settings().goal).toBe(60);
  });

  it('fills in fields missing from older stored settings', () => {
    const db = openDatabase(':memory:');
    setKv(
      db,
      KV.settings,
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
    const raw = () => getKv(db, KV.settings);
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
      expect(schemaVersion(db)).toBe(2);
      const data = createDataRepo(db).read();
      expect(data.days).toEqual({
        '2026-10-01': { food: 'Омлет', kcal: 1500, trained: true, types: ['Кардіо'], notes: 'легко' },
      });
      expect(data.days['2026-10-01']).not.toHaveProperty('photos');
      expect(data.weights).toEqual([{ date: '2026-10-01', kg: 65.4 }]);
      expect(data.measures).toEqual([{ date: '2026-10-01', chest: 90, waist: 70, hips: null }]);
      expect(data.foods).toEqual([]);
      expect(data.settings.goal).toBe(57);
      expect(getKv(db, KV.passwordHash)).toBe('scrypt$hash');
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
