/**
 * Every change of a session on screen (docs/workouts-steps-rebrand.md §3.9, §3.12), pure: the live screen and the
 * edit / past-day screen build the next `WorkoutSession` here and hand it to `dataActions.saveSession` /
 * `saveDoneSession`. Counting follows the shared rule: only done sets of exercises that are not skipped count.
 */
import {
  LIMITS,
  bodyWeightOn,
  countedSets,
  durationIgnored,
  fKm,
  fN,
  formatSet,
  formatSetsSummary,
  lastPerformance,
  progressionHint,
  sessionExerciseFrom,
  sessionKcal,
  sessionRecords,
  sessionVolume,
  setsDone,
  type AppData,
  type Exercise,
  type ProgressionHint,
  type SessionExercise,
  type SessionRecord,
  type SessionSet,
  type WorkoutSession,
} from '@legko/shared';
import { formatMetric } from '@/features/exercises';
import { setsText } from './copy';
import { fitField, type SetField } from './setFields';

/** Where the next set to confirm is: the first exercise that is not skipped with an undone set, and that set. */
export interface SetPosition {
  key: string;
  index: number;
}

export function currentPosition(session: Pick<WorkoutSession, 'exercises'>): SetPosition | null {
  for (const ex of session.exercises) {
    if (ex.skipped) continue;
    const index = ex.sets.findIndex((s) => !s.done);
    if (index >= 0) return { key: ex.key, index };
  }
  return null;
}

export type CardState = 'done' | 'current' | 'upcoming' | 'skipped';

/** How a card is drawn: skipped; current (holds the current set); done (every set done); upcoming. */
export function cardState(ex: SessionExercise, current: SetPosition | null): CardState {
  if (ex.skipped) return 'skipped';
  if (current?.key === ex.key) return 'current';
  if (ex.sets.length > 0 && ex.sets.every((s) => s.done)) return 'done';
  return 'upcoming';
}

const mapExercise = (
  session: WorkoutSession,
  key: string,
  update: (ex: SessionExercise) => SessionExercise,
): WorkoutSession => ({
  ...session,
  exercises: session.exercises.map((e) => (e.key === key ? update(e) : e)),
});

const mapSet = (
  session: WorkoutSession,
  key: string,
  index: number,
  update: (set: SessionSet) => SessionSet,
): WorkoutSession =>
  mapExercise(session, key, (ex) => ({ ...ex, sets: ex.sets.map((s, i) => (i === index ? update(s) : s)) }));

export const findEntry = (
  session: Pick<WorkoutSession, 'exercises'>,
  key: string,
): SessionExercise | undefined => session.exercises.find((e) => e.key === key);

/** ✓ on a set: done. */
export const confirmSet = (session: WorkoutSession, key: string, index: number): WorkoutSession =>
  mapSet(session, key, index, (s) => ({ ...s, done: true }));

/** ✓ toggled (a done set tapped again is undone). */
export const toggleSet = (session: WorkoutSession, key: string, index: number): WorkoutSession =>
  mapSet(session, key, index, (s) => ({ ...s, done: !s.done }));

/** One value of one set (rounded and clamped like the schema). */
export const updateSet = (
  session: WorkoutSession,
  key: string,
  index: number,
  field: SetField,
  value: number | null,
): WorkoutSession =>
  mapSet(session, key, index, (s) => ({ ...s, [field]: value === null ? null : fitField(field, value) }));

/** «+ Підхід»: a copy of the last set's values, not done (at most 30). */
export const addSet = (session: WorkoutSession, key: string, done = false): WorkoutSession =>
  mapExercise(session, key, (ex) => {
    const last = ex.sets.at(-1);
    if (ex.sets.length >= LIMITS.sessionSets) return ex;
    const values = last ?? { reps: null, kg: null, sec: null, min: null, km: null, done };
    return { ...ex, sets: [...ex.sets, { ...values, done }] };
  });

/** «Видалити підхід»: at least one set stays (remove the exercise instead). */
export const removeSet = (session: WorkoutSession, key: string, index: number): WorkoutSession =>
  mapExercise(session, key, (ex) =>
    ex.sets.length <= 1 ? ex : { ...ex, sets: ex.sets.filter((_, i) => i !== index) },
  );

/** «Пропустити вправу» / «Повернути». */
export const setSkipped = (session: WorkoutSession, key: string, skipped: boolean): WorkoutSession =>
  mapExercise(session, key, (ex) => ({ ...ex, skipped }));

/** «Прибрати з тренування»: from this session only. */
export const removeExercise = (session: WorkoutSession, key: string): WorkoutSession => ({
  ...session,
  exercises: session.exercises.filter((e) => e.key !== key),
});

/** «Вгору» (−1) / «Вниз» (+1) within the session. */
export function moveExercise(session: WorkoutSession, key: string, delta: -1 | 1): WorkoutSession {
  const from = session.exercises.findIndex((e) => e.key === key);
  const to = from + delta;
  if (from < 0 || to < 0 || to >= session.exercises.length) return session;
  const exercises = [...session.exercises];
  const [moved] = exercises.splice(from, 1);
  if (!moved) return session;
  exercises.splice(to, 0, moved);
  return { ...session, exercises };
}

/**
 * «+ Додати вправу»: the exercise prefilled from the last time she did it (before this session), sets not done
 * (live) or done (edit / past day). At most 30 exercises.
 */
export function addExercise(
  session: WorkoutSession,
  data: Pick<AppData, 'sessions'>,
  exercise: Exercise,
  key: string,
  done: boolean,
): WorkoutSession {
  if (session.exercises.length >= LIMITS.sessionExercises) return session;
  const last = lastPerformance(data.sessions, exercise.id, session);
  return {
    ...session,
    exercises: [...session.exercises, sessionExerciseFrom(exercise, null, last, { key, done })],
  };
}

/** Last time she did this exercise before this session (whole entry), and the gentle hint from it. */
export function lastTime(
  data: Pick<AppData, 'sessions'>,
  session: WorkoutSession,
  ex: SessionExercise,
): { last: SessionExercise | null; summary: string | null; hint: ProgressionHint | null } {
  const occurrence = session.exercises
    .filter((e) => e.exerciseId === ex.exerciseId)
    .findIndex((e) => e.key === ex.key);
  const last = lastPerformance(data.sessions, ex.exerciseId, session, Math.max(0, occurrence));
  const summary = last ? formatSetsSummary(last) || null : null;
  return { last, summary, hint: progressionHint(last) };
}

/** «+2,5 кг», «+1 повторення», «+10 с». */
export function hintDeltaText(hint: ProgressionHint): string {
  if ('kgDelta' in hint) return `+${fN(hint.kgDelta)} кг`;
  if ('repsDelta' in hint) return `+${hint.repsDelta} повторення`;
  return `+${hint.secDelta} с`;
}

/**
 * Applies the hint to every NOT done set of the entry (`sign` −1 undoes it, «Скасувати»). Sets she already did keep
 * their values; empty weights stay empty.
 */
export function applyHint(
  session: WorkoutSession,
  key: string,
  hint: ProgressionHint,
  sign: 1 | -1,
): WorkoutSession {
  return mapExercise(session, key, (ex) => ({
    ...ex,
    sets: ex.sets.map((s) => {
      if (s.done) return s;
      if ('kgDelta' in hint)
        return s.kg === null ? s : { ...s, kg: fitField('kg', s.kg + sign * hint.kgDelta) };
      if ('repsDelta' in hint)
        return s.reps === null ? s : { ...s, reps: fitField('reps', s.reps + sign * hint.repsDelta) };
      return s.sec === null ? s : { ...s, sec: fitField('sec', s.sec + sign * hint.secDelta) };
    }),
  }));
}

export interface SessionProgress {
  exercisesDone: number;
  exercisesTotal: number;
  setsDone: number;
  setsTotal: number;
}

/** «2 з 4 вправ · 7 з 13 підходів» counts (skipped exercises left out). */
export function progressOf(session: Pick<WorkoutSession, 'exercises'>): SessionProgress {
  const active = session.exercises.filter((e) => !e.skipped);
  return {
    exercisesDone: active.filter((e) => e.sets.length > 0 && e.sets.every((s) => s.done)).length,
    exercisesTotal: active.length,
    setsDone: active.reduce((n, e) => n + e.sets.filter((s) => s.done).length, 0),
    setsTotal: active.reduce((n, e) => n + e.sets.length, 0),
  };
}

export const progressText = (p: SessionProgress): string =>
  `${p.exercisesDone} з ${p.exercisesTotal} вправ · ${p.setsDone} з ${p.setsTotal} підходів`;

/** Undone sets of the exercises that are not skipped. */
export const undoneCount = (session: Pick<WorkoutSession, 'exercises'>): number =>
  session.exercises.reduce((n, e) => (e.skipped ? n : n + e.sets.filter((s) => !s.done).length), 0);

export type FinishPlan = { kind: 'empty' } | { kind: 'undone'; count: number } | { kind: 'ok' };

/** What «Завершити тренування» asks: nothing done → offer to delete; undone sets → «вони не зарахуються». */
export function finishPlan(session: Pick<WorkoutSession, 'exercises'>): FinishPlan {
  if (setsDone(session) === 0) return { kind: 'empty' };
  const count = undoneCount(session);
  return count > 0 ? { kind: 'undone', count } : { kind: 'ok' };
}

/** «Ще 3 підходи не відмічено — вони не зарахуються.» */
export const undoneBody = (count: number): string =>
  `Ще ${setsText(count)} не відмічено — вони не зарахуються.`;

/**
 * Rest after confirming set `index` of `key` in `before` (the session before the confirm): the exercise's rest when it
 * is > 0 and some set is still undone after it; else 0 (no rest bar after the last set of the session).
 */
export function restAfter(before: WorkoutSession, key: string, index: number): number {
  const ex = findEntry(before, key);
  if (!ex || ex.restSec <= 0) return 0;
  const after = confirmSet(before, key, index);
  return currentPosition(after) ? ex.restSec : 0;
}

/** «✓ Підхід 2 · 10 × 35 кг». */
export function confirmLabel(ex: SessionExercise, index: number): string {
  const set = ex.sets[index];
  return set ? `✓ Підхід ${index + 1} · ${formatSet(ex.kind, set)}` : '';
}

/** The muted line of a collapsed card: done sets for a done card, every set for an upcoming one. */
export function cardSummary(ex: SessionExercise, state: CardState): string {
  if (state === 'skipped') return 'Пропущено';
  if (state === 'done') return formatSetsSummary(ex);
  return formatSetsSummary({ kind: ex.kind, sets: ex.sets.map(({ done: _done, ...values }) => values) });
}

// ---- summary (§3.11) -------------------------------------------------------------------------------

/** «42,5 кг (було 40)», «6 км (було 5)». */
export function recordText(r: Pick<SessionRecord, 'metric' | 'value' | 'previous'>): string {
  const before = r.metric === 'km' ? fKm(r.previous) : fN(r.previous);
  return `${formatMetric(r.metric, r.value)} (було ${before})`;
}

export interface SummaryRow {
  key: string;
  exerciseId: string;
  name: string;
  value: string;
}

export interface SessionSummary {
  durationSec: number | null;
  volumeKg: number;
  setsDone: number;
  kcal: number;
  /** The stored duration is too short for what was logged: the kcal ignores it (muted note). */
  durationIgnored: boolean;
  records: (SessionRecord & { text: string })[];
  exercises: SummaryRow[];
}

export function summaryOf(
  data: Pick<AppData, 'sessions' | 'weights'>,
  session: WorkoutSession,
): SessionSummary {
  const kg = bodyWeightOn(data.weights, session.date);
  return {
    durationSec: session.durationSec,
    volumeKg: sessionVolume(session),
    setsDone: setsDone(session),
    kcal: sessionKcal(session, kg),
    durationIgnored: durationIgnored(session, kg),
    records: sessionRecords(data.sessions, session).map((r) => ({ ...r, text: recordText(r) })),
    exercises: session.exercises.map((ex) => ({
      key: ex.key,
      exerciseId: ex.exerciseId,
      name: ex.name,
      value: ex.skipped ? 'Пропущено' : countedSets(ex).length ? formatSetsSummary(ex) : 'Не виконано',
    })),
  };
}

// ---- edit mode duration (§3.12) --------------------------------------------------------------------

/** Stored seconds → the «Тривалість, хв» text ('' = unknown). */
export const minutesText = (sec: number | null): string => (sec === null ? '' : String(Math.round(sec / 60)));

/** Typed minutes → seconds (0–1440 min); '' → null; not a number → undefined. */
export function minutesToSec(text: string): number | null | undefined {
  if (text.trim() === '') return null;
  const n = Number(text.replace(',', '.'));
  if (!Number.isFinite(n)) return undefined;
  return Math.min(LIMITS.sessionSec.max, Math.max(0, Math.round(n) * 60));
}
