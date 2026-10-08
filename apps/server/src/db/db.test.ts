import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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

  it('setTimezone stores a new zone once', () => {
    const repo = createDataRepo(openDatabase(':memory:'));
    expect(repo.setTimezone('Europe/Kyiv')).toBe(false);
    expect(repo.setTimezone('Europe/Warsaw')).toBe(true);
    expect(repo.settings().timezone).toBe('Europe/Warsaw');
    expect(repo.setTimezone('Europe/Warsaw')).toBe(false);
  });
});
