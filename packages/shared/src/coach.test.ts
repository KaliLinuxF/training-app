import { describe, expect, it } from 'vitest';
import {
  API,
  ATTENTION_ORDER,
  ATTENTION_RULES,
  COACH_PERIODS,
  COACH_WINDOW_AHEAD,
  COACH_WINDOW_BACK,
  COACH_WINDOW_MAX_DAYS,
  addDays,
  clientToday,
  coachClientPath,
  coachClientsPath,
  coachItemFromData,
  coachPhotoThumbUrl,
  coachPhotoUrl,
  coachSummary,
  coachWindow,
  coachWindowSchema,
  compareAttention,
  defaultSettings,
  diffDays,
  digestDay,
  emptyData,
  emptyMacros,
  normalizeDay,
  weekdayOf,
  type AppData,
  type AttentionFlag,
  type AttentionKind,
  type CoachClient,
  type CoachClientItem,
  type CoachDay,
  type CoachPeriod,
  type CoachSummary,
  type DayEntry,
  type ISODate,
  type Settings,
  type WeightEntry,
} from './index';

// ---- builders --------------------------------------------------------------------------------

const H = 3_600_000;
const D = 86_400_000;

/** An instant on `date` in Kyiv (UTC+3 until 2026-10-25). */
const at = (date: ISODate, hm = '10:00'): Date => new Date(`${date}T${hm}:00+03:00`);
/** Wednesday, 14 October 2026, 10:00 in Kyiv. */
const T0 = '2026-10-14';
const NOW = at(T0);

const ALL_COMPLETE = { protein: true, fat: true, carbs: true };

const day = (over: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...over,
});

const cd = (date: ISODate, over: Partial<CoachDay> = {}): CoachDay => ({
  date,
  kcal: null,
  macros: emptyMacros(),
  complete: { ...ALL_COMPLETE },
  trained: null,
  meals: 0,
  ...over,
});

const makeClient = (now: Date, over: Partial<CoachClient> = {}): CoachClient => ({
  id: 'a1'.repeat(16),
  username: 'olya',
  status: 'active',
  createdAt: now.getTime() - 40 * D,
  lastSeenAt: now.getTime() - H,
  ...over,
});

const makeSettings = (over: Partial<Settings> = {}): Settings => ({
  ...defaultSettings(),
  onboarded: true,
  goal: 60,
  ...over,
});

const makeItem = (now: Date, over: Partial<CoachClientItem> = {}): CoachClientItem => ({
  client: makeClient(now),
  settings: makeSettings(),
  weights: [],
  measures: [],
  days: [],
  firstRecord: null,
  lastRecord: null,
  steps: [],
  sessions: [],
  schedule: [],
  ...over,
});

/** Dates from `from` to `to`, inclusive. */
function datesBetween(from: ISODate, to: ISODate): ISODate[] {
  const out: ISODate[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) out.push(d);
  return out;
}

/**
 * A client with nothing to flag at `today`: a day (1 600 kcal) every day of the 33 days before today, a weigh-in
 * every Monday in that span (Monday weigh-in reminder on), records up to `until` (default: yesterday).
 */
function steadyItem(
  today: ISODate,
  opts: { until?: ISODate; settings?: Partial<Settings> } = {},
): CoachClientItem {
  const now = at(today);
  const start = addDays(today, -33);
  const until = opts.until ?? addDays(today, -1);
  const dates = datesBetween(start, until);
  const weights: WeightEntry[] = dates
    .filter((d) => weekdayOf(d) === 1)
    .map((date, i) => ({ date, kg: 72 - i * 0.4 }));
  return makeItem(now, {
    settings: makeSettings(opts.settings),
    weights,
    days: dates.map((d) =>
      cd(d, { kcal: 1600, meals: 1, complete: { protein: false, fat: false, carbs: false } }),
    ),
    firstRecord: start,
    lastRecord: until,
  });
}

const summaryAt = (
  item: CoachClientItem,
  today: ISODate,
  period: CoachPeriod = 7,
  hm = '10:00',
): CoachSummary => coachSummary(item, at(today, hm), period);

const kinds = (s: CoachSummary): AttentionKind[] => s.flags.map((f) => f.kind);
const flagOf = <K extends AttentionKind>(
  s: CoachSummary,
  kind: K,
): Extract<AttentionFlag, { kind: K }> | undefined =>
  s.flags.find((f): f is Extract<AttentionFlag, { kind: K }> => f.kind === kind);

/** Replaces the kcal of the stored days on `dates` (in order). */
function withKcal(item: CoachClientItem, dates: ISODate[], kcal: number[]): CoachClientItem {
  const byDate = new Map(dates.map((d, i) => [d, kcal[i] ?? null]));
  return {
    ...item,
    days: item.days.map((d) => (byDate.has(d.date) ? { ...d, kcal: byDate.get(d.date) ?? null } : d)),
  };
}

// ---- constants, schema, paths ----------------------------------------------------------------

describe('constants', () => {
  it('pins the window, the periods and the attention thresholds', () => {
    expect(COACH_WINDOW_MAX_DAYS).toBe(62);
    expect(COACH_WINDOW_BACK).toBe(33);
    expect(COACH_WINDOW_AHEAD).toBe(1);
    expect(COACH_PERIODS).toEqual([7, 30]);
    expect(ATTENTION_RULES).toEqual({
      kcalOverRatio: 0.1,
      kcalWindowDays: 7,
      kcalMinDays: 3,
      emptyFullDays: 3,
      newAccountDays: 3,
      inactiveDays: 7,
      weighWindowDays: 6,
      weighFallbackDays: 8,
    });
    expect(ATTENTION_ORDER).toEqual(['inactive', 'no_records', 'no_weigh_in', 'kcal_over']);
    expect(API.coachClients).toBe('/api/coach/clients');
  });
});

describe('digestDay', () => {
  it('reduces a legacy food day (one pseudo-meal, macros unknown and incomplete)', () => {
    const d = digestDay(
      '2026-10-13',
      day({ food: 'Каша, суп', kcal: 1500, trained: true, types: ['Кардіо'] }),
    );
    expect(d).toEqual({
      date: '2026-10-13',
      kcal: 1500,
      macros: { protein: null, fat: null, carbs: null },
      complete: { protein: false, fat: false, carbs: false },
      trained: true,
      meals: 1,
    });
  });

  it('reduces a meal day to the derived kcal, summed macros and the meal count', () => {
    const entry = normalizeDay(
      day({
        meals: [
          {
            id: 'm1',
            type: 'Сніданок',
            time: '08:30',
            text: '',
            kcal: null,
            protein: null,
            fat: null,
            carbs: null,
            items: [
              { name: 'Вівсянка', portion: '250 г', kcal: 320, protein: 9, fat: 6, carbs: 58 },
              { name: 'Кава', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 },
            ],
          },
          { id: 'm2', type: 'Обід', time: '13:10', text: 'Борщ', kcal: 400, protein: 20, fat: 15, carbs: 40 },
        ],
      }),
    );
    expect(digestDay('2026-10-13', entry)).toEqual({
      date: '2026-10-13',
      kcal: 780,
      macros: { protein: 32, fat: 24, carbs: 103 },
      complete: { ...ALL_COMPLETE },
      trained: null,
      meals: 2,
    });
  });

  it('marks partial macros incomplete per key', () => {
    const entry = normalizeDay(
      day({
        trained: false,
        meals: [
          {
            id: 'm1',
            type: 'Сніданок',
            time: '08:30',
            text: '',
            kcal: null,
            protein: null,
            fat: null,
            carbs: null,
            items: [{ name: 'Тост', portion: '1 шт', kcal: 200, protein: 8, fat: 5, carbs: null }],
          },
        ],
      }),
    );
    const d = digestDay('2026-10-12', entry);
    expect(d.macros).toEqual({ protein: 8, fat: 5, carbs: null });
    expect(d.complete).toEqual({ protein: true, fat: true, carbs: false });
    expect(d.trained).toBe(false);

    const withApple = normalizeDay({
      ...entry,
      meals: [
        ...(entry.meals ?? []),
        {
          id: 'm2',
          type: 'Перекус',
          time: '10:00',
          text: 'Яблуко',
          kcal: 80,
          protein: null,
          fat: null,
          carbs: null,
        },
      ],
    });
    const d2 = digestDay('2026-10-12', withApple);
    expect(d2.kcal).toBe(280);
    expect(d2.macros).toEqual({ protein: 8, fat: 5, carbs: null });
    expect(d2.complete).toEqual({ protein: false, fat: false, carbs: false });
    expect(d2.meals).toBe(2);
  });

  it('gives null kcal and no meals for a day without food', () => {
    expect(digestDay('2026-10-11', day({ trained: true, types: ['Прес'], notes: 'втома' }))).toEqual({
      date: '2026-10-11',
      kcal: null,
      macros: { protein: null, fat: null, carbs: null },
      complete: { ...ALL_COMPLETE },
      trained: true,
      meals: 0,
    });
  });
});

describe('clientToday', () => {
  it('is the date in the client zone at that instant', () => {
    const lateUtc = new Date('2026-10-14T22:30:00Z');
    expect(clientToday('Europe/Kyiv', lateUtc)).toBe('2026-10-15');
    expect(clientToday('UTC', lateUtc)).toBe('2026-10-14');
    expect(clientToday('America/New_York', new Date('2026-10-15T02:00:00Z'))).toBe('2026-10-14');
  });

  it('crosses midnight exactly at the zone boundary', () => {
    expect(clientToday('Europe/Kyiv', new Date('2026-10-14T20:59:00Z'))).toBe('2026-10-14');
    expect(clientToday('Europe/Kyiv', new Date('2026-10-14T21:00:00Z'))).toBe('2026-10-15');
  });

  it('falls back to Europe/Kyiv for an invalid zone', () => {
    const t = new Date('2026-10-14T22:30:00Z');
    expect(clientToday('Mars/Olympus', t)).toBe('2026-10-15');
    expect(clientToday('', t)).toBe('2026-10-15');
  });
});

describe('coachWindow', () => {
  it('is device-local today − 33 … today + 1', () => {
    expect(coachWindow(new Date(2026, 9, 14, 12, 0))).toEqual({ from: '2026-09-11', to: '2026-10-15' });
    expect(coachWindow(new Date(2026, 0, 1, 0, 5))).toEqual({ from: '2025-11-29', to: '2026-01-02' });
  });

  it('fits the schema (35 days)', () => {
    const w = coachWindow(new Date(2026, 9, 14, 12, 0));
    expect(diffDays(w.from, w.to) + 1).toBe(35);
    expect(coachWindowSchema.safeParse(w).success).toBe(true);
  });
});

describe('coachWindowSchema', () => {
  const valid = (v: unknown): boolean => coachWindowSchema.safeParse(v).success;

  it('refuses missing values', () => {
    expect(valid({})).toBe(false);
    expect(valid({ from: '2026-10-01' })).toBe(false);
    expect(valid({ to: '2026-10-01' })).toBe(false);
    expect(valid(null)).toBe(false);
  });

  it('refuses invalid dates (without throwing)', () => {
    expect(valid({ from: '2026-02-30', to: '2026-03-01' })).toBe(false);
    expect(valid({ from: 'abc', to: '2026-10-01' })).toBe(false);
    expect(valid({ from: '2026-10-01', to: '2026-10-1' })).toBe(false);
    expect(valid({ from: 20261001, to: '2026-10-01' })).toBe(false);
  });

  it('refuses to < from', () => {
    expect(valid({ from: '2026-10-02', to: '2026-10-01' })).toBe(false);
  });

  it('accepts one day and up to 62 days inclusive; refuses 63', () => {
    expect(valid({ from: '2026-10-01', to: '2026-10-01' })).toBe(true);
    const from = '2026-08-20';
    expect(valid({ from, to: addDays(from, 61) })).toBe(true);
    expect(valid({ from, to: addDays(from, 62) })).toBe(false);
  });

  it('keeps only from and to', () => {
    expect(coachWindowSchema.parse({ from: '2026-10-01', to: '2026-10-02', x: 1 })).toEqual({
      from: '2026-10-01',
      to: '2026-10-02',
    });
  });
});

describe('coach paths', () => {
  it('builds the list path with the window query', () => {
    expect(coachClientsPath({ from: '2026-09-11', to: '2026-10-15' })).toBe(
      '/api/coach/clients?from=2026-09-11&to=2026-10-15',
    );
  });

  it('encodes ids', () => {
    expect(coachClientPath('a'.repeat(32))).toBe(`/api/coach/clients/${'a'.repeat(32)}`);
    expect(coachClientPath('a/b?c#d')).toBe('/api/coach/clients/a%2Fb%3Fc%23d');
    expect(coachPhotoUrl('a/b', 'p h/1')).toBe('/api/coach/clients/a%2Fb/photos/p%20h%2F1');
    expect(coachPhotoThumbUrl('a/b', 'p h/1')).toBe('/api/coach/clients/a%2Fb/photos/p%20h%2F1/thumb');
    expect(coachPhotoUrl('c1', 'photo_1234567890ab')).toBe('/api/coach/clients/c1/photos/photo_1234567890ab');
  });
});

// ---- summary values (§4.1) -------------------------------------------------------------------

describe('coachSummary — echo fields', () => {
  it('uses the client zone for today and echoes period, status and lastSeenAt', () => {
    const item = makeItem(NOW, { settings: makeSettings({ timezone: 'America/New_York' }) });
    const s = coachSummary(item, new Date('2026-10-15T02:00:00Z'), 30);
    expect(s.today).toBe('2026-10-14');
    expect(s.period).toBe(30);
    expect(s.status).toBe('active');
    expect(s.lastSeenAt).toBe(item.client.lastSeenAt);
    const invalidZone = makeItem(NOW, { settings: makeSettings({ timezone: 'Nowhere/Land' }) });
    expect(coachSummary(invalidZone, new Date('2026-10-14T22:30:00Z'), 7).today).toBe('2026-10-15');
  });
});

describe('coachSummary — weight', () => {
  const weights: WeightEntry[] = [
    { date: '2026-09-28', kg: 72 },
    { date: '2026-10-05', kg: 71 },
    { date: '2026-10-09', kg: 70.6 },
    { date: '2026-10-12', kg: 70.2 },
    { date: '2026-10-13', kg: 70 },
    { date: '2026-10-16', kg: 69 }, // after today: ignored
  ];

  it('current = the latest weigh-in up to today; change over Mon…today (P7) and today − 29…today (P30)', () => {
    const item = makeItem(NOW, { weights });
    const w7 = summaryAt(item, T0, 7).weight;
    expect(w7.current).toBe(70);
    expect(w7.date).toBe('2026-10-13');
    expect(w7.change).toBeCloseTo(70 - 70.6, 10); // baseline: the last value before Monday 12th
    expect(w7.sinceStart).toBeCloseTo(-2, 10);
    expect(w7.goal).toBe(60);
    expect(w7.goalPct).toBeCloseTo(((72 - 70) / (72 - 60)) * 100, 10);
    expect(w7.left).toBeCloseTo(10, 10);

    const w30 = summaryAt(item, T0, 30).weight;
    expect(w30.change).toBeCloseTo(-2, 10); // nothing before 15 Sep: last − first in range
  });

  it('change: two in range and nothing before → last − first; a single one → null', () => {
    const two = makeItem(NOW, {
      weights: [
        { date: '2026-10-12', kg: 70.4 },
        { date: '2026-10-13', kg: 70 },
      ],
    });
    expect(summaryAt(two, T0).weight.change).toBeCloseTo(-0.4, 10);

    const one = makeItem(NOW, { weights: [{ date: '2026-10-13', kg: 70 }] });
    const w = summaryAt(one, T0).weight;
    expect(w.change).toBeNull();
    expect(w.sinceStart).toBeNull();
    expect(w.current).toBe(70);
    expect(w.goalPct).toBe(0);

    const before = makeItem(NOW, { weights: [{ date: '2026-10-05', kg: 71 }] });
    expect(summaryAt(before, T0).weight.change).toBeNull(); // nothing in this week
  });

  it('goalPct follows the weightSummary.pct rule (clamped, 0 when the start is not above the goal)', () => {
    const reached = makeItem(NOW, {
      weights: [
        { date: '2026-10-01', kg: 80 },
        { date: '2026-10-13', kg: 55 },
      ],
    });
    expect(summaryAt(reached, T0).weight.goalPct).toBe(100);
    expect(summaryAt(reached, T0).weight.left).toBe(0);

    const gained = makeItem(NOW, {
      weights: [
        { date: '2026-10-01', kg: 70 },
        { date: '2026-10-13', kg: 72 },
      ],
    });
    expect(summaryAt(gained, T0).weight.goalPct).toBe(0);
    expect(summaryAt(gained, T0).weight.sinceStart).toBeCloseTo(2, 10);

    const belowGoal = makeItem(NOW, {
      weights: [
        { date: '2026-10-01', kg: 58 },
        { date: '2026-10-13', kg: 57 },
      ],
    });
    expect(summaryAt(belowGoal, T0).weight.goalPct).toBe(0);
  });

  it('is empty without weigh-ins (future ones do not count)', () => {
    const item = makeItem(NOW, { weights: [{ date: '2026-10-15', kg: 70 }] });
    expect(summaryAt(item, T0).weight).toEqual({
      current: null,
      date: null,
      change: null,
      sinceStart: null,
      goal: 60,
      goalPct: null,
      left: null,
    });
  });
});

describe('coachSummary — kcal and macros over full days', () => {
  it('averages kcal over [today − P, today − 1]: today and older days excluded, unknown kcal skipped', () => {
    const item = makeItem(NOW, {
      days: [
        cd('2026-10-06', { kcal: 2000 }), // T − 8
        cd('2026-10-07', { kcal: 1500 }), // T − 7
        cd('2026-10-08', { kcal: 1700 }),
        cd('2026-10-11', { kcal: null, trained: true }),
        cd('2026-10-13', { kcal: 1600 }),
        cd('2026-10-14', { kcal: 3000 }), // today
      ],
    });
    expect(summaryAt(item, T0, 7).kcal).toEqual({ avg: 1600, days: 3, goal: 1700 });
    expect(summaryAt(item, T0, 30).kcal).toEqual({ avg: 1700, days: 4, goal: 1700 });
    expect(summaryAt(makeItem(NOW), T0).kcal).toEqual({ avg: null, days: 0, goal: 1700 });
  });

  it('averages each macro over complete days only', () => {
    const goals = { protein: 90, fat: 60, carbs: null };
    const item = makeItem(NOW, {
      settings: makeSettings({ macroGoals: goals }),
      days: [
        cd('2026-10-11', { kcal: 1500 }), // no macros at all: not counted
        cd('2026-10-12', { kcal: 1500, macros: { protein: 80, fat: 50, carbs: 200 } }),
        cd('2026-10-13', {
          kcal: 1500,
          macros: { protein: 40, fat: null, carbs: 100 },
          complete: { protein: true, fat: true, carbs: false },
        }),
        cd('2026-10-14', { kcal: 900, macros: { protein: 10, fat: 10, carbs: 10 } }), // today
        cd('2026-10-05', { kcal: 900, macros: { protein: 100, fat: 100, carbs: 100 } }), // T − 9
      ],
    });
    expect(summaryAt(item, T0, 7).macros).toEqual({
      avg: { protein: 60, fat: 50, carbs: 200 },
      days: 2,
      goals,
    });
    expect(summaryAt(item, T0, 30).macros.avg).toEqual({ protein: 220 / 3, fat: 75, carbs: 150 });
    expect(summaryAt(item, T0, 30).macros.days).toBe(3);
    expect(summaryAt(makeItem(NOW), T0).macros).toEqual({
      avg: { protein: null, fat: null, carbs: null },
      days: 0,
      goals: { protein: null, fat: null, carbs: null },
    });
  });
});

describe('coachSummary — workouts', () => {
  const days = [
    cd('2026-10-09', { trained: true }), // last week's Friday
    cd('2026-10-12', { trained: true }),
    cd('2026-10-13', { trained: false }),
    cd('2026-10-14', { trained: true }), // today counts
  ];

  it('counts done over Mon…today (P7) / today − 29…today (P30) and the plan', () => {
    const item = makeItem(NOW, { days });
    expect(summaryAt(item, T0, 7).workouts).toEqual({ done: 2, planned: 3, plannedSoFar: 1 });
    // [15 Sep (Tue) … 13 Oct (Tue)]: four whole weeks (12 plan days) + one Tuesday.
    expect(summaryAt(item, T0, 30).workouts).toEqual({ done: 3, planned: 13, plannedSoFar: 12 });
  });

  it('plannedSoFar with plan Mon / Wed / Fri: Mon → 0, Wed → 1, Sun → 3', () => {
    const item = makeItem(NOW);
    expect(weekdayOf('2026-10-12')).toBe(1);
    expect(summaryAt(item, '2026-10-12').workouts.plannedSoFar).toBe(0);
    expect(summaryAt(item, '2026-10-14').workouts.plannedSoFar).toBe(1);
    expect(summaryAt(item, '2026-10-16').workouts.plannedSoFar).toBe(2);
    expect(summaryAt(item, '2026-10-18').workouts.plannedSoFar).toBe(3);
    // P30 on Sunday 18 Oct: [19 Sep (Sat) … 17 Oct (Sat)] = 4 weeks + one Saturday → 12.
    expect(summaryAt(item, '2026-10-18', 30).workouts.plannedSoFar).toBe(12);
  });

  it('scales the plan to 30 days and handles an empty or full plan', () => {
    const two = makeItem(NOW, {
      settings: makeSettings({
        rem: { ...defaultSettings().rem, workout: { on: false, days: [2, 4], time: '18:00' } },
      }),
    });
    expect(summaryAt(two, T0, 7).workouts.planned).toBe(2);
    expect(summaryAt(two, T0, 30).workouts.planned).toBe(9);
    expect(summaryAt(two, T0, 7).workouts.plannedSoFar).toBe(1); // Tuesday 13th

    const none = makeItem(NOW, {
      settings: makeSettings({
        rem: { ...defaultSettings().rem, workout: { on: true, days: [], time: '18:00' } },
      }),
    });
    expect(summaryAt(none, T0, 30).workouts).toEqual({ done: 0, planned: 0, plannedSoFar: 0 });

    const daily = makeItem(NOW, {
      settings: makeSettings({
        rem: { ...defaultSettings().rem, workout: { on: true, days: [0, 1, 2, 3, 4, 5, 6], time: '18:00' } },
      }),
    });
    expect(summaryAt(daily, T0, 30).workouts).toEqual({ done: 0, planned: 30, plannedSoFar: 29 });
    expect(summaryAt(daily, T0, 7).workouts).toEqual({ done: 0, planned: 7, plannedSoFar: 2 });
  });
});

describe('coachSummary — logged days and the last record', () => {
  it('counts distinct full days with a day, weigh-in or measurement', () => {
    const item = makeItem(NOW, {
      days: [cd('2026-10-13'), cd('2026-10-11'), cd('2026-10-06'), cd('2026-10-14')],
      weights: [
        { date: '2026-10-11', kg: 70 },
        { date: '2026-10-09', kg: 70 },
        { date: '2026-10-14', kg: 70 },
      ],
      measures: [{ date: '2026-10-07', chest: 90, waist: 70, hips: 95 }],
    });
    expect(summaryAt(item, T0, 7).logged).toEqual({ days: 4, of: 7 });
    expect(summaryAt(item, T0, 30).logged).toEqual({ days: 5, of: 30 });
  });

  it('lastRecord = the latest record up to today (future ones ignored)', () => {
    const item = makeItem(NOW, {
      days: [cd('2026-10-10'), cd('2026-10-15')],
      weights: [
        { date: '2026-10-11', kg: 70 },
        { date: '2026-10-15', kg: 70 },
      ],
      measures: [{ date: '2026-10-12', chest: null, waist: 70, hips: null }],
      firstRecord: '2026-10-10',
      lastRecord: '2026-10-15',
    });
    const s = summaryAt(item, T0);
    expect(s.lastRecord).toBe('2026-10-12');
    expect(s.hasRecords).toBe(true);
  });

  it('uses item.lastRecord when the window holds nothing newer', () => {
    const item = makeItem(NOW, { firstRecord: '2026-07-01', lastRecord: '2026-08-01' });
    expect(summaryAt(item, T0).lastRecord).toBe('2026-08-01');
  });

  it('hasRecords is true when only a future record exists; false with none', () => {
    const future = makeItem(NOW, {
      days: [cd('2026-10-15')],
      firstRecord: '2026-10-15',
      lastRecord: '2026-10-15',
    });
    expect(summaryAt(future, T0).lastRecord).toBeNull();
    expect(summaryAt(future, T0).hasRecords).toBe(true);
    const none = summaryAt(makeItem(NOW), T0);
    expect(none.lastRecord).toBeNull();
    expect(none.hasRecords).toBe(false);
  });
});

// ---- attention flags (§4.3, §4.4) ------------------------------------------------------------

describe('attention flags', () => {
  it('a steady client raises nothing', () => {
    expect(summaryAt(steadyItem(T0), T0).flags).toEqual([]);
    expect(summaryAt(steadyItem(T0), T0, 30).flags).toEqual([]);
    expect(summaryAt(steadyItem('2026-10-12'), '2026-10-12').flags).toEqual([]);
    expect(summaryAt(steadyItem('2026-10-18'), '2026-10-18').flags).toEqual([]);
  });

  describe('inactive', () => {
    const withSeen = (ago: number | null, createdAgo = 40 * D): CoachClientItem => {
      const item = steadyItem(T0);
      return {
        ...item,
        client: {
          ...item.client,
          createdAt: NOW.getTime() - createdAgo,
          lastSeenAt: ago === null ? null : NOW.getTime() - ago,
        },
      };
    };

    it('6 days → not raised; 7 days → raised', () => {
      expect(kinds(summaryAt(withSeen(7 * D - 1), T0))).toEqual([]);
      expect(summaryAt(withSeen(7 * D), T0).flags).toEqual([{ kind: 'inactive', days: 7, never: false }]);
      expect(flagOf(summaryAt(withSeen(12 * D + 5 * H), T0), 'inactive')).toEqual({
        kind: 'inactive',
        days: 12,
        never: false,
      });
    });

    it('never seen uses createdAt', () => {
      expect(summaryAt(withSeen(null, 7 * D), T0).flags).toEqual([
        { kind: 'inactive', days: 7, never: true },
      ]);
      expect(summaryAt(withSeen(null, 6 * D), T0).flags).toEqual([]);
    });

    it('a lastSeenAt in the future counts as 0 days', () => {
      expect(summaryAt(withSeen(-3 * H), T0).flags).toEqual([]);
    });
  });

  describe('no_records', () => {
    it('(a) nothing ever recorded: from an account age of 3 days', () => {
      const fresh = (createdAgo: number): CoachClientItem =>
        makeItem(NOW, { client: makeClient(NOW, { createdAt: NOW.getTime() - createdAgo }) });
      expect(summaryAt(fresh(3 * D - 1), T0).flags).toEqual([]);
      expect(summaryAt(fresh(3 * D), T0).flags).toEqual([{ kind: 'no_records', days: null, last: null }]);
    });

    it('(b) gap 2 → not raised; gap 3 → raised', () => {
      const gap2 = summaryAt(steadyItem(T0, { until: '2026-10-11' }), T0);
      expect(flagOf(gap2, 'no_records')).toBeUndefined();
      const gap3 = summaryAt(steadyItem(T0, { until: '2026-10-10' }), T0);
      expect(flagOf(gap3, 'no_records')).toEqual({ kind: 'no_records', days: 3, last: '2026-10-10' });
      const gap4 = summaryAt(steadyItem(T0, { until: '2026-10-09' }), T0);
      expect(flagOf(gap4, 'no_records')).toEqual({ kind: 'no_records', days: 4, last: '2026-10-09' });
    });

    it('a record today clears the gap', () => {
      const item = steadyItem(T0, { until: '2026-10-05' });
      const today = { ...item, days: [...item.days, cd(T0, { trained: true })] };
      expect(flagOf(summaryAt(today, T0), 'no_records')).toBeUndefined();
      const weighedToday = { ...item, weights: [...item.weights, { date: T0, kg: 70 }] };
      expect(flagOf(summaryAt(weighedToday, T0), 'no_records')).toBeUndefined();
    });
  });

  describe('no_weigh_in (reminder on, Monday)', () => {
    /** Steady, but the weigh-in of Monday 12 October removed (or replaced). */
    const skipped = (extra: WeightEntry[] = [], firstRecord?: ISODate): CoachClientItem => {
      const item = steadyItem(T0);
      return {
        ...item,
        weights: [...item.weights.filter((w) => w.date !== '2026-10-12'), ...extra],
        firstRecord: firstRecord ?? item.firstRecord,
      };
    };

    it('the weigh day passed without a weigh-in → raised with missed and last', () => {
      expect(summaryAt(skipped(), T0).flags).toEqual([
        { kind: 'no_weigh_in', missed: '2026-10-12', last: '2026-10-05', days: null },
      ]);
    });

    it('a weigh-in after the missed day (or today) clears it', () => {
      expect(summaryAt(skipped([{ date: '2026-10-13', kg: 70 }]), T0).flags).toEqual([]);
      expect(summaryAt(skipped([{ date: T0, kg: 70 }]), T0).flags).toEqual([]);
    });

    it('the weigh day is today → not raised', () => {
      const item = steadyItem('2026-10-12');
      // Last weigh-in two weeks ago, and none today yet: Monday 12th is still in progress.
      const twoWeeks = { ...item, weights: item.weights.filter((w) => w.date < '2026-10-01') };
      expect(flagOf(summaryAt(twoWeeks, '2026-10-12', 7, '21:00'), 'no_weigh_in')).toBeUndefined();
    });

    it('firstRecord on or after the missed day → not raised', () => {
      expect(summaryAt(skipped([], '2026-10-12'), T0).flags).toEqual([]);
      expect(summaryAt(skipped([], '2026-10-13'), T0).flags).toEqual([]);
      expect(kinds(summaryAt(skipped([], '2026-10-11'), T0))).toEqual(['no_weigh_in']);
    });

    it('nothing recorded at all → only no_records', () => {
      expect(kinds(summaryAt(makeItem(NOW), T0))).toEqual(['no_records']);
    });

    it('another weigh day: the latest one in [today − 6, today − 1]', () => {
      const weighOn = (weekday: 0 | 2): Partial<Settings> => ({
        rem: { ...defaultSettings().rem, weigh: { on: true, day: weekday, time: '08:00' } },
      });
      // Sunday 11th was missed, but Monday's weigh-in came after it.
      expect(summaryAt(steadyItem(T0, { settings: weighOn(0) }), T0).flags).toEqual([]);
      // Tuesday 13th: the Monday weigh-ins before it do not count.
      expect(summaryAt(steadyItem(T0, { settings: weighOn(2) }), T0).flags).toEqual([
        { kind: 'no_weigh_in', missed: '2026-10-13', last: '2026-10-12', days: null },
      ]);
    });
  });

  describe('no_weigh_in (reminder off)', () => {
    const off: Partial<Settings> = {
      rem: { ...defaultSettings().rem, weigh: { on: false, day: 1, time: '08:00' } },
    };
    const lastWeighOn = (date: ISODate): CoachClientItem => {
      const item = steadyItem(T0, { settings: off });
      return { ...item, weights: [...item.weights.filter((w) => w.date < '2026-10-05'), { date, kg: 70 }] };
    };

    it('7 days since the last weigh-in → not raised; 8 → raised', () => {
      expect(summaryAt(lastWeighOn('2026-10-07'), T0).flags).toEqual([]);
      expect(summaryAt(lastWeighOn('2026-10-06'), T0).flags).toEqual([
        { kind: 'no_weigh_in', missed: null, last: '2026-10-06', days: 8 },
      ]);
    });

    it('no weigh-in ever: counts from the first record', () => {
      const noWeights = (firstRecord: ISODate): CoachClientItem => ({
        ...steadyItem(T0, { settings: off }),
        weights: [],
        firstRecord,
      });
      expect(summaryAt(noWeights('2026-10-07'), T0).flags).toEqual([]);
      expect(summaryAt(noWeights('2026-10-06'), T0).flags).toEqual([
        { kind: 'no_weigh_in', missed: null, last: null, days: null },
      ]);
    });

    it('a skipped weigh day alone does not raise it (only the 8 days count)', () => {
      const item = steadyItem(T0, { settings: off });
      const skipped = {
        ...item,
        weights: [...item.weights.filter((w) => w.date < '2026-10-12'), { date: '2026-10-08', kg: 70 }],
      };
      expect(summaryAt(skipped, T0).flags).toEqual([]);
    });
  });

  describe('kcal_over', () => {
    const week = datesBetween('2026-10-07', '2026-10-13');

    it('exactly +10 % (1 870 vs 1 700) → not raised; 1 871 → raised as +10 %', () => {
      const exact = withKcal(steadyItem(T0), week, Array<number>(7).fill(1870));
      expect(summaryAt(exact, T0).flags).toEqual([]);
      const over = withKcal(steadyItem(T0), week, Array<number>(7).fill(1871));
      expect(summaryAt(over, T0).flags).toEqual([
        { kind: 'kcal_over', avg: 1871, goal: 1700, overPct: 10, days: 7 },
      ]);
    });

    it('the fixture week averages 1 950 → +15 %', () => {
      const item = withKcal(steadyItem(T0), week, [1900, 1950, 2000, 1950, 1900, 2000, 1950]);
      expect(summaryAt(item, T0).flags).toEqual([
        { kind: 'kcal_over', avg: 1950, goal: 1700, overPct: 15, days: 7 },
      ]);
    });

    it('needs 3 days with kcal in [today − 7, today − 1]', () => {
      const base = steadyItem(T0);
      const sparse = (n: number): CoachClientItem => {
        const keep = week.slice(-n);
        return {
          ...base,
          days: base.days.map((d) =>
            week.includes(d.date) ? { ...d, kcal: keep.includes(d.date) ? 2500 : null } : d,
          ),
        };
      };
      expect(flagOf(summaryAt(sparse(2), T0), 'kcal_over')).toBeUndefined();
      expect(flagOf(summaryAt(sparse(3), T0), 'kcal_over')).toEqual({
        kind: 'kcal_over',
        avg: 2500,
        goal: 1700,
        overPct: 47,
        days: 3,
      });
    });

    it('ignores today and days before today − 7', () => {
      const item = steadyItem(T0);
      const loud = {
        ...withKcal(item, ['2026-10-06'], [9000]),
      };
      loud.days = [...loud.days, cd(T0, { kcal: 9000 })];
      expect(summaryAt(loud, T0).flags).toEqual([]);
    });

    it('rounds avg and overPct', () => {
      const item = withKcal(steadyItem(T0), week, [2000, 2000, 2001, 2000, 2000, 2000, 2000]);
      expect(flagOf(summaryAt(item, T0), 'kcal_over')).toEqual({
        kind: 'kcal_over',
        avg: 2000,
        goal: 1700,
        overPct: 18,
        days: 7,
      });
    });
  });

  describe('status gate, suppression and order', () => {
    /** Records up to T − 5 (no_records gap 4, Monday skipped) with three days of 2 500 kcal. */
    const troubled = (lastSeenAgo: number): CoachClientItem => {
      const item = withKcal(
        steadyItem(T0, { until: '2026-10-09' }),
        ['2026-10-07', '2026-10-08', '2026-10-09'],
        [2500, 2500, 2500],
      );
      return { ...item, client: { ...item.client, lastSeenAt: NOW.getTime() - lastSeenAgo } };
    };

    it('orders flags by ATTENTION_ORDER', () => {
      expect(kinds(summaryAt(troubled(H), T0))).toEqual(['no_records', 'no_weigh_in', 'kcal_over']);
    });

    it('inactive hides no_records and no_weigh_in, not kcal_over', () => {
      expect(kinds(summaryAt(troubled(8 * D), T0))).toEqual(['inactive', 'kcal_over']);
      const petro = makeItem(NOW, {
        client: makeClient(NOW, { createdAt: NOW.getTime() - 10 * D, lastSeenAt: null }),
      });
      expect(summaryAt(petro, T0).flags).toEqual([{ kind: 'inactive', days: 10, never: true }]);
    });

    it('disabled and pending accounts get no flags', () => {
      for (const status of ['disabled', 'pending'] as const) {
        const item = troubled(30 * D);
        const s = summaryAt({ ...item, client: { ...item.client, status } }, T0);
        expect(s.status).toBe(status);
        expect(s.flags).toEqual([]);
        expect(s.kcal.days).toBe(3); // values are still computed
      }
    });
  });
});

describe('compareAttention', () => {
  const base = summaryAt(steadyItem(T0), T0);
  const withFlags = (...flags: AttentionFlag[]): CoachSummary => ({ ...base, flags });
  const inactive: AttentionFlag = { kind: 'inactive', days: 9, never: false };
  const noRecords: AttentionFlag = { kind: 'no_records', days: 4, last: '2026-10-09' };
  const noWeigh: AttentionFlag = {
    kind: 'no_weigh_in',
    missed: '2026-10-12',
    last: '2026-10-05',
    days: null,
  };
  const over: AttentionFlag = { kind: 'kcal_over', avg: 1950, goal: 1700, overPct: 15, days: 7 };

  it('puts more flags first', () => {
    expect(compareAttention(withFlags(noWeigh, over), withFlags(inactive))).toBeLessThan(0);
    expect(compareAttention(withFlags(inactive), withFlags(noWeigh, over))).toBeGreaterThan(0);
    expect(compareAttention(withFlags(over), withFlags())).toBeLessThan(0);
  });

  it('then the more severe first flag; 0 on a tie', () => {
    expect(compareAttention(withFlags(inactive), withFlags(over))).toBeLessThan(0);
    expect(compareAttention(withFlags(noWeigh), withFlags(noRecords))).toBeGreaterThan(0);
    expect(compareAttention(withFlags(over), withFlags(over))).toBe(0);
    expect(compareAttention(withFlags(), withFlags())).toBe(0);
  });

  it('sorts a table', () => {
    const rows = [
      withFlags(),
      withFlags(over),
      withFlags(inactive, over),
      withFlags(noRecords),
      withFlags(inactive),
    ];
    expect(rows.sort(compareAttention).map((s) => kinds(s))).toEqual([
      ['inactive', 'kcal_over'],
      ['inactive'],
      ['no_records'],
      ['kcal_over'],
      [],
    ]);
  });
});

// ---- coachItemFromData ------------------------------------------------------------------------

describe('coachItemFromData', () => {
  const client = makeClient(NOW);
  const window = { from: '2026-09-11', to: '2026-10-15' };

  function sample(): AppData {
    const data = emptyData();
    data.settings = makeSettings({ kcalGoal: 1800 });
    data.days = {
      '2026-10-16': day({ kcal: 1000 }), // after the window
      '2026-10-14': day({ food: 'Суп', kcal: 1500, trained: true, types: ['Кардіо'] }),
      '2026-09-01': day({ kcal: 1700 }), // before the window
      '2026-09-11': day({ notes: 'перший день' }),
      '2026-10-15': day({ trained: false }),
    };
    data.weights = [
      { date: '2026-10-12', kg: 70 },
      { date: '2026-08-01', kg: 74 },
      { date: '2026-10-20', kg: 69 },
    ];
    data.measures = [
      { date: '2026-10-16', chest: 90, waist: 70, hips: 96 },
      { date: '2026-07-01', chest: 92, waist: 74, hips: 99 },
    ];
    data.foods = [{ name: 'Суп', portion: '300 г', kcal: 200, count: 2, lastUsed: '2026-10-14' }];
    return data;
  }

  it('equals the item the server would send', () => {
    const data = sample();
    const expected: CoachClientItem = {
      client,
      settings: data.settings,
      weights: [
        { date: '2026-08-01', kg: 74 },
        { date: '2026-10-12', kg: 70 },
        { date: '2026-10-20', kg: 69 },
      ],
      measures: [
        { date: '2026-07-01', chest: 92, waist: 74, hips: 99 },
        { date: '2026-10-16', chest: 90, waist: 70, hips: 96 },
      ],
      days: [
        {
          date: '2026-09-11',
          kcal: null,
          macros: emptyMacros(),
          complete: { ...ALL_COMPLETE },
          trained: null,
          meals: 0,
        },
        {
          date: '2026-10-14',
          kcal: 1500,
          macros: emptyMacros(),
          complete: { protein: false, fat: false, carbs: false },
          trained: true,
          meals: 1,
        },
        {
          date: '2026-10-15',
          kcal: null,
          macros: emptyMacros(),
          complete: { ...ALL_COMPLETE },
          trained: false,
          meals: 0,
        },
      ],
      firstRecord: '2026-07-01',
      lastRecord: '2026-10-15',
      steps: [],
      sessions: [],
      schedule: [],
    };
    expect(coachItemFromData(client, data, window)).toEqual(expected);
  });

  it('does not change the data', () => {
    const data = sample();
    const copy = JSON.parse(JSON.stringify(data)) as AppData;
    coachItemFromData(client, data, window);
    expect(data).toEqual(copy);
  });

  it('has no span without records up to the window end', () => {
    const data = emptyData();
    data.weights = [{ date: '2026-10-16', kg: 70 }];
    const item = coachItemFromData(client, data, window);
    expect(item.firstRecord).toBeNull();
    expect(item.lastRecord).toBeNull();
    expect(item.days).toEqual([]);
  });

  it('gives the same summary as the list item for the same data', () => {
    const data = sample();
    const fromData = coachSummary(coachItemFromData(client, data, coachWindow(at(T0, '12:00'))), NOW, 7);
    expect(fromData.today).toBe(T0);
    expect(fromData.weight.current).toBe(70);
    expect(fromData.workouts.done).toBe(1);
    expect(fromData.kcal).toEqual({ avg: null, days: 0, goal: 1800 });
    expect(fromData.lastRecord).toBe(T0);
  });
});
