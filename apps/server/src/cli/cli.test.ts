import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPasswordHash, verifyPassword } from '../auth/password';
import { createSessionStore } from '../auth/sessions';
import { createDataRepo } from '../db/data';
import { migrate, MIGRATIONS, schemaVersion } from '../db/migrations';
import { databasePath, openDatabase } from '../db/open';
import { sqlite, type Database } from '../db/sqlite';
import { readFirstLine } from './prompt';
import { runCli, type CliIo } from './run';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legko-cli-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function io(stdinText: string): CliIo & { out: () => string; err: () => string } {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (c: Buffer) => (out += c.toString()));
  stderr.on('data', (c: Buffer) => (err += c.toString()));
  return {
    env: { DATA_DIR: dir },
    cwd: dir,
    stdin: Readable.from([Buffer.from(stdinText)]),
    stdout,
    stderr,
    scrypt: { N: 1024, r: 8, p: 1 },
    out: () => out,
    err: () => err,
  };
}

describe('cli set-password', () => {
  it('reads the first line of stdin, stores the hash and revokes sessions', async () => {
    const db = openDatabase(databasePath(dir));
    const token = createSessionStore(db).create(Date.now());
    db.close();

    const term = io('нове-довге-гасло\r\nignored second line\n');
    expect(await runCli(['set-password', '--stdin'], term)).toBe(0);
    expect(term.out()).toContain('All sessions were revoked');

    const check = openDatabase(databasePath(dir));
    try {
      expect(await verifyPassword('нове-довге-гасло', getPasswordHash(check) ?? '')).toBe(true);
      expect(createSessionStore(check).check(token, Date.now())).toBeNull();
    } finally {
      check.close();
    }
  });

  it('rejects short passwords', async () => {
    const term = io('short\n');
    expect(await runCli(['set-password', '--stdin'], term)).toBe(1);
    expect(term.err()).toMatch(/at least 8/);
  });

  it('needs --stdin when there is no terminal', async () => {
    const term = io('whatever-password\n');
    expect(await runCli(['set-password'], term)).toBe(2);
    expect(term.err()).toMatch(/--stdin/);
  });

  it('prints usage for unknown commands and options', async () => {
    const a = io('');
    expect(await runCli(['nope'], a)).toBe(2);
    expect(a.err()).toContain('Usage');
    const b = io('');
    expect(await runCli(['set-password', '--force'], b)).toBe(2);
    const c = io('');
    expect(await runCli(['--help'], c)).toBe(0);
    expect(c.out()).toContain('set-password');
  });
});

describe('cli downgrade-schema', () => {
  const D = '2026-10-10';
  const at = () => new Date('2026-10-15T09:00:00Z');
  const columns = (db: Database, table: string): unknown[] =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);

  it('turns a v3 database into v2: every day keeps its food text, kcal and photos; the v3 columns go', async () => {
    const db = openDatabase(databasePath(dir));
    const repo = createDataRepo(db);
    repo.apply([
      {
        kind: 'day.put',
        date: D,
        value: { food: 'Борщ', kcal: 500, trained: true, types: ['Кардіо'], notes: 'n' },
      },
      {
        kind: 'meal.put',
        date: D,
        value: {
          id: 'breakfast001',
          type: 'Сніданок',
          time: '08:30',
          text: 'Тост',
          kcal: 300,
          protein: 20,
          fat: 10,
          carbs: 30,
          photos: ['AAAAAAAAAAAAAAAAAAAAAA'],
        },
      },
      { kind: 'food.use', date: D, value: { name: 'Тост', portion: '2 шт', kcal: 300, protein: 20 } },
    ]);
    const before = repo.read().days[D];
    db.close();

    const term = { ...io(''), now: at };
    expect(await runCli(['downgrade-schema'], term)).toBe(0);
    expect(term.out()).toContain('Schema downgraded to v2');
    expect(term.out()).toMatch(/Dropped: the meal structure .* protein \/ fat \/ carbs/);
    expect(term.out()).toContain('food text, kcal and photos');
    expect(readdirSync(join(dir, 'backups'))).toEqual(['legko-pre-down-v3-2026-10-15.db']);

    const v2 = new (sqlite().DatabaseSync)(databasePath(dir));
    try {
      expect(schemaVersion(v2)).toBe(2);
      expect(columns(v2, 'days')).not.toContain('meals');
      expect(columns(v2, 'foods')).not.toContain('protein');
      expect(columns(v2, 'foods')).not.toContain('carbs');
      expect(v2.prepare('SELECT food, kcal, trained, notes, photos FROM days').get()).toEqual({
        food: before?.food,
        kcal: 800,
        trained: 1,
        notes: 'n',
        photos: '["AAAAAAAAAAAAAAAAAAAAAA"]',
      });
      expect(v2.prepare('SELECT name, kcal FROM foods').get()).toEqual({ name: 'Тост', kcal: 300 });
    } finally {
      v2.close();
    }
    const snapshot = new (sqlite().DatabaseSync)(join(dir, 'backups', 'legko-pre-down-v3-2026-10-15.db'), {
      readOnly: true,
    });
    try {
      expect(schemaVersion(snapshot)).toBe(3);
    } finally {
      snapshot.close();
    }

    // Upgrading again re-adds the columns: the day is a legacy day with the same food.
    const again = openDatabase(databasePath(dir), { now: at });
    try {
      expect(schemaVersion(again)).toBe(MIGRATIONS.length);
      expect(again.prepare('SELECT meals FROM days').get()).toEqual({ meals: null });
      const day = createDataRepo(again).read().days[D];
      expect(day).toEqual({
        food: before?.food,
        kcal: 800,
        trained: true,
        types: ['Кардіо'],
        notes: 'n',
        photos: ['AAAAAAAAAAAAAAAAAAAAAA'],
      });
    } finally {
      again.close();
    }
  });

  it('refuses a database that is not at schema v3, changing nothing', async () => {
    const v2 = new (sqlite().DatabaseSync)(databasePath(dir));
    migrate(v2, MIGRATIONS.slice(0, 2));
    v2.close();
    const term = io('');
    expect(await runCli(['downgrade-schema'], term)).toBe(1);
    expect(term.err()).toMatch(/only works on schema v3; this database is v2\. Nothing was changed/);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    const check = new (sqlite().DatabaseSync)(databasePath(dir));
    try {
      expect(schemaVersion(check)).toBe(2);
    } finally {
      check.close();
    }
  });

  it('fails clearly without a database and rejects options', async () => {
    const missing = io('');
    expect(await runCli(['downgrade-schema'], missing)).toBe(1);
    expect(missing.err()).toMatch(/No database at/);
    expect(existsSync(databasePath(dir))).toBe(false);
    const extra = io('');
    expect(await runCli(['downgrade-schema', '--force'], extra)).toBe(2);
    expect(extra.err()).toContain('Usage');
  });

  it('is listed in the usage', async () => {
    const help = io('');
    expect(await runCli(['help'], help)).toBe(0);
    expect(help.out()).toContain('downgrade-schema');
  });
});

describe('readFirstLine', () => {
  it('handles chunks split inside a multi-byte character', async () => {
    const bytes = Buffer.from('гасло\nrest');
    const stream = Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]);
    expect(await readFirstLine(stream)).toBe('гасло');
  });

  it('returns everything when there is no newline', async () => {
    expect(await readFirstLine(Readable.from([Buffer.from('no-newline')]))).toBe('no-newline');
  });
});
