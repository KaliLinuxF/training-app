/**
 * Pure model of the exercise library (docs/workouts-steps-rebrand.md §3.2, §3.3): search and groups, row subs, and
 * everything the exercise detail shows (facts, the one-metric chart, records, last sessions, the hint).
 */
import {
  allExercises,
  dLong,
  EQUIPMENT_LABELS,
  EXERCISE_GROUPS,
  EXERCISE_KIND_LABELS,
  exerciseHistory,
  f1,
  findExercise,
  fKm,
  fN,
  formatSetsSummary,
  historyMetric,
  INTENSITY_LABELS,
  intensityOf,
  isLibraryExerciseId,
  lastPerformance,
  MUSCLE_LABELS,
  progressionHint,
  type AppData,
  type Exercise,
  type ExerciseGroupId,
  type HistoryPoint,
  type ISODate,
  type SetMetric,
} from '@legko/shared';
import { BACK_STATE_KEY } from '@/ui';
import { LIBRARY_PATH, sessionPath, WORKOUTS_PATH } from '@/lib/workoutRoutes';
import { muscleList } from './bodyMapModel';

const NBSP = ' ';

// ---- search and groups -------------------------------------------------------------------------

/** «Усі», the shared groups (by primary muscle), «Кардіо» (kind) and «Мої» (her own). */
export type LibraryGroup = 'all' | ExerciseGroupId;

export interface LibraryFilter {
  query: string;
  group: LibraryGroup;
}

export const EMPTY_FILTER: LibraryFilter = { query: '', group: 'all' };

export const GROUP_OPTIONS: readonly { id: LibraryGroup; label: string }[] = [
  { id: 'all', label: 'Усі' },
  ...EXERCISE_GROUPS.map((g) => ({ id: g.id, label: g.label })),
];

export const isLibraryGroup = (v: unknown): v is LibraryGroup => GROUP_OPTIONS.some((g) => g.id === v);

/** Case-insensitive (uk), one apostrophe, no doubled spaces. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFC')
    .toLocaleLowerCase('uk')
    .replace(/['’ʼ`]/g, 'ʼ')
    .replace(/\s+/g, ' ')
    .trim();
}

const isOwn = (ex: Pick<Exercise, 'id'>): boolean => !isLibraryExerciseId(ex.id);

export function inGroup(ex: Exercise, group: LibraryGroup): boolean {
  if (group === 'all') return true;
  if (group === 'cardio') return ex.kind === 'cardio';
  if (group === 'mine') return isOwn(ex);
  const muscles = EXERCISE_GROUPS.find((g) => g.id === group)?.muscles ?? [];
  return ex.primary.some((m) => muscles.includes(m));
}

/** What a query is matched against: the name and the primary muscles' labels. */
const haystack = (ex: Exercise): string =>
  normalizeText([ex.name, ...ex.primary.map((m) => MUSCLE_LABELS[m])].join(' '));

/**
 * The exercises of a group that match every word of the query (a word matches anywhere in the name or a primary
 * muscle label: «прис» finds every squat), sorted by name (`uk`).
 */
export function filterExercises(all: readonly Exercise[], filter: LibraryFilter): Exercise[] {
  const words = normalizeText(filter.query).split(' ').filter(Boolean);
  return all
    .filter((ex) => inGroup(ex, filter.group))
    .filter((ex) => {
      if (words.length === 0) return true;
      const text = haystack(ex);
      return words.every((w) => text.includes(w));
    })
    .sort((a, b) => a.name.localeCompare(b.name, 'uk'));
}

/** The library and her own exercises, sorted by name. */
export const libraryOf = (own: readonly Exercise[]): Exercise[] =>
  filterExercises(allExercises(own), EMPTY_FILTER);

/** «Штанга · Квадрицепс, сідниці» (cardio without equipment: «Кардіо · …»). */
export function exerciseSub(ex: Pick<Exercise, 'kind' | 'equipment' | 'primary'>): string {
  const equipment =
    ex.equipment === 'other' && ex.kind === 'cardio' ? EXERCISE_KIND_LABELS.cardio : EQUIPMENT_LABELS[ex.equipment];
  const muscles = muscleList(ex.primary);
  return muscles ? `${equipment} · ${muscles}` : equipment;
}

/** The name of an exercise for headings and rows; a deleted one reads «Вправу видалено». */
export const exerciseLabel = (ex: Pick<Exercise, 'name'> | null | undefined): string =>
  ex?.name ?? 'Вправу видалено';

// ---- navigation --------------------------------------------------------------------------------

export interface BackTarget {
  href: string;
  label: string;
}

const fromOf = (state: unknown): string | null => {
  if (typeof state !== 'object' || state === null) return null;
  const from = (state as Record<string, unknown>)[BACK_STATE_KEY];
  return typeof from === 'string' ? from : null;
};

/** Back link of the library: Settings when she came from there, else «Тренування». */
export function libraryBack(state: unknown): BackTarget {
  const from = fromOf(state);
  if (from?.startsWith('/settings')) return { href: from, label: 'Налаштування' };
  return { href: WORKOUTS_PATH, label: 'Тренування' };
}

/** Back link of an exercise page: Progress or a workout page she came from, else «Вправи». */
export function detailBack(state: unknown): BackTarget {
  const from = fromOf(state);
  if (from?.startsWith('/progress')) return { href: from, label: 'Прогрес' };
  if (from && from.startsWith(`${WORKOUTS_PATH}/`) && !from.startsWith(LIBRARY_PATH))
    return { href: from, label: 'Тренування' };
  return { href: LIBRARY_PATH, label: 'Вправи' };
}

// ---- detail ------------------------------------------------------------------------------------

export interface Fact {
  label: string;
  value: string;
}

export interface DetailChart {
  metric: SetMetric;
  /** «Найкращий підхід, кг». */
  title: string;
  /** Oldest first, only points of `metric`. */
  points: { date: ISODate; value: number }[];
}

export interface DetailRecord {
  metric: SetMetric;
  value: number;
  date: ISODate;
  /** «40 кг · 12 жовтня». */
  text: string;
}

export interface RecentSession {
  sessionId: string;
  date: ISODate;
  /** «12 жовтня · Ноги + прес». */
  title: string;
  /** «3 × 12 · 40 кг». */
  summary: string;
  href: string;
}

export interface ExerciseDetail {
  exercise: Exercise;
  own: boolean;
  facts: Fact[];
  /** Null without any history. */
  chart: DetailChart | null;
  record: DetailRecord | null;
  /** Newest first, at most 5. */
  recent: RecentSession[];
  /** The progression hint after a fully done last time. */
  hint: string | null;
  /** Workouts that contain it (the delete confirmation names the count). */
  workoutsUsing: number;
}

export const METRIC_TITLES: Readonly<Record<SetMetric, string>> = {
  kg: 'Найкращий підхід, кг',
  reps: 'Найбільше повторень',
  sec: 'Найдовше, с',
  min: 'Найдовше, хв',
  km: 'Найдовша дистанція, км',
};

/** Ukrainian plural: one (1, 21), few (2–4, 22–24), many (0, 5–20, 25…). */
export function plural(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** «1:30» from seconds. */
export const minSec = (sec: number): string =>
  `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;

/** One best value: «40 кг», «20 повторень», «1:30» (under a minute «45 с»), «30 хв», «5,2 км». */
export function formatMetric(metric: SetMetric, value: number): string {
  switch (metric) {
    case 'kg':
      return `${fN(value)}${NBSP}кг`;
    case 'reps':
      return `${value}${NBSP}${plural(value, 'повторення', 'повторення', 'повторень')}`;
    case 'sec':
      return value >= 60 ? minSec(value) : `${value}${NBSP}с`;
    case 'min':
      return `${fN(value)}${NBSP}хв`;
    case 'km':
      return `${fKm(value)}${NBSP}км`;
  }
}

/** The best point of one metric (the first time it was reached). */
export function bestPoint(points: readonly HistoryPoint[], metric: SetMetric): HistoryPoint | null {
  let best: HistoryPoint | null = null;
  for (const p of points) if (p.metric === metric && (best === null || p.value > best.value)) best = p;
  return best;
}

const factsOf = (ex: Exercise): Fact[] => {
  const facts: Fact[] = [
    { label: 'Тип', value: EXERCISE_KIND_LABELS[ex.kind] },
    { label: 'Обладнання', value: EQUIPMENT_LABELS[ex.equipment] },
    { label: 'Основні', value: muscleList(ex.primary) || '—' },
  ];
  if (ex.secondary.length > 0) facts.push({ label: 'Допоміжні', value: muscleList(ex.secondary) });
  facts.push({ label: 'Інтенсивність', value: `${INTENSITY_LABELS[intensityOf(ex.kind, ex.met)]} · MET ${f1(ex.met)}` });
  return facts;
};

/** Everything the exercise page shows; null for an unknown id (or a deleted own exercise). */
export function detailModel(data: Pick<AppData, 'exercises' | 'sessions' | 'workouts'>, id: string): ExerciseDetail | null {
  const exercise = findExercise(data.exercises, id);
  if (!exercise) return null;
  const history = exerciseHistory(data.sessions, id);
  const metric = historyMetric(history);
  const points = metric ? history.filter((p) => p.metric === metric) : [];
  const chart: DetailChart | null =
    metric && points.length > 0
      ? { metric, title: METRIC_TITLES[metric], points: points.map((p) => ({ date: p.date, value: p.value })) }
      : null;
  const top = metric ? bestPoint(points, metric) : null;
  const record: DetailRecord | null =
    metric && top
      ? { metric, value: top.value, date: top.date, text: `${formatMetric(metric, top.value)} · ${dLong(top.date)}` }
      : null;
  const byId = new Map(data.sessions.map((s) => [s.id, s]));
  const recent = [...history]
    .reverse()
    .slice(0, 5)
    .map((p): RecentSession => {
      const session = byId.get(p.sessionId);
      // The kind it had then (the snapshot), so an own exercise edited later still reads right.
      const kind = session?.exercises.find((e) => e.exerciseId === id)?.kind ?? exercise.kind;
      return {
        sessionId: p.sessionId,
        date: p.date,
        title: session ? `${dLong(p.date)} · ${session.name}` : dLong(p.date),
        summary: formatSetsSummary({ kind, sets: p.sets }),
        href: sessionPath(p.sessionId),
      };
    });
  return {
    exercise,
    own: isOwn(exercise),
    facts: factsOf(exercise),
    chart,
    record,
    recent,
    hint: progressionHint(lastPerformance(data.sessions, id, null))?.text ?? null,
    workoutsUsing: data.workouts.filter((w) => w.items.some((i) => i.exerciseId === id)).length,
  };
}

/** Text alternative of the chart: «Найкращий підхід, кг: з 35 кг до 40 кг». */
export function chartSpeech(chart: DetailChart): string {
  const first = chart.points[0];
  const last = chart.points.at(-1);
  if (!first || !last) return chart.title;
  return `${chart.title}: з ${formatMetric(chart.metric, first.value)} до ${formatMetric(chart.metric, last.value)}`;
}

/** Body of the delete confirmation: «Її буде прибрано з 2 тренувань. Записані тренування залишаться.» */
export function deleteConfirmBody(workoutsUsing: number): string {
  const kept = 'Записані тренування залишаться.';
  if (workoutsUsing <= 0) return kept;
  return `Її буде прибрано з ${workoutsUsing} ${plural(workoutsUsing, 'тренування', 'тренувань', 'тренувань')}. ${kept}`;
}
