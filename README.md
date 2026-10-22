# Легко

A personal weight-loss tracker for a few people, each with their own account and completely separate data: a
mobile-first PWA with a Ukrainian UI, installed on an iPhone home screen and also used on desktop. Production:
**https://fit.triple-a.dev**.

## Features

- **Calendar** — month grid; every day is its own record: food (free text), calories, workout yes/no (with an explicit
  «Тренування не було»), workout types, notes. Filled days, workouts, weigh-ins and measurements are marked.
- **History** — everything is kept forever; any past day can be reopened.
- **Weekly weigh-in** — start, latest, lost, left to goal, dynamics for week / month / all time.
- **Body measurements** — chest, waist, hips, with the change since the first values («Талія: 74 → 70 см = −4 см»).
- **Reminders** — workout (weekdays + time), weigh-in and measurements, delivered as real Web Push notifications on
  the iPhone even when the app is closed (installed PWA, iOS ≥ 16.4).
- **«Мій прогрес»** — weight, measurement, workout and nutrition statistics with charts.
- **Summaries** for a week, month, 3 months or all time.
- **Home** — current numbers, next weigh-in / measurements and quick «+ Харчування / + Тренування / + Вага / + Заміри».
- **AI calorie estimate** — describe a meal in plain words or snap a photo of the plate and get an itemised kcal
  estimate (Claude, server-side); photos stay in the day's food photo diary; «Часті страви» for one-tap repeats.
- **Accounts** — username + password; new people join only through a one-time invite link from an admin; every
  account's records, settings, photos, reminders, AI estimates and backups are its own. Settings → «Акаунт» (name,
  password, «Вийти»); admins also get «Користувачі» (invites, password links, roles, disable / delete, AI limits).
  Plan: [docs/multi-user.md](docs/multi-user.md).
- First-run setup, light / dark / auto theme, custom workout types, JSON export / import (your own data), offline
  queue with sync.

## Stack

| Package                           | What                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/shared` `@legko/shared` | types, zod schemas, the ops reducer, date/format helpers, HTTP API contract (TS source, no build)            |
| `apps/server` `@legko/server`     | Node 24, Hono, `node:sqlite` (WAL), web-push, Anthropic SDK; esbuild bundles `dist/index.js` + `dist/cli.js` |
| `apps/web` `@legko/web`           | React 19, Vite 8, TypeScript, CSS Modules, zustand, wouter, vite-plugin-pwa (injectManifest)                 |

Tests: Vitest (unit) and Playwright (the system Chrome as an iPhone and as a desktop browser, see
[e2e/README.md](e2e/README.md)). Production: one `node:24-alpine` container behind Caddy on a VPS — see
[docs/DEPLOY.md](docs/DEPLOY.md).

## Local development

Requires Node ≥ 24 (see `.nvmrc`) and pnpm 9 (`npm i -g pnpm@9.15.9`).

```bash
pnpm i
cp apps/server/.env.example apps/server/.env    # local settings, incl. the two dev accounts below
pnpm dev
```

- Web: http://localhost:5173 (Vite, proxies `/api` to the server)
- API: http://localhost:3000 (`tsx watch`, data in `apps/server/data/`)

**Dev logins** (development only, `NODE_ENV` ≠ production): at start-up the server creates the missing accounts
**`anna`** (an ordinary user, the account the pre-accounts data belongs to) with `DEV_PASSWORD`, and **`admin`**
(the admin) with `DEV_ADMIN_PASSWORD` — names from `DEV_USERNAME` / `DEV_ADMIN_USERNAME`. A password is set only
while that account has none; change it later with `pnpm --filter @legko/server cli set-password anna`, or delete
`apps/server/data/` to start from scratch. Other local accounts: sign in as `admin` → Settings → «Користувачі» →
«Створити запрошення», open the link in another browser profile. `apps/server/.env.example` documents every
setting. To try the AI calorie estimate locally, add your own `ANTHROPIC_API_KEY=…` to `apps/server/.env` (without
it the feature is hidden). Never commit `.env` files, keys or local databases.

### Server CLI

`pnpm --filter @legko/server cli <command>` in development; `node /app/server/cli.js <command>` in the image
(`deploy/deploy.sh cli <command>` in production). Links are printed with `PUBLIC_ORIGIN` (locally: the one in
`apps/server/.env`); passwords are only ever typed into hidden prompts or the browser.

| Command                                            | Does                                                                                       |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `create-admin <username>`                          | an admin **without** a password + a one-time setup link (24 h) to choose it in the browser |
| `create-invite [--admin] [--note <text>]`          | a one-time invite link (7 days; role user, admin with `--admin`)                           |
| `reset-password-link <username>`                   | a one-time password link (24 h; a setup link when the account has no password yet)         |
| `set-password <username> [--stdin]`                | sets the password (hidden prompt twice); signs that account out everywhere                 |
| `set-role <username> <admin\|user>`                | never removes the last usable admin                                                        |
| `rename-user <old> <new>`                          | sessions are kept                                                                          |
| `list-users` / `list-links`                        | accounts (role, status, activity, AI today) / pending invite and password links            |
| `revoke-links --by <username> \| --all`            | revokes pending links that account created, or all of them                                 |
| `downgrade-schema [--keep <user>] [--drop-others]` | rollback helper, app stopped (docs/DEPLOY.md «Rollback after the users release»)           |

To try the production image locally:

```bash
docker build -t legko:local .
docker run -d --name legko-local -p 3000:3000 -v legko-data:/data -e PUBLIC_ORIGIN=http://localhost:3000 legko:local
docker exec -it legko-local node /app/server/cli.js create-admin admin   # open the printed link, choose the password
```

## Scripts

| Command                          | Does                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                       | server and web in watch mode                                                 |
| `pnpm typecheck`                 | `tsc` in every package                                                       |
| `pnpm lint`                      | ESLint over the repo                                                         |
| `pnpm test`                      | Vitest in every package                                                      |
| `pnpm build`                     | `apps/web/dist` (static PWA) and `apps/server/dist` (bundled server + CLI)   |
| `pnpm e2e`                       | builds everything, then the Playwright suite (`e2e/README.md`)               |
| `pnpm format`                    | Prettier                                                                     |
| `pnpm --filter @legko/web icons` | regenerate the PWA icons                                                     |
| `deploy/deploy.sh`               | deploy the committed `HEAD` to production ([docs/DEPLOY.md](docs/DEPLOY.md)) |

Playwright uses the installed Chrome (or Edge): nothing to download.

## Repository layout

```
apps/server/      API, reminder scheduler, Web Push, SQLite storage + backups, static hosting, CLI
apps/web/         the PWA (screens, sheets, UI kit, stores, service worker)
packages/shared/  contracts shared by server and web
e2e/              Playwright tests
deploy/           compose.yaml, Caddyfile, deploy.sh (+ remote.sh, its server half)
docs/             SPEC.md (engineering spec), DEPLOY.md (operations)
design/handoff/   Claude Design bundle: the visual source of truth (read-only)
Dockerfile        multi-stage build → node:24-alpine runtime serving API + PWA on :3000
```

## Docs

- [docs/SPEC.md](docs/SPEC.md) — the binding engineering spec: product requirements, design rules, architecture,
  data model, API, statistics semantics, conventions.
- [docs/DEPLOY.md](docs/DEPLOY.md) — server layout, deploys, rollback, logs, backups and restore, accounts and the
  admin bootstrap, passwords, upgrades.
- [docs/multi-user.md](docs/multi-user.md) — the accounts plan (data model v4, sessions and links, per-user
  isolation, client storage, UX).

## Design

The UI recreates the Claude Design prototypes in `design/handoff/` — `Tracker.dc.html` (all screens) and
`Design Options.dc.html`, variant **1b «Свіжість»** (Manrope, lavender accent + mint, light and dark themes).
The bundle is a read-only reference: read its HTML/CSS/JS for exact values; it is not built or served.
