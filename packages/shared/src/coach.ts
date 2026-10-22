/**
 * The admin as a coach: the read-only «Клієнти» cabinet (docs/coach-cabinet.md §3.1, §4). Types of the coach API,
 * the window the web asks for, per-day digests, and the pure summary / attention-flag rules shared by the list
 * (digests from the server) and the detail page (digests built from the full copy by `coachItemFromData`).
 * Nothing here reads the clock: `now` is always passed in.
 */
import { z } from 'zod';
import { API } from './api';
import {
  addDays,
  diffDays,
  iso,
  isValidISODate,
  isValidTimeZone,
  mondayOf,
  weekdayOf,
  zonedNow,
} from './dates';
import { DEFAULT_TIMEZONE } from './defaults';
import { ok } from './format';
import { dayMacroComplete, dayMacros, emptyMacros, MACRO_KEYS, mealsOf } from './meals';
import { isoDateSchema } from './schemas';
import type {
  AppData,
  DayEntry,
  ISODate,
  MacroGoals,
  MacroGrams,
  MacroKey,
  MeasureEntry,
  Settings,
  WeightEntry,
} from './types';

/** Longest window `GET /api/coach/clients` accepts, days inclusive. */
export const COACH_WINDOW_MAX_DAYS = 62;
/** The web asks for [deviceToday − 33, deviceToday + 1]: 30 full days + the week + one day of time-zone slack each way. */
export const COACH_WINDOW_BACK = 33;
export const COACH_WINDOW_AHEAD = 1;
export const COACH_PERIODS = [7, 30] as const;
export type CoachPeriod = (typeof COACH_PERIODS)[number];

/** Thresholds of the attention flags (§4.4). */
export const ATTENTION_RULES = {
  /** Flag when avg > kcalGoal × (1 + 0.10), strictly. */
  kcalOverRatio: 0.1,
  /** Full days before today the kcal average looks at. */
  kcalWindowDays: 7,
  /** Days with kcal needed in that window. */
  kcalMinDays: 3,
  /** Full days without any record. */
  emptyFullDays: 3,
  /** «Nothing ever recorded» flags only from this account age (whole days) on. */
  newAccountDays: 3,
  /** Whole days since the last activity (lastSeenAt ?? createdAt). */
  inactiveDays: 7,
  /** The planned weigh-in day is looked for in [today − 6, today − 1]. */
  weighWindowDays: 6,
  /** Weigh-in reminder off: days since the last weigh-in (or the first record). */
  weighFallbackDays: 8,
} as const;

const DAY_MS = 86_400_000;

export type CoachClientStatus = 'active' | 'disabled' | 'pending';

/** What the coach sees of an account — never hashes, sessions, tokens, push subscriptions, invites, AI usage. */
export interface CoachClient {
  id: string;
  username: string;
  status: CoachClientStatus;
  /** Epoch ms («з 9 жовтня 2026»). */
  createdAt: number;
  /** Epoch ms of the last app activity (≥ 5 min granularity); null = never signed in since registration. */
  lastSeenAt: number | null;
}

/** One stored day reduced to what the table needs (a pure function of the DayEntry; no time dependence). */
export interface CoachDay {
  date: ISODate;
  /** day.kcal (the derived sum on a meal day), null when unknown. */
  kcal: number | null;
  /** dayMacros(day). */
  macros: MacroGrams;
  /** dayMacroComplete(day, key) per key. */
  complete: Record<MacroKey, boolean>;
  trained: boolean | null;
  /** mealsOf(day).length (a legacy food day = 1). */
  meals: number;
}

export interface CoachWindow {
  from: ISODate;
  to: ISODate;
}

export interface CoachClientItem {
  client: CoachClient;
  settings: Settings;
  /** All weigh-ins, oldest first. */
  weights: WeightEntry[];
  /** All measurements, oldest first. */
  measures: MeasureEntry[];
  /** Digests of the stored days in [from, to], oldest first (stored days are never empty). */
  days: CoachDay[];
  /** Earliest / latest date ≤ `to` with a day, weigh-in or measurement (all time, not only the window). */
  firstRecord: ISODate | null;
  lastRecord: ISODate | null;
}

/** `GET /api/coach/clients?from=&to=`. */
export interface CoachClientsResponse extends CoachWindow {
  clients: CoachClientItem[];
}

/** `GET /api/coach/clients/:id`; `data.foods` is always [] (C11). */
export interface CoachClientResponse {
  client: CoachClient;
  data: AppData;
}

/** Query of GET /api/coach/clients: both valid dates, from ≤ to, at most COACH_WINDOW_MAX_DAYS days inclusive. */
export const coachWindowSchema = z
  .object({ from: isoDateSchema, to: isoDateSchema })
  .refine(
    (w) =>
      isValidISODate(w.from) &&
      isValidISODate(w.to) &&
      w.from <= w.to &&
      diffDays(w.from, w.to) + 1 <= COACH_WINDOW_MAX_DAYS,
    'Expected from ≤ to and at most 62 days',
  ) satisfies z.ZodType<CoachWindow>;

/** '/api/coach/clients?from=2026-09-11&to=2026-10-15' */
export const coachClientsPath = (w: CoachWindow): string =>
  `${API.coachClients}?from=${encodeURIComponent(w.from)}&to=${encodeURIComponent(w.to)}`;
export const coachClientPath = (id: string): string => `${API.coachClients}/${encodeURIComponent(id)}`;
/** A client's food photo (JPEG, full size) through the coach route. */
export const coachPhotoUrl = (clientId: string, photoId: string): string =>
  `${coachClientPath(clientId)}/photos/${encodeURIComponent(photoId)}`;
export const coachPhotoThumbUrl = (clientId: string, photoId: string): string =>
  `${coachPhotoUrl(clientId, photoId)}/thumb`;

/** The digest of one stored day (§3.1). */
export function digestDay(date: ISODate, day: DayEntry): CoachDay {
  return {
    date,
    kcal: ok(day.kcal) ? day.kcal : null,
    macros: dayMacros(day),
    complete: {
      protein: dayMacroComplete(day, 'protein'),
      fat: dayMacroComplete(day, 'fat'),
      carbs: dayMacroComplete(day, 'carbs'),
    },
    trained: day.trained,
    meals: mealsOf(day).length,
  };
}

/** Date in `timeZone` at `now`; an invalid zone falls back to DEFAULT_TIMEZONE. */
export function clientToday(timeZone: string, now: Date): ISODate {
  return zonedNow(isValidTimeZone(timeZone) ? timeZone : DEFAULT_TIMEZONE, now).date;
}

/** The window the web requests: device-local today (iso(now)) − COACH_WINDOW_BACK … + COACH_WINDOW_AHEAD. */
export function coachWindow(now: Date): CoachWindow {
  const today = iso(now);
  return { from: addDays(today, -COACH_WINDOW_BACK), to: addDays(today, COACH_WINDOW_AHEAD) };
}

const byDate = (a: { date: ISODate }, b: { date: ISODate }): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/** The list item the server would send, built from a full copy (detail page): same digests, same span rule. */
export function coachItemFromData(client: CoachClient, data: AppData, window: CoachWindow): CoachClientItem {
  const weights = [...data.weights].sort(byDate);
  const measures = [...data.measures].sort(byDate);
  const dayDates = Object.keys(data.days).sort();
  const days: CoachDay[] = [];
  for (const date of dayDates) {
    const entry = data.days[date];
    if (entry && date >= window.from && date <= window.to) days.push(digestDay(date, entry));
  }
  let firstRecord: ISODate | null = null;
  let lastRecord: ISODate | null = null;
  for (const date of [...dayDates, ...weights.map((w) => w.date), ...measures.map((m) => m.date)]) {
    if (date > window.to) continue;
    if (firstRecord === null || date < firstRecord) firstRecord = date;
    if (lastRecord === null || date > lastRecord) lastRecord = date;
  }
  return { client, settings: data.settings, weights, measures, days, firstRecord, lastRecord };
}

// ---- summary (§4) ----------------------------------------------------------------------------

export type AttentionKind = 'inactive' | 'no_records' | 'no_weigh_in' | 'kcal_over';
/** Severity order: the first is the most severe. */
export const ATTENTION_ORDER: readonly AttentionKind[] = [
  'inactive',
  'no_records',
  'no_weigh_in',
  'kcal_over',
];

export type AttentionFlag =
  | { kind: 'inactive'; days: number; never: boolean }
  | { kind: 'no_records'; days: number | null; last: ISODate | null }
  | { kind: 'no_weigh_in'; missed: ISODate | null; last: ISODate | null; days: number | null }
  | { kind: 'kcal_over'; avg: number; goal: number; overPct: number; days: number };

export interface CoachSummary {
  /** The client's today (C6). */
  today: ISODate;
  period: CoachPeriod;
  status: CoachClientStatus;
  /** Some record exists on or before the window end. */
  hasRecords: boolean;
  weight: {
    current: number | null;
    date: ISODate | null;
    /** Week (Mon…today) for period 7, [today − 29, today] for 30; valueChange semantics. */
    change: number | null;
    /** current − first; null below two weigh-ins. */
    sinceStart: number | null;
    goal: number;
    /** 0–100 unrounded (weightSummary.pct rule); null without weigh-ins. */
    goalPct: number | null;
    /** max(0, current − goal); null without weigh-ins. */
    left: number | null;
  };
  kcal: { avg: number | null; days: number; goal: number };
  macros: { avg: MacroGrams; days: number; goals: MacroGoals };
  /** plannedSoFar = plan days already behind us in the range (tone «behind» only when done < plannedSoFar). */
  workouts: { done: number; planned: number; plannedSoFar: number };
  logged: { days: number; of: number };
  lastRecord: ISODate | null;
  lastSeenAt: number | null;
  /** In ATTENTION_ORDER; [] for disabled / pending accounts. */
  flags: AttentionFlag[];
}

const mean = (values: readonly number[]): number | null =>
  values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : null;

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, n));

/**
 * Change of a reading over `[from, to]` (= `lib/stats/range.ts` `valueChange`): last value in the range − the last
 * value before `from`, else the first value in the range when the range has ≥ 2; null otherwise.
 * `values` sorted by date ascending.
 */
function valueChange(
  values: readonly { date: ISODate; value: number }[],
  from: ISODate,
  to: ISODate,
): number | null {
  let before: number | null = null;
  let first: number | null = null;
  let last: number | null = null;
  let inRange = 0;
  for (const { date, value } of values) {
    if (date < from) before = value;
    else if (date <= to) {
      first ??= value;
      last = value;
      inRange++;
    }
  }
  if (last === null) return null;
  if (before !== null) return last - before;
  return inRange > 1 && first !== null ? last - first : null;
}

/** Whole days from `ref` (epoch ms) to `now`, never negative. */
const wholeDaysSince = (ref: number, now: Date): number =>
  Math.floor(Math.max(0, now.getTime() - ref) / DAY_MS);

const inRange = (date: ISODate, from: ISODate, to: ISODate): boolean => date >= from && date <= to;

/** Summary of one client for the table and the detail header (exact rules: docs/coach-cabinet.md §4). */
export function coachSummary(item: CoachClientItem, now: Date, period: CoachPeriod): CoachSummary {
  const { client, settings } = item;
  const T = clientToday(settings.timezone, now);
  const yesterday = addDays(T, -1);
  const fullFrom = addDays(T, -period);
  /** Start of «this week» (P 7) / of the 30 days (P 30) for weight and workouts. */
  const rangeFrom = period === 7 ? mondayOf(T) : addDays(T, -29);

  const W = item.weights.filter((w) => w.date <= T).sort(byDate);
  const M = item.measures.filter((m) => m.date <= T);
  const days = item.days;

  // weight
  const firstW = W[0] ?? null;
  const lastW = W.at(-1) ?? null;
  const goal = settings.goal;
  const weight: CoachSummary['weight'] = {
    current: lastW ? lastW.kg : null,
    date: lastW ? lastW.date : null,
    change: valueChange(
      W.map((w) => ({ date: w.date, value: w.kg })),
      rangeFrom,
      T,
    ),
    sinceStart: firstW && lastW && W.length >= 2 ? lastW.kg - firstW.kg : null,
    goal,
    goalPct:
      firstW && lastW
        ? firstW.kg > goal
          ? clamp(((firstW.kg - lastW.kg) / (firstW.kg - goal)) * 100, 0, 100)
          : 0
        : null,
    left: lastW ? Math.max(0, lastW.kg - goal) : null,
  };

  // kcal and macros over the full days [T − P, T − 1]
  const fullDays = days.filter((d) => inRange(d.date, fullFrom, yesterday));
  const kcalValues = fullDays.map((d) => d.kcal).filter(ok);
  const macroValues: Record<MacroKey, number[]> = { protein: [], fat: [], carbs: [] };
  let macroDays = 0;
  for (const d of fullDays) {
    let counted = false;
    for (const key of MACRO_KEYS) {
      const v = d.macros[key];
      if (!ok(v) || !d.complete[key]) continue;
      macroValues[key].push(v);
      counted = true;
    }
    if (counted) macroDays++;
  }
  const macroAvg = emptyMacros();
  for (const key of MACRO_KEYS) macroAvg[key] = mean(macroValues[key]);

  // workouts
  const plan = new Set<number>(settings.rem.workout.days);
  const planLen = settings.rem.workout.days.length;
  let plannedSoFar = 0;
  for (let d = rangeFrom; d < T; d = addDays(d, 1)) if (plan.has(weekdayOf(d))) plannedSoFar++;
  const workouts = {
    done: days.filter((d) => d.trained === true && inRange(d.date, rangeFrom, T)).length,
    planned: period === 7 ? planLen : Math.round((planLen * 30) / 7),
    plannedSoFar,
  };

  // logged days
  const loggedDates = new Set<ISODate>();
  for (const date of [...days.map((d) => d.date), ...W.map((w) => w.date), ...M.map((m) => m.date)])
    if (inRange(date, fullFrom, yesterday)) loggedDates.add(date);

  // last record
  let lastRecord: ISODate | null = null;
  const candidates = [
    ...days.map((d) => d.date).filter((d) => d <= T),
    ...W.map((w) => w.date),
    ...M.map((m) => m.date),
  ];
  if (item.lastRecord !== null && item.lastRecord <= T) candidates.push(item.lastRecord);
  for (const date of candidates) if (lastRecord === null || date > lastRecord) lastRecord = date;

  const summary: CoachSummary = {
    today: T,
    period,
    status: client.status,
    hasRecords: lastRecord !== null || item.firstRecord !== null,
    weight,
    kcal: { avg: mean(kcalValues), days: kcalValues.length, goal: settings.kcalGoal },
    macros: { avg: macroAvg, days: macroDays, goals: settings.macroGoals },
    workouts,
    logged: { days: loggedDates.size, of: period },
    lastRecord,
    lastSeenAt: client.lastSeenAt,
    flags: [],
  };
  if (client.status === 'active') summary.flags = attentionFlags(item, now, T, lastRecord, W);
  return summary;
}

/** §4.4, for an active account; already filtered (inactive hides the implied ones) and in ATTENTION_ORDER. */
function attentionFlags(
  item: CoachClientItem,
  now: Date,
  T: ISODate,
  lastRecord: ISODate | null,
  W: readonly WeightEntry[],
): AttentionFlag[] {
  const { client, settings } = item;
  const R = ATTENTION_RULES;
  const flags: AttentionFlag[] = [];

  const inactiveDays = wholeDaysSince(client.lastSeenAt ?? client.createdAt, now);
  const inactive = inactiveDays >= R.inactiveDays;
  if (inactive) flags.push({ kind: 'inactive', days: inactiveDays, never: client.lastSeenAt === null });

  if (!inactive) {
    if (lastRecord === null) {
      if (wholeDaysSince(client.createdAt, now) >= R.newAccountDays)
        flags.push({ kind: 'no_records', days: null, last: null });
    } else {
      const gap = diffDays(lastRecord, T) - 1;
      if (gap >= R.emptyFullDays) flags.push({ kind: 'no_records', days: gap, last: lastRecord });
    }

    const lastWeigh = W.at(-1)?.date ?? null;
    const weigh = settings.rem.weigh;
    if (weigh.on) {
      const missed = lastWeekdayBefore(T, weigh.day, R.weighWindowDays);
      if (
        missed !== null &&
        !W.some((w) => inRange(w.date, missed, T)) &&
        item.firstRecord !== null &&
        item.firstRecord < missed
      )
        flags.push({ kind: 'no_weigh_in', missed, last: lastWeigh, days: null });
    } else {
      const raised =
        lastWeigh !== null
          ? diffDays(lastWeigh, T) >= R.weighFallbackDays
          : item.firstRecord !== null && diffDays(item.firstRecord, T) >= R.weighFallbackDays;
      if (raised)
        flags.push({
          kind: 'no_weigh_in',
          missed: null,
          last: lastWeigh,
          days: lastWeigh !== null ? diffDays(lastWeigh, T) : null,
        });
    }
  }

  const kcalFrom = addDays(T, -R.kcalWindowDays);
  const yesterday = addDays(T, -1);
  const kcal = item.days
    .filter((d) => inRange(d.date, kcalFrom, yesterday))
    .map((d) => d.kcal)
    .filter(ok);
  const avg = mean(kcal);
  const goal = settings.kcalGoal;
  // Integer percentages keep «exactly +10 %» exact (1 700 × 1.1 is 1 870.0000000000002 in floating point).
  const overPct = Math.round(R.kcalOverRatio * 100);
  if (avg !== null && kcal.length >= R.kcalMinDays && goal > 0 && avg * 100 > goal * (100 + overPct))
    flags.push({
      kind: 'kcal_over',
      avg: Math.round(avg),
      goal,
      overPct: Math.round((avg / goal - 1) * 100),
      days: kcal.length,
    });

  return flags.sort((a, b) => ATTENTION_ORDER.indexOf(a.kind) - ATTENTION_ORDER.indexOf(b.kind));
}

/** The latest date in [today − within, today − 1] that falls on `weekday`, else null. */
function lastWeekdayBefore(today: ISODate, weekday: number, within: number): ISODate | null {
  for (let back = 1; back <= within; back++) {
    const d = addDays(today, -back);
    if (weekdayOf(d) === weekday) return d;
  }
  return null;
}

const severity = (s: CoachSummary): number => {
  const first = s.flags[0];
  return first ? ATTENTION_ORDER.indexOf(first.kind) : ATTENTION_ORDER.length;
};

/** More flags first, then the more severe first flag (ATTENTION_ORDER); 0 on a tie (the caller sorts by name). */
export function compareAttention(a: CoachSummary, b: CoachSummary): number {
  return b.flags.length - a.flags.length || severity(a) - severity(b);
}
