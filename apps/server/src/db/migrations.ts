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
  // v3: meals and macros. Additive only: NULL meals = a legacy day, NULL macros = unknown.
  // Reversed by `downgrade-schema` (db/downgrade.ts), which drops exactly these columns.
  `
  ALTER TABLE days ADD COLUMN meals TEXT;
  ALTER TABLE foods ADD COLUMN protein REAL;
  ALTER TABLE foods ADD COLUMN fat REAL;
  ALTER TABLE foods ADD COLUMN carbs REAL;
  `,
  // v4: user accounts (docs/multi-user.md §2). Every per-user table is rebuilt with user_id in its primary key; the
  // single v3 account becomes the legacy owner «anna» (role user, her own hash, LEGACY_OWNER_ID unless kv.legacy_user
  // names an id), and every existing row and session is attached to her. No admin and no known password are created.
  // Reversed by `downgrade-schema` (db/downgrade.ts, downgradeSchemaV4).
  `
  CREATE TABLE users (
    id                   TEXT PRIMARY KEY CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
    username             TEXT NOT NULL CHECK (length(username) BETWEEN 3 AND 32),
    username_key         TEXT NOT NULL UNIQUE,
    password_hash        TEXT,
    role                 TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    created_at           INTEGER NOT NULL,
    password_changed_at  INTEGER,
    password_changed_via TEXT CHECK (password_changed_via IN ('self', 'reset', 'setup', 'cli')),
    password_changed_by  TEXT REFERENCES users (id) ON DELETE SET NULL,
    last_seen_at         INTEGER,
    disabled_at          INTEGER,
    ai_daily_limit       INTEGER CHECK (ai_daily_limit BETWEEN 0 AND 1000),
    legacy_owner         INTEGER NOT NULL DEFAULT 0 CHECK (legacy_owner IN (0, 1))
  ) STRICT;
  CREATE UNIQUE INDEX users_legacy_owner ON users (legacy_owner) WHERE legacy_owner = 1;

  INSERT INTO users (id, username, username_key, password_hash, role, created_at, legacy_owner)
  SELECT
    COALESCE((SELECT json_extract(value, '$.id') FROM kv WHERE key = 'legacy_user' AND json_valid(value)),
             '00000000000000000000000000000001'),
    COALESCE((SELECT json_extract(value, '$.username') FROM kv WHERE key = 'legacy_user' AND json_valid(value)),
             'anna'),
    lower(COALESCE((SELECT json_extract(value, '$.username') FROM kv WHERE key = 'legacy_user' AND json_valid(value)),
                   'anna')),
    (SELECT value FROM kv WHERE key = 'password_hash'),
    COALESCE((SELECT json_extract(value, '$.role') FROM kv WHERE key = 'legacy_user' AND json_valid(value)), 'user'),
    COALESCE(
      (SELECT json_extract(value, '$.createdAt') FROM kv WHERE key = 'legacy_user' AND json_valid(value)),
      (SELECT MIN(t) FROM (
         SELECT MIN(created_at) AS t FROM sessions
         UNION ALL SELECT MIN(created_at) FROM photos
         UNION ALL SELECT CAST(strftime('%s', MIN(date)) AS INTEGER) * 1000 FROM days
         UNION ALL SELECT CAST(strftime('%s', MIN(date)) AS INTEGER) * 1000 FROM weights
         UNION ALL SELECT CAST(strftime('%s', MIN(date)) AS INTEGER) * 1000 FROM measures)),
      CAST(strftime('%s', 'now') AS INTEGER) * 1000),
    1
  WHERE EXISTS (SELECT 1 FROM kv WHERE key IN ('password_hash', 'settings', 'food_budget', 'legacy_user'))
     OR EXISTS (SELECT 1 FROM days) OR EXISTS (SELECT 1 FROM weights) OR EXISTS (SELECT 1 FROM measures)
     OR EXISTS (SELECT 1 FROM foods) OR EXISTS (SELECT 1 FROM photos) OR EXISTS (SELECT 1 FROM sessions)
     OR EXISTS (SELECT 1 FROM push_subscriptions) OR EXISTS (SELECT 1 FROM reminder_log);

  CREATE TABLE user_settings (
    user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) STRICT;
  INSERT INTO user_settings (user_id, value, updated_at)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), value, CAST(strftime('%s', 'now') AS INTEGER) * 1000
    FROM kv WHERE key = 'settings';

  CREATE TABLE sessions_v4 (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    renewed_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    legacy     INTEGER NOT NULL DEFAULT 0 CHECK (legacy IN (0, 1))
  ) STRICT;
  INSERT INTO sessions_v4 (user_id, token_hash, created_at, renewed_at, expires_at, legacy)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), token_hash, created_at, renewed_at, expires_at, 1
    FROM sessions;
  DROP TABLE sessions;
  ALTER TABLE sessions_v4 RENAME TO sessions;
  CREATE INDEX sessions_by_user ON sessions (user_id);

  CREATE TABLE days_v4 (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    food       TEXT NOT NULL,
    kcal       INTEGER,
    trained    INTEGER CHECK (trained IN (0, 1)),
    types      TEXT NOT NULL,
    notes      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    photos     TEXT NOT NULL DEFAULT '[]',
    meals      TEXT,
    PRIMARY KEY (user_id, date)
  ) STRICT;
  INSERT INTO days_v4 (user_id, date, food, kcal, trained, types, notes, updated_at, photos, meals)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), date, food, kcal, trained, types, notes, updated_at,
           photos, meals
    FROM days;
  DROP TABLE days;
  ALTER TABLE days_v4 RENAME TO days;

  CREATE TABLE weights_v4 (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    kg         REAL NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  ) STRICT;
  INSERT INTO weights_v4 (user_id, date, kg, updated_at)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), date, kg, updated_at FROM weights;
  DROP TABLE weights;
  ALTER TABLE weights_v4 RENAME TO weights;

  CREATE TABLE measures_v4 (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    chest      REAL,
    waist      REAL,
    hips       REAL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  ) STRICT;
  INSERT INTO measures_v4 (user_id, date, chest, waist, hips, updated_at)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), date, chest, waist, hips, updated_at FROM measures;
  DROP TABLE measures;
  ALTER TABLE measures_v4 RENAME TO measures;

  CREATE TABLE foods_v4 (
    user_id   TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    key       TEXT NOT NULL,
    position  INTEGER NOT NULL,
    name      TEXT NOT NULL,
    portion   TEXT NOT NULL,
    kcal      INTEGER NOT NULL,
    count     INTEGER NOT NULL,
    last_used TEXT NOT NULL,
    protein   REAL,
    fat       REAL,
    carbs     REAL,
    PRIMARY KEY (user_id, key)
  ) STRICT;
  INSERT INTO foods_v4 (user_id, key, position, name, portion, kcal, count, last_used, protein, fat, carbs)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), key, position, name, portion, kcal, count, last_used,
           protein, fat, carbs
    FROM foods;
  DROP TABLE foods;
  ALTER TABLE foods_v4 RENAME TO foods;

  CREATE TABLE photos_v4 (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date        TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    bytes       INTEGER NOT NULL,
    thumb_bytes INTEGER NOT NULL
  ) STRICT;
  INSERT INTO photos_v4 (user_id, id, date, created_at, bytes, thumb_bytes)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), id, date, created_at, bytes, thumb_bytes FROM photos;
  DROP TABLE photos;
  ALTER TABLE photos_v4 RENAME TO photos;
  CREATE INDEX photos_by_user ON photos (user_id);

  CREATE TABLE push_subscriptions_v4 (
    endpoint   TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    user_agent TEXT,
    created_at INTEGER NOT NULL,
    last_ok_at INTEGER
  ) STRICT;
  INSERT INTO push_subscriptions_v4 (user_id, endpoint, p256dh, auth, user_agent, created_at, last_ok_at)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), endpoint, p256dh, auth, user_agent, created_at, last_ok_at
    FROM push_subscriptions;
  DROP TABLE push_subscriptions;
  ALTER TABLE push_subscriptions_v4 RENAME TO push_subscriptions;
  CREATE INDEX push_subscriptions_by_user ON push_subscriptions (user_id);

  CREATE TABLE reminder_log_v4 (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    kind       TEXT NOT NULL,
    date       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('sent', 'skipped')),
    sent       INTEGER NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, kind, date)
  ) STRICT;
  INSERT INTO reminder_log_v4 (user_id, kind, date, status, sent, created_at)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), kind, date, status, sent, created_at FROM reminder_log;
  DROP TABLE reminder_log;
  ALTER TABLE reminder_log_v4 RENAME TO reminder_log;

  CREATE TABLE ai_usage (
    user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date    TEXT NOT NULL,
    count   INTEGER NOT NULL CHECK (count >= 0),
    PRIMARY KEY (user_id, date)
  ) STRICT;
  INSERT INTO ai_usage (user_id, date, count)
    SELECT (SELECT id FROM users WHERE legacy_owner = 1), json_extract(value, '$.date'), json_extract(value, '$.count')
    FROM kv
    WHERE key = 'food_budget' AND json_valid(value)
      AND typeof(json_extract(value, '$.date')) = 'text'
      AND typeof(json_extract(value, '$.count')) = 'integer'
      AND json_extract(value, '$.count') >= 0;

  CREATE TABLE invites (
    id         TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    role       TEXT NOT NULL CHECK (role IN ('admin', 'user')),
    note       TEXT NOT NULL DEFAULT '',
    created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    used_by    TEXT REFERENCES users (id) ON DELETE SET NULL,
    revoked_at INTEGER
  ) STRICT;

  CREATE TABLE password_resets (
    id         TEXT PRIMARY KEY,
    token_hash TEXT NOT NULL UNIQUE,
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    purpose    TEXT NOT NULL CHECK (purpose IN ('reset', 'setup')),
    created_by TEXT REFERENCES users (id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER,
    revoked_at INTEGER
  ) STRICT;
  CREATE INDEX password_resets_by_user ON password_resets (user_id);

  DELETE FROM kv WHERE key IN ('password_hash', 'settings', 'legacy_user');
  `,
  // v5: workouts and steps (docs/workouts-steps-rebrand.md §1.8). Additive: no existing row changes.
  `
  CREATE TABLE exercises (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    position   INTEGER NOT NULL,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  ) STRICT;

  CREATE TABLE workouts (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    position   INTEGER NOT NULL,
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  ) STRICT;

  CREATE TABLE workout_sessions (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    id         TEXT NOT NULL,
    date       TEXT NOT NULL,
    status     TEXT NOT NULL CHECK (status IN ('active', 'done', 'deleted')),
    value      TEXT NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, id)
  ) STRICT;
  CREATE INDEX workout_sessions_by_date ON workout_sessions (user_id, date);

  CREATE TABLE steps (
    user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    steps      INTEGER NOT NULL CHECK (steps BETWEEN 1 AND 100000),
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, date)
  ) STRICT;
  `,
];

export function schemaVersion(db: Database): number {
  const row = db.prepare('PRAGMA user_version').get();
  const v = row?.user_version;
  return typeof v === 'number' ? v : 0;
}

/** Throws when `PRAGMA foreign_key_check` reports any row (names the tables, never the content). */
function assertForeignKeys(db: Database, version: number): void {
  const rows = db.prepare('PRAGMA foreign_key_check').all();
  if (!rows.length) return;
  const tables = [...new Set(rows.map((r) => String(r.table)))].sort().join(', ');
  throw new Error(`Migration v${version} left foreign-key violations in ${tables}`);
}

/**
 * Applies pending migrations, each in its own transaction: the SQL, then `PRAGMA foreign_key_check` (any violation
 * throws and rolls the migration back), then `PRAGMA user_version`. Returns the resulting version.
 */
export function migrate(db: Database, migrations: readonly string[] = MIGRATIONS): number {
  const current = schemaVersion(db);
  if (current > migrations.length) {
    throw new Error(`Database schema v${current} is newer than this build (v${migrations.length})`);
  }
  for (let v = current; v < migrations.length; v++) {
    const sql = migrations[v] ?? '';
    transaction(db, () => {
      db.exec(sql);
      assertForeignKeys(db, v + 1);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return migrations.length;
}
