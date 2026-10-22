/**
 * «Мої тренування» (§3.5) and «Історія тренувань» (§3.12), pure.
 */
import {
  MONTHS_NOM,
  activeSession,
  bodyWeightOn,
  compareSessions,
  dLong,
  formatDuration,
  formatKcal,
  parse,
  sessionKcal,
  setsDone,
  staleActiveSessions,
  weekdayOf,
  type AppData,
  type ISODate,
  type WorkoutSession,
} from '@legko/shared';
import { exercisesText, setsText, spoken, weekdaysText } from './copy';

export interface WorkoutListRow {
  id: string;
  name: string;
  /** «Пн, Ср · 4 вправи». */
  sub: string;
  /** Scheduled on today's weekday: the «Сьогодні» pill. */
  today: boolean;
  /** The live session is this workout: «Продовжити» instead of «Почати». */
  live: boolean;
}

export interface LiveBanner {
  sessionId: string;
  title: string;
}

export interface StaleRow {
  sessionId: string;
  title: string;
}

export interface WorkoutsList {
  rows: WorkoutListRow[];
  live: LiveBanner | null;
  /** The live session's id (any workout), for the start question. */
  liveSessionId: string | null;
  stale: StaleRow[];
  /** Done sessions, for «Історія тренувань · 12 записів». */
  doneCount: number;
}

/** Elapsed of a live session: «12 хв» (never negative). */
export const liveElapsed = (s: WorkoutSession, now: number): string =>
  formatDuration(Math.max(0, now - (s.startedAt ?? now)) / 1000);

export function workoutsList(
  data: Pick<AppData, 'workouts' | 'sessions'>,
  today: ISODate,
  now: number,
): WorkoutsList {
  const live = activeSession(data, now);
  const weekday = weekdayOf(today);
  return {
    rows: data.workouts.map((w) => ({
      id: w.id,
      name: w.name,
      sub: [weekdaysText(w.days), exercisesText(w.items.length)].filter(Boolean).join(' · '),
      today: w.days.includes(weekday),
      live: live !== null && live.workoutId === w.id,
    })),
    live: live
      ? { sessionId: live.id, title: `Тренування триває · ${live.name} · ${liveElapsed(live, now)}` }
      : null,
    liveSessionId: live?.id ?? null,
    stale: staleActiveSessions(data, now).map((s) => ({
      sessionId: s.id,
      title: `${dLong(s.date)} · ${s.name}`,
    })),
    doneCount: data.sessions.filter((s) => s.status === 'done').length,
  };
}

export interface HistoryRow {
  sessionId: string;
  title: string;
  sub: string;
  /** Accessible name (no-break spaces as spaces, «≈» spoken). */
  label: string;
}

export interface HistoryGroup {
  /** «Жовтень 2026». */
  month: string;
  rows: HistoryRow[];
}

/** «48 хв · 13 підходів · ≈ 310 ккал» (no duration when it is unknown). */
export function sessionFacts(data: Pick<AppData, 'weights'>, s: WorkoutSession): string {
  const kcal = sessionKcal(s, bodyWeightOn(data.weights, s.date));
  return [
    s.durationSec === null ? null : formatDuration(s.durationSec),
    setsText(setsDone(s)),
    `≈ ${formatKcal(kcal)}`,
  ]
    .filter(Boolean)
    .join(' · ');
}

/** Done sessions, newest first, grouped by month. */
export function historyGroups(data: Pick<AppData, 'sessions' | 'weights'>): HistoryGroup[] {
  const done = data.sessions.filter((s) => s.status === 'done').sort((a, b) => compareSessions(b, a));
  const groups: HistoryGroup[] = [];
  for (const s of done) {
    const d = parse(s.date);
    const month = `${MONTHS_NOM[d.getMonth()]} ${d.getFullYear()}`;
    let group = groups.at(-1);
    if (!group || group.month !== month) {
      group = { month, rows: [] };
      groups.push(group);
    }
    const title = `${dLong(s.date)} · ${s.name}`;
    const sub = sessionFacts(data, s);
    group.rows.push({
      sessionId: s.id,
      title,
      sub,
      label: spoken(`${title}. ${sub}`).replace('≈', 'близько'),
    });
  }
  return groups;
}
