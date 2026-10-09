# Deploying «Легко»

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
│  │ caddy:2.11.7-alpine         │  app:3000        │ training-app:latest (built here)      │    │
│  │ publishes 80, 443, 443/udp  │ ───────────────► │ node 24 · uid 1000 · read-only rootfs │    │
│  │ TLS (Let's Encrypt), HSTS,  │  docker network  │ API /api/* + static PWA + Web Push    │    │
│  │ gzip/zstd                   │                  │ no published ports                    │    │
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
    photos/<id>.jpg  <id>_t.jpg    food photo diary (full + thumbnail)
  deploys.log                      one line per deploy / rollback (UTC)
```

Images: `training-app:latest` (running) and `training-app:previous` (what ran before the last deploy).
Both containers use `restart: unless-stopped`, so they come back after the 02:00 UTC update reboots.
Only Caddy publishes ports — Docker-published ports bypass ufw, so the app must never get a `ports:` entry.

### `.env` (secrets and overrides)

`/opt/training-app/.env` is read by the app container if it exists; the file is optional for the stack to start.
`PUBLIC_ORIGIN` is set in `compose.yaml`; everything else has a default.

| Variable                                 | Purpose                                                                    |
| ---------------------------------------- | -------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY`                      | enables the AI calorie estimate (text / photo); without it the UI hides it |
| `FOOD_AI_MODEL`                          | optional model override for the estimate (default `claude-opus-5-5`)       |
| `FOOD_DAILY_LIMIT`                       | estimates allowed per day (default `60`; `0` switches estimates off)       |
| `LOG_LEVEL`                              | `debug`, `info` (default), `warn`, `error` or `silent`                     |
| `VAPID_SUBJECT`                          | Web Push contact (`https:` URL or `mailto:`), default `PUBLIC_ORIGIN`      |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | only to pin keys; by default they are generated once and kept in the DB    |

Edit it on the server (the key never goes into git, chat or shell history), then apply:

```bash
ssh -t deploy@64.176.75.160 'umask 077 && nano /opt/training-app/.env'      # e.g. ANTHROPIC_API_KEY=sk-ant-…
ssh deploy@64.176.75.160 'cd /opt/training-app && docker compose up -d'      # recreates the app with the new env
```

`docker compose config` (without `--quiet`) prints values from `.env` — don't paste its output anywhere.
Changing the VAPID keys invalidates every push subscription (notifications must be re-enabled on the phone).
The app password is **not** an env variable — it lives in the database (see below).

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
3. Set the password (next section).
4. Put `ANTHROPIC_API_KEY` into `.env` and apply it (see [`.env`](#env-secrets-and-overrides)); until then the
   AI calorie estimate is simply hidden.
5. Open https://fit.triple-a.dev, log in, complete the first-run setup. On the iPhone: Safari → Share →
   «На початковий екран», open the installed app, log in there and enable notifications.
6. Optional clean-up of the placeholder: `ssh deploy@64.176.75.160 'rm -rf /opt/training-app/placeholder'`.

## Setting the app password

```bash
ssh -t deploy@64.176.75.160 'cd /opt/training-app && docker compose exec app node /app/server/cli.js set-password'
# same thing: deploy/deploy.sh set-password
```

It asks twice with hidden input, stores a scrypt hash in the database and **revokes all sessions**.
For scripting, `set-password --stdin` reads the password from one line of stdin (use `docker compose exec -T`).

## AI calorie estimate

- **Off until `ANTHROPIC_API_KEY` is in `.env`** (then `docker compose up -d`). Without it `GET /api/food/status`
  answers `enabled: false` and the UI hides «✨ Порахувати» / «📷 Фото». The start-up log says which:
  `AI calorie estimate enabled (model claude-opus-5-5, 60 per day)` or `… disabled (…)`.
- The app container calls the Anthropic API (outbound HTTPS) with Claude Opus 5.5 (`FOOD_AI_MODEL`): structured JSON
  output, effort `low`, server-side refusal fallback; 60 s timeout, one retry. An estimate usually takes 5–20 s.
- **Cost guard:** at most `FOOD_DAILY_LIMIT` model calls (default 60) per day in the user's time zone; the counter is
  in the database (survives restarts). Over the limit → «Ліміт підрахунків на сьогодні вичерпано» until midnight.
- **Photos** arrive with the estimate (downscaled JPEG + thumbnail, made on the phone) and are stored in
  `data/photos/` before the model is called. Photos that no day references 24 h later are deleted daily at ~03:40
  Kyiv time (log line `photo gc: …`).
- **Logs** never contain the description, the photo or the key. A failed estimate logs one line such as
  `food estimate failed: HTTP 529 overloaded_error: …`, `request timed out` or `refusal (category: …)`; a rejected
  key logs `Anthropic key rejected (HTTP 401): check ANTHROPIC_API_KEY` once, and estimates answer 503 until the key
  is replaced (see [Rotating](#rotating-the-password-and-the-api-key)).

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

## Logs and status

```bash
deploy/deploy.sh logs                 # app, last 200 lines, follow (Ctrl-C to stop)
deploy/deploy.sh logs caddy
deploy/deploy.sh logs --since=2h app caddy
deploy/deploy.sh status               # containers + health, latest/previous versions, recent deploys
```

Logs are Docker `json-file`, rotated at 10 MB × 3 files per container. Caddy writes no access log; the app logs
one line per request (method, path, status, ms) and never bodies or cookies.

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

The easiest data-level restore is the in-app JSON import of an export (it replaces everything). To restore a
database file (this also restores the password hash, sessions and VAPID keys of that moment):

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

Always delete `legko.db-wal` / `legko.db-shm` together with replacing `legko.db` — a stale WAL would be replayed
onto the restored file. Commands run inside the container so the files stay owned by uid 1000. `photos/` is left
as it is; photos deleted from the diary more than a day before the restore may already be gone (daily clean-up).

To restore a `.db` file from your machine, upload it into `data/` first, then use `/data/restore.db` as the source above:

```bash
ssh deploy@64.176.75.160 'cd /opt/training-app && docker compose run --rm --no-deps -T --entrypoint sh app -c "cat > /data/restore.db"' < legko-2026-10-08.db
```

## Rotating the password and the API key

Run the same `set-password` command. Every session is revoked, so log in again in the browser **and** inside the
installed iPhone app (it keeps its own cookies). Push subscriptions are not affected.

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

| Symptom                            | Look at                                                                  |
| ---------------------------------- | ------------------------------------------------------------------------ |
| deploy fails at "not healthy"      | the printed app logs; `deploy/deploy.sh rollback`, fix, deploy again     |
| site answers 502                   | `deploy/deploy.sh status`, `deploy/deploy.sh logs`                       |
| "data is not writable by uid 1000" | run the printed `chown` as root once                                     |
| certificate / HTTPS errors         | `deploy/deploy.sh logs caddy`; DNS A record; ports 80/443 open in ufw    |
| login always fails                 | password not set yet → `deploy/deploy.sh set-password` (the log says so) |
| no «Порахувати» / «Фото» buttons   | `ANTHROPIC_API_KEY` missing in `.env` (or not applied with `up -d`)      |
| AI estimates keep failing          | `deploy/deploy.sh logs` → `food estimate failed: …` / `key rejected`     |
| disk filling up                    | `docker system df` on the server; deploys prune old images and cache     |
