# «Клієнти» — the admin as a coach (read-only CRM)

Owner request (2026-10-22): «админка — это не просто аккаунт с расширенными настройками, нужна CRM, админ должен видеть
прогресс и данные каждого, как тренер». Owner decisions (final): the admin is a **coach** who sees every non-admin
account's records and progress **read-only**; **desktop-first** CRM that still works on the phone; a clients table with
attention flags; a client detail page that **reuses** the client's own Progress / Calendar / day views; transparency
copy in three places; strict server-side security.

Same 1b «Свіжість» look and redesign-A kit (`docs/redesign-a.md`): tokens only, Manrope, the 1b radii, lavender `--acc`
(«more than the goal», never red) and mint `--acc2` («good»), light + dark, `ListGroup` / `ListRow`, `StatStrip`,
`Pill`, `Segmented`, `Chip`, `ScreenHeader back`, `LineChart` / `BarChart`. Desktop uses the existing shell (248px
sidebar). The authorization model of `docs/multi-user.md` §4 stays the base: this document adds one **read-only**
path to it.

Reading order: §1 decisions → §2 security → §3 API → §4 formulas → §5 web → §6 UX → §7 copy → §8 tests → §9 packages.
§12 lists the reasons behind the less obvious choices; §10 / §11 are risks and owner questions; §13 records the
review round (what changed and why).

---

## 0. Summary

| Area | Before | After |
| --- | --- | --- |
| Admin | manages accounts; «Чужих записів адміністратор не бачить» | also a **coach**: «Клієнти» = every `role = 'user'` account's records and progress, **read-only** |
| API | `admin/*` never returns records | `GET /api/coach/clients`, `GET /api/coach/clients/:id`, `GET …/photos/:photoId[/thumb]`; admin only, **GET only** |
| Server data access | `data.forUser(id)` (read + write) | + separate **reader factories** `DataReaders.readerFor(ClientId)` / `PhotoReaders.readerFor(ClientId)` (read only). They are **not on `RouteDeps`**: `createApp` hands them only to `createCoachAccess`. Only `resolveClient` mints a `ClientId`. 4 new SQL statements, all scoped, **no new allowlist entry** |
| Summaries / flags | — | pure functions in `packages/shared/src/coach.ts`, computed **in the browser** from compact per-client digests (one request for the whole table) |
| Web | Progress / Calendar read the global store | `ProgressBody` (controlled, injected `AppData`, `onOpenDay`, `className`), `useShownMonth` (own file), `PhotoUrlsProvider`; the client's own screens behave exactly as before (`useToday` untouched) |
| Navigation | 4 sections for everyone | admins: desktop sidebar + «Клієнти» (5 items); phone tab bar «Клієнти» **replaces** «Прогрес»; users unchanged |
| Transparency | — | Users page role copy rewritten; «Акаунт» (users only) and the invite page: «Адміністратор бачить твої записи та прогрес.» |

---

## 1. Decisions

| # | Decision | Why |
| --- | --- | --- |
| C1 | **Clients = accounts with `role = 'user'`** (any status). Admins are never clients: not in the list, `404` on their id — the actor's own id included. A demoted admin becomes a client at once; a promoted client disappears at once (role read on every request, multi-user D17). | Owner: «admin cannot read other admins' data». |
| C2 | **Read-only by construction**: every coach route is `app.get`; `registerCoachRoutes(app, deps: Pick<RouteDeps, 'auth' \| 'admin'>, coach: CoachAccess)` (no `data`, no `photos`; `coach` is **not** a `RouteDeps` field, so no other route module can reach it); `coach/access.ts` only holds **reader** objects that have no write method; a coach-lint test plus a runtime route-table test pin all of it. Hono serves `HEAD` through the `GET` route: the coach handlers answer `HEAD` with `405` + `Allow: GET` **before** calling access (no read, no log line). Any other method on `/api/coach/**` answers `403 forbidden_origin` (CSRF guard, no Origin / JSON) or `404 not_found` (no route; `OPTIONS` included). Nothing but `GET` is ever 2xx. | «enforced server-side, every coach endpoint is GET-only». |
| C3 | **One read-only path**: `createDataAccess(db, now, logger) → { repos: DataRepos; readers: DataReaders }` and `createPhotoAccess(…) → { store: PhotoStore; readers: PhotoReaders }` share one set of prepared statements; `createDataRepos` / `createPhotoStore` stay as thin wrappers returning `.repos` / `.store` (every existing caller unchanged). `RouteDeps.data` / `.photos` keep their exact types; the `readers` go **only** into `createCoachAccess`. `readerFor(id: ClientId)` takes a branded id that only `resolveClient` mints (after the `role === 'user'` check), so passing an admin's `UserId` does not compile. Statements use `user_id = ?`; the scope lint (`db/scope.test.ts`) checks them like every other statement — **zero new allowlist entries** (still 28). | Keeps the scope lint meaningful and makes «admin cannot read admins» a type rule, not only a runtime check. |
| C4 | **Summaries are computed in the browser**, from one list response with a compact digest per client (settings, all weigh-ins and measurements, per-day digests of a 35-day window, first / last record date). The server computes nothing time-relative. | The browser clock defines «today» everywhere in this app (`lib/stats` takes `today`); e2e fixes the browser clock but not the server's, so server-side «last 7 days» would make e2e non-deterministic. No N+1: the server runs a constant 7 indexed statements per client. |
| C5 | The formulas live in **`packages/shared/src/coach.ts`** (pure, `now` passed in) and are used by the list (digests from the server) **and** the detail page (digests built from the full `AppData` by `coachItemFromData`) — so the table and the detail header always agree. A web parity test pins them to `lib/stats` (`weightSummary`, `valueChange`, `workoutStats`, `macroAverages`). | One source of truth; no drift from the client's own Progress maths. |
| C6 | **«Today» of a client = the client's own time zone** (`settings.timezone`, invalid → `Europe/Kyiv`) at the admin's current instant (`clientToday`). Averages and «записи» use **completed days before today** (today is still in progress for everybody); weight and workouts of «this week» use Monday … today, like Home / Progress. | A coach compares full days; a half-logged today must not drag averages down or raise a flag. |
| C7 | **Attention flags** (exact rules §4.4): `inactive` (7+ days without app activity), `no_records` (3+ full days without any record, or nothing ever after 3 days), `no_weigh_in` (the planned weigh-in day of the last 6 days passed with no weigh-in; reminder off → 8+ days), `kcal_over` (average of the last 7 full days > goal + 10 %, at least 3 days with kcal). `inactive` hides `no_records` and `no_weigh_in` (implied). Disabled / pending accounts get no flags. | Owner list, with thresholds that do not nag a brand-new or a fine-but-busy client. |
| C8 | Coach data lives **only in memory** on the admin's device (component state): never IndexedDB, never local/session storage, never the zustand app store, never the outbox. The admin's own device copy and sync are untouched. Logout already reloads the page (multi-user D12). | Another person's records must not outlive the session on a shared computer. |
| C9 | Responses: `Cache-Control: private, no-store` on every handler response (JSON and photos); photos also `Vary: Cookie`, `Content-Type: image/jpeg`, `X-Content-Type-Options: nosniff`. The service worker never routes `/api/*` (unchanged). | «cache headers private/no-store». |
| C10 | **One log line per coach data access** (who, which client, never content): `coach: admin <adminId> listed <n> clients <from>..<to>: <clientId>,<clientId>,…` (ids only, in `users.list()` order; `none` when there are no clients) · `coach: admin <adminId> read client <clientId>` · `coach: admin <adminId> viewed a photo of client <clientId>` (only when bytes were served) · `coach: admin <adminId> found no such photo of client <clientId>` (client resolved, photo not theirs / missing; no photo id) · `coach: admin <adminId> was refused <clientId \| "a malformed id">`. Info level. `HEAD` logs nothing (it reads nothing, C2). Coach reads never touch the client's `last_seen_at`. | Owner decision 6; the audit log never records a view that did not happen. |
| C11 | The detail response is the client's `AppData` with **`foods: []`** («Часті страви» are not shown to the coach). By construction: `DataReader.read()` returns `Omit<AppData, 'foods'>` and never runs the foods statement; access adds `foods: []`. The list never contains meal text, notes or photos. | Minimum exposure; the UI needs nothing else. |
| C12 | **Navigation**: desktop sidebar for admins = Головна · Календар · Прогрес · **Клієнти** · Налаштування; phone tab bar for admins = Головна · Календар · + · **Клієнти** · Налаштування (replaces «Прогрес»; the coach's own Progress stays reachable from Home's week row). No new Settings row (the admin list keeps its D30 height budget). Users: unchanged. | Desktop-first owner; one tap on the phone; no layout change for clients. Owner question Q1. |
| C13 | Desktop `/coach*` pages use a **wide shell**: `AppShell` root `max-width: 1440px` (other pages keep 1280). The table has **8 columns** (secondary values folded into two-line cells, §6.1) and `min-width: 880px`, so it fits the 960px content width at 1280×800 without scrolling (a gate check pins `scrollWidth <= clientWidth` there). Below that it scrolls inside its own region (both axes on desktop, sticky header row + sticky name column); the page itself never scrolls sideways. | 1280 − 248 sidebar − 2 × 36 padding = 960px; a 10-column table did not fit (≈1 150px). |
| C14 | **Reuse, not copies**: Progress tab = `ProgressBody` (the client's own Progress, controlled period, coach copy, no «+ Записати …»); Overview = `WeightCard` + `MeasuresCard` + the progress model; Calendar = `MonthCard` + `buildMonth` + `useShownMonth`; day view = `buildDayDetail` + `foodDayModel` + `DayNutritionCard` + `PhotoStrip` (via `PhotoUrlsProvider`). New presentational code only where the client app has no read-only equivalent (table, list rows, day view rows, nutrition-by-day table). | Owner decision 4. |
| C15 | Transparency (non-negotiable): exactly three copy changes (§7). Gender-neutral wording (multi-user D22). | Owner decision 5. |
| C16 | No new `ApiErrorCode`, no new table, no migration, no new dependency. | Smallest safe change. |

---

## 2. Security model (server)

### 2.1 Layers

```
GET /api/coach/...        requireAuth ── 401 unauthorized (no / dead session)
                          requireAdmin ─ 403 forbidden (role ≠ admin, read from users on every request)
                          routes/coach.ts  (Pick<RouteDeps,'auth'|'admin'> + coach, app.get only; HEAD → 405)
                              │  raw :id, query, :photoId
                              ▼
                          coach/access.ts  createCoachAccess({ users, data: DataReaders, photos: PhotoReaders, logger })
                              │  assertCoach(actor): role !== 'admin' → throws NotCoach   (first line of list / detail / photo → 403)
                              │  resolveClient: users.byId(raw) must exist and be role 'user' → ClientId (else null → 404, logged)
                              ▼
                          dataReaders.readerFor(ClientId)   photoReaders.readerFor(ClientId)   ← read-only objects, frozen
                              │
                              ▼  SQL: every statement `WHERE user_id = ? …` (scope lint)
```

`RouteDeps` is **unchanged**: no route module other than `routes/coach.ts` receives `coach`, and none receives the
reader factories.

### 2.2 `db/data.ts` — the read-only reader (server-coach)

```ts
/** A user id that `coach/access.ts#resolveClient` checked to be an existing role-'user' account. Minted nowhere else (lint). */
export type ClientId = UserId & { readonly __coachClient: true };

/** Read-only view of one user's records. There is no write method on it (coach lint pins the key list). */
export interface DataReader {
  /** Days, weights, measures and settings — never foods (the foods statement is not run). */
  read(): Omit<AppData, 'foods'>;
  /** Same as DataRepo.settings(). */
  settings(): Settings;
  /** All weigh-ins, oldest first. */
  weights(): WeightEntry[];
  /** All measurements, oldest first. */
  measures(): MeasureEntry[];
  /** Days with from <= date <= to, oldest first. */
  daysBetween(from: ISODate, to: ISODate): { date: ISODate; entry: DayEntry }[];
  /** Earliest / latest date ≤ `to` that has a day, a weigh-in or a measurement; null when none. */
  recordSpan(to: ISODate): { first: ISODate | null; last: ISODate | null };
}

export interface DataRepos { forUser(id: UserId): DataRepo }   // unchanged
/** Not part of RouteDeps; createApp passes it only to createCoachAccess. */
export interface DataReaders { readerFor(id: ClientId): DataReader }

/** One set of prepared statements behind both. */
export function createDataAccess(db: Database, now?: () => number, logger?: Logger): { repos: DataRepos; readers: DataReaders };
/** Unchanged signature and behaviour: `createDataAccess(...).repos` (backup, cli, reminders, tests keep using it). */
export function createDataRepos(db: Database, now?: () => number, logger?: Logger): DataRepos;
```

`readerFor` returns `Object.freeze({ read, settings, weights, measures, daysBetween, recordSpan })` built on the
existing prepared statements (`allDays`, `allWeights`, `allMeasures`, `getSettings` + `dayFromRow`,
`measureFromRow`, settings parsing — shared with `forUser`, not copied: `readSettings` and a `readCore(id)` helper
(days + weights + measures + settings) move to the factory scope; `forUser(id).read()` = `{ ...readCore(id), foods:
readFoods() }`, `reader.read()` = `readCore(id)`) plus **four new statements**:

```sql
SELECT date, food, kcal, trained, types, notes, photos, meals FROM days
  WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date
SELECT MIN(date) AS first, MAX(date) AS last FROM days WHERE user_id = ? AND date <= ?
SELECT MIN(date) AS first, MAX(date) AS last FROM weights WHERE user_id = ? AND date <= ?
SELECT MIN(date) AS first, MAX(date) AS last FROM measures WHERE user_id = ? AND date <= ?
```

Three separate span statements on purpose: a `UNION` over two per-user tables would need an allowlist entry (scope
lint rule «a statement naming two or more per-user tables»). Each is served by the `(user_id, date)` primary key.

### 2.3 `photos/store.ts` — the photo reader (server-coach)

```ts
export interface PhotoReader {
  /** Bytes of a photo OWNED by this user, else null (same `owned` statement as UserPhotos.read). */
  read(id: string, variant: PhotoVariant): Promise<Uint8Array<ArrayBuffer> | null>;
}
export interface PhotoStore { …existing, unchanged… }
/** Not part of RouteDeps; createApp passes it only to createCoachAccess. */
export interface PhotoReaders { readerFor(id: ClientId): PhotoReader }   // ClientId from db/data.ts
export function createPhotoAccess(db, dir, now?, logger?): { store: PhotoStore; readers: PhotoReaders };
/** Unchanged signature and behaviour: `createPhotoAccess(...).store`. */
export function createPhotoStore(db, dir, now?, logger?): PhotoStore;
```

### 2.4 `coach/access.ts` (new, server-coach)

```ts
/** The actor is not an admin (routes already answer 403 before this; defence in depth). */
export class NotCoach extends Error { override name = 'NotCoach' }

export interface CoachAccess {
  /** Every client (role user, any status), in users.list() order, with its digest for `window`. Logs one line. */
  list(actor: AuthedUser, window: CoachWindow): CoachClientItem[];
  /** One client's profile + full copy (foods: []), or null when `rawId` is not a client. Logs one line. */
  detail(actor: AuthedUser, rawId: string): CoachClientResponse | null;
  /**
   * A photo of that client: bytes, null when the photo is not theirs / missing, or 'no_client' when `rawId` is not
   * a client. `photoId` is already validated by the route. Logs one line.
   */
  photo(actor: AuthedUser, rawId: string, photoId: string, variant: PhotoVariant):
    Promise<Uint8Array<ArrayBuffer> | null | 'no_client'>;
}

export function createCoachAccess(deps: {
  users: Pick<UserRepo, 'byId' | 'list'>;
  data: DataReaders;
  photos: PhotoReaders;
  logger: Logger;
}): CoachAccess;
```

Rules inside:

- `assertCoach(actor)`: `actor.role !== 'admin'` → `throw new NotCoach()`. It is the **first statement** of `list`,
  `detail` and `photo` (before `users.list`, `users.byId` or any reader call).
- `resolveClient(actor, rawId): { id: ClientId; row } | null`: `assertCoach(actor)`; `users.byId(rawId)` (null for a
  malformed id) → null; `row.role !== 'user'` → null (admins, the actor included); else `row.id as ClientId` — the
  **only** `as ClientId` in the server (lint). `list` mints the same way after its `role === 'user'` filter, through
  one private `asClient(row)` helper that both use. Exported for unit tests only.
- `profile(row): CoachClient` = `{ id, username, status, createdAt, lastSeenAt }` where `status` = `disabled` when
  `disabledAt !== null`, else `pending` when `passwordHash === null`, else `active`. **Never** any other column.
- `list`: `users.list().filter(role === 'user')`, for each: `reader = data.readerFor(row.id)`, item =
  `{ client, settings: reader.settings(), weights: reader.weights(), measures: reader.measures(),
  days: reader.daysBetween(from, to).map(({ date, entry }) => digestDay(date, entry)),
  firstRecord, lastRecord }` with `{ first, last } = reader.recordSpan(to)`. 7 statements per client, no per-day
  query.
- `detail`: `{ client: profile(row), data: { ...reader.read(), foods: [] } }` (the type `Omit<AppData,'foods'>`
  forces the explicit `foods: []`).
- `photo`: `photos.readerFor(clientId).read(photoId, variant)`; log «viewed a photo» only when bytes !== null, else
  «found no such photo».
- Log lines exactly as C10 (`rawId` echoed only when it matches `/^[0-9a-f]{32}$/`).

### 2.5 `http/routes/coach.ts` (new, server-coach)

```ts
export const COACH_ROUTES = {
  clients: '/api/coach/clients',
  client: '/api/coach/clients/:id',
  photo: '/api/coach/clients/:id/photos/:photoId',
  thumb: '/api/coach/clients/:id/photos/:photoId/thumb',
} as const;
export const COACH_CACHE_CONTROL = 'private, no-store';
export function registerCoachRoutes(
  app: Hono<AppEnv>,
  deps: Pick<RouteDeps, 'auth' | 'admin'>,
  coach: CoachAccess,
): void;
```

Every route: `app.get(path, auth, admin, handler)`. Each handler starts with `if (c.req.method === 'HEAD')` → `405`,
`Allow: GET`, `Cache-Control: private, no-store`, empty body — no access call, no log line (Hono routes `HEAD`
through `GET`; the `auth` / `admin` middlewares still run first, so a user's `HEAD` is 403). Every response a handler
returns (200 **and** its 400 / 404 / 405) gets `Cache-Control: private, no-store` (helper `privateNoStore(c)`); 401 /
403 from the middlewares keep the global `no-store`. `NotCoach` thrown by access → `403 forbidden`
(`MESSAGES.forbidden`).

`RouteDeps` and `http/routes/deps.ts` are **unchanged**. `createApp` wiring (no self-reference inside the
`routeDeps` literal):

```ts
const photoAccess = createPhotoAccess(db, deps.photosDir, now, logger);
const photos = photoAccess.store;                       // was createPhotoStore(...)
const dataAccess = createDataAccess(db, now, logger);
const routeDeps: RouteDeps = { …, data: dataAccess.repos, photos, … };      // same fields as today
const coach = createCoachAccess({ users, data: dataAccess.readers, photos: photoAccess.readers, logger });
…
registerAdminRoutes(app, routeDeps);
registerCoachRoutes(app, { auth: routeDeps.auth, admin: routeDeps.admin }, coach);
```

`http/errors.ts` gains `MESSAGES.badWindow = 'Некоректний період'`.

### 2.6 Coach lint (`apps/server/src/coach/coach-lint.test.ts`, server-coach)

Reads the non-test sources under `apps/server/src` (same walker as the scope lint) and fails when:

1. `http/routes/coach.ts` contains `\.(post|put|patch|delete|all|on|use|route|mount)\(` **anywhere** (chained calls
   included; the file therefore avoids `Promise.all(` / `Map#delete(` — it needs neither), has fewer than 4 `app.get(`, or its `registerCoachRoutes` parameters are not exactly
   `deps: Pick<RouteDeps, 'auth' | 'admin'>, coach: CoachAccess`;
2. the identifier `\breaderFor\b` (not only the call) appears in any file other than `db/data.ts`, `photos/store.ts`
   (definitions) and `coach/access.ts`; `\.readers\b` appears anywhere but `http/app.ts`; `as ClientId` appears
   anywhere but `coach/access.ts`;
3. `createCoachAccess(` / `registerCoachRoutes(` are called anywhere but `http/app.ts`; the type `CoachAccess` is
   imported anywhere but `http/app.ts`, `http/routes/coach.ts` and `coach/**`; `http/routes/deps.ts` mentions
   `coach` or `Reader`;
4. `coach/access.ts` contains `.forUser(`, `.apply(`, `.replaceAll(`, `.setTimezone(`, `.save(`, or an SQL literal
   (`SELECT|INSERT|UPDATE|DELETE|REPLACE` inside a string);
5. (runtime, in `access.test.ts` / `data-reader.test.ts`) `Object.keys(readers.readerFor(id)).sort()` ≠
   `['daysBetween','measures','read','recordSpan','settings','weights']`, `Object.keys(photoReaders.readerFor(id))`
   ≠ `['read']`, or a reader is not frozen.

The text lint is the second layer; the first is the type system (readers absent from `RouteDeps`, `ClientId`
brand). A **runtime route-table test** in `test/coach.test.ts` adds a third: on the real app (TestServer exposes
`app`), `app.routes.filter(r => r.path.startsWith('/api/coach'))` must all have `method === 'GET'` and their path
set must equal `Object.values(COACH_ROUTES)` — so a non-GET or an extra coach path registered by **any** module
fails (the global `app.use('/api/*')` entries have path `/api/*` and are not matched).

`db/scope.test.ts` is **not** edited: it already lints the four new statements and its probe still flags exactly the
28 allowlisted ones.

---

## 3. API contract (`packages/shared`, contracts)

### 3.1 `packages/shared/src/coach.ts` (new, exported from `index.ts`)

```ts
import { z } from 'zod';

/** Longest window `GET /api/coach/clients` accepts, days inclusive. */
export const COACH_WINDOW_MAX_DAYS = 62;
/** The web asks for [deviceToday − 33, deviceToday + 1]: 30 full days + the week + one day of time-zone slack each way. */
export const COACH_WINDOW_BACK = 33;
export const COACH_WINDOW_AHEAD = 1;
export const COACH_PERIODS = [7, 30] as const;
export type CoachPeriod = (typeof COACH_PERIODS)[number];

export const ATTENTION_RULES = {
  kcalOverRatio: 0.1,     // flag when avg > kcalGoal × 1.10 (strictly)
  kcalWindowDays: 7,      // full days before today
  kcalMinDays: 3,         // days with kcal needed in that window
  emptyFullDays: 3,       // full days without any record
  newAccountDays: 3,      // «nothing ever recorded» flags only from this account age on
  inactiveDays: 7,        // whole days since the last activity (lastSeenAt ?? createdAt)
  weighWindowDays: 6,     // the planned weigh-in day is looked for in [today − 6, today − 1]
  weighFallbackDays: 8,   // weigh-in reminder off: days since the last weigh-in
} as const;

export type CoachClientStatus = 'active' | 'disabled' | 'pending';

/** What the coach sees of an account — never hashes, sessions, tokens, push subscriptions, invites, AI usage. */
export interface CoachClient {
  id: string;
  username: string;
  status: CoachClientStatus;
  /** Epoch ms («з 9 жовтня 2026»). */
  createdAt: number;
  /** Epoch ms of the last app activity (≥ 5 min granularity); null = never signed in since registration. */
  lastSeenAt: number | null;
}

/** One stored day reduced to what the table needs (a pure function of the DayEntry; no time dependence). */
export interface CoachDay {
  date: ISODate;
  /** day.kcal (the derived sum on a meal day), null when unknown. */
  kcal: number | null;
  /** dayMacros(day). */
  macros: MacroGrams;
  /** dayMacroComplete(day, key) per key. */
  complete: Record<MacroKey, boolean>;
  trained: boolean | null;
  /** mealsOf(day).length (a legacy food day = 1). */
  meals: number;
}

export interface CoachWindow { from: ISODate; to: ISODate }

export interface CoachClientItem {
  client: CoachClient;
  settings: Settings;
  /** All weigh-ins, oldest first. */
  weights: WeightEntry[];
  /** All measurements, oldest first. */
  measures: MeasureEntry[];
  /** Digests of the stored days in [from, to], oldest first (stored days are never empty). */
  days: CoachDay[];
  /** Earliest / latest date ≤ `to` with a day, weigh-in or measurement (all time, not only the window). */
  firstRecord: ISODate | null;
  lastRecord: ISODate | null;
}

export interface CoachClientsResponse extends CoachWindow { clients: CoachClientItem[] }
/** `data.foods` is always [] (C11). */
export interface CoachClientResponse { client: CoachClient; data: AppData }

/** Query of GET /api/coach/clients: both valid dates, from ≤ to, at most COACH_WINDOW_MAX_DAYS days inclusive. */
export const coachWindowSchema: z.ZodType<CoachWindow>;   // z.object({ from: isoDateSchema, to: isoDateSchema }).refine(...)

export const coachClientsPath = (w: CoachWindow): string;            // '/api/coach/clients?from=2026-09-11&to=2026-10-15'
export const coachClientPath = (id: string): string;                 // `/api/coach/clients/${encodeURIComponent(id)}`
export const coachPhotoUrl = (clientId: string, photoId: string): string;       // `${coachClientPath(id)}/photos/${enc(photoId)}`
export const coachPhotoThumbUrl = (clientId: string, photoId: string): string;  // `${coachPhotoUrl(...)}/thumb`

export function digestDay(date: ISODate, day: DayEntry): CoachDay;
/** Date in `timeZone` at `now`; an invalid zone falls back to DEFAULT_TIMEZONE. */
export function clientToday(timeZone: string, now: Date): ISODate;
/** The window the web requests: device-local today (iso(now)) − COACH_WINDOW_BACK … + COACH_WINDOW_AHEAD. */
export function coachWindow(now: Date): CoachWindow;
/** The list item the server would send, built from a full copy (detail page): same digests, same span rule. */
export function coachItemFromData(client: CoachClient, data: AppData, window: CoachWindow): CoachClientItem;

export type AttentionKind = 'inactive' | 'no_records' | 'no_weigh_in' | 'kcal_over';
export const ATTENTION_ORDER: readonly AttentionKind[] = ['inactive', 'no_records', 'no_weigh_in', 'kcal_over'];
export type AttentionFlag =
  | { kind: 'inactive'; days: number; never: boolean }
  | { kind: 'no_records'; days: number | null; last: ISODate | null }
  | { kind: 'no_weigh_in'; missed: ISODate | null; last: ISODate | null; days: number | null }
  | { kind: 'kcal_over'; avg: number; goal: number; overPct: number; days: number };

export interface CoachSummary {
  /** The client's today (C6). */
  today: ISODate;
  period: CoachPeriod;
  status: CoachClientStatus;
  /** Some record exists on or before the window end. */
  hasRecords: boolean;
  weight: {
    current: number | null; date: ISODate | null;
    /** Week (Mon…today) for period 7, [today − 29, today] for 30; valueChange semantics. */
    change: number | null;
    /** current − first; null below two weigh-ins. */
    sinceStart: number | null;
    goal: number;
    /** 0–100 unrounded (weightSummary.pct rule); null without weigh-ins. */
    goalPct: number | null;
    /** max(0, current − goal); null without weigh-ins. */
    left: number | null;
  };
  kcal: { avg: number | null; days: number; goal: number };
  macros: { avg: MacroGrams; days: number; goals: MacroGoals };
  /** plannedSoFar = plan days already behind us in the range (tone «behind» only when done < plannedSoFar). */
  workouts: { done: number; planned: number; plannedSoFar: number };
  logged: { days: number; of: number };
  lastRecord: ISODate | null;
  lastSeenAt: number | null;
  /** In ATTENTION_ORDER; [] for disabled / pending accounts. */
  flags: AttentionFlag[];
}

export function coachSummary(item: CoachClientItem, now: Date, period: CoachPeriod): CoachSummary;
/** More flags first, then the more severe first flag (ATTENTION_ORDER); 0 on a tie (the caller sorts by name). */
export function compareAttention(a: CoachSummary, b: CoachSummary): number;
```

`api.ts` gains `coachClients: '/api/coach/clients', // GET ?from=&to= → CoachClientsResponse (admin)` and the header
comment «`coach/*` needs an admin's session and is GET only; it reads other accounts' records, never changes them».

### 3.2 Endpoint table

| Method · path | Auth | 200 | Errors (status `code`) |
| --- | --- | --- | --- |
| GET `/api/coach/clients?from=&to=` | admin | `CoachClientsResponse` | 401 `unauthorized` · 403 `forbidden` · 400 `bad_request` «Некоректний період» (missing / invalid date, to < from, > 62 days) |
| GET `/api/coach/clients/:id` | admin | `CoachClientResponse` | 401 · 403 · 404 `not_found` (malformed id, unknown id, an admin — the caller included) |
| GET `/api/coach/clients/:id/photos/:photoId` | admin | `image/jpeg` (full) | 401 · 403 · 400 `bad_request` `MESSAGES.badPhotoId` (photo id format, checked first) · 404 `not_found` (not a client; photo not that client's; file missing) |
| GET `/api/coach/clients/:id/photos/:photoId/thumb` | admin | `image/jpeg` (thumb) | as above |
| HEAD on the four coach paths | as GET | never | 401 · 403 (middlewares) · otherwise `405` + `Allow: GET`, empty body, nothing read, nothing logged |
| POST / PUT / PATCH / DELETE `/api/coach/**` | — | never | 403 `forbidden_origin` (no same-origin `Origin` / JSON) · otherwise 404 `not_found` |
| OPTIONS `/api/coach/**` | — | never | 404 `not_found` (no route) |
| existing `GET /api/photos/:id[/thumb]` | session | unchanged | an admin asking for a client's photo there still gets 404 (owner check unchanged) |

Headers: §C9. The `X-Legko-User` header is not needed on coach routes (only `data` / `ops` / `import` require it); a
present header must equal the admin's own id as everywhere (`requireAuth`).

---

## 4. Summaries and attention flags (exact rules, `coachSummary`)

Notation: `T` = `clientToday(settings.timezone, now)`; `P` = period (7 | 30); `[a, b]` inclusive ISO ranges;
`D(d)` = the `CoachDay` of date d (absent = nothing stored that day); `W` = weigh-ins with `date ≤ T`; `M` =
measurements with `date ≤ T`; `ok(n)` = finite number. All rounding happens in the web formatting, except
`overPct` (`Math.round`) and `kcal_over.avg` (`Math.round`).

### 4.1 Values

| Value | Rule |
| --- | --- |
| `weight.current`, `.date` | the latest of `W` |
| `weight.change` | `valueChange(W, from, T)` with `from` = `mondayOf(T)` (P 7) or `T − 29` (P 30): last value in range − (last value before `from`, else the first in range when the range has ≥ 2), else null — identical to `lib/stats/range.ts` |
| `weight.sinceStart` | `current − first(W)` when `W` has ≥ 2 entries, else null |
| `weight.goalPct` | `first > goal ? clamp((first − current) / (first − goal) × 100, 0, 100) : 0`; null without `W` (= `weightSummary.pct`) |
| `weight.left` | `max(0, current − goal)`; null without `W` |
| `kcal.avg`, `.days` | mean of `D(d).kcal` over `d ∈ [T − P, T − 1]` with `ok(kcal)`; `days` = how many; null when 0 |
| `macros.avg`, `.days` | per key: mean of `D(d).macros[key]` over `d ∈ [T − P, T − 1]` where the value is not null **and** `D(d).complete[key]`; `days` = days counted for at least one key (= `macroAverages`) |
| `workouts.done` | count of `d` with `D(d).trained === true` in `[mondayOf(T), T]` (P 7) or `[T − 29, T]` (P 30) |
| `workouts.planned` | `settings.rem.workout.days.length` (P 7), `Math.round(len × 30 / 7)` (P 30) — the same «план» Home and Progress use (the reminder may be off) |
| `workouts.plannedSoFar` | count of dates `d` in `[mondayOf(T), T − 1]` (P 7) or `[T − 29, T − 1]` (P 30) with `weekdayOf(d) ∈ rem.workout.days` (today is not over yet). The web tones the cell lavender only when `done < plannedSoFar`, neutral otherwise (so Monday's «0 / 3» is not «behind») |
| `logged.days`, `.of` | `of` = P; `days` = dates in `[T − P, T − 1]` that have a `D(d)`, a weigh-in or a measurement |
| `lastRecord` | the latest of: `D` dates ≤ T, `W` dates, `M` dates, `item.lastRecord` when ≤ T; null when none |
| `hasRecords` | `lastRecord !== null \|\| item.firstRecord !== null` |

### 4.2 Why these windows

- Completed days for kcal, Б · Ж · В and «записи»: every client is mid-day at the moment the coach looks; their
  Progress screen (which includes today) remains available one tab away.
- Monday … today for «this week» weight and workouts: the same words mean the same numbers as on the client's Home.
- 30 days for P 30 mirror Progress «Місяць» (`today − 29`).

### 4.3 Flags — status gate

`status !== 'active'` → `flags = []`. Otherwise compute the four candidates below, then: when `inactive` is present
drop `no_records` and `no_weigh_in`; order by `ATTENTION_ORDER`.

### 4.4 Flags — rules

| Kind | Raised when | Payload |
| --- | --- | --- |
| `inactive` | `ref = lastSeenAt ?? createdAt`; `days = floor(max(0, now − ref) / 86 400 000)`; `days ≥ 7` | `{ days, never: lastSeenAt === null }` |
| `no_records` | (a) `lastRecord === null` and account age `floor(max(0, now − createdAt) / day) ≥ 3`; or (b) `gap = diffDays(lastRecord, T) − 1 ≥ 3` (that many **full** days before today without any record, and none today) | (a) `{ days: null, last: null }` · (b) `{ days: gap, last: lastRecord }` |
| `no_weigh_in` | reminder on (`rem.weigh.on`): `missed` = the latest `d ∈ [T − 6, T − 1]` with `weekdayOf(d) === rem.weigh.day`; raised when `missed` exists, no weigh-in in `[missed, T]`, and `item.firstRecord !== null && firstRecord < missed` (never nags someone who started after that day). Reminder off: `last` = latest of `W`; raised when `last` and `diffDays(last, T) ≥ 8`, or no `last` and `firstRecord` and `diffDays(firstRecord, T) ≥ 8` | on: `{ missed, last, days: null }` · off: `{ missed: null, last, days: last ? diffDays(last, T) : null }` |
| `kcal_over` | over `d ∈ [T − 7, T − 1]` with `ok(D(d).kcal)`: `n ≥ 3` and `avg > kcalGoal × 1.10` (exactly +10 % is not raised) | `{ avg: round(avg), goal: kcalGoal, overPct: round((avg / kcalGoal − 1) × 100), days: n }` |

Boundary examples (unit-tested): T = Wed 2026-10-14, weigh day Monday → `missed` = 2026-10-12; a weigh-in on
2026-10-13 clears it; T = Mon 2026-10-12 (the weigh day itself) → no `missed` in [Tue 6 … Sun 11] → not raised.
`lastRecord` = 2026-10-11 → gap 2 → not raised; 2026-10-10 → gap 3 → «3 дні без записів». Seven days of 1 870 with
goal 1 700 → exactly +10 % → not raised; 1 871 → raised, «Калорії +10% за 7 днів». `plannedSoFar` with plan
Mon / Wed / Fri: T = Mon → 0, T = Wed → 1, T = Sun → 3.

### 4.5 Default order of the table («за увагою»)

`compareAttention` (more flags first, then the more severe first flag), then active before pending before disabled,
then `username` with `localeCompare(…, 'uk')`.

---

## 5. Web architecture

### 5.1 Routes and guard (web-coach)

| Route | Screen | URL state (replace navigation, validated, invalid → default) |
| --- | --- | --- |
| `/coach` | `CoachClientsScreen` | `days=7\|30` (default 7) · `show=attention\|all` (default all) · `sort=name\|weight\|change\|goalPct\|kcal\|workouts\|logged\|activity` + `dir=asc\|desc` (absent = attention order) · `q=<text>` |
| `/coach/:id` | `CoachClientScreen` | `tab=overview\|progress\|calendar\|nutrition` (default overview) · `days=7\|30` (overview, nutrition) · `period=week\|month\|q\|all` (progress, default week) · `date=YYYY-MM-DD` (calendar; `resolveSelected` → never in the future) |

`App.tsx` adds both routes before the catch-all. `CoachGate` wraps both: `useCurrentUser()` null → render nothing
(AuthGate is still deciding); `role !== 'admin'` → `<Redirect to="/" replace />`. A `403 forbidden` from any coach
call → `authActions.refreshUser()` and the same redirect once the role is known. Detail back link:
`ScreenHeader back={{ href: '/coach', label: 'Клієнти' }}` (`useBackTo`: `history.back()` when opened from the list,
so its filters / sort / search come back; list links stamp `backState('/coach')`). Tabs are links with
`replace` (switching tabs never grows the back stack).

**Keeping the back stamp.** wouter's `navigate(to, { replace: true })` without `state` writes `history.state = null`
and would erase `legkoFrom`, so «‹ Клієнти» would fall back to a bare `/coach` (filters lost) with the list entry
still behind it. Every detail-page param change (tab, `days`, `period`, `date`, the «Історія калорій» rows of the
Progress tab, «Відкрити день →») goes through **one** helper in `screens/coach/nav.ts`:
`useReplaceParams()` → `(href) => navigate(href, { replace: true, state: window.history.state })` (the pattern of
`screens/progress/period.ts`). Tab links render `<Link href replace onClick={e => { e.preventDefault();
replaceKeepingState(href) }}>` (modifier / middle clicks fall through to the browser). The list's own param changes
(`q`, `sort`, `show`, `days`) use the same helper. Tests: after a tab switch, a period change and a date pick
`history.state.legkoFrom === '/coach'`, `history.length` unchanged, and the back control calls `history.back()`.

**Row clicks (desktop table).** The name `Link` is the navigation target. The `<tr>` `onClick` returns early when
`e.defaultPrevented || e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey ||
(e.target as Element).closest('a,button')` or the text selection is non-empty; otherwise it calls
`navigate(href, { state: backState('/coach') })`. One click anywhere on a row = exactly one push with the stamp;
ctrl / middle click on the name opens a new tab and does nothing else.

### 5.2 Navigation (web-coach, `shell/**`)

```ts
// shell/nav.ts
export interface NavItem { href: '/' | '/calendar' | '/progress' | '/coach' | '/settings'; label: string; icon: IconName }
export const NAV_ITEMS: readonly NavItem[];                 // unchanged (the four sections)
export const COACH_NAV_ITEM: NavItem = { href: '/coach', label: 'Клієнти', icon: 'users' };
/** Sidebar: admin → NAV_ITEMS with Клієнти before Налаштування. Tab bar: admin → Клієнти in place of Прогрес. */
export function navItems(isAdmin: boolean, place: 'sidebar' | 'tabbar'): readonly NavItem[];
```

`AppShell` reads `useCurrentUser()?.role === 'admin'`, passes `items` to `Sidebar` / `TabBar` (new required prop),
and adds `s.wide` (`max-width: 1440px`) to the desktop root while `location` is `/coach` or under `/coach/`.
`NAV_SPLIT` stays 2. `isNavActive('/coach', '/coach/<id>')` is true (sub-page → `NavLink` pops back to the list).

**No record button on coach pages.** On `/coach` and `/coach/<id>` `AppShell` passes no `onRecord`: the sidebar has
no «+ Записати день» and the phone tab bar keeps an empty centre slot instead of «+» (the tabs do not move). Next to a
client's name it would read as «record into this client's day», while it writes into the admin's own diary.
`Sidebar` / `TabBar` `onRecord` is optional for that reason. Ordinary users and the admin's own pages are unchanged.

### 5.3 Data loading (web-coach, `screens/coach/useCoachData.ts`)

```ts
export type Load<T> =
  | { status: 'loading' } | { status: 'ready'; value: T; at: number }
  | { status: 'error'; offline: boolean } | { status: 'notFound' } | { status: 'forbidden' };
export function useCoachClients(): { state: Load<CoachClientsResponse>; reload(): void };   // window = coachWindow(new Date())
export function useCoachClient(id: string): { state: Load<CoachClientResponse>; reload(): void };
export function useNow(): Date;   // ticks every 60 s and on focus / visibilitychange
```

Fetch on mount, again when the device date changes (new window) and on `visibilitychange → visible` when the copy is
older than 2 minutes. A stale answer (newer request started) is dropped (sequence number). State is component-local
(C8). `api.ts` gains:

```ts
coach: {
  clients: (w: CoachWindow) => request<CoachClientsResponse>('GET', coachClientsPath(w)),
  client: (id: string) => request<CoachClientResponse>('GET', coachClientPath(id)),
},
```

### 5.4 Data-source injection (web-data) — the client's app stays identical

| Piece | Change | Client app |
| --- | --- | --- |
| `lib/photoUrls.tsx` (new) | `interface PhotoUrls { thumb(id): string; full(id): string }`, `OWN_PHOTO_URLS = { thumb: photoThumbUrl, full: photoUrl }`, `PhotoUrlsProvider({ value, children })`, `usePhotoUrls()` (default `OWN_PHOTO_URLS`) | no provider → same URLs |
| `features/food/PhotoStrip.tsx`, `PhotoViewer.tsx` | read URLs from `usePhotoUrls()` instead of importing `photoThumbUrl` / `photoUrl` | identical |
| `lib/useToday.ts` | **not touched** (the coach page computes the client's today with `clientToday(tz, useNow())`) | identical |
| `screens/progress/ProgressScreen.tsx` | new controlled `ProgressBody` (+ `className`, `onOpenDay`); `ProgressView` = `usePeriod()` + `ProgressBody` (same props as today) | identical |
| `screens/progress/useProgressModel.ts` | `useProgressModel(data, today, period, opts?: { audience?, dayHref? })` — no `usePeriod` inside | identical |
| `screens/progress/model.ts` | `ProgressOptions` + `audience?: 'self' \| 'coach'` (default self) + `dayHref?: (date) => string` (default `calendarDayHref`); coach hints «Зважувань ще немає» / «Замірів ще немає» | identical |
| `screens/calendar/useShownMonth.ts` (new) | the existing `useShownMonth(selected)` moved here verbatim (imports only React + calendar model helpers, **no `@/store/`**); `useCalendarModel.ts` imports it from there | identical |

```ts
// screens/progress/ProgressScreen.tsx
export interface ProgressViewProps { data: AppData; today: ISODate; onRecord?: (mode: 'weight' | 'measure') => void }
export interface ProgressBodyProps extends ProgressViewProps {
  period: Period;
  onPeriodChange: (period: Period) => void;
  /** <h1> title; null = no ScreenHeader (the coach page has its own). Default «Мій прогрес». */
  title?: string | null;
  /** 'coach': third-person empty-chart hints and never a «+ Записати …» button (onRecord ignored). Default 'self'. */
  audience?: 'self' | 'coach';
  /** Where an «Історія калорій» row leads. Default calendarDayHref = `/calendar?date=${date}`. */
  dayHref?: (date: ISODate) => string;
  /** Called with that href on a row click. Default `navigate(href)` (push, exactly today's behaviour). */
  onOpenDay?: (href: string) => void;
  /** Merged into the root ContentGrid's class. */
  className?: string;
}
export function ProgressBody(props: ProgressBodyProps): JSX.Element;
export function ProgressView(props: ProgressViewProps): JSX.Element;  // usePeriod() → ProgressBody
// screens/progress/model.ts
export const calendarDayHref: (date: ISODate) => string;
export const COACH_CHART_HINTS = { weightNone: 'Зважувань ще немає', measureNone: 'Замірів ще немає' } as const;
```

The coach pages deep-import (as the settings screens already do): `ProgressBody`, `WeightCard`, `MeasuresCard`,
`buildProgressModel` (`screens/progress/*`); `MonthCard`, `buildMonth`, `buildDayDetail`, `resolveSelected`,
`stepMonth`, `monthOf` (`screens/calendar/*`), `useShownMonth` (`screens/calendar/useShownMonth`, **not**
`useCalendarModel`); `foodDayModel`, `DayNutritionCard` (`sheets/record/*`); `PhotoStrip` (`@/features/food`);
`dayWord`, `dayTime`, `longDate` (`screens/settings/dates`); `plural` (`screens/settings/model`). Nothing of the
coach pages calls `useAppData`, `dataActions`, `ui.openSheet` or `setTrainedMark`, and no file under `screens/coach`
imports `@/store/` directly (a web-coach test greps the sources; `useCurrentUser` / `authActions` come from
`@/auth/auth`).

### 5.5 Coach screens (web-coach, `screens/coach/**`)

| File | Role |
| --- | --- |
| `index.ts` | `CoachClientsScreen`, `CoachClientScreen` |
| `CoachGate.tsx` | admin-only guard (§5.1) |
| `useCoachData.ts` | §5.3 |
| `nav.ts` | `useReplaceParams()` (replace keeping `history.state`, §5.1), `coachPhotoUrls(id): PhotoUrls` (`thumb: p => coachPhotoThumbUrl(id, p)`, `full: p => coachPhotoUrl(id, p)`), `clientHref(id)` |
| `copy.ts` | every Ukrainian string of §7.2 (`COACH_COPY`, `flagPill(flag)`, `flagDetail(flag, now)`) |
| `clientsModel.ts` (pure) | `buildClientRows(items, now, period) → ClientRowModel[]` (summary + formatted cells + tones + sort values), `neverSeenFlagged(summary)`, `sortRows`, `filterRows(rows, show, q)`, `parseListParams` / `listSearch` |
| `ClientsScreen.tsx` + css | header, toolbar, table (desktop) or list (phone), empty / loading / error states, live count |
| `ClientsTable.tsx` + css | the accessible table (§6.1) |
| `useScrollEdges.ts` | `useScrollEdges` / `scrollEdgesOf` / `scrollLeftToReveal`: which edges of the table region are cut off (the right-edge fade, the name column's shadow) |
| `ClientsList.tsx` + css | phone list (§6.2): `ClientsList({ rows })` and the exported `SortSelect` that `ClientsScreen` puts in the toolbar |
| `FlagPills.tsx` | the pills (Pill `acc`; status pills `neutral`) |
| `clientModel.ts` (pure) | header lines, KPI strip items, flags card rows, tab parsing |
| `ClientScreen.tsx` + css | header, tabs nav, panels, not-found state; wraps everything in `PhotoUrlsProvider` with `coachPhotoUrls(id)` (from `nav.ts`, memoised per id) |
| `OverviewPanel.tsx` | KPIs + flags card + `WeightCard` + `MeasuresCard` (§6.3) |
| `ProgressPanel.tsx` | `ProgressBody` with `title={null}`, `audience="coach"`, `period` from `?period=` (`onPeriodChange` → `useReplaceParams`), `dayHref` → `/coach/<id>?tab=calendar&date=<d>`, `onOpenDay` → `useReplaceParams` |
| `CalendarPanel.tsx` | `MonthCard` + `CoachDayView` |
| `CoachDayView.tsx` + css, `dayViewModel.ts` | read-only day (§6.5) |
| `NutritionPanel.tsx` + css, `nutritionModel.ts` | kcal bars, Б · Ж · В table, meal journal (§6.6) |

The data handed to reused components is the response's `data` (`AppData`) and `today = clientToday(
data.settings.timezone, now)`; summaries use `coachSummary(coachItemFromData(client, data, coachWindow(now)), now, days)`.

### 5.6 Phone vs desktop

`useIsDesktop()` (`DESKTOP_QUERY`) chooses the table or the list on `/coach`. Detail page layout: the header block
(back link, lines, pills, tabs) is a plain full-width block, **not** inside a `ContentGrid`; each panel owns its
layout and is rendered as a direct sibling of it: `OverviewPanel` / `CalendarPanel` / `NutritionPanel` use their own
`ContentGrid` (one column on the phone, two on the desktop, `FullRow` for the KPI strips and the Б · Ж · В table);
`ProgressPanel` renders `ProgressBody` directly (it already is a `ContentGrid`), never nested inside another grid
(test: the progress panel's root is the ProgressBody grid and has no grid ancestor inside the page). No horizontal
page scroll at 320, 390, 1280 (the table region scrolls on its own when narrower than its content).

---

## 6. UX

### 6.1 Desktop list `/coach` (1280×800: content 960px; wide shell up to 1440)

```
┌──────────┬────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Л Легко  │ 6 клієнтів · 4 потребують уваги                                   (subtitle 14 --muted)        │
│          │ Клієнти                                                           (h1 30/700)                  │
│ Головна  │ [ Пошук за імʼям        ]  (Потребують уваги · 4) (Усі · 6)            [ 7 днів | 30 днів ]    │
│ Календар │ ┌─────────────────────────────────────────────────────────────────────────────────────────────┐│
│ Прогрес  │ │ Клієнт ▲        Вага, кг     За       До      Ккал · 7 дн.     Трену-   Записи   Актив-     ││
│●Клієнти  │ │                              тиждень  цілі    Б · Ж · В, г     вання    · 7 дн.  ність      ││
│ Налашт.  │ │─────────────────────────────────────────────────────────────────────────────────────────────││
│          │ │ olya             65,4         −0,4    35% ▬▬  1 950 / 1 700    2 / 3    6 / 7    сьогодні   ││
│          │ │ (Калорії +15%    −2,9 від     кг              Б 92/90 · Ж 48/60                             ││
│          │ │  за 7 днів)      старту                       · В 160                                       ││
│          │ │ marta            71,2         —       12% ▬   1 620 / 1 800    0 / 3    1 / 7    9 жовт.    ││
│          │ │ (4 дні без …)    −1,1 від ст.                 —                                               ││
│          │ │ ivan             —            —       —       —                0 / 3    0 / 7    вчора      ││
│          │ │ (Жодного запису від реєстрації)                                                             ││
│          │ └─────────────────────────────────────────────────────────────────────────────────────────────┘│
│          │ Калорії, Б · Ж · В і записи — за повні дні до сьогодні; тренування — з понеділка;              │
│          │ сигнали — за останні 7 днів.                                                    (13 --muted)  │
└──────────┴────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**8 columns** (budget at 960px, padding 10px each side): Клієнт 190 · Вага 110 (two lines) · За тиждень 85 · До
цілі 110 (% + 48px bar) · Ккал / Б · Ж · В 150 (two lines) · Тренування 85 · Записи 85 · Активність 105 ≈ 920px.
Header labels may wrap to two lines (`white-space: normal`, `max-width` per `th`). The separate «Від старту» and
«Б · Ж · В» columns of the first draft are folded into second lines of «Вага» and «Ккал».

- Toolbar: search `<input type="search">` (label «Пошук за імʼям», 16px, min-height 44, max-width 280), filter
  `ChipGroup aria-label="Показати"` with two `Chip`s (aria-pressed), `Segmented aria-label="Період"` «7 днів | 30
  днів». The count line under the table is an `aria-live="polite"` «Показано 2 з 5» (visually hidden when all show).
- Table surface: `--card`, 1px `--line`, `--r24`, `overflow: clip`; inside, a scroller `<div role="region"
  aria-labelledby={captionId} tabIndex={0}>` with `overflow: auto` on **both axes** and, on the desktop,
  `max-height: calc(100dvh - 220px)` (header + toolbar + note), so the header row can stick; `<table>` `width: 100%`,
  `min-width: 880px`, font 15/500 tabular-nums, `<caption>` visually hidden «Клієнти · за 7 днів».
- Header row: `<th scope="col">` 13/600 `--muted`, padding `12px 10px`, `position: sticky; top: 0; z-index: 2;
  background: var(--card)` (the top-left name header `z-index: 3`); sortable headers contain a full-size
  `<button type="button">` (min-height 44, text + a 12px ▲/▼ glyph `aria-hidden`), `aria-sort` on the `th`
  (`ascending` / `descending` on the sorted column, `none` on the other sortable ones). Every column is sortable
  (the «Вага» header sorts by current weight, «Ккал» by the kcal average). Click cycles **first direction → opposite
  → default (attention)**; the first direction comes from **one** `SORT_FIRST_DIR` map in `clientsModel.ts` shared
  with the phone select: `name asc`, `weight desc`, `change desc` (gain first), `goalPct asc` (least progress first),
  `kcal desc`, `workouts asc`, `logged asc`, `activity asc` (longest ago first). `aria-sort` follows the actual
  direction. Null values sort last in both directions, except «Активність»: a client who has never signed in counts
  as the longest ago (first in `asc`, last in `desc`).
- Numeric headers put the 12px sort glyph **before** the label, so each label ends where its right-aligned numbers
  end; «Клієнт» lines up with the name cells' left edge. When columns are cut off, a fade on the scroller's right
  edge shows there is more; once scrolled, the sticky name column casts a shadow (`useScrollEdges.ts`). The region
  is `position: relative`, so the visually hidden long forms inside cells never widen the page (no page side-scroll
  at 900–1099px windows).
- Body rows: first cell `<th scope="row">` with a `wouter <Link>` (the client's name, 16/600 `--ink`, state
  `backState('/coach')`) and the flag pills under it (gap 6, wrap); the rest of the row is also clickable with the
  mouse under the rules of §5.1 «Row clicks» (one push, never on modifier / middle clicks, never on top of the link).
  Cells `height: 64px` (acts as the minimum in tables; `min-height` on `tr` is ignored by browsers), divider 1px
  `--line2`, `tr:hover > * { background: var(--paper) }`, focus ring on the link. First column sticky: `th[scope=row]
  { position: sticky; left: 0; z-index: 1; background: var(--card) }` + a 1px `--line2` right border, min-width 180.
- Cells (right-aligned numbers): **Вага** `f1`, second line (13 `--muted`) «${sgn(sinceStart, f1)} від старту» in
  `deltaTone` (absent below two weigh-ins); **За тиждень / За 30 днів** `sgn(n, f1)` in `deltaTone` (mint down,
  lavender up, «—» faint); **До цілі** `${round(pct)}%` + a 48px `ProgressBar size="sm" tone="acc"`; **Ккал**
  `f0(avg)` (lavender `--accD` when above the goal, mint `--acc2D` within) + ` / f0(goal)` in `--muted`, second line
  (13 `--muted`) «Б 92/90 · Ж 48/60 · В 160» — the goal after a slash only for the macro goals that are set (each
  average lavender when its rounded value is above its goal; each part wraps whole, so the column does not widen; the
  line is absent without macro days); **Тренування** «2 / 3» («2» when the plan is 0), lavender only when `done <
  plannedSoFar` (§4.1), neutral otherwise; **Записи** «6 / 7» (counts use « / » with no-break spaces: in Manrope a
  lone «з» between digits reads as another «3»; the hidden long forms keep «з»); **Активність** `dayWord(lastSeenAt,
  now)`, or «—» when the row already has the «Ще не входили» pill. Each numeric cell carries a visually hidden long form for screen readers where the short form is ambiguous
  (e.g. «білки 92 г, ціль 90 г, більше цілі»; «калорії 1 950 при цілі 1 700»; «тренувань 0 з 3, за планом на
  сьогодні — 0»).
- Status pills (neutral) in the name cell: «Вимкнено», «Пароль не задано», or «Новий клієнт» (an active account
  with `!hasRecords` and no flag at all yet). The lavender `no_records` flag of an account that has never recorded
  anything reads «Жодного запису від реєстрації», so every pill text has one meaning.

### 6.2 Phone list `/coach` (390×844)

```
 6 клієнтів · 4 потребують уваги
 Клієнти                                   (h1)
 [ Пошук за імʼям                    ]     input 16px, 48 tall
 (Потребують уваги · 4) (Усі · 6)          chips, 44 tall
 [ 7 днів | 30 днів ]  [ За увагою    ▾ ]  Segmented + native <select> (16px, 44 tall) on one row;
                                           the «Сортування» label is visually hidden (still read out)
 ┌──────────────────────────────────────┐
 │ olya                       65,4 кг ›  │  ListRow href (md): title 16/600, value strong
 │ −0,4 за тиждень · 1 950 / 1 700 ккал  │  sub (2-line clamp)
 │ (Калорії +15%)                        │  pills = ListRow children (outside the link), aria-describedby
 │ marta                      71,2 кг ›  │
 │ Записи 1 / 7 · активність 9 жовтня    │
 │ (4 дні без записів) (Без зважування)  │
 │ ivan                             —  › │
 │ (Жодного запису від реєстрації)       │
 └──────────────────────────────────────┘
```

Row sub follows the period: `«<change> за тиждень»` (P 30 «за 30 днів») · `«<kcal avg> / <goal> ккал»` when known,
else `«Записи N / 7»` (P 30 «/ 30») · `«активність …»` (left out when the row has the «Ще не входили» pill). The
toolbar is three rows: search, filter chips, then the 7 / 30 switch and the sort select side by side. The select
offers short, period-independent options «За увагою», «Імʼя», «Вага», «Зміна ваги», «До цілі», «Калорії»,
«Тренування», «Записи», «Активність» (`sortOptionLabel(key)`; `SortSelect` is exported from `ClientsList.tsx` and
placed in the toolbar by `ClientsScreen`);
each option writes `sort` + `dir = SORT_FIRST_DIR[sort]` (§6.1), the same direction the desktop header's first
click gives.

### 6.3 Detail `/coach/:id` — header, tabs and «Огляд» (desktop)

```
 ‹ Клієнти                                                                  (back link 15/600 --accD)
 У Легко з 9 жовтня 2026 · активність: сьогодні, 09:12         (Лише перегляд)   subtitle 14 --muted; Pill neutral
 olya                                                                        (h1 30/700)
 Ціль 60,0 кг · 1 700 ккал на день · Б 90 г · Ж 60 г · 3 тренування на тиждень           (15 --ink2)
 (Калорії +15% за 7 днів)                                                    flags pills (when any)
 [ Огляд ][ Прогрес ][ Календар ][ Харчування ]                         [ 7 днів | 30 днів ]  (overview / nutrition)
 ┌ Зараз ──────────────────────────────────────────────────────────────────────────────────────┐ full row
 │ Вага 65,4 кг · За тиждень −0,4 кг · Від старту −2,9 кг · До цілі 35%                         │ StatStrip 4
 │ Ккал · ціль 1 700: 1 950 · Б · Ж · В: 92 · 48 · 160 г · Тренування 2 / 3 · Записи 6 / 7     │ StatStrip 4
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌ Що варто перевірити ─────────────────────────────────────────────────────────────────────────┐ full row
 │ Калорії +15%                                                                                 │
 │ Середнє за 7 днів — 1 950 ккал при цілі 1 700                                                │
 └──────────────────────────────────────────────────────────────────────────────────────────────┘
 ┌ Вага ──────────────────────────────── 35% шляху ┐  ┌ Заміри тіла ──────────────────────────────┐
 │ 65,4 кг   (−2,9 кг від старту)                   │  │ Груди  94 → 92 см   −2 см  …              │
 │ ▬▬▬▬▬▬░░░░░  Старт 68,3 · ще 5,4 кг · Ціль 60,0 │  │                                           │
 │ ╭─╮_╭╮__ line chart                              │  │                                           │
 └─────────────────────────────────────────────────┘  └───────────────────────────────────────────┘
                                     WeightCard (period q chart) · MeasuresCard, side by side on the desktop
```

- Tabs: `<nav aria-label="Розділи клієнта">` of four `Link`s (`replace`, `aria-current="page"` on the active one),
  styled like `Segmented` (track `--line`, active `--card` + shadow), each min-height 44, padding `0 16px`; on the
  phone the four tabs share the width (they fit at 390); narrower, the strip scrolls horizontally inside itself
  (`overflow-x: auto`, no scrollbar, an edge fade shows there are more) and only the strip itself is scrolled to the
  active tab (never `scrollIntoView`, so the page does not move). Each panel starts with a visually hidden `<h2>` = the tab name.
- KPI strips: `StatStrip columns={2} desktopColumns={4}` (labels exactly as in the sketch; tones per §6.1).
- «Що варто перевірити»: `ListGroup title` with static `ListRow`s (title = pill text, sub = detail, `subWrap`), or
  one static row «Тривожних сигналів немає». Disabled → one row «Акаунт вимкнено — сигнали не рахуються».
- «Що варто перевірити» spans the full width (`ListGroup full`), so «Вага» and «Заміри тіла» sit side by side
  below it on the desktop (one column on the phone).
- New client (`!hasRecords`): the whole panel is one calm card «Ще нічого не записано» + «Записи зʼявляться тут,
  щойно людина почне вести щоденник.» — no KPI strips, no empty check list, no empty weight / measures cards.
- «Лише перегляд» and the neutral status pills of the header sit on the page background, so they use the card fill
  with a hairline ring (visible in both themes).
- Tabs and the 7 / 30 switch change the URL through `useReplaceParams` (§5.1), so the back stamp survives.

### 6.4 «Прогрес» tab

`ProgressBody` exactly as the client sees «Мій прогрес» (sticky `PeriodBar` «Тиждень · Місяць · 3 міс. · Весь
час», summary sentence, Вага, Заміри тіла, Тренування, Харчування with «Історія калорій»), minus the `<h1>`, minus
every «+ Записати …», with the coach hints; «Історія калорій» rows open this client's «Календар» tab on that date,
keeping the coach's current 7 / 30 choice and Progress period in the URL (`calendarHref(id, params, date)`), so
going back to the tab finds them as they were.

### 6.5 «Календар» tab — month + read-only day

```
 ┌ Жовтень 2026 ───────────── ‹ › ┐   ┌ 13 жовтня 2026 ─────────────────── (Повний) ┐  ListGroup lg, Pill
 │ Пн Вт Ср Чт Пт Сб Нд           │   │ вівторок                                     │  subtitle
 │  … month grid, fills …         │   │ ┌ Підсумок дня ──────────────────────────┐  │  DayNutritionCard
 │                                 │   │ │ 1 740 / 1 700 ккал ▬▬▬▬▬▬▬▬▬▬           │  │
 │ (Заливка legend)               │   │ │ Білки 92 / 90 г · Жири … · Вуглеводи … │  │
 └─────────────────────────────────┘   │ └────────────────────────────────────────┘  │
                                       │ Прийоми їжі                                  │  caption
                                       │ Сніданок · 08:30                    420 ккал │  static ListRow, subWrap
                                       │ Тост з тунцем, кава · Б 27 · Ж 11 · В 36 г   │
                                       │ [▣][▣]                                       │  PhotoStrip sm (coach URLs)
                                       │ Обід · 13:10                        640 ккал │
                                       │ Тренування                                   │  sub = buildDayDetail text
                                       │ Кардіо, Йога                                 │  («Було» / «Не було» / «Ще не відмічено»)
                                       │ Вага                           65,4 кг       │
                                       │ Заміри     Груди 92 · Талія 74 · Стегна 98   │
                                       │ Нотатки    «…» (pre-line)                    │
                                       └──────────────────────────────────────────────┘
```

`MonthCard` is the client's own (swipe, ‹ ›, «Заливка» legend); a cell tap sets `?date=` (replace). Day view rows are
static (no chevron, no `onClick`, no `TrainingToggle`, no «Додати», no «Редагувати день»): from each
`buildDayDetail` row the coach view uses **only** `title`, `value`, `valueTone` and `text` — never `label`
(«Вага: додати» …), `action`, `mode` or `trained`; empty values show «—» (`--faint`); an empty day shows one row
«Цього дня нічого не записано». A CoachDayView test asserts that no text matching /додати/i and no button appear. Meal rows come from `foodDayModel(data,
date).rows` (title + time, content, macros line, kcal value, accessible label `mealRowLabel`); each meal's photos
render under its row (`PhotoStrip size="sm" ids={row.photos}`, viewer included). The legacy note of `foodDayModel`
(an instruction to the owner) is not shown. Phone: month card, then the day view.

### 6.6 «Харчування» tab

```
 [ 7 днів | 30 днів ]
 ┌ Калорії по днях ─────────────────────────── ціль 1 700 ккал ┐   BarChart: one bar per day [T − n + 1, T],
 │ ▇ ▆ █ ▅ ▇ ▆ ▃   - - - goal line - - -                      │   tones kcalTone, goal line, weekday labels for 7
 │ (У межах цілі) (Більше цілі)                                │   Legend reused
 │ Сер. за 7 повних днів 1 950 ккал · Днів із калоріями 6      │   StatStrip 2
 └─────────────────────────────────────────────────────────────┘
 ┌ Б · Ж · В по днях ──────────────────────────────────────────┐   <table>: День | Ккал | Білки · ціль 90 | Жири ·
 │ День        Ккал    Білки   Жири   Вуглеводи                │   ціль 60 | Вуглеводи; values f0, lavender above the
 │ Вт, 13 жовт 1 740   92      48     160                      │   goal, partial days (not complete) in --muted with
 │ Пн, 12 жовт 1 980   71*     …                               │   «*» + hidden «пораховано не для всіх прийомів»
 └─────────────────────────────────────────────────────────────┘   footnote «* — пораховано не для всіх прийомів»
 Журнал харчування                                               newest first, 7 days, then «Показати ще»
 ┌ Вт, 13 жовтня ────────────────────────────── 1 740 ккал ┐      ListGroup per day (title, headerRight value),
 │ Сніданок · 08:30 · 420 ккал — тост з тунцем, кава       │      static meal rows (no photos here), footer link
 │ …                                    [Відкрити день →]  │      → «Календар» tab on that date
 └──────────────────────────────────────────────────────────┘
```

Rows of the table are days with any food in the window (newest first); «За цей період калорій ще немає» when none.
«Відкрити день →» keeps the 7 / 30 choice and the Progress period as well (`NutritionPanel` takes `params`).

### 6.7 Phone detail (390×844)

Same order in one column: back link, header lines, pills, the tabs strip (scrolls inside itself), then the panel.
Targets ≥ 44, inputs ≥ 16px, no horizontal page scroll at 320 (the Б · Ж · В table drops to «День · Ккал · Б · Ж · В»
headers below 400px wide).

### 6.8 States

| State | List | Detail |
| --- | --- | --- |
| loading | «Завантажую…» (`role="status"`) | same |
| error | «Не вдалося завантажити» + «Спробувати ще раз» | same |
| offline | «Потрібен інтернет» + retry | same |
| 403 | refresh role → redirect `/` | same |
| 404 | — | «Клієнта не знайдено» + «Можливо, акаунт видалили або він став адміністратором.» + back link |
| no clients | «Клієнтів ще немає» + «Запроси людину в розділі «Користувачі».» + link «Відкрити «Користувачі»» → `/settings/users` | — |
| filter attention, none | «Зараз ніхто не потребує уваги» | — |
| search, none | «Нікого не знайдено за «ол»» | — |

---

## 7. Copy

### 7.1 Transparency (web-copy) — exactly these three

| Where | Before | After |
| --- | --- | --- |
| Users page → role change to admin (`usersModel.roleConfirm('admin')` body) | «Адміністратор бачить список акаунтів і може запрошувати, вимикати й видаляти їх. Чужих записів адміністратор не бачить. Він може видати посилання для нового пароля — людина про це дізнається.» | «Адміністратор бачить усі акаунти, а також записи й прогрес кожного користувача — лише для перегляду, змінити їх він не може. Він запрошує, вимикає й видаляє акаунти та може видати посилання для нового пароля — людина про це дізнається.» |
| Users page → role change to user (body) | «Розділ «Користувачі» зникне для цього акаунта.» | «Розділи «Користувачі» й «Клієнти» зникнуть для цього акаунта, а його записи й прогрес бачитимуть адміністратори.» |
| Settings → «Акаунт», profile card, **role user only** | — | third line, 13/500 `--muted`: «Адміністратор бачить твої записи та прогрес.» (`ACCOUNT_COPY.adminSees`) |
| Invite registration page (`InviteScreen`, **inside the form, directly above the «Створити акаунт» button**, so it is read before registering, keyboard open or not) | — | `<p className={s.hint}>` «Адміністратор бачить твої записи та прогрес.» (`INVITE_ADMIN_NOTE`) |

No pop-up, no banner, nothing else. The user sheet of the Users page also gets, for `role === 'user'` accounts other
than yourself, a static link row «Записи й прогрес» (icon `chart`) → `/coach/<id>` (navigation only, no notice).

### 7.2 Coach copy (web-coach, `screens/coach/copy.ts`)

| Key | Text |
| --- | --- |
| nav / title | «Клієнти» |
| count line | `${n} ${plural(n,'клієнт','клієнти','клієнтів')}` + ` · ${a} ${a === 1 ? 'потребує' : 'потребують'} уваги` (omitted when a = 0) |
| search | label «Пошук за імʼям», placeholder «Імʼя» |
| filters | group «Показати»; «Потребують уваги · N», «Усі · N» |
| period | group «Період»; «7 днів», «30 днів» |
| sort (phone) | «Сортування» (visually hidden label); «За увагою», «Імʼя», «Вага», «Зміна ваги», «До цілі», «Калорії», «Тренування», «Записи», «Активність» (not period-aware) |
| columns (8) | «Клієнт», «Вага, кг» (second line «${sgn} від старту»), «За тиждень» / «За 30 днів», «До цілі», «Ккал · 7 дн.» / «Ккал · 30 дн.» (second line «Б ${p} · Ж ${f} · В ${c}», each followed by «/${goal}» when that goal is set, e.g. «Б 85/80 · Ж 51/60 · В 178»), «Тренування» (title «за тиждень» / «за 30 днів»), «Записи · 7 дн.» / «Записи · 30 дн.», «Активність» |
| phone row sub | «${change} за тиждень» / «за 30 днів» · «${avg} / ${goal} ккал»; «Записи ${n} / 7» / «/ 30» · «активність ${dayWord}» (or «ще не входили», left out when the row has that pill) |
| counts | cells, KPI tiles and the phone line write counts «a / b» with no-break spaces («2 / 3», «6 / 7»); screen-reader long forms keep «з» («тренувань 2 з 3 …») |
| table note | «Калорії, Б · Ж · В і записи — за повні дні до сьогодні; тренування — з понеділка; сигнали — за останні 7 днів.» (P 30: «…; тренування — за 30 днів; сигнали — за останні 7 днів.») |
| live count | «Показано ${n} з ${total}» |
| pills | inactive «Не заходить ${n} ${plural(n,'день','дні','днів')}» / never «Ще не входили»; no_records «${n} ${plural(…)} без записів» / never recorded «Жодного запису від реєстрації»; no_weigh_in «Без зважування»; kcal_over «Калорії +${overPct}% за 7 днів» (both periods: the rule is always 7 days); status «Вимкнено», «Пароль не задано»; neutral «Новий клієнт» (active, nothing recorded, no flag at all); header «Лише перегляд». «Ще не входили» appears once per row / header: with that pill the activity cell is «—» and the phone line / header subtitle leave it out |
| flag details | inactive «Остання активність — ${dayWord}» / «Після реєстрації ще не входили»; no_records «Останній запис — ${dLong(last)}» / «Від реєстрації — жодного запису»; no_weigh_in (on) «Зважування за планом — ${DOW_SHORT}, ${dLong(missed)}» + (last ? « · останнє ${dLong(last)}» : « · зважувань ще не було»), (off) «Останнє зважування — ${dLong(last)}» / «Ще жодного зважування»; kcal_over «Середнє за ${days} ${plural(days,'день','дні','днів')} — ${f0(avg)} ккал при цілі ${f0(goal)}» |
| header | «У Легко з ${longDate(createdAt)} · активність: ${dayTime(lastSeenAt)}» (never: «· ще не входили», omitted when the «Ще не входили» pill shows; the line never starts with «З» + a digit, which in Manrope reads as «3»); goals «Ціль ${f1(goal)} кг · ${f0(kcalGoal)} ккал на день» + only the **set** macro goals, each with its unit, e.g. « · Б 90 г · Ж 60 г» (nothing when none is set) + « · ${n} ${plural(n,'тренування','тренування','тренувань')} на тиждень» (n > 0) |
| tabs | «Огляд», «Прогрес», «Календар», «Харчування»; nav label «Розділи клієнта» |
| overview | «Зараз»; KPI labels «Вага», «За тиждень» / «За 30 днів», «Від старту», «До цілі», «Ккал · ціль ${f0(goal)}», «Б · Ж · В», «Тренування», «Записи»; «Що варто перевірити»; «Тривожних сигналів немає»; «Акаунт вимкнено — сигнали не рахуються»; «Ще нічого не записано» / «Записи зʼявляться тут, щойно людина почне вести щоденник.» |
| day view | «Прийоми їжі», «Тренування» (text reused from `buildDayDetail`: types / «Було» / «Не було» / «Ще не відмічено»), «Вага», «Заміри», «Нотатки», «Цього дня нічого не записано» |
| nutrition | «Калорії по днях», «Сер. за ${n} повних днів», «Днів із калоріями», «Б · Ж · В по днях», «День», «Ккал», «Білки», «Жири», «Вуглеводи», «ціль ${g}», «* — пораховано не для всіх прийомів», «Журнал харчування», «Показати ще», «Відкрити день →», «За цей період калорій ще немає» |
| states | «Завантажую…», «Не вдалося завантажити», «Спробувати ще раз», «Потрібен інтернет», «Клієнта не знайдено», «Можливо, акаунт видалили або він став адміністратором.», «Клієнтів ще немає», «Запроси людину в розділі «Користувачі».», «Відкрити «Користувачі»», «Зараз ніхто не потребує уваги», «Нікого не знайдено за «${q}»» |

Apostrophes are always «ʼ» (U+02BC: «імʼя», «зʼявляться»), as in the rest of the app; the copy tests assert the
exact strings, including both kcal pill periods and both phone-sub periods.

---

## 8. Tests

### 8.1 Unit / integration (Vitest)

| Behaviour | Where (package) |
| --- | --- |
| `digestDay` (legacy day, meal day, partial macros, no kcal), `clientToday` (zone, invalid zone → Kyiv, day boundary), `coachWindow`, `coachWindowSchema` (missing, invalid, to < from, 62 ok / 63 refused), path helpers (encoding), every row of §4.1, every flag rule incl. the §4.4 boundaries, suppression by `inactive`, disabled / pending → no flags, `ATTENTION_ORDER`, `compareAttention`, `coachItemFromData` ≡ a server-style item (window filter + span) for the same data | `packages/shared/src/coach.test.ts` (contracts) |
| reader: `daysBetween` inclusive bounds + order, `recordSpan(to)` over days / weights / measures with future rows ignored, two users with the same dates never mix, key list + frozen; `reader.read()` has **no `foods` key** even when the user has foods rows; `createDataRepos(...)` still equals `createDataAccess(...).repos` behaviour (existing db tests green); `PhotoReaders.readerFor` reads only its owner's photos, keys `['read']` | `apps/server/src/db/data-reader.test.ts`, `apps/server/src/photos/store.test.ts` (server-coach) |
| access: `list` / `detail` / `photo` with a user actor throw `NotCoach` **and call neither `users.list` / `users.byId` nor any `readerFor`** (spies); admin / self / unknown / malformed → null; list = only role user (disabled and pending included with their status); detail `foods: []`; profile has exactly `id, username, status, createdAt, lastSeenAt`; log lines (C10) with a capturing logger — «viewed a photo» only when bytes were served, «found no such photo» otherwise (no photo id in it) — never containing seeded note / meal text | `apps/server/src/coach/access.test.ts` (server-coach) |
| coach lint (§2.6 rules 1–5) | `apps/server/src/coach/coach-lint.test.ts` (server-coach) |
| **routes, negative authz**: the **route-table** check (§2.6: every `/api/coach*` route is GET, paths = `COACH_ROUTES`); every coach route → 401 without a session, 403 for a user (anna, about herself and about another user), 404 for the admin's own id, another admin's id, unknown and malformed ids; POST / PUT / PATCH / DELETE on every coach path → 403 without Origin, 404 with Origin + JSON, and every owned row of every user byte-identical afterwards; HEAD as a user → 403, HEAD as the admin → 405 + `Allow: GET`, no log line, rows unchanged; OPTIONS → 404; window 400s; headers (`private, no-store`, photo `Vary: Cookie` + `image/jpeg` + nosniff); photo: anna's photo via her path 200 (bytes equal), via user B's path 404, the admin's own photo via anna's path 404, B's photo via B's path 200, malformed photo id 400; user B `GET /api/photos/<anna photo>` 404 and a user on the coach photo route 403; the response never has a key named like a secret (`password*`, `*hash*`, `token*`, `session*`, `endpoint`, `p256dh`, `auth`, `invite*`); role changes act at once (promote anna → 404; demote a second admin → listed; demote the caller → 403); a coach read leaves the client's `last_seen_at` unchanged | `apps/server/test/coach.test.ts` (server-coach) |
| `PhotoUrlsProvider` / `usePhotoUrls` default; PhotoStrip + viewer use the provided URLs; `ProgressBody` (controlled period, `title={null}`, coach hints, no record button even with `onRecord`, `dayHref` used by history rows, `onOpenDay` called with that href, `className` on the root); `ProgressView` / `ProgressScreen` unchanged (existing tests green; a history row still pushes `/calendar?date=`); `useShownMonth` in its own file, re-used by `useCalendarModel` | `apps/web/src/lib/*.test.ts(x)`, `features/food/PhotoStrip.test.tsx`, `screens/progress/*.test.ts(x)`, `screens/calendar/useShownMonth.test.tsx` (web-data) |
| nav (`navItems` for user / admin × sidebar / tab bar), AppShell wide class on `/coach*`, routes + `CoachGate` (user → `/`, admin → screen, 403 → refresh + redirect), `api.coach.*`, `clientsModel` (cells, tones incl. workouts vs `plannedSoFar`, `SORT_FIRST_DIR` + the 3-state cycle, nulls last, filters, search, URL params), `ClientsTable` (th scope, aria-sort, keyboard toggling, link per row, pills; one click on the name and one on a numeric cell → exactly one push with `legkoFrom: '/coach'`, ctrl+click on the row → none), `ClientsList` (sub text for both periods), `clientModel` (goals line lists only set macros), `useReplaceParams` (tab / period / date keep `history.state`, back → `history.back()`), `ClientScreen` (progress panel not nested in another grid), panels (no button that writes; no «Додати» / «Редагувати день» / toggle), `CoachDayView` (no /додати/i), `copy.ts` exact strings, `nutritionModel`, no `@/store/` import under `screens/coach`, **parity** with `lib/stats` on the progress fixtures | `apps/web/src/shell/*.test.tsx`, `apps/web/src/lib/api.test.ts`, `apps/web/src/screens/coach/**/*.test.ts(x)` (web-coach) |
| account line (user yes, admin no), invite line (inside the form, before the submit button in document order), both role confirms, the user-sheet «Записи й прогрес» link (user rows only, not self) | `screens/settings/account/*.test.ts(x)`, `screens/login/InviteScreen.test.tsx`, `screens/settings/users/*.test.ts(x)` (web-copy) |

### 8.2 e2e (Playwright, port 3399, one run at a time — **only e2e-gate runs it**)

| Spec | Owner | Scenarios |
| --- | --- | --- |
| `e2e/coach-api.spec.ts` (new) | server-coach | real bundle, API only: 401 / 403 (anna) on all four coach routes; admin list contains anna + a seeded throwaway client, never the admin or a promoted throwaway admin (finally demoted + deleted); detail of anna = her `getData()` with `foods: []`; admin id / malformed / unknown → 404; window 400s; `no-store` headers; no secret-like keys; POST / PUT / PATCH / DELETE with Origin → 404 and anna's data unchanged; HEAD as the admin → 405; a photo id that does not exist → 404, malformed → 400 |
| `e2e/coach.spec.ts` (new) | web-coach | both projects. Admin sees «Клієнти» (sidebar / tab bar), anna does not and `/coach` sends her home; seeded throwaway clients (`seedClient` with `coachOverKcal`, `coachQuiet`, `coachMeals`, `coachEmpty`) filtered by a unique search tag: cells, pills («Калорії +15% за 7 днів», «4 дні без записів», «Без зважування», «Жодного запису від реєстрації»), filter chip, 7 / 30 switch, header sort cycle with `aria-sort` (desktop) / the select (phone); detail: header, «Лише перегляд», tabs; **back-stamp flow**: open `/coach?q=<tag>&sort=kcal&dir=desc` → a client → «Календар» tab → pick a day → «‹ Клієнти» → the URL still has the query and `history.length` is unchanged; «Прогрес» has the cards and no «+ Записати …»; «Календар» day 2026-10-13 shows the meals and their photos, requested from `/api/coach/clients/<id>/photos/…` (page.route serves `FOOD_JPEG`), never from `/api/photos/`; no request other than GET reaches `/api/coach/**` and no `/api/ops` during the flow; 404 page for the admin's own id; phone: no side scroll at 390 and 320 on list and detail (`expectNoSideScroll` exported from `e2e/support/coachUi.ts`) |
| `e2e/account.spec.ts`, `e2e/invite.spec.ts`, `e2e/users-admin.spec.ts` | web-copy | anna's «Акаунт» shows «Адміністратор бачить твої записи та прогрес.», the admin's does not; the invite page shows it; promote confirm shows the new body (cancel); the user sheet's «Записи й прогрес» opens `/coach/<id>` |
| `e2e/visual.spec.ts`, `e2e/a11y.spec.ts` | e2e-gate | stubbed coach API (`stubCoachClients`, `stubCoachClient`, `stubCoachPhotos` from `e2e/fixtures/coach.ts`, relative to `FIXED_NOW`): shots `70-coach-list` (desktop + iphone, light + dark), `71-coach-list-attention`, `72-coach-overview` (olya), `73-coach-progress`, `74-coach-calendar` (sofia, `?tab=calendar&date=2026-10-13`), `75-coach-nutrition` (sofia), `76-coach-empty` (ivan), `77-coach-list-320` (iphone), `78-coach-list-narrow` (desktop at 1000px wide, table region scrolled right: sticky name column over the cells). Shots are plain PNGs written by `shot()` (`page.screenshot({ path })`); nothing is a `toHaveScreenshot` baseline and `e2e/__screenshots__` is untracked — the gate **opens each new / changed PNG with the Read tool and reviews it**: 70–78, `04-invite*` (invite line), `49-settings-account*` (account line), `40-settings-admin`, `491*`–`495*` (user sheet row, admin tab bar), and every desktop admin shot (sidebar gains «Клієнти»). a11y at 390 and 320 (+ desktop): no horizontal page scroll, targets ≥ 44, inputs ≥ 16 (existing helpers); **new helpers the gate writes**: table `th[scope=col]` / `th[scope=row]`, `aria-sort` values, keyboard (Tab to the «Клієнт» header button → Enter → `ascending` → Enter → `descending` → Enter → `none`), visible focus ring (computed `outline` / `box-shadow` on `:focus-visible`), tab links `aria-current="page"`, the table region focusable, the header row still visible after scrolling the region to the last row, and at 1280×800 with the stub payload `region.scrollWidth <= region.clientWidth`; the «Акаунт» line and the invite line: computed `font-size >= 13px` and `color` equal to the resolved `var(--muted)` at 390 and 320 (there is no existing contrast checker and no axe) |
| all other specs | e2e-gate | unchanged; must stay green (they run as anna or test admin flows that do not use the «Прогрес» tab) |

Rules (as `docs/multi-user.md` §11.2): never change anna / admin; throwaway clients via `createUser` and disposed in
`finally`; a promoted admin is demoted / deleted in `finally`; the server clock is real while the browser's is
fixed — never assert `createdAt` / `lastSeenAt` wording or the `inactive` flag against the real server (unit-tested
instead); visual / a11y specs stub the coach API.

### 8.3 e2e support contract (contracts)

```ts
// e2e/fixtures/coach.ts — data sets relative to TODAY (Wed 2026-10-14), default settings (weigh-in Monday, plan Mon/Wed/Fri,
// kcalGoal 1700, macro goals set only in coachMeals) and stub payloads relative to FIXED_NOW.
export function coachSteady(today?: ISODate): AppData;   // 5 weeks, weigh-ins every Monday (incl. 2026-10-12), kcal ≈ 1 600, no flags
export function coachOverKcal(today?: ISODate): AppData; // as steady, but [today−7, today−1] kcal 1900,1950,2000,1950,1900,2000,1950 → «Калорії +15%»
export function coachQuiet(today?: ISODate): AppData;    // records up to 2026-10-09 only → «4 дні без записів» + «Без зважування»
export function coachMeals(today?: ISODate): AppData;    // steady + 2026-10-13 with Сніданок 08:30 (2 positions, photos COACH_PHOTO_IDS[0..1]),
                                                         //   Обід 13:10, Вечеря 19:00; macroGoals { protein: 90, fat: 60, carbs: null }; trained + «Кардіо»
export function coachEmpty(): AppData;                   // onboarded, nothing recorded
export const COACH_PHOTO_IDS: readonly string[];         // valid photoIdSchema ids
export const COACH_STUB_IDS: Readonly<Record<'olya' | 'marta' | 'ivan' | 'sofia' | 'taras' | 'petro', string>>;  // fixed 32-hex ids
// 6 clients built with coachItemFromData + coachWindow(now); createdAt now − 40 d unless stated:
//   olya  = coachOverKcal, lastSeenAt now − 1 h        → «Калорії +15% за 7 днів»
//   marta = coachQuiet,    lastSeenAt now − 5 d        → «4 дні без записів», «Без зважування»
//   ivan  = coachEmpty,    createdAt now − 10 d, lastSeenAt now − 1 d → no_records (a) «Жодного запису від реєстрації», activity «вчора»
//   sofia = coachMeals,    lastSeenAt now − 2 h        → no flags; meals + photos on 2026-10-13; macro goals set
//   taras = coachSteady,   status 'disabled'           → «Вимкнено», no flags
//   petro = coachEmpty,    createdAt now − 10 d, lastSeenAt null → inactive «Ще не входили»
export function coachClientsPayload(now?: Date): CoachClientsResponse;
export function coachClientPayload(name: keyof typeof COACH_STUB_IDS, now?: Date): CoachClientResponse;
// e2e/support/coachApi.ts
export function coachWindowAt(now?: Date): CoachWindow;                            // coachWindow(FIXED_NOW)
export function getCoachClients(api: ServerApi, window?: CoachWindow | null, headers?: Record<string, string>): Promise<APIResponse>;  // null = no query
export function getCoachClient(api: ServerApi, id: string): Promise<APIResponse>;
export function getCoachPhoto(api: ServerApi, clientId: string, photoId: string, variant?: 'full' | 'thumb'): Promise<APIResponse>;
export function sendToCoach(api: ServerApi, method: 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string, withOrigin?: boolean): Promise<APIResponse>;
export function seedClient(playwright: Playwright, admin: ServerApi, data: AppData, prefix?: string): Promise<TestUser>;  // createUser + importData
export function secretKeysIn(value: unknown): string[];                            // paths of keys matching /password|hash|token|session|endpoint|p256dh|^auth$|invite/i
export function stubCoachClients(page: Page, payload: CoachClientsResponse): Promise<void>;
export function stubCoachClient(page: Page, payload: CoachClientResponse): Promise<void>;
export function stubCoachPhotos(page: Page, jpeg: Buffer): Promise<string[]>;      // returns the requested URLs (live array)
// e2e/support/coachUi.ts (web-coach) — page helpers over roles and the §7.2 copy:
// openClients(page), clientsRegion(page), clientRow(page, name), sortBy(page, column), search(page, q),
// showFilter(page, 'Потребують уваги' | 'Усі'), setDays(page, 7 | 30), openClient(page, name), clientTab(page, tab),
// dayView(page), navHasClients(page): Promise<boolean>,
// expectNoSideScroll(page, what) — exported, same body as the private one in e2e/a11y.spec.ts (spec files must not
// import other spec files: that registers their tests twice); coach.spec and visual.spec import it from here.
```

coachMeals' 2026-10-13 must stay within the steady kcal band so sofia raises no flag; `e2e/visual.spec.ts` asserts the
precondition before shooting 74 (`coachClientPayload('sofia').data.days['2026-10-13'].meals` carries
`COACH_PHOTO_IDS[0..1]`, and sofia's summary has no flags).

---

## 9. Work packages

```
   ┌───────────┐   ┌──────────┐   ┌──────────┐
   │ contracts │   │ web-data │   │ web-copy │        (parallel, no dependencies)
   └─────┬─────┘   └────┬─────┘   └────┬─────┘
    ┌────┴─────────┐    │              │
┌───▼──────────┐ ┌─▼────▼────┐         │
│ server-coach │ │ web-coach │         │              (parallel)
└───────┬──────┘ └─────┬─────┘         │
        └──────────────┼───────────────┘
                 ┌─────▼────┐
                 │ e2e-gate │  visual / a11y · docs · full gate
                 └──────────┘
```

| Package | Owned paths |
| --- | --- |
| contracts | `packages/shared/src/coach.ts`, `packages/shared/src/coach.test.ts`, `packages/shared/src/api.ts`, `packages/shared/src/index.ts`, `e2e/fixtures/coach.ts`, `e2e/support/coachApi.ts` |
| server-coach | `apps/server/src/coach/**`, `apps/server/src/db/data.ts`, `apps/server/src/db/data-reader.test.ts`, `apps/server/src/photos/store.ts`, `apps/server/src/photos/store.test.ts`, `apps/server/src/http/routes/coach.ts`, `apps/server/src/http/app.ts`, `apps/server/src/http/errors.ts`, `apps/server/test/coach.test.ts`, `apps/server/test/helpers.ts`, `e2e/coach-api.spec.ts` |
| web-data | `apps/web/src/lib/photoUrls.tsx`, `apps/web/src/lib/photoUrls.test.tsx`, `apps/web/src/features/food/PhotoStrip.tsx`, `apps/web/src/features/food/PhotoViewer.tsx`, `apps/web/src/features/food/PhotoStrip.test.tsx`, `apps/web/src/screens/progress/**`, `apps/web/src/screens/calendar/useCalendarModel.ts`, `apps/web/src/screens/calendar/useShownMonth.ts`, `apps/web/src/screens/calendar/useShownMonth.test.tsx` |
| web-coach | `apps/web/src/screens/coach/**`, `apps/web/src/App.tsx`, `apps/web/src/shell/**`, `apps/web/src/lib/api.ts`, `apps/web/src/lib/api.test.ts`, `e2e/support/coachUi.ts`, `e2e/coach.spec.ts` |
| web-copy | `apps/web/src/screens/settings/account/**`, `apps/web/src/screens/settings/users/**`, `apps/web/src/screens/login/InviteScreen.tsx`, `apps/web/src/screens/login/InviteScreen.test.tsx`, `e2e/account.spec.ts`, `e2e/invite.spec.ts`, `e2e/users-admin.spec.ts` |
| e2e-gate | `e2e/visual.spec.ts`, `e2e/a11y.spec.ts`, `e2e/__screenshots__/**`, `e2e/README.md`, `docs/SPEC.md`, `docs/multi-user.md`, `docs/DEPLOY.md`, and every other existing spec: `e2e/auth.spec.ts`, `e2e/backup.spec.ts`, `e2e/calendar.spec.ts`, `e2e/capture.spec.ts`, `e2e/compat.spec.ts`, `e2e/day-record.spec.ts`, `e2e/deep-links.spec.ts`, `e2e/food.spec.ts`, `e2e/gestures.spec.ts`, `e2e/home.spec.ts`, `e2e/meals.spec.ts`, `e2e/multi-user.spec.ts`, `e2e/offline.spec.ts`, `e2e/onboarding.spec.ts`, `e2e/progress.spec.ts`, `e2e/settings.spec.ts`, `e2e/shell.spec.ts`, `e2e/sync.spec.ts`, `e2e/weight-measure.spec.ts` |

Nobody else edits `apps/web/src/ui/**`, `apps/web/src/store/**`, `apps/web/src/auth/**`, `apps/web/src/sheets/**`,
`apps/web/src/sw.ts`, `apps/server/src/db/scope.test.ts`, `docs/redesign-a.md`, `docs/meals-macros.md`, this file.

**Transient breaks (expected):** none from contracts (additive). Until web-data lands, web-coach's imports of
`ProgressBody`, `screens/calendar/useShownMonth`, `PhotoUrlsProvider` do not resolve (web-coach starts after it).
web-copy's `UserSheet` link points at `/coach/<id>`, which redirects home until web-coach lands (no compile
dependency). Parallel packages filter `tsc` / vitest / eslint output to their own paths and report the rest; only
e2e-gate requires fully clean runs and is the only package that runs Playwright. A failure in a spec owned by another
package is reported back with file:line and the suggested fix (the gate edits only its own paths).

---

## 10. Risks

| Risk | Mitigation |
| --- | --- |
| Existing users were told the admin cannot see their records; now the admin can. | Owner agreed; the three copy changes ship together with the feature; anna sees the «Акаунт» line on her next visit. Deploy note in SPEC. |
| A future route reaches a client's rows through the writable `forUser` with a looked-up `UserId` (the brand does not stop admin routes), or through the readers / `coach`. | Readers and `coach` are not on `RouteDeps` (type-level); `readerFor` takes a `ClientId` only `resolveClient` mints; `assertCoach` first in every access method; coach lint rules 1–5 + the runtime route-table test; existing admin routes still never call `data.forUser` (unchanged multi-user §4 rule). |
| A probe of photo ids looks like successful views in the audit log; `HEAD` reads a client silently. | «viewed a photo» only when bytes were served; `HEAD` → 405 before any read (C2, C10). |
| Replace navigations erase the back stamp and lose the list's filters. | One `useReplaceParams` helper keeps `history.state` (§5.1); unit + e2e back-stamp flow. |
| Drift between the coach formulas (shared) and the client's own `lib/stats`. | Web parity test on the progress fixtures; formulas documented row by row (§4.1). |
| e2e determinism: real server clock vs fixed browser clock. | Time-relative maths in the browser; `createdAt` / `lastSeenAt` only in rules that cannot fire in e2e (account age, inactivity) and are unit-tested; visual / a11y stub the API. |
| The detail page loads a client's whole history (meals JSON). | ≤ 20 clients, one client at a time, ~1–2 MB worst case after years; on demand only; the list uses compact digests (~8 KB per client). |
| The table is wide for 960px content. | 8 columns with two-line cells (≈920px) fit at 1280×800 (gate check `scrollWidth <= clientWidth`); wide shell up to 1440px; below 1280 the region scrolls on both axes with a sticky header row and an opaque sticky name column (shot 78); page never scrolls sideways. |
| Admin tab bar loses «Прогрес» on the phone. | Only admins; their own Progress stays one tap away from Home's week row; owner question Q1. |
| The invite page line is shown on CLI admin invites too (the check response has no role). | Rare (owner-only CLI path); accepted — wording stays true for everyone who registers as a user. |
| `ProgressView` split could change the client's Progress. | `ProgressView` keeps its exact props and `usePeriod` behaviour; its existing tests and `e2e/progress.spec.ts` must stay green untouched. |
| `PhotoStrip` / `PhotoViewer` edits touch a shared feature. | Context default = today's URLs; tests for both. |

---

## 11. Owner questions (для власника)

1. Телефон адміна: вкладка «Клієнти» замість «Прогрес» у нижньому меню — так, чи краще рядок у «Налаштуваннях»?
2. Пороги сигналів: калорії > ціль +10 % за 7 повних днів (≥ 3 дні з калоріями); 3+ повні дні без записів; не
   заходить 7+ днів; пропущене зважування за планом (вимкнене нагадування — 8+ днів). Підходять?
3. Вимкнені акаунти: показувати в «Усі» з позначкою «Вимкнено» (без сигналів) — чи приховати зовсім?
4. Середні калорії й Б · Ж · В у таблиці — за повні дні без сьогодні (у самого клієнта в «Прогресі» сьогодні
   враховується). Так зрозуміло?
5. «Часті страви» клієнта тренерові не показуємо. Потрібні?

---

## 12. Rationale notes (choices a reviewer may question)

- **Why not compute the table on the server?** It would need «today» per client from the server clock: correct in
  production, but untestable end-to-end (the e2e browser clock is fixed, the server's is not) and it would duplicate
  `lib/stats` in a second runtime anyway. Digests keep the server free of time logic and the payload small.
- **Why not reuse `DayCard`?** It is built around actions (sheets, inline ✓ / ✕, «Додати», «Редагувати день»); a
  read-only flag would thread through every row. The coach day view reuses its **model** (`buildDayDetail`) and the
  meal model / totals card instead, and shows more (each meal with its own photos and macros).
- **Why links, not `role="tablist"`, for the detail tabs?** Each tab is a URL (shareable, back-safe with `replace`),
  and link semantics with `aria-current="page"` are exactly what a screen reader expects for that.
- **Why separate reader factories instead of `forUser(id).readOnly` or `DataRepos.readerFor`?** A property on the
  writable repo would put the writer one dot away in the coach code, and a method on `DataRepos` would hand every
  route module (they all receive `RouteDeps`) a reader for any id, guarded only by a text lint. `createDataAccess`
  shares the statements but returns the readers separately, so only `createApp` → `createCoachAccess` ever holds
  them, and the `ClientId` brand makes «admins are not clients» a compile-time rule.
- **Why `coach` as a third argument, not a `RouteDeps` field?** Every route module receives the full `RouteDeps`; a
  field there would let a future user route call `deps.coach.list(...)`. As a separate argument only `app.ts` and
  `routes/coach.ts` ever see it (lint rule 3).
- **Why `HEAD` → 405 instead of «same as GET»?** Hono runs the GET handler for HEAD; letting it through would read
  and log a client's records for a request that returns no body. 405 keeps «only GET reads».
- **Why three span statements?** A single `UNION` over `days`, `weights`, `measures` would be the first coach
  statement needing a scope-lint exemption.

---

## 13. Review round (critique → changes)

Every critique point was checked against the code (`apps/server/src/http/app.ts`, `http/routes/deps.ts`,
`db/data.ts`, `hono@4.13.13` `hono-base.js` HEAD dispatch, `wouter@3.13.0` `navigate`, `ui/internal/backNav.ts`,
`screens/progress/period.ts` / `ProgressScreen.tsx`, `ui/layout/ContentGrid*`, `shell/AppShell.module.css`,
`screens/login/InviteScreen.tsx`, `screens/calendar/model.ts` / `useCalendarModel.ts`, `e2e/visual.spec.ts`
`shot()`, `e2e/a11y.spec.ts`, `docs/DEPLOY.md:181`). Applied:

| # | Point | Where it landed |
| --- | --- | --- |
| R1 | `readerFor` on `DataRepos` / `PhotoStore` reached every route module | C3, §2.1–2.3: separate `DataReaders` / `PhotoReaders` from `createDataAccess` / `createPhotoAccess`, never on `RouteDeps`; `ClientId` brand minted only by `resolveClient`; lint on the identifier `\breaderFor\b`, `.readers`, `as ClientId` |
| R2 | `list` had no actor check; `coach` on `RouteDeps` | §2.4 `assertCoach` first in all three methods (spied test); §2.5 `coach` is a third argument, `RouteDeps` / `deps.ts` unchanged; lint rule 3 |
| R3 | GET-only only regex-checked in one file | §2.6 runtime route-table test + regex `\.(post\|…)\(` anywhere in `routes/coach.ts` |
| R4 | HEAD ran the GET handler (200 + log) | C2, §2.5, §3.2: HEAD → 405 `Allow: GET` before any read or log; OPTIONS → 404; tests |
| R5 | «viewed a photo» logged for a 404 | C10: «found no such photo of client …» for that case |
| R6 / R18 | foods loaded then dropped | C11, §2.2: `reader.read(): Omit<AppData,'foods'>` via `readCore`, foods statement never runs; test |
| R7 | replace navigations wiped `legkoFrom` | §5.1 `useReplaceParams` (state kept), tab `Link` onClick; unit + e2e flow |
| R8 | 10 columns ≈ 1 150px > 960px | C13, §6.1, §7.2: 8 columns, two-line Вага / Ккал cells, wrapping headers, gate width check; `sinceStart` no longer a sort key |
| R9 | row onClick double-push / modifier clicks | §5.1 «Row clicks»; ClientsTable test |
| R10 | «Історія калорій» pushed a stateless entry | §5.4 `ProgressBody.onOpenDay` (default `navigate(href)`), ProgressPanel passes `useReplaceParams` |
| R11 | first header click sorted ascending | §6.1 `SORT_FIRST_DIR` shared by header and phone select |
| R12 | sticky column transparent; `min-height` on rows ignored | §6.1 opaque `--card` sticky cell + border, `height: 64px` on cells; shot 78 |
| R13 | header row scrolled away | §6.1 region scrolls both axes with `max-height`, sticky `thead th`; a11y check |
| R14 | invite line below the submit button | §7.1 inside the form, above «Створити акаунт»; document-order test |
| R15 | kcal pill (7 days) vs Ккал cell (30 days) | §7.2 pill «Калорії +N% за 7 днів» always; table note «сигнали — за останні 7 днів» |
| R16 | phone sub ignored the period | §6.2, §7.2 period-aware sub |
| R17 | ivan stub contradicted the sketch | §8.3: ivan `lastSeenAt` now − 1 d (no_records a); new `petro` covers «Ще не входили»; sketch counts 6 / 4 |
| R19 | copy nits («В — г», «Не відмічено», apostrophes) | §6.3, §6.5, §7.2 |
| R20 | week-to-date workouts read as failure on Monday | §3.1 / §4.1 `plannedSoFar`; tone only when behind it |
| R21 | ProgressBody's ContentGrid nested in the page grid | §5.4 `className`; §5.6 panels own their layout, ProgressBody never nested |
| R22 | no stub had the meals / photos day for shot 74 | §8.3 sofia = coachMeals; visual precondition assertion |
| R23 | visual «--update-snapshots / diff» does not exist | §8.2: shots are plain PNGs; the gate opens and reviews each listed PNG |
| R24 | `expectNoSideScroll` private to a11y.spec | §8.3 exported from `e2e/support/coachUi.ts` |
| R25 | «existing contrast checks» do not exist | §8.2 concrete font-size / `--muted` colour checks; new helpers named |
| R26 | `useToday(zone)` unused | §5.4 dropped; `lib/useToday.ts` untouched, removed from web-data paths |
| R27 | `routeDeps.data` read inside its own initializer | §2.5 hoisted wiring |
| R28 | `useShownMonth` import pulled in the store | §5.4 own file `screens/calendar/useShownMonth.ts`; no `@/store/` import test |
| R29 | `coachPhotoUrls` undefined; `label` / `action` could leak | §5.5 `nav.ts` defines it; §6.5 only `title/value/valueTone/text` |
| R30 | `docs/DEPLOY.md:181` still says «never anyone's records» | e2e-gate owns `docs/DEPLOY.md` and rewrites that sentence |

### Rejected critique

Nothing was rejected outright. Where a critique offered alternatives, the choices are:

- R2 «allow `deps.coach` only in two files»: not chosen. Passing `coach` as a separate argument does the same job
  through the type system, and the lint stays simpler.
- R4 «HEAD served by the same handler (wording fix only)»: not chosen. 405 before the read is stricter and costs
  nothing, because the web never sends HEAD.
- R8 «drop `sinceStart` or keep it sortable from a header menu»: dropped as a sort key. It is still shown in the
  Вага cell and on the KPI strip, and «До цілі» covers ranking by progress.
- R11 «activity: never-seen first»: not chosen. The rule «nulls last» stays uniform. Never-seen clients already lead
  the default attention order through `inactive`.
- R13 option (b), a denser row only: not chosen alone. Option (a), sticky header rows in a both-axes region, is
  used, and the pills still wrap under the name.
- R22 «a coach.test assertion on the fixture»: placed in `e2e/visual.spec.ts` instead, because the shared package
  must not import e2e fixtures.
