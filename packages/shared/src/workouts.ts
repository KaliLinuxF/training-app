/**
 * Workout and steps maths (docs/workouts-steps-rebrand.md §1.7): pure, no clock (`now` is always passed in).
 *
 * Counting rule used everywhere: only DONE sets of NOT skipped exercises count (kcal, volume, sets, records,
 * history, derived types); only `status: 'done'` sessions count in day / period aggregates.
 */
import { weekdayOf } from './dates';
import { normalizeTypeNames, WORKOUT_TYPES } from './defaults';
import {
  DEFAULT_REST_SEC,
  DEFAULT_SET,
  DEFAULT_SET_COUNT,
  KIND_FIELDS,
  kgStep,
  MUSCLE_BUCKET,
  type MuscleBucket,
} from './exercises';
import { findExercise, STEP_COUNTED_EXERCISES } from './exerciseLibrary';
import { f0, fN } from './format';
import { LIMITS } from './schemas';
import type {
  AppData,
  DayEntry,
  Exercise,
  ExerciseKind,
  ISODate,
  SessionExercise,
  SessionSet,
  SetValues,
  StepsEntry,
  WeightEntry,
  Workout,
  WorkoutItem,
  WorkoutSession,
} from './types';

/** Body weight when she never weighed in, kg. */
export const FALLBACK_BODY_KG = 70;
/** Steps kcal = steps × 0.0005 × body kg (≈ 35 kcal per 1 000 steps at 70 kg; SPEC §3.6). */
export const STEP_KCAL_PER_KG = 0.0005;
/** A live session older than this (since its start) is stale (W14), and a finished duration is clamped to it. */
export const MAX_SESSION_SEC = 21_600;
/** Name of a session without a template. */
export const FREE_WORKOUT_NAME = 'Вільне тренування';

const NBSP = ' ';
const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

// ---- ordering ----------------------------------------------------------------------------------

/** What orders sessions: (date, createdAt, id). */
export type SessionKey = Pick<WorkoutSession, 'date' | 'createdAt' | 'id'>;

/** Session order: date, then createdAt, then id (a total order, identical on client and server). */
export function compareSessions(a: SessionKey, b: SessionKey): number {
  if (a.date !== b.date) return a.date < b.date ? -1 : 1;
  if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

// ---- body weight -------------------------------------------------------------------------------

/** The latest weigh-in on or before `date`, else the earliest one after it, else `FALLBACK_BODY_KG`. */
export function bodyWeightOn(weights: readonly WeightEntry[], date: ISODate): number {
  let before: WeightEntry | null = null;
  let after: WeightEntry | null = null;
  for (const w of weights) {
    if (w.date <= date) {
      if (!before || w.date > before.date) before = w;
    } else if (!after || w.date < after.date) {
      after = w;
    }
  }
  return (before ?? after)?.kg ?? FALLBACK_BODY_KG;
}

// ---- sets and active time ----------------------------------------------------------------------

/** The sets that count: done sets of a not skipped exercise. */
export const countedSets = (ex: Pick<SessionExercise, 'skipped' | 'sets'>): SessionSet[] =>
  ex.skipped ? [] : ex.sets.filter((s) => s.done);

/** Seconds of one strength / bodyweight set: 3 s per rep within 15–120 s; 40 s when the reps are unknown. */
export const strengthSetSec = (reps: number | null): number => (reps === null ? 40 : clamp(reps * 3, 15, 120));

/**
 * Active seconds of one exercise over its counted sets (`n` of them; skipped → 0):
 * weight / bodyweight `Σ setSec + (n − 1) × restSec`; time `Σ sec + (n − 1) × restSec`; cardio `Σ min × 60`.
 */
export function exerciseActiveSec(ex: Pick<SessionExercise, 'kind' | 'restSec' | 'skipped' | 'sets'>): number {
  const sets = countedSets(ex);
  const n = sets.length;
  if (n === 0) return 0;
  const rests = (n - 1) * ex.restSec;
  switch (ex.kind) {
    case 'weight':
    case 'bodyweight':
      return sets.reduce((sum, s) => sum + strengthSetSec(s.reps), 0) + rests;
    case 'time':
      return sets.reduce((sum, s) => sum + (s.sec ?? 0), 0) + rests;
    case 'cardio':
      return sets.reduce((sum, s) => sum + (s.min ?? 0) * 60, 0);
  }
}

// ---- kcal --------------------------------------------------------------------------------------

interface KcalBreakdown {
  /** Active seconds of the cardio exercises (typed minutes: never scaled). */
  cardioSec: number;
  cardioKcal: number;
  /** Estimated active seconds of the other exercises. */
  estSec: number;
  estKcal: number;
  /** kcal of the step-counted exercises (all cardio, so unscaled). */
  stepCountedKcal: number;
}

function breakdown(session: Pick<WorkoutSession, 'exercises'>, bodyKg: number): KcalBreakdown {
  const out: KcalBreakdown = { cardioSec: 0, cardioKcal: 0, estSec: 0, estKcal: 0, stepCountedKcal: 0 };
  for (const ex of session.exercises) {
    const sec = exerciseActiveSec(ex);
    if (sec <= 0) continue;
    const kcal = (ex.met * bodyKg * sec) / 3600;
    if (ex.kind === 'cardio') {
      out.cardioSec += sec;
      out.cardioKcal += kcal;
    } else {
      out.estSec += sec;
      out.estKcal += kcal;
    }
    if (STEP_COUNTED_EXERCISES.includes(ex.exerciseId)) out.stepCountedKcal += kcal;
  }
  return out;
}

/** The factor applied to the estimated (non-cardio) kcal: < 1 only for a known, plausible, shorter duration. */
function scaleOf(session: Pick<WorkoutSession, 'durationSec'>, b: KcalBreakdown): number {
  const duration = session.durationSec;
  if (duration === null || b.estSec <= 0) return 1;
  const available = Math.max(0, duration - b.cardioSec);
  if (b.estSec <= available) return 1;
  if (!durationPlausible(duration, b)) return 1;
  return available / b.estSec;
}

const durationPlausible = (duration: number, b: KcalBreakdown): boolean =>
  duration >= Math.max(300, 0.25 * (b.estSec + b.cardioSec));

/**
 * True when the stored duration is shorter than the logged sets need but too short to be believable (she ticked
 * everything after the gym): the kcal ignores it, and the summary says it can be corrected.
 */
export function durationIgnored(session: Pick<WorkoutSession, 'durationSec' | 'exercises'>, bodyKg = FALLBACK_BODY_KG): boolean {
  const b = breakdown(session, bodyKg);
  const duration = session.durationSec;
  if (duration === null || b.estSec <= 0) return false;
  return b.estSec > Math.max(0, duration - b.cardioSec) && !durationPlausible(duration, b);
}

/**
 * Estimated kcal of a session: Σ MET × bodyKg × active hours. Cardio terms (typed minutes) are never scaled; the
 * estimated strength / bodyweight / time terms are scaled to `max(0, durationSec − cardioSec)` when the duration is
 * known, shorter than the estimate and plausible (`≥ max(300, 0.25 × estimated active time)`). `stepCounted` = the
 * part from `STEP_COUNTED_EXERCISES`. Both rounded; 0 without a counted set.
 */
export function sessionKcalParts(
  session: Pick<WorkoutSession, 'durationSec' | 'exercises'>,
  bodyKg: number,
): { total: number; stepCounted: number } {
  const b = breakdown(session, bodyKg);
  const total = b.cardioKcal + b.estKcal * scaleOf(session, b);
  return { total: Math.round(total), stepCounted: Math.round(b.stepCountedKcal) };
}

export const sessionKcal = (session: Pick<WorkoutSession, 'durationSec' | 'exercises'>, bodyKg: number): number =>
  sessionKcalParts(session, bodyKg).total;

/** kcal of a day's steps: `round(steps × 0.0005 × bodyKg)`. */
export const stepsKcal = (steps: number, bodyKg: number): number => Math.round(steps * STEP_KCAL_PER_KG * bodyKg);

/** Done sessions of `date`, in `compareSessions` order. */
export const doneSessionsOn = (data: Pick<AppData, 'sessions'>, date: ISODate): WorkoutSession[] =>
  data.sessions.filter((s) => s.date === date && s.status === 'done').sort(compareSessions);

export interface DayBurned {
  /** Σ kcal of the day's done sessions. */
  sessions: number;
  /** kcal of the day's steps (0 without steps). */
  steps: number;
  /** sessions + steps − the step-counted part of the sessions when the day has steps (no double count). */
  total: number;
}

/** Burned kcal of a day (display only, W8); null when the day has neither a done session nor steps. */
export function dayBurned(data: Pick<AppData, 'sessions' | 'steps' | 'weights'>, date: ISODate): DayBurned | null {
  const sessions = doneSessionsOn(data, date);
  const entry = data.steps.find((s) => s.date === date);
  if (!sessions.length && !entry) return null;
  const kg = bodyWeightOn(data.weights, date);
  let sessionTotal = 0;
  let stepCounted = 0;
  for (const s of sessions) {
    const parts = sessionKcalParts(s, kg);
    sessionTotal += parts.total;
    stepCounted += parts.stepCounted;
  }
  const steps = entry ? stepsKcal(entry.steps, kg) : 0;
  const total = sessionTotal + steps - (entry && entry.steps > 0 ? stepCounted : 0);
  return { sessions: sessionTotal, steps, total };
}

/**
 * Steps over [from, to]: the average of the logged days (rounded; null without any), how many days were logged and
 * how many reached `goal` (0 without a goal).
 */
export function stepsStats(
  steps: readonly StepsEntry[],
  from: ISODate,
  to: ISODate,
  goal: number | null,
): { avg: number | null; days: number; goalDays: number } {
  const inRange = steps.filter((s) => s.date >= from && s.date <= to);
  const days = inRange.length;
  const sum = inRange.reduce((acc, s) => acc + s.steps, 0);
  return {
    avg: days ? Math.round(sum / days) : null,
    days,
    goalDays: goal ? inRange.filter((s) => s.steps >= goal).length : 0,
  };
}

// ---- volume, sets, records ---------------------------------------------------------------------

/** Σ kg × reps over the counted sets of weight exercises (kg, unrounded). */
export function sessionVolume(session: Pick<WorkoutSession, 'exercises'>): number {
  let volume = 0;
  for (const ex of session.exercises) {
    if (ex.kind !== 'weight') continue;
    for (const s of countedSets(ex)) if (s.kg !== null && s.reps !== null) volume += s.kg * s.reps;
  }
  return volume;
}

/** Counted sets of the session. */
export const setsDone = (session: Pick<WorkoutSession, 'exercises'>): number =>
  session.exercises.reduce((n, ex) => n + countedSets(ex).length, 0);

export type SetMetric = 'kg' | 'reps' | 'sec' | 'km' | 'min';
export interface BestSet {
  metric: SetMetric;
  value: number;
}

function maxOf(values: readonly (number | null)[]): number | null {
  let best: number | null = null;
  for (const v of values) if (v !== null && (best === null || v > best)) best = v;
  return best;
}

/**
 * The best done set: weight → max kg among sets with reps ≥ 1; bodyweight → max reps; time → max sec; cardio → max
 * km when any set has km, else max min. Null when nothing qualifies.
 */
export function bestSetValue(sets: readonly SessionSet[], kind: ExerciseKind): BestSet | null {
  const done = sets.filter((s) => s.done);
  const pick = (metric: SetMetric, values: (number | null)[]): BestSet | null => {
    const value = maxOf(values);
    return value === null ? null : { metric, value };
  };
  switch (kind) {
    case 'weight':
      return pick(
        'kg',
        done.filter((s) => s.reps !== null && s.reps >= 1).map((s) => s.kg),
      );
    case 'bodyweight':
      return pick(
        'reps',
        done.map((s) => s.reps),
      );
    case 'time':
      return pick(
        'sec',
        done.map((s) => s.sec),
      );
    case 'cardio':
      return done.some((s) => s.km !== null)
        ? pick(
            'km',
            done.map((s) => s.km),
          )
        : pick(
            'min',
            done.map((s) => s.min),
          );
  }
}

/** All counted sets of `exerciseId` in a session (an exercise added twice is pooled) and its snapshot kind. */
function pooled(session: Pick<WorkoutSession, 'exercises'>, exerciseId: string): { kind: ExerciseKind; sets: SessionSet[] } | null {
  const entries = session.exercises.filter((e) => e.exerciseId === exerciseId);
  const first = entries[0];
  if (!first) return null;
  return { kind: first.kind, sets: entries.flatMap(countedSets) };
}

export interface HistoryPoint extends BestSet {
  date: ISODate;
  sessionId: string;
  /** The pooled counted sets of that session. */
  sets: SessionSet[];
}

/** One point per done session that has a best set of `exerciseId`, oldest first. */
export function exerciseHistory(sessions: readonly WorkoutSession[], exerciseId: string): HistoryPoint[] {
  const out: HistoryPoint[] = [];
  for (const s of [...sessions].filter((x) => x.status === 'done').sort(compareSessions)) {
    const pool = pooled(s, exerciseId);
    if (!pool) continue;
    const best = bestSetValue(pool.sets, pool.kind);
    if (best) out.push({ date: s.date, sessionId: s.id, ...best, sets: pool.sets });
  }
  return out;
}

/** The one metric a chart / record list of these points uses: km when any point has km, else the first's. */
export function historyMetric(points: readonly HistoryPoint[]): SetMetric | null {
  if (points.some((p) => p.metric === 'km')) return 'km';
  return points[0]?.metric ?? null;
}

export interface SessionRecord {
  exerciseId: string;
  name: string;
  kind: ExerciseKind;
  metric: SetMetric;
  value: number;
  previous: number;
}

/**
 * Personal records of `session`: per exerciseId, its best strictly beats the best of every EARLIER done session in the
 * same metric. No earlier value in that metric → no record (the first time is not a record).
 */
export function sessionRecords(allSessions: readonly WorkoutSession[], session: WorkoutSession): SessionRecord[] {
  const earlier = allSessions.filter(
    (s) => s.status === 'done' && s.id !== session.id && compareSessions(s, session) < 0,
  );
  const records: SessionRecord[] = [];
  const seen = new Set<string>();
  for (const ex of session.exercises) {
    if (seen.has(ex.exerciseId)) continue;
    seen.add(ex.exerciseId);
    const pool = pooled(session, ex.exerciseId);
    const best = pool ? bestSetValue(pool.sets, pool.kind) : null;
    if (!best) continue;
    let previous: number | null = null;
    for (const s of earlier) {
      const p = pooled(s, ex.exerciseId);
      const b = p ? bestSetValue(p.sets, p.kind) : null;
      if (b && b.metric === best.metric && (previous === null || b.value > previous)) previous = b.value;
    }
    if (previous !== null && best.value > previous)
      records.push({ exerciseId: ex.exerciseId, name: ex.name, kind: ex.kind, metric: best.metric, value: best.value, previous });
  }
  return records;
}

// ---- last time, prefill, hint ------------------------------------------------------------------

/**
 * In the latest done session before `before` (compareSessions; `null` = no bound) that has ≥ 1 done set of
 * `exerciseId`: its `occurrence`-th entry with that id (else the first) — the whole SessionExercise (all sets with
 * `done`, plus `skipped`). Null when she never did it.
 */
export function lastPerformance(
  sessions: readonly WorkoutSession[],
  exerciseId: string,
  before: SessionKey | null,
  occurrence = 0,
): SessionExercise | null {
  let found: WorkoutSession | null = null;
  for (const s of sessions) {
    if (s.status !== 'done') continue;
    if (before && (s.id === before.id || compareSessions(s, before) >= 0)) continue;
    if (!s.exercises.some((e) => e.exerciseId === exerciseId && e.sets.some((x) => x.done))) continue;
    if (!found || compareSessions(s, found) > 0) found = s;
  }
  if (!found) return null;
  const entries = found.exercises.filter((e) => e.exerciseId === exerciseId);
  return entries[occurrence] ?? entries[0] ?? null;
}

/** Only the fields of the kind (the others null). */
export function setForKind(kind: ExerciseKind, values: Partial<SetValues>): SetValues {
  const out: SetValues = { reps: null, kg: null, sec: null, min: null, km: null };
  for (const field of KIND_FIELDS[kind]) {
    const v = values[field];
    out[field] = typeof v === 'number' && Number.isFinite(v) ? v : null;
  }
  return out;
}

/**
 * A session entry for `exercise`. Uses only last's DONE sets: set count = the plan's (template) else last's done
 * count else the kind's default; set `i` = last's done set `i` (else its last), else planned `i`, else DEFAULT_SET.
 * `restSec` = planned, else DEFAULT_REST_SEC. Every set `done: false` (live) / `true` (past-day draft).
 */
export function sessionExerciseFrom(
  exercise: Exercise,
  planned: Pick<WorkoutItem, 'sets' | 'restSec'> | null,
  last: SessionExercise | null,
  { key, done = false }: { key: string; done?: boolean },
): SessionExercise {
  const kind = exercise.kind;
  const lastDone = last ? last.sets.filter((s) => s.done) : [];
  const count = planned?.sets.length || lastDone.length || DEFAULT_SET_COUNT[kind];
  const sets: SessionSet[] = [];
  for (let i = 0; i < count; i++) {
    const source: Partial<SetValues> =
      lastDone[i] ?? lastDone.at(-1) ?? planned?.sets[i] ?? planned?.sets.at(-1) ?? DEFAULT_SET[kind];
    sets.push({ ...setForKind(kind, source), done });
  }
  return {
    key,
    exerciseId: exercise.id,
    name: exercise.name,
    kind,
    met: exercise.met,
    equipment: exercise.equipment,
    primary: [...exercise.primary],
    secondary: [...exercise.secondary],
    restSec: planned ? planned.restSec : DEFAULT_REST_SEC[kind],
    skipped: false,
    sets,
  };
}

export interface NewSessionInput {
  data: Pick<AppData, 'exercises' | 'sessions'>;
  /** null → «Вільне тренування» without exercises. */
  workout: Workout | null;
  date: ISODate;
  id: string;
  now: number;
  /** A fresh unique key per exercise entry. */
  newKey: () => string;
  /** 'active' = live start (startedAt now, sets not done); 'done' = past-day draft (sets done). */
  status: 'active' | 'done';
}

/** The whole new session from a template (items whose exercise is gone are left out), prefilled from last time. */
export function newSessionFromWorkout({ data, workout, date, id, now, newKey, status }: NewSessionInput): WorkoutSession {
  const before: SessionKey = { date, createdAt: now, id };
  const seen = new Map<string, number>();
  const exercises: SessionExercise[] = [];
  for (const item of workout?.items ?? []) {
    const exercise = findExercise(data.exercises, item.exerciseId);
    if (!exercise) continue;
    const occurrence = seen.get(item.exerciseId) ?? 0;
    seen.set(item.exerciseId, occurrence + 1);
    const last = lastPerformance(data.sessions, item.exerciseId, before, occurrence);
    exercises.push(sessionExerciseFrom(exercise, item, last, { key: newKey(), done: status === 'done' }));
  }
  return {
    id,
    date,
    workoutId: workout?.id ?? null,
    name: workout?.name ?? FREE_WORKOUT_NAME,
    createdAt: now,
    startedAt: status === 'active' ? now : null,
    finishedAt: null,
    durationSec: null,
    status,
    exercises: exercises.slice(0, LIMITS.sessionExercises),
    notes: '',
    rev: 0,
    deviceId: null,
  };
}

/** Σ active seconds of the plan (every planned set as done), for «≈ 45 хв». Gone exercises count 0. */
export function plannedActiveSec(workout: Pick<Workout, 'items'>, own: readonly Exercise[]): number {
  let sec = 0;
  for (const item of workout.items) {
    const exercise = findExercise(own, item.exerciseId);
    if (!exercise) continue;
    sec += exerciseActiveSec({
      kind: exercise.kind,
      restSec: item.restSec,
      skipped: false,
      sets: item.sets.map((s) => ({ ...setForKind(exercise.kind, s), done: true })),
    });
  }
  return sec;
}

export type ProgressionHint =
  | { text: string; kgDelta: number }
  | { text: string; repsDelta: number }
  | { text: string; secDelta: number };

const HINT_PREFIX = 'Минулого разу всі підходи виконано — спробуй';

/**
 * A gentle nudge after a fully done last time (never applied automatically): weight +2,5 кг (+1 кг with dumbbells /
 * kettlebell; every set needs kg), bodyweight +1 повторення, time +10 с; cardio none. Null unless the last
 * performance was not skipped and every one of its sets (≥ 1) was done.
 */
export function progressionHint(last: SessionExercise | null): ProgressionHint | null {
  if (!last || last.skipped || last.sets.length < 1 || !last.sets.every((s) => s.done)) return null;
  switch (last.kind) {
    case 'weight': {
      if (!last.sets.every((s) => s.kg !== null)) return null;
      const kgDelta = kgStep(last.equipment);
      return { text: `${HINT_PREFIX} +${fN(kgDelta)} кг`, kgDelta };
    }
    case 'bodyweight':
      return { text: `${HINT_PREFIX} +1 повторення`, repsDelta: 1 };
    case 'time':
      return { text: `${HINT_PREFIX} +10 с`, secDelta: 10 };
    case 'cardio':
      return null;
  }
}

// ---- types, schedule, liveness -----------------------------------------------------------------

const WALK_IDS: ReadonlySet<string> = new Set(['lib.walk', 'lib.incline-walk']);

/**
 * Workout types derived from what was done (non-skipped exercises with ≥ 1 done set, PRIMARY muscles): cardio →
 * «Кардіо» (walks → «Прогулянка»; cardio never counts toward the buckets); upper + lower → «Все тіло», else «Верх
 * тіла» / «Низ тіла»; core → «Прес». In the built-in chip order.
 */
export function sessionWorkoutTypes(session: Pick<WorkoutSession, 'exercises'>): string[] {
  const found = new Set<string>();
  const buckets = new Set<MuscleBucket>();
  for (const ex of session.exercises) {
    if (!countedSets(ex).length) continue;
    if (ex.kind === 'cardio') {
      found.add(WALK_IDS.has(ex.exerciseId) ? 'Прогулянка' : 'Кардіо');
      continue;
    }
    for (const m of ex.primary) {
      const bucket = MUSCLE_BUCKET[m];
      if (bucket) buckets.add(bucket);
    }
  }
  if (buckets.has('upper') && buckets.has('lower')) found.add('Все тіло');
  else if (buckets.has('upper')) found.add('Верх тіла');
  else if (buckets.has('lower')) found.add('Низ тіла');
  if (buckets.has('core')) found.add('Прес');
  return WORKOUT_TYPES.filter((t) => found.has(t));
}

/** The day's types plus the derived ones (never removes a type she chose), at most LIMITS.types. */
export const mergeTypes = (day: DayEntry | undefined, derived: readonly string[]): string[] =>
  normalizeTypeNames([...(day?.trained === true ? day.types : []), ...derived]).slice(0, LIMITS.types);

/** Workouts scheduled on the weekday of `date`, in array order. */
export const workoutsOn = (workouts: readonly Workout[], date: ISODate): Workout[] => {
  const weekday = weekdayOf(date);
  return workouts.filter((w) => w.days.includes(weekday));
};

/**
 * Live = active, started, and at most MAX_SESSION_SEC since its start, whatever its date (W14). A start in the future
 * (clock skew) is live; elapsed is shown as `max(0, now − startedAt)`.
 */
export const isLiveSession = (s: WorkoutSession, now: number): boolean =>
  s.status === 'active' && s.startedAt !== null && now - s.startedAt <= MAX_SESSION_SEC * 1000;

/** The latest live session (by start, then session order), whatever its date; null when none. */
export function activeSession(data: Pick<AppData, 'sessions'>, now: number): WorkoutSession | null {
  let best: WorkoutSession | null = null;
  for (const s of data.sessions) {
    if (!isLiveSession(s, now)) continue;
    if (
      !best ||
      (s.startedAt ?? 0) > (best.startedAt ?? 0) ||
      ((s.startedAt ?? 0) === (best.startedAt ?? 0) && compareSessions(s, best) > 0)
    )
      best = s;
  }
  return best;
}

/** Active sessions that are no longer live (never finished), in session order. */
export const staleActiveSessions = (data: Pick<AppData, 'sessions'>, now: number): WorkoutSession[] =>
  data.sessions.filter((s) => s.status === 'active' && !isLiveSession(s, now)).sort(compareSessions);

// ---- formatting --------------------------------------------------------------------------------

/** «48 хв», «1 год 05 хв»; null → «—». */
export function formatDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return '—';
  const minutes = Math.round(Math.max(0, sec) / 60);
  if (minutes < 60) return `${minutes}${NBSP}хв`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h}${NBSP}год ${String(m).padStart(2, '0')}${NBSP}хв`;
}

/** Kilometres with up to two decimals: 3.2 → «3,2», 3.25 → «3,25». */
export function fKm(km: number): string {
  const r = Math.round(km * 100) / 100;
  return Number.isInteger(r) ? String(r) : String(r).replace('.', ',');
}

const num = (v: number | null): string => (v === null ? '—' : fN(v));

/** One set: «12 × 40 кг», «15 повт.», «45 с», «25 хв · 3,2 км». */
export function formatSet(kind: ExerciseKind, set: SetValues): string {
  switch (kind) {
    case 'weight':
      return set.kg === null ? `${num(set.reps)}${NBSP}повт.` : `${num(set.reps)} × ${fN(set.kg)}${NBSP}кг`;
    case 'bodyweight':
      return `${num(set.reps)}${NBSP}повт.`;
    case 'time':
      return `${num(set.sec)}${NBSP}с`;
    case 'cardio':
      return `${num(set.min)}${NBSP}хв` + (set.km !== null && set.km > 0 ? ` · ${fKm(set.km)}${NBSP}км` : '');
  }
}

const allSame = (values: readonly (number | null)[]): boolean => values.every((v) => v === values[0]);

/**
 * Sets of one exercise in one line: the done ones of a session exercise, every set of a plan (no `done`).
 * «3 × 12 · 40 кг» (three or more equal sets), «12 · 12 · 10 × 42,5 кг» (one weight), «12 × 40 · 10 × 42,5 кг»,
 * «3 × 15 повт.», «3 × 45 с», «25 хв · 3,2 км» (cardio summed). '' without sets.
 */
export function formatSetsSummary(ex: {
  kind: ExerciseKind;
  sets: readonly (SetValues & { done?: boolean })[];
}): string {
  const sets = ex.sets.filter((s) => s.done !== false);
  const n = sets.length;
  if (n === 0) return '';
  const reps = sets.map((s) => s.reps);
  switch (ex.kind) {
    case 'weight': {
      const kg = sets.map((s) => s.kg);
      if (kg.every((v) => v === null)) return formatSetsSummary({ kind: 'bodyweight', sets });
      if (n === 1) return formatSet('weight', sets[0] as SetValues);
      if (allSame(kg)) {
        if (n >= 3 && allSame(reps)) return `${n} × ${num(reps[0] ?? null)} · ${fN(kg[0] ?? null)}${NBSP}кг`;
        return `${reps.map(num).join(' · ')} × ${fN(kg[0] ?? null)}${NBSP}кг`;
      }
      return `${sets.map((s) => `${num(s.reps)} × ${num(s.kg)}`).join(' · ')}${NBSP}кг`;
    }
    case 'bodyweight':
      if (n >= 3 && allSame(reps)) return `${n} × ${num(reps[0] ?? null)}${NBSP}повт.`;
      return `${reps.map(num).join(' · ')}${NBSP}повт.`;
    case 'time': {
      const sec = sets.map((s) => s.sec);
      if (n >= 3 && allSame(sec)) return `${n} × ${num(sec[0] ?? null)}${NBSP}с`;
      return `${sec.map(num).join(' · ')}${NBSP}с`;
    }
    case 'cardio': {
      const min = sets.reduce((sum, s) => sum + (s.min ?? 0), 0);
      const km = sets.reduce((sum, s) => sum + (s.km ?? 0), 0);
      return `${fN(min)}${NBSP}хв` + (km > 0 ? ` · ${fKm(km)}${NBSP}км` : '');
    }
  }
}

/** «310 ккал» with digit grouping. */
export const formatKcal = (kcal: number): string => `${f0(kcal)}${NBSP}ккал`;
