import {
  compareSessions,
  exerciseSchema,
  foodKey,
  isDayOp,
  isEmptyDay,
  isEmptyMeasure,
  LIMITS,
  MACRO_KEYS,
  mealSchema,
  mergeSettingsPut,
  normalizeDay,
  normalizeExercise,
  normalizeSession,
  normalizeSettings,
  normalizeWorkout,
  reduceDay,
  reduceExercises,
  reduceWorkouts,
  sessionPutBlocked,
  sessionSchema,
  settingsSchema,
  useFood,
  workoutSchema,
  workoutsOn,
  type AppData,
  type DayEntry,
  type DayOp,
  type Exercise,
  type FoodItem,
  type ISODate,
  type Meal,
  type MeasureEntry,
  type MeasureValues,
  type Op,
  type ReminderKind,
  type Settings,
  type StepsEntry,
  type WeightEntry,
  type Workout,
  type WorkoutSession,
} from '@legko/shared';
import { z } from 'zod';
import { silentLogger, type Logger } from '../logger';
import { canonicalTimeZone } from '../timezone';
import { num, numOrNull, text, textOrNull } from './rows';
import type { Database, Row } from './sqlite';
import { transaction } from './tx';
import type { UserId } from './users';

/**
 * Persistence of one user's `AppData`. Writes follow `applyOp()` from `@legko/shared` exactly: every day op is
 * `reduceDay(readDay(date), op)` (the same pure reducer the client runs), an empty day or an empty
 * measurement is a delete, puts are upserts keyed by date, `settings.put` goes through `mergeSettingsPut()`
 * and «Часті страви» through `useFood()` / `foodKey()`.
 *
 * A day with meals keeps its derived food / kcal / photos in the usual columns (old builds, the photo GC,
 * reminders read them) and the meals as JSON in `days.meals` (NULL = a legacy day).
 *
 * Every statement is scoped by `user_id = ?` with the repo's own id bound inside (docs/multi-user.md §4): a
 * `DataRepo` can only ever see and change its user's rows.
 */
export interface DataRepo {
  read(): AppData;
  /** Stored settings filled in with defaults (`normalizeSettings`), defaults when never saved. */
  settings(): Settings;
  /** Applies already-validated ops in order, in one transaction. */
  apply(ops: readonly Op[]): void;
  /** Replaces this user's data (import) in one transaction; nobody else's rows are touched. */
  replaceAll(data: AppData): void;
  /**
   * Stores the canonical form of `timeZone` as `settings.timezone`, unless the stored zone is
   * already the same zone under any spelling (`Europe/Kiev` = `Europe/Kyiv`). Returns the stored
   * id, or null when nothing was written.
   */
  setTimezone(timeZone: string): string | null;
  /**
   * Whether the action a reminder asks for was already recorded for `date`. A workout counts as done when the day
   * has a mark, or a (not deleted) session exists that date — active or done: no push mid-workout.
   */
  isDone(kind: ReminderKind, date: ISODate): boolean;
  /** Names of the workouts scheduled on the weekday of `date` (her order), for the workout reminder. */
  workoutNamesOn(date: ISODate): string[];
}

/** The only way to a `DataRepo`: `forUser(currentUser(c).id)`. */
export interface DataRepos {
  forUser(id: UserId): DataRepo;
}

/**
 * A user id that `coach/access.ts#resolveClient` checked to be an existing role-'user' account (docs/coach-cabinet.md
 * §2.2). Minted nowhere else (coach lint): an admin's `UserId` does not reach a reader.
 */
export type ClientId = UserId & { readonly __coachClient: true };

/** Read-only view of one client's records. There is no write method on it (the coach tests pin the key list). */
export interface DataReader {
  /**
   * Days, weights, measures, settings, exercises, workouts, sessions and steps — never foods (the foods statement is
   * not run) nor the session tombstones.
   */
  read(): Omit<AppData, 'foods' | 'deletedSessions'>;
  /** Same as `DataRepo.settings()`. */
  settings(): Settings;
  /** All weigh-ins, oldest first. */
  weights(): WeightEntry[];
  /** All measurements, oldest first. */
  measures(): MeasureEntry[];
  /** Days with from <= date <= to, oldest first. */
  daysBetween(from: ISODate, to: ISODate): { date: ISODate; entry: DayEntry }[];
  /** Earliest / latest date <= `to` that has a day, a weigh-in or a measurement; null when none. */
  recordSpan(to: ISODate): { first: ISODate | null; last: ISODate | null };
  /** Steps with from <= date <= to, oldest first. */
  stepsBetween(from: ISODate, to: ISODate): StepsEntry[];
  /** DONE sessions with from <= date <= to, in session order. */
  sessionsBetween(from: ISODate, to: ISODate): WorkoutSession[];
  /** Her workouts, in her order. */
  workouts(): Workout[];
}

/** Not part of `RouteDeps`: `createApp` hands it only to `createCoachAccess`. */
export interface DataReaders {
  readerFor(id: ClientId): DataReader;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const trainedToSql = (t: boolean | null): number | null => (t === null ? null : t ? 1 : 0);
const trainedFromSql = (v: number | null): boolean | null => (v === null ? null : v === 1);

function parseStringArray(row: Row, column: string): string[] {
  const parsed: unknown = JSON.parse(text(row, column));
  if (!Array.isArray(parsed)) throw new TypeError(`days.${column}: expected a JSON array`);
  return parsed.filter((t): t is string => typeof t === 'string');
}

const storedMealsSchema = z.array(mealSchema);

/** `days.meals` → the meals, `[]` for a legacy day (NULL), or null when the JSON is unusable. */
function parseMeals(raw: string | null): Meal[] | null {
  if (raw === null) return [];
  try {
    const parsed = storedMealsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

function dayFromRow(row: Row, logger: Logger): DayEntry {
  const day: DayEntry = {
    food: text(row, 'food'),
    kcal: numOrNull(row, 'kcal'),
    trained: trainedFromSql(numOrNull(row, 'trained')),
    types: parseStringArray(row, 'types'),
    notes: text(row, 'notes'),
  };
  // Same shape as normalizeDay(): `photos` only when there are some, `meals` only when non-empty.
  const photos = parseStringArray(row, 'photos');
  if (photos.length) day.photos = photos;
  const meals = parseMeals(textOrNull(row, 'meals'));
  if (meals === null) {
    // The derived columns still hold the food text, kcal and photos: serve it as a legacy day (the next
    // meal op converts it again). Never log the content.
    logger.warn(
      `days.meals of ${text(row, 'date')} is not valid meal data: serving the day without its meals`,
    );
  } else if (meals.length) {
    day.meals = meals;
  }
  return day;
}

const measureFromRow = (row: Row): MeasureEntry => ({
  date: text(row, 'date'),
  chest: numOrNull(row, 'chest'),
  waist: numOrNull(row, 'waist'),
  hips: numOrNull(row, 'hips'),
});

function foodFromRow(row: Row): FoodItem {
  const food: FoodItem = {
    name: text(row, 'name'),
    portion: text(row, 'portion'),
    kcal: num(row, 'kcal'),
    count: num(row, 'count'),
    lastUsed: text(row, 'last_used'),
  };
  // NULL = unknown: the key is omitted, as in useFood().
  for (const key of MACRO_KEYS) {
    const v = numOrNull(row, key);
    if (v !== null) food[key] = v;
  }
  return food;
}

/** A JSON column through its schema; null and a content-free warning when it is unusable (the row is skipped). */
function parseStored<T>(raw: string, schema: z.ZodType<T>, what: string, logger: Logger): T | null {
  try {
    const parsed = schema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;
  } catch {
    // fall through
  }
  logger.warn(`A stored ${what} is not valid: skipping it`);
  return null;
}

const notNull = <T>(v: T | null): v is T => v !== null;

type Statement = ReturnType<Database['prepare']>;

/** Statements prepared on first use (each key once). */
function lazyStatements<K extends string>(db: Database, sqls: Record<K, string>): Readonly<Record<K, Statement>> {
  const out = {} as Record<K, Statement>;
  for (const key of Object.keys(sqls) as K[]) {
    let statement: Statement | undefined;
    Object.defineProperty(out, key, {
      enumerable: true,
      get: () => (statement ??= db.prepare(sqls[key])),
    });
  }
  return out;
}

/** `createDataAccess(...).repos`: unchanged signature and behaviour (backup, CLI, reminders, tests). */
export function createDataRepos(
  db: Database,
  now: () => number = Date.now,
  logger: Logger = silentLogger,
): DataRepos {
  return createDataAccess(db, now, logger).repos;
}

/** The earlier / later of two optional dates. */
const minDate = (a: ISODate | null, b: ISODate | null): ISODate | null =>
  a === null ? b : b === null ? a : a < b ? a : b;
const maxDate = (a: ISODate | null, b: ISODate | null): ISODate | null =>
  a === null ? b : b === null ? a : a > b ? a : b;

/**
 * The read-write repos and the read-only readers, on ONE set of prepared statements (docs/coach-cabinet.md §2.2).
 * `readers` never leaves `createApp` except into `createCoachAccess`.
 */
export function createDataAccess(
  db: Database,
  now: () => number = Date.now,
  logger: Logger = silentLogger,
): { repos: DataRepos; readers: DataReaders } {
  // Prepared once for every user; each statement binds the user id first.
  const q = {
    allDays: db.prepare(
      'SELECT date, food, kcal, trained, types, notes, photos, meals FROM days WHERE user_id = ? ORDER BY date',
    ),
    daysBetween: db.prepare(
      `SELECT date, food, kcal, trained, types, notes, photos, meals FROM days
       WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date`,
    ),
    // Three statements on purpose: a UNION over per-user tables would need a scope-lint exemption.
    daySpan: db.prepare(
      'SELECT MIN(date) AS first, MAX(date) AS last FROM days WHERE user_id = ? AND date <= ?',
    ),
    weightSpan: db.prepare(
      'SELECT MIN(date) AS first, MAX(date) AS last FROM weights WHERE user_id = ? AND date <= ?',
    ),
    measureSpan: db.prepare(
      'SELECT MIN(date) AS first, MAX(date) AS last FROM measures WHERE user_id = ? AND date <= ?',
    ),
    getDay: db.prepare(
      'SELECT date, food, kcal, trained, types, notes, photos, meals FROM days WHERE user_id = ? AND date = ?',
    ),
    allWeights: db.prepare('SELECT date, kg FROM weights WHERE user_id = ? ORDER BY date'),
    allMeasures: db.prepare('SELECT date, chest, waist, hips FROM measures WHERE user_id = ? ORDER BY date'),
    // `position` keeps the array order of AppData.foods, so reads equal what applyOp() produces.
    allFoods: db.prepare(
      `SELECT name, portion, kcal, count, last_used, protein, fat, carbs FROM foods WHERE user_id = ?
       ORDER BY position`,
    ),
    // `meals` is in the update list too: a legacy write must clear a stale meal list.
    putDay: db.prepare(
      `INSERT INTO days (user_id, date, food, kcal, trained, types, notes, photos, meals, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET food = excluded.food, kcal = excluded.kcal,
         trained = excluded.trained, types = excluded.types, notes = excluded.notes, photos = excluded.photos,
         meals = excluded.meals, updated_at = excluded.updated_at`,
    ),
    deleteDay: db.prepare('DELETE FROM days WHERE user_id = ? AND date = ?'),
    putWeight: db.prepare(
      `INSERT INTO weights (user_id, date, kg, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET kg = excluded.kg, updated_at = excluded.updated_at`,
    ),
    deleteWeight: db.prepare('DELETE FROM weights WHERE user_id = ? AND date = ?'),
    putMeasure: db.prepare(
      `INSERT INTO measures (user_id, date, chest, waist, hips, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET chest = excluded.chest, waist = excluded.waist,
         hips = excluded.hips, updated_at = excluded.updated_at`,
    ),
    deleteMeasure: db.prepare('DELETE FROM measures WHERE user_id = ? AND date = ?'),
    insertFood: db.prepare(
      `INSERT INTO foods (user_id, key, position, name, portion, kcal, count, last_used, protein, fat, carbs)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ),
    hasWeight: db.prepare('SELECT 1 AS found FROM weights WHERE user_id = ? AND date = ?'),
    hasMeasure: db.prepare('SELECT 1 AS found FROM measures WHERE user_id = ? AND date = ?'),
    dayTrained: db.prepare('SELECT trained FROM days WHERE user_id = ? AND date = ?'),
    getSettings: db.prepare('SELECT value FROM user_settings WHERE user_id = ?'),
    putSettings: db.prepare(
      `INSERT INTO user_settings (user_id, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT (user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    ),
    // replaceAll: one scoped statement per table (never a multi-statement exec).
    clearDays: db.prepare('DELETE FROM days WHERE user_id = ?'),
    clearWeights: db.prepare('DELETE FROM weights WHERE user_id = ?'),
    clearMeasures: db.prepare('DELETE FROM measures WHERE user_id = ?'),
    clearFoods: db.prepare('DELETE FROM foods WHERE user_id = ?'),
    hasV5Tables: db.prepare("SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = 'workout_sessions'"),
  };

  // Schema v5 tables: prepared on first use, so the repo still opens a v4 file (downgrade tests, maintenance).
  const v5 = lazyStatements(db, {
    // Exercises / workouts: ≤ 350 small rows rewritten per batch (the foods
    // pattern) so `position` keeps the array order of applyOp().
    allExercises: 'SELECT value FROM exercises WHERE user_id = ? ORDER BY position',
    insertExercise: 'INSERT INTO exercises (user_id, id, position, value, updated_at) VALUES (?, ?, ?, ?, ?)',
    clearExercises: 'DELETE FROM exercises WHERE user_id = ?',
    allWorkouts: 'SELECT value FROM workouts WHERE user_id = ? ORDER BY position',
    insertWorkout: 'INSERT INTO workouts (user_id, id, position, value, updated_at) VALUES (?, ?, ?, ?, ?)',
    clearWorkouts: 'DELETE FROM workouts WHERE user_id = ?',
    // Sessions: one row each; a deleted one stays as a tombstone (status 'deleted', value '{}').
    liveSessions: "SELECT value FROM workout_sessions WHERE user_id = ? AND status <> 'deleted'",
    doneSessionsBetween: `SELECT value FROM workout_sessions
       WHERE user_id = ? AND date >= ? AND date <= ? AND status = 'done'`,
    tombstones: "SELECT id FROM workout_sessions WHERE user_id = ? AND status = 'deleted' ORDER BY id",
    countTombstones: "SELECT COUNT(*) AS n FROM workout_sessions WHERE user_id = ? AND status = 'deleted'",
    getSession: 'SELECT date, status, value FROM workout_sessions WHERE user_id = ? AND id = ?',
    countSessionsOn: `SELECT COUNT(*) AS n FROM workout_sessions
       WHERE user_id = ? AND date = ? AND status <> 'deleted' AND id <> ?`,
    putSession: `INSERT INTO workout_sessions (user_id, id, date, status, value, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (user_id, id) DO UPDATE SET date = excluded.date, status = excluded.status,
         value = excluded.value, updated_at = excluded.updated_at`,
    deleteSessionRow: 'DELETE FROM workout_sessions WHERE user_id = ? AND id = ?',
    hasSessionOn: "SELECT 1 AS found FROM workout_sessions WHERE user_id = ? AND date = ? AND status <> 'deleted' LIMIT 1",
    clearSessions: 'DELETE FROM workout_sessions WHERE user_id = ?',
    allSteps: 'SELECT date, steps FROM steps WHERE user_id = ? ORDER BY date',
    stepsBetween: 'SELECT date, steps FROM steps WHERE user_id = ? AND date >= ? AND date <= ? ORDER BY date',
    putSteps: `INSERT INTO steps (user_id, date, steps, updated_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (user_id, date) DO UPDATE SET steps = excluded.steps, updated_at = excluded.updated_at`,
    deleteSteps: 'DELETE FROM steps WHERE user_id = ? AND date = ?',
    clearSteps: 'DELETE FROM steps WHERE user_id = ?',
  });

  const stepsFromRows = (rows: readonly Row[]): StepsEntry[] =>
    rows.map((row) => ({ date: text(row, 'date'), steps: num(row, 'steps') }));

  const readExercises = (id: UserId): Exercise[] =>
    v5.allExercises
      .all(id)
      .map((row) => parseStored(text(row, 'value'), exerciseSchema, 'exercise', logger))
      .filter(notNull);

  const readWorkouts = (id: UserId): Workout[] =>
    v5.allWorkouts
      .all(id)
      .map((row) => parseStored(text(row, 'value'), workoutSchema, 'workout', logger))
      .filter(notNull);

  const sessionsFromRows = (rows: readonly Row[]): WorkoutSession[] =>
    rows
      .map((row) => parseStored(text(row, 'value'), sessionSchema, 'workout session', logger))
      .filter(notNull)
      .sort(compareSessions);

  const readSessions = (id: UserId): WorkoutSession[] => sessionsFromRows(v5.liveSessions.all(id));
  const readSteps = (id: UserId): StepsEntry[] => stepsFromRows(v5.allSteps.all(id));

  function readSettings(id: UserId): Settings {
    const row = q.getSettings.get(id);
    if (!row) return normalizeSettings(null);
    try {
      const parsed: unknown = JSON.parse(text(row, 'value'));
      // Older rows may miss newer fields: fill them in first, then validate the result.
      const candidate = normalizeSettings(isRecord(parsed) ? (parsed as Partial<Settings>) : null);
      const result = settingsSchema.safeParse(candidate);
      if (result.success) return result.data;
    } catch {
      // fall through to defaults
    }
    logger.warn(`Stored settings of user ${id} are invalid, serving defaults until the next settings.put`);
    return normalizeSettings(null);
  }

  const readWeights = (id: UserId): WeightEntry[] =>
    q.allWeights.all(id).map((row) => ({ date: text(row, 'date'), kg: num(row, 'kg') }));

  const readMeasures = (id: UserId): MeasureEntry[] => q.allMeasures.all(id).map(measureFromRow);

  /** Everything of `AppData` but «Часті страви»: what both `forUser().read()` and `reader.read()` start from. */
  function readCore(id: UserId): Omit<AppData, 'foods' | 'deletedSessions'> {
    const days: Record<ISODate, DayEntry> = {};
    for (const row of q.allDays.all(id)) days[text(row, 'date')] = dayFromRow(row, logger);
    // A v4 file (maintenance before the server migrates it, downgrade tests) has no workouts or steps yet.
    const v5Tables = q.hasV5Tables.get() !== undefined;
    return {
      days,
      weights: readWeights(id),
      measures: readMeasures(id),
      settings: readSettings(id),
      exercises: v5Tables ? readExercises(id) : [],
      workouts: v5Tables ? readWorkouts(id) : [],
      sessions: v5Tables ? readSessions(id) : [],
      steps: v5Tables ? readSteps(id) : [],
    };
  }

  function forUser(id: UserId): DataRepo {
    const ownSettings = (): Settings => readSettings(id);

    const writeSettings = (s: Settings): void => {
      q.putSettings.run(id, JSON.stringify(s), now());
    };

    const readFoods = (): FoodItem[] => q.allFoods.all(id).map(foodFromRow);

    /** At most 200 small rows: rewriting them all keeps the stored order identical to the array. */
    function writeFoods(foods: readonly FoodItem[]): void {
      q.clearFoods.run(id);
      foods.forEach((f, position) =>
        q.insertFood.run(
          id,
          foodKey(f.name),
          position,
          f.name,
          f.portion,
          f.kcal,
          f.count,
          f.lastUsed,
          f.protein ?? null,
          f.fat ?? null,
          f.carbs ?? null,
        ),
      );
    }

    function writeExercises(list: readonly Exercise[], at: number): void {
      v5.clearExercises.run(id);
      list.forEach((e, position) => v5.insertExercise.run(id, e.id, position, JSON.stringify(e), at));
    }

    function writeWorkouts(list: readonly Workout[], at: number): void {
      v5.clearWorkouts.run(id);
      list.forEach((w, position) => v5.insertWorkout.run(id, w.id, position, JSON.stringify(w), at));
    }

    /** Keeps the newest LIMITS.deletedSessions tombstones by id, as the shared reducer does. */
    function pruneTombstones(): void {
      const count = num(v5.countTombstones.get(id) ?? { n: 0 }, 'n');
      if (count <= LIMITS.deletedSessions) return;
      const ids = v5.tombstones.all(id).map((row) => text(row, 'id'));
      for (const old of ids.slice(0, count - LIMITS.deletedSessions)) v5.deleteSessionRow.run(id, old);
    }

    /** `session.put` on its row, with the W13 rules of the shared `reduceSessions` (sessionPutBlocked). */
    function putSession(raw: WorkoutSession, at: number): void {
      const value = normalizeSession(raw);
      const row = v5.getSession.get(id, value.id);
      const tombstoned = row !== undefined && text(row, 'status') === 'deleted';
      const stored =
        row && !tombstoned
          ? (parseStored(text(row, 'value'), sessionSchema, 'workout session', logger) ?? undefined)
          : undefined;
      const onDate = num(v5.countSessionsOn.get(id, value.date, value.id) ?? { n: 0 }, 'n');
      if (sessionPutBlocked(value, stored, tombstoned, onDate)) return;
      v5.putSession.run(id, value.id, value.date, value.status, JSON.stringify(value), at);
    }

    /** `session.delete`: the row becomes a tombstone (date kept, '' when the id was never stored). */
    function deleteSession(sessionId: string, at: number): void {
      const row = v5.getSession.get(id, sessionId);
      v5.putSession.run(id, sessionId, row ? text(row, 'date') : '', 'deleted', '{}', at);
      pruneTombstones();
    }

    function readDay(date: ISODate): DayEntry | undefined {
      const row = q.getDay.get(id, date);
      return row ? dayFromRow(row, logger) : undefined;
    }

    /** Stores an already normalised, non-empty day: the derived columns and the meals (NULL for a legacy day). */
    function writeDay(date: ISODate, entry: DayEntry, at: number): void {
      q.putDay.run(
        id,
        date,
        entry.food,
        entry.kcal,
        trainedToSql(entry.trained),
        JSON.stringify(entry.types),
        entry.notes,
        JSON.stringify(entry.photos ?? []),
        entry.meals?.length ? JSON.stringify(entry.meals) : null,
        at,
      );
    }

    /** One day op through the shared reducer, on the stored day. */
    function applyDayOp(op: DayOp, at: number): void {
      const next = reduceDay(readDay(op.date), op);
      if (next) writeDay(op.date, next, at);
      else q.deleteDay.run(id, op.date);
    }

    function putMeasure(date: ISODate, value: MeasureValues, at: number): void {
      if (isEmptyMeasure(value)) q.deleteMeasure.run(id, date);
      else q.putMeasure.run(id, date, value.chest, value.waist, value.hips, at);
    }

    type RowOp = Exclude<
      Op,
      | DayOp
      | { kind: 'food.use' | 'food.delete' }
      | { kind: 'exercise.put' | 'exercise.delete' | 'workout.put' | 'workout.delete' }
    >;

    function applyRowOp(op: RowOp, at: number): void {
      switch (op.kind) {
        case 'session.put':
          return putSession(op.value, at);
        case 'session.delete':
          return deleteSession(op.id, at);
        case 'steps.put':
          v5.putSteps.run(id, op.date, op.steps, at);
          return;
        case 'steps.delete':
          v5.deleteSteps.run(id, op.date);
          return;
        case 'weight.put':
          q.putWeight.run(id, op.date, op.kg, at);
          return;
        case 'weight.delete':
          q.deleteWeight.run(id, op.date);
          return;
        case 'measure.put':
          return putMeasure(op.date, op.value, at);
        case 'measure.delete':
          q.deleteMeasure.run(id, op.date);
          return;
        case 'settings.put':
          // An absent mealTypes / macroGoals (old clients) keeps the stored value.
          return writeSettings(mergeSettingsPut(ownSettings(), op.value));
      }
    }

    return {
      read(): AppData {
        const core = readCore(id);
        return {
          days: core.days,
          weights: core.weights,
          measures: core.measures,
          foods: readFoods(),
          settings: core.settings,
          exercises: core.exercises,
          workouts: core.workouts,
          sessions: core.sessions,
          steps: core.steps,
          deletedSessions: q.hasV5Tables.get() !== undefined ? v5.tombstones.all(id).map((row) => text(row, 'id')) : [],
        };
      },

      settings: ownSettings,

      apply(ops) {
        const at = now();
        transaction(db, () => {
          // Food ops reuse the shared reducer: read once, fold the batch's food ops, write once.
          let foods: FoodItem[] | null = null;
          // Exercises and workouts likewise: the shared reducers fold the batch, then the rows are rewritten.
          let exercises: Exercise[] | null = null;
          let workouts: Workout[] | null = null;
          for (const op of ops) {
            if (op.kind === 'food.use') {
              foods = useFood(foods ?? readFoods(), op.value, op.date);
            } else if (op.kind === 'food.delete') {
              const key = foodKey(op.name);
              foods = (foods ?? readFoods()).filter((f) => foodKey(f.name) !== key);
            } else if (op.kind === 'exercise.put' || op.kind === 'exercise.delete') {
              exercises = reduceExercises(exercises ?? readExercises(id), op);
            } else if (op.kind === 'workout.put' || op.kind === 'workout.delete') {
              workouts = reduceWorkouts(workouts ?? readWorkouts(id), op);
            } else if (isDayOp(op)) {
              applyDayOp(op, at);
            } else {
              applyRowOp(op, at);
            }
          }
          if (foods) writeFoods(foods);
          if (exercises) writeExercises(exercises, at);
          if (workouts) writeWorkouts(workouts, at);
        });
      },

      replaceAll(data) {
        const at = now();
        transaction(db, () => {
          q.clearDays.run(id);
          q.clearWeights.run(id);
          q.clearMeasures.run(id);
          // Re-normalised: the derived fields of days with meals are recomputed; `meals: []` is a legacy day.
          for (const [date, entry] of Object.entries(data.days)) {
            const day = normalizeDay(entry);
            if (!isEmptyDay(day)) writeDay(date, day, at);
          }
          for (const w of data.weights) q.putWeight.run(id, w.date, w.kg, at);
          for (const m of data.measures) putMeasure(m.date, m, at);
          writeFoods(data.foods);
          writeSettings(data.settings);
          // Workouts and steps: an older backup has none, so restoring it clears them («відновити копію»).
          v5.clearSessions.run(id);
          v5.clearSteps.run(id);
          writeExercises((data.exercises ?? []).map(normalizeExercise), at);
          writeWorkouts((data.workouts ?? []).map(normalizeWorkout), at);
          const sessions = (data.sessions ?? []).map(normalizeSession).sort(compareSessions);
          const live = new Set(sessions.map((s) => s.id));
          for (const s of sessions) v5.putSession.run(id, s.id, s.date, s.status, JSON.stringify(s), at);
          for (const dead of data.deletedSessions ?? [])
            if (!live.has(dead)) v5.putSession.run(id, dead, '', 'deleted', '{}', at);
          pruneTombstones();
          for (const s of data.steps ?? []) v5.putSteps.run(id, s.date, s.steps, at);
        });
      },

      setTimezone(timeZone) {
        const zone = canonicalTimeZone(timeZone);
        return transaction(db, () => {
          const current = ownSettings();
          if (canonicalTimeZone(current.timezone) === zone) return null;
          writeSettings({ ...current, timezone: zone });
          return zone;
        });
      },

      isDone(kind, date) {
        switch (kind) {
          case 'weigh':
            return q.hasWeight.get(id, date) !== undefined;
          case 'measure':
            return q.hasMeasure.get(id, date) !== undefined;
          case 'workout': {
            const row = q.dayTrained.get(id, date);
            if (row !== undefined && numOrNull(row, 'trained') !== null) return true;
            return v5.hasSessionOn.get(id, date) !== undefined;
          }
        }
      },

      workoutNamesOn(date) {
        return workoutsOn(readWorkouts(id), date).map((w) => w.name);
      },
    };
  }

  /** Read-only: nothing here writes, and foods are never read (docs/coach-cabinet.md C11). */
  function readerFor(id: ClientId): DataReader {
    function recordSpan(to: ISODate): { first: ISODate | null; last: ISODate | null } {
      let first: ISODate | null = null;
      let last: ISODate | null = null;
      for (const statement of [q.daySpan, q.weightSpan, q.measureSpan]) {
        const row = statement.get(id, to);
        if (!row) continue;
        first = minDate(first, textOrNull(row, 'first'));
        last = maxDate(last, textOrNull(row, 'last'));
      }
      return { first, last };
    }
    return Object.freeze({
      read: (): Omit<AppData, 'foods' | 'deletedSessions'> => readCore(id),
      settings: (): Settings => readSettings(id),
      weights: (): WeightEntry[] => readWeights(id),
      measures: (): MeasureEntry[] => readMeasures(id),
      daysBetween: (from: ISODate, to: ISODate): { date: ISODate; entry: DayEntry }[] =>
        q.daysBetween
          .all(id, from, to)
          .map((row) => ({ date: text(row, 'date'), entry: dayFromRow(row, logger) })),
      recordSpan,
      stepsBetween: (from: ISODate, to: ISODate): StepsEntry[] => stepsFromRows(v5.stepsBetween.all(id, from, to)),
      sessionsBetween: (from: ISODate, to: ISODate): WorkoutSession[] =>
        sessionsFromRows(v5.doneSessionsBetween.all(id, from, to)),
      workouts: (): Workout[] => readWorkouts(id),
    });
  }

  return { repos: { forUser }, readers: { readerFor } };
}
