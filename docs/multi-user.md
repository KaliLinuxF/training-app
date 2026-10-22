# «Користувачі» — user accounts, invites, admin, per-user data

Owner request (2026-10-21): «сделай так, чтобы были юзеры». Owner correction: «Не, анна не админ, заведи один админский
акк и дай мне данные». This plan turns the single-password, single-person app into **several separate accounts**
(username + password, registration only by a one-time invite link from an admin), keeps **Anna's real production data,
password, sessions, photos, push subscriptions and settings** exactly as they are (she becomes the ordinary user
«anna»), and adds **one admin account «admin»** that the owner bootstraps over SSH with a one-time setup link (he
chooses the password himself in the browser — no password ever passes through chat, logs or shell history).

Same 1b «Свіжість» look and redesign-A patterns (`docs/redesign-a.md`): `ListGroup` / `ListRow`, `Card`, `Sheet`,
`Stepper`, `Segmented`, `ui.confirm()`, ≥ 44px targets, inputs ≥ 16px, light + dark, desktop = settings split view.

Reading order for engineers: §1 decisions → §2 data model → §3–§5 security model → the section of your package →
§12 work packages (your brief in the orchestration output is self-contained; this file has the sketches and reasons).
§17 records the review round: what changed after the critiques and which critiques were rejected (with reasons).

---

## 0. Summary

| Area | Before (schema v3) | After (schema v4) |
| --- | --- | --- |
| Accounts | one password in `kv.password_hash` | `users` (id, username, role admin/user, scrypt hash, disabled, AI limit); «anna» = the migrated account |
| Sign-up | — | only `/invite#<token>` (admin-made, 7 days, single use, revocable, note «для Олі») |
| Password reset | CLI `set-password` | admin-made `/reset#<token>` (24 h, single use); CLI `reset-password-link`, `set-password <user>` |
| Sessions | `sessions(token_hash)` | + `user_id` (FK, cascade) + `legacy` (migrated v3 sessions); every request resolves the user; rotated on password change, revoked on reset / demotion / disable / delete; a login replaces the incoming session |
| Data | global tables keyed by date | every per-user table keyed by `(user_id, …)`; all SQL behind `repos.forUser(userId)` |
| Photos | `photos(id)` + files | + `photos.user_id`; served only to the owner (else 404); GC per owner; files stay in `data/photos/` |
| AI budget | 60/day global (`kv.food_budget`) | per user (default 40/day, Kyiv day) **and** global ceiling (default 150/day); admin-adjustable |
| Push / reminders | all subscriptions get every reminder | subscription belongs to a user; scheduler runs per user (own `settings.rem`, own timezone, own devices) |
| Export / import | everything | only the signed-in user's data; import never touches anyone else |
| Client cache | IndexedDB `legko.data` / `legko.outbox` | `legko.user` pointer + `legko.data.<userId>` / `legko.outbox.<userId>`; one signed-in person per device; legacy keys adopted by «anna» |
| Admin UI | — | Settings → «Користувачі» (admins only): users list, invites, reset links, role, disable, delete, AI limits |
| Everyone | «Вийти» card at the bottom of Settings | the «Акаунт» row takes the «Вийти» card's place; «Акаунт»: username, change password, rename, AI left today, **«Вийти»** (moved here) |

---

## 1. Decisions

| # | Decision | Why |
| --- | --- | --- |
| D1 | User ids are **32 lowercase hex chars**, never reused. `users.create` always uses `randomBytes(16)`. The **legacy owner** created by the v4 migration gets the **fixed id `00000000000000000000000000000001`** (`LEGACY_OWNER_ID`) unless `kv.legacy_user` names one. | Client caches are keyed by user id: a reused id (deleted user, restored backup) could show one person's device cache to another. The fixed legacy id makes every re-migration of this installation's v3 data (a restored daily v3 backup, the `legko-pre-v4` fallback) yield the **same** anna id, so her device copy and unsent outbox stay hers; nobody else can ever get it (random ids only), and ids are not secrets. |
| D2 | Usernames: 3–32 chars `[A-Za-z0-9._-]`, at least one letter or digit, stored as typed (`username`) + lower-case lookup key (`username_key`, UNIQUE). `legko` is **never** usable (login alias, D3). `admin` is **reserved** for invite registration and self-rename; only the CLI (`create-admin`, `rename-user`, `set-role`) and the dev bootstrap may create or rename to it. | Owner rule; case-insensitive uniqueness. Nobody can grab «admin» before the owner bootstraps it, and `create-admin admin` can never point the owner at a regular user's account. |
| D3 | Login with username **`legko`**, or **without a username** (an old cached client), resolves to the legacy owner («anna»). | The old login form saved her iPhone Keychain entry under the hidden fixed account name «legko»; autofill would otherwise fill «legko» and fail. The old bundle sends only `{ password }`. Usernames are not secrets; the password is still required and the same limiters apply. |
| D4 | One-time links carry the token in the **URL fragment**: `/invite#<token>`, `/reset#<token>`. The SPA moves it to `sessionStorage` and strips it from the URL (`history.replaceState`). | Fragments never reach the server, its request log, Caddy, `Referer` or link-preview fetchers. |
| D5 | Tokens = 32 random bytes base64url (43 chars, like session tokens); only `sha256` hex is stored; lookup through a UNIQUE index on the digest. | ≥ 128-bit entropy; DB leak ≠ usable links. Timing of a digest lookup reveals nothing useful (an attacker cannot pick inputs whose digest prefixes they choose). |
| D6 | The v4 migration creates **no admin** and no known password. It creates «anna» (role **user**, her current hash, legacy owner) only when the v3 database has any content. The admin comes from the CLI `create-admin admin` → setup link (24 h). | Owner decisions 2 and 4. |
| D7 | Existing sessions are copied to «anna»: **no forced re-login**. | Owner decision 4. |
| D8 | Every per-user table is **rebuilt** with `user_id` in the primary key (SQLite cannot alter a PK), in the single v4 migration transaction, with `ON DELETE CASCADE` FKs to `users`. | Owner decision 9; deleting a user removes all their rows in one statement. |
| D9 | `kv.password_hash` and `kv.settings` move to `users.password_hash` / `user_settings`; `kv.food_budget` stays as the **global** daily counter; per-user counts go to `ai_usage`. | Global vs per-user state is obvious from the table. |
| D10 | All SQL lives in repository modules owned by `server-core`; per-user access is only through `forUser(userId: UserId)` (branded type). A **scope-lint unit test** fails for any SQL literal touching a per-user table without `user_id` (explicit allowlist with reasons). Route deps contain no unscoped data repo. | «Design it so a missing scope is hard to write.» |
| D11 | The client sends **`X-Legko-User: <device user id>`** with `GET /api/data`, `POST /api/ops`, `POST /api/import`; the server answers **409 `user_mismatch`** when the session's user differs, before touching anything. A session created by v4 code (`sessions.legacy = 0`) **must** send the header on those three routes (missing → 409 too); only legacy sessions (`legacy = 1`: copied by the migration, or created by a login **without** a username — only the pre-v4 bundle sends that, and it always resolves to the legacy owner, D24) work without it; the first request that presents the header clears their flag. | A second tab that signed in as someone else shares the cookie jar; without this an old tab would push one person's outbox into another person's account. The pre-v4 bundle never sends the header and ignores `BroadcastChannel`, so it may only ever ride anna's migrated sessions — never a session made by a v4 login. |
| D12 | **One signed-in person per device.** Signing in as a different user wipes the previous user's device copy (after an in-app confirm when it still has unsent changes) and reloads the page. Logout wipes everything and reloads. The wipe **always** tries IndexedDB (whatever the memory-fallback state), is verified, and leaves a `localStorage['legko.wipePending']` tombstone until it is; while the tombstone exists no device copy is ever rendered. | Simple mental model; guarantees nothing of another user stays in memory (module caches, React state, image URLs) or silently survives a slow iOS IndexedDB. |
| D13 | Photo files stay flat in `data/photos/<id>.jpg`; ownership is `photos.user_id`. Another user's photo id answers **404** (not 403). | No file moves in the migration ⇒ trivial rollback; no existence oracle. |
| D14 | Photo GC counts a reference only from **the photo's owner's** days/meals; a corrupt `days.meals` row pauses GC **for that owner only**. | Isolation (B referencing A's id keeps nothing alive, exposes nothing); one user's corrupt row no longer blocks everyone. |
| D15 | A push endpoint belongs to whoever subscribed it last **from the same browser subscription**: an upsert may move an endpoint to another user only when its `auth` key equals the stored one (else 403 `forbidden`, row untouched). `unsubscribe { endpoint, auth? }` deletes the row when it is the caller's **or** when `auth` matches (any owner); without `auth` (old clients) only the caller's own row. On a user switch the client unsubscribes the browser and sends `auth`. | Notifications follow the person signed in on the device. Possession of the subscription's own secret (`keys.auth`, known only to that browser and the server) is the proof; an endpoint alone moves or deletes nothing. |
| D16 | AI: per-user limit (default 40/day; per-user override, 0 = off for that user) **and** a global ceiling (default 150/day), both in the Kyiv day; admin-set values in `kv.ai_limits` win over env defaults (`FOOD_USER_DAILY_LIMIT`, `FOOD_DAILY_LIMIT`); `FOOD_DAILY_LIMIT=0` still disables AI entirely. `remainingToday` = min(user left, global left). | Owner decision 6; no client change needed where the budget is shown. |
| D17 | Roles are read from `users` on **every request** (session JOIN users), so a role change takes effect at once; demotion, disable, password change/reset additionally revoke sessions (matrix §3.3). | Owner decision on invalidation. |
| D18 | «Last admin» = the last **usable** admin (role admin, not disabled, has a password). Demoting, disabling or deleting them is refused (409 `last_admin`) in the API **and** the CLI. Nobody can disable or delete themselves (409 `self_action`). Self-demotion is allowed while another usable admin exists. | Owner decision 4; no lock-out. |
| D19 | Invites from the UI always create role **user**; only the CLI `create-invite --admin` makes admin invites. Max 20 pending invites. | Fewer foot-guns in the UI; promotion is one tap afterwards. |
| D20 | Admin and account actions are **online only** (not in the outbox). | They are rare and must be confirmed by the server. |
| D21 | Theme stays **per device** (`localStorage`), not per user. | It already is; nothing server-side. |
| D22 | New copy is **gender-neutral** (impersonal forms: «На цьому пристрої вже ввійдено як anna»). Existing copy is unchanged (owner question 6). | Other users may not be women. |
| D23 | Admin accounts do **not** get the «Перші кроки» sheet opened by itself (the Home «Почнімо» banner still offers it). After an invite / reset / setup link completes for an admin, the app lands on `/settings/users` instead of `/`. | The owner uses «admin» to manage people; a pop-up on every session would be noise, and his first screen should not be an empty weight tracker (owner question 3). |
| D24 | Login without `username` (an old cached client) is treated as the alias `legko` (D3) — same per-IP / per-username limiters, dummy hash, identical 401 — and the session it creates is **legacy** (`legacy = 1`, D11), so the old bundle can sync on it. The new client always sends a username (its sessions are never legacy) and reloads itself into the new version on the next idle foreground (`pwa/update.ts`). | An old home-screen bundle that lost its session (reset, `set-password anna`, expiry) can still sign anna in and send her outbox until it reloads; this grants nothing D3 does not already grant, and a legacy session can only ever belong to the legacy owner. |
| D25 | Downgrade v4 → v3 is supported with `downgrade-schema [--keep <username>] [--drop-others]`: without `--drop-others` it is refused while any other user owns rows (the message lists per-user, per-table counts); the kept user's identity is parked in `kv.legacy_user` so a re-upgrade restores the **same id**. Device copies are reconciled by the client (legacy keys written by the rolled-back app are merged at every start, §8.2). | Rollback story; the fresh «admin» has no data, so `--keep anna` normally works; one stray admin test record must not block an emergency rollback. |
| D26 | **Session rotation**: changing your own password revokes **all** your sessions, the current one included, and the response sets a fresh cookie (this device stays signed in, a stolen copy of its old cookie dies). Login, invite accept and reset complete revoke the session of the incoming `sid` cookie (whoever it belonged to) before setting the new one. | A password change is often a reaction to a stolen cookie; an overwritten cookie must not leave a live 400-day session behind. |
| D27 | **One-time links die with their creator's authority**: demoting, disabling or deleting an admin revokes the pending invites and reset links **they created** (before the delete, so `created_by` still names them); so does completing a reset/setup link or CLI `set-password` for an admin (account recovery — this also cancels that admin's own pending invites). A user's own password change, a completed reset, and disabling a user revoke the pending reset links **for** that user. CLI `list-links` / `revoke-links [--by <username>\|--all]` give the owner a bulk switch. | If a setup link leaks and is used first, recovering the admin account must also kill the reset links and invites the intruder made (e.g. a reset link for anna). |
| D28 | **Admin-made resets are visible to the person**: `users.password_changed_via` (`self`/`reset`/`setup`/`cli`) and `password_changed_by` (the link's creator) are returned in `SessionUser.passwordChange`; «Акаунт» shows «Пароль задано 21 жовтня за посиланням від admin». The server logs creation and use of reset links (ids only). The make-admin copy no longer claims nobody can see others' records. | Owner decision 4 requires admin reset links, which technically allow a takeover; it must be honest and detectable (a reset also signs out every device of that person). |
| D29 | **iPhone link flow**: links open in Safari, whose storage is separate from the home-screen app. In iOS Safari (not standalone) a finished invite/reset shows a «Готово» state (username, install steps, «Продовжити в Safari») instead of reloading at once; the login screen offers **«Маю посилання»** to paste an invite / reset link straight into the installed app. | Otherwise every iPhone invite ends in a Safari copy of the app, and every reset silently logs the installed app out. |
| D30 | **Settings list**: the «Акаунт» row (value = username) takes the place of today's «Вийти» card at the bottom of the list; for admins the same card holds «Акаунт» + «Користувачі» and the caption «Легко · трекер схуднення» is hidden. «Вийти» moves to the bottom of the «Акаунт» page / pane. | Measured: a new card would make the list scroll at 390×763 (installed app) for users and at 390×844 for admins; this layout adds +0 px for users and ≈ +28 px for admins. Owner item 5 already lists logout under «Акаунт». |
| D31 | **scrypt concurrency cap**: at most 2 hashes/verifies in flight app-wide, a FIFO queue of ≤ 16; beyond that the request gets 429 `rate_limited` (Retry-After 5). Every endpoint counts an attempt **before** hashing, and invite accept rejects a taken name **before** hashing. | One endpoint (or a parallel burst) must not monopolise libuv's 4-thread pool, which photo file I/O shares. |
| D32 | **Admin = read-only coach** (owner, 2026-10-22; `docs/coach-cabinet.md`). An admin also sees every role-`user` account's records and progress in «Клієнти» (`GET /api/coach/**`, GET only), **read-only**; admins are never clients (404, the caller included). It goes through a separate read-only path (§4 item 6), never through `forUser`. This **supersedes** the earlier statements that the admin never sees anyone's records («Чужих записів адміністратор не бачить», §9.6, D28) — the copy now says what the admin sees (§9.5, §9.6). | Owner: «админ должен видеть прогресс и данные каждого, как тренер»; transparency is non-negotiable. |

---

## 2. Data model and migration (schema v4)

### 2.1 Tables after v4 (`apps/server/src/db/migrations.ts`, entry index 3)

```sql
CREATE TABLE users (
  id                  TEXT PRIMARY KEY CHECK (length(id) = 32 AND id NOT GLOB '*[^0-9a-f]*'),
  username            TEXT NOT NULL CHECK (length(username) BETWEEN 3 AND 32),
  username_key        TEXT NOT NULL UNIQUE,          -- lower(username)
  password_hash       TEXT,                          -- NULL = no usable password yet (create-admin, until the setup link is used)
  role                TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  created_at          INTEGER NOT NULL,              -- epoch ms
  password_changed_at INTEGER,
  password_changed_via TEXT CHECK (password_changed_via IN ('self', 'reset', 'setup', 'cli')),   -- D28
  password_changed_by TEXT REFERENCES users (id) ON DELETE SET NULL,   -- creator of the reset/setup link; NULL = self / CLI
  last_seen_at        INTEGER,                       -- last activity (requireAuth, ≥ 5 min granularity)
  disabled_at         INTEGER,                       -- NULL = active
  ai_daily_limit      INTEGER CHECK (ai_daily_limit BETWEEN 0 AND 1000),   -- NULL = the default per-user limit
  legacy_owner        INTEGER NOT NULL DEFAULT 0 CHECK (legacy_owner IN (0, 1))
) STRICT;
CREATE UNIQUE INDEX users_legacy_owner ON users (legacy_owner) WHERE legacy_owner = 1;

CREATE TABLE user_settings (                          -- was kv.settings (JSON of Settings)
  user_id    TEXT PRIMARY KEY REFERENCES users (id) ON DELETE CASCADE,
  value      TEXT NOT NULL,
  updated_at INTEGER NOT NULL
) STRICT;

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  renewed_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  legacy     INTEGER NOT NULL DEFAULT 0 CHECK (legacy IN (0, 1))   -- 1 = copied from v3 or a username-less login (D11, D24)
) STRICT;
CREATE INDEX sessions_by_user ON sessions (user_id);

CREATE TABLE days (
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

CREATE TABLE weights (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  kg         REAL NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
) STRICT;

CREATE TABLE measures (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date       TEXT NOT NULL,
  chest      REAL,
  waist      REAL,
  hips       REAL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, date)
) STRICT;

CREATE TABLE foods (
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

CREATE TABLE photos (
  id          TEXT PRIMARY KEY,                       -- global random id (128 bit), file name in data/photos/
  user_id     TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  bytes       INTEGER NOT NULL,
  thumb_bytes INTEGER NOT NULL
) STRICT;
CREATE INDEX photos_by_user ON photos (user_id);

CREATE TABLE push_subscriptions (
  endpoint   TEXT PRIMARY KEY,                        -- globally unique (one browser = one endpoint)
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  p256dh     TEXT NOT NULL,
  auth       TEXT NOT NULL,
  user_agent TEXT,
  created_at INTEGER NOT NULL,
  last_ok_at INTEGER
) STRICT;
CREATE INDEX push_subscriptions_by_user ON push_subscriptions (user_id);

CREATE TABLE reminder_log (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('sent', 'skipped')),
  sent       INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, kind, date)
) STRICT;

CREATE TABLE ai_usage (                               -- per-user AI estimates per Kyiv day (global total: kv.food_budget)
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  date    TEXT NOT NULL,
  count   INTEGER NOT NULL CHECK (count >= 0),
  PRIMARY KEY (user_id, date)
) STRICT;

CREATE TABLE invites (
  id         TEXT PRIMARY KEY,                        -- public random id (32 hex) for list / revoke; NOT the token
  token_hash TEXT NOT NULL UNIQUE,                    -- sha256 hex of the secret token
  role       TEXT NOT NULL CHECK (role IN ('admin', 'user')),
  note       TEXT NOT NULL DEFAULT '',                -- ≤ 60 chars, admin's own label («для Олі»)
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,   -- NULL = CLI
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
  purpose    TEXT NOT NULL CHECK (purpose IN ('reset', 'setup')),   -- setup = the user has no password yet
  created_by TEXT REFERENCES users (id) ON DELETE SET NULL,          -- NULL = CLI
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used_at    INTEGER,
  revoked_at INTEGER
) STRICT;
CREATE INDEX password_resets_by_user ON password_resets (user_id);
```

Global `kv` after v4: `vapid_public_key`, `vapid_private_key`, `login_failures` (global login cap, unchanged),
`food_budget` (`{date, count}` — now the **global** AI counter), `ai_limits` (new, `{perUser, global}`, only once an
admin saved limits). `KV.passwordHash` and `KV.settings` are **removed from the `KV` constant**, so no code can read
them any more (migration / downgrade use string literals).

### 2.2 Migration v4 — order (one transaction via `migrate()`)

1. `CREATE TABLE users …` + partial unique index.
2. Legacy account — only when the v3 database has any content:

   ```sql
   INSERT INTO users (id, username, username_key, password_hash, role, created_at, legacy_owner)
   SELECT
     COALESCE((SELECT json_extract(value, '$.id') FROM kv WHERE key = 'legacy_user' AND json_valid(value)),
              '00000000000000000000000000000001'),           -- LEGACY_OWNER_ID (D1): the same id on every re-migration
     COALESCE((SELECT json_extract(value, '$.username') FROM kv WHERE key = 'legacy_user' AND json_valid(value)), 'anna'),
     lower(COALESCE((SELECT json_extract(value, '$.username') FROM kv WHERE key = 'legacy_user' AND json_valid(value)), 'anna')),
     (SELECT value FROM kv WHERE key = 'password_hash'),
     COALESCE((SELECT json_extract(value, '$.role') FROM kv WHERE key = 'legacy_user' AND json_valid(value)), 'user'),
     COALESCE((SELECT json_extract(value, '$.createdAt') FROM kv WHERE key = 'legacy_user' AND json_valid(value)),
              (SELECT MIN(t) FROM (                          -- aggregate MIN skips NULLs (scalar min() would not)
                 SELECT MIN(created_at) AS t FROM sessions
                 UNION ALL SELECT MIN(created_at) FROM photos
                 UNION ALL SELECT CAST(strftime('%s', MIN(date)) AS INTEGER) * 1000 FROM days
                 UNION ALL SELECT CAST(strftime('%s', MIN(date)) AS INTEGER) * 1000 FROM weights
                 UNION ALL SELECT CAST(strftime('%s', MIN(date)) AS INTEGER) * 1000 FROM measures)),
              CAST(strftime('%s', 'now') AS INTEGER) * 1000),   -- «з <date>» = when she started, not her oldest live session
     1
   WHERE EXISTS (SELECT 1 FROM kv WHERE key IN ('password_hash', 'settings', 'food_budget', 'legacy_user'))
      OR EXISTS (SELECT 1 FROM days) OR EXISTS (SELECT 1 FROM weights) OR EXISTS (SELECT 1 FROM measures)
      OR EXISTS (SELECT 1 FROM foods) OR EXISTS (SELECT 1 FROM photos) OR EXISTS (SELECT 1 FROM sessions)
      OR EXISTS (SELECT 1 FROM push_subscriptions) OR EXISTS (SELECT 1 FROM reminder_log);
   ```

   (`kv.legacy_user` exists only after a v4 → v3 downgrade, D25.) A fresh database (v0 → v4 in one start) creates no
   user. Below, `L` stands for `(SELECT id FROM users WHERE legacy_owner = 1)`.
3. `user_settings`: `INSERT … SELECT L, value, <now> FROM kv WHERE key = 'settings'`.
4. For each of `sessions`, `days`, `weights`, `measures`, `foods`, `photos`, `push_subscriptions`, `reminder_log`:
   `CREATE TABLE <t>_v4 (… §2.1 …)`; `INSERT INTO <t>_v4 (user_id, <all old columns>) SELECT L, <all old columns>
   FROM <t>` (explicit column lists — never `SELECT *`; `sessions` additionally writes `legacy = 1` for every copied
   row, D11); `DROP TABLE <t>`; `ALTER TABLE <t>_v4 RENAME TO <t>`; then the indexes of §2.1. FKs stay ON
   (`enableForeignKeyConstraints: true`): the new tables only reference `users`, which exists, and nothing referenced
   the old tables.
5. `ai_usage`: `INSERT … SELECT L, json_extract(value,'$.date'), json_extract(value,'$.count') FROM kv WHERE key =
   'food_budget' AND json_valid(value) AND typeof(json_extract(value,'$.date')) = 'text' AND
   typeof(json_extract(value,'$.count')) = 'integer'` (her today's usage keeps counting against her limit).
6. `CREATE TABLE ai_usage / invites / password_resets` (+ index) — order: create before step 5 for `ai_usage`.
7. `DELETE FROM kv WHERE key IN ('password_hash', 'settings', 'legacy_user')`.
8. `migrate()` (all versions, new): after each migration's SQL and before `PRAGMA user_version`, run `PRAGMA
   foreign_key_check`; any row ⇒ throw ⇒ the transaction rolls back and the server refuses to start with
   `Migration v4 left foreign-key violations in <table>`.

**Pre-migration snapshot**: `db/open.ts` writes `backups/legko-pre-v4-<Kyiv date>.db` (at `user_version` 3) before
migrating a file DB, through `writeSnapshotOnce` (`backup.ts`): a snapshot is **never replaced** — a second migration
on the same Kyiv date (migrate → downgrade → migrate again) writes `legko-pre-v4-<date>-2.db`, then `-3`, … (copy to a
temp file, then a hard link that fails instead of overwriting). Never pruned (the names do not match the daily
pattern). Only the server migrates: the CLI's account commands refuse an older schema (§7).

### 2.3 Migration tests (server-core, `apps/server/src/db/migrate-v4.test.ts`)

- Build a v3 DB with `migrate(db, MIGRATIONS.slice(0, 3))`, insert: 3 days (legacy, meal day with photos in meals,
  day with `trained`/types/notes), 2 weights, 2 measures (one with a null), 3 foods (with/without macros, positions
  2/0/1), 2 photos, 2 push subscriptions, 2 reminder_log rows, 2 sessions (a token you keep), kv `password_hash`
  (`hashPassword('old password', TEST_SCRYPT)`), `settings`, `food_budget` `{date:'2026-10-21',count:7}`, VAPID keys,
  `login_failures`. Run `migrate(db)`:
  - exactly one user: username/key `anna`, role `user`, `legacy_owner` 1, `password_hash` = the old hash
    (`verifyPassword('old password', …)` true), id = `LEGACY_OWNER_ID`; `created_at` = the earliest of the fixture's
    session `created_at`, photo `created_at` and day / weight / measure dates (put the oldest date in `weights`);
  - **determinism**: migrating two independent copies of the same v3 fixture gives the same anna id both times, and
    the kept pre-migration session token authenticates as that id in both;
  - every migrated session has `legacy = 1`; a session created afterwards has `legacy = 0`;
  - every row of every table equal column by column to before, plus `user_id` = anna's id; foods keep `position`;
    `days.meals` byte-equal; settings JSON in `user_settings` equal to the old `kv.settings`;
  - `ai_usage` has `(anna, 2026-10-21, 7)`; `kv.food_budget` still there; `kv.password_hash` / `settings` gone;
    VAPID keys and `login_failures` unchanged;
  - `createSessionStore(db).check(keptToken)` returns anna (no re-login, D7);
  - `PRAGMA foreign_key_check` empty, `PRAGMA integrity_check` = ok; `PRAGMA table_info` / `index_list` match §2.1;
  - a second `migrate(db)` is a no-op.
- v0 → v4 (fresh) and v3 with only VAPID keys: no user, all tables empty.
- `openDatabase(file)` on a v3 file writes `backups/legko-pre-v4-<date>.db` at `user_version` 3; v4 files: none.
- A malformed `kv.legacy_user` id (CHECK fails) → `migrate` throws, `user_version` stays 3, data untouched.

### 2.4 Rollback: `downgrade-schema` v4 → v3 (`db/downgrade.ts`, CLI in `cli/run.ts`)

`downgradeSchemaV4(db, backupsDir, date, { keep?: string; dropOthers?: boolean }) → DowngradeReport` (kept user,
per-user per-table counts of what was dropped):

1. Refuse (`DowngradeRefused`, nothing changed) unless `user_version === 4`. Pick the kept user: `--keep <username>`
   (case-insensitive) or the only user; refuse when there is more than one user and no `--keep`, or when the name is
   unknown. Count, for **every other user**, their rows in `days`, `weights`, `measures`, `foods`, `photos`,
   `user_settings`, `push_subscriptions`. Without `--drop-others`: refuse when any of the first five counts is > 0;
   the message lists each such user with the per-table counts and names the flag. With `--drop-others`: proceed.
   Users without data (e.g. a fresh «admin») are always dropped; their settings / subscriptions are listed as dropped.
2. Snapshot `backups/legko-pre-down-v4-<date>.db` (`writeSnapshotOnce`: a second downgrade on the same date writes
   `-2`, … and never replaces the first; the v3 → v2 step's `legko-pre-down-v3-<date>.db` likewise).
3. One transaction: write kv `password_hash` (when not NULL), `settings` (from `user_settings`), `legacy_user`
   `{"id","username","role","createdAt"}`; delete kv `ai_limits`; rebuild `sessions` (dropping `legacy`), `days`,
   `weights`, `measures`, `foods`, `photos`, `push_subscriptions`, `reminder_log` into the **exact v3 shapes**
   (columns, types, defaults, PKs, CHECKs of migrations 0–2) copying only the kept user's rows; drop `ai_usage`,
   `invites`, `password_resets`, `user_settings`, then `users`; `PRAGMA user_version = 3`. Photo files of dropped
   users stay on disk until the v3 GC removes them as stray files (no row, older than 24 h).
4. The existing v3 → v2 step stays (`downgrade-schema` on a v3 DB runs it, as today). Each call steps one version.

Tests (core, `db/downgrade.test.ts`): v4 with anna + empty admin → `--keep anna` → v3 shapes equal a fresh v3 DB's
`PRAGMA table_info` for every table; anna's rows and kv restored; re-`migrate` → v4 with the **same anna id**,
`legacy_owner` 1, the same hash, sessions valid (and `legacy = 1`); refusals (no `--keep` with 2 users, other user
with a weight row and no `--drop-others` → message lists the counts, unknown name, v3 DB) change nothing; with
`--drop-others` only the kept user's rows remain and the report lists the dropped counts. CLI tests (features)
drive the same through `runCli` and assert the printed counts.

Rollback procedure (DEPLOY.md, §13 step 6):
0. `deploy/deploy.sh status`: run the downgrade **only** when the `training-app:previous` line shows a version from
   **before** the users release. If `previous` is already a v4 build (a hotfix was deployed since), use a plain
   `deploy/deploy.sh rollback` and do **not** downgrade (it would delete every other account for nothing; the v4
   build would just re-migrate). The CLI's `downgrade-schema` usage text repeats this rule.
1. Ask anna to open the app once **while online** (her installed app must send its outbox; the old bundle cannot see
   `legko.outbox.<id>`).
2. Stop app → `docker compose run --rm --no-deps app node /app/server/cli.js downgrade-schema --keep anna`
   (add `--drop-others` only after reading the refusal's counts) → `deploy/deploy.sh rollback`. Run no other CLI
   command of the new image in between (its account commands refuse a v3 database anyway, §7).
Lost: other accounts and their data (with `--drop-others`), invites, reset links, AI usage per user, «admin» (bootstrap
it again after a re-upgrade). Logging out under the rolled-back app does not clear the per-user device copy
(`legko.user`, `legko.data.<id>`); the next v4 bundle shows it offline-first until `me` answers 401. Fallback:
restore `legko-pre-v4-<date>.db` — the un-suffixed (first) file of the deploy day; `-2`, `-3` are later re-migrations
— (loses what was logged after the deploy; re-migrating it gives anna the same id, D1).

Rehearsed end to end at the final gate (a v3 database written by the pre-release server: 66 days with meals, 12
weights, 11 measures, 5 foods, 2 photos, 2 sessions, 1 push subscription): migrate on start, both old session cookies
valid, data / export / photos byte-equal, `create-admin admin` → setup link → «Користувачі» with `anna` only, an invite
→ a new user with empty data; then `downgrade-schema --keep anna` (refused while the new user had a weight row;
`--drop-others` passed) and the pre-release server served her old session, password, data and photos again.

---

## 3. Accounts, passwords, sessions, one-time links

### 3.1 Usernames (`packages/shared/src/users.ts`)

`USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/` + at least one `[A-Za-z0-9]`; input is trimmed; `usernameKey(name) =
name.trim().toLowerCase()`; `ALIAS_USERNAMES = ['legko']` (never usable anywhere); `RESERVED_USERNAMES = ['legko',
'admin']` (refused for invite registration and self-rename). `usernameProblem(name, { allowAdmin?: boolean }):
'length' | 'chars' | 'reserved' | null` — the CLI (`create-admin`, `rename-user`) and `auth/devUsers.ts` pass
`allowAdmin: true`; `legko` stays reserved even then. Login accepts any string 1–64 chars or no username at all
(D24; format is **not** validated at login, so an invalid name answers exactly like a wrong one).

### 3.2 Passwords

Unchanged scrypt (`auth/password.ts`): `N = 2^15, r = 8, p = 1`, 64-byte key, 16-byte salt, NFC, format
`scrypt$N$r$p$salt$hash`, `timingSafeEqual` on equal-length keys. Policy 8–200 chars (`passwordProblem`). Hashing
runs on libuv's threadpool (4 at a time; ~32 MiB each); every path that hashes is behind a rate limiter **and** counts
the attempt before it hashes.
**Concurrency cap (D31)**: `hashPassword` / `verifyPassword` go through one app-wide gate in `auth/password.ts`
(`createScryptGate({ maxInFlight: 2, maxQueued: 16 })`, injectable for tests): at most 2 runs in flight, FIFO queue;
a call that finds the queue full throws `ScryptBusy` → the route answers 429 `rate_limited` with `Retry-After: 5`
(the attempt stays counted).
New: `setUserPassword(db, userId, password, params, { via, by?, keepSessionHash? })` (hash, store,
`password_changed_at` / `_via` / `_by`, revoke sessions per §3.3, revoke links per D27) replaces `setPassword` /
`clearPassword` / `getPasswordHash` / `hasPassword` (removed). A **dummy hash** (random password, the same params as
`deps.scrypt`) is computed once per app and verified for unknown users and users without a password, so the timing
does not tell them apart.

### 3.3 Sessions (`auth/sessions.ts`)

- `create(userId, now) → token` (32 random bytes base64url; stored `sha256` hex, as today); cookie `sid` unchanged
  (HttpOnly, SameSite=Lax, Path=/, Secure in production, 400 days, sliding renewal once a day).
- `check(token, now) → { renewed, user: AuthedUser } | null` with one `SELECT … FROM sessions s JOIN users u ON
  u.id = s.user_id WHERE s.token_hash = ?`; expired → row deleted, null; **disabled user → row deleted, null**.
- `check()` also returns the session's `legacy` flag.
- **Session cap** (production): `createSessionStore(db, { maxPerUser })`, default `MAX_SESSIONS_PER_USER = 20`
  (`null` = no cap; development has none — the e2e suite keeps one long-lived worker session per account). `create()`
  deletes the user's sessions beyond the cap in the same atomic step as the insert: least recently renewed first,
  then the oldest; the new token is never the one dropped.
- `requireAuth` (middleware): 401 `unauthorized` (clears the cookie) without a live session; sets
  `c.set('user', AuthedUser)` and `c.set('sessionHash', hash)`; when `X-Legko-User` is present and ≠ `user.id` →
  **409 `user_mismatch`** (D11); when it is **absent** on `GET /api/data`, `POST /api/ops` or `POST /api/import` and
  the session is not legacy → 409 `user_mismatch` as well (nothing applied); when it is present and matches on a
  legacy session → `UPDATE sessions SET legacy = 0 WHERE token_hash = ?` (once). Updates `users.last_seen_at` when
  older than 5 min. `currentUser(c): AuthedUser` throws `Error('route is missing requireAuth')` when absent (500 in
  tests = loud). Export (`GET /api/export`, a plain download link), photos (`<img>`), push and food never need the
  header.
- `requireAdmin` (after `requireAuth`): role ≠ admin → 403 `forbidden` «Немає доступу».
- `AuthedUser = { id: UserId; username: string; role: UserRole; createdAt: number; legacyOwner: boolean;
  passwordChange: { at: number; via: 'self' | 'reset' | 'setup' | 'cli'; by: string | null } | null }` (`by` = the
  link creator's **username**, null for self / CLI / a deleted creator).

Session and link invalidation matrix (D26, D27):

| Event | Sessions revoked | Links revoked | Also |
| --- | --- | --- | --- |
| Change own password (`/api/account/password`) | **all** of the user's, the current one included; the response sets a fresh cookie | pending reset links **for** the user | `password_changed_*` (via `self`) |
| Reset / setup link completed | **all** of the user's; a new session is created for the browser that completed it | other pending reset links for the user; if the user is an admin, also every pending invite / reset link **they created** | via `reset` / `setup`, by = link creator |
| CLI `set-password <user>` | all of the user's | pending reset links for the user; if admin, those they created | via `cli` |
| Login / invite accept / reset complete over an existing `sid` cookie | the incoming cookie's session (whoever it belonged to) | — | — |
| Role admin → user | all of the target's, except the acting request's own session when it demotes itself | pending invites / reset links the target created | — |
| Disable | all of the target's | pending reset links for the target and those the target created | the target's push subscriptions deleted (no reminders) |
| Delete | cascade (all rows) | pending invites / reset links the target created (revoked **before** the delete) | photo files removed after commit |
| Rename (own) | none | — | — |
| Logout | that session | — | — |

Hourly purge (scheduler): expired sessions (as today) + `tokens.purge(now)` (invites / resets used, revoked or
expired more than 30 days ago).

### 3.4 One-time links (`db/tokens.ts`)

| Kind | Created by | TTL | Consumed by | Effect |
| --- | --- | --- | --- | --- |
| invite | admin UI (role user) · CLI `create-invite [--admin] [--note …]` | 7 days | `POST /api/auth/invite/accept` | creates the user (invite's role), logs in |
| reset | admin UI · CLI `reset-password-link <user>` (user has a password) | 24 h | `POST /api/auth/reset/complete` | sets the password, revokes all sessions, logs in |
| setup | CLI `create-admin <user>` · `reset-password-link` / admin UI for a user without a password | 24 h | same endpoint | same (first password) |

- Creating a reset/setup link revokes the user's other pending reset/setup links (one live link per user).
- Status of a token, in this order: unknown → `unknown`; `revoked_at` → `revoked`; `used_at` → `used`;
  `expires_at ≤ now` → `expired`. Answer **410 `link_invalid`** with `reason` (the holder of a 256-bit token may
  learn its state).
- Consume = `UPDATE … SET used_at = ? WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at
  > ?` → `changes === 1`, **inside the same `BEGIN IMMEDIATE` transaction** as the user insert / password update and
  the session insert. The (slow, async) scrypt hash is computed **before** the transaction, after a non-consuming
  check; a parallel second use finds `changes = 0` → 410 `used`.
- Accept / complete order (D31): parse → link throttle → **in-flight guard** (an in-memory `Set<tokenHash>`; a token
  already being processed → 429 `rate_limited`; added before hashing, removed in `finally`) → non-consuming check →
  `usernameProblem` / `passwordProblem` → for accept, `users.byKey(usernameKey(name))`: **taken → 409
  `username_taken` without hashing**, counted as a link failure for the IP → hash → transaction (re-check the name,
  consume, insert, session).
- Registration with a taken username → 409 `username_taken` and the token is **not** consumed (rolled back).
- Disabled user completing a reset → 403 `account_disabled` (token not consumed). Creating a reset link for a disabled
  user → 409 `account_disabled`.
- Revocation by creator / target follows the matrix in §3.3 (D27): `UPDATE invites SET revoked_at = ? WHERE
  created_by = ? AND used_at IS NULL AND revoked_at IS NULL` and the same on `password_resets` (plus `WHERE user_id
  = ?` for links **for** a user), inside the same `BEGIN IMMEDIATE` as the role / disable / delete / password change.
- Logs (ids only, never tokens): `reset link <link id> for user <id> created by <actor id | cli>`, `reset link <link
  id> used for user <id>`, `invite <id> created by …`, `invite <id> used by user <id>`, `links revoked: N (by <actor>)`.
- Links are returned as a **path** (`/invite#<token>`, `/reset#<token>`); the UI prefixes `location.origin`, the CLI
  prints `PUBLIC_ORIGIN + path`. The token is shown exactly once; the server never logs it.

### 3.5 Login and rate limits

`POST /api/auth/login { username?, password }`:

1. Per-IP throttle before the body is read (existing `createLoginLimiter`: 5 failures / 15 min per address, IPv6 per
   /64, plus the **unchanged persistent global cap** 20 / 15 min in `kv.login_failures`) → 429 `rate_limited`.
2. Body ≤ 4 KiB; schema `{ username?: string 1–64, password: string 1–200 }`; a missing username means `legko` (D24).
3. `key = usernameKey(username ?? 'legko')`; `legko` → the legacy owner's key (D3). Per-username limiter (new, in
   memory, 10 failures / 15 min, max 10 000 keys, also for names that do not exist) → 429 `rate_limited` (same
   message).
4. Count the failure **before** hashing (as today) on both limiters.
5. `user = users.byKey(key)`; verify against `user.passwordHash ?? dummy` (through the scrypt gate, D31); fail when no
   user / no hash / mismatch → **401 `bad_credentials`** «Неправильне імʼя або пароль» (identical body, status and
   work for every case). A **username-less** login (only the pre-v4 bundle sends one, D24) that fails answers 401
   `bad_password` «Неправильний пароль» instead — there is no name to get wrong, and the old bundle maps that code —
   with the same dummy verify and limiter counting (also when there is no legacy owner at all).
6. Correct password but `disabled_at` → 403 `account_disabled` (failure stays counted).
7. Success: reset both limiters (the IP reset takes back one global failure, as today), revoke the incoming `sid`
   cookie's session if any (D26), create session (`legacy = 1` only when the request had **no** username, D24), set
   cookie, `last_seen_at`, answer `{ ok: true, user }`.

Successful logins have their own budget (production only; development has none, the e2e suite signs in ≈ 500 times
per run): `LOGIN_SUCCESS_LIMIT` = 30 per hour, keyed by the username key (`name:<key>`, aliases included) **and** by
the address (`addr:<addressKey(ip)>`, IPv6 per /64). It is checked before any scrypt work (a refused attempt is not
counted as a failure) and re-checked and recorded in the same tick after the password matched, so parallel correct
logins cannot overshoot it → 429 `rate_limited`. Together with the session cap (§3.3) a correct password cannot be
looped into unbounded scrypt work or sessions. (A 429 from this budget can only reveal that a name exists to someone
who already signed in with its password 30 times in the hour.)

Other limiters:
- **Link limiter** per address (`byAddress(limiter)`: IPv4, IPv6 per /64, IPv4-mapped = IPv4), 10 failures / 15 min on
  the 4 public link endpoints (410 answers and taken names on accept count; throttled before the body is read); a
  successful accept / complete resets that address's link failures. Rotating addresses inside one /64 does not help.
- **Password limiter** per user id, 5 failures / 15 min on `/api/account/password` and `/api/account/username`:
  `check(userId)` → `fail(userId, now)` **synchronously before** `verifyPassword` (exactly like login) → `reset`
  only after a correct password. 10 parallel wrong guesses ⇒ exactly 5 verifies, the rest 429.
- **Account change limiter** per user id (`ACCOUNT_CHANGE_LIMIT`, 10 attempts / hour, every attempt counts,
  successful or not) on the same two routes, so a correct-password caller cannot loop scrypt or probe names.

### 3.6 Unchanged guards

`mutationGuard` (Origin + JSON content type on every non-GET `/api/*`) is unchanged and covers the new public
endpoints. Body caps: the 4 public link endpoints use `BODY_LIMITS.login` (4 KiB, read without a session, behind
the throttle); account/admin endpoints `BODY_LIMITS.small` behind `auth`. Security headers / CSP unchanged.

---

## 4. Authorization model — scope by construction

1. **Branded id**: `type UserId = string & { readonly __brand: 'UserId' }` (`db/users.ts`). Only `users.byId()`,
   `users.byKey()`, `users.create()` and `requireAuth` produce one. A raw `body.userId` (admin routes) must be looked
   up first: `const target = users.byId(parsed.userId)` → 404 `not_found` when null.
2. **Factories**: `createDataRepos(db).forUser(id)`, `photos.forUser(id)`, `subscriptions.forUser(id)`,
   `reminderLogs.forUser(id)`, `budget.forUser(id)`. Statements are prepared once with `user_id = ?` and the bound
   object passes `id` itself; no unscoped read/write method is exported.
3. **Routes** get `RouteDeps.data: DataRepos` (no `read()` at the top level) and call
   `deps.data.forUser(currentUser(c).id)`. Admin routes never call `data.forUser` (they only read `users`, `tokens`,
   `budget.usage`).
4. **Scope lint** (`apps/server/src/db/scope.test.ts`): reads every non-test `.ts` file under `apps/server/src`,
   extracts string/template literals with `SELECT|INSERT|UPDATE|DELETE|REPLACE`, strips SQL comments (`-- …`,
   `/* … */`), **splits each literal on `;`** and parses every statement with a small parenthesis-aware SQL parser
   into **query blocks**: the statement itself, every subquery and CTE, every `UNION` part and the `SELECT` of an
   `INSERT … SELECT`. A block names a per-user table (`days, weights, measures, foods, photos, push_subscriptions,
   reminder_log, user_settings, ai_usage, sessions, password_resets`) in its `FROM` / `JOIN` / `INTO` / `UPDATE`.
   Rules, **per block**:
   - a block that reads or changes a per-user table needs a **bound** `[alias.]user_id = ?|:n|$n` that is a whole
     `AND`-conjunct of its own `WHERE`, or of an inner `JOIN … ON` (of a `LEFT JOIN` only for the joined per-user
     table). Never accepted: the predicate in a `SET` list or `RETURNING`, next to an `OR` at its level or in an
     enclosing group, under `NOT`, inside `CASE`, a function call or `BETWEEN`, followed by `IS …`, or only inside a
     subquery; `user_id` in `ORDER BY`, a select list, an alias or a column-to-column equality does not count either;
   - a per-user table joined to itself needs an allowlist entry;
   - `INSERT`: `user_id` must be in the column list; an upsert whose conflict key lacks `user_id` needs a conjunctive
     `user_id = excluded.user_id` in its `DO UPDATE … WHERE`; `REPLACE` on the global-key tables (`photos`,
     `push_subscriptions`, `sessions`, `password_resets`) is refused;
   - allowlist entries are `file` + **exact full statement** (or an exact substring for the reasoned D15 entries) +
     reason; an entry that matches nothing (stale) **or** only statements that pass on their own (unneeded) fails the
     test.
   Allowlist (28 statements; a probe with an empty allowlist flags exactly these): the 8 v4-migration copies (exact
   full statements; the downgrade copies pass by rule); `sessions` by `token_hash` (`find`/`check`, `renew`,
   `remove`, the `legacy = 0` clear — the token is the secret); `DELETE FROM sessions WHERE expires_at <= ?` (purge);
   `DELETE FROM ai_usage WHERE date < ?` (prune); `password_resets` lookups / consume / purge by `token_hash` or
   `expires_at`; `photos/store.ts` `SELECT 1 AS found FROM photos WHERE id = ?` (global stray-file scan) and the GC
   candidate query of §5.2 (owner-correlated); the two D15 push statements (the upsert's `… OR … auth =
   excluded.auth` `WHERE` and `removeOwnOrAuth`). The GC delete is scoped: `DELETE FROM photos WHERE id = ? AND
   user_id = ?` (the candidate query returns both). Self-tests feed ≈ 20 known-bad samples (e.g. `SELECT date, kg FROM
   weights ORDER BY user_id`; `SELECT d.* FROM days d JOIN photos p ON p.user_id = d.user_id WHERE p.id = ?`; `DELETE
   FROM days WHERE user_id = ?; DELETE FROM weights;`; `… WHERE user_id = ? OR 1 = 1`; `UPDATE days SET user_id = ?`)
   and ≈ 24 good ones. A new unscoped statement fails the test.
5. **Defence in depth**: `X-Legko-User` (D11); photo reads check `photos.user_id`; GC joins on `p.user_id`.
6. **The read-only coach path** (D32, `docs/coach-cabinet.md` §2). The only way an admin reads another account:
   - **Reader factories outside `RouteDeps`**: `createDataAccess(db, now, logger)` → `{ repos, readers }` and
     `createPhotoAccess(…)` → `{ store, readers }` share one set of prepared statements; `createDataRepos` /
     `createPhotoStore` return `.repos` / `.store` as before, so `RouteDeps.data` / `.photos` and
     `http/routes/deps.ts` are unchanged. `createApp` hands the `readers` only to `createCoachAccess`, whose result
     (`CoachAccess`) is a **third argument** of `registerCoachRoutes(app, Pick<RouteDeps, 'auth' | 'admin'>, coach)` —
     not a `RouteDeps` field, so no other route module can reach it. A `DataReader` is frozen
     `{ read, settings, weights, measures, daysBetween, recordSpan }` (`read()` returns `Omit<AppData, 'foods'>` and
     never runs the foods statement); a `PhotoReader` is frozen `{ read }`. Neither has a write method.
   - **The `ClientId` brand**: `type ClientId = UserId & { __coachClient }`; `readerFor(id: ClientId)` takes only that.
     It is minted in one place — `coach/access.ts` `resolveClient` / its private `asClient` — after `users.byId` found
     an account with role `user`; an admin's `UserId` (the caller's included) does not compile there. `assertCoach`
     (role admin, else `NotCoach` → 403) is the first statement of `list`, `detail` and `photo`.
   - **SQL**: four new statements (days in a date range; `MIN/MAX(date)` over days, weights, measures — three
     separate statements so no `UNION` needs an exemption), all `user_id = ?`; the scope lint (item 4) is **not
     edited** and still has exactly 28 allowlist entries.
   - **Coach lint** (`apps/server/src/coach/coach-lint.test.ts`): `routes/coach.ts` has no
     `.post/.put/.patch/.delete/.all/.on/.use/.route/.mount(`, at least 4 `app.get(` and the exact
     `registerCoachRoutes` parameters; `readerFor` appears only in `db/data.ts`, `photos/store.ts`, `coach/access.ts`;
     `.readers` only in `http/app.ts`; `as ClientId` only in `coach/access.ts`; `createCoachAccess(` /
     `registerCoachRoutes(` are called only in `http/app.ts`; `deps.ts` never mentions `coach` / `Reader`;
     `coach/access.ts` has no `.forUser(`, write call or SQL literal; reader key lists and `Object.isFrozen` are
     checked at runtime.
   - **Route-table test** (`apps/server/test/coach.test.ts`): on the real app every route whose path starts with
     `/api/coach` has method `GET`, and their path set equals `COACH_ROUTES` — a non-GET or extra coach path
     registered by any module fails. `HEAD` is answered 405 before any read (Hono routes it through `GET`).

---

## 5. Per-user subsystems

### 5.1 Data, ops, export, import (`db/data.ts`, `http/routes/data.ts`)

`DataRepo` keeps its API (`read`, `settings`, `apply`, `replaceAll`, `setTimezone`, `isDone`) but every statement is
scoped: `writeFoods` is `DELETE FROM foods WHERE user_id = ?` + inserts; `replaceAll` deletes only the user's days /
weights / measures / foods and upserts their `user_settings`; settings read `user_settings` (missing row →
`normalizeSettings(null)`). `GET /api/export` → the user's AppData, file name unchanged `legko-YYYY-MM-DD.json` (date
in the user's timezone). `POST /api/import` replaces only the user's data. Server backups (`VACUUM INTO`) still hold
the whole database (owner/SSH only).

### 5.2 Photos (`photos/store.ts`, `http/routes/photos.ts`, `http/routes/food.ts`)

- `forUser(id).save(upload, date)` inserts `user_id`; `forUser(id).read(photoId, variant)` returns null unless a row
  `WHERE id = ? AND user_id = ?` exists → route 404 `not_found`. Recalculation with another user's `photoId` → 404
  `not_found` with `MESSAGES.photoNotFound` «Фото не знайдено» (unchanged code and message).
- Photo responses carry `Vary: Cookie` and deliberately no `ETag` / `Last-Modified`: after a logout or an account
  switch the request reaches the server and the owner check again (never a 304 from another session's cache entry);
  offline viewing within a session keeps working. (Entries cached by the pre-release build have no `Vary`; only anna's
  photos existed then.)
- An estimate with a photo reserves the AI budget (`tryConsume`) **before** `photos.save` (after decoding): a refused
  request stores nothing. Recalculation reads the photo first (owner check → 404), then reserves.
- A meal may contain any photo id string (schema only checks the format), but references count only for the owner.
- GC (daily 03:40 Kyiv, unchanged slot):

  ```sql
  SELECT p.id, p.user_id FROM photos p WHERE p.created_at < ?
    AND NOT EXISTS (SELECT 1 FROM days d WHERE d.user_id = p.user_id
                      AND d.meals IS NOT NULL AND NOT json_valid(d.meals))            -- owner has a corrupt row: keep
    AND NOT EXISTS (SELECT 1 FROM days d, json_each(d.photos) j
                    WHERE d.user_id = p.user_id AND j.value = p.id)
    AND NOT EXISTS (SELECT 1 FROM days d,
                      json_each(CASE WHEN json_valid(d.meals) THEN d.meals ELSE '[]' END) m,
                      json_each(m.value, '$.photos') j
                    WHERE d.user_id = p.user_id AND j.value = p.id)
  ```

  The query selects `p.id, p.user_id`; each candidate is deleted with `DELETE FROM photos WHERE id = ? AND user_id = ?`
  before its files are removed. Warn once per run (no content): `photo gc: kept the photos of N account(s) with
  unreadable meal data`.
  Stray files (no row, older than 24 h) are removed as today — this also cleans up after a crash during a user delete.
- User delete: select the user's photo ids → `DELETE FROM users WHERE id = ?` (cascade) in a transaction → after
  commit `photos.removeFiles(ids)`.

### 5.3 AI budget (`food/budget.ts`)

`createFoodBudget(db, defaults: AiLimits, timeZone = 'Europe/Kyiv')`:

- `limits()` — `kv.ai_limits` when valid, else `defaults` (`{ perUser: config FOOD_USER_DAILY_LIMIT ?? 40, global:
  FOOD_DAILY_LIMIT ?? 150 }`); `setLimits(l)` writes kv.
- `forUser(id)`: `limit()` = `users.ai_daily_limit ?? limits().perUser`; `remaining(now)` = `max(0, min(limit − used
  today, global − global today))`; `tryConsume(now) → 'ok' | 'user_limit' | 'global_limit'` in one `BEGIN
  IMMEDIATE` (read both counters, increment `ai_usage` and `kv.food_budget` together).
- `usage(now) → { globalToday, byUser: Map<UserId, { today, last30Days }> }` (admin overview); `prune(now)` deletes
  `ai_usage` older than 90 days (daily, with the photo GC); `secondsUntilReset(now)` unchanged.
- Route: `'user_limit'` → 429 `rate_limited` «Ліміт підрахунків на сьогодні вичерпано»; `'global_limit'` → 429
  `rate_limited` «Підрахунки на сьогодні закінчилися. Спробуй завтра» (the client shows its own text for 429 anyway).
- `GET /api/food/status` → `{ enabled, remainingToday, limitToday }` (`limitToday` new, optional in the type;
  `remainingToday` is a whole number ≥ 0, never above `limitToday`). `enabled` is false when there is no key, the env
  `FOOD_DAILY_LIMIT` is 0, the account's own limit is 0 or the saved global ceiling is 0 (then the client hides the AI
  row and the «Акаунт» block); a used-up daily limit still reports `enabled: true` (and the estimate answers 429).

### 5.4 Push and reminders (`push/subscriptions.ts`, `push/service.ts`, `reminders/*`, `index.ts`)

- Subscriptions: `forUser(id).upsert(sub, ua, now) → 'ok' | 'conflict'` = `INSERT … ON CONFLICT (endpoint) DO UPDATE
  SET user_id = excluded.user_id, p256dh, auth, user_agent, created_at = CASE WHEN push_subscriptions.user_id =
  excluded.user_id THEN push_subscriptions.created_at ELSE excluded.created_at END, last_ok_at = CASE … ELSE NULL END
  WHERE push_subscriptions.user_id = excluded.user_id OR push_subscriptions.auth = excluded.auth` (D15): a
  cross-user move needs the same `auth` key; when the `WHERE` leaves the row untouched (`changes === 0`) → `'conflict'`
  → the route answers 403 `forbidden` and does not touch the timezone. `remove(endpoint, auth?)` = `DELETE … WHERE
  endpoint = ? AND (user_id = ? OR auth = ?)` (auth omitted → only `user_id = ?`) → boolean; `markOk` / gone-removal
  `WHERE endpoint = ? AND user_id = ?`; `all()` the user's only; `recipients()` = distinct user ids of subscriptions
  whose user is not disabled; `removeAllFor(id)` (disable).
- `pushUnsubscribeRequestSchema` gains optional `auth` (1–100 chars); the client's `disablePush()` sends
  `subscription.toJSON().keys.auth`, so after a switch the new user's request removes the previous user's row at once.
- `PushService { publicKey; forUser(id): { subscribe, unsubscribe, send(message, options) → SendSummary };
  recipients(): UserId[] }`. `POST /api/push/test` sends to the caller's devices only. Subscribe sets **the caller's**
  `settings.timezone` (`data.forUser(id).setTimezone`).
- Scheduler tick (30 s): for each `recipients()` user, sequentially, `runReminderTick({ data: data.forUser(id), log:
  reminderLogs.forUser(id), push: push.forUser(id), logger }, now)` through `createReminderRound`: each user's tick has
  a 30 s budget (`USER_TICK_TIMEOUT_MS`); a late tick keeps running on its own while the round goes on, and that user
  is skipped until it ends (no duplicate reminder); one failing tick is logged and stops nobody else. Each user's own
  `settings.rem` and `settings.timezone`; `isDone` reads that user's rows; `reminder_log(user_id, kind, date)`.
  Payload unchanged (`{ title, body, url, tag }`).
- `index.ts` runs **two independent loops** joined by `combineLoops` (`loop.ts`): reminders, and maintenance (daily
  backup, photo GC, AI prune, session and link purge) — a stuck push service can no longer hold up maintenance.
- **Push endpoints** (`isAllowedPushEndpoint`, `push/transport.ts`): subscribe accepts only `https` endpoints on the
  known push services — `web.push.apple.com`, `*.push.apple.com`, `fcm.googleapis.com`,
  `updates.push.services.mozilla.com`, `*.push.services.mozilla.com`, `*.notify.windows.com` — on the default port and
  without userinfo (IP literals, `localhost`, trailing-dot names and look-alike suffixes never match); anything else →
  400 `bad_request` «Цей сервіс сповіщень не підтримується», nothing stored, the timezone untouched. The transport
  also refuses a disallowed stored row without making a request.
- **Delivery**: `webpush.generateRequestDetails` builds the request (VAPID, aes128gcm) and the transport sends it with
  `https.request` itself: an overall deadline of 20 s (`PUSH_DEADLINE_MS`), a 2xx settles on its headers, at most 4 KiB
  (`PUSH_MAX_RESPONSE_BYTES`) of a refusal is read before the socket is destroyed.
- **Caps**: at most `MAX_SUBSCRIPTIONS_PER_USER` = 10 devices per user (a new one forgets that user's oldest; a
  re-subscribe of the same endpoint is not counted; other users untouched); a send reaches only the newest 10.
  `POST /api/push/test` is limited per user (`PUSH_TEST_LIMIT`, 5 per 10 min, every attempt counts) → 429
  `rate_limited` with `Retry-After`.

### 5.5 Logs

Never log tokens, passwords, hashes, push endpoints (host only, as today) or content. Account events log the user
**id** and the action (`user 3f…a1 created via invite`, `user … disabled by …`, the link lines of §3.4). Start-up:
`No accounts yet: run cli.js create-admin <name>` (info) when `users` is empty; `No admin account: run cli.js
create-admin <name>` (info) when there is none; the AI line shows the effective limits and their source: `AI calorie
estimate enabled (model …, per user 40, global 150; limits from kv.ai_limits | env | defaults)`.

---

## 6. API contract (`packages/shared`)

### 6.1 New module `packages/shared/src/users.ts` (exported from `index.ts`)

```ts
export type UserRole = 'admin' | 'user';
export const USER_ROLES = ['admin', 'user'] as const;
export const USERNAME_LIMITS = { min: 3, max: 32 } as const;
export const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
export const ALIAS_USERNAMES = ['legko'] as const;                 // never usable (login alias, D3)
export const RESERVED_USERNAMES = ['legko', 'admin'] as const;     // refused for invites and self-rename (D2)
/** The v4 migration's id for the legacy owner when kv.legacy_user names none (D1). */
export const LEGACY_OWNER_ID = '00000000000000000000000000000001';
export const PASSWORD_LIMITS = { min: 8, max: 200 } as const;
export const INVITE_NOTE_MAX = 60;
export const MAX_PENDING_INVITES = 20;
export const INVITE_TTL_MS = 7 * 86_400_000;
export const RESET_TTL_MS = 86_400_000;          // reset and setup links
export const DEFAULT_AI_LIMITS: AiLimits = { perUser: 40, global: 150 };
export const AI_LIMIT_BOUNDS = { perUser: { min: 0, max: 1000 }, global: { min: 0, max: 10_000 } } as const;
export const LINK_PATHS = { invite: '/invite', reset: '/reset' } as const;
export type LinkKind = keyof typeof LINK_PATHS;
export type LinkProblem = 'unknown' | 'expired' | 'used' | 'revoked';
/** Request header with the device user's id (D11). */
export const USER_HEADER = 'X-Legko-User';

export function usernameKey(name: string): string;                 // trim + toLowerCase
/** `allowAdmin` (CLI, dev bootstrap) lets 'admin' through; 'legko' is always 'reserved'. */
export function usernameProblem(name: string, opts?: { allowAdmin?: boolean }): 'length' | 'chars' | 'reserved' | null;
export function linkPath(kind: LinkKind, token: string): string;   // '/invite#<token>'
/** '#<43 base64url chars>' (location.hash) → token, else null. */
export function tokenFromHash(hash: string): string | null;
/** A pasted link (D29): same origin, path in LINK_PATHS, valid fragment → { kind, token }, else null. */
export function parseLink(value: string, origin: string): { kind: LinkKind; token: string } | null;

export interface AiLimits { perUser: number; global: number }
export type PasswordChangeVia = 'self' | 'reset' | 'setup' | 'cli';
export interface PasswordChange { at: number; via: PasswordChangeVia; /** link creator's username; null = self / CLI / deleted */ by: string | null }
export interface SessionUser {
  id: string; username: string; role: UserRole; createdAt: number; legacyOwner: boolean;
  passwordChange: PasswordChange | null;           // D28
}
export interface AdminUser {
  id: string; username: string; role: UserRole;
  status: 'active' | 'disabled' | 'pending';       // pending = no password yet
  createdAt: number; lastSeenAt: number | null;    // lastSeenAt = last activity, not last login
  ai: { today: number; last30Days: number; limit: number; customLimit: number | null };
  self: boolean;
}
/** createdBy = the creator's **username**; null = made in the CLI (pending links of demoted / deleted admins are revoked, D27). */
export interface AdminInvite { id: string; note: string; role: UserRole; createdAt: number; expiresAt: number; createdBy: string | null }
export interface AdminOverview { users: AdminUser[]; invites: AdminInvite[]; limits: AiLimits; aiToday: { used: number; ceiling: number } }
```

Schemas (in `schemas.ts`, zod 4 jitless as today):

```ts
export const userIdSchema = z.string().regex(/^[0-9a-f]{32}$/);
export const linkTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
export const usernameSchema = z.string().trim().refine((v) => usernameProblem(v) === null, 'Invalid username');
export const newPasswordSchema = z.string().min(PASSWORD_LIMITS.min).max(PASSWORD_LIMITS.max);
export const loginRequestSchema = z.object({ username: z.string().trim().min(1).max(64).optional(), password: z.string().min(1).max(200) });   // CHANGED (absent = 'legko', D24)
export const pushUnsubscribeRequestSchema = z.object({ endpoint: z.url().max(2000), auth: z.string().min(1).max(100).optional() });   // CHANGED (D15)
export const sessionUserSchema = z.object({ id: userIdSchema, username: z.string().min(1).max(64), role: z.enum(USER_ROLES),
  createdAt: z.number(), legacyOwner: z.boolean(),
  passwordChange: z.object({ at: z.number(), via: z.enum(['self', 'reset', 'setup', 'cli']), by: z.string().nullable() }).nullable() });
export const meResponseSchema = z.object({ ok: z.literal(true), user: sessionUserSchema });   // the client validates every MeResponse / LoginResponse
export const linkCheckRequestSchema = z.object({ token: linkTokenSchema });
export const inviteAcceptRequestSchema = z.object({ token: linkTokenSchema, username: z.string().max(64), password: z.string().max(200) });
export const resetCompleteRequestSchema = z.object({ token: linkTokenSchema, password: z.string().max(200) });
export const changePasswordRequestSchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().max(200) });
export const renameRequestSchema = z.object({ username: z.string().max(64), password: z.string().min(1).max(200) });
export const createInviteRequestSchema = z.object({ note: z.string().trim().max(INVITE_NOTE_MAX).default('') });
export const inviteIdRequestSchema = z.object({ id: userIdSchema });          // invite ids use the same 32-hex format
export const userTargetRequestSchema = z.object({ userId: userIdSchema });
export const setRoleRequestSchema = z.object({ userId: userIdSchema, role: z.enum(USER_ROLES) });
export const setDisabledRequestSchema = z.object({ userId: userIdSchema, disabled: z.boolean() });
export const deleteUserRequestSchema = z.object({ userId: userIdSchema, confirmUsername: z.string().max(64) });
export const aiLimitsSchema = z.object({ perUser: z.number().int().min(0).max(1000), global: z.number().int().min(0).max(10_000) });
export const userAiLimitRequestSchema = z.object({ userId: userIdSchema, limit: z.number().int().min(0).max(1000).nullable() });
```

(Username / new-password rules are checked in the route with `usernameProblem` / `passwordProblem`, so they map to
`invalid_username` / `weak_password` instead of a generic `bad_request`.)

### 6.2 `api.ts` changes

```ts
export const API = {
  …existing…,
  inviteCheck: '/api/auth/invite/check',     // POST { token } → InviteCheckResponse | 410
  inviteAccept: '/api/auth/invite/accept',   // POST { token, username, password } → LoginResponse (sets cookie)
  resetCheck: '/api/auth/reset/check',       // POST { token } → ResetCheckResponse | 410
  resetComplete: '/api/auth/reset/complete', // POST { token, password } → LoginResponse (sets cookie)
  accountPassword: '/api/account/password',  // POST { currentPassword, newPassword } → OkResponse (+ fresh cookie, D26)
  accountUsername: '/api/account/username',  // POST { username, password } → MeResponse
  adminUsers: '/api/admin/users',            // GET → AdminOverview
  adminInviteCreate: '/api/admin/invites',   // POST { note? } → InviteCreatedResponse
  adminInviteRevoke: '/api/admin/invites/revoke', // POST { id } → OkResponse
  adminResetLink: '/api/admin/users/reset-link',  // POST { userId } → LinkResponse
  adminSetRole: '/api/admin/users/role',     // POST { userId, role } → OkResponse
  adminSetDisabled: '/api/admin/users/disable', // POST { userId, disabled } → OkResponse
  adminDeleteUser: '/api/admin/users/delete',   // POST { userId, confirmUsername } → OkResponse
  adminUserAiLimit: '/api/admin/users/ai-limit', // POST { userId, limit } → OkResponse
  adminAiLimits: '/api/admin/ai-limits',     // POST { perUser, global } → OkResponse
} as const;
export interface MeResponse { ok: true; user: SessionUser }          // GET /api/auth/me (was OkResponse; old clients only read the status)
export type LoginResponse = MeResponse;                              // login, inviteAccept, resetComplete
export interface InviteCheckResponse { ok: true; expiresAt: number }
export interface ResetCheckResponse { ok: true; username: string; purpose: 'reset' | 'setup'; expiresAt: number }
export interface LinkResponse { ok: true; path: string; expiresAt: number }
export interface InviteCreatedResponse extends LinkResponse { invite: AdminInvite }
export interface FoodStatusResponse { enabled: boolean; remainingToday: number; /** This user's daily limit. */ limitToday?: number }
export interface ErrorResponse { error: ApiErrorCode; message: string; index?: number; /** link_invalid */ reason?: LinkProblem }
export type ApiErrorCode = …existing ('bad_password' is still sent, «Неправильний пароль», for a failed username-less
  login — the pre-v4 bundle, D24; named logins answer 'bad_credentials')…
  | 'bad_credentials' | 'account_disabled' | 'forbidden' | 'user_mismatch' | 'link_invalid' | 'username_taken'
  | 'invalid_username' | 'weak_password' | 'wrong_password' | 'last_admin' | 'self_action' | 'limit_reached';
```

### 6.3 Endpoint table

| Method · path | Auth | 200 | Errors (status `code`) |
| --- | --- | --- | --- |
| POST `/api/auth/login` | — (IP + username throttle; production: success budget 30/h, §3.5) | `LoginResponse` + cookie (incoming session revoked; production: ≤ 20 sessions per user) | 400 `bad_request` (malformed body; a missing username is the `legko` alias) · 401 `bad_credentials` (401 `bad_password` without a username, D24) · 403 `account_disabled` · 429 `rate_limited` (also scrypt gate full, success budget) |
| POST `/api/auth/logout` | optional | `OkResponse` | — |
| GET `/api/auth/me` | session | `MeResponse` | 401 |
| POST `/api/auth/invite/check` | — (link throttle) | `InviteCheckResponse` | 400 · 410 `link_invalid`+`reason` · 429 |
| POST `/api/auth/invite/accept` | — (link throttle) | `LoginResponse` + cookie | 400 `invalid_username` / `weak_password` / `bad_request` · 409 `username_taken` · 410 · 429 |
| POST `/api/auth/reset/check` | — (link throttle) | `ResetCheckResponse` | 400 · 410 · 429 |
| POST `/api/auth/reset/complete` | — (link throttle) | `LoginResponse` + cookie | 400 `weak_password` · 403 `account_disabled` · 410 · 429 |
| POST `/api/account/password` | session | `OkResponse` | 400 `weak_password` · 403 `wrong_password` · 429 |
| POST `/api/account/username` | session | `MeResponse` | 400 `invalid_username` · 403 `wrong_password` · 409 `username_taken` · 429 |
| GET `/api/admin/users` | admin | `AdminOverview` | 401 · 403 `forbidden` |
| POST `/api/admin/invites` | admin | `InviteCreatedResponse` | 409 `limit_reached` |
| POST `/api/admin/invites/revoke` | admin | `OkResponse` | 404 `not_found` (unknown or no longer pending) |
| POST `/api/admin/users/reset-link` | admin | `LinkResponse` (purpose setup when no password) | 404 · 409 `account_disabled` |
| POST `/api/admin/users/role` | admin | `OkResponse` | 404 · 409 `last_admin` |
| POST `/api/admin/users/disable` | admin | `OkResponse` | 404 · 409 `last_admin` / `self_action` |
| POST `/api/admin/users/delete` | admin | `OkResponse` | 400 `bad_request` (confirm ≠ username, case-insensitive) · 404 · 409 `last_admin` / `self_action` |
| POST `/api/admin/users/ai-limit` | admin | `OkResponse` | 404 |
| POST `/api/admin/ai-limits` | admin | `OkResponse` | 400 |
| GET `/api/coach/clients?from=&to=` (D32) | admin | `CoachClientsResponse` (role-`user` accounts only; profile `{ id, username, status, createdAt, lastSeenAt }` + digests) | 401 · 403 `forbidden` · 400 `bad_request` «Некоректний період» (missing / invalid date, to < from, > 62 days) |
| GET `/api/coach/clients/:id` (D32) | admin | `CoachClientResponse` (`data.foods` = []) | 401 · 403 · 404 `not_found` (malformed / unknown id, any admin incl. the caller) |
| GET `/api/coach/clients/:id/photos/:photoId[/thumb]` (D32) | admin | `image/jpeg` of a photo owned by that client | 401 · 403 · 400 `bad_request` (photo id format, first) · 404 (not a client; not their photo; file missing) |
| HEAD · POST · PUT · PATCH · DELETE · OPTIONS `/api/coach/**` | — | never | HEAD (after auth / admin) 405 `Allow: GET`, nothing read or logged · writes 403 `forbidden_origin` (no same-origin Origin / JSON), else 404 · OPTIONS 404 |
| existing data / ops / export / import / push / food / photos | session, **scoped** | unchanged | + 409 `user_mismatch` when `X-Legko-User` ≠ session user, or when it is missing on data / ops / import with a non-legacy session (D11) |
| POST `/api/push/subscribe` | session | `OkResponse` | + 400 `bad_request` «Цей сервіс сповіщень не підтримується» (not a known push service, §5.4) · 403 `forbidden` when the endpoint belongs to another user with a different `auth` key (D15) |
| POST `/api/push/unsubscribe` | session | `OkResponse` | body gains optional `auth` (D15) |
| POST `/api/push/test` | session | `PushTestResponse` (the caller's devices only) | + 429 `rate_limited` after 5 per 10 min (§5.4) |

`429 rate_limited` on invite/accept and reset/complete also answers a second request for a token that is still being
processed (in-flight guard, §3.4). The client maps a 2xx `me` / login / link / rename answer without a valid `user`
(an old server during a rollback) to its own `ApiError` code `outdated_server` (§10).

Server messages (`http/errors.ts` `MESSAGES`, Ukrainian): `badCredentials` «Неправильне імʼя або пароль»,
`accountDisabled` «Акаунт вимкнено. Звернись до адміністратора», `forbidden` «Немає доступу», `userMismatch` «На
цьому пристрої ввійдено в інший акаунт», `linkInvalid` «Посилання не працює», `usernameTaken` «Це імʼя вже зайняте»,
`invalidUsername` «Імʼя: 3–32 символи — латинські літери, цифри, крапка (.), дефіс (-) або підкреслення (_)» (no-break
spaces before the brackets; the same text as the web forms), `badPassword` «Неправильний пароль» (username-less login
only, D24), `weakPassword` «Пароль —
щонайменше 8 символів», `wrongPassword` «Поточний пароль неправильний», `lastAdmin` «Це єдиний адміністратор», `selfAction`
«Із власним акаунтом так не можна», `tooManyInvites` «Забагато активних запрошень — скасуй старі», `globalFoodLimit`
«Підрахунки на сьогодні закінчилися. Спробуй завтра», `confirmMismatch` «Імʼя для підтвердження не збігається».

---

## 7. CLI (`apps/server/src/cli/run.ts`, bundled `dist/cli.js`)

| Command | Behaviour |
| --- | --- |
| `create-admin <username>` | Validates the name (`allowAdmin`); **refuses (exit 1) when the user exists**, showing its role: an existing admin → «User admin already exists (admin). For a new password link: reset-password-link admin»; an existing **regular** user → «User admin exists as a regular user — pick another name» (never suggests a reset link). Creates role admin with **no password**, a `setup` link (24 h) and prints `PUBLIC_ORIGIN/reset#<token>` + expiry (Kyiv time). |
| `create-invite [--admin] [--note <text>]` | Prints `PUBLIC_ORIGIN/invite#<token>` (7 days, role user or admin). |
| `reset-password-link <username>` | Works for admins too; `setup` when the user has no password; revokes older pending links of the user; prints link + expiry. Unknown user → exit 1. |
| `set-password <username> [--stdin]` | Hidden prompt twice (or one stdin line); revokes that user's sessions. No username → usage, exit 2. |
| `set-role <username> <admin\|user>` | Refuses removing the last usable admin (exit 1). Demotion revokes their sessions. |
| `list-users` | Table: username · role · status (active/disabled/no password) · created · last seen · AI today. Never hashes or tokens. |
| `rename-user <old> <new>` | Validates (`allowAdmin`), refuses taken names and `legko`. Sessions kept. |
| `list-links` | Pending invites and reset/setup links: id · kind (invite / reset / setup) · role (invites) · for (username, resets) · created by (username or `cli`) · expires (Kyiv). Never tokens or hashes. |
| `revoke-links [--by <username> \| --all]` | Revokes pending links created by that user, or all pending links (exactly one of the two flags; none → usage, exit 2). Prints how many were revoked. |
| `downgrade-schema [--keep <username>] [--drop-others]` | v4 → v3 (§2.4; refusal lists other users' per-table counts; `--drop-others` drops them after the snapshot and prints the dropped counts) or, on a v3 DB, v3 → v2 (unchanged). Opens without migrating. Usage text: «Run it only when `deploy.sh status` shows a `previous` image from before the users release.» |

Account commands open the DB through `openForAccounts`: a missing or v0 file is created and migrated (first install);
a file at the current schema opens as it is; an **older schema is refused** (exit 1, nothing changed — no migration,
no snapshot) with «start the server once, or finish the rollback with the previous image's CLI». Only the server
migrates, so `create-admin admin` runs **after** the new image's first start (DEPLOY order), and a command run by
mistake between `downgrade-schema` and `deploy.sh rollback` cannot re-migrate the downgraded file. `downgrade-schema`
opens without migrating. They are safe while the server runs (WAL, 5 s busy timeout). Links use `loadConfig(env).publicOrigin` (compose sets
`PUBLIC_ORIGIN=https://fit.triple-a.dev`). Output goes to stdout only; nothing is written to logs.
`deploy/deploy.sh` gains `cli <command> [args…]` (passthrough with TTY) and `set-password <username>`.

---

## 8. Client (web)

### 8.1 Device storage (IndexedDB, idb-keyval default store)

| Key | Value |
| --- | --- |
| `legko.user` | the full `SessionUser` (`id, username, role, createdAt, legacyOwner, passwordChange`) — whose copy this device holds (the **device user**); refreshed from every `me` |
| `legko.data.<id>` / `legko.outbox.<id>` | that user's AppData copy / pending ops (same shapes as today) |
| `legko.data` / `legko.outbox` | legacy keys: written before accounts existed, or by the old bundle during a rollback; adopted / merged by the legacy owner, then deleted |
| `localStorage['legko.wipePending']` | tombstone `'1'` while a logout / switch wipe is not verified (D12); every access in try/catch |

`cache.ts` (web-auth): `cacheKeys(owner)`; `bindCache(owner)` (owner = user id or `LEGACY_OWNER = ''` for the legacy
keys; writes are coalesced per full key, so rebinding never mixes owners). **With no owner bound** (`bindCache` never
called — unit tests of other screens) `persist` / `loadCache` / `flushCacheWrites` / `resetLocal` behave exactly as
today on the legacy keys and memory. `loadCache()` / `persist(kind, value)` for the bound owner;
`loadDeviceUser()` / `saveDeviceUser(user: SessionUser)`; `hasLegacyCache()`; `adoptLegacyCache(id)` (after
`flushCacheWrites()`; copies both legacy keys to the user's keys and deletes them, in one serial task);
`mergeLegacyCache(id)` (one serial task: `legko.data.<id> := legko.data`; `legko.outbox.<id> :=` the per-user items
followed by the legacy items whose `OutboxItem.id` is not already present; delete the legacy keys); `outboxSize(owner)`.

`wipeDevice({ keepLegacy? })` (D12):
1. `localStorage['legko.wipePending'] = '1'`; clear memory and pending writes.
2. **Always** try IndexedDB, whatever `idbUsable` says: `keys()` → `delMany` of every `legko.*` key (all of them with
   `keepLegacy: false`; except `legko.data` / `legko.outbox` with `keepLegacy: true`), with its own 3 s timeout; on a
   failure or timeout, fall back to `indexedDB.deleteDatabase('keyval-store')` (also 3 s).
3. Verify with `keys()` that no such key is left → remove the tombstone; otherwise keep it. Never throws; resolves
   within ~7 s at worst, so logout / switch cannot hang.

sessionStorage keys starting with `legko.` (e.g. `legko.setupShown`) are cleared on logout / switch, except
`legko.linkToken` while a link flow continues.

### 8.2 Auth state machine (`auth/auth.ts`)

`AuthState = { status: 'checking' | 'authed' | 'anon'; offline: boolean; user: SessionUser | null }`
(`user` null only in the provisional legacy state below; otherwise from the pointer, then from `me`).

All `me` / login / link / rename answers are validated with `meResponseSchema` in `lib/api.ts`; a 2xx without a valid
`user` (an old v3 server during a rollback answers `{ ok: true }` to both `me` and a `{ username, password }` login,
because zod strips the unknown key) throws `ApiError` code `outdated_server`. Background `me` / `refreshUser` ignore it
(pointer, cache and the bound sync stay as they are; never switch or wipe); the login / invite / reset screens show
«Щось пішло не так»; start path 3 → `anon + offline`.

- **Start (`check`)**
  0. Tombstone `legko.wipePending` present → `wipeDevice()` again; if it still is not verified, treat the device as
     **empty** (no pointer, no copy rendered, memory only) and go to step 3.
  1. Legacy keys present **and** a pointer with `legacyOwner` → `mergeLegacyCache(pointer.id)` first (the rolled-back
     app wrote them; their unsent ops are sent once), then step 2. Legacy keys present and a pointer that is **not**
     the legacy owner → leave the legacy keys untouched (never rendered, never sent) until the legacy owner signs in
     on this device (`signedIn` adopts them) or a logout wipes the device; continue with step 2.
  2. Device user + their cache present → `authed` at once (offline-first, as today), `startSync(id)`; background
     `me`: same id → refresh the pointer (full `SessionUser`), `refreshPush()`; **different id** → when the device
     copy has **no** pending ops: switch (below, without the confirm: the cookie already belongs to the other
     account); when it **has** pending ops: stop sync, `anon` (data kept, nothing wiped) — the login screen shows the
     pending hint and the login decides (signing in as the device user sends them; signing in as anyone else goes
     through `SWITCH_CONFIRM`); 401 → `anon` (data kept); network / `outdated_server` → ignore.
  3. No device user, legacy keys present → bind `LEGACY_OWNER`, render the legacy copy **provisionally** (no sync —
     the owner is unknown); `me`: `user.legacyOwner` → `adoptLegacyCache(user.id)`, save pointer, rebind,
     `startSync(id)`; not legacy owner → `wipeDevice()` + reload; 401 → `anon`, legacy kept until a login decides.
  4. Nothing on the device → `me` → `authed` (pointer saved) / 401 `anon` / network or `outdated_server` → `anon +
     offline`.
- **Signed in (`signedIn(user, { reload = true, next } = {})`, after login, invite accept, reset complete)**
  - Device user is another account (or legacy keys and `!user.legacyOwner`): when that copy has pending ops →
    `ui.confirm(SWITCH_CONFIRM)`; cancel → `api.logout()` (ends the new session), stay `anon`, return `'cancelled'`;
    then `disablePush()` (browser unsubscribe + server unsubscribe with `auth`, D15 — removes the previous user's
    row at once), `wipeDevice({ keepLegacy: user.legacyOwner })` (anna's own legacy ops survive a switch to her and
    are adopted after the reload), `saveDeviceUser(user)`, broadcast, `location.replace(target)`.
  - Legacy keys and `user.legacyOwner` → adopt (after `flushCacheWrites()`), pointer, `authed`.
  - Same user (expired session) → `authed`, keep memory and outbox (pending ops are sent, as today), `refreshPush()`.
  - Empty device → pointer, `authed`; after an invite or a reset → `location.replace(target)`.
  - `target` = `next` ?? (`user.role === 'admin'` after a link flow ? `/settings/users` : `/`) (D23).
  - `reload: false` (the iOS Safari «Готово» state, §8.4) does all storage work but leaves the reload to the
    screen's «Продовжити в Safari» button.
- **Logout**: unchanged confirm logic (`flushNow` → `LOGOUT_CONFIRM` or `UNSYNCED_LOGOUT_CONFIRM`) →
  `disablePush()` → `api.logout()` → `wipeDevice()` (awaited; bounded, never hangs) → broadcast →
  `location.replace(next ?? '/')`.
- **401 during sync** → `anon`, data kept (as today); the login screen pre-fills the device user's username.
- **409 `user_mismatch`** → stop sync, re-run `check()` (step 2 rules: switch only when nothing is pending; never a
  silent wipe of unsent ops). The worker never sends a device user's outbox without the header.
- **Multi-tab**: `BroadcastChannel('legko.auth')` messages `{ type: 'switched' | 'logged-out' }` make other tabs
  reload; the header (D11) covers browsers without BroadcastChannel; the `legacy` session flag (D11) covers tabs
  still running the pre-v4 bundle.
- **Role / name freshness**: `me` again when the app returns to the foreground (≥ 5 min since the last one); an admin
  page that gets 403 `forbidden` calls `authActions.refreshUser()`.

### 8.3 Sync binding (`store/sync.ts`, `store/data.ts`, `lib/api.ts`)

`startSync(owner: string)` binds the owner for the session; `api.getData(owner)`, `api.sendOps(ops, owner)`,
`api.importData(data, owner)` send `X-Legko-User: owner`. `hasDeviceCache()` checks the bound owner. Nothing in the
public `dataActions` API changes; with no owner bound, `commit` / `resetLocal` keep today's behaviour (other screens'
unit tests never call `startSync`).

### 8.4 Link routes (`/invite`, `/reset`)

`AuthGate` checks `location.pathname` **before** the auth status: `/invite` → `InviteScreen`, `/reset` →
`ResetScreen` (both in `screens/login/`). On mount: `tokenFromHash(location.hash)` → `sessionStorage['legko.linkToken']
= { kind, token }` → `history.replaceState(null, '', path)`; a reload reads it back. Then `POST …/check`:
- 410 → «Посилання не працює» state by `reason` (§9.2 / §9.3); network → retry state.
- Device signed in as someone (status `authed`, or a device user present): invite → interstitial «Вийти й
  продовжити» (logout flow with `next = '/invite'`); reset for **another** username → same interstitial; reset for the
  signed-in user → the form directly.
- Success → `authActions.signedIn(user, …)`:
  - **iOS Safari, not standalone** (`isIOS() && !isStandalone()`, D29) → `reload: false` and the screen swaps to its
    «Готово» state (§9.2 / §9.3): the username in large selectable text, the install steps (`InstallSteps` exported
    from `sheets/install/InstallSheet.tsx`), primary «Продовжити в Safari» → `location.replace(target)`. Removing the
    form also lets Safari offer «Save password?».
  - everywhere else (desktop, Android, the installed app) → reload at once to `target` (a new user account gets
    «Перші кроки» by itself; an admin lands on `/settings/users`).
- iOS Safari only: a muted note under the form «Легко вже на початковому екрані? Скопіюй посилання й встав його там:
  «Маю посилання».» + ghost «Скопіювати посилання» (rebuilds `location.origin + linkPath(kind, token)` from
  sessionStorage — the fragment is already gone from the URL).
- **Paste into the installed app** (login screen «Маю посилання», §9.1): `parseLink(value, location.origin)` →
  sessionStorage `legko.linkToken` → `location.replace(pathname)`; otherwise «Це не схоже на посилання з Легко».
  The invite / reset then completes inside the installed app and signs in there directly.
`AuthGate` mounts `<ConfirmHost />` and `<Toast />` next to the login / link screens (outside `AppShell` they were not
mounted). Static server and SW already fall back to `index.html` for these paths.

### 8.5 Push, deep links, SW

`sw.ts` unchanged: a notification opens its URL; since a device's subscription always belongs to its device user (D15,
switch unsubscribes), it opens the app for the subscribed person. After a same-user re-login the deep link URL is kept
(`/?sheet=weight` → SheetHost); a switch reloads to `/` (the reminder was for the previous person).

### 8.6 First-run setup (`sheets/setupGate.ts`, `sheets/useSetupAutoOpen.ts`)

`setupGateAction(data, settled, shown, role)` → `'none'` for `role === 'admin'` (D23); otherwise unchanged. The
`legko.setupShown` flag is cleared on logout / switch (§8.1), so a new account on the same tab gets it.

### 8.7 Contract web-auth → web-admin

```ts
// @/auth/auth
export function useCurrentUser(): SessionUser | null;   // the full SessionUser from the pointer at once, then from `me`
export const authActions: { check; login(username, password); logout(next?: string): Promise<boolean>;
  signedIn(user, opts?: { reload?: boolean; next?: string }); sessionExpired(); updateUser(user: SessionUser): void;
  refreshUser(): Promise<void> };
// «Вийти» (LogoutRow) moves to the «Акаунт» page and keeps calling authActions.logout().
// @/lib/api — existing members plus:
api.me(): Promise<MeResponse>; api.login(username, password): Promise<LoginResponse>;
api.inviteCheck(token); api.inviteAccept({ token, username, password }); api.resetCheck(token); api.resetComplete({ token, password });
api.account.changePassword({ currentPassword, newPassword }): Promise<OkResponse>;
api.account.rename({ username, password }): Promise<MeResponse>;
api.admin.overview(): Promise<AdminOverview>;
api.admin.createInvite({ note }): Promise<InviteCreatedResponse>;
api.admin.revokeInvite({ id }); api.admin.resetLink({ userId }): Promise<LinkResponse>;
api.admin.setRole({ userId, role }); api.admin.setDisabled({ userId, disabled });
api.admin.deleteUser({ userId, confirmUsername }); api.admin.setUserAiLimit({ userId, limit });
api.admin.setAiLimits({ perUser, global });
api.pushUnsubscribe(endpoint, auth?);   // D15
// ApiError gains `reason?: LinkProblem`; ApiError.code adds the client-only 'outdated_server'.
```

---

## 9. UX and copy

All screens: 1b tokens, Manrope, `--r24` cards, 54px fields with 16px text, 56px solid primary buttons, `role="alert"`
errors in the `--accT` / `--accD` box (as the current login), light + dark, `prefers-reduced-motion`.

### 9.1 Login (`screens/login/LoginScreen.tsx`)

```
 ┌──────────────────────────────────────────┐
 │                  [Л]                     │
 │                 Легко                    │  h1 30/700
 │        Твій персональний трекер          │  15 --muted
 │ ( · На цьому пристрої є зміни anna, ще   │  only when the device user has pending ops: a neutral
 │   не надіслані на сервер. Увійди як      │  notice above the form (card bg, 1px --line border, --ink2,
 │   anna, щоб їх надіслати.             )  │  a faint dot), like Home's offline pill — not the mint acc2
 │ ┌──────────────────────────────────────┐ │
 │ │ Імʼя користувача                     │ │  label 13/600 --muted
 │ │ [ anna                             ] │ │  autocomplete=username, autocapitalize=none, enterkeyhint=next
 │ │ Пароль                               │ │  (pre-filled with the device user's name after a session expiry)
 │ │ [ ••••••••                      👁 ] │ │  autocomplete=current-password, eye toggle as today
 │ │ ┌ Неправильне імʼя або пароль ─────┐ │ │  role=alert
 │ │ Не памʼятаєш пароль? Попроси в       │ │  after a failed login only (FORGOT_HINT, 13 --muted)
 │ │ адміністратора посилання для нового  │ │
 │ │ пароля.                              │ │
 │ │ [             Увійти               ] │ │  «Входжу…»
 │ └──────────────────────────────────────┘ │
 │  Немає акаунта або не памʼятаєш пароль?  │  LOGIN_FOOTER, 13 --muted — hidden while FORGOT_HINT shows
 │  Попроси в адміністратора запрошення чи  │  (the same advice twice otherwise)
 │  посилання для нового пароля.            │
 │            [ Маю посилання ]             │  ghost, ≥ 44px; opens the paste field (D29); always shown
 └──────────────────────────────────────────┘

 «Маю посилання» expanded (inline, under the card):
 │ Встав посилання із запрошенням або для   │  label 13/600
 │ нового пароля                            │
 │ [ https://fit.triple-a.dev/invite#…    ] │  type=url, inputmode=url, autocapitalize=none, autocorrect=off
 │ [            Відкрити             ]      │  → parseLink → /invite or /reset
 │ ┌ Це не схоже на посилання з Легко ──┐   │  role=alert
```

Errors: `bad_credentials` «Неправильне імʼя або пароль» · `rate_limited` «Забагато спроб — спробуй за кілька хвилин» ·
`account_disabled` «Акаунт вимкнено. Звернись до адміністратора» · network «Немає зʼєднання з сервером» ·
`outdated_server` / other «Щось пішло не так». After `bad_credentials`, `bad_password` or `rate_limited`, a muted line
under the error box: «Не памʼятаєш пароль? Попроси в адміністратора посилання для нового пароля.»; while it shows, the
footer sentence under the card is hidden («Маю посилання» stays; with the paste field open the empty footer block is
dropped too). The fields' only focus indicator is their 2px focus border (`.input:focus-visible { outline: none }`
beats the global ring). Empty name →
focus the name field; empty password → focus the password. Autofocus (desktop only, `canAutofocus`): the password
when the name is pre-filled, otherwise the name. The hidden `username=legko` field is removed (D3 keeps her Keychain
entry working).

Switch confirm (`SWITCH_CONFIRM(previous, next, pending)`): title «Увійти як olya?», body «Зміни anna, ще не надіслані
на сервер: 3. Якщо ввійти іншим акаунтом, їх буде втрачено.», confirm «Увійти як olya», cancel «Скасувати»,
destructive.

### 9.2 Invite (`/invite`, `InviteScreen`)

```
 ┌──────────────────────────────────────────┐     Link not usable:
 │                  [Л]                     │     ┌──────────────────────────────────┐
 │          Запрошення в Легко              │ h1  │ [Л]  Посилання не працює          │
 │  Обери імʼя і пароль — і можна починати  │     │ Це запрошення вже використали.    │ used
 │ ┌──────────────────────────────────────┐ │     │ (Строк дії запрошення минув. ·    │ expired
 │ │ Імʼя користувача                     │ │     │  Запрошення скасовано. ·          │ revoked
 │ │ [ olya                             ] │ │     │  Посилання неправильне або        │ unknown
 │ │ 3–32 символи: латинські літери,      │ │     │  неповне.)                        │
 │ │ цифри, крапка (.), дефіс (-) або     │ │     │ (+ per-reason advice, see below)  │
 │ │ підкреслення (_)                     │ │     │                                   │
 │ │ Пароль                               │ │     │ [ Увійти | Відкрити Легко       ] │ → /
 │ │ [ ••••••••                      👁 ] │ │     └──────────────────────────────────┘
 │ │ Щонайменше 8 символів                │ │
 │ │ Повтори пароль                       │ │     Signed in on this device:
 │ │ [ ••••••••                         ] │ │     ┌──────────────────────────────────┐
 │ │ [          Створити акаунт         ] │ │     │ Запрошення в Легко               │
 │ └──────────────────────────────────────┘ │     │ На цьому пристрої вже ввійдено як │
 │  Посилання одноразове, діє до 28 жовтня. │     │ anna. Щоб створити новий акаунт,  │
 └──────────────────────────────────────────┘     │ спершу вийди.                     │
                                                  │ [      Вийти й продовжити       ] │ solid
                                                  │ [  Повернутися в застосунок     ] │ outline → /
                                                  └──────────────────────────────────┘
```

Inputs: name `autocomplete="username"` (+ autocapitalize=none, autocorrect=off, spellcheck=false), passwords
`autocomplete="new-password"`. Errors: `username_taken` «Це імʼя вже зайняте — обери інше» (on the name field) ·
`invalid_username` (rule text above, also checked on the device first; `reserved` → «Це імʼя зарезервоване — обери
інше») · `weak_password` «Пароль — щонайменше 8 символів» · mismatch «Паролі не збігаються» · 410 → the «Посилання не
працює» state · rate limit / network as at login. Busy «Створюю…». Loading the link: Splash.

«Посилання не працює» copy **per reason** (the sketch above is the frame):
- `used` — «Це запрошення вже використали. Якщо акаунт за ним уже створено — просто ввійди.» (no «Попроси…» line: the
  most common case is the new person tapping their own invite again);
- `expired` — «Строк дії запрошення минув.» · `revoked` — «Запрошення скасовано.» · `unknown` — «Посилання неправильне
  або неповне.» — each followed by «Попроси в адміністратора нове.»
- Button: «Увійти» when anonymous; «Відкрити Легко» when the status is `authed` or a device user exists; both → `/`.

iOS Safari only (D29): under the form the muted note «Легко вже на початковому екрані? Скопіюй посилання й встав його
там: «Маю посилання».» + ghost «Скопіювати посилання».

«Готово» state after a successful accept in iOS Safari (D29):

```
 ┌──────────────────────────────────────────┐
 │                  [Л]                     │
 │            Акаунт створено               │  h1
 │  Імʼя для входу: olya                    │  17/700, user-select: all
 │  Нагадування приходять у застосунок на   │  15 --ink2
 │  початковому екрані. Додай Легко туди й  │
 │  один раз увійди з цим імʼям і паролем.  │
 │  1 Натисни «Поділитися» …  (InstallSteps)│  the install sheet's steps, inline
 │ [        Продовжити в Safari         ]   │  solid → location.replace(target)
 └──────────────────────────────────────────┘
```

### 9.3 Reset / setup (`/reset`, `ResetScreen`)

```
 ┌──────────────────────────────────────────┐
 │                  [Л]                     │
 │        Новий пароль                      │  h1 (purpose setup: «Створення пароля»)
 │        для anna                          │  15 --muted (username from the check)
 │ ┌──────────────────────────────────────┐ │
 │ │ Новий пароль         [ •••••••• 👁 ] │ │  autocomplete=new-password; hidden username field = the name (Keychain)
 │ │ Щонайменше 8 символів                │ │
 │ │ Повтори пароль       [ ••••••••    ] │ │
 │ │ [          Зберегти пароль         ] │ │  «Зберігаю…»
 │ └──────────────────────────────────────┘ │
 │  Після цього всі пристрої, де ввійдено   │  13 --muted (setup: «Посилання одноразове, діє до 22 жовтня, 14:05.»)
 │  в акаунт, вийдуть з нього.              │
 └──────────────────────────────────────────┘
```

Link not usable: «Посилання не працює» + used «Це посилання вже використали. Якщо пароль уже змінено — увійди з ним.»
(no «Попроси…» line) · expired «Строк дії посилання минув.» · revoked «Посилання скасовано — є новіше.» · unknown
«Посилання неправильне або неповне.» — the last three followed by «Попроси в адміністратора нове.» Button «Увійти» /
«Відкрити Легко» as in §9.2. Signed in as another account: «Це посилання для admin, а на цьому пристрої ввійдено як
anna.» + «Вийти й продовжити» / «Повернутися в застосунок». `account_disabled` → «Акаунт вимкнено. Звернись до
адміністратора». iOS Safari: the same «Скопіювати посилання» note as §9.2, and after success a «Готово» state: h1
«Пароль збережено», «Імʼя для входу: anna», «Відкрий Легко з іконки й увійди з новим паролем.», «Продовжити в Safari».

### 9.4 Settings list (phone)

```
 Налаштування                                  (h1)
 ┌ Нагадування · Цілі · Типи тренувань · Прийоми їжі ┐   (unchanged)
 ┌ Вигляд · Дані і копія ┐                              (unchanged)
 ┌─────────────────────────────────────────┐   replaces today's «Вийти» card (D30)
 │ [user]  Акаунт                   anna › │  60, value soft = username («…» while unknown)
 │ [users] Користувачі         3 акаунти › │  60, admins only (count from the overview, none while loading)
 └─────────────────────────────────────────┘
          Легко · трекер схуднення             shown for users; hidden while the «Користувачі» row shows
```

Measured on `e2e/__screenshots__/iphone/light/40-settings.png` (CSS px): «Вийти» card 489–557, caption ends ≈ 590,
`AppShell .main` adds 120 bottom padding (document ≈ 710), the tab bar starts 84 px above the viewport bottom (679 at
763). A new one-row card would add ≈ 84 px and a two-row card ≈ 144 px (not +74 / +134 as first estimated): a user
would scroll at 763 and an admin at 844. With D30 a user's list is unchanged (≈ 710, fits 763 with ≈ 52 px to spare);
an admin's adds one 60 px row and drops the ≈ 32 px caption (≈ 738, card bottom ≈ 617 < 679). `settings.spec` keeps
asserting **both** 390×844 and 390×763, for a user **and** an admin (no scroll, every row above the tab bar). Icons
`user`, `users` (new, line style, `acc` / `acc2` tone). Desktop: the same list in the sticky left column; the pane
shows the section. `/settings/users` for a non-admin → redirect to `/settings` (no flash of the page).

### 9.5 «Акаунт» (`/settings/account`)

```
 ‹ Налаштування
 Акаунт                                        (h1)
 ┌─────────────────────────────────────────┐   Card section aria «Профіль»
 │ (А)  anna                               │   Avatar (first letter, upper case) · 17/700
 │      Користувач · з 9 жовтня 2026       │   14 --ink2 («Адміністратор» for admins)
 │      Адміністратор бачить твої записи   │   role user only (D32): 13/500 --muted, ACCOUNT_COPY.adminSees,
 │      та прогрес.                        │   no pop-up, no banner; absent for admins
 └─────────────────────────────────────────┘
 ┌ Пароль ─────────────────────────────────┐   CardHeader «Пароль»; a real <form onSubmit>
 │ Пароль задано 21 жовтня за посиланням   │   13 --ink2, from user.passwordChange (D28; see below)
 │ від admin.                              │
 │ Поточний пароль      [               ]  │   current-password; hidden readOnly username input = user.username
 │ Новий пароль         [               ]  │   new-password, hint «Щонайменше 8 символів»
 │ Повтори новий пароль [               ]  │
 │ [          Змінити пароль          ]    │   «Змінюю…» → toast «Пароль змінено», fields cleared
 │ Інші пристрої вийдуть з акаунта, цей —  │   13 --ink2
 │ ні.                                     │
 └─────────────────────────────────────────┘
 ┌ Імʼя для входу ─────────────────────────┐
 │ anna                          [Змінити] │   ghost toggle (aria-expanded)
 │  → Нове імʼя  [ anna.k ]  (rule hint)   │   edit mode (a <form>); autocomplete=username, autocapitalize=none,
 │    Пароль     [        ]                │   autocorrect=off, spellcheck=false · Пароль: current-password
 │    [ Зберегти імʼя ]   [ Скасувати ]    │   → toast «Імʼя змінено»; note «Після зміни входь з новим імʼям.»
 └─────────────────────────────────────────┘
 ┌ Підрахунки калорій ─────────────────────┐   only when AI is enabled
 │ Сьогодні ще 37 з 40                     │   remainingToday / limitToday («Сьогодні ще 37» when no limitToday)
 └─────────────────────────────────────────┘
 ┌─────────────────────────────────────────┐   the existing LogoutRow card, moved here (D30)
 │ [⇥]  Вийти                              │   same confirm as today
 └─────────────────────────────────────────┘
```

Transparency line (D32, `docs/coach-cabinet.md` §7.1): for role `user` only, a third line in «Профіль» under the
since-line, «Адміністратор бачить твої записи та прогрес.» (13/500 `--muted`). The invite page (§9.2) shows the same
sentence (`INVITE_ADMIN_NOTE`, `s.hint`) inside the form, directly above «Створити акаунт». Nothing else (no pop-up).

Password provenance line (D28), only when `user.passwordChange` is set: via `self` «Пароль змінено <date>.»; via
`reset` / `setup` with `by` = another username «Пароль задано <date> за посиланням від <by>.»; with `by` null «Пароль
задано <date> за посиланням з консолі.»; via `cli` «Пароль задано <date> на сервері.»

Errors (`role=alert` in the card): `wrong_password` «Поточний пароль неправильний» (rename: «Пароль неправильний») ·
mismatch «Паролі не збігаються» · `weak_password` «Новий пароль — щонайменше 8 символів» · `username_taken` «Це імʼя
вже зайняте» · `invalid_username` rule text · `rate_limited` «Забагато спроб — спробуй за кілька хвилин» · offline:
buttons disabled + «Потрібен інтернет». After a rename: `authActions.updateUser(user)` (pointer + list row).

### 9.6 «Користувачі» (`/settings/users`, admins only)

```
 ‹ Налаштування
 Користувачі                                     (h1)
 ┌ Запросити людину ─────────────────────────┐
 │ Підпис (для себе)  [ Напр., для Олі     ] │   ≤ 60, optional
 │ [         Створити запрошення          ]  │   «Створюю…»
 │ Посилання одноразове й діє 7 днів. Людина │   13 --ink2
 │ сама обере імʼя і пароль.                 │
 └───────────────────────────────────────────┘
 ┌ Запрошення готове ────────────────────────┐   LinkCard (after creating; aria-live polite)
 │ [ https://fit.triple-a.dev/invite#Qm9…  ] │   read-only input, aria «Посилання», selects all on focus
 │ [ Поділитися ]        [ Скопіювати ]      │   Поділитися only with navigator.share; see «LinkCard» below
 │ Одноразове, діє до 28 жовтня, 14:05.      │
 │ Посилання видно тільки зараз — надішли    │
 │ його або збережи.             [ Готово ]  │
 └───────────────────────────────────────────┘
 Запрошення · 2                                  SectionTitle (only when pending); phone 18/700, desktop pane:
                                                 the ListGroup caption style (14/600 --muted) under the h1
 ┌───────────────────────────────────────────┐
 │ для Олі                       [Скасувати] │   60; sub «до 28 жовтня · від admin» («· з консолі» when createdBy null)
 │ Без підпису  (Адмін)          [Скасувати] │   Pill «Адмін» on role-admin invites (CLI create-invite --admin)
 └───────────────────────────────────────────┘
 Акаунти · 3
 ┌───────────────────────────────────────────┐
 │ [user] admin   (Адмін)                  › │   sub «Це ти · активність сьогодні»
 │ [user] anna                             › │   sub «Активність сьогодні · 3 підрахунки сьогодні» (plural forms)
 │ [user] olya    (Вимкнено)               › │   Pill neutral; «(Пароль не задано)» for pending; «Ще не входили» when lastSeenAt null
 └───────────────────────────────────────────┘
 ┌ Підрахунки калорій ───────────────────────┐   CardHeader subtitle «Ліміти на день»
 │ На людину                [−]  40  [+]     │   Stepper step 5, 0–1000 (accessible name «На людину за день»)
 │ Усього                   [−] 150  [+]     │   step 10, 0–10 000 («Усього за день»)
 │ 0 — підрахунки вимкнено.                  │   13 --ink2
 │ Сьогодні використано 12 з 150.            │
 │ [          Зберегти ліміти          ]     │   enabled only when changed → toast «Збережено»
 └───────────────────────────────────────────┘
```

LinkCard (invites and reset links): «Скопіювати» → `navigator.clipboard.writeText(url)`; toast «Скопійовано» **only
after it resolves**; on failure or without the API → `input.focus(); input.setSelectionRange(0, input.value.length)`
(iOS ignores `select()` on read-only inputs) + toast «Посилання виділено — скопіюй його вручну». «Поділитися» →
`navigator.share({ title: 'Запрошення в Легко', text, url })` with `text` = «Запрошую в Легко — трекер схуднення.
Посилання одноразове, діє до 28 жовтня.» (reset: title «Новий пароль у Легко», text «Посилання для нового пароля в
Легко, діє 24 години.»); messengers drop the title, so the text carries the explanation. Expiry line under the link:
invite «Одноразове, діє до 28 жовтня, 14:05.», setup «Одноразове, діє 24 години.», reset «Одноразове, діє 24 години.
Старий пароль працює, доки посиланням не скористаються.» The fresh link lives only in the card's state: it is shown
once, and a remount (e.g. a desktop window crossing the 900px layout width) loses it — make a new one.

Revoke: `ui.confirm({ title: 'Скасувати запрошення?', body: 'Посилання перестане працювати.', confirmLabel:
'Скасувати запрошення', cancelLabel: 'Залишити', destructive: true })` → toast «Запрошення скасовано».
Loading «Завантажую…»; failure «Не вдалося завантажити» + «Спробувати ще раз»; offline «Потрібен інтернет».
`limit_reached` → «Забагато активних запрошень — скасуй старі».

User sheet (`Sheet heading={username}`; desktop = centred modal):

```
 ┌ anna ──────────────────────────────────── ✕ ┐
 │ Користувач · з 9 жовтня 2026                 │
 │ Активність: сьогодні, 09:12                  │  «Ще не входили» when lastSeenAt is null
 │ Підрахунки: сьогодні 3 · за 30 днів 41       │
 │ Роль                                         │  label above (13/600)
 │ [   Користувач   |   Адміністратор   ]       │  full-width Segmented (≈ 136 px per segment at 320); disabled +
 │                                              │  hint «Єдиний адміністратор — спершу признач іншого» for the last usable admin
 │ Окремий ліміт підрахунків          ( switch )│  sub «Як у всіх: 40 на день» while off
 │ Ліміт на день              [−]  40  [+]      │  when on; saved on «Зберегти ліміт»; 0 → «Для цього акаунта підрахунки вимкнено»
 │ [     Посилання для нового пароля      ]     │  outline → LinkCard in the sheet («Одноразове, діє 24 години.
 │                                              │  Старий пароль працює, доки посиланням не скористаються.»)
 │                                              │  disabled user: button hidden, text «Щоб надіслати посилання, спершу ввімкни акаунт.»
 │ [          Вимкнути акаунт             ]     │  outline («Увімкнути акаунт» when disabled); hidden for yourself
 │ [          Видалити акаунт…            ]     │  ghost, --accD, rounded (r12) focus ring; hidden for yourself
 └──────────────────────────────────────────────┘
```

Confirms (copy since the coach release, D32 — the earlier «Чужих записів адміністратор не бачить» is
**superseded**: it is no longer true): to admin — «Зробити anna адміністратором?» / «Адміністратор бачить усі
акаунти, а також записи й прогрес кожного користувача — лише для перегляду, змінити їх він не може. Він запрошує,
вимикає й видаляє акаунти та може видати посилання для нового пароля — людина про це дізнається.» / «Зробити
адміністратором». To user — «Забрати права адміністратора в anna?» / «Розділи «Користувачі» й «Клієнти» зникнуть для
цього акаунта, а його записи й прогрес бачитимуть адміністратори.» / «Забрати права» (self: «…в себе?»).

User sheet, for a role-`user` account other than yourself (D32): a static link row «Записи й прогрес» (icon `chart`,
`acc2`) before the account actions → `/coach/<id>` (the client's page in «Клієнти»; navigation only). Hidden for
admins and for yourself.
Disable — «Вимкнути акаунт anna?» / «Увійти в нього буде неможливо, усі його пристрої вийдуть з акаунта, нагадування
зупиняться. Записи збережуться — акаунт можна знову ввімкнути.» / «Вимкнути» → toast «Акаунт вимкнено»; enable →
toast «Акаунт увімкнено». Pending user: «Посилання для пароля» instead of «…нового пароля».

Delete (the sheet body swaps to a confirm panel; Escape/✕ goes back to the details first):

```
 ┌ anna ──────────────────────────────────── ✕ ┐
 │ Видалити акаунт anna?                        │  17/700
 │ Буде видалено всі записи цього акаунта —     │
 │ дні, прийоми їжі, фото, вагу, заміри,        │
 │ налаштування. Відновити їх буде неможливо.   │
 │ Щоб підтвердити, введи імʼя: anna            │
 │ [                                      ]     │  autocapitalize=none, autocomplete=off, autocorrect=off, spellcheck=false; aria «Імʼя для підтвердження»
 │ [          Видалити назавжди           ]     │  destructive solid, disabled (the kit's grey disabled solid) until it matches (case-insensitive)
 │ [              Скасувати               ]     │
 └──────────────────────────────────────────────┘
```

→ toast «Акаунт anna видалено», sheet closes, list refreshes. `last_admin` «Це єдиний адміністратор» · `self_action`
«Із власним акаунтом так не можна» · `account_disabled` (reset link) «Акаунт вимкнено — спершу ввімкни його».

Dates and relative wording («сьогодні», «з 9 жовтня 2026», «Діє до …») are formatted with `@legko/shared` format
helpers against the device clock; timestamps later than «now» (server clock ahead of the device) still render
sensibly (unit-tested).

Desktop: the pane (≤ 640px) holds the same cards; the user sheet is the standard 560px centred modal.

Focus (WCAG 2.4.3, `screens/settings/focus.ts`): when an action removes or disables the control that had the focus,
the focus is put back after the next render — only when it was lost (on `<body>`, a removed or a disabled element),
so it never pulls the focus away from where the person moved meanwhile (delete is the one exception). Revoking an
invite → the next invite's «Скасувати» (the previous one after the last; «Акаунти · N» when none is left); «Зберегти
ліміти» → the card title (the button stays disabled), after a refusal back to the button; delete → «Акаунти · N»;
«Змінити пароль» → back to the button (the card title while it is disabled offline); the sheet's role, enable /
disable and own-limit save → the matching control. Headings that take the focus get `tabindex="-1"` and no ring.

---

## 10. Compatibility

| Situation | What happens |
| --- | --- |
| Her installed PWA before it reloads | `GET /api/auth/me` 200 (extra `user` ignored); ops/data/export/import without `X-Legko-User` work through her **migrated** (legacy) session (= anna). If that session is gone (reset, `set-password anna`, expiry), its password-only login signs in as anna on a new legacy session (D24) and keeps syncing. `pwa/update.ts` reloads it on the next idle foreground. |
| An old-bundle tab while someone else signs in (same browser profile) | The cookie now belongs to a v4 session (`legacy = 0`); the old tab sends no header → 409 on data / ops / import, nothing applied, its outbox kept (D11). |
| Restoring a pre-v4 backup (daily `legko-YYYY-MM-DD.db` or `legko-pre-v4`) | Re-runs the v4 migration; anna gets the same id (`LEGACY_OWNER_ID`, D1), so devices keep their copy and outbox. Other accounts are not in such a file. |
| Her device cache (legacy keys) | Rendered provisionally, adopted on the first `me` (`legacyOwner`), pending ops then sent (§8.2). |
| Old outbox ops | Same op schema; replayed after adoption under her id. |
| Old JSON backups | `appDataSchema` unchanged; import replaces only the importing user's data. |
| Her sessions | Copied to anna (D7). |
| Her Keychain entry «legko» | Login alias (D3). |
| Push subscriptions | Copied to anna; her reminders keep firing from her settings. |
| Old server + new client | Only during a rollback (`downgrade-schema` first, §2.4). The v3 server answers `{ ok: true }` to `me` **and** to a `{ username, password }` login (zod strips the unknown key) — there is no 400. The new client validates every `MeResponse` and maps a 2xx without `user` to `outdated_server`: background checks keep the pointer, cache and sync (its ops are all v3-compatible and still sent); screens show «Щось пішло не так». It stays loaded while it has pending ops; `pwa/update.ts` then reloads it into the old bundle. |
| Rollback round trip (v4 → v3 → v4) | The old bundle sees only `legko.data` / `legko.outbox`; ops queued in `legko.outbox.<id>` wait (ask anna to open the app online before the rollback). What the old app writes to the legacy keys is merged into `legko.*.<id>` by the next v4 start (§8.2 step 1) and sent once. |

---

## 11. Tests

### 11.1 Unit / integration (Vitest)

| Behaviour | Where (package) |
| --- | --- |
| username rules, `usernameKey`, `tokenFromHash`, `linkPath`, new schemas | `packages/shared/src/users.test.ts` (contracts) |
| migration v4 row preservation, snapshot, FK check, fresh DB, malformed legacy id, fixed legacy id + determinism, earliest `created_at`, `sessions.legacy` | `db/migrate-v4.test.ts` (core) |
| downgrade v4 → v3 + re-upgrade keeps the id; refusals with counts; `--drop-others` | `db/downgrade.test.ts` (core) |
| scope lint (per statement, bound predicate, self-tests with bad samples, stale allowlist entries fail) | `db/scope.test.ts` (core) |
| scrypt gate (≤ 2 in flight, queue, `ScryptBusy`), session rotation on password change (old cookie 401, new works), login over another user's cookie revokes it, link revocation by creator on demote / disable / delete / admin reset (all three → 410 `revoked`), own password change revokes pending resets for self, legacy-session header rule (v4 session without header → 409 nothing applied; migrated or username-less session → 200; header clears the flag), username-less login = alias (right → anna, wrong → standard 401), reserved `admin` (invite / rename refused, CLI allowed), push `auth` ownership (move / delete only with the same `auth`) | `auth/*.test.ts`, `test/auth.test.ts`, `test/links.test.ts`, `test/account.test.ts`, `test/admin.test.ts`, `test/guard.test.ts`, `push/subscriptions.test.ts` (core) |
| account limiters: 10 parallel wrong current passwords → exactly 5 verifies, the rest 429; the account change limiter counts successes; 20 parallel accepts with a taken name → no hash call, concurrent ones 429 (in-flight guard) | `test/account.test.ts`, `test/links.test.ts` (core) |
| users repo (create/unique key/rename/role/disable/delete cascade/last-admin count), tokens repo (hashing at rest, single use under a race, reasons, revoke-older, purge), scoped data repo (two users, same dates), photo store per user + GC per owner + corrupt row pauses only that owner, subscriptions ownership move / scoped remove, reminder log per user, budget per user + global + override + prune | `db/*.test.ts`, `photos/store.test.ts`, `food/budget.test.ts`, `push/subscriptions.test.ts`, `reminders/log.test.ts` (core) |
| login (username, alias `legko`, unknown user = same 401 body + dummy verify called, disabled, per-IP / per-username / global limits, session bound to user, `me` shape, renew), invite / reset endpoints (all reasons, taken name keeps token, race, sessions revoked, new session), account endpoints (password limiter, keep current session, rename), admin endpoints (403 for users on **every** admin route, overview has no data fields, last admin, self action, delete removes rows + photo files and leaves others intact, AI limits bounds), `X-Legko-User` 409 with nothing applied | `test/auth.test.ts`, `test/links.test.ts`, `test/account.test.ts`, `test/admin.test.ts`, `test/guard.test.ts` (core) |
| **isolation**: user B cannot read / modify / delete A's days, meals, weights, measures, foods, settings (incl. timezone via push subscribe), photos (full, thumb, recalc `photoId`), subscriptions (unsubscribe, test push), export, import; per-user AI budget; reminders per user (zones, `isDone`, log) | `test/isolation.test.ts`, adapted `ops / export-import / food / push` tests, `reminders/runner.test.ts` (features) |
| CLI: every command incl. refusals (create-admin on an existing regular user names its role and suggests no reset link), link printed with `PUBLIC_ORIGIN` and usable through the app, no secrets in `list-users` / `list-links`, `revoke-links --by / --all`, downgrade wiring incl. `--drop-others` counts | `cli/cli.test.ts` (features) |
| the moved `guard.test.ts` case «small routes still take realistic bodies» (`/api/push/subscribe` with a 1900-char endpoint) | `test/push.test.ts` (features) |
| cache per owner, legacy adoption + merge (pointer + per-user cache + legacy keys with one pending op → sent exactly once, legacy keys gone), `wipeDevice` with `idbUsable = false` still deletes the keys, a failing wipe leaves the tombstone and `check()` renders no copy, sync sends the header and never another owner's outbox, 409 → check (no silent wipe with pending ops), `outdated_server` (`{ ok: true }` bodies for `me` and login), switch confirm / cancel / reload, `keepLegacy` on a switch to the legacy owner, admin landing `/settings/users` after a link flow, logout reload, BroadcastChannel, `disablePush` sends `auth`, API client headers + new calls, Login (paste link, forgot-password hint, autofocus) / Invite / Reset screens (per-reason copy, button label, iOS «Готово» state, copy-link note, the fragment is stripped), setup gate for admins; the whole `@legko/web` suite stays green (no owner bound = today's behaviour) | `store/*.test.ts`, `auth/*.test.ts(x)`, `lib/api.test.ts`, `lib/push.test.ts`, `screens/login/*.test.tsx`, `sheets/setupGate.test.ts` (web-auth) |
| settings list (account / users rows, admin only, caption hidden for admins, no «Вийти» row on the list), routes (users redirect), account forms (autofill attributes, hidden username, provenance line, «Вийти» on the page), users page (invite → LinkCard, copy success / failure toasts, share text, revoke, «від admin» / «з консолі», admin-invite pill, activity wording, user sheet actions, last-admin disabled role, reset link hidden for disabled users, `account_disabled` mapping, typed delete attributes), date/expiry formatting incl. future timestamps, «з L» omitted without `limitToday` | `screens/settings/**/*.test.ts(x)` (web-admin) |
| **coach (D32, `docs/coach-cabinet.md` §8.1)**: reader key lists + frozen, `daysBetween` bounds, `recordSpan` ignores later rows, two users never mix, `reader.read()` has no `foods` key and never runs the foods statement, `createDataRepos` unchanged; photo reader reads only its owner's photos | `db/data-reader.test.ts`, `photos/store.test.ts` (server-coach) |
| coach access: a user actor throws `NotCoach` before any `users` / reader call (spies); admin / self / unknown / malformed → null; only role `user` listed (disabled / pending with their status); profile keys exactly `id, username, status, createdAt, lastSeenAt`; log lines without content | `coach/access.test.ts` (server-coach) |
| coach lint (rules 1–5: GET only in `routes/coach.ts`, `readerFor` / `.readers` / `as ClientId` placement, wiring only in `app.ts`, no writes or SQL in `access.ts`, reader shapes) with self-tests | `coach/coach-lint.test.ts` (server-coach) |
| **coach routes, negative authz**: runtime route-table test (every `/api/coach*` route is GET, paths = `COACH_ROUTES`); 401 / 403 (a user, about herself and another user) / 404 (the admin's own id, another admin, unknown, malformed) on every route; POST / PUT / PATCH / DELETE → 403 without Origin, 404 with it, every owned row byte-identical afterwards; HEAD → 403 for a user, 405 `Allow: GET` for the admin, no log line; OPTIONS 404; window 400s; `private, no-store`, photo `Vary: Cookie` + `image/jpeg` + nosniff; photos only through the owning client's path, user B's `GET /api/photos/<A's id>` 404; no secret-like keys; role changes act at once; `last_seen_at` of the client untouched | `test/coach.test.ts` (server-coach) |
| shared coach maths: `digestDay`, `clientToday`, `coachWindow(Schema)`, paths, every §4.1 value and §4.4 flag boundary, suppression by `inactive`, status gate, `compareAttention`, `coachItemFromData` ≡ a server item | `packages/shared/src/coach.test.ts` (contracts) |
| web: nav for user / admin, `CoachGate`, `api.coach.*`, clients model / table / list, client page and panels (no button that writes), `useReplaceParams`, parity with `lib/stats`, no `@/store/` import under `screens/coach`; `PhotoUrlsProvider`, `ProgressBody`, `useShownMonth`; the «Акаунт» and invite lines, the role confirms, the user-sheet «Записи й прогрес» row | `screens/coach/**`, `shell/*.test.tsx`, `lib/*.test.ts(x)`, `screens/progress/*`, `screens/settings/**`, `screens/login/InviteScreen.test.tsx` (web-coach, web-data, web-copy) |

### 11.2 e2e (Playwright, port 3399, one run at a time — **only the e2e-gate runs it**)

| Spec | Owner | Scenarios |
| --- | --- | --- |
| `e2e/auth.spec.ts` | web-auth | username + password login; wrong password and unknown name show the same «Неправильне імʼя або пароль» and the forgot-password hint; expired session keeps unsynced changes and the name is pre-filled; device with data opens offline; logout (from «Акаунт», `logoutUi`) asks, reloads to the login screen, wipes IndexedDB (`deviceKeys()` empty); «Маю посилання» with a foreign URL → «Це не схоже на посилання з Легко» |
| `e2e/invite.spec.ts` (new) | web-auth | admin API creates an invite → `/invite#…` in a fresh context → register → app with «Перші кроки»; the fragment is gone from the URL; reuse → «Це запрошення вже використали. Якщо акаунт за ним уже створено — просто ввійди.»; garbage token → «Посилання неправильне або неповне»; opening an invite while signed in → interstitial → «Вийти й продовжити»; reset link → new password → logged in, old password refused, a second context of that user lands on the login screen; **iphone project only** (iPhone UA, not standalone): the «Готово» state shows «Імʼя для входу: <name>» and «Продовжити в Safari» opens the app; the paste path (login → «Маю посилання» → paste the invite URL) registers the user and lands in the app |
| `e2e/account.spec.ts` (new) | web-admin | throwaway user: wrong current password error; change password (other context logged out, this one stays signed in with the rotated cookie); rename (taken name refused, new name works at login); «Вийти» sits at the bottom of «Акаунт» |
| `e2e/users-admin.spec.ts` (new) | web-admin | admin sees «Користувачі», anna does not and `/settings/users` redirects; create invite with note → LinkCard → «Скопіювати» (clipboard permission) → pending row («від admin») → revoke → the link says «Запрошення скасовано»; user sheet: role change, sole-admin role control disabled (precondition: `admin.overview()` shows exactly one usable admin), reset link, disable → login «Акаунт вимкнено…» → enable, delete with typed name; AI limits save and restore; desktop pane + modal |
| `e2e/settings.spec.ts` | web-admin | existing + the list fits one screen at **390×844 and 390×763** for a user **and** for an admin; «Акаунт» row shows the name; the caption shows for a user and is hidden for an admin |
| `e2e/multi-user.spec.ts` (new) | e2e-gate | API isolation (B's data empty, B's ops never touch A, B's export, B's import, A's photo URL 404 for B, admin endpoints 403 for users, `X-Legko-User` mismatch 409, a header-less ops POST on B's v4 session → 409); UI same device: A logs out → B logs in → empty app, IndexedDB only B's keys → B logs out → A sees her data; expired session with pending changes → log in as B → switch confirm (cancel keeps the login screen; confirm → B's app, A's change never reached B and is gone from the device); legacy device cache (`legko.data` / `legko.outbox` with a pending op) is adopted by anna and the op reaches the server; **admin bootstrap**: `node apps/server/dist/cli.js create-admin <unique>` against the e2e `DATA_DIR` with `PUBLIC_ORIGIN = BASE_URL` → open the printed link → set the password → lands on «Користувачі» → **finally** delete that admin through `admin.deleteUser` |
| `e2e/coach-api.spec.ts` (coach, D32) | server-coach | API only: 401 / 403 (anna) on all four coach routes; the list has anna and a seeded throwaway client, never an admin; anna's detail = her data with `foods: []`; admin id / malformed / unknown → 404; window 400s; `no-store`; no secret-like keys; writes with Origin → 404 and anna's data unchanged; HEAD → 405; photo 404 / 400 |
| `e2e/coach.spec.ts` (coach, D32) | web-coach | «Клієнти» in the admin's navigation only (anna: none, `/coach` sends her home); seeded throwaway clients: cells, pills, filter, 7 / 30, sort; client page tabs; the back stamp keeps the list's query; photos only from the coach route; no non-GET to `/api/coach/**`, no `/api/ops`; phone without side scroll |
| `e2e/account.spec.ts`, `e2e/invite.spec.ts`, `e2e/users-admin.spec.ts` (coach copy, D32) | web-copy | the «Акаунт» line for anna (not for the admin), the invite line above «Створити акаунт», the new promote body (cancelled), the user sheet's «Записи й прогрес» → `/coach/<id>` |
| `e2e/visual.spec.ts`, `e2e/a11y.spec.ts` (coach, D32) | e2e-gate | stubbed coach API: shots 70–78 (list, attention filter, overview, progress, calendar with photos, nutrition, empty client, 320, a 1000px table scrolled right); a11y: table `th` scopes, `aria-sort`, keyboard sort cycle, focus rings, tab links `aria-current`, focusable region that fits 1280×800, sticky header row, no side scroll / 44px / 16px at 390 and 320, the «Акаунт» and invite lines ≥ 13px in `--muted` |
| all other specs | e2e-gate | adapted to the username login, «Вийти» inside «Акаунт» and the new settings layout; screenshots re-recorded for login, settings list (user + admin), the new screens (light + dark, iPhone + desktop), plus 320 shots of the user sheet and the invite screen (light + dark); a11y at 320×568 for login (pending hint + error), invite, reset, «Акаунт», «Користувачі», the user sheet and the delete panel: no horizontal scroll, targets ≥ 44 px, inputs ≥ 16 px |

Rules for every e2e spec:
- **never** change the password, name, role or state of `anna` or `admin` (the worker fixtures stay logged in as
  them); create throwaway users with `createUser()` and unique names;
- a spec that creates or promotes an admin demotes or deletes it in a `finally` (so «exactly one usable admin» holds
  for every later spec);
- pending invites never survive a test: an auto fixture revokes every pending invite after each test (workers = 1,
  so nothing else is running);
- restore admin-changed AI limits in `afterEach`;
- at most 3 failed logins **and** at most 3 failed link attempts (410 / taken name) in a row before a successful one
  (per-IP limits 5 and 10 / 15 min, global login cap 20; a successful login / accept resets its counter);
- the server clock is real while the browser clock is fixed (`FIXED_NOW`): never assert server-derived dates or
  relative wording (`createdAt`, `lastSeenAt`, `expiresAt`, «сьогодні»); visual and a11y specs stub `GET
  /api/admin/users` and `GET /api/auth/me` with `page.route` and a fixed overview / user relative to `FIXED_NOW`.

### 11.3 e2e support contract (owned by `contracts`)

```ts
// e2e/support/env.ts
export const USERNAME = 'anna';            export const PASSWORD = 'e2e-pass';
export const ADMIN_USERNAME = 'admin';     export const ADMIN_PASSWORD = 'e2e-admin-pass';
// playwright.config.ts webServer.env: DEV_USERNAME, DEV_PASSWORD, DEV_ADMIN_USERNAME, DEV_ADMIN_PASSWORD
// e2e/support/server.ts
export interface Credentials { username: string; password: string }
export const USER: Credentials; export const ADMIN: Credentials;
export function apiLogin(request: APIRequestContext, creds?: Credentials): Promise<SessionUser>;
export function loginContext(context: BrowserContext, creds?: Credentials): Promise<SessionUser>;
export class ServerApi {                    // constructor(request, creds = USER)
  login(); me(); exportData();
  // getData / sendOps / importData send X-Legko-User = this account's id (from login) by default (D11);
  // `headers` overrides it; a request WITHOUT the header is sent with rawPost(path, body, headers).
  importData(data, headers?); getData(headers?); sendOps(ops, headers?); rawPost(path, body, headers?): Promise<APIResponse>;
  overview(); createInvite(note?): Promise<{ path: string; token: string; inviteId: string }>;  // records the id
  revokeInvite(id); revokePendingInvites(): Promise<number>;      // used by the auto fixture after each test
  resetLink(userId): Promise<{ path: string; token: string }>; setRole(userId, role); setDisabled(userId, disabled);
  deleteUser(userId, confirmUsername); setAiLimits(limits); userId(username): Promise<string>;
}
export function uniqueUsername(prefix?: string): string;          // ≤ 32 chars, [a-z0-9]
export function createUser(playwright: Playwright, admin: ServerApi, opts?: { username?: string; password?: string })
  : Promise<{ api: ServerApi; creds: Credentials; id: string; dispose(): Promise<void> }>;   // invite → accept
// e2e/support/test.ts: options { seed, authed, account: 'user' | 'admin' }; worker fixtures { server (anna), admin };
//   auto test fixture: after each test admin.revokePendingInvites().
// e2e/support/app.ts: SettingsSection += 'Акаунт' | 'Користувачі' (slugs account / users); loginUi(creds);
//   logoutUi() (Settings → «Акаунт» → «Вийти» → confirm; «Вийти» is no longer on the list, D30);
//   userSheet(username); deviceCache() reads legko.user (`.id`) → legko.data.<id> / legko.outbox.<id>; deviceKeys().
// e2e/support/food.ts: mockFood default status DEFAULT_FOOD_STATUS = { enabled: true, remainingToday: 37, limitToday: 40 }
//   (frozen, served as a copy); foodStatusProblem(status) refuses an impossible one (remainingToday > limitToday,
//   negative or fractional counts) before any route is set up.
```

The dev bootstrap (`auth/devUsers.ts`, `applyDevUsers(db, config, logger, scrypt: ScryptParams = DEFAULT_SCRYPT)`,
development only, never in production): for `DEV_USERNAME` (default `anna`, role user, legacy owner when none exists
yet) with `DEV_PASSWORD`, and `DEV_ADMIN_USERNAME` (default `admin`, role admin, `allowAdmin`) with
`DEV_ADMIN_PASSWORD`: create the user when missing, set the password only when it has none.

---

## 12. Work packages

```
                    ┌───────────┐
                    │ contracts │  packages/shared · e2e/support · e2e/fixtures · playwright.config.ts
                    └─────┬─────┘
             ┌────────────┴────────────┐
       ┌─────▼──────┐             ┌────▼─────┐
       │server-core │             │ web-auth │      (parallel)
       └─────┬──────┘             └────┬─────┘
    ┌────────▼────────┐          ┌─────▼─────┐
    │ server-features │          │ web-admin │      (parallel)
    └────────┬────────┘          └─────┬─────┘
             └────────────┬────────────┘
                    ┌─────▼────┐
                    │ e2e-gate │  multi-user.spec · other specs · screenshots · SPEC / DEPLOY / README · deploy.sh · full gate
                    └──────────┘
```

| Package | Owned paths |
| --- | --- |
| contracts | `packages/shared/**`, `e2e/support/**`, `e2e/fixtures/**`, `e2e/tsconfig.json`, `playwright.config.ts` |
| server-core | `apps/server/src/db/**`, `apps/server/src/auth/**`, `apps/server/src/config.ts`, `apps/server/src/misc.test.ts`, `apps/server/src/backup.ts`, `apps/server/src/backup.test.ts`, `apps/server/src/http/app.ts`, `apps/server/src/http/types.ts`, `apps/server/src/http/errors.ts`, `apps/server/src/http/cookies.ts`, `apps/server/src/http/request.ts`, `apps/server/src/http/bodyLimit.ts`, `apps/server/src/http/middleware/**`, `apps/server/src/http/routes/deps.ts`, `apps/server/src/http/routes/auth.ts`, `apps/server/src/http/routes/links.ts`, `apps/server/src/http/routes/account.ts`, `apps/server/src/http/routes/admin.ts`, `apps/server/src/http/routes/health.ts`, `apps/server/src/photos/store.ts`, `apps/server/src/photos/store.test.ts`, `apps/server/src/push/subscriptions.ts`, `apps/server/src/push/subscriptions.test.ts`, `apps/server/src/reminders/log.ts`, `apps/server/src/reminders/log.test.ts`, `apps/server/src/food/budget.ts`, `apps/server/src/food/budget.test.ts`, `apps/server/test/helpers.ts`, `apps/server/test/auth.test.ts`, `apps/server/test/guard.test.ts`, `apps/server/test/links.test.ts`, `apps/server/test/account.test.ts`, `apps/server/test/admin.test.ts`, `apps/server/.env.example` |
| server-features | `apps/server/src/cli.ts`, `apps/server/src/cli/**`, `apps/server/src/index.ts`, `apps/server/src/loop.ts`, `apps/server/src/static.ts`, `apps/server/src/http/routes/data.ts`, `apps/server/src/http/routes/photos.ts`, `apps/server/src/http/routes/push.ts`, `apps/server/src/http/routes/food.ts`, `apps/server/src/push/service.ts`, `apps/server/src/push/messages.ts`, `apps/server/src/push/transport.ts`, `apps/server/src/push/transport.test.ts`, `apps/server/src/push/vapid.ts`, `apps/server/src/reminders/runner.ts`, `apps/server/src/reminders/runner.test.ts`, `apps/server/src/reminders/schedule.ts`, `apps/server/src/reminders/schedule.test.ts`, `apps/server/src/photos/gc.ts`, `apps/server/src/food/claude.ts`, `apps/server/src/food/claude.test.ts`, `apps/server/src/food/estimator.ts`, `apps/server/src/food/estimator.test.ts`, `apps/server/scripts/**`, `apps/server/package.json`, `apps/server/test/ops.test.ts`, `apps/server/test/export-import.test.ts`, `apps/server/test/food.test.ts`, `apps/server/test/push.test.ts`, `apps/server/test/static.test.ts`, `apps/server/test/seed-demo.test.ts`, `apps/server/test/isolation.test.ts` |
| web-auth | `apps/web/src/auth/**`, `apps/web/src/screens/login/**`, `apps/web/src/store/**`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `apps/web/src/lib/push.ts`, `apps/web/src/lib/push.test.ts`, `apps/web/src/sheets/setupGate.ts`, `apps/web/src/sheets/setupGate.test.ts`, `apps/web/src/sheets/useSetupAutoOpen.ts`, `apps/web/src/sheets/install/**`, `e2e/auth.spec.ts`, `e2e/invite.spec.ts`; **test-only** edits (idb-keyval mocks: switch to `fakeIdb()` from `store/test-utils` or add the missing members) in `apps/web/src/screens/home/HomeScreen.test.tsx`, `apps/web/src/screens/calendar/CalendarScreen.test.tsx`, `apps/web/src/sheets/SheetHost.test.tsx`, `apps/web/src/sheets/record/RecordSheet.test.tsx` |
| web-admin | `apps/web/src/screens/settings/**`, `apps/web/src/ui/icons/**`, `e2e/settings.spec.ts`, `e2e/account.spec.ts`, `e2e/users-admin.spec.ts` |
| e2e-gate | `e2e/multi-user.spec.ts`, `e2e/a11y.spec.ts`, `e2e/visual.spec.ts`, `e2e/gestures.spec.ts`, `e2e/sync.spec.ts`, `e2e/offline.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/shell.spec.ts`, `e2e/backup.spec.ts`, `e2e/compat.spec.ts`, `e2e/deep-links.spec.ts`, `e2e/home.spec.ts`, `e2e/calendar.spec.ts`, `e2e/progress.spec.ts`, `e2e/meals.spec.ts`, `e2e/food.spec.ts`, `e2e/capture.spec.ts`, `e2e/day-record.spec.ts`, `e2e/weight-measure.spec.ts`, `e2e/README.md`, `e2e/__screenshots__/**`, `docs/SPEC.md`, `docs/DEPLOY.md`, `README.md`, `deploy/deploy.sh`; plus test-only fixes during the final gate in any `e2e/*.spec.ts`, `e2e/support/**`, `e2e/fixtures/**` (each logged as file:line + owning package + reason; never app code, never weakening a test) |

Nobody edits `apps/web/src/App.tsx`, `apps/web/src/shell/**`, `apps/web/src/sw.ts`, `apps/web/src/features/**`,
`apps/web/src/ui/**` except `ui/icons/**` (web-admin), `deploy/remote.sh`, `docs/redesign-a.md`,
`docs/meals-macros.md`, this file. (`lib/push.ts` and `sheets/install/**` now belong to web-auth: `disablePush` sends
`auth` (D15) and the install steps are reused by the link «Готово» state (D29); `InstallSheet`'s own API stays.)

**Transient breaks (expected):** after contracts — server `routes/auth.ts` and web `lib/api.ts` / `auth.ts` fail
typecheck on the changed `loginRequestSchema` / `MeResponse`; e2e specs using `PASSWORD`-only login fail until their
owners land. After server-core — `index.ts`, `cli/run.ts`, `routes/data.ts|photos.ts|push.ts|food.ts`,
`push/service.ts`, `reminders/runner.ts`, `scripts/seed-demo.ts` and features' tests break (typecheck and runtime)
until server-features lands; server-core's `test/guard.test.ts` case «small routes still take realistic bodies»
(`/api/push/subscribe`) moves to features' `test/push.test.ts`, and core tests seed and verify only through repos,
helpers and the auth / links / account / admin routes — never through the success paths of `/api/data|ops|import|
export|push|food|photos`. After web-auth — `screens/settings/LogoutRow.tsx` keeps compiling (`authActions.logout()`
stays), but settings tests that build `useAuth` mocks may need updates by web-admin; web-auth itself keeps the
**whole** `@legko/web` vitest suite green (no owner bound = today's behaviour; the four unowned tests above get
test-only mock fixes). Parallel packages filter `tsc` / vitest / lint output to their own paths and report the rest;
only e2e-gate requires fully clean runs.

---

## 13. Deploy runbook (for DEPLOY.md; executed after the merge)

0. Before deploying: check `/opt/training-app/.env` for `FOOD_DAILY_LIMIT`. It now means the **global** daily
   ceiling (default 150), not «estimates per day»; per-user is `FOOD_USER_DAILY_LIMIT` (default 40). Remove or adjust
   an old override (e.g. `60`) to the new meaning. After the deploy the start-up log line shows the effective limits
   and their source (§5.5).
1. `deploy/deploy.sh` → the app migrates to v4 on start (log `database schema v3 → v4: saved legko-pre-v4-<date>.db
   first`). Anna keeps working: same sessions, same password, same data, same reminders.
2. Bootstrap the admin (owner over SSH; nothing secret typed or stored in history) **after** step 1 finished — the
   CLI's account commands refuse a v3 database (§7): `deploy/deploy.sh cli create-admin admin` → prints
   `https://fit.triple-a.dev/reset#<token>` (24 h, single use). Until anna's devices make their first request after
   the deploy, «Користувачі» shows her as «Ще не входили» (the v3 data has no last-activity time).
3. The owner opens the link, chooses the password («Створення пароля»), is signed in as «admin» and lands on
   «Користувачі» (D23). (If the link expires: `deploy/deploy.sh cli reset-password-link admin`.)
4. **If the link says «Це посилання вже використали»** and the owner did not use it: someone else did.
   `deploy/deploy.sh cli revoke-links --all` → `deploy/deploy.sh cli reset-password-link admin` (completing it
   signs every «admin» device out and revokes what that admin created, D27) → `deploy/deploy.sh cli list-users` and
   `list-links`: demote / delete any unexpected admin or user (`set-role`, the «Користувачі» sheet).
5. Invites: «Користувачі» → «Створити запрошення» → «Поділитися».
6. Rollback after this release: §2.4 — step 0 `deploy/deploy.sh status` (downgrade only when `previous` is a
   pre-users build), ask anna to open the app online, then `downgrade-schema --keep anna` (`--drop-others` only after
   reading the refusal's counts), then `deploy.sh rollback`.
7. Restoring a backup file (DEPLOY «Restore from a backup file»): a pre-v4 file (any daily backup from before the
   release, or `legko-pre-v4-<date>.db`) is migrated to v4 again on start; anna keeps her id (D1); other accounts,
   invites and the admin are not in it (bootstrap the admin again).

---

## 14. SPEC.md / DEPLOY.md / README updates (applied by e2e-gate)

- SPEC §1: a few people, each with their own account (admin + users; invites only); additions list: accounts,
  invites, reset links, «Акаунт», «Користувачі». §3.1: per-user AppData. §3.2: auth (username + password, sessions per
  user, invite / reset / account / admin endpoints, error codes, `X-Legko-User`, rate limits). §3.3: reminders and push
  per user. §3.4: schema v4, `kv` contents, snapshot `legko-pre-v4`, downgrade v4 → v3, CLI table, env
  `FOOD_DAILY_LIMIT` (global, default 150) / `FOOD_USER_DAILY_LIMIT` (40) / `DEV_*`. §3.5: per-user device storage,
  switch / logout reload, `/invite` / `/reset`, `/settings/account|users`. §3.7: AI budget per user + global.
- DEPLOY: first deploy + admin bootstrap (§13 incl. step 0 and the «already used» recovery with `revoke-links`),
  «Setting a password» → `cli set-password <user>` / `reset-password-link`, «Rollback after the users release (schema
  v4)» (§2.4 with step 0 `deploy.sh status`, ask anna to open the app online, `--drop-others`, what is lost, the
  logout-under-old-app note), «Restore from a backup file» → a pre-v4 file re-runs the v4 migration (§13 step 7), the
  env table and `.env.example` with `FOOD_DAILY_LIMIT` (global ceiling, default 150) and `FOOD_USER_DAILY_LIMIT`
  (per user, default 40), limits (per-IP / per-username / link / password / account-change / scrypt gate), logs.
- README: dev login (`anna` / `DEV_PASSWORD`, `admin` / `DEV_ADMIN_PASSWORD`), CLI commands (incl. `list-links`,
  `revoke-links`).

---

## 15. Risks

1. **Migration on real data** (table rebuilds): one transaction, FK check, pre-migration snapshot, exhaustive
   row-by-row tests on a v3 fixture; the server refuses to start rather than half-migrate.
2. **Missed scope** in a query = a cross-user leak: branded ids, `forUser` factories, scope lint, isolation suite, the
   `X-Legko-User` header and owner-checked photo reads.
3. **Device switching** logic (legacy adoption, provisional state, confirm, reload) is the most intricate client code;
   covered by store unit tests and the multi-user e2e; a bug there could show stale data of the same user, never send
   it to another account (header).
4. **Per-username lockout**: 10 wrong passwords in 15 min block that name's logins for a while (existing sessions are
   unaffected; 400-day sessions make it rare). The global cap (unchanged) can still block everyone during a flood.
5. **Links on iPhone open in Safari**: the home-screen app has its own storage and cookie jar. Mitigated by the
   «Готово» state in iOS Safari (username + install steps) and «Маю посилання» (paste the link into the installed
   app, D29); a person who finishes in Safari still logs in once inside the installed app.
6. **Keychain**: rename and the `legko` alias may confuse iOS password autofill; the hidden username fields (login,
   reset, «Пароль» card) and the rename form's `autocomplete` hints let Safari update the entry; she may still need to
   update it once.
7. **Setup link through chat**: if the owner wants the link handed over in chat, it is single use and 24 h; if it
   leaks before he uses it, `reset-password-link admin` revokes it; if it was already used by someone else, the §13
   step 4 recovery (`revoke-links --all`, a new link, `list-users`) also kills whatever that person created (D27).
8. **e2e rate limits / shared DB**: tests run on one DB and one IP; the rules in §11.2 must be followed or the suite
   becomes order-dependent.
9. **Rollback loses** other accounts, invites and per-user AI counts (`--keep anna`), by design.
10. **Two admins demoting each other at once**: last-admin checks run inside `BEGIN IMMEDIATE`, so only one wins.
11. **Admin reset links allow a takeover** of any account by design (owner decision 4). Mitigations: the copy says so,
   the person sees «Пароль задано … за посиланням від admin» in «Акаунт» and every one of their devices is signed out,
   and the server logs creation and use (D28).
12. **Legacy sessions** (migrated, or created by a username-less login) are accepted without `X-Legko-User` so the
   old bundle keeps working; they can only belong to the legacy owner, and the flag clears on the first request
   from the new bundle (D11, D24).
13. **Wipe on iOS**: IndexedDB can hang; the wipe is bounded (≈ 7 s worst case) and the tombstone stops a half-wiped
   device from rendering the previous person's copy (D12). Photos stay in the browser HTTP cache (private, 1 year)
   after a logout — reachable only by a 128-bit URL that the wiped copy held (see §17, rejected critique).

---

## 16. Owner questions (для владельца)

1. Ссылки-приглашения живут 7 дней, ссылка «новый пароль» — 24 часа. Подходит?
2. Вход с именем `legko` оставляем как синоним «anna» (так уже сохранён пароль в связке ключей на её iPhone). Ок?
3. Для админа «Перші кроки» сами не открываются (баннер «Почнімо» на главной остаётся). Ок, или админ — тоже обычный
   пользователь со своими записями?
4. Приглашения из приложения — только для обычных пользователей; админа можно сделать потом одной кнопкой (или
   `create-invite --admin` из консоли). Ок?
5. Лимиты ШИ: 40 в день на человека и 150 в день на всех (у Ани сейчас 60 в день — станет 40; перед деплоем проверю,
   не переопределён ли `FOOD_DAILY_LIMIT` в `.env` на сервере — его смысл меняется на «всего на всех»). Подходит?
6. Новые тексты нейтральные по роду («На цьому пристрої вже ввійдено як …»). Старые тексты местами в женском роде
   («Що я їла»). Переделать их на нейтральные — отдельной задачей?
7. На одном устройстве — один вошедший человек: при входе другим аккаунтом данные прошлого стираются с устройства
   (с предупреждением, если есть неотправленные изменения). Ок?
8. Пароль админа ты задаёшь сам по одноразовой ссылке (24 ч) — её печатает команда `create-admin admin` на сервере
   после деплоя. Передать эту ссылку тебе в чате или запустишь команду сам по SSH (`deploy/deploy.sh cli create-admin
   admin`)? Если откроешь ссылку и увидишь «вже використали» — значит, её перехватили: план восстановления в §13 шаг 4.
9. Настройки: строка «Акаунт» встаёт на место карточки «Вийти» внизу списка, а «Вийти» переезжает внутрь «Акаунт»
   (у админа там же строка «Користувачі»). Иначе список перестаёт помещаться на экран iPhone без прокрутки. Ок?
10. Имя «admin» зарезервировано: так зарегистрироваться или переименоваться нельзя, только командой на сервере. Ок?

---

## 17. Review round (critiques checked against the code)

### 17.1 Applied

| Critique | Checked against | Change |
| --- | --- | --- |
| Links outlive the admin who made them; no bulk revoke | §2.1 `created_by … SET NULL`, §3.3 matrix | D27; matrix «Links revoked» column; CLI `list-links` / `revoke-links`; §13 step 4 recovery; tests |
| scrypt before counting on the new endpoints; name probing | `routes/auth.ts` counts before `verifyPassword`; §3.4 / §3.5 did not | D31 gate; accept rejects a taken name before hashing and counts it; in-flight guard; password limiter fails before verify; account change limiter |
| Logout / switch wipe skipped when `idbUsable` is false | `store/cache.ts` `clearCache`: `if (!idbUsable) return;` | D12; `wipeDevice` always tries IndexedDB, falls back to `deleteDatabase`, verifies, tombstone; `check()` step 0 |
| Admin reset link = silent takeover; copy claims nobody sees others' records | §9.6 confirm copy | D28 (columns, `SessionUser.passwordChange`, «Акаунт» line, logs); make-admin copy fixed |
| Old-bundle tabs bypass `X-Legko-User` (raised twice) | old `lib/api.ts` sends no header; no BroadcastChannel; `PENDING_POLL_MS` 30 s | `sessions.legacy`; header required on data / ops / import for v4 sessions (D11); username-less logins create legacy sessions (D24) |
| Password change keeps the current token; login leaves the overwritten session alive | `routes/auth.ts` login sets a new cookie without revoking the incoming `sid` | D26 |
| Scope lint passable by unscoped statements | `db/data.ts:310` `db.exec('DELETE FROM days; DELETE FROM weights; …')` | §4 item 4: per statement, bound predicate, multi-table statements allowlisted, stale entries fail, bad-sample self-tests |
| `admin` not reserved; create-admin hint could point at a regular user | §3.1, §7 | D2 (`RESERVED_USERNAMES` + `allowAdmin`), create-admin refusal shows the role |
| Push takeover needs only the endpoint; switch leaves A's row | `lib/push.ts` `disablePush` sends only the endpoint | D15 rule by `auth`; `pushUnsubscribeRequestSchema.auth`; `lib/push.ts` moves to web-auth |
| Re-migrating a v3 file gives anna a new random id; client wipes her outbox | `backup.ts` `BACKUP_KEEP = 30` (v3 dailies) | D1 fixed `LEGACY_OWNER_ID`; determinism test; client never wipes pending ops silently on an id change (§8.2 step 2) |
| Rollback round trip: legacy keys written by the old app are ignored | `cache.ts` old keys only; §8.2 adopted legacy keys only without a pointer | §8.2 step 1 `mergeLegacyCache`; `flushCacheWrites` before adopt; `keepLegacy` on a switch to anna; runbook: open the app online first, logout-under-old-app note |
| Old server + new client: `me` and login answer `{ok:true}` (no 400) | v3 `loginRequestSchema` strips `username`; v3 `me` returns `OK` | `meResponseSchema`, `outdated_server`, §10 row rewritten |
| Downgrade blocked by one admin record; other users' settings dropped silently | §2.4 | `--drop-others`, refusal lists per-table counts incl. settings / subscriptions |
| Rollback without checking `previous` | `deploy/remote.sh` `cmd_rollback` goes one image back | §2.4 step 0 `deploy.sh status`; CLI usage text |
| `FOOD_DAILY_LIMIT` changes meaning | `config.ts` `DEFAULT_FOOD_DAILY_LIMIT = 60`; DEPLOY env table; `.env.example` | §13 step 0; start-up line with effective limits and source; DEPLOY / `.env.example` updates |
| D24 locks the old installed app out | old `api.login` sends `{ password }` | D24: missing username = `legko` alias (legacy session) |
| iPhone links end in a Safari copy; no way into the installed app | `InstallSheet` steps only from the banner; `buildBanner` puts setup before install | D29: «Готово» state with username + `InstallSteps`, «Маю посилання» paste, iOS copy-link note; `sheets/install/**` → web-auth |
| Settings list no longer fits 390×763 (raised twice) | `settings.spec.ts:63-92` checks 844 and 763; `40-settings.png` measured; `AppShell .main` 120 px bottom padding | D30 layout (+0 user, ≈ +28 admin); corrected height numbers in §9.4; both heights for both roles |
| `used` invite advice; «До входу» label | §9.2 / §9.3 | per-reason copy; «Увійти» / «Відкрити Легко» |
| No forgotten-password hint | §9.1 | footer + post-error hint + desktop autofocus rule |
| Autofill hints on the account forms | `LoginScreen.tsx` hidden username input; §9.5 | hidden username in the «Пароль» form, rename `autocomplete`, delete input `autocorrect=off` etc. |
| Gendered «створив», CLI invites, admin invites, «Останній вхід» | §9.6 | «від admin» / «з консолі», «Адмін» pill on invites, «Активність …» wording, «Ще не входили» |
| «Роль» Segmented too tight at 320; no 320 checks | `Segmented` equal columns, Sheet padding 18 | label above a full-width Segmented; 320×568 a11y checks and 320 shots |
| Reset-link button for disabled users | §3.4 409 `account_disabled` | button hidden + hint; error mapped |
| «Скопійовано» shown when nothing was copied; bare shared URL | §9.6 | toast only after `writeText`; manual-copy fallback; share `text` |
| Admin lands on an empty Home after setup | `homeModel.buildBanner` setup banner, not dismissible | D23: `/settings/users` after a link flow for admins (not after every login, see 17.2) |
| Anna's «з <date>» = oldest live session | hourly session purge | earliest of sessions / photos / day / weight / measure dates |
| Small copy fixes | `UNSYNCED_LOGOUT_CONFIRM` wording | switch body, login hint, reset note, «0 — підрахунки вимкнено», per-user 0 |
| web-auth breaks unowned web tests | `HomeScreen.test.tsx`, `CalendarScreen.test.tsx`, `SheetHost.test.tsx`, `RecordSheet.test.tsx` mock idb-keyval with `{getMany,setMany,delMany}` | no-owner = today's behaviour; full `@legko/web` suite in web-auth's checks; test-only edits in those four files |
| `guard.test.ts` case needs features' push route | `test/guard.test.ts:154-166` posts `/api/push/subscribe` | case moves to features' `test/push.test.ts`; core never relies on feature success paths |
| Bootstrap e2e leaves a second admin | `playwright.config.ts` `workers: 1`, one `DATA_DIR` | `finally` delete; precondition check in users-admin |
| Pointer cannot supply `SessionUser` | §8.1 pointer `{id, username, role}` | pointer = full `SessionUser` |
| Fixed browser clock vs real server dates | `e2e/support/test.ts` `page.clock.install({ time: FIXED_NOW })` | rule + `page.route` stubs in visual / a11y; future-timestamp formatter test |
| Pending-invite cap fills up in e2e | `MAX_PENDING_INVITES = 20`, shared DB | auto fixture revokes pending invites after each test |
| `applyDevUsers` signature mismatch | the two briefs | `scrypt: ScryptParams = DEFAULT_SCRYPT` in both |
| `photo_not_found` is not an ApiErrorCode | `routes/food.ts:104` `not_found` + `MESSAGES.photoNotFound` | §5.2 and the features brief use `not_found` |
| Allowlist misses kept statements | `photos/store.ts:95,112`, `auth/sessions.ts:41` | entries listed; GC delete scoped with `AND user_id = ?` |
| `AdminInvite.createdBy` ambiguous | §6.1 | defined as the creator's username (null = CLI) |
| e2e food mock lacks `limitToday` | `e2e/support/food.ts:75` | default `{ remainingToday: 37, limitToday: 40 }` (`DEFAULT_FOOD_STATUS`); `mockFood` refuses a status with `remainingToday` above `limitToday` (`foodStatusProblem`); UI omits «з L» without it |

### 17.2 Rejected critique

- **Disabled accounts reveal a correct password (answer 401 for disabled users too)** — rejected: guessing is bound
  by the per-username (10 / 15 min) and per-IP limits, and a password learned against a disabled account is worth
  exactly what the same guess against an enabled one is; disable already revokes every session, so the proposed
  «403 once on the existing session» would never fire and the disabled person (and the owner's e2e flow) would only
  ever see «Неправильне імʼя або пароль».
- **`Clear-Site-Data: "cache"` on logout and every login** — rejected: photo URLs are 128-bit ids that only the
  wiped device copy held and the HTTP cache is not enumerable by a page; the header clears the whole HTTP cache, is
  slow in Chromium on large caches and is unevenly supported by iOS Safari. Noted in §15 risk 13.
- **Alternative settings layout (rows inside the «Вийти» card, admin allowed to scroll at 763)** — rejected in favour
  of D30, which fits both heights for both roles without weakening `settings.spec` and matches owner item 5
  (logout under «Акаунт»). The corrected height numbers from that critique were applied.
- **One-time sheet after a login that follows someone else's reset** (part of the takeover critique) — rejected: a
  completed reset already signs out every device of that person, and «Акаунт» shows the provenance line (D28).
- **Re-key the device copy when the legacy owner's id changes** (part of the re-migration critique) — rejected as
  unreachable: with the fixed `LEGACY_OWNER_ID` and `kv.legacy_user` the legacy owner's id never changes; the «never
  wipe pending ops silently on an id change» part was applied.
- **Answer 503 when the scrypt queue is full** — replaced by 429 `rate_limited` + `Retry-After` (the client treats
  ≥ 500 as «Немає зʼєднання з сервером»); the gate itself was applied.
- **Land admins on `/settings/users` after every login** — narrowed to link flows (invite / reset / setup): a plain
  login keeps its URL and deep links, and owner question 3 may still make «admin» an ordinary user too.
