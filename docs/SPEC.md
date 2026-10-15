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

**Meals and macros** — a day's food is a list of meals (her own meal types, default Сніданок / Обід / Вечеря /
Перекус, managed in Settings → «Прийоми їжі»), each with text, photos, kcal and protein / fat / carbs (grams); the
day's kcal is their sum; optional daily goals for Білки / Жири / Вуглеводи (Settings → «Цілі»). Plan:
`docs/meals-macros.md`. (So §1.1 #1 «what she ate · calories for the day» is now recorded per meal; days logged
before this release keep their single text / kcal and show as one block «Їжа за день».)

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
- Layout (from the prototype's `renderVals`, as changed by redesign A, §2.1):
  - **Mobile** (< 900px, `useIsDesktop()` false): column `max-width: 440px`, centered, padding
    `calc(12px + safe-top) 18px calc(120px + safe-bottom)`; floating glass tab bar at the bottom:
    **Головна · Календар · + · Прогрес · Налаштування** in a 3-part grid (`minmax(0,1fr) 64px minmax(0,1fr)`,
    labels 11/600, 10px below 360px); «+» opens the «Що записати?» menu; sheets slide up from the bottom
    (`max-width 440px`, top radius `--r28`).
  - **Desktop** (≥ 900px): container `max-width 1280px`; left sidebar 248px (logo «Л Легко», nav, «+ Записати день»,
    which opens the same «Що записати?» menu); main padding `32px 36px 48px`; content grid
    `repeat(2, minmax(0,1fr))` with `gap 14px` (full-width rows use `grid-column: 1/-1`); sheets are centered
    modals (`max-width 560px`, all radii `--r28`). (The prototype's «quick buttons in 4 columns» are gone, §2.1.)
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

### 2.1 Redesign A «Чек-лист дня» (deliberate deviation from the prototype layout)

The visual language stays 1b (tokens, Manrope, radii, colours, light/dark); the prototype's **layout** is replaced:
Home is one phone screen — header, compact hero (current weight, signed change badge, progress bar, «N% шляху»,
«до цілі X кг»), one «Сьогодні» list of four action rows (Їжа, Тренування with inline ✓/✕, Вага, Заміри; due /
missed / done states live in the rows) and one week row linking to `/progress?period=week`; at most one compact banner
(setup > iPhone install hint). «+» opens «Що записати?» (four 72px rows + «Повний запис дня →»), each row opens a short
sheet with only that action's fields in the same dialog; «Запис дня» stays for full editing (calendar, «Відкрити день»).
Settings is an iOS-style grouped list with summaries (`/settings`) and sub-pages (`/settings/reminders|goals|workouts|
appearance|data`) with an in-app «‹ Налаштування» back; re-tapping the active tab pops to the list; push problems show
as a badge on the Нагадування row; desktop shows list + detail. Progress has a sticky period bar with a paper backdrop,
the summary as one sentence line (the §1.1 #7 example wording), unboxed stat strips instead of tile grids. The calendar
is month grid + the selected day as a check-list whose rows open short sheets for that date (inline ✓/✕ for the
workout, as on Home); «Останні записи» is removed. Shared row primitives: `ListGroup` / `ListRow` (60px, 72px in the
menu), `Icon`, `StatStrip` (see `apps/web/src/ui/README.md`). Plan: `docs/redesign-a.md`.

Since the meals release (`docs/meals-macros.md` §7) the food parts of this layout changed: the menu's «Їжа» row
swaps the menu to a **new meal «Прийом їжі»** (type preselected, «Що я їла» focused — two taps to the keyboard);
the short sheet «Їжа» is the **day's list of meals** (totals card with kcal and Б · Ж · В against the goals, one row
per meal, «+ Прийом їжі»); a meal row opens the meal editor **stacked** above the list, and a position of it the
item editor «Позиція» above that (three sheets at most). The Home «Їжа» row and the calendar's Їжа row open the
day's list, or the new-meal editor on a day with no food. «Запис дня» lists the meals instead of a food text and
its own kcal field. Б · Ж · В show everywhere the day's kcal does: the Home «Їжа» row «1 240 / 1 700 ккал» + meter
with the sub «Б 68 · Ж 41 · В 132 г · 3 прийоми» (with goals «Б 68/90 · Ж 41/60 · В 132 г»), the calendar day's
Їжа row (one line per meal + the day's kcal and Б · Ж · В), Progress «Харчування» (the strip «Б · Ж · В — середнє
за день» for the period, against the goals). Over a goal is lavender (`--accD`), never red. Settings gains
«Прийоми їжі» (`/settings/meals`, her own types) and the optional Б · Ж · В goals in «Цілі».

§1.1 #9 «quick buttons «+ Харчування / + Тренування / + Вага / + Заміри»» are satisfied by the four «Сьогодні» rows
(one tap → that action's short sheet; Тренування also has inline ✓/✕) and by the «+» menu with the same four actions;
there is no separate button grid. The UI says «Їжа» where the prototype said «Харчування» (calendar legend, Home,
menu); the setup sheet is «Перші кроки» (the tab is «Налаштування»); the Settings list sits right under its header.

## 3. Architecture

```
packages/shared   @legko/shared  — types, zod schemas, ops reducer, dates/format helpers, API contract (TS source, no build)
apps/server       @legko/server  — Node 24 + Hono + node:sqlite + web-push; bundled by esbuild into dist/ (single file, no node_modules at runtime)
apps/web          @legko/web     — React 19 + Vite 8 + TypeScript + CSS Modules + zustand + wouter + vite-plugin-pwa (injectManifest)
e2e/              Playwright (system Chrome: iPhone 390×844 with the iPhone UA + desktop 1280×800) against the built app served by the server
deploy/           compose.yaml, Caddyfile, deploy.sh (build on the VPS)
Dockerfile        multi-stage: build web + server → node:24-alpine runtime serving API + static files on :3000
docs/             SPEC.md (this), DEPLOY.md, redesign-a.md (UX plan «Чек-лист дня»), meals-macros.md (meals + Б · Ж · В plan)
design/handoff/   Claude Design bundle (read-only reference)
```

Package manager: **pnpm 9** workspaces (`pnpm -r typecheck | test | build`, `pnpm lint`). Node ≥ 24.
Do **not** add dependencies casually; everything planned is already installed. If you truly need one,
say so in your report instead of installing (parallel installs corrupt the lockfile).

### 3.1 Data model & changes

See `packages/shared/src/types.ts`.
`AppData = { days: Record<date, DayEntry>, weights[], measures[], foods[], settings }`. Dates are local `YYYY-MM-DD`.

- **Days and meals.** `DayEntry = { food, kcal, trained, types, notes, photos?, meals? }`. A day **without** `meals`
  (or with `meals: []` in parsed data) is a *legacy* day: `food` / `kcal` / `photos` are what she typed, as before
  the meals release; it is never migrated (the UI shows it as one block «Їжа за день», and editing it or adding a
  meal converts it into the untyped meal `legacy`). A day **with** `meals` (≤ 20, unique ids) is a meal day: `food`,
  `kcal` and `photos` are **derived** by `normalizeDay()` — `food` = one line per meal («Сніданок: тост з тунцем,
  кава»; an untyped meal gives its text), `kcal` = sum of the known meal kcal (null when none), `photos` = the union,
  first 12 — so every reader of the old fields (kcal goal line, calendar fills, day status, stats, old clients)
  keeps working. `Meal = { id, type (her label as saved, '' = untyped, ≤ 30), time (HH:MM | null), text (≤ 5 000),
  kcal (0–20 000 | null), protein / fat / carbs (grams, multiples of 0.5, ≤ 3 000 | null), photos?, items? }`;
  `items` (≤ 30 positions `{ name, portion, kcal, protein, fat, carbs }`, macros ≤ 1 000 g each) are the AI / dish /
  hand-made positions, and with positions the meal's kcal and macros are their sums. Meals sort by time (no time
  last, stable). Day macros = sum of the meals' macros. Renaming or deleting a type never touches past meals.
- **Settings** gain `mealTypes` (her ordered list, ≤ 12 names of ≤ 30 chars, default Сніданок · Обід · Вечеря ·
  Перекус, may be empty) and `macroGoals { protein, fat, carbs }` (whole grams 1–1 000 or null = no goal); both have
  defaults, so old stored settings and old backups stay valid. `foods[]` («Часті страви») gain optional
  `protein` / `fat` / `carbs` (a key is omitted when unknown, never null).

Every change is an **op** (`packages/shared/src/schemas.ts → opSchema`):
`day.put | day.delete | day.meta | meal.put | meal.delete | weight.put | weight.delete | measure.put | measure.delete |
settings.put | food.use | food.delete`. Ops are idempotent upserts. Semantics are defined by `applyOp()` /
`reduceDay()` in `packages/shared/src/ops.ts` (empty day → delete; measure with no values → delete; workout types
dropped unless `trained === true`; text trimmed); the server's repository calls the same `reduceDay(readDay(date),
op)`, so it persists **exactly** the same semantics (parity-tested). Day ops:

| Op | Semantics |
| --- | --- |
| `meal.put {date, value: Meal}` | Upsert by id. On a legacy day its food / kcal / photos first become the untyped meal `legacy`. A new meal is appended only below 20 meals (else no change — `saveMeal` reports false); an empty meal is dropped. |
| `meal.delete {date, id}` | Removes that meal (the last one gone → empty food, kcal null, no photos). On a legacy day id `legacy` clears its food / kcal / photos. Unknown id → no change. |
| `day.meta {date, value}` | **Partial**: applies only the keys present of `trained` / `types` / `notes` (at least one); never the food. A ✓ on one device and a note on another do not overwrite each other. Creates no empty day. |
| `day.put {date, value}` on a legacy day | The pre-meals semantics (whole-day upsert). Its value never carries `meals` (`dayPutValueSchema` strips the key). |
| `day.put` on a meal day | **Rule L** (`mergeLegacyDayPut`): keep the stored meals, take `trained` / `types` / `notes` from the op, and add what is new in its food — lines not already known, photos not in any meal, kcal above the stored total — as one untyped meal `old-<hash>` (at 20 meals merged into the last meal without positions; dropped when every meal has positions). Removals are ignored; replaying the same op adds nothing. |
| `day.delete` | Legacy day → deleted. Meal day → the meals stay; only `trained`, `types`, `notes` are cleared. |
| `settings.put` | Absent `mealTypes` / `macroGoals` = keep the stored values (old clients strip unknown keys); `customTypes` and `mealTypes` are normalised. |
| `food.use` | Upsert by case-insensitive name; macros = the use's when it has any macro key, else the stored dish's when its kcal is unchanged, else none (rule inside `useFood()`, which the server calls directly). |

Rule L exists for old clients only: **the new client never sends `day.put` or `day.delete`** (meals go through
`meal.*`, the workout and notes through `day.meta`), but the server accepts both forever. Known limits, tested as
current behaviour (only with an outdated client inside its reload window, or an old offline outbox): (e) a stale
client that still shows a meal deleted on the phone brings it back as an untyped block when it saves anything;
(f) its own kcal increase is lost when meals were added elsewhere meanwhile (its changed line is added without
kcal). Nothing logged on a new client is deleted, and the extra block is visible and editable.

**Versioning**: wire format v2 = v1 + additions — no field is removed or renamed, every new field is optional on
input, and absence never deletes anything. A day's shape (`meals` present or not) is its version: there is no data
migration and no version flag. Old outbox ops, old device caches and old JSON backups parse with the new schemas.
An old cached PWA (until `pwa/update.ts` reloads it) reads the derived fields, and its writes go through Rule L /
the settings merge / the `food.use` rule above.

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
  `POST /api/import` validates with `appDataSchema` and replaces everything in one transaction (every day is
  re-normalised: the derived food / kcal / photos of meal days are recomputed; old backups without meals, meal types,
  macro goals or dish macros import as legacy days with the default types and no goals).
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
  - test: «Легко» / «Сповіщення працюють ✨» → `/settings/reminders` (`SETTINGS_REMINDERS_PATH`)
- The server box reboots for updates at 02:00 UTC; nothing else to do about it (15-min catch-up window covers restarts).

### 3.4 Server runtime

Env: `PORT` (3000) · `DATA_DIR` (`/data`, dev `./data`) · `STATIC_DIR` (dir with the built web app; unset in dev) ·
`PUBLIC_ORIGIN` (`https://fit.triple-a.dev`) · `NODE_ENV` · `TRUST_PROXY` (`1` behind Caddy) ·
`VAPID_SUBJECT` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (optional) · `LOG_LEVEL`.
- SQLite file `${DATA_DIR}/legko.db`, WAL mode, `PRAGMA user_version` migrations (append-only). **Schema v3**
  (meals release) is additive: `days.meals TEXT` (the day's meals as JSON; `NULL` = legacy day) and
  `foods.protein / fat / carbs REAL` (`NULL` = unknown); existing rows are not rewritten. Every day write stores the
  derived `food` / `kcal` / `photos` **and** `meals` (in the INSERT and in the `ON CONFLICT` update). A `days.meals`
  that does not parse is logged (date only) and served as a legacy day. Before migrating a file database with
  `0 < user_version < target`, `openDatabase` saves `${DATA_DIR}/backups/legko-pre-v<target>-<date>.db` (`VACUUM
  INTO`; outside the daily pattern, so never pruned). A build refuses a database newer than its own migrations.
  **Rollback** to the build before meals: stop the app, run the new image's `node dist/cli.js downgrade-schema`
  (refuses unless v3; saves `backups/legko-pre-down-v3-<date>.db`; drops the four v3 columns and sets
  `user_version` 2 in one transaction — every day keeps its derived food text, kcal and photos), then
  `deploy/deploy.sh rollback` (DEPLOY.md «Rollback after the meals release»). Never just lower `user_version`.
- Daily backup `VACUUM INTO ${DATA_DIR}/backups/legko-YYYY-MM-DD.db` at ~03:30 Kyiv time and at start-up if today's is
  missing; keep the newest 30.
- Static: hashed assets `Cache-Control: public, max-age=31536000, immutable`; `index.html`, `sw.js`,
  `manifest.webmanifest` → `no-cache`; SPA fallback to `index.html` for non-`/api` GETs.
  Security headers incl. a CSP (`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
  font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none';
  base-uri 'self'; form-action 'self'`).
- CLI (bundled `dist/cli.js`): `node dist/cli.js set-password` (prompts twice, hidden input; or `--stdin`) — writes the
  hash and **revokes all sessions**; `node dist/cli.js downgrade-schema` — the schema v3 → v2 rollback step above
  (opens the database without migrating). `GET /api/health` is unauthenticated (used by the Docker healthcheck).
- Logs: one line per request (method, path, status, ms) without bodies or cookies.

### 3.5 Web app

- Entry: `main.tsx` → `App.tsx` = `AuthGate` → `AppShell` → routes `/`, `/calendar?date=YYYY-MM-DD`,
  `/progress[?period=week|month|q|all]` (selects + stores the period, then removes the param with replace),
  `/settings`, `/settings/:section` (reminders | goals | workouts | meals | appearance | data; anything else →
  `/settings`; `meals` = «Прийоми їжі», her meal types: view mode, «Змінити» → rename / ↑ ↓ / ✕, add, «Повернути
  стандартні»; «Цілі» also holds the optional Б · Ж · В goals),
  `/reminders` → redirect to `/settings/reminders` (old bookmarks and test notifications), catch-all → `/`.
  Screens export `HomeScreen`, `CalendarScreen`, `ProgressScreen`, `SettingsScreen` (`screens/settings`). These
  files and the exported names are the contract between tasks.
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
  Meals: `dataActions.saveMeal(date, meal, uses?)` (`meal.put` + the `food.use` of positions added in the editor;
  returns false when the schema refuses the meal or the 20-meal cap refused the append, so no false «Збережено»),
  `dataActions.deleteMeal(date, id)` (`meal.delete`), `dataActions.setDayMeta(date, meta)` (`day.meta`, only the
  keys given — the day sheets send only the workout / notes fields she changed); `newMealId()` (12 chars).
  `saveDay` / `deleteDay` are deprecated (no caller; the new client never sends `day.put` / `day.delete`).
- **UI state**: `apps/web/src/store/ui.ts` — `ui.openSheet(date, mode, patch?)`, `ui.closeSheet()`, `ui.flash(text)`,
  `ui.moveSheet(date)` (changes the open sheet's date keeping its mode, key and patch — the new-meal ‹ › move her draft
  to that day). `SheetMode = 'menu' | 'day' | 'food' | 'meal' | 'workout' | 'weight' | 'measure' | 'setup' |
  'install'` («Що записати?», «Запис дня», «Їжа» — the day's list of meals, «Прийом їжі» — a new meal, «Тренування»,
  «Контрольне зважування», «Заміри тіла», «Перші кроки», «Встановлення на iPhone»); `SheetPatch { trained? }`
  pre-fills the `workout` and `day` sheets. The menu and every record form share one sheet instance (the body swaps in
  place; the menu's «Їжа» row swaps to `'meal'`). An existing meal (or a new one from «+ Прийом їжі») opens in a
  **stacked** sheet «Прийом їжі» rendered inside «Їжа» / «Запис дня», and a position in «Позиція» / «Нова позиція»
  above that (`ui/sheet/stack.ts`: z-index 60 / 62 / 64, capped at 68 below the photo viewer, toasts and
  `ui.confirm()`; every sheet under the live one is `inert`; Escape / drag-down close only the top one). The Home
  «Їжа» row and the calendar day's Їжа row open `'food'` for that date, or `'meal'` on a day with no food. Every
  opener of a new meal wraps the open in `flushSync`, so «Що я їла» takes focus inside the tap and the iPhone
  keyboard opens. A new meal's type is `suggestMealType()` (time of day today, else the first type not logged yet;
  degrades to keywords, then positions, when she renamed the defaults; always changeable). One-tap workout marks go
  through `store/dayMarks.ts` (`setTrainedMark` → `setDayMeta(date, { trained })`, Home and the calendar day card).
- **Today**: `useToday()` (`lib/useToday.ts`). Weeks start on Monday (`mondayOf`).
- **Platform**: `lib/platform.ts` (`isIOS`, `isStandalone`, `useIsDesktop`). **Theme**: `lib/theme.ts`.
- **Push client**: `lib/push.ts` contract (`getPushStatus`, `enablePush`, `disablePush`, `syncPushSubscription`,
  `sendTestPush`). On iPhone, push works only in the installed app (iOS ≥ 16.4) → status `needs-install`.
- **Deep links** (client parsing; the server's `DEEP_LINKS` are unchanged): `/?sheet=day&trained=1` opens
  «Тренування» with ✓ pre-selected (legacy alias kept for delivered workout pushes), `/?sheet=day` the full day,
  `/?sheet=food` «Їжа» (the day's meals), `/?sheet=workout[&trained=1]` «Тренування», `/?sheet=weight`,
  `/?sheet=measure`; each opens that sheet for today and cleans the URL (handled by `SheetHost`). `menu`, `meal` (a
  new meal opens only from a tap, with the keyboard), `setup`, `install` and unknown values are not linkable: ignored
  and removed. Notification clicks focus an open window and navigate it (asking first when a meal is being typed).
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
  Type ranking = counts of `types` among trained days in the selected period, desc; the top 5 are shown.
- Kcal bars: week → 7 bars Mon…Sun with labels; month → 30 daily bars; 3 months / all → weekly averages
  (weeks from Monday) with note «· середнє за тиждень». Bar colour: no data → `--line`, ≤ goal → `--acc2`,
  > goal → `--acc`. Max = max(goal × 1.25, max value). Dashed goal line.
- Kcal history: days with kcal, newest first (show 3, then each «Показати ще» loads 7 more).
- Every kcal statistic keeps reading `entry.kcal` (on a meal day the derived sum of its meals) — unchanged.
- Macros (Б · Ж · В): a day's macros are the sum of its meals' macros (`dayMacros`). A meal is *complete* for a
  macronutrient when every position with kcal > 0 has it (with positions) or the meal has it (without); a meal with no
  energy and no positions is ignored; a day is complete when all its meals are (a legacy day has no macros, so it
  never counts).
  Totals (Home, «Їжа», calendar) show the sum of what is known — still over a goal when that partial sum is — and
  «Їжа» notes «Б · Ж · В пораховано не для всіх прийомів». **Progress «Харчування»**: per macronutrient, the mean of
  the day totals over the days of the selected period (week / 30 days / 90 days / all) where that total is known and
  complete (`macroAverages`), whole grams, unit «г», a goal in the label («Білки · ціль 90 г»), lavender above it; no
  such day → «За цей період білків, жирів і вуглеводів ще не записано». The one-line period summary (§1.1 #7) is
  unchanged. Over a macro goal = lavender like kcal over (`--acc` bar, `--accD` number), never red.
- Day status (calendar detail pill): «Заповнено» if food + kcal + workout mark all present; «Частково» if the day
  exists; else «Порожньо».
- Next weigh-in / measurements: next date with the reminder weekday from today (today counts unless already done)
  → «Сьогодні», «Завтра», or «Пн, 12 жовтня»; plus « · HH:MM»; «вимкнено» if the reminder is off
  (`nextReminderLabel().text` keeps the time for other uses). On Home the date is shown without the time
  («Пн, 19 жовтня» / «Завтра»; the « · HH:MM» time is part of the row's accessible name), and due today shows a
  «Сьогодні» pill.
- Home weigh-in / measurement rows (`weeklyCheck` in `lib/stats/reminders.ts`): «✓ Сьогодні — 65,0 кг» when done
  today; «Пропущено · 12 жовтня — 65,4 кг» when the last scheduled day in the past 6 days was missed after an earlier
  record (never for a brand-new account, never before the first-run setup); otherwise the latest record and the next
  date. Order of the rules: done → off → due → overdue → upcoming.

### 3.7 AI calorie estimate, food photos, frequent dishes

Goal: she types what she ate in plain words («вівсянка з бананом, кава з молоком, борщ і шматок хліба») or
takes/chooses a photo of the plate, and gets an itemised estimate (name · portion · kcal · Б · Ж · В + total) she
can adjust. Since the meals release (`docs/meals-macros.md` §5, §7.3–§7.4) the estimate is part of one **meal**:
its result **is** the meal's list of positions (no «Додати N ккал» step), and the meal's kcal and macros are their
sums.

- **Model**: Claude Opus 5.5 (`claude-opus-5-5`) via the official `@anthropic-ai/sdk` on the **server only**
  (key in env `ANTHROPIC_API_KEY`, model overridable via `FOOD_AI_MODEL`). Structured output (JSON schema),
  `output_config.effort: 'low'`, adaptive thinking (default), server-side refusal fallback
  (`fallbacks: "default"`, beta `server-side-fallback-2026-07-01`). Timeout 60 s. Always check `stop_reason`.
  English system prompt; item names and comment in Ukrainian; Ukrainian/Eastern-European cuisine aware; use grams
  when given, otherwise typical portions; never moralise; non-food photo → no items + short comment.
  **Macros**: every item also has `protein`, `fat`, `carbs` — grams in that portion to the nearest 0.5 g, consistent
  with its kcal (≈ 4 kcal/g protein and carbohydrate, 9 kcal/g fat; alcohol adds energy without macros; water, black
  coffee, plain tea 0 / 0 / 0). The model's JSON schema has no numeric bounds; the server sanitises
  (`clampMacro`: non-finite → null, rounded to 0.5 g, clamped to 0–1 000) and does not rewrite kcal ↔ macros.
- **Budget guard**: max 60 estimates per day (429 `rate_limited`, «Ліміт підрахунків на сьогодні вичерпано»).
- **Feature flag**: `GET /api/food/status → { enabled }` (false when no key) — the UI hides the AI buttons then.
- **Photos are saved** in the day's history (photo diary): the client downscales on device (canvas → JPEG,
  full ≤ 1280 px q≈0.82, thumb ≤ 320 px) and uploads both; server stores files
  `${DATA_DIR}/photos/<id>.jpg` + `<id>_t.jpg` (+ metadata table). `GET /api/photos/:id` and `/api/photos/:id/thumb`
  (auth, `Cache-Control: private, max-age=31536000, immutable`). Photos **belong to a meal** (`Meal.photos`); the day
  cap stays 12 across its meals, and `DayEntry.photos` is their derived union (a legacy day keeps its own list).
  Photos referenced by no day and no meal and older than 24 h are garbage-collected daily; the GC query reads the
  meals through `json_each(CASE WHEN json_valid(meals) THEN meals ELSE '[]' END)` and **skips the whole run**
  (warning, no content) while some `days.meals` is not valid JSON, so a photo only that row references is never
  deleted. Photos are not part of the JSON export (they live in the server backups).
- **Frequent dishes («Часті страви»)**: part of AppData (`foods`), synced through ops, usable offline. Every position
  added from an estimate or a dish records `food.use` {name, portion, kcal, protein?, fat?, carbs?, date} with the
  meal's «Зберегти» (upsert by case-insensitive name: count+1, latest portion/kcal, lastUsed; macros per §3.1 — a
  key is omitted when unknown). The meal editor shows the top ~10 by count & recency as chips
  («Вівсянка з бананом · 350»); tapping adds a position with the dish's kcal and macros (none when the dish has none).
  `food.delete` removes one (edit mode).
- Endpoints: `POST /api/food/estimate` `{ date, text?, image?: { full: base64 JPEG, thumb: base64 JPEG } }` →
  `{ photoId?, items: [{ name, portion, kcal, protein, fat, carbs }], totalKcal, comment }` (photo stored before the
  model call; each macro a number or null). The *recalculate* mode returns kcal **and** macros by index. Request
  schema, budget and modes are unchanged.
- UI — the meal editor «Прийом їжі» (1b visual language): type chips (her `mealTypes`, one sideways-scrolling row on
  touch, with «+ Свій» outside the scroller so it is always on screen), then the
  AI row **above** «Що я їла» — «✨ Порахувати» and «📷 Фото» (`<input type=file accept="image/*">`, iOS offers
  camera or library), so the iPhone keyboard never covers them; disabled offline, out of budget, at 30 positions
  («📷 Фото» also at 12 photos a day). An estimate **appends** its rows to the meal's positions card «Позиції»
  (≤ 30 rows; «Знайдено 2 позиції, разом 370 ккал» announced); a photo estimate also attaches the photo to the meal.
  Right after an estimate «Прибрати ці позиції» undoes exactly that estimate (its rows and its photo). With positions,
  the first AI button becomes «✨ Порахувати решту» (what she typed after the counted text, shown as «Ще не
  пораховано: …») or «✨ Додати ще» (composer «Що ще порахувати?»). A meal without positions has «Калорії» and the
  folded «+ Б · Ж · В» (0,5 g steps); the first position added to such a meal turns her typed numbers into a
  position «Інше» — except an estimate of the very text those numbers covered (e.g. an old «Їжа за день» block
  with its day kcal), whose rows **replace** them (no double count; «Прибрати ці позиції» puts them back).
  **Every position is editable** in the stacked item editor «Позиція» (name, amount, kcal, Б · Ж ·
  В by hand) and she can add a missing one («+ позиція» → «Нова позиція»). Recalculation rules: if only the amount
  changed and both portions are in the same measurable unit group (г/кг or мл/л, comma decimals, «~»/«≈» allowed)
  with the name unchanged, kcal **and macros** scale proportionally from the last model-confirmed values **on the
  device, instantly, without an AI call** (macros rounded to 0.5 g). Typed kcal pins the kcal and rescales the macros
  she did not type (typed / reference kcal; unknown reference → «—»); typed macros pin the macros. Any other
  name/portion change marks the row «змінено» and shows «✨ Перерахувати»: one `POST /api/food/estimate` in
  *recalculate* mode with all rows `{ name, portion }` (her values are authoritative) plus the stored `photoId` for
  context; only the changed rows take the new kcal and macros (a pinned value survives). Counts as one estimate
  against the daily budget. Loading state «Рахую калорії…». The meal's photos show as a thumbnail strip (tap →
  full-screen viewer, remove); the «Їжа» list shows them under each meal row and the calendar under its «Їжа» row.
  «Зберегти» sends `meal.put` (+ the `food.use` of the positions added in this editor); nothing reaches the day
  before that.

## 4. Conventions

- TypeScript strict, no `any`, no non-null assertions on data that can really be missing. Small, named functions.
- Comments: English, only where intent is non-obvious. UI copy: Ukrainian.
- Accessibility: real `<button>`s, `aria-label` on icon-only buttons, `aria-pressed` on toggles, `role="switch"`
  + `aria-checked` on switches, labels for inputs, visible focus ring (global `:focus-visible`).
- Tests: Vitest (`*.test.ts(x)` next to code). Pure logic must be unit-tested.
- Before finishing any task: `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` must pass for the files you own
  (other tasks may be mid-flight — ignore errors that are clearly in files you do not own, but report them).
- Never commit secrets. Never touch files owned by another task unless your brief says so.
