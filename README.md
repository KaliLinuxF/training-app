# Легко

A personal weight-loss tracker for one person: a mobile-first PWA with a Ukrainian UI, installed on an iPhone home
screen and also used on desktop. Production: **https://fit.triple-a.dev**.

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
- Single-password login, first-run setup, light / dark / auto theme, custom workout types, JSON export / import,
  offline queue with sync.

## Stack

| Package                           | What                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `packages/shared` `@legko/shared` | types, zod schemas, the ops reducer, date/format helpers, HTTP API contract (TS source, no build)            |
| `apps/server` `@legko/server`     | Node 24, Hono, `node:sqlite` (WAL), web-push, Anthropic SDK; esbuild bundles `dist/index.js` + `dist/cli.js` |
| `apps/web` `@legko/web`           | React 19, Vite 8, TypeScript, CSS Modules, zustand, wouter, vite-plugin-pwa (injectManifest)                 |

Tests: Vitest (unit) and Playwright (WebKit iPhone + Chromium desktop). Production: one `node:24-alpine` container
behind Caddy on a VPS — see [docs/DEPLOY.md](docs/DEPLOY.md).

## Local development

Requires Node ≥ 24 (see `.nvmrc`) and pnpm 9 (`npm i -g pnpm@9.15.9`).

```bash
pnpm i
printf 'DEV_PASSWORD=%s\n' 'pick-a-local-password' > apps/server/.env   # local login password
pnpm dev
```

- Web: http://localhost:5173 (Vite, proxies `/api` to the server)
- API: http://localhost:3000 (`tsx watch`, data in `apps/server/data/`)

`DEV_PASSWORD` is only honoured outside production and only while no password is stored yet; change it later with
`pnpm --filter @legko/server set-password`, or delete `apps/server/data/` to start from scratch.
`apps/server/.env.example` documents every setting. To try the AI
calorie estimate locally, add your own `ANTHROPIC_API_KEY=…` to `apps/server/.env` (without it the feature is
hidden). Never commit `.env` files, keys or local databases.

To try the production image locally:

```bash
docker build -t legko:local .
docker run -d --name legko-local -p 3000:3000 -v legko-data:/data -e PUBLIC_ORIGIN=http://localhost:3000 legko:local
docker exec -it legko-local node /app/server/cli.js set-password   # then open http://localhost:3000
```

## Scripts

| Command                          | Does                                                                         |
| -------------------------------- | ---------------------------------------------------------------------------- |
| `pnpm dev`                       | server and web in watch mode                                                 |
| `pnpm typecheck`                 | `tsc` in every package                                                       |
| `pnpm lint`                      | ESLint over the repo                                                         |
| `pnpm test`                      | Vitest in every package                                                      |
| `pnpm build`                     | `apps/web/dist` (static PWA) and `apps/server/dist` (bundled server + CLI)   |
| `pnpm e2e`                       | Playwright against the built app (run `pnpm build` first)                    |
| `pnpm format`                    | Prettier                                                                     |
| `pnpm --filter @legko/web icons` | regenerate the PWA icons                                                     |
| `deploy/deploy.sh`               | deploy the committed `HEAD` to production ([docs/DEPLOY.md](docs/DEPLOY.md)) |

Playwright needs its browsers once: `pnpm exec playwright install chromium webkit`.

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
- [docs/DEPLOY.md](docs/DEPLOY.md) — server layout, deploys, rollback, logs, backups and restore, password, upgrades.

## Design

The UI recreates the Claude Design prototypes in `design/handoff/` — `Tracker.dc.html` (all screens) and
`Design Options.dc.html`, variant **1b «Свіжість»** (Manrope, lavender accent + mint, light and dark themes).
The bundle is a read-only reference: read its HTML/CSS/JS for exact values; it is not built or served.
