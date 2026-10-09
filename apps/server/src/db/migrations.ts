import type { Database } from './sqlite';
import { transaction } from './tx';

/**
 * Schema history. Entry `i` upgrades `PRAGMA user_version` from `i` to `i + 1`.
 * Never edit a released entry — append a new one.
 */
export const MIGRATIONS: readonly string[] = [
  `
  CREATE TABLE kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  ) STRICT;

  CREATE TABLE sessions (
    token_hash TEXT PRIMARY KEY,
    created_at INTEGER NOT NULL,
    renewed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE days (
    date       TEXT PRIMARY KEY,
    food       TEXT NOT NULL,
    kcal       INTEGER,
    trained    INTEGER CHECK (trained IN (0, 1)),
    types      TEXT NOT NULL,
    notes      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE weights (
    date       TEXT PRIMARY KEY,
    kg         REAL NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE measures (
    date       TEXT PRIMARY KEY,
    chest      REAL,
    waist      REAL,
    hips       REAL,
    updated_at INTEGER NOT NULL
  ) STRICT;

  CREATE TABLE push_subscriptions (
    endpoint   TEXT PRIMARY KEY,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    last_ok_at INTEGER
  ) STRICT;

  CREATE TABLE reminder_log (
    kind       TEXT NOT NULL,
    date       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('sent', 'skipped')),
    sent       INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (kind, date)
  ) STRICT;
  `,
  // v2: food photo diary and «Часті страви».
  `
  ALTER TABLE days ADD COLUMN photos TEXT NOT NULL DEFAULT '[]';

  CREATE TABLE foods (
    key       TEXT PRIMARY KEY,
    position  INTEGER NOT NULL,
    name      TEXT NOT NULL,
    portion   TEXT NOT NULL,
    kcal      INTEGER NOT NULL,
    count     INTEGER NOT NULL,
    last_used TEXT NOT NULL
  ) STRICT;

  CREATE TABLE photos (
    id          TEXT PRIMARY KEY,
    date        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    bytes       INTEGER NOT NULL,
    thumb_bytes INTEGER NOT NULL
  ) STRICT;
  `,
];

export function schemaVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get();
  const v = row?.user_version;
  return typeof v === 'number' ? v : 0;
}

/** Applies pending migrations, each in its own transaction. Returns the resulting version. */
export function migrate(db: Database, migrations: readonly string[] = MIGRATIONS): number {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    throw new Error(`Database schema v${current} is newer than this build (v${migrations.length})`);
  }
  for (let v = current; v < migrations.length; v++) {
    const sql = migrations[v] ?? '';
    transaction(db, () => {
      db.exec(sql);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return migrations.length;
}
