# «Легко» — personal weight-loss tracker · Engineering spec

Single source of truth for everyone working on this repo. Read it fully before touching code.

## 1. Product

A mobile-first PWA (Ukrainian UI) for **a few people**, each with their own account, who track nutrition, workouts,
weight and body measurements while losing weight. It is installed on an **iPhone** home screen and also used on
desktop. Server: one Docker container on a VPS behind Caddy at `https://fit.triple-a.dev`.

Accounts (since the users release, `docs/multi-user.md`): username + password; **no open sign-up** — an admin sends
a one-time invite link; every account's data (days, meals, weights, measurements, settings, dishes, photos, push
subscriptions, reminders, AI usage, backups / export / import) is completely separate. Admins manage accounts in
Settings → «Користувачі» and never see anyone's records. The pre-accounts installation's data belongs to the ordinary
user **«anna»** (the legacy owner); the owner's account is the one admin **«admin»**, bootstrapped over SSH with a
one-time setup link (`docs/DEPLOY.md`). The requirements below («she records …») apply to every account.

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
**accounts** — the login screen (username + password, «Маю посилання»), one-time invite links (`/invite`) and
password / setup links (`/reset`), Settings → «Акаунт» (name, password, AI left today, «Вийти») and, for admins,
«Користувачі» (users, invites, reset links, roles, disable / delete, AI limits) (§3.2, §3.5) —, first-run setup sheet
(start weight, goal weight, kcal goal),
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
docs/             SPEC.md (this), DEPLOY.md, redesign-a.md (UX plan «Чек-лист дня»), meals-macros.md (meals + Б · Ж · В plan),
                  multi-user.md (accounts, invites, admin, per-user data — schema v4)
design/handoff/   Claude Design bundle (read-only reference)
```

Package manager: **pnpm 9** workspaces (`pnpm -r typecheck | test | build`, `pnpm lint`). Node ≥ 24.
Do **not** add dependencies casually; everything planned is already installed. If you truly need one,
say so in your report instead of installing (parallel installs corrupt the lockfile).

### 3.1 Data model & changes

See `packages/shared/src/types.ts`.
`AppData = { days: Record<date, DayEntry>, weights[], measures[], foods[], settings }`. Dates are local `YYYY-MM-DD`.
**One `AppData` per account**: `GET /api/data`, ops, export and import always mean the signed-in account's data; the
shapes are unchanged by accounts (old outbox ops, device caches and JSON backups parse as before). Account types and
helpers (`SessionUser`, `UserRole`, `AdminUser`, `AdminInvite`, `AdminOverview`, `AiLimits`, username rules, link
helpers) live in `packages/shared/src/users.ts`.

- **Days and meals.** `DayEntry = { food, kcal, trained, types, notes, photos?, meals? }`. A day **without** `meals`
  (or with `meals: []` in parsed data) is a _legacy_ day: `food` / `kcal` / `photos` are what she typed, as before
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

| Op                                      | Semantics                                                                                                                                                                                                                                                                                                                                                                                                              |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `meal.put {date, value: Meal}`          | Upsert by id. On a legacy day its food / kcal / photos first become the untyped meal `legacy`. A new meal is appended only below 20 meals (else no change — `saveMeal` reports false); an empty meal is dropped.                                                                                                                                                                                                       |
| `meal.delete {date, id}`                | Removes that meal (the last one gone → empty food, kcal null, no photos). On a legacy day id `legacy` clears its food / kcal / photos. Unknown id → no change.                                                                                                                                                                                                                                                         |
| `day.meta {date, value}`                | **Partial**: applies only the keys present of `trained` / `types` / `notes` (at least one); never the food. A ✓ on one device and a note on another do not overwrite each other. Creates no empty day.                                                                                                                                                                                                                 |
| `day.put {date, value}` on a legacy day | The pre-meals semantics (whole-day upsert). Its value never carries `meals` (`dayPutValueSchema` strips the key).                                                                                                                                                                                                                                                                                                      |
| `day.put` on a meal day                 | **Rule L** (`mergeLegacyDayPut`): keep the stored meals, take `trained` / `types` / `notes` from the op, and add what is new in its food — lines not already known, photos not in any meal, kcal above the stored total — as one untyped meal `old-<hash>` (at 20 meals merged into the last meal without positions; dropped when every meal has positions). Removals are ignored; replaying the same op adds nothing. |
| `day.delete`                            | Legacy day → deleted. Meal day → the meals stay; only `trained`, `types`, `notes` are cleared.                                                                                                                                                                                                                                                                                                                         |
| `settings.put`                          | Absent `mealTypes` / `macroGoals` = keep the stored values (old clients strip unknown keys); `customTypes` and `mealTypes` are normalised.                                                                                                                                                                                                                                                                             |
| `food.use`                              | Upsert by case-insensitive name; macros = the use's when it has any macro key, else the stored dish's when its kcal is unchanged, else none (rule inside `useFood()`, which the server calls directly).                                                                                                                                                                                                                |

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

- **Auth: accounts** (`docs/multi-user.md` §3, §6). `POST /api/auth/login { username?, password }` answers
  `{ ok, user: SessionUser }` and sets cookie `sid` (HttpOnly, SameSite=Lax, Path=/, Secure in production, Max-Age
  400 days, sliding renewal); `GET /api/auth/me` answers `{ ok, user }` with
  `SessionUser = { id, username, role, createdAt, legacyOwner, passwordChange }`; `POST /api/auth/logout`. Sessions
  are random 32-byte tokens bound to a user; only their SHA-256 is stored; every request re-reads the user (role,
  disabled) through the session. Usernames: 3–32 chars of `[A-Za-z0-9._-]` with a letter or digit, unique
  case-insensitively (stored as typed + a lower-case key); `legko` is never usable (it is the login alias of the
  legacy owner: the pre-accounts Keychain entry and a login **without** a username — the old cached bundle — sign in
  «anna»), `admin` only from the CLI. Passwords 8–200 chars, scrypt (`node:crypto`, N 2^15, r 8, p 1) in
  `users.password_hash` (NULL = no usable password yet). An unknown name, no password and a wrong password get the
  identical 401 `bad_credentials` «Неправильне імʼя або пароль» after the same work (a dummy hash is verified); a
  disabled account with the right password 403 `account_disabled`. A login (and an invite accept / reset complete)
  over an existing `sid` revokes that session first.
- **One-time links** (`/invite#<token>`, `/reset#<token>`; the token — 32 random bytes, base64url — is in the
  fragment, so it never reaches the server log; only its SHA-256 is stored): invites (7 days, made by an admin, role
  user from the app, `--admin` from the CLI; optional note ≤ 60; ≤ 20 pending), reset links (24 h) and setup links
  (24 h, for an account without a password). Single use (consumed inside the transaction that creates the account /
  sets the password and the session), revocable; a new reset link revokes the account's older ones. Unusable → 410
  `link_invalid` with `reason` `unknown | revoked | used | expired` (in that order). Endpoints:
  `POST /api/auth/invite/check { token }` → `{ ok, expiresAt }`;
  `POST /api/auth/invite/accept { token, username, password }` → `LoginResponse` (+ cookie);
  `POST /api/auth/reset/check { token }` → `{ ok, username, purpose, expiresAt }`;
  `POST /api/auth/reset/complete { token, password }` → `LoginResponse` (+ cookie).
- **Account** (signed in): `POST /api/account/password { currentPassword, newPassword }` (revokes **all** the user's
  sessions incl. this one and sets a fresh cookie; revokes pending reset links for the user);
  `POST /api/account/username { username, password }` → `MeResponse`.
- **Admin** (role admin, else 403 `forbidden`): `GET /api/admin/users` → `AdminOverview` (`users`, `invites`, `limits`,
  `aiToday`: usernames, role, status active / disabled / pending, created, last activity, AI usage — never anyone's
  records); `POST /api/admin/invites { note }` → `{ ok, path, expiresAt, invite }`; `/invites/revoke { id }`;
  `/users/reset-link { userId }` → `{ ok, path, expiresAt }`; `/users/role { userId, role }`;
  `/users/disable { userId, disabled }`; `/users/delete { userId, confirmUsername }` (removes all their rows and
  photo files); `/users/ai-limit { userId, limit | null }`; `/ai-limits { perUser, global }`. «Last admin» = the last
  usable admin (role admin, not disabled, has a password): demoting, disabling or deleting it → 409 `last_admin`;
  disabling or deleting yourself → 409 `self_action` (both checked inside `BEGIN IMMEDIATE`). Invalidation: own
  password change → all own sessions; reset / setup completed → all sessions + a new one, other pending resets for
  the user, and for an admin every invite / reset link they created; demotion → the target's sessions and the links
  they created; disable → sessions, push subscriptions, resets for them, links they created; delete → links they
  created, then cascade.
- **Error codes** (`ApiErrorCode`): `bad_credentials`, `account_disabled`, `forbidden`, `user_mismatch`,
  `link_invalid` (+ `reason`), `username_taken`, `invalid_username`, `weak_password`, `wrong_password`, `last_admin`,
  `self_action`, `limit_reached` (20 pending invites) next to the existing ones (`bad_password` «Неправильний
  пароль» is still sent for a failed login **without** a username — only the pre-accounts bundle sends one; named
  logins answer `bad_credentials`). The client adds its own `outdated_server`: a 2xx `me` / login / link / rename answer
  without a valid `user` (an old server during a rollback); background checks then keep the device as it is.
- **`X-Legko-User: <device user id>`** is sent by the client with `GET /api/data`, `POST /api/ops` and
  `POST /api/import`. The server answers 409 `user_mismatch` (nothing applied) when it names another account than the
  session's, or when it is **missing** on those three routes on a session made by a v4 login. Only **legacy
  sessions** (`sessions.legacy = 1`: migrated from v3, or made by a login without a username — the pre-accounts
  bundle, always anna) work without it; the first request that presents the matching header clears the flag. Export,
  photos, push and food never need it.
- **Rate limits**: login — 5 failures / 15 min per IP (IPv6 per /64; trust `X-Forwarded-For` only from the proxy),
  10 / 15 min per username (in memory, also unknown names), and the persistent global cap 20 / 15 min (`kv`), each
  failure counted **before** hashing, a success resets that IP and name → 429 `rate_limited`; in production also 30
  **successful** logins / hour per username and per address (checked before hashing) and at most 20 sessions per
  account (a new one drops the least recently renewed); the four public link
  endpoints — 10 failed attempts / 15 min per address (IPv6 per /64; 410 answers and taken names count; throttled
  before the body is read; a concurrent request for a token already in flight → 429); `/api/account/*` — 5 wrong current passwords /
  15 min per user (counted before verifying) and 10 attempts / hour per user (every attempt counts). **scrypt gate**:
  at most 2 hashes / verifies in flight app-wide and a FIFO queue of 16; beyond that 429 `rate_limited` with
  `Retry-After: 5`.
- Mutating requests (`POST`) require `Content-Type: application/json` and an `Origin` that matches the request
  host (or `PUBLIC_ORIGIN` / dev origins) → otherwise 403 `forbidden_origin`.
- `POST /api/ops` validates each op with `opSchema`; on the first invalid op → 400 `invalid_op` with `index`
  and nothing applied; otherwise all ops applied in one transaction, in order.
- `GET /api/export` → `Content-Disposition: attachment; filename="legko-YYYY-MM-DD.json"`, body = the signed-in
  account's AppData (date in its time zone). `POST /api/import` validates with `appDataSchema` and replaces **that
  account's** data in one transaction — no other account is touched (every day is re-normalised: the derived food /
  kcal / photos of meal days are recomputed; old backups without meals, meal types, macro goals or dish macros import
  as legacy days with the default types and no goals).
- Every per-user table is reachable only through `forUser(userId)` repositories (a branded `UserId` comes only from
  the users repo and `requireAuth`); a scope-lint unit test fails any SQL statement on a per-user table without a
  bound `user_id = ?` (explicit allowlist with reasons). Another account's photo id answers 404 (never 403).
- Errors always `{ error, message }` JSON (see `ErrorResponse`). Unknown `/api/*` → 404 JSON.

### 3.3 Reminders & push (server)

- VAPID keys generated on first start and stored in `kv` (unless `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY` env given).
  Subject `VAPID_SUBJECT` (default `PUBLIC_ORIGIN`, e.g. `https://fit.triple-a.dev`).
- `push_subscriptions(endpoint PK, user_id, p256dh, auth, user_agent, created_at, last_ok_at)`: every subscription
  belongs to one account (the one signed in on that device). Delete on 404/410 from the push service. **Ownership
  rule**: subscribing an endpoint that belongs to another account moves it only when the `auth` key matches the
  stored one (the same browser subscription — after a switch on the same phone); otherwise 403 `forbidden`, the row
  and the time zone untouched. `POST /api/push/unsubscribe { endpoint, auth? }` deletes the row when it is the
  caller's or when `auth` matches (the client sends it on logout / switch); without `auth` only the caller's own row.
  `POST /api/push/test` sends to the caller's devices only (5 per 10 min per account, then 429). Subscribing sets
  **the caller's** `settings.timezone`. Only `https` endpoints of the browsers' push services are accepted
  (`web.push.apple.com`, `*.push.apple.com`, `fcm.googleapis.com`, `*.push.services.mozilla.com`,
  `*.notify.windows.com`; default port, no userinfo, never an IP literal), otherwise 400 «Цей сервіс сповіщень не
  підтримується»; at most 10 subscriptions per account (the oldest is forgotten). Each delivery is sent by the app's
  own `https.request` (request built by `web-push`) with a 20 s deadline and at most 4 KiB of a refusal read.
- Scheduler ticks every 30 s and runs **per account**, one after another, each account's tick with a 30 s budget (a
  late one keeps running alone and that account is skipped until it ends; one account's failure stops nobody else);
  maintenance (backups, photo GC, purges) runs in its own loop:
  for every account that has subscriptions and is not disabled, with that account's own `settings.rem` and
  `settings.timezone`. For each enabled reminder whose scheduled time **today** (weekday matches) is ≤ now <
  scheduled + 15 min and which was not sent yet today (`reminder_log(user_id, kind, date)` unique) → send to that
  account's subscriptions, then log it. Skip (but still log as handled) when the action is already done that day (that
  account's rows): weigh → a weight exists for today; measure → measurements exist for today; workout →
  `days[today].trained !== null`.
- Notification payload (JSON for the SW): `{ title, body, url, tag }`. Copy:
  - workout: «Час тренування 💪» / «Не забудь відмітити, як пройшло» → url `DEEP_LINKS.workout`
  - weigh: «Контрольне зважування ⚖️» / «Найточніше — зранку, натщесерце» → `DEEP_LINKS.weigh`
  - measure: «Час замірів 📏» / «Груди, талія, стегна — займе хвилину» → `DEEP_LINKS.measure`
  - test: «Легко» / «Сповіщення працюють ✨» → `/settings/reminders` (`SETTINGS_REMINDERS_PATH`)
- The server box reboots for updates at 02:00 UTC; nothing else to do about it (15-min catch-up window covers restarts).

### 3.4 Server runtime

Env: `PORT` (3000) · `DATA_DIR` (`/data`, dev `./data`) · `STATIC_DIR` (dir with the built web app; unset in dev) ·
`PUBLIC_ORIGIN` (`https://fit.triple-a.dev`; also the origin of the links the CLI prints) · `NODE_ENV` ·
`TRUST_PROXY` (`1` behind Caddy) · `VAPID_SUBJECT` / `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` (optional) ·
`LOG_LEVEL` · `ANTHROPIC_API_KEY` / `FOOD_AI_MODEL` · `FOOD_DAILY_LIMIT` (the **global** daily AI ceiling for
everybody together, default 150; `0` switches the estimate off) · `FOOD_USER_DAILY_LIMIT` (per account per day,
default 40) — admin-saved limits (`kv.ai_limits`) win over both · `DEV_USERNAME` / `DEV_PASSWORD` /
`DEV_ADMIN_USERNAME` / `DEV_ADMIN_PASSWORD` (**development only**, ignored in production: at start-up create the
user «anna» (role user, the legacy owner when there is none) and the admin «admin» when missing, and set a password
only on an account that has none; e2e and local dev use them).

- **Schema v4** (accounts, `docs/multi-user.md` §2): `users` (32-hex id, username + unique lower-case key, scrypt
  hash or NULL, role, created, password provenance, last activity, disabled, own AI limit, `legacy_owner`),
  `user_settings`, `sessions` (+ `user_id`, `legacy`), `ai_usage (user_id, Kyiv date, count)`, `invites` and
  `password_resets` (hashed tokens, expiry, used / revoked); every per-user table (`days`, `weights`, `measures`,
  `foods`, `photos`, `push_subscriptions`, `reminder_log`) is rebuilt with `user_id` (FK `ON DELETE CASCADE`) in its
  primary key (photos and subscriptions keep their global id / endpoint key plus an owner column). The migration runs
  in one transaction followed by `PRAGMA foreign_key_check`; it moves `kv.password_hash`, `kv.settings` and today's
  `kv.food_budget` count into the **legacy owner** «anna» (role **user**, id `LEGACY_OWNER_ID` =
  `00000000000000000000000000000001` unless `kv.legacy_user` names one, so every re-migration of this installation's
  v3 data gives her the same id), copies every row and session to her (sessions stay valid and are marked legacy),
  and creates **no admin** and no known password. A fresh database gets no users. **`kv` after v4**:
  `vapid_public_key`, `vapid_private_key`, `login_failures` (the global login cap), `food_budget` (the global AI
  counter of the Kyiv day) and `ai_limits` (admin-saved `{ perUser, global }`); `legacy_user` only on a database
  downgraded to v3.
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
  The v4 migration's snapshot is `backups/legko-pre-v4-<date>.db`; pre-migration and pre-downgrade snapshots are never
  replaced (a second one the same Kyiv day is `…-<date>-2.db`, …). **Rollback to the build before accounts**: check
  `deploy.sh status` first (only when `previous` is a pre-accounts build), stop the app, run
  `node dist/cli.js downgrade-schema [--keep <username>] [--drop-others]` (refuses unless v4; keeps one account —
  `--keep` or the only one — and refuses while any other account owns days, weights, measures, dishes or photos,
  listing per-account per-table counts, unless `--drop-others`; saves `backups/legko-pre-down-v4-<date>.db`; in one
  transaction writes that account's hash, settings and identity to `kv` (`password_hash`, `settings`, `legacy_user`
  — so a re-upgrade restores the same id), drops `kv.ai_limits`, rebuilds the eight tables into the exact v3 shapes
  with only its rows, drops `ai_usage`, `invites`, `password_resets`, `user_settings`, `users`, sets `user_version`
  3), then `deploy/deploy.sh rollback` (DEPLOY.md «Rollback after the users release»). Each `downgrade-schema` run
  steps one version (v4 → v3, then v3 → v2).
- Daily backup `VACUUM INTO ${DATA_DIR}/backups/legko-YYYY-MM-DD.db` at ~03:30 Kyiv time and at start-up if today's is
  missing; keep the newest 30.
- Static: hashed assets `Cache-Control: public, max-age=31536000, immutable`; `index.html`, `sw.js`,
  `manifest.webmanifest` → `no-cache`; SPA fallback to `index.html` for non-`/api` GETs.
  Security headers incl. a CSP (`default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline';
font-src 'self' data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none';
base-uri 'self'; form-action 'self'`).
- CLI (bundled `dist/cli.js`; `deploy/deploy.sh cli <command> [args…]` in production; links are printed to stdout
  with `PUBLIC_ORIGIN`, never logged; the account commands open the live database only at the current schema —
  an older one is refused, exit 1, nothing changed (only the server migrates; a missing or empty database is created
  for a first install) — and `downgrade-schema` opens it without migrating):

  | Command                                                | Behaviour                                                                                                                                                                                                                           |
  | ------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
  | `create-admin <username>`                              | an admin with **no password** + a one-time setup link (24 h) to choose it in the browser; refuses when the name exists (an existing admin → «For a new password link: reset-password-link …»; a regular user → «pick another name») |
  | `create-invite [--admin] [--note <text>]`              | a one-time invite link (7 days), role user or admin                                                                                                                                                                                 |
  | `reset-password-link <username>`                       | a reset link (24 h; a setup link when the account has no password); revokes the account's older pending ones                                                                                                                        |
  | `set-password <username> [--stdin]`                    | hidden prompt twice (or one stdin line); revokes that account's sessions and pending resets (for an admin also the links it created); no username → usage, exit 2                                                                   |
  | `set-role <username> <admin\|user>`                    | never removes the last usable admin; a demotion revokes the target's sessions and the links it created                                                                                                                              |
  | `rename-user <old> <new>`                              | sessions kept; `admin` allowed, `legko` never                                                                                                                                                                                       |
  | `list-users`                                           | username · role · status · created · last activity · AI today (never hashes or tokens)                                                                                                                                              |
  | `list-links`                                           | pending invites / reset / setup links: id · kind · role · for · created by · expiry (never tokens)                                                                                                                                  |
  | `revoke-links --by <username> \| --all`                | revokes the pending links that account created, or every pending link                                                                                                                                                               |
  | `downgrade-schema [--keep <username>] [--drop-others]` | v4 → v3 or v3 → v2 (above); opens the database without migrating                                                                                                                                                                    |

  Exit codes: 0 ok, 1 refused, 2 usage. `GET /api/health` is unauthenticated (used by the Docker healthcheck).

- Logs: one line per request (method, path, status, ms) without bodies or cookies. Never tokens, passwords, hashes,
  push endpoints (host only) or content; account events log ids only (`user <id> created via invite <id>`, `reset
link <id> for user <id> created by …`, `links revoked: N …`). Start-up: `No accounts yet: run … create-admin <name>`
  / `No admin account: …` / `No usable admin account …: run … reset-password-link <name>`, and the AI line with the
  limits in force and their source.

### 3.5 Web app

- Entry: `main.tsx` → `App.tsx` = `AuthGate` → `AppShell` → routes `/`, `/calendar?date=YYYY-MM-DD`,
  `/progress[?period=week|month|q|all]` (selects + stores the period, then removes the param with replace),
  `/settings`, `/settings/:section` (reminders | goals | workouts | meals | appearance | data | account | users;
  anything else → `/settings`; `meals` = «Прийоми їжі», her meal types: view mode, «Змінити» → rename / ↑ ↓ / ✕, add,
  «Повернути стандартні»; «Цілі» also holds the optional Б · Ж · В goals; `account` = «Акаунт»; `users` =
  «Користувачі», admins only — anyone else is redirected to `/settings` before it renders),
  `/reminders` → redirect to `/settings/reminders` (old bookmarks and test notifications), catch-all → `/`.
  Screens export `HomeScreen`, `CalendarScreen`, `ProgressScreen`, `SettingsScreen` (`screens/settings`). These
  files and the exported names are the contract between tasks.
- **Accounts UI** (`docs/multi-user.md` §8–§9). `AuthGate` routes `/invite` and `/reset` **before** the auth status
  (`InviteScreen`, `ResetScreen` in `screens/login/`): the fragment token moves to sessionStorage
  (`legko.linkToken`) and leaves the address bar (`history.replaceState`), then `…/check` decides the state —
  «Посилання не працює» per reason (used / expired / revoked / unknown, with «Увійти» or «Відкрити Легко»), «На цьому
  пристрої вже ввійдено як …» + «Вийти й продовжити» when another account is signed in, or the form (invite: name +
  password + repeat → «Створити акаунт»; reset: «Новий пароль» / setup: «Створення пароля»). Success signs in and
  reloads to `/` (a new account gets «Перші кроки»; an admin after a link flow lands on `/settings/users`). In
  **iOS Safari** (not the home-screen app) success shows a «Готово» state instead (the name to log in with, the
  install steps, «Продовжити в Safari»), and the form has «Скопіювати посилання» for the installed app. The login
  screen has «Імʼя користувача» + «Пароль», the forgot-password hint, the unsent-changes hint, and **«Маю
  посилання»** (paste an invite / reset link into the installed app: `parseLink` → same origin `/invite` / `/reset`
  → that screen, else «Це не схоже на посилання з Легко»). Settings: the last group is «Акаунт» (value = username;
  admins also get «Користувачі» with the account count, and the «Легко · трекер схуднення» caption is hidden for
  them); **«Вийти» is at the bottom of «Акаунт»** (with the profile, «Пароль» (current + new; shows who set it last:
  «Пароль задано … за посиланням від admin»), «Імʼя для входу» and «Підрахунки калорій» — AI left today). Admin and
  account actions are online only (not in the outbox).
- **Data**: `apps/web/src/store/data.ts` — `useAppData()`, `useSettings()`, `useSyncState()`, `dataActions.*`,
  `startSync()`. Screens never call the API for data directly.
  Implementation: zustand state; device cache in IndexedDB (`idb-keyval`, **per account**: `legko.user` = the full
  `SessionUser` of the device user, `legko.data.<id>` / `legko.outbox.<id>` = that account's copy and pending ops;
  the legacy keys `legko.data` / `legko.outbox` written before accounts (or by the old bundle during a rollback) are
  rendered provisionally until `me` says whose they are, then adopted / merged by the legacy owner «anna» — each
  pending op sent once — and left untouched for anyone else); `startSync(owner)` binds one account, and data, ops and
  import carry `X-Legko-User` (§3.2); a 409 `user_mismatch` pauses sync and re-checks the session (never a silent
  wipe of unsent ops). **One signed-in person per device**: signing in as another account wipes the previous copy
  (after the in-app «Увійти як …?» confirm when it still has unsent changes; cancel ends the new session and stays on
  the login screen) and reloads; logout (confirm as before) unsubscribes push (sending the subscription's `auth`),
  ends the session, wipes every `legko.*` key — always trying IndexedDB, verified, with a `localStorage
legko.wipePending` tombstone until it is (no device copy is rendered while it exists) — and reloads to the login
  screen; other tabs reload through `BroadcastChannel('legko.auth')`. An expired session keeps memory and outbox
  (the login screen pre-fills the name). The theme stays per device. Every action → `applyOp` locally (instant UI) →
  persist → append to outbox → flush (`POST /api/ops`, batched, in order). Flush on: change, `online`, app foreground, every 30 s while pending. Network/5xx errors → keep and retry
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
- Macros (Б · Ж · В): a day's macros are the sum of its meals' macros (`dayMacros`). A meal is _complete_ for a
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
- **Budget guard** (Kyiv day): per account (default 40 / day, `FOOD_USER_DAILY_LIMIT`; an admin can set an account's
  own limit, 0 = off for that account) **and** a global ceiling for everybody together (default 150, `FOOD_DAILY_LIMIT`;
  0 = off); admin-saved limits (`kv.ai_limits`) win over the env. One `BEGIN IMMEDIATE` checks and bumps both
  counters (`ai_usage` per account, `kv.food_budget` global). Over the own limit → 429 `rate_limited` «Ліміт
  підрахунків на сьогодні вичерпано»; over the ceiling → 429 «Підрахунки на сьогодні закінчилися. Спробуй завтра».
- **Feature flag**: `GET /api/food/status → { enabled, remainingToday, limitToday }` (`enabled` is false when there
  is no key, the env `FOOD_DAILY_LIMIT` is 0, the account's own limit is 0 or the saved global ceiling is 0; a
  used-up daily limit still reports `enabled: true`; `remainingToday` = min(own left, global left), a whole number
  never above `limitToday` = the account's own limit) — the UI hides the AI buttons and the «Акаунт» block when
  disabled; «Акаунт» shows «Сьогодні ще N з L». A photo estimate reserves the budget before the photo is stored, so a
  refused request stores nothing.
- **Photos are saved** in the day's history (photo diary): the client downscales on device (canvas → JPEG,
  full ≤ 1280 px q≈0.82, thumb ≤ 320 px) and uploads both; server stores files
  `${DATA_DIR}/photos/<id>.jpg` + `<id>_t.jpg` (+ metadata table). `GET /api/photos/:id` and `/api/photos/:id/thumb`
  (auth, owner only — another account's id is a 404, also as a recalculation `photoId`; `Cache-Control: private,
max-age=31536000, immutable`, `Vary: Cookie`, deliberately no `ETag` / `Last-Modified`, so another session never
  gets a 304). Photos **belong to a meal** (`Meal.photos`) and to an account (`photos.user_id`;
  files stay flat in `${DATA_DIR}/photos/`); the day cap stays 12 across its meals, and `DayEntry.photos` is their
  derived union (a legacy day keeps its own list). Photos referenced by none of **their owner's** days and meals and
  older than 24 h are garbage-collected daily (another account referencing an id keeps nothing alive); the GC query
  reads the meals through `json_each(CASE WHEN json_valid(meals) THEN meals ELSE '[]' END)` and **keeps every photo
  of an account** (warning, no content) while one of its `days.meals` is not valid JSON, so a photo only that row
  references is never deleted. Deleting an account removes its photo files after the commit. Photos are not part of
  the JSON export (they live in the server backups).
- **Frequent dishes («Часті страви»)**: part of AppData (`foods`), synced through ops, usable offline. Every position
  added from an estimate or a dish records `food.use` {name, portion, kcal, protein?, fat?, carbs?, date} with the
  meal's «Зберегти» (upsert by case-insensitive name: count+1, latest portion/kcal, lastUsed; macros per §3.1 — a
  key is omitted when unknown). The meal editor shows the top ~10 by count & recency as chips
  («Вівсянка з бананом · 350»); tapping adds a position with the dish's kcal and macros (none when the dish has none).
  `food.delete` removes one (edit mode).
- Endpoints: `POST /api/food/estimate` `{ date, text?, image?: { full: base64 JPEG, thumb: base64 JPEG } }` →
  `{ photoId?, items: [{ name, portion, kcal, protein, fat, carbs }], totalKcal, comment }` (photo stored before the
  model call; each macro a number or null). The _recalculate_ mode returns kcal **and** macros by index. Request
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
  _recalculate_ mode with all rows `{ name, portion }` (her values are authoritative) plus the stored `photoId` for
  context; only the changed rows take the new kcal and macros (a pinned value survives). Counts as one estimate
  against the daily budget. Loading state «Рахую калорії…». The meal's photos show as a thumbnail strip (tap →
  full-screen viewer, remove); the «Їжа» list shows them under each meal row and the calendar under its «Їжа» row.
  «Зберегти» sends `meal.put` (+ the `food.use` of the positions added in this editor); nothing reaches the day
  before that.

## 4. Conventions

- TypeScript strict, no `any`, no non-null assertions on data that can really be missing. Small, named functions.
- Comments: English, only where intent is non-obvious. UI copy: Ukrainian.
- Accessibility: real `<button>`s, `aria-label` on icon-only buttons, `aria-pressed` on toggles, `role="switch"`
  - `aria-checked` on switches, labels for inputs, visible focus ring (global `:focus-visible`).
- Tests: Vitest (`*.test.ts(x)` next to code). Pure logic must be unit-tested.
- Before finishing any task: `pnpm -r typecheck`, `pnpm lint`, `pnpm -r test` must pass for the files you own
  (other tasks may be mid-flight — ignore errors that are clearly in files you do not own, but report them).
- Never commit secrets. Never touch files owned by another task unless your brief says so.
