/**
 * The «Тренування» short sheet beyond the ✓ / ✕ (docs/workouts-steps-rebrand.md §3.8): her workouts to start (today)
 * or to log (a past day) — the ones scheduled on that weekday first —, «Вільне тренування», the day's recorded
 * sessions, and the live session that replaces the start group. Pure: data, the dates and the clock come in.
 */
import {
  activeSession,
  bodyWeightOn,
  doneSessionsOn,
  FREE_WORKOUT_NAME,
  formatDuration,
  formatKcal,
  plannedActiveSec,
  sessionKcal,
  workoutsOn,
  type AppData,
  type ISODate,
  type WorkoutSession,
} from '@legko/shared';

/** One way to start (today) or log (a past day) a workout. */
export interface WorkoutStartRow {
  key: string;
  /** null = «Вільне тренування». */
  workoutId: string | null;
  title: string;
  /** «4 вправи · ≈ 45 хв», «Додаси вправи по ходу». */
  sub: string;
  /** Scheduled on this weekday: a «За планом» pill. */
  scheduled: boolean;
  /** Accessible name: «Почати «Ноги + прес», за планом, 4 вправи, близько 45 хв». */
  label: string;
}

/** A done session of the date: «Ноги + прес · 48 хв · 310 ккал» → its summary. */
export interface WorkoutRecordedRow {
  sessionId: string;
  title: string;
  sub: string;
  label: string;
}

export interface WorkoutLiveRow {
  sessionId: string;
  /** «Тренування триває». */
  title: string;
  /** «Ноги + прес · 12 хв». */
  sub: string;
  label: string;
}

export interface WorkoutSheetModel {
  /** «Почати тренування» (today) / «Записати тренування» (a past day). */
  startHeading: string;
  /** Null when she does not use workouts yet (no workout, no session): the sheet stays as it always was. */
  start: WorkoutStartRow[] | null;
  /** A live session (any date, W14) shown for today or for its own date: replaces the start group. */
  live: WorkoutLiveRow | null;
  /** «Записано»: the done sessions of the date, oldest first. */
  recorded: WorkoutRecordedRow[];
  /** The date has a done session: no ✓ / ✕ (W5), the types and notes under «Типи і нотатки». */
  hasDone: boolean;
  /** The ghost link under the sheet: «Мої тренування →» or, without any workout, «Скласти своє тренування →». */
  link: { text: string; to: 'list' | 'new' };
}

export const START_TODAY_HEADING = 'Почати тренування';
export const LOG_PAST_HEADING = 'Записати тренування';
export const RECORDED_HEADING = 'Записано';
export const JUST_MARK_LABEL = 'Або просто відміть';
export const TYPES_NOTES_LABEL = 'Типи і нотатки';
export const SCHEDULED_PILL = 'За планом';
export const FREE_SUB = 'Додаси вправи по ходу';
export const LIVE_TITLE = 'Тренування триває';
export const LIVE_CTA = 'Продовжити';

/** «1 вправа», «2 вправи», «5 вправ». */
export function exercisesText(n: number): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  const word =
    mod10 === 1 && mod100 !== 11
      ? 'вправа'
      : mod10 >= 2 && mod10 <= 4 && !(mod100 >= 12 && mod100 <= 14)
        ? 'вправи'
        : 'вправ';
  return `${n} ${word}`;
}

/** Σ planned active time rounded to 5 min: «≈ 45 хв»; null when 0. */
export function plannedMinutesText(sec: number): string | null {
  const minutes = Math.round(sec / 300) * 5;
  return minutes > 0 ? `≈ ${formatDuration(minutes * 60)}` : null;
}

/** «48 хв», «310 ккал» of a done session (the duration only when known). */
export function sessionFacts(data: Pick<AppData, 'weights'>, s: WorkoutSession): string[] {
  const parts: string[] = [];
  if (s.durationSec !== null) parts.push(formatDuration(s.durationSec));
  parts.push(formatKcal(sessionKcal(s, bodyWeightOn(data.weights, s.date))));
  return parts;
}

/** «Ноги + прес · 48 хв · 310 ккал». */
export const sessionLine = (data: Pick<AppData, 'weights'>, s: WorkoutSession): string =>
  [s.name, ...sessionFacts(data, s)].join(' · ');

const spoken = (text: string): string => text.replace(/\u00a0/g, ' ').replace('≈', 'близько');

export function buildWorkoutSheet(data: AppData, date: ISODate, today: ISODate, now: number): WorkoutSheetModel {
  const workouts = data.workouts ?? [];
  const sessions = data.sessions ?? [];
  const isToday = date === today;
  const verb = isToday ? 'Почати' : 'Записати';

  const scheduled = workoutsOn(workouts, date);
  const ordered = [...scheduled, ...workouts.filter((w) => !scheduled.includes(w))];
  const usesWorkouts = workouts.length > 0 || sessions.length > 0;

  const start: WorkoutStartRow[] | null = usesWorkouts
    ? [
        ...ordered.map((w): WorkoutStartRow => {
          const plan = plannedMinutesText(plannedActiveSec(w, data.exercises ?? []));
          const sub = [exercisesText(w.items.length), plan].filter(Boolean).join(' · ');
          const isScheduled = scheduled.includes(w);
          return {
            key: w.id,
            workoutId: w.id,
            title: w.name,
            sub,
            scheduled: isScheduled,
            label: spoken(`${verb} «${w.name}»${isScheduled ? ', за планом' : ''}, ${sub.replace(' · ', ', ')}`),
          };
        }),
        {
          key: 'free',
          workoutId: null,
          title: FREE_WORKOUT_NAME,
          sub: FREE_SUB,
          scheduled: false,
          label: `${verb} вільне тренування. ${FREE_SUB}`,
        },
      ]
    : null;

  const liveSession = activeSession(data, now);
  const live: WorkoutLiveRow | null =
    liveSession && (isToday || liveSession.date === date)
      ? {
          sessionId: liveSession.id,
          title: LIVE_TITLE,
          sub: `${liveSession.name} · ${formatDuration(Math.max(0, now - (liveSession.startedAt ?? now)) / 1000)}`,
          label: spoken(
            `Продовжити тренування «${liveSession.name}», триває ${formatDuration(
              Math.max(0, now - (liveSession.startedAt ?? now)) / 1000,
            )}`,
          ),
        }
      : null;

  const done = doneSessionsOn(data, date);
  const recorded = done.map((s): WorkoutRecordedRow => {
    const facts = sessionFacts(data, s);
    return {
      sessionId: s.id,
      title: s.name,
      sub: facts.join(' · '),
      label: spoken(`${[s.name, ...facts].join(', ')}. Підсумок`),
    };
  });

  return {
    startHeading: isToday ? START_TODAY_HEADING : LOG_PAST_HEADING,
    start,
    live,
    recorded,
    hasDone: done.length > 0,
    link: workouts.length > 0 ? { text: 'Мої тренування →', to: 'list' } : { text: 'Скласти своє тренування →', to: 'new' },
  };
}
