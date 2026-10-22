import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LEGACY_OWNER_ID } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/password';
import { createSessionStore, hashToken } from '../auth/sessions';
import { preMigrationBackupName } from '../backup';
import { downgradeSchemaV4 } from './downgrade';
import { migrate, MIGRATIONS, schemaVersion } from './migrations';
import { openDatabase } from './open';
import { sqlite, type Database, type Row } from './sqlite';

const TEST_SCRYPT = { N: 1024, r: 8, p: 1 };
const NOW = Date.UTC(2026, 9, 21, 12, 0);
/** The fixture's oldest date is a weight: «з <date>» = when she started. */
const OLDEST = Date.UTC(2026, 8, 1);

/** Keeps two sessions; the first one's token is used to sign in after the migration. */
const KEPT_TOKEN = 'k'.repeat(43);
const OTHER_TOKEN = 'o'.repeat(43);
const P1 = 'AAAAAAAAAAAAAAAAAAAAAA';
const P2 = 'BBBBBBBBBBBBBBBBBBBBBB';
const MEALS_JSON =
  '[{"id":"breakfast001","type":"Сніданок","time":"08:30","text":"Тост","kcal":420,"protein":27,"fat":11.5,' +
  `"carbs":36,"photos":["${P2}"]}]`;
const SETTINGS_JSON = '{"goal":57,"kcalGoal":1500,"timezone":"Europe/Kyiv","onboarded":true}';

const fresh = (): Database => new (sqlite().DatabaseSync)(':memory:', { enableForeignKeyConstraints: true });

/** A v3 database as production holds it: one person's rows in every table. */
async function v3Fixture(db: Database = fresh()): Promise<{ db: Database; hash: string }> {
  expect(migrate(db, MIGRATIONS.slice(0, 3))).toBe(3);
  const hash = await hashPassword('old password', TEST_SCRYPT);
  const kv = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
  kv.run('password_hash', hash);
  kv.run('settings', SETTINGS_JSON);
  kv.run('food_budget', '{"date":"2026-10-21","count":7}');
  kv.run('vapid_public_key', 'pub-key');
  kv.run('vapid_private_key', 'priv-key');
  kv.run('login_failures', '[1,2,3]');
  db.exec(`
    INSERT INTO days (date, food, kcal, trained, types, notes, updated_at, photos, meals) VALUES
      ('2026-10-05', 'Омлет', 1500, NULL, '[]', '', 11, '["${P1}"]', NULL),
      ('2026-10-06', 'Сніданок: Тост', 420, NULL, '[]', '', 12, '["${P2}"]', '${MEALS_JSON}'),
      ('2026-10-07', '', NULL, 1, '["Кардіо","Сила"]', 'легко', 13, '[]', NULL);
    INSERT INTO weights (date, kg, updated_at) VALUES ('2026-09-01', 68.2, 21), ('2026-10-07', 65.4, 22);
    INSERT INTO measures (date, chest, waist, hips, updated_at) VALUES
      ('2026-10-01', 90, 70, NULL, 31), ('2026-10-08', 89.5, 69, 95, 32);
    INSERT INTO foods (key, position, name, portion, kcal, count, last_used, protein, fat, carbs) VALUES
      ('борщ', 2, 'Борщ', '300 г', 180, 2, '2026-10-01', 6, 9.5, 19),
      ('кава', 0, 'Кава', '', 40, 5, '2026-10-07', NULL, NULL, NULL),
      ('сирники', 1, 'Сирники', '3 шт', 420, 1, '2026-10-06', 22, NULL, 33);
    INSERT INTO photos (id, date, created_at, bytes, thumb_bytes) VALUES
      ('${P1}', '2026-10-05', ${Date.UTC(2026, 9, 5)}, 1000, 100),
      ('${P2}', '2026-10-06', ${Date.UTC(2026, 9, 6)}, 2000, 200);
    INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at, last_ok_at) VALUES
      ('https://web.push.apple.com/a', 'p1', 'a1', 'iPhone', 41, 42),
      ('https://fcm.googleapis.com/b', 'p2', 'a2', NULL, 43, NULL);
    INSERT INTO reminder_log (kind, date, status, sent, created_at) VALUES
      ('weigh', '2026-10-07', 'sent', 1, 51), ('measure', '2026-10-07', 'skipped', 0, 52);
  `);
  const session = db.prepare(
    'INSERT INTO sessions (token_hash, created_at, renewed_at, expires_at) VALUES (?, ?, ?, ?)',
  );
  session.run(hashToken(KEPT_TOKEN), Date.UTC(2026, 9, 2), NOW - 1000, NOW + 300 * 86_400_000);
  session.run(hashToken(OTHER_TOKEN), Date.UTC(2026, 9, 3), NOW - 1000, NOW + 300 * 86_400_000);
  return { db, hash };
}

const PER_USER_TABLES = [
  'sessions',
  'days',
  'weights',
  'measures',
  'foods',
  'photos',
  'push_subscriptions',
  'reminder_log',
] as const;

/** All rows of a table as plain objects, in a stable order. */
function rows(db: Database, table: string): Record<string, unknown>[] {
  return db
    .prepare(`SELECT * FROM ${table}`)
    .all()
    .map((r: Row) => ({ ...r }))
    .sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
}

const withoutUser = (list: Record<string, unknown>[]): Record<string, unknown>[] =>
  list.map(({ user_id: _u, legacy: _l, ...rest }) => rest);

const kvOf = (db: Database): Record<string, string> =>
  Object.fromEntries(
    db
      .prepare('SELECT key, value FROM kv')
      .all()
      .map((r) => [String(r.key), String(r.value)]),
  );

/** `PRAGMA table_info` reduced to name, type, not-null, default and pk position. */
const columns = (db: Database, table: string): string[] =>
  db
    .prepare(`PRAGMA table_info(${table})`)
    .all()
    .map(
      (c) =>
        `${String(c.name)} ${String(c.type)}${c.notnull ? ' NN' : ''}${c.dflt_value !== null ? ` =${String(c.dflt_value)}` : ''}${c.pk ? ` pk${String(c.pk)}` : ''}`,
    );

const indexes = (db: Database, table: string): string[] =>
  db
    .prepare(`PRAGMA index_list(${table})`)
    .all()
    .filter((i) => i.origin === 'c')
    .map((i) => String(i.name))
    .sort();

describe('migration v3 → v4 (accounts)', () => {
  it('attaches every row to the legacy owner «anna» and preserves it column by column', async () => {
    const { db, hash } = await v3Fixture();
    const before = Object.fromEntries(PER_USER_TABLES.map((t) => [t, rows(db, t)]));
    const kvBefore = kvOf(db);

    expect(migrate(db)).toBe(4);
    expect(schemaVersion(db)).toBe(4);

    const users = db.prepare('SELECT * FROM users').all();
    expect(users).toHaveLength(1);
    expect({ ...users[0] }).toEqual({
      id: LEGACY_OWNER_ID,
      username: 'anna',
      username_key: 'anna',
      password_hash: hash,
      role: 'user',
      created_at: OLDEST,
      password_changed_at: null,
      password_changed_via: null,
      password_changed_by: null,
      last_seen_at: null,
      disabled_at: null,
      ai_daily_limit: null,
      legacy_owner: 1,
    });
    expect(await verifyPassword('old password', String(users[0]?.password_hash))).toBe(true);

    for (const table of PER_USER_TABLES) {
      const after = rows(db, table);
      expect(
        after.every((r) => r.user_id === LEGACY_OWNER_ID),
        table,
      ).toBe(true);
      expect(withoutUser(after), table).toEqual(withoutUser(before[table] ?? []));
    }
    expect(
      db
        .prepare('SELECT key, position FROM foods ORDER BY position')
        .all()
        .map((r) => r.key),
    ).toEqual(['кава', 'сирники', 'борщ']);
    expect(db.prepare("SELECT meals FROM days WHERE date = '2026-10-06'").get()?.meals).toBe(MEALS_JSON);
    expect(
      db
        .prepare('SELECT user_id, value FROM user_settings')
        .all()
        .map((r) => ({ ...r })),
    ).toEqual([{ user_id: LEGACY_OWNER_ID, value: SETTINGS_JSON }]);
    expect(
      db
        .prepare('SELECT * FROM ai_usage')
        .all()
        .map((r) => ({ ...r })),
    ).toEqual([{ user_id: LEGACY_OWNER_ID, date: '2026-10-21', count: 7 }]);

    const kvAfter = kvOf(db);
    expect(kvAfter).toEqual({
      food_budget: kvBefore.food_budget,
      vapid_public_key: 'pub-key',
      vapid_private_key: 'priv-key',
      login_failures: '[1,2,3]',
    });
    expect(db.prepare('SELECT COUNT(*) AS n FROM invites').get()?.n).toBe(0);
    expect(db.prepare('SELECT COUNT(*) AS n FROM password_resets').get()?.n).toBe(0);

    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
    expect(db.prepare('PRAGMA integrity_check').get()?.integrity_check).toBe('ok');
  });

  it('keeps her sessions (no re-login): they authenticate as anna and are legacy; new ones are not', async () => {
    const { db } = await v3Fixture();
    migrate(db);
    const sessions = createSessionStore(db);
    const check = sessions.check(KEPT_TOKEN, NOW);
    expect(check?.user).toMatchObject({
      id: LEGACY_OWNER_ID,
      username: 'anna',
      role: 'user',
      legacyOwner: true,
    });
    expect(check?.legacy).toBe(true);
    expect(
      db
        .prepare('SELECT legacy FROM sessions')
        .all()
        .map((r) => r.legacy),
    ).toEqual([1, 1]);

    const token = sessions.create(LEGACY_OWNER_ID as never, NOW);
    expect(sessions.check(token, NOW)?.legacy).toBe(false);
  });

  it('is deterministic: two copies of the same v3 data give the same anna id, and her token works in both', async () => {
    const a = (await v3Fixture()).db;
    const b = (await v3Fixture()).db;
    migrate(a);
    migrate(b);
    const idOf = (db: Database) => db.prepare('SELECT id FROM users WHERE legacy_owner = 1').get()?.id;
    expect(idOf(a)).toBe(LEGACY_OWNER_ID);
    expect(idOf(b)).toBe(idOf(a));
    expect(createSessionStore(a).check(KEPT_TOKEN, NOW)?.user.id).toBe(LEGACY_OWNER_ID);
    expect(createSessionStore(b).check(KEPT_TOKEN, NOW)?.user.id).toBe(LEGACY_OWNER_ID);
  });

  it('takes created_at from the earliest of sessions, photos and day / weight / measure dates', async () => {
    const { db } = await v3Fixture();
    // Without the old weight, the oldest is the first session (2026-10-02 00:00 UTC).
    db.exec("DELETE FROM weights WHERE date = '2026-09-01'");
    db.exec("DELETE FROM measures WHERE date = '2026-10-01'");
    migrate(db);
    expect(db.prepare('SELECT created_at FROM users').get()?.created_at).toBe(Date.UTC(2026, 9, 2));
  });

  it('falls back to now for created_at when only the password exists', async () => {
    const db = fresh();
    migrate(db, MIGRATIONS.slice(0, 3));
    db.prepare("INSERT INTO kv (key, value) VALUES ('password_hash', 'scrypt$x')").run();
    const before = Date.now();
    migrate(db);
    const created = Number(db.prepare('SELECT created_at FROM users').get()?.created_at);
    expect(created).toBeGreaterThanOrEqual(Math.floor(before / 1000) * 1000);
    expect(created).toBeLessThanOrEqual(Date.now());
  });

  it('matches the §2.1 shapes (columns, keys, indexes)', async () => {
    const { db } = await v3Fixture();
    migrate(db);
    expect(columns(db, 'users')).toEqual([
      'id TEXT NN pk1',
      'username TEXT NN',
      'username_key TEXT NN',
      'password_hash TEXT',
      'role TEXT NN',
      'created_at INTEGER NN',
      'password_changed_at INTEGER',
      'password_changed_via TEXT',
      'password_changed_by TEXT',
      'last_seen_at INTEGER',
      'disabled_at INTEGER',
      'ai_daily_limit INTEGER',
      'legacy_owner INTEGER NN =0',
    ]);
    expect(columns(db, 'sessions')).toEqual([
      'token_hash TEXT NN pk1',
      'user_id TEXT NN',
      'created_at INTEGER NN',
      'renewed_at INTEGER NN',
      'expires_at INTEGER NN',
      'legacy INTEGER NN =0',
    ]);
    expect(columns(db, 'days')).toEqual([
      'user_id TEXT NN pk1',
      'date TEXT NN pk2',
      'food TEXT NN',
      'kcal INTEGER',
      'trained INTEGER',
      'types TEXT NN',
      'notes TEXT NN',
      'updated_at INTEGER NN',
      "photos TEXT NN ='[]'",
      'meals TEXT',
    ]);
    expect(columns(db, 'weights')).toEqual([
      'user_id TEXT NN pk1',
      'date TEXT NN pk2',
      'kg REAL NN',
      'updated_at INTEGER NN',
    ]);
    expect(columns(db, 'measures')).toEqual([
      'user_id TEXT NN pk1',
      'date TEXT NN pk2',
      'chest REAL',
      'waist REAL',
      'hips REAL',
      'updated_at INTEGER NN',
    ]);
    expect(columns(db, 'foods')).toEqual([
      'user_id TEXT NN pk1',
      'key TEXT NN pk2',
      'position INTEGER NN',
      'name TEXT NN',
      'portion TEXT NN',
      'kcal INTEGER NN',
      'count INTEGER NN',
      'last_used TEXT NN',
      'protein REAL',
      'fat REAL',
      'carbs REAL',
    ]);
    expect(columns(db, 'photos')).toEqual([
      'id TEXT NN pk1',
      'user_id TEXT NN',
      'date TEXT NN',
      'created_at INTEGER NN',
      'bytes INTEGER NN',
      'thumb_bytes INTEGER NN',
    ]);
    expect(columns(db, 'push_subscriptions')).toEqual([
      'endpoint TEXT NN pk1',
      'user_id TEXT NN',
      'p256dh TEXT NN',
      'auth TEXT NN',
      'user_agent TEXT',
      'created_at INTEGER NN',
      'last_ok_at INTEGER',
    ]);
    expect(columns(db, 'reminder_log')).toEqual([
      'user_id TEXT NN pk1',
      'kind TEXT NN pk2',
      'date TEXT NN pk3',
      'status TEXT NN',
      'sent INTEGER NN',
      'created_at INTEGER NN',
    ]);
    expect(columns(db, 'user_settings')).toEqual([
      'user_id TEXT NN pk1',
      'value TEXT NN',
      'updated_at INTEGER NN',
    ]);
    expect(columns(db, 'ai_usage')).toEqual(['user_id TEXT NN pk1', 'date TEXT NN pk2', 'count INTEGER NN']);
    expect(columns(db, 'invites').map((c) => c.split(' ')[0])).toEqual([
      'id',
      'token_hash',
      'role',
      'note',
      'created_by',
      'created_at',
      'expires_at',
      'used_at',
      'used_by',
      'revoked_at',
    ]);
    expect(columns(db, 'password_resets').map((c) => c.split(' ')[0])).toEqual([
      'id',
      'token_hash',
      'user_id',
      'purpose',
      'created_by',
      'created_at',
      'expires_at',
      'used_at',
      'revoked_at',
    ]);
    expect(indexes(db, 'users')).toEqual(['users_legacy_owner']);
    expect(indexes(db, 'sessions')).toEqual(['sessions_by_user']);
    expect(indexes(db, 'photos')).toEqual(['photos_by_user']);
    expect(indexes(db, 'push_subscriptions')).toEqual(['push_subscriptions_by_user']);
    expect(indexes(db, 'password_resets')).toEqual(['password_resets_by_user']);
    // Every per-user table cascades from users.
    for (const table of [...PER_USER_TABLES, 'user_settings', 'ai_usage', 'password_resets']) {
      const fks = db.prepare(`PRAGMA foreign_key_list(${table})`).all();
      expect(
        fks.some((f) => f.table === 'users' && f.from === 'user_id' && f.on_delete === 'CASCADE'),
        table,
      ).toBe(true);
    }
    expect(
      db
        .prepare('PRAGMA foreign_key_list(invites)')
        .all()
        .map((f) => `${String(f.from)} ${String(f.on_delete)}`)
        .sort(),
    ).toEqual(['created_by SET NULL', 'used_by SET NULL']);
  });

  it('a second migrate is a no-op', async () => {
    const { db } = await v3Fixture();
    migrate(db);
    const snapshot = Object.fromEntries(
      [...PER_USER_TABLES, 'users', 'user_settings', 'ai_usage', 'kv'].map((t) => [t, rows(db, t)]),
    );
    expect(migrate(db)).toBe(4);
    for (const [table, list] of Object.entries(snapshot)) expect(rows(db, table), table).toEqual(list);
  });

  it('a fresh database (v0 → v4) and a v3 database with only VAPID keys get no user', () => {
    const a = fresh();
    migrate(a);
    const b = fresh();
    migrate(b, MIGRATIONS.slice(0, 3));
    b.prepare(
      "INSERT INTO kv (key, value) VALUES ('vapid_public_key', 'x'), ('vapid_private_key', 'y')",
    ).run();
    migrate(b);
    for (const db of [a, b]) {
      expect(schemaVersion(db)).toBe(4);
      for (const table of [
        ...PER_USER_TABLES,
        'users',
        'user_settings',
        'ai_usage',
        'invites',
        'password_resets',
      ]) {
        expect(db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get()?.n, table).toBe(0);
      }
    }
  });

  it('a v3 database with only a stale login_failures entry still creates no user', () => {
    const db = fresh();
    migrate(db, MIGRATIONS.slice(0, 3));
    db.prepare("INSERT INTO kv (key, value) VALUES ('login_failures', '[]')").run();
    migrate(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM users').get()?.n).toBe(0);
  });

  it('restores the identity a downgrade parked in kv.legacy_user', () => {
    const db = fresh();
    migrate(db, MIGRATIONS.slice(0, 3));
    const id = '0123456789abcdef0123456789abcdef';
    db.prepare("INSERT INTO kv (key, value) VALUES ('legacy_user', ?), ('password_hash', 'scrypt$h')").run(
      JSON.stringify({ id, username: 'Anna.K', role: 'admin', createdAt: 1234 }),
    );
    migrate(db);
    expect({
      ...db.prepare('SELECT id, username, username_key, role, created_at, legacy_owner FROM users').get(),
    }).toEqual({
      id,
      username: 'Anna.K',
      username_key: 'anna.k',
      role: 'admin',
      created_at: 1234,
      legacy_owner: 1,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM kv WHERE key = 'legacy_user'").get()?.n).toBe(0);
  });

  it('a malformed kv.legacy_user id fails the migration: still v3, nothing changed', async () => {
    const { db } = await v3Fixture();
    db.prepare("INSERT INTO kv (key, value) VALUES ('legacy_user', ?)").run(
      JSON.stringify({ id: 'NOT-AN-ID' }),
    );
    const before = Object.fromEntries([...PER_USER_TABLES, 'kv'].map((t) => [t, rows(db, t)]));
    expect(() => migrate(db)).toThrow();
    expect(schemaVersion(db)).toBe(3);
    for (const [table, list] of Object.entries(before)) expect(rows(db, table), table).toEqual(list);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").get()).toBeUndefined();
  });

  it('a negative food_budget count is not copied (and does not fail the migration)', async () => {
    const { db } = await v3Fixture();
    db.prepare(
      'UPDATE kv SET value = \'{"date":"2026-10-21","count":-1}\' WHERE key = \'food_budget\'',
    ).run();
    migrate(db);
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_usage').get()?.n).toBe(0);
  });
});

describe('migrate(): foreign-key check', () => {
  it('throws and rolls back when a migration leaves a violation', () => {
    const db = fresh();
    // FKs are enforced on insert, so the violation is created with enforcement off (as a buggy migration could).
    db.exec('PRAGMA foreign_keys = OFF');
    expect(() =>
      migrate(db, [
        `CREATE TABLE parent (id INTEGER PRIMARY KEY);
         CREATE TABLE child (p INTEGER REFERENCES parent (id));
         INSERT INTO child (p) VALUES (7);`,
      ]),
    ).toThrow(/Migration v1 left foreign-key violations in child/);
    expect(schemaVersion(db)).toBe(0);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE name = 'child'").get()).toBeUndefined();
  });
});

describe('pre-migration snapshot of a v3 file', () => {
  it('writes backups/legko-pre-v4-<date>.db at user_version 3; a v4 file gets none', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'legko-v4-snap-'));
    try {
      const file = join(dir, 'legko.db');
      const raw = new (sqlite().DatabaseSync)(file, { enableForeignKeyConstraints: true });
      await v3Fixture(raw);
      raw.close();

      const now = () => new Date('2026-10-21T09:00:00Z');
      const db = openDatabase(file, { now });
      expect(schemaVersion(db)).toBe(4);
      db.close();
      const name = preMigrationBackupName(4, '2026-10-21');
      expect(name).toBe('legko-pre-v4-2026-10-21.db');
      expect(readdirSync(join(dir, 'backups'))).toEqual([name]);
      const copy = new (sqlite().DatabaseSync)(join(dir, 'backups', name), { readOnly: true });
      try {
        expect(schemaVersion(copy)).toBe(3);
        expect(copy.prepare('SELECT COUNT(*) AS n FROM days').get()?.n).toBe(3);
        expect(copy.prepare("SELECT name FROM sqlite_master WHERE name = 'users'").get()).toBeUndefined();
      } finally {
        copy.close();
      }

      openDatabase(file, { now: () => new Date('2026-10-22T09:00:00Z') }).close();
      expect(readdirSync(join(dir, 'backups'))).toEqual([name]);
      expect(existsSync(join(dir, 'backups', preMigrationBackupName(4, '2026-10-22')))).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('a second migration on the same date (deploy → downgrade → redeploy) never replaces the first snapshot', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'legko-v4-snap-'));
    try {
      const file = join(dir, 'legko.db');
      const backups = join(dir, 'backups');
      const raw = new (sqlite().DatabaseSync)(file, { enableForeignKeyConstraints: true });
      await v3Fixture(raw);
      raw.close();
      const now = () => new Date('2026-10-22T09:00:00Z');
      const first = join(backups, 'legko-pre-v4-2026-10-22.db');

      // Deploy: v3 → v4 writes the pristine pre-deploy copy.
      const db = openDatabase(file, { now });
      const pristine = readFileSync(first);
      // Something logged after the deploy, then the rollback (downgrade-schema) on the same day.
      db.prepare("INSERT INTO kv (key, value) VALUES ('after_deploy', 'x')").run();
      downgradeSchemaV4(db, backups, '2026-10-22', { keep: 'anna' });
      db.close();

      // Redeploy on the same day: the v3 → v4 migration runs again.
      const again = openDatabase(file, { now });
      expect(schemaVersion(again)).toBe(4);
      again.close();

      expect(readdirSync(backups).sort()).toEqual([
        'legko-pre-down-v4-2026-10-22.db',
        'legko-pre-v4-2026-10-22-2.db',
        'legko-pre-v4-2026-10-22.db',
      ]);
      // The first copy is byte-for-byte the pre-deploy database (schema v3, the original rows, nothing later).
      expect(readFileSync(first).equals(pristine)).toBe(true);
      const copy = new (sqlite().DatabaseSync)(first, { readOnly: true });
      try {
        expect(schemaVersion(copy)).toBe(3);
        expect(copy.prepare('SELECT COUNT(*) AS n FROM days').get()?.n).toBe(3);
        expect(copy.prepare("SELECT 1 AS found FROM kv WHERE key = 'after_deploy'").get()).toBeUndefined();
      } finally {
        copy.close();
      }
      // The second copy is the post-downgrade database.
      const second = new (sqlite().DatabaseSync)(join(backups, 'legko-pre-v4-2026-10-22-2.db'), {
        readOnly: true,
      });
      try {
        expect(schemaVersion(second)).toBe(3);
        expect(second.prepare("SELECT value FROM kv WHERE key = 'after_deploy'").get()?.value).toBe('x');
      } finally {
        second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
