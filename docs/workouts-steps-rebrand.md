# «Home Fit»: workouts, steps and the rebrand — architecture & plan

Status: plan, owner decisions final (A rebrand, B workouts, C steps). This document is the single source for the
work packages in §9; every brief points here. Sibling docs: `SPEC.md` (product/engineering spec), `redesign-a.md`
(UX patterns), `meals-macros.md` (ops/compat style this plan copies), `multi-user.md` (scoping, `forUser()`, scope
lint, downgrade), `coach-cabinet.md` (read-only coach path).

Production (fit.triple-a.dev) holds REAL data of several users: everything here is **additive** (schema v5, wire
v3 = v2 + new op kinds), every old op stays valid, old clients keep working, a downgrade path exists and is tested.

---

## 0. Decisions

| # | Decision | Why |
|---|----------|-----|
| W1 | New data lives in **its own tables and AppData keys** (`exercises`, `workouts`, `sessions`, `steps`), never inside `days`. | `day.put` / `day.delete` of old clients (Rule L, `clearDay`) rebuild a day from scratch: anything stored inside `days` would be erased by an old outbox. Separate keys are stripped by old clients' zod (default `strip`) and never round-trip through them. |
| W2 | The **seed exercise library is static code in `@legko/shared`** (`EXERCISE_LIBRARY`, ids `lib.<slug>`). Only her **own** exercises are stored (`AppData.exercises`). | No per-user copy of 60 rows, the seed can be improved in a release, ids are a stable contract for fixtures. |
| W3 | A **session snapshots** each exercise (name, kind, MET, muscles, equipment) into the session. | Deleting/editing an own exercise or renaming a seed exercise never changes history; the coach needs no library lookups; kcal is reproducible. |
| W4 | A session in progress is a real stored session with `status: 'active'`, written with `session.put` on start and on every confirmed set. | iOS kills backgrounded PWAs: the outbox/IndexedDB already survive that, so the workout survives it too, offline, on every device. No second draft store. |
| W5 | **Finishing** (or saving a past/edited session) commits `session.put` (`status: 'done'`) **and** `day.meta { trained: true, types: merged }` in one `commit`. Reducers stay independent (no cross-entity reducer). Deleting a session sends only `session.delete` (the day's ✓ stays; the dialog says so). | Old clients, stats, calendar marks and the coach keep reading `trained` / `types` exactly as today. |
| W6 | **One plan of training days** = `settings.rem.workout.days` (unchanged). A workout's weekdays say *which* workout on *which* plan day. Saving a workout whose days are not in the plan **adds them to the plan** (`settings.put`); removing days from a workout never removes plan days. The reminder fires on plan days (if on) and names today's scheduled workout(s). | One source of truth; existing «N з M трен.», coach «done vs planned», Home «За планом» keep working; simple to explain in one sentence in the builder and in Settings. |
| W7 | Steps: one integer per date (`steps` table, `steps.put` / `steps.delete`), optional `settings.stepsGoal` (null = none). | Same shape and semantics as weigh-ins. |
| W8 | **Burned kcal is display-only**: never subtracted from intake, never changes `kcalGoal` maths (no «earned calories»). Shown as «спалено N ккал» / «≈ N ккал». | Owner decision. |
| W9 | Workouts UI = **routes** under `/workouts` (list, builder, library, exercise detail, session, history), not sheets. The «Тренування» short sheet, Home and calendar only link into them. | A 40-minute session with a timer must not live in a dismissible sheet; routes survive reloads; desktop gets real pages. |
| W10 | Home keeps **four rows** and one screen: workout + steps + burned go into the **Тренування row sub** (≤ 2 lines, kit clamp); a scheduled day swaps the inline ✓/✕ for «Почати». | Measured slack ≈ 43 px at 390×763 (redesign-a §R): one extra sub line (≈ 19 px) fits; a fifth row (60 px) does not. |
| W11 | Desktop sidebar gets a fifth item «Тренування» (`/workouts`); the phone tab bar is unchanged (4 tabs + «+»). | Desktop has room; phone tab bar layout is fixed. |
| W12 | Rebrand changes **only user-visible strings, icons and logos**. Internal identifiers stay: `@legko/*`, `legko.db`, `legko-*.db` backups, cookies, IndexedDB/localStorage keys (`legko.*`), `X-Legko-User`, `history.state.legkoFrom`, CSS module names, the reserved username `legko`. The backup **download** name becomes `home-fit-YYYY-MM-DD.json` (user-visible). | Renaming storage keys/headers would log users out or orphan device caches. |

---

## 1. Data model (shared, `packages/shared`)

### 1.1 Types (new, `types.ts`)

```ts
export type ExerciseKind = 'weight' | 'bodyweight' | 'time' | 'cardio';
export type MuscleId =
  | 'chest' | 'shoulders' | 'biceps' | 'triceps' | 'forearms'
  | 'abs' | 'obliques' | 'traps' | 'lats' | 'lowerBack'
  | 'glutes' | 'quads' | 'hamstrings' | 'adductors' | 'calves';
export type Equipment =
  | 'barbell' | 'dumbbell' | 'kettlebell' | 'machine' | 'cable' | 'band' | 'bodyweight' | 'cardio' | 'other';

/** A library (seed, id `lib.*`) or her own exercise (12+ char random id). */
export interface Exercise {
  id: string;
  name: string;                 // 1–60, Ukrainian
  kind: ExerciseKind;
  primary: MuscleId[];          // 0–6, unique
  secondary: MuscleId[];        // 0–8, unique, disjoint from primary
  equipment: Equipment;
  met: number;                  // 1–25, one decimal
}

/** One planned / logged set. Only the fields of the exercise's kind are meaningful, the others are null. */
export interface SetValues {
  reps: number | null;   // weight, bodyweight: whole 0–1000
  kg: number | null;     // weight: 0–1000, multiple of 0.25
  sec: number | null;    // time: whole 0–36000
  min: number | null;    // cardio: 0–1440, multiple of 0.5
  km: number | null;     // cardio (optional): 0–500, multiple of 0.01
}
export interface SessionSet extends SetValues { done: boolean; }

export interface WorkoutItem {
  key: string;            // unique within the workout (4–40 base64url chars): duplicates of one exercise allowed
  exerciseId: string;     // lib.* or her own id; a missing own exercise renders «Вправу видалено» and is skipped
  sets: SetValues[];      // 1–20
  restSec: number;        // 0–900, whole
}

export interface Workout {
  id: string;             // 12+ random base64url
  name: string;           // 1–40
  days: Weekday[];        // unique, stored in WEEK_ORDER (Mon…Sun)
  items: WorkoutItem[];   // 0–30 (the builder requires ≥ 1 to save; an op with 0 is valid)
}

export interface SessionExercise {
  key: string;            // unique within the session
  exerciseId: string;
  // snapshot (W3)
  name: string; kind: ExerciseKind; met: number; equipment: Equipment;
  primary: MuscleId[]; secondary: MuscleId[];
  restSec: number;
  skipped: boolean;
  sets: SessionSet[];     // 0–30
}

export type SessionStatus = 'active' | 'done';

export interface WorkoutSession {
  id: string;             // 12+ random base64url
  date: ISODate;
  workoutId: string | null;   // the template it came from (null: «Вільне тренування»)
  name: string;           // 1–40 snapshot («Ноги + прес», «Вільне тренування»)
  createdAt: number;      // epoch ms — ordering key
  startedAt: number | null;   // epoch ms of a live start; null for a past-day log
  finishedAt: number | null;  // epoch ms (live finish); null while active / past-day log
  durationSec: number | null; // 0–86400; live: set on finish; past/edit: typed in minutes × 60; null = unknown
  status: SessionStatus;
  exercises: SessionExercise[];   // 0–30
  notes: string;          // ≤ 1000
}

export interface StepsEntry { date: ISODate; steps: number; }   // whole 1–100 000

// AppData gains (all default [] when absent — old caches, old backups):
//   exercises: Exercise[]            her own only, array order = creation order (stored `position`)
//   workouts: Workout[]              array order = creation order (stored `position`)
//   sessions: WorkoutSession[]       sorted by (date, createdAt, id) — `compareSessions`
//   steps: StepsEntry[]              sorted by date, one per date
// Settings gains: stepsGoal: number | null   (whole 1 000–50 000, step 500 in the UI; null = none)
// SettingsPut: stepsGoal optional (absent = keep stored — old clients), like mealTypes / macroGoals.
```

### 1.2 Limits and ids (`schemas.ts`, extend `LIMITS`)

```ts
exerciseName: 60, workoutName: 40, customExercises: 300, workouts: 50, workoutItems: 30, plannedSets: 20,
sessionExercises: 30, sessionSets: 30, sessionsPerDay: 10, sessionNotes: 1000,
reps: { min: 0, max: 1000 }, setKg: { min: 0, max: 1000 }, setSec: { min: 0, max: 36000 },
cardioMin: { min: 0, max: 1440 }, km: { min: 0, max: 500 }, restSec: { min: 0, max: 900 },
met: { min: 1, max: 25 }, steps: { min: 1, max: 100000 }, stepsGoal: { min: 1000, max: 50000 },
sessionSec: { min: 0, max: 86400 },
```

- `libraryExerciseIdSchema = /^lib\.[a-z0-9-]{2,40}$/`; `ownIdSchema = /^[A-Za-z0-9_-]{12,40}$/` (custom exercises,
  workouts, sessions); `exerciseIdSchema` = either; `itemKeySchema = /^[A-Za-z0-9_-]{4,40}$/`. `.` never occurs in
  base64url, so seed and own ids cannot collide.
- `exerciseSchema` (stored/own): `ownIdSchema` id (an `exercise.put` with a `lib.*` id is **invalid**).
- Set values: `.nullable()` numbers with the multiples above (`Number.isInteger(v * 4)` for kg, `* 2` for min,
  `* 100` rounded check for km).
- `workoutSchema`, `sessionSchema`: unique `key`s (refine), unique `days`, `secondary` disjoint from `primary`
  (normalisers fix it; the schema refuses duplicates only).
- New id generator in the web store: `newId()` (same alphabet and 12 chars as `newMealId`, which stays).

### 1.3 Ops (wire v3 = v2 + these kinds; every v1/v2 op unchanged)

```ts
{ kind: 'exercise.put',    value: Exercise }        // own only; upsert by id; a NEW one beyond 300 → no change
{ kind: 'exercise.delete', id: string }             // no cascade in the reducer (the client cascades, §1.3.1)
{ kind: 'workout.put',     value: Workout }         // upsert by id (keeps array position); new beyond 50 → no change
{ kind: 'workout.delete',  id: string }
{ kind: 'session.put',     value: WorkoutSession }  // upsert by id (date may change); a NEW one when the date
                                                    //   already has 10 sessions → no change; then sort
{ kind: 'session.delete',  id: string }
{ kind: 'steps.put',       date: ISODate, steps: number }   // upsert by date
{ kind: 'steps.delete',    date: ISODate }
```

All are idempotent (a replay yields the same state). Pure reducers in `ops.ts`, used by `applyOp` (client) and the
server repo alike: `normalizeExercise`, `normalizeWorkout`, `normalizeSession`, `compareSessions`,
`reduceExercises(list, op)`, `reduceWorkouts(list, op)`, `reduceSessions(list, op)`, `reduceSteps(list, op)`,
and `mergeSettingsPut` keeps `stepsGoal` when absent.

Normalisation (both sides): names trimmed / single spaces / clipped; `days` unique in WEEK_ORDER; set fields not used
by the kind → `null` (weight: reps+kg; bodyweight: reps; time: sec; cardio: min+km); `secondary` minus `primary`;
duplicate `key`s → first wins; `status: 'active'` forces `finishedAt: null`.

#### 1.3.1 What the web store commits (core, `store/data.ts` `dataActions`)

| Action | Ops (one `commit`) |
|---|---|
| `saveExercise(ex)` | `exercise.put` |
| `deleteExercise(id)` | `exercise.delete` + `workout.put` for every workout that referenced it (items with that id removed) |
| `saveWorkout(w)` | `workout.put` + (when `w.days ⊄ rem.workout.days`) `settings.put` with `rem.workout.days = sorted union` |
| `deleteWorkout(id)` | `workout.delete` (plan days stay) |
| `startSession(date, workoutId \| null, now)` → id | today only: `session.put` (`status 'active'`, `startedAt: now`, prefilled §1.6) |
| `draftSession(date, workoutId \| null, now)` → session | past days: NOT committed; `status 'done'`, sets prefilled with `done: true`, `startedAt/finishedAt: null` |
| `saveSession(s)` | `session.put` (live edits: confirm a set, add/remove a set, skip, add exercise) |
| `finishSession(id, now)` | `session.put` (`status 'done'`, `finishedAt: now`, `durationSec = min(round((now − startedAt)/1000), 6 h)`; a stale session — its date before the device's today — gets `durationSec: null`, editable later) + `day.meta { trained: true, types: mergeTypes(day, derived) }` for the session's date |
| `saveDoneSession(s)` | `session.put` + the same `day.meta` (past-day log, edit of a done session) |
| `deleteSession(id)` | `session.delete` |
| `setSteps(date, n \| null)` | `steps.put` / `steps.delete` (null or 0) |

Every action validates with `opSchema` first and returns `false` (commits nothing) when refused, like `saveMeal`.

### 1.4 AppData / settings defaults

`emptyData()` adds `exercises: [], workouts: [], sessions: [], steps: []`; `defaultSettings().stepsGoal = null`;
`normalizeSettings` fills a missing `stepsGoal` with null; `appDataSchema` adds the four arrays with `.default([])`
(+ limits, unique ids, unique step dates) — old backups and old caches import / load unchanged. The web
`normalize.ts` / `parseCachedData` must accept a cache without the new keys.

### 1.5 Muscles, groups, equipment (`packages/shared/src/exercises.ts`)

| MuscleId | Label (UI) | View | Type bucket (§1.7) |
|---|---|---|---|
| chest | Груди | front | upper |
| shoulders | Плечі | front + back | upper |
| biceps | Біцепс | front | upper |
| triceps | Трицепс | back | upper |
| forearms | Передпліччя | front + back | upper |
| abs | Прес | front | core |
| obliques | Косі мʼязи | front | core |
| traps | Трапеції | back | upper |
| lats | Найширші | back | upper |
| lowerBack | Поперек | back | — (none) |
| glutes | Сідниці | back | lower |
| quads | Квадрицепс | front | lower |
| hamstrings | Задня поверхня стегна | back | lower |
| adductors | Привідні | front | lower |
| calves | Литки | front + back | lower |

`EXERCISE_GROUPS` (library chips, membership = any PRIMARY muscle in the group; `cardio` = kind cardio; `mine` =
own exercises — the last two are UI-only filters): Груди (chest) · Спина (traps, lats, lowerBack) · Плечі (shoulders)
· Руки (biceps, triceps, forearms) · Прес (abs, obliques) · Ноги (quads, hamstrings, adductors, calves) · Сідниці
(glutes) · Кардіо · Мої.

`EQUIPMENT_LABELS`: barbell Штанга · dumbbell Гантелі · kettlebell Гиря · machine Тренажер · cable Блок · band
Резинка · bodyweight Власна вага · cardio Кардіотренажер · other Інше.

`EXERCISE_KIND_LABELS`: weight «З вагою» · bodyweight «Власна вага» · time «На час» · cardio «Кардіо».

`INTENSITY_MET` (own exercises; the editor shows «Інтенсивність» Легка / Помірна / Висока):
weight 3.5 / 5.0 / 6.0 · bodyweight 2.8 / 3.8 / 8.0 · time 2.8 / 3.8 / 8.0 · cardio 4.0 / 7.0 / 10.0.
`intensityOf(kind, met)` = the nearest preset (for showing a seed's MET as words).

`DEFAULT_REST_SEC`: weight 90 · bodyweight 60 · time 45 · cardio 0.
`kgStep(equipment)`: dumbbell / kettlebell 1 · everything else 2.5.
`DEFAULT_SET` (an exercise added without plan or history): weight {reps 10, kg null} · bodyweight {reps 12} ·
time {sec 30} · cardio {min 20, km null}; default set count 3 (cardio 1).

### 1.6 Seed library (`packages/shared/src/exerciseLibrary.ts`, `EXERCISE_LIBRARY`, frozen)

P = primary, S = secondary. MET ≈ Compendium of Physical Activities 2024 (strength METs include the rests of a
normal session, which is why §1.7 counts rest time at the exercise MET).

| id | Назва | kind | P | S | equipment | MET |
|---|---|---|---|---|---|---|
| lib.back-squat | Присідання зі штангою | weight | quads, glutes | hamstrings, adductors, lowerBack | barbell | 5.0 |
| lib.goblet-squat | Гоблет-присідання | weight | quads, glutes | adductors, abs | dumbbell | 5.0 |
| lib.bodyweight-squat | Присідання | bodyweight | quads, glutes | hamstrings, calves | bodyweight | 5.0 |
| lib.sumo-squat | Сумо-присідання | weight | adductors, glutes, quads | hamstrings | dumbbell | 5.0 |
| lib.leg-press | Жим ногами | weight | quads, glutes | hamstrings, adductors | machine | 5.0 |
| lib.lunge | Випади | bodyweight | quads, glutes | hamstrings, adductors, calves | bodyweight | 4.0 |
| lib.dumbbell-lunge | Випади з гантелями | weight | quads, glutes | hamstrings, adductors, calves | dumbbell | 5.0 |
| lib.bulgarian-split-squat | Болгарські присідання | weight | quads, glutes | hamstrings, adductors | dumbbell | 5.0 |
| lib.step-up | Зашагування на платформу | weight | quads, glutes | hamstrings, calves | dumbbell | 5.0 |
| lib.romanian-deadlift | Румунська тяга | weight | hamstrings, glutes | lowerBack, forearms | barbell | 5.0 |
| lib.deadlift | Станова тяга | weight | hamstrings, glutes, lowerBack | quads, traps, forearms | barbell | 6.0 |
| lib.hip-thrust | Ягідний міст зі штангою | weight | glutes | hamstrings | barbell | 5.0 |
| lib.glute-bridge | Сідничний міст | bodyweight | glutes | hamstrings, abs | bodyweight | 3.5 |
| lib.cable-kickback | Відведення ноги назад у кросовері | weight | glutes | hamstrings | cable | 3.5 |
| lib.hip-abduction | Розведення ніг у тренажері | weight | glutes | — | machine | 3.5 |
| lib.hip-adduction | Зведення ніг у тренажері | weight | adductors | — | machine | 3.5 |
| lib.leg-extension | Розгинання ніг у тренажері | weight | quads | — | machine | 3.5 |
| lib.leg-curl | Згинання ніг у тренажері | weight | hamstrings | calves | machine | 3.5 |
| lib.calf-raise | Підйоми на носки | weight | calves | — | machine | 3.5 |
| lib.wall-sit | Стільчик біля стіни | time | quads | glutes | bodyweight | 3.5 |
| lib.bench-press | Жим лежачи | weight | chest | triceps, shoulders | barbell | 5.0 |
| lib.dumbbell-bench-press | Жим гантелей лежачи | weight | chest | triceps, shoulders | dumbbell | 5.0 |
| lib.incline-dumbbell-press | Жим гантелей на похилій лаві | weight | chest, shoulders | triceps | dumbbell | 5.0 |
| lib.chest-fly | Розведення гантелей лежачи | weight | chest | shoulders | dumbbell | 3.5 |
| lib.pec-deck | Зведення рук у тренажері | weight | chest | shoulders | machine | 3.5 |
| lib.push-up | Віджимання | bodyweight | chest, triceps | shoulders, abs | bodyweight | 3.8 |
| lib.knee-push-up | Віджимання з колін | bodyweight | chest, triceps | shoulders | bodyweight | 3.5 |
| lib.lat-pulldown | Тяга верхнього блока | weight | lats | biceps, traps, forearms | cable | 3.5 |
| lib.seated-row | Тяга нижнього блока | weight | lats, traps | biceps, lowerBack | cable | 3.5 |
| lib.bent-over-row | Тяга штанги в нахилі | weight | lats, traps | biceps, lowerBack, forearms | barbell | 5.0 |
| lib.dumbbell-row | Тяга гантелі однією рукою | weight | lats | biceps, traps | dumbbell | 3.5 |
| lib.pull-up | Підтягування | bodyweight | lats | biceps, forearms, traps | bodyweight | 8.0 |
| lib.assisted-pull-up | Підтягування в гравітроні | weight | lats | biceps | machine | 5.0 |
| lib.back-extension | Гіперекстензія | bodyweight | lowerBack | glutes, hamstrings | bodyweight | 3.5 |
| lib.face-pull | Тяга до обличчя | weight | shoulders, traps | biceps | cable | 3.5 |
| lib.shrug | Шраги з гантелями | weight | traps | forearms | dumbbell | 3.5 |
| lib.overhead-press | Жим штанги стоячи | weight | shoulders | triceps, traps, abs | barbell | 5.0 |
| lib.dumbbell-shoulder-press | Жим гантелей сидячи | weight | shoulders | triceps | dumbbell | 5.0 |
| lib.lateral-raise | Махи гантелями в сторони | weight | shoulders | traps | dumbbell | 3.5 |
| lib.front-raise | Підйоми гантелей перед собою | weight | shoulders | chest | dumbbell | 3.5 |
| lib.rear-delt-fly | Розведення в нахилі | weight | shoulders | traps | dumbbell | 3.5 |
| lib.biceps-curl | Згинання рук з гантелями | weight | biceps | forearms | dumbbell | 3.5 |
| lib.hammer-curl | Молоткові згинання | weight | biceps, forearms | — | dumbbell | 3.5 |
| lib.barbell-curl | Згинання рук зі штангою | weight | biceps | forearms | barbell | 3.5 |
| lib.triceps-pushdown | Розгинання рук на блоці | weight | triceps | — | cable | 3.5 |
| lib.overhead-triceps-extension | Французький жим з гантеллю | weight | triceps | — | dumbbell | 3.5 |
| lib.bench-dip | Зворотні віджимання від лави | bodyweight | triceps | chest, shoulders | bodyweight | 3.8 |
| lib.band-pull-apart | Розведення резинки | weight | shoulders, traps | — | band | 3.0 |
| lib.crunch | Скручування | bodyweight | abs | — | bodyweight | 3.8 |
| lib.bicycle-crunch | Скручування «велосипед» | bodyweight | abs, obliques | — | bodyweight | 3.8 |
| lib.leg-raise | Підйоми ніг лежачи | bodyweight | abs | adductors | bodyweight | 3.8 |
| lib.hanging-knee-raise | Підйоми колін у висі | bodyweight | abs | forearms | bodyweight | 3.8 |
| lib.russian-twist | Російські скручування | bodyweight | obliques | abs | bodyweight | 3.8 |
| lib.dead-bug | Мертвий жук | bodyweight | abs | — | bodyweight | 3.0 |
| lib.plank | Планка | time | abs | shoulders, obliques, lowerBack | bodyweight | 3.0 |
| lib.side-plank | Бічна планка | time | obliques | abs, shoulders | bodyweight | 3.0 |
| lib.mountain-climber | Скелелаз | time | abs | shoulders, quads | bodyweight | 8.0 |
| lib.burpee | Берпі | bodyweight | quads, chest | shoulders, abs, triceps | bodyweight | 8.0 |
| lib.jumping-jack | Стрибки «зірочка» | time | calves | shoulders, quads, glutes | bodyweight | 7.7 |
| lib.kettlebell-swing | Махи гирею | weight | glutes, hamstrings | lowerBack, shoulders, abs | kettlebell | 9.8 |
| lib.walk | Ходьба | cardio | calves, quads | glutes, hamstrings | other | 3.5 |
| lib.incline-walk | Ходьба під нахилом | cardio | glutes, calves | quads, hamstrings | cardio | 6.0 |
| lib.run | Біг | cardio | quads, calves | glutes, hamstrings | other | 8.3 |
| lib.stationary-bike | Велотренажер | cardio | quads | glutes, calves, hamstrings | cardio | 6.8 |
| lib.cycling | Їзда на велосипеді | cardio | quads | glutes, calves, hamstrings | other | 7.5 |
| lib.elliptical | Еліптичний тренажер | cardio | quads, glutes | calves, hamstrings | cardio | 5.0 |
| lib.rowing-machine | Гребний тренажер | cardio | lats, quads | biceps, glutes, hamstrings, abs | cardio | 7.0 |
| lib.stair-climber | Степер | cardio | glutes, quads | calves, hamstrings | cardio | 9.0 |
| lib.jump-rope | Скакалка | cardio | calves | quads, shoulders | other | 8.8 |
| lib.swimming | Плавання | cardio | lats, shoulders | chest, triceps, quads | other | 6.0 |
| lib.dance | Танці / аеробіка | cardio | quads, calves | glutes | other | 7.3 |

71 entries. Shared exports: `EXERCISE_LIBRARY`, `isLibraryExerciseId(id)`, `findExercise(own, id)` (library or
own, undefined when gone), `allExercises(own)` (library then own, each sorted with `localeCompare(…, 'uk')` in the UI).
A unit test pins: 60–75 entries, unique ids/names, valid against `exerciseSchema` shape (with the `lib.` id),
primary non-empty, MET in bounds, every group non-empty.

### 1.7 Calculations (`packages/shared/src/workouts.ts`, pure, no clock)

**Body weight for a date** — `bodyWeightOn(weights, date)`: the latest weigh-in on or before `date`; else the
earliest one after it; else `FALLBACK_BODY_KG = 70`.

**Active time of one exercise** — `exerciseActiveSec(ex)` over its DONE sets (`n` = count; skipped → 0):
- weight / bodyweight: `n × setSec + (n − 1) × restSec`, `setSec = clamp(reps × 3, 15, 120)` (reps null → 40);
- time: `Σ sec + (n − 1) × restSec`;
- cardio: `Σ min × 60` (no rest).

**Session kcal** — `sessionKcal(session, bodyKg)`:
`raw = Σ_ex MET_ex × bodyKg × exerciseActiveSec(ex) / 3600`; when `durationSec` is known and
`Σ exerciseActiveSec > durationSec`, every term is scaled by `durationSec / Σ` (she cannot burn more than the time
she spent); result `Math.round`, 0 for no done set. Only `status: 'done'` sessions count anywhere.

**Steps kcal** — `stepsKcal(steps, bodyKg) = Math.round(steps × 0.0005 × bodyKg)` (≈ 35 kcal / 1 000 steps at
70 kg; `STEP_KCAL_PER_KG = 0.0005`, documented in SPEC §3.6).

**Burned per day** — `dayBurned(data, date)` → `{ sessions: number, steps: number, total: number } | null`
(null when the date has neither a done session nor steps).

**Volume** — `sessionVolume(session) = Σ done sets of kind weight with kg and reps: kg × reps` (kg, unrounded;
format with `f0`). Bodyweight / time / cardio add nothing.

**Best set** — `bestSetValue(ex)` per kind: weight → max kg among done sets with reps ≥ 1; bodyweight → max reps;
time → max sec; cardio → max km when any km, else max min. `exerciseHistory(sessions, exerciseId)` → points
`{ date, sessionId, value, sets: SessionSet[] }` of done sessions, oldest first (one per session, its best).

**Records (PRs)** — `sessionRecords(allSessions, session)`: for each exercise of `session` whose best beats the best
of every EARLIER done session (`compareSessions` order) strictly; an exercise never done before yields no record
(first time is not a record). Each record: `{ exerciseId, name, kind, value, previous }`.

**Prefill (last time)** — `lastPerformance(sessions, exerciseId, before)` = the latest done session before `before`
(`compareSessions`) that has ≥ 1 done set of that exercise → its done sets. `sessionExerciseFrom(exercise, planned,
last)`: set count = planned count (template) else last's count else default (§1.5); set `i` takes last's set `i`
(else last's last set) values, else planned `i`, else `DEFAULT_SET`; `done: false` (live) / `true` (past-day draft);
`restSec` = planned, else `DEFAULT_REST_SEC[kind]`. `newSessionFromWorkout({ data, workout, date, id, now, newKey,
status })` builds the whole session (items whose exercise is gone are left out).

**Progression hint** — `progressionHint(lastSets, kind, equipment)`: when the last performance had every set done
and was not skipped: weight → `{ text: 'Минулого разу всі підходи виконано — спробуй +2,5 кг', kgDelta: 2.5 }`
(`kgStep(equipment)` → «+1 кг» for dumbbell/kettlebell); bodyweight → «… — спробуй +1 повторення» (`repsDelta: 1`);
time → «… — спробуй +10 с» (`secDelta: 10`); cardio → null. Otherwise null. Never applied automatically.

**Derived workout types** — `sessionWorkoutTypes(session)` over non-skipped exercises with ≥ 1 done set, PRIMARY
muscles only: cardio kind → «Кардіо» (ids `lib.walk`, `lib.incline-walk` → «Прогулянка» instead) and cardio never
counts toward buckets; upper and lower both hit → «Все тіло», else upper → «Верх тіла», lower → «Низ тіла»; core
→ «Прес». `mergeTypes(day, derived) = normalizeTypeNames([...(day?.trained === true ? day.types : []),
...derived]).slice(0, LIMITS.types)` — never removes a type she chose.

**Schedule** — `workoutsOn(workouts, date)` (those whose `days` include `weekdayOf(date)`, array order);
`activeSession(data, today)` (latest `status 'active'` dated today, else null); `staleActiveSessions(data, today)`
(active, date < today); `doneSessionsOn(data, date)`.

**Format** (shared, used by web and coach): `formatDuration(sec)` «48 хв» / «1 год 05 хв» / «—»;
`formatSet(kind, set)` «12 × 40 кг», «15 повт.», «45 с», «25 хв · 3,2 км»; `formatSetsSummary(ex)`
«3 × 12 · 40 кг», «12 · 12 · 10 × 42,5 кг», «3 × 45 с», «25 хв · 3,2 км» (numbers with `fN`, NBSP before units).

### 1.8 Server (`apps/server`)

**Migration v5** (append to `MIGRATIONS`, never edit v1–v4):

```sql
CREATE TABLE exercises (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  position   INTEGER NOT NULL,
  value      TEXT NOT NULL,            -- JSON Exercise (validated on read)
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
) STRICT;
CREATE TABLE workouts (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  position   INTEGER NOT NULL,
  value      TEXT NOT NULL,            -- JSON Workout
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, id)
) STRICT;
CREATE TABLE workout_sessions (
  user_id    TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  id         TEXT NOT NULL,
  date       TEXT NOT NULL,
  status     TEXT NOT NULL CHECK (status IN ('active', 'done')),
  value      TEXT NOT NULL,            -- JSON WorkoutSession
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
```

- `openDatabase` already snapshots before any migration (`legko-pre-v5-<date>.db`): add a test that a v4 file
  gets that snapshot and every v4 row survives byte-identical (`migrate-v5.test.ts`).
- **Repo** (`db/data.ts`): every new statement binds `user_id = ?` first. `exercises` / `workouts`: in `apply()`
  fold the batch's ops with the shared reducers on the list read once, then rewrite that user's rows (clear + insert
  with `position` = index; ≤ 350 small rows — the `foods` pattern, so reads equal `applyOp`). Sessions: per row
  (read by id; `normalizeSession`; new row only when the date has < 10; UPDATE keeps the row, date/status columns
  follow the value). Steps: upsert/delete per date. `read()` adds the four arrays (`ORDER BY position` / sessions
  sorted with `compareSessions` / steps `ORDER BY date`); a row whose JSON fails its schema is skipped with a
  content-free warning. `replaceAll` clears and writes the four tables too. New repo method
  `workoutNamesOn(date): string[]` for reminders.
- **Scope lint** (`db/scope.test.ts`): add `exercises`, `workouts`, `workout_sessions`, `steps` to
  `PER_USER_TABLES` (keys start with `user_id`: not in `GLOBAL_KEY_TABLES`). No allowlist entries needed.
- **Coach read path** (read-only): `DataReader.read()` returns the four arrays too (still never foods);
  new reader methods `stepsBetween(from, to)`, `sessionsBetween(from, to)` (done only), `workouts()`; the frozen
  key-list tests (`data-reader.test.ts`, `access.test.ts`) are updated; coach lint unchanged and passing.
  `CoachClientItem` gains `steps: StepsEntry[]` (window), `sessions: CoachSessionDigest[]` (window, done),
  `schedule: { id, name, days }[]`, built in `coach/access.ts` via shared `digestSession`.
- **Shared coach** (`coach.ts`): `CoachSessionDigest = { id, date, name, durationSec, setsDone, volumeKg, kcal }`
  (`kcal` via `sessionKcal(s, bodyWeightOn(weights, date))`); `coachItemFromData` builds the same three fields;
  `CoachSummary` gains `steps: { avg: number | null; days: number; goal: number | null; goalDays: number }` (full
  days `[T − P, T − 1]`, avg of logged days) and `sessions: { count: number; kcal: number }` (range as workouts).
  The web must tolerate items from an older server without these fields (`?? []`).
- **Reminders**: `REMINDER_MESSAGES.workout` becomes `workoutReminder(names: string[])`: names empty → today's
  title/body; else body «Сьогодні: Ноги + прес» (two: «Сьогодні: Ноги + прес, Кардіо»; three+: first two + « і ще N»).
  `url` stays `DEEP_LINKS.workout` (old service workers). `isDone('workout')` unchanged (a finished session sets
  `trained`). `TEST_MESSAGE.title = 'Home Fit'`.
- **Export / import**: automatic through `AppData`; download name `home-fit-${date}.json`. An import of an old
  backup (no new keys) replaces the new tables with nothing — that is what «відновити копію» means (test it).
- **Downgrade v5 → v4** (`db/downgrade.ts` `downgradeSchemaV5`, CLI `downgrade-schema` on a v5 file):
  snapshot `legko-pre-down-v5-<date>.db` first, then in one transaction
  `DROP TABLE workout_sessions; DROP TABLE workouts; DROP TABLE exercises; DROP TABLE steps; PRAGMA user_version = 4;`.
  `settings.stepsGoal` may stay in the JSON (v4's zod strips it). Days keep `trained` / `types`. The CLI prints the
  per-account counts it dropped (scoped COUNTs per user, no allowlist) and refuses `--keep` / `--drop-others` on v5.
  Tests: v5 → v4 → re-open with this build migrates to v5 again cleanly; v4 build's statements work on the result.
- **Messages**: startup log «Home Fit server …»; CLI `USAGE` first line «Home Fit — server CLI»; v5 lines in
  the Rollback section.
- **Demo seed** (`scripts/seed-demo.ts`): `demoData(today, { training?: boolean })`, default false (e2e `demo`
  unchanged); the dev CLI passes `training: true`. Training adds (deterministic): workouts «Ноги + прес» (Пн, Ср:
  back-squat 3 × 12 · 40, romanian-deadlift 3 × 10 · 35, crunch 3 × 20, plank 3 × 45 с) and «Верх тіла» (Пт:
  dumbbell-bench-press, lat-pulldown, dumbbell-shoulder-press, biceps-curl); one own exercise «Степ-аеробіка»
  (cardio, MET 7.0); done sessions on the plan days of the 3 weeks before today, only on days the demo already marks
  trained (their `types` are left as stored); the latest «Ноги + прес» on today − 2 with every set done (so the
  hint shows), the one before with squat at 37,5 kg (so 40 kg is a record); steps on 12 of the 14 days before today
  (5 200–11 800); `stepsGoal: 8000`; nothing today.

### 1.9 Compatibility matrix

| Who | Sees | Behaviour |
|---|---|---|
| Old client (pre-v5 bundle), new server | `GET /api/data` with 4 extra keys | zod strips them; caches without them; never sends new ops; its `settings.put` without `stepsGoal` keeps the stored goal; its ✓/✕ and types work as before; sessions stay on the server. |
| Old outbox (`day.put` / `day.delete`) | — | Cannot touch sessions/steps (separate tables). |
| New client, old server (rollback window) | 400 `invalid_op` for new kinds | The sync engine drops the rejected op («Сервер відхилив одну зміну»); DEPLOY.md: downgrade + rollback means new-feature data written meanwhile is lost (snapshot keeps it). |
| Old coach bundle, new server | extra item fields | ignored. |
| New coach bundle, old server | missing item fields | `?? []` / `null` → no steps column values, no sessions. |
| Old service worker | `DEEP_LINKS.workout` unchanged, `title` text only | works. |
| iOS home-screen app | name/icon | iOS keeps the old icon and name «Легко» until she deletes the app from the home screen and adds it again (documented in README, DEPLOY.md release notes, SPEC). Data is server-side: re-adding loses nothing. |

---

## 2. Body map SVG (`apps/web/src/features/exercises/BodyMap.tsx`)

In-house, license-free, drawn as simple soft geometric regions consistent with 1b (round joins, no realism).

**Frame.** One figure = 100 × 220 units, centre line x = 50. `view="both"` places front at x 0–100 and back at
x 120–220 (`viewBox="0 0 220 220"`), each with a 10-unit caption below («Спереду» / «Ззаду», 9 units, `--muted`,
`aria-hidden`). Regions are authored as **left-half point lists** and mirrored (`x' = 100 − x`) by a helper;
`smoothPath(points)` turns a closed point list into a Catmull–Rom → cubic Bézier path (tension 0.5). Coordinates
below are the starting geometry (the implementer may refine shapes, keeping ids, views and rough positions).

Silhouette (left half, front and back share it; right half mirrored; head = ellipse cx 50 cy 13 rx 9 ry 11):
`(45,24) (44,30) (34,32) (27,36) (24,46) (21,62) (18,78) (15,96) (13,104) (17,108) (21,98) (25,80) (28,64) (31,52)
(32,70) (31,86) (30,100) (31,130) (33,148) (32,172) (35,196) (33,204) (44,206) (44,198) (44,172) (45,150) (47,130)
(49,104) (50,104)`.

Front regions (left half): shoulders `(34,32)(27,36)(25,45)(31,47)(35,40)` · chest `(36,36)(49,36)(49,52)(40,54)
(33,49)` · biceps `(25,47)(31,49)(29,63)(23,61)` · forearms `(22,64)(28,65)(24,84)(19,92)(17,90)` · abs
`(42,56)(49,56)(49,96)(44,96)(42,80)` (+ two faint 0.6-unit segment lines) · obliques `(34,56)(41,57)(41,82)(35,88)
(33,72)` · quads `(32,104)(46,106)(45,140)(37,146)(32,132)` · adductors `(46,104)(49,106)(48,128)(46,136)` · calves
(front/shin) `(34,154)(42,154)(41,184)(36,186)`.

Back regions (left half): traps `(44,26)(49,26)(49,48)(40,42)(35,33)` · shoulders (rear) `(34,32)(27,36)(25,45)
(32,46)` · lats `(34,46)(48,52)(46,78)(37,74)(33,60)` · lowerBack `(42,78)(49,78)(49,94)(42,94)` · triceps
`(25,46)(32,48)(30,64)(23,62)` · forearms (as front) · glutes `(32,96)(49,98)(49,118)(36,120)(31,108)` · hamstrings
`(32,122)(47,122)(45,148)(35,148)` · calves `(33,152)(43,152)(42,182)(35,184)`.

**Paint** (CSS Module, tokens only, light + dark automatically): silhouette `fill: var(--line2); stroke:
var(--line3); stroke-width: 1`; idle region `fill: var(--line)`; secondary `fill: var(--accLine)`; primary
`fill: var(--acc)`; region stroke `var(--card)` 1 unit (separates neighbours). In dark theme the same tokens give
dark base, muted lavender secondary and bright lavender primary. Fill transitions 150 ms, none under
`prefers-reduced-motion: reduce`.

**API**

```tsx
export interface BodyMapProps {
  primary: readonly MuscleId[];
  secondary?: readonly MuscleId[];
  /** 'both' (default for md/lg), 'front' | 'back' | 'auto' (thumb: the view holding most primary muscles). */
  view?: 'both' | 'front' | 'back' | 'auto';
  /** thumb 44×44 (viewBox cropped to the primary muscles' bbox, padded to a square of ≥ 70 units, clamped to the
   *  figure) · md 160 px tall · lg 240 px tall (exercise detail, editor). */
  size?: 'thumb' | 'md' | 'lg';
  /** Editor only: pointer taps on a region call this (the SVG stays aria-hidden; chips are the accessible control). */
  onRegionTap?: (muscle: MuscleId) => void;
  className?: string;
}
```

Non-interactive: `role="img"` with `aria-label` «Основні мʼязи: квадрицепс, сідниці. Допоміжні: …» (thumb:
`aria-hidden`, the row names the exercise). Below md/lg a `Legend` (kit) «Основні» (--acc) / «Допоміжні»
(--accLine) — colour is never the only cue (the facts list names the muscles). Editor: `MuscleChips` toggles
cycle «не задіяний → основний → допоміжний → не задіяний» (chip `aria-pressed` + visible suffix «· основний» /
«· допоміжний»); a region tap does the same cycle. Pure helpers in `bodyMapModel.ts` (tested): `regionsFor(view)`,
`mirror(points)`, `thumbViewBox(primary)`, `autoView(primary)`, `cycleMuscle(state, muscle)`, `muscleSpeech`.

---

## 3. UX per screen

Patterns: redesign A (ListGroup/ListRow check-lists, short sheets, `ScreenHeader` with back link via `useBackTo`),
1b tokens, ≥ 44 px targets, inputs ≥ 16 px, light + dark, desktop `ContentGrid` two columns where it helps.
All copy below is final unless the implementer finds a layout problem (then keep meaning, shorten).

### 3.1 Routes and entry points (contract file `apps/web/src/lib/workoutRoutes.ts`, owned by core)

```ts
export const WORKOUTS_PATH = '/workouts';                         // «Мої тренування»
export const WORKOUT_NEW_PATH = '/workouts/new';                  // builder, empty
export const workoutEditPath = (id: string) => `/workouts/edit/${encodeURIComponent(id)}`;
export const LIBRARY_PATH = '/workouts/library';                  // «Вправи»
export const exercisePath = (id: string) => `/workouts/library/${encodeURIComponent(id)}`;
export const sessionPath = (id: string) => `/workouts/session/${encodeURIComponent(id)}`;
export const logPath = (date: ISODate, workoutId: string | null) =>
  `/workouts/log?date=${date}${workoutId ? `&workout=${encodeURIComponent(workoutId)}` : ''}`;  // past day
export const HISTORY_PATH = '/workouts/history';
```

Entry points: Home Тренування row («Почати» / «Продовжити» / row tap → sheet), the «Тренування» short sheet (§3.8),
calendar day Тренування row (→ sheet for that date), Progress (top exercises → exercise detail; «Усі тренування →»
→ history), Settings → «Тренування» (rows «Мої тренування», «Бібліотека вправ»), desktop sidebar «Тренування».
Starting a session today: `const id = dataActions.startSession(today, workoutId); navigate(sessionPath(id))`.

### 3.2 «Вправи» — library (`/workouts/library`)

```
‹ Тренування
Вправи                                            h1
┌ 🔍 Пошук вправи ─────────────────────────────┐  input 16px, type=search, label «Пошук вправи»
└──────────────────────────────────────────────┘
(Усі)(Груди)(Спина)(Плечі)(Руки)(Прес)(Ноги)(Сідниці)(Кардіо)(Мої)   chips, one line, scrolls sideways
┌──────────────────────────────────────────────┐
│ [map] Присідання зі штангою                › │  thumb BodyMap 44×44
│       Штанга · Квадрицепс, сідниці           │  sub: equipment · primary muscles
│ [map] Жим ногами                           › │
│ …                                            │
└──────────────────────────────────────────────┘
[ + Своя вправа ]                                 outline button, full width
```

Search: case-insensitive (`uk`), matches name words and muscle labels; with a query the group chip still filters.
Sort `localeCompare(…, 'uk')`; «Мої» rows carry a small `Pill` «моя». Empty: «Нічого не знайшлося» + «+ Своя
вправа» (pre-fills the name with the query). Desktop: list left, the selected exercise's detail right (two
columns, URL still `/workouts/library/:id`).

### 3.3 Exercise detail (`/workouts/library/:id`)

```
‹ Вправи
Присідання зі штангою                              h1
┌ [ BodyMap lg, both views ]  ■ Основні ■ Допоміжні ┐
└──────────────────────────────────────────────────┘
Тип            З вагою                              KeyValueRows (static)
Обладнання     Штанга
Основні        Квадрицепс, сідниці
Допоміжні      Задня поверхня стегна, привідні, поперек
Інтенсивність  Помірна · MET 5,0
┌ Прогрес ─────────────────────────────────────────┐
│ Найкращий підхід, кг        [LineChart 120]      │  weight: kg · bodyweight: «Найбільше повторень» ·
│ 30 вер ─────────────────── 12 жов                │  time: «Найдовше, с» · cardio: «Найдовше, хв» / км
│ Минулого разу всі підходи виконано — спробуй +2,5 кг │  hint (muted, only when progressionHint ≠ null)
└──────────────────────────────────────────────────┘
Рекорди      45 кг · 12 жовтня                     (bodyweight «20 повторень», time «1:30», cardio «5,2 км»)
Останні тренування
  12 жовтня · Ноги + прес      3 × 12 · 40 кг   ›   → sessionPath (5 rows max)
[ Змінити ] [ Видалити ]                           own exercises only
```

No history: the Прогрес card is replaced by «Ще немає записів цієї вправи. Додай її в тренування — і тут
зʼявиться прогрес.» Chart needs ≥ 2 points (else the single value as text). An unknown id → «Вправу не знайдено»
+ back. Coach never links here.

### 3.4 Own exercise editor (sheet «Нова вправа» / «Вправа», stacked over library or picker)

```
Нова вправа                                    ✕
Назва        [ Наприклад, Степ-аеробіка    ]   16px
Тип          ( З вагою | Власна вага | На час | Кардіо )   Segmented
Мʼязи        [ BodyMap lg both, tappable ]
             Торкнись мʼяза: раз — основний, двічі — допоміжний, втретє — прибрати
             (Груди)(Плечі · основний)(Біцепс)…   15 chips, aria-pressed
Обладнання   (Штанга)(Гантелі)(Гиря)(Тренажер)(Блок)(Резинка)(Власна вага)(Кардіотренажер)(Інше)  single-select
Інтенсивність ( Легка | Помірна | Висока )     → MET from INTENSITY_MET
[            Зберегти            ]
```

Validation: name required («Дай вправі назву»), unique among all exercises case-insensitively («Така вправа вже є»);
≥ 1 primary muscle unless kind cardio («Обери хоча б один основний мʼяз»). Delete (from detail): ConfirmDialog
destructive «Видалити вправу «Степ-аеробіка»?» body «Її буде прибрано з 2 тренувань. Записані тренування
залишаться.» (count omitted when 0).

### 3.5 «Мої тренування» (`/workouts`)

```
‹ Головна                (back target from where she came; default /)
Мої тренування                                         h1
┌──────────────────────────────────────────────────────┐
│ Ноги + прес                 (Сьогодні)  [ Почати ]   │  row → builder; trailing Button sm «Почати»
│ Пн, Ср · 4 вправи                                    │
│ Верх тіла                               [ Почати ]   │
│ Пт · 4 вправи                                        │
└──────────────────────────────────────────────────────┘
[ + Нове тренування ]
┌ Ще ──────────────────────────────────────────────────┐
│ Бібліотека вправ                                   › │
│ Історія тренувань                        12 записів › │
│ Записати минуле тренування                         › │  → ui.openSheet(yesterday, 'workout'); ‹ › pick the day
└──────────────────────────────────────────────────────┘
```

An active session today shows first as a Banner (compact) «Тренування триває · Ноги + прес · 12 хв» cta
«Продовжити». Stale active sessions (earlier dates) show a muted group «Незавершені» with rows «12 жовтня · Ноги +
прес» → session screen (which offers «Завершити» / «Видалити»). Empty state (no workouts): text «Склади тренування
з вправ і відмічай кожен підхід — вага підставиться з минулого разу.» + «+ Нове тренування» + «Бібліотека вправ».
«Почати» on a non-scheduled day just starts it (no question).

### 3.6 Builder (`/workouts/new`, `/workouts/edit/:id`)

```
‹ Мої тренування
Нове тренування                                         h1 (edit: the name)
Назва   [ Наприклад, Ноги + прес          ]            16px, maxLength 40
Дні     (Пн)(Вт)(Ср)(Чт)(Пт)(Сб)(Нд)                    WeekdayPicker multi (kit)
        У ці дні нагадаю о 18:00. Дні тренувань — це твій план у Налаштуваннях → Нагадування.
Вправи
┌ 1 ─────────────────────────────────────────────────┐
│ [map] Присідання зі штангою               [↑][↓][⋯] │  ↑/↓ 44px IconButtons; ⋯ = Дублювати / Видалити
│ ⠿     3 × 12 · 40 кг · відпочинок 1:30   [Змінити] │  ⠿ drag handle (pointer only, aria-hidden)
└────────────────────────────────────────────────────┘
┌ 2 … (expanded: «Змінити» tapped)                    ┐
│ Підхід 1   Повторення [−] 12 [+]   Вага [−] 40 [+] кг │  rows stack on < 390 px (label above steppers)
│ Підхід 2   …                                   [✕] │  ✕ «Видалити підхід 2» (≥ 2 sets)
│ [ + Підхід ]                                        │  copies the last set
│ Відпочинок  [−] 1:30 [+]   (±15 с, 0–15:00)          │
│ [ Готово ]                                          │
└────────────────────────────────────────────────────┘
[ + Додати вправи ]                                    → ExercisePickerSheet (multi)
───────────────────────────────────────── sticky footer
[                  Зберегти                  ]
Видалити тренування                                    (edit only, ghost destructive at the bottom of content)
```

- One card expanded at a time. Kind-specific set fields: weight (Повторення, Вага кг step `kgStep`), bodyweight
  (Повторення), time (Секунди, step 5), cardio (Хвилини step 1, Км optional step 0,1). Steppers = kit
  `NumberStepperField` (typing allowed, `inputMode` numeric/decimal, ≥ 16 px).
- New exercise added from the picker: sets prefilled from her last performance (if any) else `DEFAULT_SET`;
  rest `DEFAULT_REST_SEC`.
- Reorder: ↑/↓ buttons (disabled at the ends), and drag by the handle (pointer events, `touch-action: none` on the
  handle only, card follows the pointer, drop index by midpoint; no animation under reduced motion). After a move,
  focus stays on the moved card's same button; a polite live region says «Присідання — 2 з 4».
- Duplicate inserts a copy (new `key`) right after. Delete removes without confirm and shows a Toast «Вправу
  прибрано» (no undo needed; the workout is not saved until «Зберегти»).
- Days note: reminder on → «У ці дні нагадаю о {time}. …»; off → «Нагадування вимкнено. Ці дні додадуться до
  плану тренувань.» When saving adds plan days: Toast «Збережено · Чт додано до плану».
- Validation (on save): name «Дай тренуванню назву»; no exercise «Додай хоча б одну вправу». Leaving with unsaved
  changes asks (ConfirmDialog «Вийти без збереження?»). Delete: ConfirmDialog destructive «Видалити тренування
  «Ноги + прес»?» body «Записані тренування залишаться.»
- **ExercisePickerSheet** (exercise-library): heading «Додати вправи» (builder, multi-select: rows toggle a ✓,
  footer «Додати (3)») / «Додати вправу» (session, single: a tap picks and closes); search + group chips as §3.2;
  «+ Своя вправа» opens the editor stacked; the new exercise is picked.

### 3.7 Schedule ↔ reminder (one sentence everywhere)

«Дні тренувань — це твій план. Коли ставиш тренуванню дні, вони додаються до плану; нагадування приходить у дні
плану.» Settings → Нагадування → Тренування card gets, under the weekday picker, a muted list «За розкладом: Пн, Ср —
Ноги + прес · Пт — Верх тіла» (only when some workout has days) + the link «Мої тренування →». Removing a plan day
that still has a scheduled workout is allowed (the workout's day just no longer gets a reminder) — the list shows
such a day struck with the note «не в плані».

### 3.8 «Тренування» short sheet (existing mode `workout`, extended)

```
Тренування                       ‹ Сьогодні, середа ›     ✕
Почати тренування                                   (past days: «Записати тренування»)
┌──────────────────────────────────────────────────┐
│ Ноги + прес                     (За планом)    › │  scheduled first; today → startSession + navigate
│ 4 вправи · ≈ 45 хв                               │  past day → logPath(date, id)
│ Верх тіла                                      › │
│ Вільне тренування                              › │  sub «Додаси вправи по ходу»
└──────────────────────────────────────────────────┘
Записано                                            (only when the date has sessions)
│ Ноги + прес · 48 хв · 310 ккал                 › │  → sessionPath (summary)
Або просто відміть                                   Field label
( ✓ Було )( ✕ Не було )                              existing TrainingToggle lg + types + notes fold
Мої тренування →                                     ghost link (WORKOUTS_PATH)
```

Without any workouts the sheet is today's sheet plus a ghost «Скласти своє тренування →» (WORKOUT_NEW_PATH) under
the notes. An active session today replaces the first group with «Тренування триває — Продовжити ›». «≈ 45 хв» =
Σ planned active time (§1.7) rounded to 5 min (omitted when 0). The ✓/✕ part keeps today's semantics exactly.

### 3.9 Session (`/workouts/session/:id`, status `active`)

```
‹ Згорнути                                     23:41     elapsed (tabular-nums, role=timer, not live)
Ноги + прес                                              h1
2 з 4 вправ · 7 з 13 підходів                            muted
┌ Присідання зі штангою                ✓ 3/3   ▾ ┐    done card, collapsed: «3 × 12 · 40 кг»
└────────────────────────────────────────────────┘
┌ Румунська тяга                              ⋯  ┐    current card, expanded
│ [map] Задня поверхня стегна, сідниці             │
│ Минулого разу: 3 × 10 · 35 кг                    │    or the progression hint as a ghost button:
│ [ Спробувати +2,5 кг ]                           │    adds kgDelta to every NOT done set
│ 1  10 × 35 кг                              ( ✓ ) │    done row: ✓ filled (acc2), tap ✓ again = undo
│ 2  ┌ Повторення  [−]  10  [+]              ┐     │    current set editor (big steppers 44 px)
│    │ Вага        [−] 35  [+] кг            │     │
│    └ [        ✓ Виконано        ]          ┘     │    primary button; confirms → saveSession → rest timer
│ 3  10 × 35 кг                              (   ) │    tap a row to edit it
│ [ + Підхід ]                                     │
└──────────────────────────────────────────────────┘
┌ Скручування                     3 × 20       ▾ ┐    upcoming, collapsed
[ + Додати вправу ]                                     → ExercisePickerSheet (single)
──────────────── rest bar (only while resting; sits above the footer) ────────────────
 Відпочинок 1:12        [ −15 с ] [ +15 с ] [ Пропустити ]
────────────────────────────────────────── sticky footer
[              Завершити тренування              ]
```

- The current exercise = first non-skipped with an undone set; it auto-expands and scrolls into view
  (`block: 'nearest'`, smooth unless reduced motion); after its last set the next one becomes current.
- «⋯» (card menu, a small popover/ActionSheet of buttons): «Пропустити вправу» (skipped=true; undone sets ignored;
  card shows «Пропущено» + «Повернути»), «Прибрати з тренування» (removes it from this session only), «Вгору» /
  «Вниз» (reorder within the session).
- Set row editor: «Видалити підхід» ghost (≥ 1 set must remain unless the exercise is removed).
- Kind-specific rows: bodyweight «15 повт.»; time «45 с» with a «▶ Старт» countdown inside the editor (optional
  helper: counts the set's seconds, vibrates at 0, then marks done); cardio «Хвилини», «Км (за бажанням)».
- Every change commits `saveSession` (cheap upsert; offline queue). «‹ Згорнути» navigates back (default `/`);
  the session stays `active` (Home shows «Продовжити»).
- «Завершити тренування»: with undone sets → ConfirmDialog «Завершити тренування?» body «Ще 3 підходи не
  відмічено — вони не зарахуються.» confirm «Завершити»; with no done set at all → ConfirmDialog «Нічого не
  відмічено. Видалити це тренування?» (confirm deletes it). Then `finishSession` → summary (§3.11).
- Opened on another device or after reload: the same screen from stored data; elapsed = now − startedAt.
- Stale active session (date < today): no elapsed timer, no rest timer; a compact Banner «Це тренування не
  завершено» with «Завершити» (`finishSession` → `durationSec: null`, editable in the summary's edit mode) and a
  ghost «Видалити» (destructive confirm).

### 3.10 Rest timer

Starts when a set is confirmed and the exercise's `restSec > 0` and this is not the last undone set of the session.
State is local (`restEndsAt` in component state + `sessionStorage['legko.rest.<sessionId>']` so a reload
resumes it); remaining = `restEndsAt − Date.now()` recomputed on every tick (1 s interval) and on
`visibilitychange` (iOS freezes timers in background). At 0: `navigator.vibrate?.([200, 100, 200])` (no-op on iOS),
the bar turns mint for 4 s with «Час! Наступний підхід» announced once via a polite live region, then hides.
«−15 с» / «+15 с» adjust (min 0), «Пропустити» hides it. Under reduced motion no progress animation (text only).
The bar never covers the footer or the current set's ✓ (it sits in the sticky footer area above «Завершити»).

### 3.11 Summary (same route, status `done`)

```
‹ Головна
Ноги + прес                                              h1
Середа, 14 жовтня · 48 хв                                subtitle
✓ Тренування збережено                                   (only right after finishing; role=status)
[ 48 хв     | 3 240 кг | 13        | ≈ 310 ккал ]        StatStrip: Тривалість · Обʼєм · Підходів · Спалено
Нові рекорди                                             (only when sessionRecords ≠ [])
│ Присідання зі штангою      40 кг (було 37,5)          │
Вправи
│ Присідання зі штангою      3 × 12 · 40 кг        ›   │  → exercise detail
│ Румунська тяга             10 · 10 × 35 кг        ›   │
│ Скручування                Пропущено                 │
[ Готово ]                    → back to where the session started (default /)
[ Змінити ]                   → edit mode (§3.12)
```

Обʼєм tile hidden when 0 (bodyweight-only/cardio sessions show 3 tiles). Kcal tooltip-free: the «≈» marks the
estimate; a muted footnote «Оцінка: MET × вага × час» under the strip.

### 3.12 Past day, edit, delete, history

- **Past day** (`/workouts/log?date=&workout=`): `draftSession` (not committed), the summary layout in edit mode:
  every set row editable (done by default; ✓ toggles), «Тривалість, хв» stepper (empty allowed = unknown), «+ Додати
  вправу», footer «Зберегти» → `saveDoneSession` → summary. Leaving asks if dirty.
- **Edit a done session**: «Змінити» on the summary → the same edit mode on the stored session; «Зберегти» →
  `saveDoneSession`; «Видалити тренування» (destructive confirm «Видалити тренування за 12 жовтня?» body «Відмітка
  «Було» за цей день залишиться.») → `deleteSession` → back.
- **History** (`/workouts/history`): rows grouped by month «Жовтень 2026», each «14 жовтня · Ноги + прес» sub
  «48 хв · 13 підходів · ≈ 310 ккал» → summary.

### 3.13 Home «Тренування» row (still 4 rows, one screen — W10)

| State (today) | sub (one or two lines) | trailing |
|---|---|---|
| active session | «Триває · 12 хв» (acc) | Button sm «Продовжити» → sessionPath |
| scheduled workout(s), `trained === null`, no done session | «Сьогодні: Ноги + прес» (acc; 2+: «Сьогодні: Ноги + прес і ще 1») | Button sm «Почати» (1 workout → start + navigate; 2+ → opens the sheet) |
| done session(s) | «Ноги + прес» (2+: «2 тренування») | TrainingToggle (✓ pressed) |
| otherwise | today's subs («За планом о 18:00», «Кардіо, Прес», «Не було», «Ще не відмічено», «Було · додай тип») | TrainingToggle |

Then the sub appends « · 8 400 кроків» when today has steps, and « · спалено 410 ккал» (`dayBurned.total`) only when
a done session exists today. The row clamps at 2 lines (kit). Accessible name: «Тренування: Ноги + прес. 8 400
кроків. Спалено 410 ккал». Row tap still opens the «Тренування» sheet. Home fit is guarded by e2e at 390×763 with
the worst case (done session with a 40-char name + steps). The week row stays as is.

### 3.14 Calendar day card

- Тренування row: with done sessions `lines` = one line per session «Ноги + прес · 48 хв · 310 ккал» (cut with
  «…»), plus the types line; when the day also has steps a last line «Разом спалено ≈ 590 ккал». Without sessions:
  today's text. Inline ✓/✕ unchanged.
- New row **Кроки** (icon `steps`, neutral) after Тренування: value «8 400», sub «з 10 000 · ≈ 280 ккал» (goal part
  only with a goal); empty → «Додати»; opens the `steps` sheet for that date. Label «Кроки: 8 400, спалено близько
  280 ккал» / «Кроки: додати».
- Day status (`dayStatus`) unchanged (food + kcal + mark); steps never change it.

### 3.15 Progress («Мій прогрес»)

**Тренування card** (existing, extended):

```
Тренування
[ 12 Всього | 2 Цього тижня | 7 Цього місяця | 2,1 В сер./тиж. ]   StatStrip (unchanged)
( Тренування | Обʼєм )                          Segmented, per card
[ BarChart: per week of the period (≤ 12 bars; week = 7 daily bars Пн–Нд) ]
Спалено на тренуваннях ≈ 1 240 ккал · в сер. 177 ккал/день       muted line (only with sessions)
Найчастіші вправи                               (only with sessions in the period)
│ Присідання зі штангою   6 ▬▬▬▬▬▬▬            › │  BarRow rank, link to exercise detail (exerciseHref)
Найчастіше · цього тижня                        (types ranking, as today)
```

Bars: «Тренування» = trained days per bucket (keeps meaning for days without details); «Обʼєм» = Σ session volume
per bucket (kg). Buckets: week period → 7 days; month → weeks; q → weeks; all → months (≤ 12, latest).

**Кроки card** (new, after Тренування; hidden entirely when she never logged steps):

```
Кроки
[ 7 850 В сер. за день | 10 000 Ціль | 3 з 7 Днів з ціллю ]   StatStrip (goal tiles «—» / hidden without a goal)
[ BarChart daily (week/month), weekly averages (q/all); goalPct line when a goal exists ]
Спалено ≈ 275 ккал на день                     muted
```

Coach audience: no «+ Записати кроки», no exercise links (`exerciseHref = null`).

### 3.16 Steps sheet and the full day

`SheetMode 'steps'` inside RecordSheet (short sheet, date nav ‹ ›):

```
Кроки                         ‹ Сьогодні, середа ›    ✕
        [      8 400      ] кроків          input 34px/700, inputMode numeric, label «Кроки за день»
[ −1000 ] [ −500 ] [ +500 ] [ +1000 ]       4 × 44px buttons (aria «Мінус 1000 кроків» …), clamp 0…100 000
Ціль 10 000 — ще 1 600                      or «Ціль виконано ✓» (acc2) or «≈ 280 ккал» without a goal
[             Зберегти             ]
```

Empty or 0 + Зберегти deletes the entry (`steps.delete`). Pre-fill: the stored value; steppers from empty start at
0. «+» menu: rows Їжа · Тренування · **Кроки** (icon `steps`, neutral, sub «За день, вручну», status «8 400»)
· Вага · Заміри. Full «Запис дня»: a field «Кроки (за бажанням)» (single numeric input, no steppers) under
Тренування; the record draft gains `steps: string`; `recordOps` adds `steps.put/delete` only when changed (same
per-field rule as weight). Deep link `/?sheet=steps` is allowed.

### 3.17 Settings

- «Цілі»: `GoalsCard` gains the row «Кроки за день» with the kit `Stepper`: value «Без цілі» when null; «+» from
  null → 8 000; ±500; «−» at 1 000 → null; bounds 1 000–50 000.
- The list row «Типи тренувань» becomes **«Тренування»** (slug stays `workouts`); its page: a ListGroup «Мої
  тренування ›» (WORKOUTS_PATH, value = count) and «Бібліотека вправ ›» (LIBRARY_PATH), then the existing types
  card under the caption «Мої типи».
- «Нагадування» → Тренування card: the schedule list of §3.7.
- Caption «Home Fit · трекер схуднення».

### 3.18 Coach additions (read-only)

- Table: new sortable column **Кроки** after «Тренування»: «7 850» + muted « / 10 000» when a goal; «—» faint
  without steps; sort first `asc`; long text «кроків у середньому 7 850 на день за тиждень, ціль 10 000». The
  Тренування column stays done vs planned (plan = W6). Phone list sub unchanged.
- Client detail: fifth tab **«Тренування»** (`?tab=workouts`, period 7/30 segmented shown): schedule line
  «Розклад: Пн, Ср — Ноги + прес · Пт — Верх тіла» (or «Розкладу немає»); summary strip «N тренувань · ≈ X ккал ·
  Y кг обʼєм · Кроки 7 850/день»; sessions newest first, each a ListGroup: title «14 жовтня · Ноги + прес», value
  «48 хв · ≈ 310 ккал», rows per exercise «Присідання зі штангою» sub «12 × 40 · 12 × 40 · 10 × 42,5 кг» (skipped:
  «Пропущено»); records marked with a neutral Pill «рекорд». Empty «За цей період тренувань не записано». Static
  rows only: no chevrons, toggles or links into her pages.
- Day view (calendar tab): inherits the Тренування lines + Кроки row from `buildDayDetail`, plus each session's
  exercise rows under the day.
- Overview: a tile «Кроки, сер.» next to the workouts tile. «У Home Fit з 9 жовтня 2026 · …» header.

### 3.19 Accessibility checklist (all packages)

Every control has a visible or `aria-label` name; steppers name the thing («Повторення, підхід 2: менше»); ✓ set
buttons are `aria-pressed` toggles «Підхід 2 виконано»; current card has `aria-current="step"`; timers are
`role="timer"` without live announcements except the rest-end message; body map `role="img"` + text; reorder
announces positions; focus returns to the opener when a sheet closes (kit); no hover-only affordances; reduced
motion disables scroll smoothing and transitions; colour is never the only signal (✓ glyph, «Пропущено» text,
legend + muscle names).

---

## 4. Rebrand inventory

Mark: **«Home Fit»** everywhere a user reads the product name. Ukrainian grammar keeps the Latin name undeclined
(«в Home Fit», «з Home Fit», «Відкрити Home Fit»).

| Where | Now | New | Owner |
|---|---|---|---|
| `apps/web/vite.config.ts` manifest | name «Легко — трекер схуднення», short «Легко» | name «Home Fit», short_name «Home Fit», description «Персональний трекер: харчування, тренування, кроки, вага й заміри» | rebrand |
| `apps/web/index.html` | `<title>Легко`, `apple-mobile-web-app-title` | «Home Fit» (both); meta description as manifest | rebrand |
| `public/*` icons, `favicon.svg` | «Л» | the HF mark (§5) | rebrand |
| `screens/login/LoginScreen.tsx` h1, `invalid` copy | «Легко», «…з Легко» | «Home Fit», «Це не схоже на посилання з Home Fit» | rebrand |
| `screens/login/InviteScreen.tsx`, `LinkParts.tsx`, `ResetScreen.tsx` | «Запрошення в Легко», «Відкрити Легко», «Додай Легко…», «Відкрий Легко з іконки…», «Легко вже на початковому…» | same sentences with «Home Fit» | rebrand |
| `screens/login/LogoMark.tsx` | text «Л» | `<BrandMark>` SVG | rebrand |
| `shell/Sidebar.tsx` | «Л» + «Легко» | `<BrandMark size 36>` + «Home Fit» | rebrand |
| `sheets/install/InstallSheet.tsx` | «Відкрий Легко з іконки…», «Готово — Легко вже встановлено ✨» | «Home Fit» | rebrand |
| `auth/auth.ts` | «Вийти з Легко на цьому пристрої?» | «Вийти з Home Fit на цьому пристрої?» | rebrand |
| `pwa/protocol.ts` | `DEFAULT_NOTIFICATION_TITLE = 'Легко'` | 'Home Fit' | rebrand |
| `screens/settings/users/usersModel.ts` | share titles/texts | «Запрошення в Home Fit», «Запрошую в Home Fit — трекер схуднення. …», «Новий пароль у Home Fit», «Посилання для нового пароля в Home Fit, діє 24 години.» | rebrand |
| `screens/home/homeModel.ts` | «Встанови Легко на iPhone» | «Встанови Home Fit на iPhone» | integration |
| `screens/settings/SettingsList.tsx`, `model.ts`, `backupFile.ts` | caption, push copy ×3, backup invalid, `legko-…json` | «Home Fit · трекер схуднення», «Дозволь Home Fit…», «…коли Home Fit додано…», «…→ Сповіщення → Home Fit», «…копію «Home Fit»», `home-fit-…json` | integration |
| `store/sync.ts` | `importInvalid` | «Файл не схожий на резервну копію «Home Fit»» | core |
| `ui/index.ts` comment, `ui/ui.test.tsx` sample | «Легко» | «Home Fit» | core |
| `apps/server/src/push/messages.ts` | test title «Легко» | «Home Fit» | core |
| `apps/server/src/index.ts` | «Легко server …» | «Home Fit server …» | core |
| `apps/server/src/http/routes/data.ts` | `legko-${date}.json` | `home-fit-${date}.json` | core |
| `apps/server/src/cli/run.ts` USAGE | — | first line «Home Fit — server CLI» | core |
| `screens/coach/copy.ts` | «У Легко з …» | «У Home Fit з …» | coach-additions |
| README, Dockerfile labels/comments, `deploy/*` comments, `playwright.config.ts` comment, docs multi-user / redesign-a / coach-cabinet / meals-macros | «Легко» | «Home Fit» (docs: keep historical decision text, change product mentions; add «(раніше «Легко»)» once in README) | rebrand |
| `docs/DEPLOY.md` | title, mentions | «Home Fit» + v5 rollback + iOS re-add note | core |
| `docs/SPEC.md` | title, §2/§3.5 manifest, test push | «Home Fit» + new sections | e2e-gate |
| Tests asserting the strings | many | updated by the owner of each test file (§9) | each |

**Stays internal (do not rename):** `@legko/*` package names and imports, `legko` root package name, `legko.db`,
`backups/legko-*.db` names and regexes, cookie names, IndexedDB `keyval-store` keys `legko.*`,
`localStorage`/`sessionStorage` keys (`legko.period`, `legko.linkToken`, `legko.user`, …), `X-Legko-User`
(`USER_HEADER`), `history.state.legkoFrom`, CSS module class names, `console.warn('[legko] …')`, the reserved
username `legko` (D24 alias), notes text «Легко» used as sample data in tests (it is a word, not the brand).

---

## 5. Logo and icons pipeline

**Mark «C · Крыша над HF»** (design units 120 × 120):
`<rect width=120 height=120 rx=28 fill=#1e2229/>` · roof `<path d="M28 50 L60 26 L92 50" fill=none
stroke=#b9a8ee stroke-width=7 stroke-linecap=round stroke-linejoin=round/>` · monogram «HF» in Manrope 800,
font size 34, letter-spacing −1, centred on x = 60 with its **baseline at y = 88** (caps ≈ 64–88; the roof + caps
block is optically centred), fill #f7f9fb.

`apps/web/scripts/gen-icons.mjs` (rewrite, same deps: `opentype.js`, `sharp`, `@fontsource/manrope` — already
installed; file `@fontsource/manrope/files/manrope-latin-800-normal.woff`): lays out «H» and «F» glyphs with
kerning + −1 tracking via opentype, converts them to one path (no font at render time), and writes:

| File | Content |
|---|---|
| `public/favicon.svg` | rounded rect rx 28 + roof + HF paths, viewBox 0 0 120 120, width/height 64 |
| `public/icons/icon-192.png`, `icon-512.png` | the same SVG rasterised (transparent corners) |
| `public/icons/maskable-512.png` | full-bleed #1e2229 square, roof + HF scaled 0.8 about the centre (inside the 80 % safe circle), opaque |
| `public/apple-touch-icon.png` (180) | full-bleed square (iOS rounds it), content at scale 1, opaque (`flatten`) |
| `public/icons/badge-96.png` | white roof + HF on transparent (alpha silhouette), content scaled to fill ~80 % |
| `apps/web/src/shell/brandMark.generated.ts` | `export const HF_PATH = '…'; export const ROOF_PATH = 'M28 50 L60 26 L92 50';` (design units) — the in-app mark reads these |

The script prints every file; `pnpm --filter @legko/web icons` stays the command. PNGs are committed (the build
does not run the script). In-app **`BrandMark`** (`shell/BrandMark.tsx`, `size` 36 | 56, `aria-hidden`) renders
the same SVG with the fixed brand colours in both themes (it is a logo) plus a 1px `--line` ring in dark theme;
`LogoMark` (login) and `Sidebar` use it. Manifest icons list unchanged (same paths, so no manifest change besides
names). Note for users (README/DEPLOY/SPEC): iOS keeps the old home-screen icon and name until the app is removed
from the home screen and added again; Android/desktop refresh with the manifest update.

---

## 6. Web store & UI contracts summary (for parallel packages)

- `@legko/shared` exports everything in §1 (types, schemas, ops, `EXERCISE_LIBRARY`, muscles/groups/labels, math,
  formatters, coach additions).
- `store/data.ts`: `dataActions.saveExercise / deleteExercise / saveWorkout / deleteWorkout / startSession /
  draftSession / saveSession / finishSession / saveDoneSession / deleteSession / setSteps`, `newId()`.
- `store/ui.ts`: `SheetMode` gains `'steps'`.
- `lib/workoutRoutes.ts`: §3.1.
- `ui`: new icons `steps`, `play`, `timer`, `search`, `plus`, `grip`, `arrowUp`, `arrowDown`, `more`, `copy`,
  `trash`, `check`, `trophy`, `flame` (24-grid line icons, same style; own drawings, no new licence).
- `features/exercises` (exercise-library) exports: `BodyMap`, `MuscleChips`, `ExercisePickerSheet`
  (`{ open, mode: 'multi' | 'single', onPick(ids: string[]), onClose, initialQuery? }`), `ExerciseEditorSheet`
  (`{ open, exercise?: Exercise, initialName?, onSaved(ex), onClose }`), `ExerciseThumb`, `ExerciseLibraryScreen`,
  `ExerciseDetailScreen`, `exerciseLabel(ex)`.
- `features/workouts` (workouts) exports: `WorkoutsRoutes` (the `/workouts/*` switch, includes the library routes),
  `WorkoutsScreen`, `WorkoutBuilderScreen`, `SessionScreen`, `HistoryScreen`.
- `screens/progress` `ProgressBody` gains `exerciseHref?: ((id: string) => string) | null` (default `exercisePath`;
  coach passes `null`).

---

## 7. Test plan (who writes what)

- **Unit (vitest)**: shared reducers/normalisers/limits/idempotency (replay twice = once), compat (old settings.put
  keeps stepsGoal; old appData parses; `day.put` cannot touch sessions), every formula in §1.7 with worked numbers,
  library integrity; server migration v5 + snapshot, repo parity (`applyOp` result = `read()` after `apply` for
  random op sequences of the new kinds), scope lint, negative authz (repo A never sees B), coach reader key lists,
  downgrade v5→v4 (+ CLI output), reminders naming workouts, export/import round trip; web store actions; every new
  model (library filter, body map helpers, builder model, session model incl. current-exercise logic and rest timer
  maths with fake timers, home/calendar/progress/steps models, coach models).
- **e2e (Playwright, port 3399, one run at a time)**: owned per §9. Negative authz e2e (core,
  `e2e/workouts-api.spec.ts`): user B's ops never change A's exercises/workouts/sessions/steps (B's own ids colliding
  with A's ids stay separate), B's `GET /api/data` never contains A's, coach routes stay GET-only and a non-admin
  gets 403, a client's data is visible to the admin read-only.

---

## 8. Risks (also in the structured plan)

See the plan's `risks` list: Home height, iOS icon cache, rollback data loss of new features, outbox growth during
sessions, timers in background on iOS, drag-reorder on iOS Safari, demo-seed coupling of e2e, kcal estimate
expectations, cross-package string edits ordering.

---

## 9. Work packages (summary — the briefs are in the workflow plan)

| Key | Depends on | Owns (strictly disjoint) | Playwright |
|---|---|---|---|
| core | — | `packages/shared/**`, `apps/server/**`, `apps/web/src/store/**`, `apps/web/src/ui/**`, `apps/web/src/lib/workoutRoutes.ts` (+ test), `e2e/support/{app,server,test,env,coachApi,food}.ts`, `e2e/fixtures/**`, `e2e/{backup,compat,multi-user,sync,offline,coach-api,workouts-api}.spec.ts`, `docs/DEPLOY.md` | its specs |
| rebrand | — | `apps/web/index.html`, `apps/web/vite.config.ts`, `apps/web/scripts/**`, `apps/web/public/**`, `apps/web/src/screens/login/**`, `apps/web/src/shell/{Sidebar.tsx,Sidebar.module.css,BrandMark.tsx,BrandMark.module.css,brandMark.generated.ts}`, `apps/web/src/sheets/install/**`, `apps/web/src/auth/**`, `apps/web/src/pwa/**`, `apps/web/src/screens/settings/users/**`, `README.md`, `Dockerfile`, `deploy/**`, `playwright.config.ts`, `docs/{multi-user,redesign-a,coach-cabinet,meals-macros}.md`, `e2e/{auth,invite,users-admin,brand}.spec.ts` | none |
| exercise-library | core | `apps/web/src/features/exercises/**`, `e2e/exercises.spec.ts`, `e2e/support/exercises.ts` | none |
| integration | core | `apps/web/src/screens/{home,calendar,progress}/**`, `apps/web/src/screens/settings/*` + `settings/account/**`, `apps/web/src/sheets/*` + `sheets/{record,fields,setup}/**`, `apps/web/src/lib/stats/**`, `apps/web/src/lib/stats.ts`, `apps/web/src/lib/stats.test.ts`, `e2e/{home,calendar,capture,day-record,deep-links,food,meals,gestures,onboarding,progress,settings,weight-measure,steps}.spec.ts` | its specs |
| workouts | core, exercise-library, integration | `apps/web/src/features/workouts/**`, `apps/web/src/App.tsx`, `apps/web/src/shell/{nav.ts,shell.test.tsx,AppShell.test.tsx}`, `e2e/{workouts,session,shell}.spec.ts`, `e2e/support/workouts.ts` | its specs + exercises.spec |
| coach-additions | core, integration | `apps/web/src/screens/coach/**`, `e2e/coach.spec.ts`, `e2e/support/coachUi.ts` | none |
| e2e-gate | all | `docs/SPEC.md`, `e2e/{a11y,visual,account,journey}.spec.ts`, `e2e/README.md` | full suite |

This file (`docs/workouts-steps-rebrand.md`) is the architect's; packages do not edit it (report contradictions).
