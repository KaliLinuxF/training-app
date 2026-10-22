/**
 * App data store — the single source of truth the screens read from.
 *
 * Contract (keep these exports stable, screens depend on them):
 * - `useAppData()` / `useSettings()` / `useSyncState()` — React hooks.
 * - `dataActions.*` — every change goes through here: it is applied optimistically,
 *   persisted on the device (IndexedDB) and queued for the server (works offline).
 * - `startSync(id)` — called by `AuthGate` once the device user is known; loads that user's device cache, then
 *   the server copy, and keeps flushing the queue (every request carries `X-Legko-User: id`). Returns a cleanup.
 * - `flushNow()`, `resetLocal()`, `onUnauthorized()`, `onUserMismatch()`, `hasDeviceCache()`,
 *   `refreshFromServer()`, `clearSyncError()` — used by the auth layer and settings screens; `bindOwner()`,
 *   `adoptLegacy()`, `rehydrate()`, `resumeSync()`, `stopSync()` — by the auth layer only.
 *
 * Implementation: `state.ts` (zustand), `cache.ts` (IndexedDB), `sync.ts` (outbox + server).
 */
import {
  activeSession,
  isLiveSession,
  LIMITS,
  MAX_SESSION_SEC,
  mergeTypes,
  newSessionFromWorkout,
  normalizeMeal,
  normalizeSession,
  opSchema,
  OWN_ID_RE,
  reduceDay,
  sessionPutBlocked,
  sessionWorkoutTypes,
  WEEK_ORDER,
  type AppData,
  type DayEntry,
  type DayMeta,
  type Exercise,
  type FoodUse,
  type ISODate,
  type Meal,
  type MeasureValues,
  type Op,
  type Settings,
  type Weekday,
  type Workout,
  type WorkoutSession,
} from '@legko/shared';
import { useDataStore, type SyncState } from './state';
import { commitOps, importAll } from './sync';

export { useDataStore, type DataStore, type SyncState } from './state';
export {
  adoptLegacy,
  bindOwner,
  boundOwner,
  clearSyncError,
  flushNow,
  hasDeviceCache,
  isSyncPaused,
  onUnauthorized,
  onUserMismatch,
  refreshFromServer,
  rehydrate,
  resetLocal,
  resumeSync,
  startSync,
  stopSync,
} from './sync';

export const useAppData = (): AppData => useDataStore((s) => s.data);
export const useSettings = (): Settings => useDataStore((s) => s.data.settings);
export const useSyncState = (): SyncState => useDataStore((s) => s.sync);
export const getAppData = (): AppData => useDataStore.getState().data;

/**
 * Applies ops locally right away and queues them for the server.
 * Returns `false` (and applies nothing) when an op is invalid — callers should keep the user's input then.
 */
export function commit(...ops: Op[]): boolean {
  return commitOps(ops);
}

const MEAL_ID_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * A new meal's id: 12 random base64url characters (72 bits). `crypto.getRandomValues` works on LAN http too;
 * `Math.random` is only the fallback for environments without Web Crypto.
 */
export function newMealId(): string {
  const bytes = new Uint8Array(12);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function')
    crypto.getRandomValues(bytes);
  else for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  return Array.from(bytes, (b) => MEAL_ID_ALPHABET[b & 63] ?? 'A').join('');
}

/** A new id for her exercises, workouts, sessions and item keys: same alphabet and length as `newMealId`. */
export const newId = (): string => newMealId();

const DEVICE_ID_KEY = 'legko.deviceId';
let memoryDeviceId: string | null = null;

/**
 * This device's id (W4: the one device that writes a live session). Kept in `localStorage['legko.deviceId']`; where
 * storage is unavailable (private mode, blocked site data) a per-tab id in memory.
 */
export function deviceId(): string {
  try {
    const stored = localStorage.getItem(DEVICE_ID_KEY);
    if (stored && OWN_ID_RE.test(stored)) return stored;
    const id = newId();
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    memoryDeviceId ??= newId();
    return memoryDeviceId;
  }
}

/** Plan days (`rem.workout.days`) plus `days`, Monday-first; null when nothing is added. */
function planWith(settings: Settings, days: readonly Weekday[]): Weekday[] | null {
  const plan = settings.rem.workout.days;
  if (days.every((d) => plan.includes(d))) return null;
  return WEEK_ORDER.filter((d) => plan.includes(d) || days.includes(d)) as Weekday[];
}

/** Whether the reducer would store this put (false: a no-op by W13 or the 10-per-day cap). An invalid value → true: commit() refuses it and says so. */
function wouldStore(value: WorkoutSession): boolean {
  const parsed = opSchema.safeParse({ kind: 'session.put', value });
  if (!parsed.success || parsed.data.kind !== 'session.put') return true;
  const data = getAppData();
  const v = normalizeSession(parsed.data.value);
  const stored = data.sessions.find((s) => s.id === v.id);
  const onDate = data.sessions.filter((s) => s.date === v.date).length;
  return sessionPutBlocked(v, stored, data.deletedSessions.includes(v.id), onDate) === null;
}

const findSession = (id: string): WorkoutSession | undefined => getAppData().sessions.find((s) => s.id === id);

/** `day.meta` marking `date` trained with the session's derived types merged into hers. */
function trainedMeta(session: WorkoutSession): Op {
  const day = getAppData().days[session.date];
  return {
    kind: 'day.meta',
    date: session.date,
    value: { trained: true, types: mergeTypes(day, sessionWorkoutTypes(session)) },
  };
}

/** Only the keys that are set: `day.meta` applies exactly what it carries. */
function metaValue(meta: DayMeta): DayMeta {
  const value: DayMeta = {};
  if (meta.trained !== undefined) value.trained = meta.trained;
  if (meta.types !== undefined) value.types = meta.types;
  if (meta.notes !== undefined) value.notes = meta.notes;
  return value;
}

export const dataActions = {
  /**
   * Saves one meal of `date` (upsert by `meal.id`; a legacy day is converted; an empty meal deletes it), plus a
   * `food.use` for each dish of `uses` (an invalid use is left out: it must never block the meal).
   * Returns `false` and commits nothing when the meal is refused: invalid (the sync notice says so), or a new
   * meal on a day that already has 20 (the reducer would not add it).
   */
  saveMeal(date: ISODate, meal: Meal, uses: readonly FoodUse[] = []): boolean {
    const op: Op = { kind: 'meal.put', date, value: meal };
    const parsed = opSchema.safeParse(op);
    if (parsed.success && parsed.data.kind === 'meal.put' && normalizeMeal(parsed.data.value) !== null) {
      // A non-empty meal that the reducer would not keep: the 21st meal of the day.
      const next = reduceDay(getAppData().days[date], parsed.data);
      if (!next?.meals?.some((m) => m.id === meal.id)) return false;
    }
    const useOps = uses
      .map((value): Op => ({ kind: 'food.use', date, value }))
      .filter((use) => opSchema.safeParse(use).success);
    return commit(op, ...useOps);
  },
  /** Removes one meal (`LEGACY_MEAL_ID` clears a legacy day's food). */
  deleteMeal(date: ISODate, id: string): boolean {
    return commit({ kind: 'meal.delete', date, id });
  },
  /** Workout mark / types / notes of `date`: only the keys given are written (never the food). */
  setDayMeta(date: ISODate, meta: DayMeta): boolean {
    return commit({ kind: 'day.meta', date, value: metaValue(meta) });
  },
  /**
   * @deprecated Whole-day legacy write (`day.put`): no new callers — use `saveMeal` / `setDayMeta`. Meals in
   * `entry` are stripped by the op schema; on a day with meals the server keeps them (Rule L).
   */
  saveDay(date: ISODate, entry: DayEntry): boolean {
    return commit({ kind: 'day.put', date, value: entry });
  },
  /**
   * @deprecated Legacy `day.delete`: on a day with meals it keeps the meals and clears only the workout mark,
   * types and notes. No new callers.
   */
  deleteDay(date: ISODate): boolean {
    return commit({ kind: 'day.delete', date });
  },
  /** `null` removes the weigh-in for that date. */
  setWeight(date: ISODate, kg: number | null): boolean {
    return commit(kg == null ? { kind: 'weight.delete', date } : { kind: 'weight.put', date, kg });
  },
  /** `null` (or all three values empty) removes the measurements for that date. */
  setMeasure(date: ISODate, m: MeasureValues | null): boolean {
    return commit(
      m == null || (m.chest == null && m.waist == null && m.hips == null)
        ? { kind: 'measure.delete', date }
        : { kind: 'measure.put', date, value: m },
    );
  },
  updateSettings(update: (s: Settings) => Settings): boolean {
    return commit({ kind: 'settings.put', value: update(getAppData().settings) });
  },

  // ---- workouts and steps (docs/workouts-steps-rebrand.md §1.3.1) -------------------------------

  /** Her own exercise (upsert). `false` when invalid, or a new one beyond 300. */
  saveExercise(exercise: Exercise): boolean {
    const own = getAppData().exercises;
    if (!own.some((e) => e.id === exercise.id) && own.length >= LIMITS.customExercises) return false;
    return commit({ kind: 'exercise.put', value: exercise });
  },
  /** Removes her exercise and, in the same commit, from every workout that used it. */
  deleteExercise(id: string): boolean {
    const affected = getAppData()
      .workouts.filter((w) => w.items.some((i) => i.exerciseId === id))
      .map((w): Op => ({ kind: 'workout.put', value: { ...w, items: w.items.filter((i) => i.exerciseId !== id) } }));
    return commit({ kind: 'exercise.delete', id }, ...affected);
  },
  /**
   * Saves a workout (upsert, keeps its place). Days not in the plan yet are added to it (`settings.put` with
   * `rem.workout.days` = the union, W6); removing days never removes plan days. `false` when invalid or a new 51st.
   */
  saveWorkout(workout: Workout): boolean {
    const data = getAppData();
    if (!data.workouts.some((w) => w.id === workout.id) && data.workouts.length >= LIMITS.workouts) return false;
    const ops: Op[] = [{ kind: 'workout.put', value: workout }];
    const plan = planWith(data.settings, workout.days);
    if (plan) {
      const s = data.settings;
      ops.push({ kind: 'settings.put', value: { ...s, rem: { ...s.rem, workout: { ...s.rem.workout, days: plan } } } });
    }
    return commit(...ops);
  },
  /** Deletes a workout (plan days and past sessions stay). */
  deleteWorkout(id: string): boolean {
    return commit({ kind: 'workout.delete', id });
  },
  /**
   * Starts a live session of `workoutId` (null = «Вільне тренування») on `date`, prefilled from last time. When a
   * live session already exists (any date, W14) returns ITS id and commits nothing (the UI asks, §3.5). Null when
   * refused (unknown workout, invalid, the day already has 10 sessions).
   */
  startSession(date: ISODate, workoutId: string | null, now: number = Date.now()): string | null {
    const data = getAppData();
    const live = activeSession(data, now);
    if (live) return live.id;
    const workout = workoutId === null ? null : data.workouts.find((w) => w.id === workoutId);
    if (workout === undefined) return null;
    const session: WorkoutSession = {
      ...newSessionFromWorkout({ data, workout, date, id: newId(), now, newKey: newId, status: 'active' }),
      rev: 0,
      deviceId: deviceId(),
    };
    if (!wouldStore(session)) return null;
    return commit({ kind: 'session.put', value: session }) ? session.id : null;
  },
  /** A past-day log, NOT committed: status done, every prefilled set done, no start or finish time. */
  draftSession(date: ISODate, workoutId: string | null, now: number = Date.now()): WorkoutSession {
    const data = getAppData();
    const workout = workoutId === null ? null : (data.workouts.find((w) => w.id === workoutId) ?? null);
    return newSessionFromWorkout({ data, workout, date, id: newId(), now, newKey: newId, status: 'done' });
  },
  /** A live edit (a confirmed set, an added exercise…): `session.put` with the stored rev + 1. */
  saveSession(session: WorkoutSession): boolean {
    const value = { ...session, rev: (findSession(session.id)?.rev ?? session.rev) + 1 };
    if (!wouldStore(value)) return false;
    return commit({ kind: 'session.put', value });
  },
  /** «Продовжити тут» (W4): this device becomes the live session's writer. */
  takeOverSession(id: string): boolean {
    const stored = findSession(id);
    if (!stored || stored.status !== 'active') return false;
    return commit({ kind: 'session.put', value: { ...stored, deviceId: deviceId(), rev: stored.rev + 1 } });
  },
  /**
   * Finishes a session: done, finished now, no writer, `durationSec` = elapsed (clamped to 0…6 h) while live, null
   * when stale (editable later); in the same commit the day is marked trained with the derived types merged in.
   */
  finishSession(id: string, now: number = Date.now()): boolean {
    const stored = findSession(id);
    if (!stored || stored.status !== 'active') return false;
    const durationSec =
      isLiveSession(stored, now) && stored.startedAt !== null
        ? Math.min(MAX_SESSION_SEC, Math.max(0, Math.round((now - stored.startedAt) / 1000)))
        : null;
    const done: WorkoutSession = {
      ...stored,
      status: 'done',
      finishedAt: Math.max(0, Math.round(now)),
      durationSec,
      deviceId: null,
      rev: stored.rev + 1,
    };
    return commit({ kind: 'session.put', value: done }, trainedMeta(done));
  },
  /** A past-day log or an edit of a done session: `session.put` (rev + 1) + the day marked trained. */
  saveDoneSession(session: WorkoutSession): boolean {
    const value: WorkoutSession = {
      ...session,
      status: 'done',
      deviceId: null,
      rev: (findSession(session.id)?.rev ?? session.rev) + 1,
    };
    if (!wouldStore(value)) return false;
    return commit({ kind: 'session.put', value }, trainedMeta(value));
  },
  /** Deletes a session (a tombstone keeps it deleted); the day's ✓ stays. */
  deleteSession(id: string): boolean {
    return commit({ kind: 'session.delete', id });
  },
  /** Steps of `date`; null or 0 removes them. */
  setSteps(date: ISODate, steps: number | null): boolean {
    return commit(
      steps === null || steps === 0 ? { kind: 'steps.delete', date } : { kind: 'steps.put', date, steps },
    );
  },
  /**
   * Replaces everything (backup restore): flushes pending changes, uploads the backup,
   * then swaps the local copy. Resolves once the server accepted it; throws `ApiError`
   * (`bad_request` for a file that is not a valid backup, `network`, …) otherwise.
   */
  async importAll(data: AppData): Promise<void> {
    await importAll(data);
  },
};
