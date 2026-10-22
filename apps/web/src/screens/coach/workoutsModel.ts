/**
 * «Тренування» of a client page (docs/workouts-steps-rebrand.md §3.18), pure: the schedule line, the strip of the
 * period (sessions, kcal, volume, steps — the same numbers as the table and «Огляд», from `coachSummary`), and the
 * done sessions newest first with one static row per exercise. The day view (`dayViewModel`) reuses the session
 * groups. Everything here is read-only text: no links, no actions.
 */
import {
  addDays,
  compareSessions,
  digestSession,
  dLong,
  f0,
  formatDuration,
  formatKcal,
  formatSetsSummary,
  mondayOf,
  sessionRecords,
  type AppData,
  type CoachPeriod,
  type CoachSummary,
  type ISODate,
  type WorkoutSession,
} from '@legko/shared';
import type { StatItem } from '@/ui';
import { COACH_COPY, KPI, scheduleLine, stepsGoalSuffix } from './copy';

const NBSP = String.fromCharCode(0xa0);
const DASH = '—';

/** One exercise of a done session. */
export interface CoachExerciseRow {
  key: string;
  /** Her snapshot name («Присідання зі штангою»). */
  title: string;
  /** «12 × 40 · 12 × 40 · 10 × 42,5 кг», «Пропущено», or «Підходи не виконано». */
  sub: string;
  skipped: boolean;
  /** Her personal record in this session (`sessionRecords`, metric-aware; the first entry of the exercise only). */
  record: boolean;
}

export interface CoachSessionModel {
  id: string;
  date: ISODate;
  /** «12 жовтня · Ноги + прес» (the tab), or «Ноги + прес» (the day view: the date is the day's own title). */
  title: string;
  /** «48 хв · ≈ 310 ккал»; «≈ 310 ккал» without a duration; null with neither. */
  value: string | null;
  rows: CoachExerciseRow[];
}

export interface CoachWorkoutsModel {
  /** «Розклад: Пн, Ср — Ноги + прес · Пт — Верх тіла» / «Розкладу немає». */
  schedule: string;
  /** Тренування · Спалено · Обʼєм · Кроки, сер. */
  strip: StatItem[];
  /** Done sessions of the range, newest first. */
  sessions: CoachSessionModel[];
}

/**
 * The range of the workouts numbers, as `coachSummary` counts them: Monday … today for 7, the last 30 days (today
 * included) for 30.
 */
export function sessionsRange(today: ISODate, period: CoachPeriod): { from: ISODate; to: ISODate } {
  return { from: period === 7 ? mondayOf(today) : addDays(today, -29), to: today };
}

const doneSessions = (data: Pick<AppData, 'sessions'>): WorkoutSession[] =>
  data.sessions.filter((s) => s.status === 'done');

/** «48 хв · ≈ 310 ккал» (each part only when known). */
function sessionValue(durationSec: number | null, kcal: number): string | null {
  const parts: string[] = [];
  if (durationSec !== null) parts.push(formatDuration(durationSec));
  if (kcal > 0) parts.push(`≈${NBSP}${formatKcal(kcal)}`);
  return parts.length ? parts.join(' · ') : null;
}

/** One done session as a static group: its value line and one row per exercise, records marked. */
export function coachSessionModel(
  data: Pick<AppData, 'sessions' | 'weights'>,
  session: WorkoutSession,
  { withDate }: { withDate: boolean },
): CoachSessionModel {
  const digest = digestSession(session, data.weights);
  const records = new Set(sessionRecords(doneSessions(data), session).map((r) => r.exerciseId));
  const marked = new Set<string>();
  const rows = session.exercises.map((ex): CoachExerciseRow => {
    const summary = ex.skipped ? '' : formatSetsSummary(ex);
    const record = !ex.skipped && summary !== '' && records.has(ex.exerciseId) && !marked.has(ex.exerciseId);
    if (record) marked.add(ex.exerciseId);
    return {
      key: ex.key,
      title: ex.name,
      sub: ex.skipped ? COACH_COPY.skipped : summary || COACH_COPY.noSetsDone,
      skipped: ex.skipped,
      record,
    };
  });
  return {
    id: session.id,
    date: session.date,
    title: withDate ? `${dLong(session.date)} · ${session.name}` : session.name,
    value: sessionValue(digest.durationSec, digest.kcal),
    rows,
  };
}

/** The done sessions of `date` (her order), for the day view. */
export function coachSessionsOn(data: Pick<AppData, 'sessions' | 'weights'>, date: ISODate): CoachSessionModel[] {
  return doneSessions(data)
    .filter((s) => s.date === date)
    .sort(compareSessions)
    .map((s) => coachSessionModel(data, s, { withDate: false }));
}

/**
 * The tab: the schedule of her workouts, the strip of the period and its done sessions newest first. The strip's
 * sessions and kcal are `summary.sessions` and its steps `summary.steps` (the table's numbers); the volume is the
 * sum of the same sessions' digests.
 */
export function buildWorkoutsModel(
  data: Pick<AppData, 'sessions' | 'weights' | 'workouts'>,
  today: ISODate,
  summary: Pick<CoachSummary, 'period' | 'sessions' | 'steps'>,
): CoachWorkoutsModel {
  const { from, to } = sessionsRange(today, summary.period);
  const inRange = doneSessions(data)
    .filter((s) => s.date >= from && s.date <= to)
    .sort((a, b) => compareSessions(b, a));
  const volume = inRange.reduce((sum, s) => sum + digestSession(s, data.weights).volumeKg, 0);
  const { count, kcal } = summary.sessions;
  const { steps } = summary;
  const burned = count > 0 && kcal > 0;
  const strip: StatItem[] = [
    { label: KPI.workouts, value: String(count) },
    { label: 'Спалено', value: burned ? `≈${NBSP}${f0(kcal)}` : DASH, unit: burned ? 'ккал' : undefined },
    { label: 'Обʼєм', value: volume > 0 ? f0(volume) : DASH, unit: volume > 0 ? 'кг' : undefined },
    {
      label: KPI.steps,
      value: f0(steps.avg),
      unit: steps.avg === null || steps.goal === null ? undefined : stepsGoalSuffix(steps.goal).trim(),
    },
  ];
  return {
    schedule: scheduleLine(data.workouts),
    strip,
    sessions: inRange.map((s) => coachSessionModel(data, s, { withDate: true })),
  };
}
