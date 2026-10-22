# Deploying «Home Fit»

Production: **https://fit.triple-a.dev** — one Vultr VPS, two containers, built on the server from the
committed `HEAD` by `deploy/deploy.sh`.

## Architecture

```
  iPhone (installed PWA) / desktop browser
                │  HTTPS 443/tcp + 443/udp (HTTP/3) · 80 → redirect to HTTPS
                ▼
┌─ VPS 64.176.75.160 · Ubuntu 24.04 · 1 vCPU / 2 GB + 5 GB swap · ufw: 22, 80, 443/tcp, 443/udp ─┐
│                                                                                                │
│  compose project "training-app"  (/opt/training-app)                                           │
│                                                                                                │
│  ┌─ caddy ─────────────────────┐  reverse_proxy   ┌─ app ─────────────────────────────────┐    │
│  │ caddy:2.11.7-alpine         │  legko-app:3000  │ training-app:latest (built here)      │    │
│  │ publishes 80, 443, 443/udp  │ ───────────────► │ node 24 · uid 1000 · read-only rootfs │    │
│  │ TLS (Let's Encrypt), HSTS,  │  docker network  │ API /api/* + static PWA + Web Push    │    │
│  │ gzip/zstd, bodies ≤ 17 MB   │                  │ no published ports · mem ≤ 512 MB     │    │
│  │ vol caddy_data  (certs)     │                  │ ./data → /data                        │    │
│  │ vol caddy_config            │                  │   legko.db (SQLite, WAL), backups/,   │    │
│  └─────────────────────────────┘                  │   photos/                             │    │
│                                                   └──────────────────┬────────────────────┘    │
└──────────────────────────────────────────────────────────────────────┼─────────────────────────┘
                ▲                                                      │ outbound HTTPS only
                │  ssh deploy@64.176.75.160                            ▼
     developer machine (Windows, Git Bash)              Anthropic API (AI calorie estimates),
     deploy/deploy.sh: git archive → src/,              Apple/FCM push services (Web Push)
     docker compose build + up
```

Files on the server:

```
/opt/training-app/                 owner: deploy
  compose.yaml   Caddyfile         copied from deploy/ on every deploy (previous versions: *.bak)
  .env                             secrets and overrides, mode 600 (not in git) — see below
  src/                             build context: the deployed commit
  data/                            owner uid 1000 (the container's `node` user)
    legko.db  legko.db-wal  legko.db-shm
    backups/legko-YYYY-MM-DD.db    daily, newest 30 kept
    backups/legko-pre-v3-YYYY-MM-DD.db       written once, right before the schema v3 (meals) migration; never pruned
    backups/legko-pre-v4-YYYY-MM-DD.db       written once, right before the schema v4 (accounts) migration; never pruned
    backups/legko-pre-down-v3-YYYY-MM-DD.db  written by `cli.js downgrade-schema` v3 → v2 (rollback); never pruned
    backups/legko-pre-down-v4-YYYY-MM-DD.db  written by `cli.js downgrade-schema` v4 → v3 (rollback); never pruned
    backups/legko-pre-v4-YYYY-MM-DD-2.db     …-2, -3: a second migration / downgrade on the same Kyiv day — these
                                             snapshots are never replaced, so the un-suffixed file is the first one
    photos/<id>.jpg  <id>_t.jpg    food photo diary (full + thumbnail)
  deploys.log                      one line per deploy / rollback (UTC)
```

Images: `training-app:latest` (running) and `training-app:previous` (what ran before the last deploy).
Both containers use `restart: unless-stopped`, so they come back after the 02:00 UTC update reboots.
Only Caddy publishes ports — Docker-published ports bypass ufw, so the app must never get a `ports:` entry.

### `.env` (secrets and overrides)

`/opt/training-app/.env` is read by the app container if it exists; the file is optional for the stack to start.
`PUBLIC_ORIGIN` is set in `compose.yaml`; everything else has a default.

| Variable                                 | Purpose                                                                                                                                                                                                                                                              |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                      | enables the AI calorie estimate (text / photo); without it the UI hides it                                                                                                                                                                                           |
| `FOOD_AI_MODEL`                          | optional model override for the estimate (default `claude-opus-5-5`)                                                                                                                                                                                                 |
| `FOOD_DAILY_LIMIT`                       | **global** ceiling: estimates for everybody together per Kyiv day (default `150`; `0` switches them off for everyone). Before the users release it meant «estimates per day» (default 60) — see [step 0](#first-deploy-of-the-users-release-and-the-admin-bootstrap) |
| `FOOD_USER_DAILY_LIMIT`                  | estimates per account per Kyiv day (default `40`, `0`–`1000`)                                                                                                                                                                                                        |
| `LOG_LEVEL`                              | `debug`, `info` (default), `warn`, `error` or `silent`                                                                                                                                                                                                               |
| `VAPID_SUBJECT`                          | Web Push contact (`https:` URL or `mailto:`), default `PUBLIC_ORIGIN`                                                                                                                                                                                                |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | only to pin keys; by default they are generated once and kept in the DB                                                                                                                                                                                              |

Edit it on the server (the key never goes into git, chat or shell history), then apply:

```bash
ssh -t deploy@64.176.75.160 'umask 077 && nano /opt/training-app/.env'      # e.g. ANTHROPIC_API_KEY=sk-ant-…
ssh deploy@64.176.75.160 'cd /opt/training-app && docker compose up -d'      # recreates the app with the new env
```

`docker compose config` (without `--quiet`) prints values from `.env` — don't paste its output anywhere.
Changing the VAPID keys invalidates every push subscription (notifications must be re-enabled on the phone).
Passwords are **not** env variables — each account's scrypt hash lives in the database (see
[Accounts and the admin](#accounts-and-the-admin)). The `DEV_*` variables of `apps/server/.env.example` (local dev
accounts) are ignored in production. AI limits an admin saves in «Користувачі» (stored in the database) win over
`FOOD_DAILY_LIMIT` / `FOOD_USER_DAILY_LIMIT`; `FOOD_DAILY_LIMIT=0` still switches the estimate off entirely.

## One-time server setup (already done — for the record)

- Vultr instance, Ubuntu 24.04, 5 GB swap file, **Vultr Auto Backups** enabled.
- DNS: `A fit.triple-a.dev → 64.176.75.160`. `.dev` is HSTS-preloaded, so the site is HTTPS-only.
- SSH: key-only login. Users `root` (administration) and `deploy` (member of the `docker` group, used for
  every deploy).
- ufw: allow `22/tcp`, `80/tcp`, `443/tcp`, `443/udp`; everything else denied.
- Docker Engine + compose plugin from Docker's apt repository; the docker service starts on boot.
- Unattended upgrades with automatic reboot at 02:00 UTC when required.
- `/opt/training-app` owned by `deploy`, with a placeholder stack (Caddy serving a static page) that obtained
  the certificate into the `caddy_data` volume. The new `compose.yaml` keeps the project name
  `training-app` and the volume keys `caddy_data` / `caddy_config`, so the certificate is reused.

Server-side requirements of the scripts: Docker Engine ≥ 25 (older engines ignore the healthcheck `start-interval`,
so the first check comes after 30 s), compose ≥ 2.24 (optional `env_file`), `flock` (util-linux).

## Developer machine

- Git Bash (ships with Git for Windows) or any bash; `ssh` with the key for `deploy@64.176.75.160`; `curl`.
- Run everything from Git Bash inside the repo. From PowerShell use Git's bash explicitly
  (`& "C:\Program Files\Git\bin\bash.exe" deploy/deploy.sh`), not WSL's `bash`.
- Overrides (all optional): `DEPLOY_HOST`, `DEPLOY_DIR`, `PUBLIC_URL`, `DEPLOY_SSH_OPTS`
  (e.g. `DEPLOY_SSH_OPTS="-i /c/Users/me/.ssh/vultr"`), `LOG_TAIL`. `deploy/deploy.sh --help` lists them.

## First deploy

1. Commit everything; `git status` must be clean.
2. `deploy/deploy.sh`
   - If it stops with _"data is not writable by uid 1000"_, run the root command it prints once
     (`ssh root@64.176.75.160 'chown -R 1000:1000 /opt/training-app/data && chmod 700 /opt/training-app/data'`)
     and run the deploy again. If `deploy` itself has uid 1000 this never happens.
   - The new `compose.yaml` replaces the placeholder one; Caddy is recreated with the same volumes and switches
     to the new `Caddyfile` as soon as the app is healthy (the old placeholder config may answer for a few seconds).
3. Bootstrap the admin (`deploy/deploy.sh cli create-admin admin`, see [Accounts and the admin](#accounts-and-the-admin)),
   then invite the people who use the app from «Користувачі».
4. Put `ANTHROPIC_API_KEY` into `.env` and apply it (see [`.env`](#env-secrets-and-overrides)); until then the
   AI calorie estimate is simply hidden.
5. Each person opens their invite, chooses a name and a password and completes «Перші кроки». On the iPhone:
   Safari → Share → «На початковий екран», open the installed app, log in there and enable notifications.
6. Optional clean-up of the placeholder: `ssh deploy@64.176.75.160 'rm -rf /opt/training-app/placeholder'`.

## Accounts and the admin

Since the users release (schema v4, `docs/multi-user.md`) every person has an account — a username and a password —
and completely separate data. There is no open sign-up: an **admin** creates one-time links in Settings →
«Користувачі» (or with the CLI). The server CLI runs inside the app container:

```bash
deploy/deploy.sh cli <command> [args…]        # = ssh -t … 'docker compose exec app node /app/server/cli.js <command> …'
deploy/deploy.sh cli help                     # every command
```

| Command                                   | Does                                                                                                                                                          |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `create-admin <username>`                 | creates an admin **without a password** and prints a one-time setup link (24 h). Refuses when the name exists (an existing admin → use `reset-password-link`) |
| `create-invite [--admin] [--note <text>]` | prints a one-time invite link (7 days); role user, or admin with `--admin` (the app only makes user invites)                                                  |
| `reset-password-link <username>`          | prints a one-time password link (24 h; a setup link when the account has no password yet); older pending links for that account are revoked                   |
| `set-password <username> [--stdin]`       | hidden prompt twice (or the first line of stdin); signs that account out on every device                                                                      |
| `set-role <username> <admin\|user>`       | never removes the last usable admin; a demotion signs the account out and revokes the links it created                                                        |
| `rename-user <old> <new>`                 | sessions are kept (`admin` may be used here, `legko` never)                                                                                                   |
| `list-users`                              | username · role · status (active / disabled / no password) · created · last activity · AI estimates today                                                     |
| `list-links`                              | pending invite / reset / setup links: id, kind, role, for whom, created by, expiry (never the links themselves)                                               |
| `revoke-links --by <username>` / `--all`  | revokes the pending links that account created, or every pending link                                                                                         |

Links are printed once, to your terminal only, with `PUBLIC_ORIGIN` (`https://fit.triple-a.dev`, set in
`compose.yaml`); the server never logs a token (logs carry link and user **ids** only). A link carries its secret in
the `#…` fragment, which never reaches the server, Caddy or link previews. Every command opens the live database
(WAL, safe while the app runs) and writes nothing to the app logs. The account commands **never migrate**: on a
database at an older schema they refuse (exit 1, nothing changed — «start the server once»), so run them after the
new image has started (only a missing or empty database is created, for a first install).

### First deploy of the users release and the admin bootstrap

0. **Before deploying**, check `/opt/training-app/.env` for `FOOD_DAILY_LIMIT`:
   `ssh deploy@64.176.75.160 'grep -n FOOD_ /opt/training-app/.env'`. It now means the **global** daily ceiling for
   everybody together (default 150); per account it is `FOOD_USER_DAILY_LIMIT` (default 40). Remove an old override
   such as `FOOD_DAILY_LIMIT=60` (it would cap everyone together at 60), or set it to the new meaning. After the
   deploy the start-up log line shows the limits in force and where they come from
   (`AI calorie estimate enabled (model …, per user 40, global 150; limits from defaults)`).
1. `deploy/deploy.sh` — on its first start the app migrates the database to schema **v4** in one transaction (log
   `database schema v3 → v4: saved legko-pre-v4-<date>.db first`). Anna's account becomes the ordinary user
   **«anna»** (role user, the fixed id `00000000000000000000000000000001`) with her current password, sessions (no
   re-login), data, photos, reminders and push subscriptions. No admin exists yet: the log says
   `No admin account: run node /app/server/cli.js create-admin <name>`.
2. Bootstrap the admin **after** step 1 has finished (the new image's first start migrates; the CLI refuses a v3
   database). Nothing secret is typed, stored in shell history or logged:

   ```bash
   deploy/deploy.sh cli list-users          # optional check: exactly one line, «anna  user  active …»
   deploy/deploy.sh cli create-admin admin
   ```

   It prints `https://fit.triple-a.dev/reset#<token>` — single use, valid 24 h — together with the expiry in Kyiv
   time. `create-admin` refuses (exit 1, nothing created) when the name already exists: an existing admin →
   `reset-password-link admin`; an existing regular user → pick another name. The admin has its own, empty data and
   sees the list of accounts (names, role, created, last activity, AI counts) in «Користувачі». Since the coach
   release the admin also sees each ordinary user's records and progress, **read-only**, in «Клієнти»
   (`docs/coach-cabinet.md`); it never sees other admins' records and can change nobody's. Until
   anna's app makes its first request after the deploy her row reads «Ще не входили» (v3 kept no activity time).

3. Open the link (on the device you will manage from), choose the password on «Створення пароля»; you are signed in
   as «admin» and land on «Користувачі». If the link expired: `deploy/deploy.sh cli reset-password-link admin`
   prints a new one (the old one stops working). On an iPhone the link opens in Safari, which then shows «Готово»;
   the home-screen app has its own login (or paste the link there: login screen → «Маю посилання»).
   Right after this deploy, browsers that opened the app before still run the **old** version until the page reloads:
   such a browser opens the link in the old app (Anna's data, or the old password-only login) and drops the `#…` part
   instead of showing «Створення пароля». So open the link in a private window, or in a browser that has already
   loaded the new version (it asks for a username at login). If it opened the old app anyway, reload that page once,
   then open the same printed link again: the old app never checked it, so it stays valid until a password is set.
4. **If the link says «Це посилання вже використали»** and you did not use it, someone else did. Recover:

   ```bash
   deploy/deploy.sh cli revoke-links --all              # every pending invite / reset link, whoever made it
   deploy/deploy.sh cli reset-password-link admin       # a new link; completing it signs every «admin» device out
   deploy/deploy.sh cli list-users                      # then demote / delete anything you do not expect:
   deploy/deploy.sh cli list-links                      #   set-role <name> user, or the «Користувачі» sheet
   ```

   Completing a reset for an admin also revokes every invite and reset link that admin created (D27), so what the
   intruder made dies with it.

5. Invites: «Користувачі» → «Створити запрошення» (optional note «для Олі») → «Поділитися» / «Скопіювати». The
   person chooses their own name and password and gets «Перші кроки». Pending invites are listed there and can be
   revoked; at most 20 can be pending at once.

Everyday account work happens in «Користувачі» (admins only): a password link for someone who forgot theirs (24 h;
their old password works until the link is used; using it signs all their devices out and shows «Пароль задано …
за посиланням від admin» in their «Акаунт»), the role, disable / enable (signs them out, stops their reminders, keeps
their records), delete (typed name; removes all their records and photos), their own AI limit and the global limits.
The last usable admin can be neither demoted, disabled nor deleted, and nobody can disable or delete themselves.
Every person changes their own password and name in Settings → «Акаунт», where «Вийти» lives too.

«Клієнти» (admins only; sidebar on a computer, tab bar on the phone) is the read-only coach view of every ordinary
user: a table with weight, kcal, Б · Ж · В, workouts, activity and attention flags, and a page per person (overview,
their Progress, calendar with meals and photos, nutrition). Nothing there can be changed. Every ordinary user sees
«Адміністратор бачить твої записи та прогрес.» in «Акаунт» and on the invite page. The coach release needs **no
migration** and no new `.env` setting — a routine deploy; the server logs one `coach: admin <id> …` line per access
(ids only, `docs/coach-cabinet.md` C10).

### Setting a password

Prefer a link — the person types the password themselves:

```bash
deploy/deploy.sh cli reset-password-link anna     # prints https://fit.triple-a.dev/reset#… (24 h)
```

On the server directly (hidden prompt twice; signs that account out on every device and revokes its pending reset
links; for an admin also the links it created):

```bash
deploy/deploy.sh set-password <username>           # = deploy/deploy.sh cli set-password <username>
ssh -t deploy@64.176.75.160 'cd /opt/training-app && docker compose exec app node /app/server/cli.js set-password anna'
```

For scripting, `set-password <username> --stdin` reads the password from one line of stdin (use
`docker compose exec -T`). `set-password` without a username is refused (usage, exit 2).

## AI calorie estimate

- **Off until `ANTHROPIC_API_KEY` is in `.env`** (then `docker compose up -d`). Without it `GET /api/food/status`
  answers `enabled: false` and the UI hides «✨ Порахувати» / «📷 Фото». The start-up log says which:
  `AI calorie estimate enabled (model claude-opus-5-5, per user 40, global 150; limits from defaults)` (or
  `… from env` / `… from kv.ai_limits` once an admin saved them) or `AI calorie estimate disabled (…)`.
- The app container calls the Anthropic API (outbound HTTPS) with Claude Opus 5.5 (`FOOD_AI_MODEL`): structured JSON
  output, effort `low`, server-side refusal fallback; 60 s timeout, one retry. An estimate usually takes 5–20 s.
- **Cost guard:** two limits per Kyiv day (`Europe/Kyiv`, whatever time zone an account is set to, so changing the
  zone cannot reset them): **per account** (`FOOD_USER_DAILY_LIMIT`, default 40; an admin can give one account its
  own limit, 0 = off for that account) and a **global ceiling** for everybody together (`FOOD_DAILY_LIMIT`, default
  150). Values an admin saves in «Користувачі» → «Підрахунки калорій» win over the env defaults. Both counters
  are in the database (survive restarts); the per-account counts are pruned after 90 days. Over a limit → 429 with
  «Ліміт підрахунків на сьогодні вичерпано» (own limit) or «Підрахунки на сьогодні закінчилися. Спробуй завтра»
  (global) until midnight Kyiv time. Each person sees what is left in «Акаунт» → «Підрахунки калорій»; the admin
  sees per-account usage (today / 30 days) in «Користувачі». Recalculation counts as one estimate, as before.
- **Photos** arrive with the estimate (downscaled JPEG + thumbnail, made on the phone) and are stored in
  `data/photos/` before the model is called. Each photo belongs to the account that took it (`photos.user_id`;
  files stay flat in `data/photos/`): another account asking for its id gets a 404. Photos that none of **their
  owner's** days and meals references 24 h later are deleted daily at ~03:40 Kyiv time (log line `photo gc: …`); an
  account with an unreadable `days.meals` row keeps all its photos for that run (log line
  `photo gc: kept the photos of N account(s) with unreadable meal data`).
- **Б · Ж · В**: every estimate and «✨ Перерахувати» also returns protein / fat / carbs per position (grams, 0.5 g
  steps, 0–1 000, checked on the server); one model call each, as before — the budget is unchanged.
- **Logs** never contain the description, the photo or the key. A failed estimate logs one line such as
  `food estimate failed: HTTP 529 overloaded_error: …`, `request timed out` or `refusal (category: …)`; a rejected
  key logs `Anthropic key rejected (HTTP 401): check ANTHROPIC_API_KEY` once, and estimates answer 503 until the key
  is replaced (see [Rotating](#rotating-a-password-and-the-api-key)).

## Routine deploys

```bash
git commit …          # deploy.sh refuses a dirty tree; --force deploys HEAD and ignores local changes
deploy/deploy.sh
```

What it does:

1. Uploads `git archive HEAD` to `/opt/training-app/src.new` and swaps it in as `src/`.
2. Validates and installs `deploy/compose.yaml`; validates `deploy/Caddyfile` with the Caddy image.
3. Checks that `data/` is writable by uid 1000.
4. Tags the running (healthy) app image as `training-app:previous`.
5. `docker compose build --pull app` with `APP_VERSION=<short sha>` (a few minutes on 1 vCPU; the base image
   is re-pulled, so Node/Alpine patches arrive with every deploy).
6. `docker compose up -d --remove-orphans`, waits up to 120 s for the app healthcheck; on failure prints
   `docker compose ps` and the last app logs.
7. Installs the new `Caddyfile` (if changed) and reloads Caddy without downtime.
8. Prunes dangling images and old build cache; appends to `deploys.log`.
9. From your machine: `GET https://fit.triple-a.dev/api/health` must answer and report the new version.

Requests that arrive while the app container restarts are held by Caddy for up to 15 s, so a deploy is
usually invisible to the user. Redeploying the same commit is fine (e.g. to pick up base-image updates).

## Rollback

```bash
deploy/deploy.sh rollback
```

Retags `training-app:previous` as `latest`, recreates the app and waits for it to be healthy. Only one step back;
`compose.yaml` / `Caddyfile` are not rolled back (their previous versions are `*.bak` on the server — or revert the
commit and deploy). If the bad release already migrated the database (`PRAGMA user_version`), the old code may not
understand it: restore the backup taken before the deploy (see below). For risky releases make a manual backup first.

### Rollback after the workouts and steps release (schema v5)

The workouts and steps release (`docs/workouts-steps-rebrand.md`) migrates the database to schema **v5** on its first
start. The migration is **additive**: four new per-account tables `exercises`, `workouts`, `workout_sessions` and
`steps` (each keyed by `user_id`, deleted with the account); no existing row changes. Just before migrating it saves
`data/backups/legko-pre-v5-<deploy day>.db` (automatic, like every schema step; never replaced — a second migration
that day writes `…-2.db`). **The previous build refuses a v5 database** (`Database schema v5 is newer than this build
(v4)`), so `deploy/deploy.sh rollback` alone crash-loops: downgrade the schema with the **new** image first.

0. **Check what you would roll back to**: `deploy/deploy.sh status`. Downgrade only when `training-app:previous` is a
   build from **before** this release; if it is already a v5 build, just run `deploy/deploy.sh rollback`.
1. Downgrade with the app stopped, then roll back:

   ```bash
   ssh deploy@64.176.75.160
   cd /opt/training-app
   docker compose stop app
   docker compose run --rm --no-deps app node /app/server/cli.js downgrade-schema
   exit
   deploy/deploy.sh rollback          # from your machine
   ```

   `downgrade-schema` on a v5 file saves `backups/legko-pre-down-v5-<Kyiv date>.db` first, then in one transaction
   drops the four v5 tables and sets `user_version` 4. **Every account stays**, with its days (the ✓ marks and workout
   types a session wrote stay on the days), weigh-ins, measurements, meals, photos and settings
   (`settings.stepsGoal` may stay in the JSON; the v4 build ignores it). It prints, per account, how many exercises,
   workouts, sessions and steps entries it dropped. `--keep` / `--drop-others` are refused on v5 (nothing changed):
   they belong to the v4 → v3 step, which is a **second** run — only to go back further, to the build before accounts.
   Run no other CLI command of the new image in between (its account commands refuse a v4 database anyway).
2. `deploy/deploy.sh rollback` — the previous build starts on the v4 database.

What is lost, and good to know:

- **New-feature data written after the rollback survives only in the snapshot.** While the old build runs, the new
  app's ops for workouts, sessions and steps are refused by the old server («Сервер відхилив одну зміну») and dropped
  from the outbox. Everything the four tables held at the downgrade is in `legko-pre-down-v5-<date>.db` only; a later
  re-upgrade starts with empty workouts and steps (restore that snapshot instead if they must come back, losing what
  was logged on the old build).
- **A backup made from an installed app before it updated has no workouts or steps**: the old bundle's
  «Завантажити резервну копію» builds the file from its own device copy, which drops the new keys. Restoring such a
  file later (with this or any newer build) replaces her workouts, sessions, own exercises, steps and steps goal with
  nothing — that is what «Відновити з копії» means. Make the copy from an updated app (or `GET /api/export`) instead.
- The backup download name stays `legko-<date>.json` (internal name, kept on purpose).
- **Fallback**: stop the app, restore `backups/legko-pre-v5-<deploy day>.db` (the un-suffixed one) as in
  [Restore from a backup file](#restore-from-a-backup-file), then `deploy/deploy.sh rollback`. This loses everything
  logged after the deploy.

### Rollback after the users release (schema v4)

The users release (accounts, `docs/multi-user.md`) migrates the database to schema **v4** on its first start: new
tables `users`, `user_settings`, `ai_usage`, `invites`, `password_resets`, and every per-person table (`days`,
`weights`, `measures`, `foods`, `photos`, `sessions`, `push_subscriptions`, `reminder_log`) rebuilt with a `user_id`
in its key; the pre-accounts password, settings and AI counter move from `kv` into anna's account. Just before
migrating it saves `data/backups/legko-pre-v4-<deploy day>.db`. **The previous build refuses a v4 database**
(`Database schema v4 is newer than this build (v3)`), so `deploy/deploy.sh rollback` alone crash-loops: downgrade the
schema with the **new** image first.

0. **Check what you would roll back to**: `deploy/deploy.sh status`. Downgrade only when the `training-app:previous`
   line shows a version from **before** the users release. If `previous` is already a v4 build (a hotfix was deployed
   since), just run `deploy/deploy.sh rollback` and do **not** downgrade — it would delete every other account for
   nothing (a v4 build reads the v4 database as it is).
1. Ask anna to open the app once **while online**, so her installed app sends what is still in its outbox: the old
   bundle cannot see the per-account device copy (`legko.outbox.<id>`).
2. Downgrade with the app stopped, then roll back:

   ```bash
   ssh deploy@64.176.75.160
   cd /opt/training-app
   docker compose stop app
   docker compose run --rm --no-deps app node /app/server/cli.js downgrade-schema --keep anna
   exit
   deploy/deploy.sh rollback          # from your machine
   ```

   Run no other CLI command of the new image between `downgrade-schema` and `deploy/deploy.sh rollback` (its account
   commands refuse a v3 database anyway; only the server would migrate it back).

   `downgrade-schema` opens the database **without** migrating and refuses (nothing changed) unless it is at v4. It
   keeps **one** account (`--keep <username>`, or the only one) with its password hash, sessions, settings, records,
   photos, push subscriptions and reminder log, and parks its identity in `kv.legacy_user` (id, name, role, created),
   so a later upgrade gives it **the same id** again. While **another** account owns records (days, weights,
   measures, dishes or photos) it refuses and lists each such account with per-table counts, naming the flag:
   read the counts, then (only if those records may go) re-run with `--drop-others`. Accounts without records (a
   fresh «admin») are always dropped; their settings and push subscriptions are listed as dropped. It saves
   `backups/legko-pre-down-v4-<Kyiv date>.db` (`-2`, … for a second one that day; never replaced), then in one
   transaction rebuilds the eight tables into the exact v3
   shapes with only the kept account's rows, drops `ai_usage`, `invites`, `password_resets`, `user_settings` and
   `users`, removes the admin-saved AI limits and sets `user_version` 3. It prints what it kept and dropped. Photo
   files of dropped accounts stay on disk until the v3 photo clean-up removes them as stray files (a day later).
   Running `downgrade-schema` again on the v3 database is the v3 → v2 step below — only to go back further.

3. `deploy/deploy.sh rollback` — the previous build starts on the v3 database (anna's sessions still valid).

What is lost: every other account and its records (with `--drop-others`), «admin» (bootstrap it again after a
re-upgrade), pending invites and reset links, per-account AI counts (today's global count stays) and the
admin-saved AI limits. Good to know:

- **Logging out under the rolled-back app** does not clear the per-account device copy (`legko.user`,
  `legko.data.<id>`) the new bundle wrote; after a re-upgrade that copy is shown offline-first until `me` answers 401. What the old app writes meanwhile goes to the legacy keys (`legko.data` / `legko.outbox`) and is merged into
  anna's copy (and sent once) by the next v4 start.
- **Fallback** (the downgrade failed or something looks wrong): stop the app and restore
  `backups/legko-pre-v4-<deploy day>.db` — the un-suffixed one, the first snapshot of that day (`-2`, `-3` are later
  re-migrations) — exactly as in [Restore from a backup file](#restore-from-a-backup-file),
  then `deploy/deploy.sh rollback`. This **loses everything logged after the deploy** (and every account made since);
  re-migrating that file later gives anna the same id (`LEGACY_OWNER_ID`), so her devices keep their copy.
- **Never lower `user_version` by hand**: only `downgrade-schema` rebuilds the tables into shapes the old build reads.
- `docker compose exec` (and so `deploy/deploy.sh cli`) runs inside the live container: the downgrade must use
  `docker compose run --rm --no-deps` with the app stopped (`deploy.sh cli downgrade-schema` refuses for that reason).

### Rollback after the meals release (schema v3)

The release with meals and Б · Ж · В («Прийоми їжі та БЖУ», `docs/meals-macros.md`) migrates the database to schema
**v3** on its first start: it adds `days.meals` (the meal list of a day, `NULL` = a day from before meals) and
`foods.protein` / `foods.fat` / `foods.carbs`. Nothing existing is rewritten, and every day keeps its food text, kcal
and photos in the old columns (for a day with meals they are derived from the meals). Just before migrating, the
app saves `data/backups/legko-pre-v3-<deploy day>.db` (log line `database schema v2 → v3: saved … first`).

**`deploy/deploy.sh rollback` alone fails on a v3 database:** the previous build refuses a schema newer than its own
(`Database schema v3 is newer than this build (v2)`), crashes on start and never gets healthy. Downgrade the schema
with the **new** image first — while `training-app:latest` is still the new one — then roll back:

```bash
ssh deploy@64.176.75.160
cd /opt/training-app
docker compose stop app
docker compose run --rm --no-deps app node /app/server/cli.js downgrade-schema
exit
deploy/deploy.sh rollback          # from your machine
```

1. `docker compose stop app` — nothing may write to the database meanwhile (Caddy keeps answering 502 for a minute).
2. `downgrade-schema` (the image has no `ENTRYPOINT`, so the command replaces its `CMD`; it uses `DATA_DIR=/data`):
   refuses unless the database is at v3 (then nothing is changed); saves
   `backups/legko-pre-down-v3-<Kyiv date>.db`; then, in one transaction, drops `days.meals` and the three `foods`
   macro columns and sets `user_version` to 2. It prints what it saved and dropped. Every day keeps its food text
   (the «Сніданок: …» lines of its meals), its kcal and its first 12 photos; lost are only the meal structure
   (types, times, positions) and all protein / fat / carbs values.
3. `deploy/deploy.sh rollback` — the previous build starts on the v2 database and gets healthy.

Good to know:

- **Fallback** (the downgrade failed, or something looks wrong): stop the app and restore
  `backups/legko-pre-v3-<deploy day>.db` over `legko.db` exactly as in [Restore from a backup file](#restore-from-a-backup-file)
  (delete `legko.db-wal` / `-shm` too), then `deploy/deploy.sh rollback`. This **loses everything logged after the
  deploy** (meals, weigh-ins, workouts…), so prefer the downgrade.
- **Never lower `user_version` by hand** (e.g. `PRAGMA user_version = 2` without dropping the columns): the old build
  would run, but the next upgrade's `ADD COLUMN meals` fails, and a stale `meals` JSON left in a row would later
  override food logged meanwhile. Only `downgrade-schema` does both steps together.
- **Phones still on the new version** keep unsent changes in their outbox. The old server answers new kinds of
  changes (`meal.put`, `meal.delete`, `day.meta`) with `invalid_op`, and the app drops each one with «Сервер відхилив
  одну зміну — її не збережено»: a meal she logged offline right before the rollback must be typed again. Ask her to
  open the app once while online before you roll back; after the rollback the installed app reloads itself into
  the old version the next time it comes to the foreground.
- **Upgrading again** later simply re-runs the v3 migration (a new `legko-pre-v3-…` snapshot first): every day then
  starts as a day without meals (one block «Їжа за день», kcal and photos intact), and dishes without macros.
- A day whose `days.meals` cannot be read (hand-edited or corrupt JSON) is served as a day without meals (log
  `days.meals of <date> is not valid meal data …`), and since the users release the daily photo clean-up **keeps that
  account's photos** while such a row exists (log `photo gc: kept the photos of N account(s) with unreadable meal
data`), so no photo of that day is deleted. Saving any meal of that day in the app rewrites the row and ends both
  warnings.

## Logs and status

```bash
deploy/deploy.sh logs                 # app, last 200 lines, follow (Ctrl-C to stop)
deploy/deploy.sh logs caddy
deploy/deploy.sh logs --since=2h app caddy
deploy/deploy.sh status               # containers + health, latest/previous versions, recent deploys
```

Logs are Docker `json-file`, rotated at 10 MB × 3 files per container. Caddy writes no access log; the app logs
one line per request (method, path, status, ms) and never bodies or cookies.

Log lines of the meals release worth knowing: `database schema v2 → v3: saved legko-pre-v3-… first` (once, on the
first start), `days.meals of <date> is not valid meal data …` (see
[Rollback after the meals release](#rollback-after-the-meals-release-schema-v3)).

Log lines of the users release:

- Start-up: `database schema v3 → v4: saved legko-pre-v4-… first` (once); `No accounts yet: run … create-admin
<name>` (empty database), `No admin account: run … create-admin <name>`, or `No usable admin account (no password
yet or disabled): run … reset-password-link <name>` — until the admin bootstrap is done; the AI line with the limits
  in force and their source (`per user 40, global 150; limits from defaults | env | kv.ai_limits`).
- Account events carry **ids only** (never a name, token, password or hash): `invite <id> (user) created by <user
id | cli>`, `user <id> created via invite <id> (user)`, `reset link <id> for user <id> created by <user id | cli>`,
  `reset link <id> used for user <id>` (`setup link …` for a first password), `user <id> changed their password (all
sessions revoked)`, `user <id> role set to … by …`, `links revoked: N (created by user <id>, …)`,
  `user <id> signed in without a username (legacy session)` (the pre-accounts app on anna's phone). An admin reset
  of someone's password is therefore always visible in the log (and to that person in «Акаунт»). Reminder lines are
  prefixed `user <id>:`.
- `photo gc: kept the photos of N account(s) with unreadable meal data` — that account's photos are kept until its
  bad `days.meals` row is saved again from the app.

## Limits and abuse protection

- **Login throttle** — 5 failed logins per client address in 15 minutes (an IPv6 client counts as its whole /64),
  10 failed logins per **username** in 15 minutes (also for names that do not exist), and 20 failed logins in 15
  minutes from all addresses together. Over any limit, logins answer 429 «Забагато спроб» until the oldest failure
  is 15 minutes old; a successful login clears that address's and that name's failures. An unknown name, an account
  without a password and a wrong password get the identical 401 «Неправильне імʼя або пароль» (the same hashing
  work too), so a login never tells whether a name exists; a disabled account with the right password gets 403
  «Акаунт вимкнено». Devices that are already signed in are not affected (sessions last 400 days), only new logins.
  When the overall limit is hit the app logs `WARN 20 failed logins within 15 min from all addresses: every login is
refused until they age out`. The overall counter lives in the database, so a restart or a deploy does not clear it
  (the per-address and per-name ones are in memory). To lift the overall limit at once:

  ```bash
  ssh deploy@64.176.75.160 'cd /opt/training-app && docker compose exec -T app node -e "new (require(\"node:sqlite\").DatabaseSync)(\"/data/legko.db\").prepare(\"DELETE FROM kv WHERE key = ?\").run(\"login_failures\")"'
  ```

- **Successful logins** — at most 30 per hour per username and per address (IPv6 per /64), checked before any
  hashing → 429; and at most 20 live sessions per account (a new login drops that account's least recently used
  session). Both only in production. A correct password therefore cannot be looped into unbounded work or sessions.
- **One-time links** — 10 failed link attempts per address (an IPv6 client counts as its whole /64) in 15 minutes on
  the four public link endpoints (an unusable link and a taken name count; a successful invite / reset resets it) →
  429. A token that is already being processed answers 429 to a second, concurrent request.
- **Push** — subscriptions are accepted only for the browsers' push services (Apple, Google FCM, Mozilla, Windows;
  https, default port), otherwise 400 «Цей сервіс сповіщень не підтримується»; at most 10 devices per account (the
  oldest is forgotten); the test push («Тест» in «Нагадування») 5 times per 10 minutes per account; each delivery
  has a 20 s deadline and reads at most 4 KiB of a refusal. Reminders and maintenance (backups, photo clean-up,
  purges) run as separate loops, with a 30 s budget per account in each reminder round, so one slow push service
  delays nobody else.
- **Account changes** — on «Акаунт» (password change, rename): 5 wrong current passwords per account in 15 minutes,
  and 10 attempts of any kind per account per hour → 429.
- **Password hashing** — every scrypt hash / verify (≈ 32 MiB, on libuv's thread pool, which photo file I/O shares)
  goes through one gate: at most 2 at a time and 16 waiting; beyond that the request answers 429 with
  `Retry-After: 5`. Every endpoint counts an attempt before it hashes.
- **Request size** — Caddy refuses bodies over 17 MB (`request_body` in the `Caddyfile`). The app has its own cap per
  route and answers 413 «Завеликий запит» above it: login and the public link endpoints 4 KiB, push subscription
  64 KiB, AI estimate 4 MiB (photo), sync ops and JSON import 16 MiB. Every other body is read only after the session
  check, so without a session a client can make the app read no more than the 4 KiB of a login or link request (and
  nothing once it is throttled).
- **Memory** — the app container has `mem_limit: 512m` (Node sizes its heap from it, ≈ 260 MB; a 16 MB import peaks
  at ≈ 180 MB). If it is ever exceeded, the kernel kills the app and Docker restarts it; the host keeps running.
  To check: `docker inspect --format '{{.State.OOMKilled}} restarts={{.RestartCount}}' training-app-app-1` on the server.

## Backups

- **App backups** — the server runs `VACUUM INTO /data/backups/legko-YYYY-MM-DD.db` daily at ~03:30 Kyiv time and at
  start-up if today's file is missing; the newest 30 are kept. On the host: `/opt/training-app/data/backups/`.
  They cover the database only — food photos live in `data/photos/` and are not in the JSON export either.
- **Vultr Auto Backups** — whole-VM snapshots (database, photos, certificates, `.env`); restore from the Vultr panel.
- **Off-site copy** (do it now and then) — download a backup file and the photos, or use the in-app JSON export:

  ```bash
  ssh deploy@64.176.75.160 'cd /opt/training-app && docker compose exec -T app ls -l /data/backups'
  ssh deploy@64.176.75.160 'cd /opt/training-app && docker compose exec -T app cat /data/backups/legko-2026-10-08.db' > legko-2026-10-08.db
  ssh deploy@64.176.75.160 'cd /opt/training-app && docker compose exec -T app tar -C /data -cf - photos' > legko-photos.tar
  ```

- **Manual backup** before a risky deploy:

  ```bash
  ssh deploy@64.176.75.160
  cd /opt/training-app
  docker compose exec app node -e "new (require('node:sqlite').DatabaseSync)('/data/legko.db').exec(\"VACUUM INTO '/data/manual-$(date +%F-%H%M).db'\")"
  ```

## Restore from a backup file

The easiest data-level restore is the in-app JSON import of an export: it replaces only the **signed-in account's**
records (every other account is untouched; photos are not in the export). To restore a database file (this restores
**every** account, password hash, session, invite and the VAPID keys of that moment):

```bash
ssh deploy@64.176.75.160
cd /opt/training-app
docker compose exec app ls -l /data/backups               # pick the file
docker compose stop app
docker compose run --rm --no-deps --entrypoint sh app -c '
  set -e
  mkdir -p /data/before-restore && cp /data/legko.db* /data/before-restore/
  cp /data/backups/legko-2026-10-08.db /data/legko.db
  rm -f /data/legko.db-wal /data/legko.db-shm'
docker compose start app && docker compose ps
```

A file from **before the users release** (any daily backup from before it, or `legko-pre-v4-<date>.db`) is at schema
v3: the app migrates it to v4 again on start (a new `legko-pre-v4-…` snapshot first). Anna keeps her id
(`00000000000000000000000000000001`, or the one `downgrade-schema` parked in `kv.legacy_user`), so her devices keep
their copy and unsent changes; other accounts, invites and «admin» are not in such a file — bootstrap the admin again
(`deploy/deploy.sh cli create-admin admin`) and re-invite people. A v4 file restores all accounts as they were.

Always delete `legko.db-wal` / `legko.db-shm` together with replacing `legko.db` — a stale WAL would be replayed
onto the restored file. Commands run inside the container so the files stay owned by uid 1000. `photos/` is left
as it is; photos deleted from the diary more than a day before the restore may already be gone (daily clean-up).

To restore a `.db` file from your machine, upload it into `data/` first, then use `/data/restore.db` as the source above:

```bash
ssh deploy@64.176.75.160 'cd /opt/training-app && docker compose run --rm --no-deps -T --entrypoint sh app -c "cat > /data/restore.db"' < legko-2026-10-08.db
```

## Rotating a password and the API key

Each person changes their own password in Settings → «Акаунт» (current + new; their other devices are signed out,
this one stays signed in). For someone else's account use a link (`deploy/deploy.sh cli reset-password-link <name>`
or the «Користувачі» sheet) or `deploy/deploy.sh set-password <name>` (see [Setting a password](#setting-a-password)):
every session of that account is revoked, so they log in again in the browser **and** inside the installed iPhone app
(it keeps its own cookies). Push subscriptions are not affected.

To rotate `ANTHROPIC_API_KEY`: create the new key in the Anthropic Console, replace it in `.env`,
`docker compose up -d`, check that an estimate works, then revoke the old key.

## Updating versions

- **Caddy** — change `image: caddy:…` in `deploy/compose.yaml` (read the release notes), commit, `deploy/deploy.sh`.
  Compose pulls the image and recreates Caddy; the certificate stays in `caddy_data`. To go back, revert and deploy.
- **Node patch releases / Alpine fixes** — nothing to change: the image is built `FROM node:24-alpine` with `--pull`,
  so any deploy picks them up (redeploy the current commit if there is nothing new).
- **Node major** — update both `FROM node:24-alpine` lines in `Dockerfile`, `.nvmrc`, `engines.node`
  and `@types/node`; run `pnpm typecheck && pnpm test && pnpm build && pnpm e2e` locally; deploy; check
  `deploy/deploy.sh logs`.
- **pnpm** — `ARG PNPM_VERSION` in `Dockerfile` together with `packageManager` in `package.json`.
- **Docker / OS** — as root: `apt update && apt upgrade` (unattended upgrades handle security updates and the
  02:00 UTC reboot); containers restart on their own.

## Troubleshooting

| Symptom                                                   | Look at                                                                                                                                   |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| deploy fails at "not healthy"                             | the printed app logs; `deploy/deploy.sh rollback`, fix, deploy again                                                                      |
| rollback: "schema v4 is newer"                            | `deploy.sh status`, then `downgrade-schema --keep anna` first (Rollback after the users release)                                          |
| rollback: "schema v3 is newer"                            | run `downgrade-schema` first (Rollback after the meals release)                                                                           |
| `photo gc: kept the photos of N account(s) …` every night | a day with unreadable `days.meals`: that person opens and saves the day's meal                                                            |
| site answers 502                                          | `deploy/deploy.sh status`, `deploy/deploy.sh logs`                                                                                        |
| "data is not writable by uid 1000"                        | run the printed `chown` as root once                                                                                                      |
| certificate / HTTPS errors                                | `deploy/deploy.sh logs caddy`; DNS A record; ports 80/443 open in ufw                                                                     |
| login says «Неправильне імʼя або пароль»                  | wrong name or password (the answer never says which); a password link: `deploy/deploy.sh cli reset-password-link <name>` or «Користувачі» |
| nobody can manage accounts                                | no usable admin (the start-up log says so) → `deploy/deploy.sh cli create-admin admin`, or `cli reset-password-link admin`                |
| setup / reset link «вже використали»                      | someone used it first: `cli revoke-links --all`, `cli reset-password-link admin`, `cli list-users` (Accounts and the admin, step 4)       |
| setup link opens the old app (no «Створення пароля»)      | the browser still ran the pre-users version: reload the page once, open the same link again (still valid), or use a private window        |
| login says «Акаунт вимкнено»                              | an admin disabled the account: «Користувачі» → the account → «Увімкнути акаунт»                                                           |
| login says «Забагато спроб»                               | too many failed logins: wait 15 min (see Limits and abuse protection)                                                                     |
| app restarts on its own                                   | killed for memory? `OOMKilled` check in Limits and abuse protection                                                                       |
| no «Порахувати» / «Фото» buttons                          | `ANTHROPIC_API_KEY` missing in `.env` (or not applied with `up -d`)                                                                       |
| AI estimates keep failing                                 | `deploy/deploy.sh logs` → `food estimate failed: …` / `key rejected`                                                                      |
| disk filling up                                           | `docker system df` on the server; deploys prune old images and cache                                                                      |

## Other projects on this server

Caddy (in this stack) is the only thing listening on 80/443, and it serves other projects too:

- **Names on `edge` must be unique and project-prefixed.** Every compose service name and network alias is a DNS
  name on each network the container joins, and Caddy resolves upstream names across all its networks. A generic name
  (`app`, `web`, `api`, `db`, `caddy`) on `edge` hijacks another project's upstream — on 2026-10-09 a second project's
  service called `app` took over `reverse_proxy app:3000` and fit.triple-a.dev timed out for ~3 minutes. «Легко» is
  reached only as `legko-app` (an alias on its private network); other projects use e.g. `<project>-app`.
- Each project lives in its own directory (e.g. `/opt/<project>`, owner `deploy`) with its own compose project.
- Its web container joins the external Docker network **`edge`** (`networks: { edge: { external: true } }`)
  and **publishes no ports** (published ports bypass ufw). Give it a fixed `container_name` or use the service
  DNS name on `edge`.
- Its site block goes into **`/opt/caddy-sites/<project>.caddy`** (mounted read-only into Caddy and imported
  at the end of this repo's Caddyfile). It may use `import security_headers`. Validate and apply:

```bash
ssh deploy@64.176.75.160 'docker exec training-app-caddy-1 caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile && docker exec training-app-caddy-1 caddy reload --config /etc/caddy/Caddyfile --adapter caddyfile'
```

- Never edit `/opt/training-app/Caddyfile` or `compose.yaml` on the server: `deploy/deploy.sh` overwrites them.
- The `edge` network and `/opt/caddy-sites` are created once (the deploy script checks both).

## Rebrand to «Home Fit» (iPhone note)

The product name and icons changed from «Легко» to «Home Fit» (manifest, title, logo «HF» under a roof).
Internal identifiers (`@legko/*`, `legko.db`, cookies, IndexedDB/localStorage keys, `X-Legko-User`) are unchanged,
so nobody is signed out. iOS keeps the old home-screen icon and name until the app is removed from the home screen
and added again (Safari → Поділитися → На початковий екран); the data lives on the server and stays.
