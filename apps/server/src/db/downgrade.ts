import { join } from 'node:path';
import { usernameKey, type ISODate } from '@legko/shared';
import { preDowngradeBackupName, writeSnapshotOnce } from '../backup';
import { MIGRATIONS, schemaVersion } from './migrations';
import { num, text } from './rows';
import type { Database } from './sqlite';
import { transaction } from './tx';
import { createUserRepo, type UserRow } from './users';

/** Thrown when a downgrade is not possible as asked (nothing was changed). */
export class DowngradeRefused extends Error {
  override name = 'DowngradeRefused';
}

// ── v3 → v2 ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * Schema v3 → v2, for a rollback to the build before meals (DEPLOY.md): drops exactly the columns migration v3
 * added. Every day keeps its derived food text, kcal and first 12 photos (`days.food` / `kcal` / `photos` are
 * always written); the meal structure and all macros are lost. Do NOT just lower `user_version`: the v3
 * `ADD COLUMN` would then fail on the next upgrade, and a stale `meals` JSON would override newer food.
 */
export const DOWNGRADE_V3_SQL = `
  ALTER TABLE days DROP COLUMN meals;
  ALTER TABLE foods DROP COLUMN protein;
  ALTER TABLE foods DROP COLUMN fat;
  ALTER TABLE foods DROP COLUMN carbs;
  PRAGMA user_version = 2;
`;

export const DOWNGRADE_FROM = 3;

const refuseUnless = (db: Database, from: number): void => {
  const version = schemaVersion(db);
  if (version !== from) {
    throw new DowngradeRefused(
      `downgrade-schema only works on schema v${from}; this database is v${version}` +
        (version > MIGRATIONS.length ? ' (from a newer build)' : '') +
        '. Nothing was changed.',
    );
  }
};

/**
 * Writes `<backups>/legko-pre-down-v3-<date>.db` (`…-2.db` etc. when that exists: never replaced), then downgrades in
 * one transaction. Returns the snapshot path. Throws `DowngradeRefused` unless `user_version` is 3.
 */
export function downgradeSchemaV3(db: Database, backups: string, date: ISODate): string {
  refuseUnless(db, DOWNGRADE_FROM);
  const snapshot = writeSnapshotOnce(db, join(backups, preDowngradeBackupName(DOWNGRADE_FROM, date)));
  transaction(db, () => db.exec(DOWNGRADE_V3_SQL));
  return snapshot;
}

// ── v4 → v3 (docs/multi-user.md §2.4) ─────────────────────────────────────────────────────────────────────────────

export const DOWNGRADE_V4_FROM = 4;

/** Per-user tables whose rows are counted for the refusal / report. */
export const COUNTED_TABLES = [
  'days',
  'weights',
  'measures',
  'foods',
  'photos',
  'user_settings',
  'push_subscriptions',
] as const;
export type CountedTable = (typeof COUNTED_TABLES)[number];
/** Rows in these block the downgrade without `--drop-others` (settings and subscriptions alone do not). */
export const DATA_TABLES: readonly CountedTable[] = ['days', 'weights', 'measures', 'foods', 'photos'];

export interface UserCounts {
  id: string;
  username: string;
  counts: Record<CountedTable, number>;
}

export interface DowngradeReport {
  snapshot: string;
  /** The account whose data the v3 database keeps (null: there were no accounts). */
  kept: { id: string; username: string } | null;
  /** Every other account, with what was dropped. */
  dropped: UserCounts[];
}

export interface DowngradeV4Options {
  /** Username (case-insensitive) of the account to keep; default the only account. */
  keep?: string;
  /** Proceed even when other accounts own data (it is dropped; the counts are in the report). */
  dropOthers?: boolean;
}

/** One statement per table (each bound to one user): no dynamic SQL. */
const COUNT_SQL: Record<CountedTable, string> = {
  days: 'SELECT COUNT(*) AS n FROM days WHERE user_id = ?',
  weights: 'SELECT COUNT(*) AS n FROM weights WHERE user_id = ?',
  measures: 'SELECT COUNT(*) AS n FROM measures WHERE user_id = ?',
  foods: 'SELECT COUNT(*) AS n FROM foods WHERE user_id = ?',
  photos: 'SELECT COUNT(*) AS n FROM photos WHERE user_id = ?',
  user_settings: 'SELECT COUNT(*) AS n FROM user_settings WHERE user_id = ?',
  push_subscriptions: 'SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?',
};

/** The exact v3 shapes (columns, types, defaults, keys and checks of migrations 0–2). */
const V3_TABLES_SQL = `
  CREATE TABLE sessions_v3 (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    renewed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE days_v3 (
    date       TEXT PRIMARY KEY,
    food       TEXT NOT NULL,
    kcal       INTEGER,
    trained    INTEGER CHECK (trained IN (0, 1)),
    types      TEXT NOT NULL,
    notes      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    photos     TEXT NOT NULL DEFAULT '[]',
    meals      TEXT
  ) STRICT;
  CREATE TABLE weights_v3 (
    date       TEXT PRIMARY KEY,
    kg         REAL NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE measures_v3 (
    date       TEXT PRIMARY KEY,
    chest      REAL,
    waist      REAL,
    hips       REAL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE foods_v3 (
    key       TEXT PRIMARY KEY,
    position  INTEGER NOT NULL,
    name      TEXT NOT NULL,
    portion   TEXT NOT NULL,
    kcal      INTEGER NOT NULL,
    count     INTEGER NOT NULL,
    last_used TEXT NOT NULL,
    protein   REAL,
    fat       REAL,
    carbs     REAL
  ) STRICT;
  CREATE TABLE photos_v3 (
    id          TEXT PRIMARY KEY,
    date        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    bytes       INTEGER NOT NULL,
    thumb_bytes INTEGER NOT NULL
  ) STRICT;
  CREATE TABLE push_subscriptions_v3 (
    endpoint   TEXT PRIMARY KEY,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    last_ok_at INTEGER
  ) STRICT;
  CREATE TABLE reminder_log_v3 (
    kind       TEXT NOT NULL,
    date       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('sent', 'skipped')),
    sent       INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (kind, date)
  ) STRICT;
`;

/** Copies of the kept account's rows only (explicit columns; each binds that account's id). */
const V3_COPY_SQL: readonly string[] = [
  `INSERT INTO sessions_v3 (token_hash, created_at, renewed_at, expires_at)
     SELECT token_hash, created_at, renewed_at, expires_at FROM sessions WHERE user_id = ?`,
  `INSERT INTO days_v3 (date, food, kcal, trained, types, notes, updated_at, photos, meals)
     SELECT date, food, kcal, trained, types, notes, updated_at, photos, meals FROM days WHERE user_id = ?`,
  `INSERT INTO weights_v3 (date, kg, updated_at) SELECT date, kg, updated_at FROM weights WHERE user_id = ?`,
  `INSERT INTO measures_v3 (date, chest, waist, hips, updated_at)
     SELECT date, chest, waist, hips, updated_at FROM measures WHERE user_id = ?`,
  `INSERT INTO foods_v3 (key, position, name, portion, kcal, count, last_used, protein, fat, carbs)
     SELECT key, position, name, portion, kcal, count, last_used, protein, fat, carbs FROM foods WHERE user_id = ?`,
  `INSERT INTO photos_v3 (id, date, created_at, bytes, thumb_bytes)
     SELECT id, date, created_at, bytes, thumb_bytes FROM photos WHERE user_id = ?`,
  `INSERT INTO push_subscriptions_v3 (endpoint, p256dh, auth, user_agent, created_at, last_ok_at)
     SELECT endpoint, p256dh, auth, user_agent, created_at, last_ok_at FROM push_subscriptions WHERE user_id = ?`,
  `INSERT INTO reminder_log_v3 (kind, date, status, sent, created_at)
     SELECT kind, date, status, sent, created_at FROM reminder_log WHERE user_id = ?`,
];

/** Old tables out, v3 copies in, the v4-only tables dropped (children before `users`). */
const V3_SWAP_SQL = `
  DROP TABLE sessions;           ALTER TABLE sessions_v3 RENAME TO sessions;
  DROP TABLE days;               ALTER TABLE days_v3 RENAME TO days;
  DROP TABLE weights;            ALTER TABLE weights_v3 RENAME TO weights;
  DROP TABLE measures;           ALTER TABLE measures_v3 RENAME TO measures;
  DROP TABLE foods;              ALTER TABLE foods_v3 RENAME TO foods;
  DROP TABLE photos;             ALTER TABLE photos_v3 RENAME TO photos;
  DROP TABLE push_subscriptions; ALTER TABLE push_subscriptions_v3 RENAME TO push_subscriptions;
  DROP TABLE reminder_log;       ALTER TABLE reminder_log_v3 RENAME TO reminder_log;
  DROP TABLE ai_usage;
  DROP TABLE invites;
  DROP TABLE password_resets;
  DROP TABLE user_settings;
  DROP TABLE users;
  PRAGMA user_version = 3;
`;

function countsOf(db: Database, user: UserRow): UserCounts {
  const counts = {} as Record<CountedTable, number>;
  for (const table of COUNTED_TABLES) {
    counts[table] = num(db.prepare(COUNT_SQL[table]).get(user.id) ?? { n: 0 }, 'n');
  }
  return { id: user.id, username: user.username, counts };
}

const describeCounts = (u: UserCounts): string =>
  `${u.username}: ${COUNTED_TABLES.map((t) => `${t} ${u.counts[t]}`).join(', ')}`;

/**
 * Schema v4 → v3 for a rollback to the build before accounts. Keeps ONE account (`keep`, or the only one): its
 * password hash, settings and identity go back to `kv` (`password_hash`, `settings`, `legacy_user`, so a
 * re-upgrade gives it the same id), its rows to the exact v3 tables. Everything else — other accounts and their
 * data, invites, reset links, per-user AI counts, admin-saved AI limits — is dropped. Refused (nothing changed) unless
 * the database is v4, when the account to keep is ambiguous or unknown, or — without `dropOthers` — when another
 * account owns days, weights, measures, dishes or photos. Writes `<backups>/legko-pre-down-v4-<date>.db` first (never
 * replaced: a second downgrade on the same date writes `…-2.db`, so the dropped accounts' data stays in the first copy).
 * Photo files of dropped accounts stay until the v3 photo GC removes them as stray files.
 */
export function downgradeSchemaV4(
  db: Database,
  backups: string,
  date: ISODate,
  { keep, dropOthers = false }: DowngradeV4Options = {},
): DowngradeReport {
  refuseUnless(db, DOWNGRADE_V4_FROM);
  const users = createUserRepo(db);
  const all = users.list();
  let kept: UserRow | null;
  if (keep !== undefined) {
    kept = users.byKey(usernameKey(keep));
    if (!kept) throw new DowngradeRefused(`No account named "${keep}". Nothing was changed.`);
  } else if (all.length > 1) {
    throw new DowngradeRefused(
      `There are ${all.length} accounts (${all.map((u) => u.username).join(', ')}): ` +
        'pass --keep <username> to choose the one the old build keeps. Nothing was changed.',
    );
  } else {
    kept = all[0] ?? null;
  }

  const others = all.filter((u) => u.id !== kept?.id).map((u) => countsOf(db, u));
  const blocking = others.filter((u) => DATA_TABLES.some((t) => u.counts[t] > 0));
  if (blocking.length && !dropOthers) {
    throw new DowngradeRefused(
      `Other accounts own data that the old build cannot keep:\n${blocking.map((u) => `  ${describeCounts(u)}`).join('\n')}\n` +
        'Re-run with --drop-others to drop it (a snapshot is saved first). Nothing was changed.',
    );
  }

  const snapshot = writeSnapshotOnce(db, join(backups, preDowngradeBackupName(DOWNGRADE_V4_FROM, date)));
  transaction(db, () => {
    const keptId = kept?.id ?? '';
    db.prepare("DELETE FROM kv WHERE key IN ('password_hash', 'settings', 'legacy_user', 'ai_limits')").run();
    const putKv = db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)');
    if (kept) {
      if (kept.passwordHash !== null) putKv.run('password_hash', kept.passwordHash);
      const settings = db.prepare('SELECT value FROM user_settings WHERE user_id = ?').get(kept.id);
      if (settings) putKv.run('settings', text(settings, 'value'));
      putKv.run(
        'legacy_user',
        JSON.stringify({ id: kept.id, username: kept.username, role: kept.role, createdAt: kept.createdAt }),
      );
    }
    db.exec(V3_TABLES_SQL);
    for (const sql of V3_COPY_SQL) db.prepare(sql).run(keptId);
    db.exec(V3_SWAP_SQL);
  });
  return { snapshot, kept: kept ? { id: kept.id, username: kept.username } : null, dropped: others };
}
