# «Легко» — personal weight-loss tracker · Engineering spec

Single source of truth for everyone working on this repo. Read it fully before touching code.

## 1. Product

A mobile-first PWA for **one person** (Ukrainian UI) who tracks nutrition, workouts, weight and body
measurements while losing weight. It is installed on an **iPhone** home screen and also used on desktop.
Server: one Docker container on a VPS behind Caddy at `https://fit.triple-a.dev`.

### 1.1 Requirements (all mandatory)

1. **Calendar** — month grid; every day opens on its own. Per day she records:
   what she ate (free text) · calories for the day · workout yes/no (explicit «Тренування не було» state) ·
   workout type(s) (upper body, lower body, cardio, abs, …) · optional notes.
2. **History** — everything is stored forever; any past day can be reopened to see food, kcal, workout,
   type, weight, measurements, notes.
3. **Control weigh-in** — once a week (reminded). Records date + kg (e.g. «10.10.2026 — 65,4 кг»).
   App shows automatically: start weight, latest weight, difference, kg lost, dynamics for week / month / all time.
4. **Body measurements** — once a week (reminded): chest, waist, hips (cm). All kept. Shows change from the
   first values, e.g. «Талія: 74 → 70 см = −4 см».
5. **Reminders** — workout reminder (chosen weekdays + time), weekly weigh-in reminder, weekly measurements
   reminder; she chooses day and time for each. Must arrive as **real push notifications on the iPhone even
   when the app is closed** (Web Push from the server).
6. **«Мій прогрес»** — auto statistics from daily records:
   - Weight: start, current, goal, lost, left to goal, chart.
   - Measurements: start and current chest/waist/hips, difference in cm, chart per parameter.
   - Workouts: total, per week, per month, most frequent types.
   - Nutrition: kcal per day, average per week, average per month, browsable kcal history.
7. **Automatic summary** for a selectable period — week / month / 3 months / all time — e.g.
   «Цього тижня: тренувань 4 · середня калорійність 1650 ккал · вага −0,4 кг · талія −1 см · стегна −0,5 см».
8. **Daily record** — each day stays as its own record; the calendar visually shows whether a day is filled,
   whether there was a workout and whether the required actions (weigh-in / measurements) were done.
9. **Home** — current weight, lost since start, left to goal, current measurements, workouts this week,
   average kcal, last weigh-in, next planned weigh-in, next measurements; quick buttons
   «+ Харчування / + Тренування / + Вага / + Заміри».
10. **Ease of use** — phone first, minimal typing, big tap targets: ✅/❌ workout, food, kcal, weight,
    measurements, notes — all quick.

Additions we make on top of the design (keep them in the same visual language):
login screen (single password), first-run setup sheet (start weight, goal weight, kcal goal),
«Додай на початковий екран» guidance for iPhone push, test notification, custom workout types,
theme switch (auto/light/dark), JSON export/import backup, offline queue with sync,
**AI calorie estimate from a text description or a food photo + food photo diary + «Часті страви»** (§3.7).

## 2. Design

**Source of truth:** `design/handoff/Tracker.dc.html` (all screens, markup + logic in the `<script>` at the
bottom) and `design/handoff/Design Options.dc.html` (variants). We build **variant 1b «Свіжість»**
(section `id="1b"` in Design Options): Manrope, round shapes, cool whites, lavender accent + mint secondary,
light **and** dark theme, calendar marks mode **«Заливка»** (fill).

- Do **not** render the prototypes; read the HTML/CSS/JS. Recreate the visual output **pixel-perfectly**:
  same spacing, font sizes/weights, letter-spacing, radii, colours, borders, layout grids, copy.
- Tokens live in `apps/web/src/styles/tokens.css` with the **same names as the prototype variables**
  (`--ink`, `--paper`, `--card`, `--acc`, `--accT`, `--acc2D`, `--r24`, …). Always use the tokens, never
  hard-code colours. Prototype fallbacks like `var(--acc,oklch(…38))` refer to variant 1a — ignore the
  fallback, the token value is what counts.
- 1b radius scale: `--r28 32px · --r24 28px · --r20 24px · --r18 18px · --r16 18px · --r14 16px · --r12 12px`.
- Font: `Manrope Variable` (self-hosted via `@fontsource-variable/manrope`, already imported in `main.tsx`).
  `--display` = `--font` in 1b. Numbers use `font-variant-numeric: tabular-nums` (set on body).
- Layout (from the prototype's `renderVals`):
  - **Mobile** (< 900px, `useIsDesktop()` false): column `max-width: 440px`, centered, padding
    `20px 18px 120px`; floating glass tab bar at the bottom (5 slots: Головна · Календар · **+** · Прогрес ·
    Нагадування); sheets slide up from the bottom (`max-width 440px`, top radius `--r28`).
  - **Desktop** (≥ 900px): container `max-width 1280px`; left sidebar 248px (logo «Л Легко», nav, «+ Записати день»);
    main padding `32px 36px 48px`; content grid `repeat(2, minmax(0,1fr))` with `gap 14px` (full-width rows use
    `grid-column: 1/-1`); quick buttons in 4 columns; sheets are centered modals (`max-width 560px`, all radii `--r28`).
- iPhone: respect safe areas (`--safe-top`, `--safe-bottom` tokens): the tab bar sits `14px + safe-bottom` from
  the bottom; screens get `safe-top` extra top padding; the sheet footer gets `safe-bottom`. Inputs ≥ 16px font
  (no zoom). Tap targets ≥ 44px. `apple-mobile-web-app-status-bar-style=default` + `theme-color` metas = paper colour.
- Motion (not in the prototype, keep it subtle): sheet slides up 280ms `--ease-out` + backdrop fade; toast fades/slides;
  switch knob slides; buttons get a gentle `:active` scale(0.98). Everything honours `prefers-reduced-motion`.
- Copy is Ukrainian, exactly as in the prototype where it exists. Typographic minus `−` for negatives, comma decimals.
- Dark mode: tokens switch automatically (system) unless the user forces a theme (`data-theme` on `<html>`).
- Deliberate deviations (decided after review): the calendar legend in fill mode shows small tinted squares
  that look like the filled cells (the prototype's legend is static dots); the desktop shell needs
  `(min-width: 900px) and (hover: hover) and (pointer: fine)` so a phone in landscape keeps the mobile shell;
  every confirmation uses the in-app `ui.confirm()` dialog (never `window.confirm`, which looks foreign in the
  standalone iPhone app); month ‹ › in the calendar only change the shown month (selection stays, as in the prototype).

## 3. Architecture

```
packages/shared   @legko/shared  — types, zod schemas, ops reducer, dates/format helpers, API contract (TS source, no build)
apps/server       @legko/server  — Node 24 + Hono + node:sqlite + web-push; bundled by esbuild into dist/ (single file, no node_modules at runtime)
apps/web          @legko/web     — React 19 + Vite 8 + TypeScript + CSS Modules + zustand + wouter + vite-plugin-pwa (injectManifest)
e2e/              Playwright (WebKit iPhone + Chromium desktop) against the built app served by the server
deploy/           compose.yaml, Caddyfile, deploy.sh (build on the VPS)
Dockerfile        multi-stage: build web + server → node:24-alpine runtime serving API + static files on :3000
docs/             SPEC.md (this), DEPLOY.md
design/handoff/   Claude Design bundle (read-only reference)
```

Package manager: **pnpm 9** workspaces (`pnpm -r typecheck | test | build`, `pnpm lint`). Node ≥ 24.
Do **not** add dependencies casually; everything planned is already installed. If you truly need one,
say so in your report instead of installing (parallel installs corrupt the lockfile).

### 3.1 Data model & changes

See `packages/shared/src/types.ts`. `AppData = { days: Record<date, DayEntry>, weights[], measures[], settings }`.
Dates are local `YYYY-MM-DD`. Every change is an **op** (`packages/shared/src/schemas.ts → opSchema`):
`day.put | day.delete | weight.put | weight.delete | measure.put | measure.delete | settings.put`.
Ops are idempotent upserts keyed by date. Semantics are defined by `applyOp()` in `packages/shared/src/ops.ts`
(empty day → delete; measure with no values → delete; workout types dropped unless `trained === true`; text trimmed).
The server must persist **exactly** the same semantics.

### 3.2 HTTP API

Contract: `packages/shared/src/api.ts` (paths, bodies, responses, error codes) and request schemas in
`schemas.ts`. Client wrapper: `apps/web/src/lib/api.ts`.

- Auth: single password. `POST /api/auth/login` sets cookie `sid` (HttpOnly, SameSite=Lax, Path=/, Secure in
  production, Max-Age 400 days, sliding renewal). Sessions are random 32-byte tokens; only their SHA-256 is stored.
  Login rate limit: 5 failures / 15 min per IP (trust `X-Forwarded-For` only from the proxy) → 429 `rate_limited`.
  Password hash: scrypt (`node:crypto`), stored in the DB (`kv` table). Set via CLI (see 3.4). No password set →
  login always fails with `bad_password` and the server logs a hint.
- Mutating requests (`POST`) require `Content-Type: application/json` and an `Origin` that matches the request
  host (or `PUBLIC_ORIGIN` / dev origins) → otherwise 403 `forbidden_origin`.
- `POST /api/ops` validates each op with `opSchema`; on the first invalid op → 400 `invalid_op` with `index`
  and nothing applied; otherwise all ops applied in one transaction, in order.
- `GET /api/export` → `Content-Disposition: attachment; filename="legko-YYYY-MM-DD.json"`, body = AppData.
  `POST /api/import` validates with `appDataSchema` and replaces everything in one transaction.
- Errors always `{ error, message }` JSON (see `ErrorResponse`). Unknown `/api/*` → 404 JSON.

### 3.3 Reminders & push (server)

- VAPID keys generated on first start and stored in `kv` (unless `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env given).
  Subject `VAPID_SUBJECT` (default `PUBLIC_ORIGIN`, e.g. `https://fit.triple-a.dev`).
- `push_subscriptions(endpoint PK, p256dh, auth, user_agent, created_at, last_ok_at)`. Delete on 404/410 from the push service.
- Scheduler ticks every 30 s. Uses `settings.timezone`. For each enabled reminder whose scheduled time **today**
  (weekday matches) is ≤ now < scheduled + 15 min and which was not sent yet today (`reminder_log(kind, date)` unique)
  → send to all subscriptions, then log it. Skip (but still log as handled) when the action is already done that day:
  weigh → a weight exists for today; measure → measurements exist for today; workout → `days[today].trained !== null`.
- Notification payload (JSON for the SW): `{ title, body, url, tag }`. Copy:
  - workout: «Час тренування 💪» / «Не забудь відмітити, як пройшло» → url `DEEP_LINKS.workout`
  - weigh: «Контрольне зважування ⚖️» / «Найточніше — зранку, натщесерце» → `DEEP_LINKS.weigh`
  - measure: «Час замірів 📏» / «Груди, талія, стегна — займе хвилину» → `DEEP_LINKS.measure`
  - test: «Легко» / «Сповіщення працюють ✨» → `/reminders`
- The server box reboots for updates at 02:00 UTC; nothing else to do about it (15-min catch-up window covers restarts).

### 3.4 Server runtime

Env: `PORT` (3000) · `DATA_DIR` (`/data`, dev `./data`) · `STATIC_DIR` (dir with the built web app; unset in dev) ·
`PUBLIC_ORIGIN` (`https://fit.triple-a.dev`) · `NODE_ENV` · `TRUST_PROXY` (`1` behind Caddy) ·
`VAPID_SUBJECT` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (optional) · `LOG_LEVEL`.
- SQLite file `${DATA_DIR}/legko.db`, WAL mode, `PRAGMA user_version` migrations.
- Daily backup `VACUUM INTO ${DATA_DIR}/backups/legko-YYYY-MM-DD.db` at ~03:30 Kyiv time and at start-up if today's is
  missing; keep the newest 30.
- Static: hashed assets `Cache-Control: public, max-age=31536000, immutable`; `index.html`, `sw.js`,
  `manifest.webmanifest` → `no-cache`; SPA fallback to `index.html` for non-`/api` GETs.
  Security headers incl. a CSP (`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
  font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none';
  base-uri 'self'; form-action 'self'`).
- CLI (bundled `dist/cli.js`): `node dist/cli.js set-password` (prompts twice, hidden input; or `--stdin`) — writes the
  hash and **revokes all sessions**. `GET /api/health` is unauthenticated (used by the Docker healthcheck).
- Logs: one line per request (method, path, status, ms) without bodies or cookies.

### 3.5 Web app

- Entry: `main.tsx` → `App.tsx` = `AuthGate` → `AppShell` → routes (`/`, `/calendar?date=YYYY-MM-DD`, `/progress`,
  `/reminders`). These files and the stubs' exported names are the contract between tasks.
- **Data**: `apps/web/src/store/data.ts` — `useAppData()`, `useSettings()`, `useSyncState()`, `dataActions.*`,
  `startSync()`. Screens never call the API for data directly.
  Implementation: zustand state; device cache in IndexedDB (`idb-keyval`: keys `legko.data`, `legko.outbox`);
  every action → `applyOp` locally (instant UI) → persist → append to outbox → flush (`POST /api/ops`, batched,
  in order). Flush on: change, `online`, app foreground, every 30 s while pending. Network/5xx errors → keep and retry
  with backoff; 400 `invalid_op` → drop that op (log, surface `sync.error`); 401 → auth state `anon`.
  Start-up: render from IndexedDB instantly, then `GET /api/data`, then re-apply still-pending outbox ops on top.
  Refresh from the server when the app returns to the foreground, on focus, and every 60 s while visible
  (if nothing pending). Saves send only the parts of a record that actually changed (two devices must not
  erase each other's weigh-ins). `settings.timezone` follows the phone that receives reminders (sent with the
  push subscription, canonicalised), not whichever browser opened the app last.
- **UI state**: `apps/web/src/store/ui.ts` — `ui.openSheet(date, mode, patch?)`, `ui.closeSheet()`, `ui.flash(text)`.
- **Today**: `useToday()` (`lib/useToday.ts`). Weeks start on Monday (`mondayOf`).
- **Platform**: `lib/platform.ts` (`isIOS`, `isStandalone`, `useIsDesktop`). **Theme**: `lib/theme.ts`.
- **Push client**: `lib/push.ts` contract (`getPushStatus`, `enablePush`, `disablePush`, `syncPushSubscription`,
  `sendTestPush`). On iPhone, push works only in the installed app (iOS ≥ 16.4) → status `needs-install`.
- **Deep links**: `/?sheet=day&trained=1`, `/?sheet=weight`, `/?sheet=measure` open that sheet for today and
  clean the URL (handled by `SheetHost`). Notification clicks focus an open window and navigate it.
- **PWA**: `vite-plugin-pwa` `injectManifest` with `src/sw.ts` (precache app shell, SPA navigation fallback
  excluding `/api/`, never cache `/api/`, push + notificationclick handlers, `skipWaiting` + `clientsClaim`).
  Manifest: name «Легко — трекер схуднення», short_name «Легко», lang `uk`, display `standalone`, start_url `/`,
  background/theme `#F3F5F8`, icons 192/512/maskable 512 + `apple-touch-icon.png` 180 (logo: «Л» in Manrope 700 on
  `--solid #1E2229`, rounded square like the sidebar logo).
- **Styling**: CSS Modules (`*.module.css`) next to components + tokens. No inline style objects except for truly
  dynamic values (chart geometry, bar heights, computed colours). No CSS-in-JS libraries.
- **UI kit** (`apps/web/src/ui`): shared primitives extracted from the prototype — use them in all screens.
- **Stats** (`apps/web/src/lib/stats.ts`): pure functions porting the prototype's `renderVals` maths (section 4).

### 3.6 Statistics semantics (port of the prototype `renderVals`)

- `firstW` / `lastW` = earliest / latest weigh-in; `lost = firstW − lastW`; `left = max(0, lastW − goal)`;
  `pct = clamp((firstW − lastW) / (firstW − goal) × 100, 0, 100)` only when `firstW > goal`, else 0.
- Measurement first/last per parameter = first/last entry where that parameter is set; delta = last − first.
- Periods: `week` = from Monday of the current week; `month` = last 30 days (today − 29); `q` = last 90 days
  (today − 89); `all` = from the earliest of (first day entry, first weigh-in, first measurement, today).
- `statsFor(from)`: day entries in [from, today]; trainings = count `trained === true`; avg kcal over days with kcal;
  change of weight / each measurement = last value in range − baseline, where baseline = last value **before** `from`
  if any, else the first value in range; `null` when only one point (baseline is the same point) or none.
- Charts (`chart()` in the prototype): points in period; if fewer than 4, the last 4 overall. SVG viewBox 320×h,
  6px side inset, 18% vertical padding, min span 1; dots 7px (hidden when > 16 points), last dot 12px + value tag.
- Workouts: total (all time), this week (from Monday), this calendar month, average per week since `all` start.
  Type ranking = counts of `types` among trained days in the selected period, desc.
- Kcal bars: week → 7 bars Mon…Sun with labels; month → 30 daily bars; 3 months / all → weekly averages
  (weeks from Monday) with note «· середнє за тиждень». Bar colour: no data → `--line`, ≤ goal → `--acc2`,
  > goal → `--acc`. Max = max(goal × 1.25, max value). Dashed goal line.
- Kcal history: days with kcal, newest first (show 7, then «Показати ще» loads more).
- Day status (calendar detail pill): «Заповнено» if food + kcal + workout mark all present; «Частково» if the day
  exists; else «Порожньо».
- Next weigh-in / measurements: next date with the reminder weekday from today (today counts unless already done)
  → «Сьогодні», «Завтра», or «Пн, 12 жовтня»; plus « · HH:MM»; «вимкнено» if the reminder is off.

### 3.7 AI calorie estimate, food photos, frequent dishes

Goal: she types what she ate in plain words («вівсянка з бананом, кава з молоком, борщ і шматок хліба») or
takes/chooses a photo of the plate, and gets an itemised estimate (name · portion · kcal + total) she can adjust
and add to the day with one tap. Meals are usually added one at a time through the day, so «Додати» **adds**
to the day's kcal and appends a line to the food text.

- **Model**: Claude Opus 5.5 (`claude-opus-5-5`) via the official `@anthropic-ai/sdk` on the **server only**
  (key in env `ANTHROPIC_API_KEY`, model overridable via `FOOD_AI_MODEL`). Structured output (JSON schema),
  `output_config.effort: 'low'`, adaptive thinking (default), server-side refusal fallback
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Timeout 60 s. Always check `stop_reason`.
  English system prompt; item names and comment in Ukrainian; Ukrainian/Eastern-European cuisine aware; use grams
  when given, otherwise typical portions; never moralise; non-food photo → no items + short comment.
- **Budget guard**: max 60 estimates per day (429 `rate_limited`, «Ліміт підрахунків на сьогодні вичерпано»).
- **Feature flag**: `GET /api/food/status → { enabled }` (false when no key) — the UI hides the AI buttons then.
- **Photos are saved** in the day's history (photo diary): the client downscales on device (canvas → JPEG,
  full ≤ 1280 px q≈0.82, thumb ≤ 320 px) and uploads both; server stores files
  `${DATA_DIR}/photos/<id>.jpg` + `<id>_t.jpg` (+ metadata table). `GET /api/photos/:id` and `/api/photos/:id/thumb`
  (auth, `Cache-Control: private, max-age=31536000, immutable`). `DayEntry.photos: string[]` references them
  (max 12/day); photos no longer referenced by any day and older than 24 h are garbage-collected daily.
  Photos are not part of the JSON export (they live in the server backups).
- **Frequent dishes («Часті страви»)**: part of AppData (`foods`), synced through ops, usable offline. Every added
  estimate item / quick-add records `food.use` {name, portion, kcal, date} (upsert by case-insensitive name:
  count+1, latest portion/kcal, lastUsed). The day sheet shows the top ~10 by count & recency as chips
  («Вівсянка з бананом · 350»); tapping adds it like an estimate line. `food.delete` removes one (long-press / edit mode).
- Endpoints: `POST /api/food/estimate` `{ date, text?, image?: { full: base64 JPEG, thumb: base64 JPEG } }` →
  `{ photoId?, items: [{ name, portion, kcal }], totalKcal, comment }` (photo stored before the model call).
- UI (day sheet, «Що я їла» section, 1b visual language): under the textarea a row with «✨ Порахувати» and
  «📷 Фото» (`<input type=file accept="image/*">` — iOS offers camera or library); disabled offline.
  «✨ Порахувати» opens a composer pre-filled with the part of «Що я їла» typed after the last estimated line
  (`unestimatedTail`); «Додати» replaces that part with the itemised line (`insertEstimate`) so the meal is never
  written twice. «Часті страви» usage (`food.use`) is committed together with the day on «Зберегти», never earlier.
  Result card: optional thumbnail, item rows, total, «Додати N ккал» (solid) and «Скасувати».
  **Every row is editable — name, portion and kcal — and she can add a missing row («+ позиція»).**
  Recalculation rules: if only the amount changed and both portions are in the same measurable unit group
  (г/кг or мл/л, comma decimals, «~»/«≈» allowed) with the name unchanged, kcal scale proportionally from the
  last model-confirmed values **on the device, instantly, without an AI call**. Any other name/portion change marks
  the row «змінено» and shows «✨ Перерахувати»: one `POST /api/food/estimate` in *recalculate* mode with all rows
  `{ name, portion }` (her values are authoritative) plus the stored `photoId` for context; only the changed rows
  take the new kcal (rows whose kcal she typed herself keep it). Counts as one estimate against the daily budget. Loading state «Рахую калорії…». Thumbnails strip of the day's photos (tap → full-screen viewer,
  remove). Calendar day detail shows the thumbnails under «Харчування».

## 4. Conventions

- TypeScript strict, no `any`, no non-null assertions on data that can really be missing. Small, named functions.
- Comments: English, only where intent is non-obvious. UI copy: Ukrainian.
- Accessibility: real `<button>`s, `aria-label` on icon-only buttons, `aria-pressed` on toggles, `role="switch"`
  + `aria-checked` on switches, labels for inputs, visible focus ring (global `:focus-visible`).
- Tests: Vitest (`*.test.ts(x)` next to code). Pure logic must be unit-tested.
- Before finishing any task: `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` must pass for the files you own
  (other tasks may be mid-flight — ignore errors that are clearly in files you do not own, but report them).
- Never commit secrets. Never touch files owned by another task unless your brief says so.
