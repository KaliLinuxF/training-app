/**
 * The clients table / list (docs/coach-cabinet.md §6.1, §6.2), pure: one summary per client (`coachSummary`), the
 * formatted cells with their tones, the sort values, the default «за увагою» order, sorting, filtering and the URL
 * parameters of `/coach`. The components only lay these strings out.
 */
import {
  coachSummary,
  compareAttention,
  COACH_PERIODS,
  f0,
  f1,
  MACRO_KEYS,
  sgn,
  usernameKey,
  type AttentionFlag,
  type CoachClientItem,
  type CoachClientStatus,
  type CoachPeriod,
  type CoachSummary,
  type MacroKey,
} from '@legko/shared';
import { deltaTone, type Tone } from '@/ui';
import {
  activityText,
  COACH_COPY,
  flagPill,
  loggedText,
  phoneSub,
  rangeWords,
  sinceStartLine,
  statusPill,
  workoutsText,
} from './copy';
import { clientHref } from './nav';

export type SortKey = 'name' | 'weight' | 'change' | 'goalPct' | 'kcal' | 'workouts' | 'logged' | 'activity';
export type SortDir = 'asc' | 'desc';
export type ShowFilter = 'attention' | 'all';

export const SORT_KEYS: readonly SortKey[] = [
  'name',
  'weight',
  'change',
  'goalPct',
  'kcal',
  'workouts',
  'logged',
  'activity',
];

/**
 * The direction of the first header click (and of the phone select): the most useful end first — gain first, least
 * progress first, most kcal first, fewest workouts / records first, longest ago first.
 */
export const SORT_FIRST_DIR: Readonly<Record<SortKey, SortDir>> = {
  name: 'asc',
  weight: 'desc',
  change: 'desc',
  goalPct: 'asc',
  kcal: 'desc',
  workouts: 'asc',
  logged: 'asc',
  activity: 'asc',
};

export interface SortState {
  /** null = the default order (attention, status, name). */
  sort: SortKey | null;
  dir: SortDir;
}

/** A header click: first direction → the opposite → back to the default order. */
export function nextSort(current: SortState, key: SortKey): SortState {
  const first = SORT_FIRST_DIR[key];
  if (current.sort !== key) return { sort: key, dir: first };
  if (current.dir === first) return { sort: key, dir: first === 'asc' ? 'desc' : 'asc' };
  return { sort: null, dir: 'asc' };
}

/** A pill under a client's name: a flag (lavender) or an account status (neutral). */
export interface PillModel {
  key: string;
  text: string;
  tone: 'acc' | 'neutral';
}

export interface MacroCell {
  key: MacroKey;
  /** «92», or «—». */
  text: string;
  /** Lavender when the rounded average is above its goal. */
  tone: Tone;
  /** «/90» (muted, after the value) when the client set this goal, else ''. */
  goal: string;
}

export interface ClientCells {
  weight: { text: string; sub: { text: string; tone: Tone } | null; long: string };
  change: { text: string; tone: Tone; long: string };
  goalPct: { text: string; pct: number | null; long: string };
  kcal: {
    text: string;
    /** « / 1 700» (muted), '' without an average. */
    goal: string;
    tone: Tone;
    macros: MacroCell[] | null;
    long: string;
  };
  workouts: { text: string; tone: Tone; long: string };
  logged: { text: string; long: string };
  /** «—» (faint) when the row already carries the «Ще не входили» pill. */
  activity: { text: string; tone: Tone };
}

export interface ClientRowModel {
  id: string;
  username: string;
  href: string;
  status: CoachClientStatus;
  summary: CoachSummary;
  flags: AttentionFlag[];
  pills: PillModel[];
  cells: ClientCells;
  /** Phone list: the value (current weight) and the sub line. */
  phone: { value: string; sub: string };
  sortValues: Readonly<Record<SortKey, number | string | null>>;
}

const DASH = '—';

const STATUS_ORDER: Readonly<Record<CoachClientStatus, number>> = { active: 0, pending: 1, disabled: 2 };

const MACRO_LONG: Readonly<Record<MacroKey, string>> = { protein: 'білки', fat: 'жири', carbs: 'вуглеводи' };

/**
 * The pills of a client: flags (lavender), then the account status or «Новий клієнт» (neutral). Every text belongs
 * to one tone only: «Новий клієнт» is an active account with nothing recorded and no flag at all (younger than the
 * no_records rule); once a flag is up, the flag says it.
 */
export function pillsOf(s: CoachSummary): PillModel[] {
  const pills: PillModel[] = s.flags.map((flag) => ({ key: flag.kind, text: flagPill(flag), tone: 'acc' }));
  const status = statusPill(s.status);
  if (status) pills.push({ key: `status-${s.status}`, text: status, tone: 'neutral' });
  else if (!s.hasRecords && s.flags.length === 0)
    pills.push({ key: 'new', text: COACH_COPY.newClient, tone: 'neutral' });
  return pills;
}

/** The «Ще не входили» flag is up: the activity cell, the phone line and the header leave that fact to the pill. */
export const neverSeenFlagged = (s: CoachSummary): boolean =>
  s.flags.some((f) => f.kind === 'inactive' && f.never);

function cellsOf(s: CoachSummary, now: Date): ClientCells {
  const { weight, kcal, macros, workouts, logged } = s;
  const range = rangeWords(s.period);

  const sub =
    weight.sinceStart !== null
      ? { text: sinceStartLine(sgn(weight.sinceStart, f1)), tone: deltaTone(weight.sinceStart) }
      : null;
  const weightLong =
    weight.current === null
      ? 'вага: зважувань ще немає'
      : `вага ${f1(weight.current)} кг${sub ? `, від старту ${sgn(weight.sinceStart, f1)} кг` : ''}`;

  const changeText = weight.change === null ? DASH : sgn(weight.change, f1);
  const changeTone: Tone = weight.change === null ? 'faint' : deltaTone(weight.change);

  const pct = weight.goalPct;

  let macroCells: MacroCell[] | null = null;
  const macroLong: string[] = [];
  if (macros.days > 0) {
    macroCells = MACRO_KEYS.map((key) => {
      const avg = macros.avg[key];
      const goal = macros.goals[key];
      const over = avg !== null && goal !== null && Math.round(avg) > goal;
      const words = [`${MACRO_LONG[key]} ${avg === null ? 'не пораховано' : `${f0(avg)} г`}`];
      if (goal !== null) words.push(`ціль ${f0(goal)} г`);
      if (over) words.push('більше цілі');
      macroLong.push(words.join(', '));
      return {
        key,
        text: avg === null ? DASH : f0(avg),
        tone: over ? 'acc' : 'ink',
        goal: goal === null ? '' : `/${f0(goal)}`,
      };
    });
  }
  const kcalOver = kcal.avg !== null && kcal.avg > kcal.goal;
  const kcalLong =
    kcal.avg === null
      ? 'калорії: ще немає повних днів'
      : `калорії ${f0(kcal.avg)} при цілі ${f0(kcal.goal)}${kcalOver ? ', більше цілі' : ''}`;

  const behind = workouts.done < workouts.plannedSoFar;

  return {
    weight: { text: weight.current === null ? DASH : f1(weight.current), sub, long: weightLong },
    change: {
      text: changeText,
      tone: changeTone,
      long: weight.change === null ? `${range}: немає даних` : `${range} ${sgn(weight.change, f1)} кг`,
    },
    goalPct: {
      text: pct === null ? DASH : `${Math.round(pct)}%`,
      pct,
      long: pct === null ? 'до цілі: зважувань ще немає' : `пройдено ${Math.round(pct)}% шляху до цілі`,
    },
    kcal: {
      text: kcal.avg === null ? DASH : f0(kcal.avg),
      goal: kcal.avg === null ? '' : ` / ${f0(kcal.goal)}`,
      tone: kcal.avg === null ? 'faint' : kcalOver ? 'acc' : 'acc2',
      macros: macroCells,
      long: [kcalLong, ...macroLong].join('; '),
    },
    workouts: {
      text: workoutsText(workouts.done, workouts.planned),
      tone: behind ? 'acc' : 'ink',
      long: `тренувань ${workouts.planned > 0 ? `${workouts.done} з ${workouts.planned}` : workouts.done} ${range}, за планом на сьогодні — ${workouts.plannedSoFar}`,
    },
    logged: {
      text: loggedText(logged.days, logged.of),
      long: `записи за ${logged.days} ${logged.days === 1 ? 'день' : 'днів'} з ${logged.of}`,
    },
    activity: neverSeenFlagged(s)
      ? { text: DASH, tone: 'faint' }
      : { text: activityText(s.lastSeenAt, now), tone: 'ink' },
  };
}

/** The rows of the clients table / list in the default order (attention, then status, then name). */
export function buildClientRows(
  items: readonly CoachClientItem[],
  now: Date,
  period: CoachPeriod,
): ClientRowModel[] {
  const rows = items.map((item): ClientRowModel => {
    const summary = coachSummary(item, now, period);
    const cells = cellsOf(summary, now);
    const { client } = item;
    return {
      id: client.id,
      username: client.username,
      href: clientHref(client.id),
      status: client.status,
      summary,
      flags: summary.flags,
      pills: pillsOf(summary),
      cells,
      phone: {
        value: summary.weight.current === null ? DASH : `${f1(summary.weight.current)} кг`,
        sub: phoneSub({
          period,
          change: summary.weight.change === null ? null : sgn(summary.weight.change, f1),
          kcal:
            summary.kcal.avg === null ? null : { avg: f0(summary.kcal.avg), goal: f0(summary.kcal.goal) },
          logged: summary.logged,
          lastSeenAt: summary.lastSeenAt,
          now,
          omitNeverSeen: neverSeenFlagged(summary),
        }),
      },
      sortValues: {
        name: usernameKey(client.username),
        weight: summary.weight.current,
        change: summary.weight.change,
        goalPct: summary.weight.goalPct,
        kcal: summary.kcal.avg,
        workouts: summary.workouts.done,
        logged: summary.logged.days,
        // Never signed in = the longest ago of all: first in «longest ago first», not «missing» (nulls go last).
        activity: summary.lastSeenAt ?? Number.NEGATIVE_INFINITY,
      },
    };
  });
  return rows.sort(compareDefault);
}

/** «За увагою»: more / more severe flags first, then active · pending · disabled, then the name. */
export function compareDefault(a: ClientRowModel, b: ClientRowModel): number {
  return (
    compareAttention(a.summary, b.summary) ||
    STATUS_ORDER[a.status] - STATUS_ORDER[b.status] ||
    a.username.localeCompare(b.username, 'uk')
  );
}

function compareValues(a: number | string, b: number | string): number {
  if (a === b) return 0;
  if (typeof a === 'string' && typeof b === 'string') return a.localeCompare(b, 'uk');
  return Number(a) - Number(b);
}

/** Sorted copy by `key` / `dir`; null values always last; ties keep the default order. */
export function sortRows(rows: readonly ClientRowModel[], key: SortKey | null, dir: SortDir): ClientRowModel[] {
  const out = [...rows];
  if (key === null) return out.sort(compareDefault);
  const sign = dir === 'asc' ? 1 : -1;
  return out.sort((a, b) => {
    const va = a.sortValues[key];
    const vb = b.sortValues[key];
    if (va === null && vb === null) return compareDefault(a, b);
    if (va === null) return 1;
    if (vb === null) return -1;
    return sign * compareValues(va, vb) || compareDefault(a, b);
  });
}

/** Rows that need attention (`show`), whose name contains `q` (case-insensitive, trimmed). */
export function filterRows(rows: readonly ClientRowModel[], show: ShowFilter, q: string): ClientRowModel[] {
  const needle = usernameKey(q);
  return rows.filter(
    (row) =>
      (show === 'all' || row.flags.length > 0) && (needle === '' || usernameKey(row.username).includes(needle)),
  );
}

// ---- URL (`/coach?days=&show=&sort=&dir=&q=`) ------------------------------------------------

export interface ListParams extends SortState {
  days: CoachPeriod;
  show: ShowFilter;
  q: string;
}

export const DEFAULT_LIST_PARAMS: ListParams = { days: 7, show: 'all', sort: null, dir: 'asc', q: '' };

export const isSortKey = (v: unknown): v is SortKey => SORT_KEYS.includes(v as SortKey);

export function parsePeriod(v: string | null): CoachPeriod {
  const n = Number(v);
  return (COACH_PERIODS as readonly number[]).includes(n) && v === String(n) ? (n as CoachPeriod) : 7;
}

/** `/coach` query → parameters; anything invalid falls back to its default. */
export function parseListParams(search: string | URLSearchParams): ListParams {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const rawSort = p.get('sort');
  const sort = isSortKey(rawSort) ? rawSort : null;
  const rawDir = p.get('dir');
  const dir: SortDir = sort === null ? 'asc' : rawDir === 'asc' || rawDir === 'desc' ? rawDir : SORT_FIRST_DIR[sort];
  return {
    days: parsePeriod(p.get('days')),
    show: p.get('show') === 'attention' ? 'attention' : 'all',
    sort,
    dir,
    q: p.get('q') ?? '',
  };
}

/** Parameters → `?…` (defaults left out; '' when everything is default). */
export function listSearch(params: ListParams): string {
  const p = new URLSearchParams();
  if (params.days !== 7) p.set('days', String(params.days));
  if (params.show !== 'all') p.set('show', params.show);
  if (params.sort !== null) {
    p.set('sort', params.sort);
    p.set('dir', params.dir);
  }
  if (params.q !== '') p.set('q', params.q);
  const s = p.toString();
  return s ? `?${s}` : '';
}
