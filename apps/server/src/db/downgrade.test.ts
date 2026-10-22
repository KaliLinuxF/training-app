import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defaultSettings, LEGACY_OWNER_ID, type Op } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from '../auth/password';
import { createSessionStore } from '../auth/sessions';
import { createSubscriptionRepo } from '../push/subscriptions';
import { createReminderLog } from '../reminders/log';
import { createDataRepos } from './data';
import { downgradeSchemaV3, downgradeSchemaV4, DowngradeRefused } from './downgrade';
import { migrate, MIGRATIONS, schemaVersion } from './migrations';
import { sqlite, type Database, type Row } from './sqlite';
import { createTokenRepo } from './tokens';
import { createUserRepo, type UserId } from './users';

const TEST_SCRYPT = { N: 1024, r: 8, p: 1 };
const NOW = Date.UTC(2026, 9, 21, 12, 0);
const DATE = '2026-10-21';

const fresh = (): Database => new (sqlite().DatabaseSync)(':memory:', { enableForeignKeyConstraints: true });

const ANNA_OPS: Op[] = [
  {
    kind: 'day.put',
    date: '2026-10-10',
    value: { food: 'Борщ', kcal: 500, trained: true, types: ['Кардіо'], notes: '' },
  },
  {
    kind: 'meal.put',
    date: '2026-10-11',
    value: {
      id: 'breakfast001',
      type: 'Сніданок',
      time: '08:30',
      text: 'Тост',
      kcal: 420,
      protein: 27,
      fat: null,
      carbs: 36,
      photos: ['AAAAAAAAAAAAAAAAAAAAAA'],
    },
  },
  { kind: 'weight.put', date: '2026-10-10', kg: 65.4 },
  { kind: 'measure.put', date: '2026-10-10', value: { chest: 90, waist: 70, hips: null } },
  { kind: 'food.use', date: '2026-10-10', value: { name: 'Борщ', portion: '300 г', kcal: 180, protein: 6 } },
  { kind: 'settings.put', value: { ...defaultSettings(), goal: 57 } },
];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legko-down-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

/** v3 data migrated to v4 (anna = the legacy owner), plus an empty «admin». */
async function v4WithAnnaAndAdmin(): Promise<{
  db: Database;
  anna: UserId;
  admin: UserId;
  token: string;
  hash: string;
}> {
  const db = fresh();
  migrate(db, MIGRATIONS.slice(0, 3));
  const hash = await hashPassword('old password', TEST_SCRYPT);
  db.prepare("INSERT INTO kv (key, value) VALUES ('password_hash', ?)").run(hash);
  db.exec(
    `INSERT INTO sessions (token_hash, created_at, renewed_at, expires_at) VALUES ('${'0'.repeat(64)}', 1, 1, 9e15)`,
  );
  migrate(db);
  const users = createUserRepo(db);
  const anna = LEGACY_OWNER_ID as UserId;
  createDataRepos(db, () => NOW)
    .forUser(anna)
    .apply(ANNA_OPS);
  db.prepare(
    "INSERT INTO photos (id, user_id, date, created_at, bytes, thumb_bytes) VALUES ('AAAAAAAAAAAAAAAAAAAAAA', ?, '2026-10-11', 5, 10, 1)",
  ).run(anna);
  createSubscriptionRepo(db)
    .forUser(anna)
    .upsert({ endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' }, null, 7);
  createReminderLog(db).forUser(anna).record('weigh', '2026-10-10', 'sent', 1, 8);
  const token = createSessionStore(db).create(anna, NOW);
  const admin = users.create({ username: 'admin', role: 'admin', passwordHash: null, now: NOW }).id;
  createTokenRepo(db).createReset({ userId: admin, purpose: 'setup', createdBy: null, now: NOW });
  db.prepare('INSERT INTO kv (key, value) VALUES (\'ai_limits\', \'{"perUser":5,"global":9}\')').run();
  return { db, anna, admin, token, hash };
}

const tableInfo = (db: Database): Record<string, unknown[]> =>
  Object.fromEntries(
    db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((t) => [
        String(t.name),
        db
          .prepare(`PRAGMA table_info(${String(t.name)})`)
          .all()
          .map((c: Row) => ({ ...c })),
      ]),
  );

const all = (db: Database, table: string) =>
  db
    .prepare(`SELECT * FROM ${table}`)
    .all()
    .map((r: Row) => ({ ...r }));

describe('downgrade-schema v4 → v3', () => {
  it('keeps anna in the exact v3 shapes, restores kv, and a re-upgrade gives her the same id and sessions', async () => {
    const { db, anna, hash } = await v4WithAnnaAndAdmin();
    const before = createDataRepos(db).forUser(anna).read();

    const report = downgradeSchemaV4(db, dir, DATE, { keep: 'Anna' });
    expect(report.kept).toEqual({ id: anna, username: 'anna' });
    expect(report.dropped).toEqual([
      {
        id: expect.any(String),
        username: 'admin',
        counts: {
          days: 0,
          weights: 0,
          measures: 0,
          foods: 0,
          photos: 0,
          user_settings: 0,
          push_subscriptions: 0,
        },
      },
    ]);
    expect(existsSync(report.snapshot)).toBe(true);
    expect(report.snapshot.endsWith('legko-pre-down-v4-2026-10-21.db')).toBe(true);

    expect(schemaVersion(db)).toBe(3);
    const v3 = fresh();
    migrate(v3, MIGRATIONS.slice(0, 3));
    expect(tableInfo(db)).toEqual(tableInfo(v3));
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);

    const kv = Object.fromEntries(all(db, 'kv').map((r) => [r.key, r.value]));
    expect(kv.password_hash).toBe(hash);
    expect(JSON.parse(String(kv.settings))).toMatchObject({ goal: 57 });
    expect(JSON.parse(String(kv.legacy_user))).toEqual({
      id: anna,
      username: 'anna',
      role: 'user',
      createdAt: expect.any(Number),
    });
    expect(kv.ai_limits).toBeUndefined();
    expect(all(db, 'days').map((d) => d.date)).toEqual(['2026-10-10', '2026-10-11']);
    expect(all(db, 'sessions')).toHaveLength(2);
    expect(all(db, 'push_subscriptions')).toHaveLength(1);
    expect(all(db, 'reminder_log')).toHaveLength(1);
    expect(all(db, 'photos')).toHaveLength(1);

    // Re-upgrade (the next v4 deploy): the same identity, hash and sessions.
    migrate(db);
    const users = createUserRepo(db).list();
    expect(users).toHaveLength(1);
    expect(users[0]).toMatchObject({
      id: anna,
      username: 'anna',
      role: 'user',
      legacyOwner: true,
      passwordHash: hash,
    });
    expect(await verifyPassword('old password', String(users[0]?.passwordHash))).toBe(true);
    expect(createDataRepos(db).forUser(anna).read()).toEqual(before);
    expect(
      db
        .prepare('SELECT legacy FROM sessions')
        .all()
        .map((r) => r.legacy),
    ).toEqual([1, 1]);
  });

  it('her v4 session token still works after the round trip (as a legacy session)', async () => {
    const { db, anna, token } = await v4WithAnnaAndAdmin();
    downgradeSchemaV4(db, dir, DATE, { keep: 'anna' });
    migrate(db);
    const check = createSessionStore(db).check(token, NOW);
    expect(check?.user.id).toBe(anna);
    expect(check?.legacy).toBe(true);
  });

  it('uses the only account without --keep', async () => {
    const db = fresh();
    migrate(db);
    const solo = createUserRepo(db).create({
      username: 'olya',
      role: 'user',
      passwordHash: 'scrypt$x',
      now: 5,
    });
    const report = downgradeSchemaV4(db, dir, DATE);
    expect(report.kept).toEqual({ id: solo.id, username: 'olya' });
    expect(JSON.parse(String(all(db, 'kv').find((r) => r.key === 'legacy_user')?.value))).toMatchObject({
      id: solo.id,
    });
  });

  it('refuses without --keep when there are several accounts (nothing changed)', async () => {
    const { db } = await v4WithAnnaAndAdmin();
    expect(() => downgradeSchemaV4(db, dir, DATE)).toThrow(DowngradeRefused);
    expect(() => downgradeSchemaV4(db, dir, DATE)).toThrow(/--keep/);
    expect(schemaVersion(db)).toBe(4);
    expect(existsSync(join(dir, 'legko-pre-down-v4-2026-10-21.db'))).toBe(false);
  });

  it('refuses an unknown --keep name and a v3 database', async () => {
    const { db } = await v4WithAnnaAndAdmin();
    expect(() => downgradeSchemaV4(db, dir, DATE, { keep: 'nobody' })).toThrow(/No account named/);
    expect(schemaVersion(db)).toBe(4);
    const v3 = fresh();
    migrate(v3, MIGRATIONS.slice(0, 3));
    expect(() => downgradeSchemaV4(v3, dir, DATE, { keep: 'anna' })).toThrow(/only works on schema v4/);
    expect(schemaVersion(v3)).toBe(3);
  });

  it('refuses while another account owns data, listing per-table counts and naming --drop-others', async () => {
    const { db, admin } = await v4WithAnnaAndAdmin();
    createDataRepos(db)
      .forUser(admin)
      .apply([{ kind: 'weight.put', date: '2026-10-12', kg: 80 }]);
    const olya = createUserRepo(db).create({ username: 'olya', role: 'user', passwordHash: null, now: 1 }).id;
    createDataRepos(db)
      .forUser(olya)
      .apply([
        {
          kind: 'day.put',
          date: '2026-10-12',
          value: { food: 'x', kcal: null, trained: null, types: [], notes: '' },
        },
        { kind: 'settings.put', value: defaultSettings() },
      ]);
    let message = '';
    try {
      downgradeSchemaV4(db, dir, DATE, { keep: 'anna' });
    } catch (err) {
      expect(err).toBeInstanceOf(DowngradeRefused);
      message = (err as Error).message;
    }
    expect(message).toContain('admin: days 0, weights 1, measures 0, foods 0, photos 0, user_settings 0');
    expect(message).toContain('olya: days 1, weights 0');
    expect(message).toContain('user_settings 1');
    expect(message).toContain('--drop-others');
    expect(schemaVersion(db)).toBe(4);
    expect(all(db, 'weights')).toHaveLength(2);
    expect(existsSync(join(dir, 'legko-pre-down-v4-2026-10-21.db'))).toBe(false);
  });

  it('with --drop-others keeps only the kept account’s rows and reports what was dropped', async () => {
    const { db, anna, admin } = await v4WithAnnaAndAdmin();
    createDataRepos(db)
      .forUser(admin)
      .apply([
        { kind: 'weight.put', date: '2026-10-12', kg: 80 },
        {
          kind: 'day.put',
          date: '2026-10-10',
          value: { food: 'admin', kcal: 1, trained: null, types: [], notes: '' },
        },
      ]);
    createSubscriptionRepo(db)
      .forUser(admin)
      .upsert({ endpoint: 'https://push.example/z', p256dh: 'p', auth: 'z' }, null, 1);
    const report = downgradeSchemaV4(db, dir, DATE, { keep: 'anna', dropOthers: true });
    expect(report.dropped).toEqual([
      {
        id: admin,
        username: 'admin',
        counts: {
          days: 1,
          weights: 1,
          measures: 0,
          foods: 0,
          photos: 0,
          user_settings: 0,
          push_subscriptions: 1,
        },
      },
    ]);
    expect(report.kept?.id).toBe(anna);
    expect(all(db, 'weights').map((w) => w.kg)).toEqual([65.4]);
    expect(all(db, 'days').map((d) => d.food)).toEqual(['Борщ', 'Сніданок: Тост']);
    expect(all(db, 'push_subscriptions').map((s) => s.endpoint)).toEqual(['https://push.example/a']);
    for (const gone of ['users', 'user_settings', 'ai_usage', 'invites', 'password_resets']) {
      expect(db.prepare('SELECT name FROM sqlite_master WHERE name = ?').get(gone), gone).toBeUndefined();
    }
  });

  it('two downgrades on the same date keep both pre-down snapshots (the first holds the dropped accounts)', async () => {
    const { db, admin } = await v4WithAnnaAndAdmin();
    createDataRepos(db)
      .forUser(admin)
      .apply([{ kind: 'weight.put', date: '2026-10-12', kg: 80 }]);
    const first = downgradeSchemaV4(db, dir, DATE, { keep: 'anna', dropOthers: true });
    expect(first.snapshot).toBe(join(dir, 'legko-pre-down-v4-2026-10-21.db'));
    const firstBytes = readFileSync(first.snapshot);

    // Redeployed and rolled back again the same day: a new copy next to the first, which is unchanged.
    migrate(db);
    const second = downgradeSchemaV4(db, dir, DATE, { keep: 'anna', dropOthers: true });
    expect(second.snapshot).toBe(join(dir, 'legko-pre-down-v4-2026-10-21-2.db'));
    expect(readFileSync(first.snapshot).equals(firstBytes)).toBe(true);
    const copy = new (sqlite().DatabaseSync)(first.snapshot, { readOnly: true });
    try {
      expect(schemaVersion(copy)).toBe(4);
      expect(copy.prepare('SELECT kg FROM weights WHERE user_id = ?').get(admin)?.kg).toBe(80);
    } finally {
      copy.close();
    }

    // The v3 → v2 step never replaces its snapshot either.
    expect(downgradeSchemaV3(db, dir, DATE)).toBe(join(dir, 'legko-pre-down-v3-2026-10-21.db'));
    migrate(db, MIGRATIONS.slice(0, 3));
    expect(downgradeSchemaV3(db, dir, DATE)).toBe(join(dir, 'legko-pre-down-v3-2026-10-21-2.db'));
    expect(readdirSync(dir).sort()).toEqual([
      'legko-pre-down-v3-2026-10-21-2.db',
      'legko-pre-down-v3-2026-10-21.db',
      'legko-pre-down-v4-2026-10-21-2.db',
      'legko-pre-down-v4-2026-10-21.db',
    ]);
  });

  it('a fresh v4 database without accounts goes down empty', () => {
    const db = fresh();
    migrate(db);
    const report = downgradeSchemaV4(db, dir, DATE);
    expect(report).toMatchObject({ kept: null, dropped: [] });
    expect(schemaVersion(db)).toBe(3);
    expect(all(db, 'kv')).toEqual([]);
  });

  it('the v3 → v2 step stays: refused on v4, works after the v4 → v3 step', async () => {
    const { db } = await v4WithAnnaAndAdmin();
    expect(() => downgradeSchemaV3(db, dir, DATE)).toThrow(/only works on schema v3/);
    downgradeSchemaV4(db, dir, DATE, { keep: 'anna' });
    downgradeSchemaV3(db, dir, DATE);
    expect(schemaVersion(db)).toBe(2);
    expect(
      db
        .prepare('PRAGMA table_info(days)')
        .all()
        .map((c) => c.name),
    ).not.toContain('meals');
  });
});
