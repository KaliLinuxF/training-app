import { applyOps, defaultSettings, emptyData, type DayEntry, type Op } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDataAccess, createDataRepos, type ClientId, type DataRepos, type DataReaders } from './data';
import { openDatabase } from './open';
import type { Database } from './sqlite';
import { createUserRepo, type UserId } from './users';

/**
 * The read-only reader of the coach cabinet (docs/coach-cabinet.md §2.2, §2.6 rule 5): same rows as the repo, scoped
 * to one user, inclusive date bounds, no foods, no write method, frozen.
 */

const T0 = Date.UTC(2026, 9, 9, 9, 0);

const day = (food: string, kcal: number | null, notes = ''): DayEntry => ({
  food,
  kcal,
  trained: null,
  types: [],
  notes,
});

/** Tests stand in for `resolveClient` (the only minting place in the server). */
const client = (id: UserId): ClientId => id as ClientId;

/** `inner`, recording the SQL of every statement call (get / all / run …) in `ran`. */
function recordingDb(inner: Database, ran: string[]): Database {
  const wrap = (sql: string, statement: object): object =>
    new Proxy(statement, {
      get(target, key) {
        const value: unknown = Reflect.get(target, key);
        if (typeof value !== 'function') return value;
        return (...args: unknown[]): unknown => {
          ran.push(sql);
          return (value as (...a: unknown[]) => unknown).apply(target, args);
        };
      },
    });
  return new Proxy(inner, {
    get(target, key) {
      if (key === 'prepare') return (sql: string) => wrap(sql, target.prepare(sql));
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? (value as (...a: unknown[]) => unknown).bind(target) : value;
    },
  });
}

let db: Database;
let repos: DataRepos;
let readers: DataReaders;
let anna: UserId;
let olya: UserId;

beforeEach(() => {
  db = openDatabase(':memory:');
  const users = createUserRepo(db);
  anna = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 }).id;
  olya = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
  ({ repos, readers } = createDataAccess(db, () => T0));
});

afterEach(() => db.close());

const annaOps: Op[] = [
  { kind: 'day.put', date: '2026-10-01', value: day('Омлет', 1500) },
  { kind: 'day.put', date: '2026-10-05', value: day('Суп', 1700, 'A notes') },
  { kind: 'day.put', date: '2026-10-07', value: day('Каша', 1600) },
  { kind: 'day.put', date: '2026-10-20', value: day('Майбутнє', 900) },
  { kind: 'weight.put', date: '2026-09-28', kg: 70 },
  { kind: 'weight.put', date: '2026-10-05', kg: 69.5 },
  { kind: 'weight.put', date: '2026-10-25', kg: 68 },
  { kind: 'measure.put', date: '2026-10-03', value: { chest: 90, waist: 70, hips: 98 } },
  { kind: 'measure.put', date: '2026-10-30', value: { chest: 89, waist: 69, hips: 97 } },
  { kind: 'food.use', date: '2026-10-05', value: { name: 'Борщ', portion: '300 г', kcal: 180 } },
  { kind: 'settings.put', value: { ...defaultSettings(), goal: 60, timezone: 'Europe/Warsaw' } },
];

describe('DataReader.daysBetween', () => {
  it('returns days with from <= date <= to (inclusive), oldest first', () => {
    // Applied in a shuffled order: the reader sorts, not the insertion order.
    repos.forUser(anna).apply([annaOps[2]!, annaOps[0]!, annaOps[3]!, annaOps[1]!]);
    const reader = readers.readerFor(client(anna));
    expect(reader.daysBetween('2026-10-01', '2026-10-07').map((d) => d.date)).toEqual([
      '2026-10-01',
      '2026-10-05',
      '2026-10-07',
    ]);
    expect(reader.daysBetween('2026-10-02', '2026-10-06').map((d) => d.date)).toEqual(['2026-10-05']);
    expect(reader.daysBetween('2026-10-05', '2026-10-05').map((d) => d.date)).toEqual(['2026-10-05']);
    expect(reader.daysBetween('2026-10-08', '2026-10-19')).toEqual([]);
    expect(reader.daysBetween('2026-10-05', '2026-10-05')[0]?.entry).toEqual(day('Суп', 1700, 'A notes'));
  });

  it('entries equal what the repo reads for the same dates', () => {
    repos.forUser(anna).apply(annaOps);
    const full = repos.forUser(anna).read();
    for (const { date, entry } of readers.readerFor(client(anna)).daysBetween('2026-01-01', '2026-12-31')) {
      expect(entry).toEqual(full.days[date]);
    }
  });
});

describe('DataReader.recordSpan', () => {
  it('is the earliest / latest of days, weigh-ins and measurements on or before `to`', () => {
    repos.forUser(anna).apply(annaOps);
    const reader = readers.readerFor(client(anna));
    // Rows after `to` (10-20 day, 10-25 weight, 10-30 measure) are ignored.
    expect(reader.recordSpan('2026-10-14')).toEqual({ first: '2026-09-28', last: '2026-10-07' });
    expect(reader.recordSpan('2026-10-20')).toEqual({ first: '2026-09-28', last: '2026-10-20' });
    expect(reader.recordSpan('2026-10-31')).toEqual({ first: '2026-09-28', last: '2026-10-30' });
    expect(reader.recordSpan('2026-10-03')).toEqual({ first: '2026-09-28', last: '2026-10-03' });
    expect(reader.recordSpan('2026-09-27')).toEqual({ first: null, last: null });
  });

  it('works when only one kind of record exists', () => {
    repos
      .forUser(anna)
      .apply([{ kind: 'measure.put', date: '2026-10-03', value: { chest: 90, waist: null, hips: null } }]);
    expect(readers.readerFor(client(anna)).recordSpan('2026-10-14')).toEqual({
      first: '2026-10-03',
      last: '2026-10-03',
    });
  });

  it('is null / null for an account without records', () => {
    expect(readers.readerFor(client(anna)).recordSpan('2026-10-14')).toEqual({ first: null, last: null });
  });
});

describe('DataReader scope', () => {
  it('two users with the same dates never mix', () => {
    repos.forUser(anna).apply(annaOps);
    repos.forUser(olya).apply([
      { kind: 'day.put', date: '2026-10-05', value: day('Чуже', 2500, 'B notes') },
      { kind: 'day.put', date: '2026-09-01', value: day('Раніше', 1000) },
      { kind: 'weight.put', date: '2026-10-05', kg: 90 },
      { kind: 'measure.put', date: '2026-10-03', value: { chest: 110, waist: 100, hips: 120 } },
      { kind: 'settings.put', value: { ...defaultSettings(), goal: 80 } },
    ]);
    const a = readers.readerFor(client(anna));
    const b = readers.readerFor(client(olya));

    expect(a.daysBetween('2026-10-05', '2026-10-05')[0]?.entry.food).toBe('Суп');
    expect(b.daysBetween('2026-10-05', '2026-10-05')[0]?.entry.food).toBe('Чуже');
    expect(a.weights().map((w) => w.kg)).toEqual([70, 69.5, 68]);
    expect(b.weights()).toEqual([{ date: '2026-10-05', kg: 90 }]);
    expect(a.measures().map((m) => m.chest)).toEqual([90, 89]);
    expect(b.measures().map((m) => m.chest)).toEqual([110]);
    expect(a.settings().goal).toBe(60);
    expect(b.settings().goal).toBe(80);
    expect(a.recordSpan('2026-10-14').first).toBe('2026-09-28');
    expect(b.recordSpan('2026-10-14')).toEqual({ first: '2026-09-01', last: '2026-10-05' });
    expect(JSON.stringify(a.read())).not.toContain('Чуже');
    expect(JSON.stringify(b.read())).not.toContain('A notes');
  });
});

describe('DataReader.read', () => {
  it('equals the repo read without foods, and has no `foods` key even when foods rows exist', () => {
    repos.forUser(anna).apply(annaOps);
    const full = repos.forUser(anna).read();
    expect(full.foods.map((f) => f.name)).toEqual(['Борщ']);
    const copy = readers.readerFor(client(anna)).read();
    expect('foods' in copy).toBe(false);
    expect(Object.keys(copy).sort()).toEqual(['days', 'measures', 'settings', 'weights']);
    const { foods: _foods, ...rest } = full;
    expect(copy).toEqual(rest);
  });

  it('never runs the foods statement', () => {
    repos.forUser(anna).apply(annaOps);
    const ran: string[] = [];
    const spied = createDataAccess(recordingDb(db, ran), () => T0).readers.readerFor(client(anna));
    expect(ran).toEqual([]);
    spied.read();
    spied.settings();
    spied.weights();
    spied.measures();
    spied.daysBetween('2026-10-01', '2026-10-31');
    spied.recordSpan('2026-10-31');
    expect(ran.length).toBeGreaterThan(0);
    expect(ran.some((sql) => sql.includes('FROM foods'))).toBe(false);
  });

  it('serves defaults for an account that never saved anything', () => {
    expect(readers.readerFor(client(anna)).read()).toEqual({
      days: {},
      weights: [],
      measures: [],
      settings: emptyData().settings,
    });
  });
});

describe('DataReader shape', () => {
  it('has exactly the read methods and is frozen', () => {
    const reader = readers.readerFor(client(anna));
    expect(Object.keys(reader).sort()).toEqual([
      'daysBetween',
      'measures',
      'read',
      'recordSpan',
      'settings',
      'weights',
    ]);
    expect(Object.isFrozen(reader)).toBe(true);
    expect(() => {
      (reader as unknown as Record<string, unknown>).apply = () => undefined;
    }).toThrow(TypeError);
  });

  it('reads leave every row as it was', () => {
    repos.forUser(anna).apply(annaOps);
    const snapshot = () =>
      ['days', 'weights', 'measures', 'foods', 'user_settings'].map((t) =>
        db.prepare(`SELECT * FROM ${t} ORDER BY 1, 2`).all(),
      );
    const before = snapshot();
    const reader = readers.readerFor(client(anna));
    reader.read();
    reader.daysBetween('2026-01-01', '2026-12-31');
    reader.recordSpan('2026-12-31');
    expect(snapshot()).toEqual(before);
  });
});

describe('createDataRepos', () => {
  it('still behaves as createDataAccess(...).repos: same reads after the same ops', () => {
    const viaWrapper = createDataRepos(db, () => T0).forUser(anna);
    viaWrapper.apply(annaOps);
    expect(viaWrapper.read()).toEqual(repos.forUser(anna).read());
    expect(viaWrapper.read()).toEqual(applyOps(emptyData(), annaOps));
    expect(Object.keys(createDataRepos(db))).toEqual(['forUser']);
  });
});
