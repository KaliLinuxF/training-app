/**
 * The client page `/coach/<id>` (docs/coach-cabinet.md §6.3), pure: the URL parameters (tab, days, period, date),
 * the KPI strip of «Огляд» and the rows of «Що варто перевірити». The header lines come from `copy.ts`.
 */
import { f0, f1, sgn, type CoachPeriod, type CoachSummary } from '@legko/shared';
import { isPeriod, type Period } from '@/lib/stats';
import { deltaTone, type StatItem, type Tone } from '@/ui';
import { COACH_COPY, flagDetail, flagPill, KPI, rangeTitle, workoutsText, loggedText, type CoachTab } from './copy';
import { parsePeriod } from './clientsModel';
import { clientHref } from './nav';

export const TABS: readonly CoachTab[] = ['overview', 'progress', 'calendar', 'nutrition'];

export const isTab = (v: unknown): v is CoachTab => TABS.includes(v as CoachTab);

export interface DetailParams {
  tab: CoachTab;
  /** «Огляд» / «Харчування»: 7 or 30 days. */
  days: CoachPeriod;
  /** «Прогрес»: the period of the client's own Progress (default week). */
  period: Period;
  /** «Календар»: the selected day as given (validated against the client's today by `resolveSelected`). */
  date: string | null;
}

export const DEFAULT_DETAIL_PARAMS: DetailParams = { tab: 'overview', days: 7, period: 'week', date: null };

/** `/coach/<id>` query → parameters; anything invalid falls back to its default. */
export function parseDetailParams(search: string | URLSearchParams): DetailParams {
  const p = typeof search === 'string' ? new URLSearchParams(search) : search;
  const tab = p.get('tab');
  const period = p.get('period');
  return {
    tab: isTab(tab) ? tab : 'overview',
    days: parsePeriod(p.get('days')),
    period: isPeriod(period) ? period : 'week',
    date: p.get('date'),
  };
}

/** `/coach/<id>?…` with only the parameters that differ from the defaults. */
export function detailHref(id: string, params: DetailParams): string {
  const p = new URLSearchParams();
  if (params.tab !== 'overview') p.set('tab', params.tab);
  if (params.days !== 7) p.set('days', String(params.days));
  if (params.period !== 'week') p.set('period', params.period);
  if (params.date) p.set('date', params.date);
  const s = p.toString();
  return `${clientHref(id)}${s ? `?${s}` : ''}`;
}

/**
 * «Календар» on `date` (the «Історія калорій» rows and «Відкрити день →»), keeping the other parameters (7 / 30, the
 * Progress period), so coming back to «Огляд», «Прогрес» or «Харчування» finds them as the coach left them.
 */
export const calendarHref = (id: string, params: DetailParams, date: string): string =>
  detailHref(id, { ...params, tab: 'calendar', date });

const DASH = '—';

/** «Зараз» of «Огляд»: weight, its change and progress, then kcal, Б · Ж · В, workouts and records (§6.3). */
export function kpiItems(s: CoachSummary): StatItem[] {
  const { weight, kcal, macros, workouts, logged } = s;
  const kcalTone: Tone | undefined = kcal.avg === null ? undefined : kcal.avg > kcal.goal ? 'acc' : 'acc2';
  const macroValue =
    macros.days > 0 ? [macros.avg.protein, macros.avg.fat, macros.avg.carbs].map((v) => f0(v)).join(' · ') : DASH;
  return [
    { label: KPI.weight, value: f1(weight.current), unit: weight.current === null ? undefined : 'кг' },
    {
      label: rangeTitle(s.period),
      value: sgn(weight.change, f1),
      unit: weight.change === null ? undefined : 'кг',
      tone: deltaTone(weight.change),
    },
    {
      label: KPI.sinceStart,
      value: sgn(weight.sinceStart, f1),
      unit: weight.sinceStart === null ? undefined : 'кг',
      tone: deltaTone(weight.sinceStart),
    },
    { label: KPI.goalPct, value: weight.goalPct === null ? DASH : `${Math.round(weight.goalPct)}%` },
    { label: KPI.kcal(kcal.goal), value: f0(kcal.avg), tone: kcalTone },
    { label: KPI.macros, value: macroValue, unit: macroValue === DASH ? undefined : 'г' },
    {
      label: KPI.workouts,
      value: workoutsText(workouts.done, workouts.planned),
      tone: workouts.done < workouts.plannedSoFar ? 'acc' : undefined,
    },
    { label: KPI.logged, value: loggedText(logged.days, logged.of) },
  ];
}

export interface CheckRow {
  key: string;
  title: string;
  sub?: string;
}

/** «Що варто перевірити»: one row per flag (pill text + detail), or one calm row. */
export function checkRows(s: CoachSummary, now: Date): CheckRow[] {
  if (s.status === 'disabled') return [{ key: 'disabled', title: COACH_COPY.disabledFlags }];
  if (s.flags.length === 0) return [{ key: 'none', title: COACH_COPY.noFlags }];
  return s.flags.map((flag) => ({
    key: flag.kind,
    title: flagPill(flag),
    sub: flagDetail(flag, now, s.lastSeenAt),
  }));
}
