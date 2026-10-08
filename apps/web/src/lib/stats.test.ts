import {
  addDays,
  diffDays,
  emptyData,
  weekdayOf,
  type AppData,
  type DayEntry,
  type ISODate,
  type MeasureEntry,
  type Settings,
  type Weekday,
  type WeeklyReminder,
  type WeightEntry,
} from '@legko/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  calendarMonth,
  changeTone,
  chartGeometry,
  DAY_STATUS_LABELS,
  dayStatus,
  daysInRange,
  dueReminders,
  earliestDate,
  isPeriod,
  kcalAverages,
  kcalBars,
  kcalHistory,
  kcalTone,
  MEASURE_LABELS,
  MEASURE_PARAMS,
  measureSummary,
  metricChange,
  nextMeasurements,
  nextReminderLabel,
  nextWeighIn,
  periodMeta,
  PERIODS,
  periodStart,
  rangeStats,
  recentDays,
  seriesInRange,
  shiftMonth,
  typeRanking,
  valueChange,
  weekSummary,
  weightSummary,
  workoutStats,
  type CalendarCell,
  type DatedValue,
  type Period,
} from './stats';

// 2026-10-09 is a Friday; its week starts on Monday 2026-10-05.
const TODAY = '2026-10-09';
const MONDAY = '2026-10-05';
const SUNDAY = '2026-10-11';

const day = (p: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...p,
});
const w = (date: ISODate, kg: number): WeightEntry => ({ date, kg });
const m = (date: ISODate, chest: number | null, waist: number | null, hips: number | null): MeasureEntry => ({
  date,
  chest,
  waist,
  hips,
});

interface DataInput {
  days?: Record<ISODate, DayEntry>;
  weights?: WeightEntry[];
  measures?: MeasureEntry[];
  settings?: Partial<Settings>;
}

function makeData(input: DataInput = {}): AppData {
  const base = emptyData();
  return {
    days: input.days ?? {},
    weights: input.weights ?? [],
    measures: input.measures ?? [],
    foods: [],
    settings: { ...base.settings, ...input.settings },
  };
}

const pts = (...values: number[]): DatedValue[] =>
  values.map((value, i) => ({ date: addDays('2026-09-01', i), value }));

describe('periods', () => {
  it('lists the periods with the prototype copy', () => {
    expect(PERIODS.map((p) => [p.id, p.label, p.title])).toEqual([
      ['week', 'Тиждень', 'Цього тижня'],
      ['month', 'Місяць', 'За останні 30 днів'],
      ['q', '3 міс.', 'За 3 місяці'],
      ['all', 'Весь час', 'За весь період'],
    ]);
    expect(periodMeta('week').short).toBe('цього тижня');
    expect(periodMeta('all').short).toBe('за весь період');
  });

  it('guards period values', () => {
    expect(isPeriod('q')).toBe(true);
    expect(isPeriod('year')).toBe(false);
    expect(isPeriod(1)).toBe(false);
    expect(() => periodMeta('year' as Period)).toThrow(RangeError);
  });

  it('earliest date is today without any data', () => {
    expect(earliestDate(makeData(), TODAY)).toBe(TODAY);
  });

  it('earliest date takes the oldest of days, weigh-ins and measurements', () => {
    const days = { '2026-09-10': day({ kcal: 1500 }), '2026-09-03': day({ notes: 'x' }) };
    expect(earliestDate(makeData({ days }), TODAY)).toBe('2026-09-03');
    expect(earliestDate(makeData({ days, weights: [w('2026-08-31', 70)] }), TODAY)).toBe('2026-08-31');
    expect(earliestDate(makeData({ days, measures: [m('2026-08-01', 90, null, null)] }), TODAY)).toBe(
      '2026-08-01',
    );
  });

  it('earliest date never goes past today', () => {
    expect(earliestDate(makeData({ days: { '2026-10-20': day({ kcal: 1 }) } }), TODAY)).toBe(TODAY);
  });

  it('earliest date ignores the order of unsorted arrays', () => {
    const weights = [w('2026-09-20', 69), w('2026-09-01', 70)];
    expect(earliestDate(makeData({ weights }), TODAY)).toBe('2026-09-01');
  });

  it('week starts on Monday whatever the weekday', () => {
    const data = makeData();
    expect(periodStart(data, 'week', TODAY)).toBe(MONDAY);
    expect(periodStart(data, 'week', MONDAY)).toBe(MONDAY);
    expect(periodStart(data, 'week', SUNDAY)).toBe(MONDAY);
  });

  it('month is the last 30 days and q the last 90, inclusive', () => {
    const data = makeData();
    expect(periodStart(data, 'month', TODAY)).toBe('2026-09-10');
    expect(periodStart(data, 'q', TODAY)).toBe('2026-07-12');
    expect(diffDays(periodStart(data, 'q', TODAY), TODAY)).toBe(89);
    // Across February of a non-leap year.
    expect(periodStart(data, 'month', '2026-03-01')).toBe('2026-01-31');
  });

  it('all starts at the earliest record, or today when the first record is today', () => {
    expect(periodStart(makeData({ weights: [w('2026-05-04', 72)] }), 'all', TODAY)).toBe('2026-05-04');
    expect(periodStart(makeData({ days: { [TODAY]: day({ kcal: 1500 }) } }), 'all', TODAY)).toBe(TODAY);
  });
});

describe('weightSummary', () => {
  it('is empty without weigh-ins', () => {
    expect(weightSummary(makeData({ settings: { goal: 58 } }))).toEqual({
      first: null,
      last: null,
      goal: 58,
      lost: null,
      left: null,
      pct: 0,
    });
  });

  it('handles a single weigh-in', () => {
    const s = weightSummary(makeData({ weights: [w('2026-10-05', 65)], settings: { goal: 60 } }));
    expect(s.first).toEqual(w('2026-10-05', 65));
    expect(s.last).toEqual(w('2026-10-05', 65));
    expect(s.lost).toBe(0);
    expect(s.left).toBe(5);
    expect(s.pct).toBe(0);
  });

  it('computes lost, left and the way travelled', () => {
    const s = weightSummary(
      makeData({
        weights: [w('2026-09-01', 70), w('2026-09-08', 67.2), w('2026-09-15', 65)],
        settings: { goal: 60 },
      }),
    );
    expect(s.first?.kg).toBe(70);
    expect(s.last?.kg).toBe(65);
    expect(s.lost).toBe(5);
    expect(s.left).toBe(5);
    expect(s.pct).toBe(50);
  });

  it('keeps pct unrounded', () => {
    const s = weightSummary(
      makeData({ weights: [w('2026-09-01', 66), w('2026-09-08', 65)], settings: { goal: 60 } }),
    );
    expect(s.pct).toBeCloseTo(16.6667, 3);
  });

  it('clamps past the goal and on weight gain', () => {
    const past = weightSummary(
      makeData({ weights: [w('2026-09-01', 70), w('2026-09-08', 58)], settings: { goal: 60 } }),
    );
    expect(past.pct).toBe(100);
    expect(past.left).toBe(0);
    expect(past.lost).toBe(12);
    const gained = weightSummary(
      makeData({ weights: [w('2026-09-01', 70), w('2026-09-08', 72)], settings: { goal: 60 } }),
    );
    expect(gained.pct).toBe(0);
    expect(gained.lost).toBe(-2);
    expect(gained.left).toBe(12);
  });

  it('has no progress when the goal is not below the start weight', () => {
    const above = weightSummary(
      makeData({ weights: [w('2026-09-01', 58), w('2026-09-08', 57)], settings: { goal: 60 } }),
    );
    expect(above.pct).toBe(0);
    expect(above.left).toBe(0);
    expect(above.lost).toBe(1);
    const equal = weightSummary(
      makeData({ weights: [w('2026-09-01', 60), w('2026-09-08', 59)], settings: { goal: 60 } }),
    );
    expect(equal.pct).toBe(0);
  });

  it('sorts unsorted weigh-ins', () => {
    const s = weightSummary(
      makeData({ weights: [w('2026-09-15', 65), w('2026-09-01', 70)], settings: { goal: 60 } }),
    );
    expect(s.first?.date).toBe('2026-09-01');
    expect(s.last?.date).toBe('2026-09-15');
  });
});

describe('measureSummary', () => {
  it('is empty without measurements', () => {
    const s = measureSummary(makeData());
    expect(s.lastEntry).toBeNull();
    expect(s.params).toEqual([
      { key: 'chest', label: 'Груди', first: null, last: null, delta: null },
      { key: 'waist', label: 'Талія', first: null, last: null, delta: null },
      { key: 'hips', label: 'Стегна', first: null, last: null, delta: null },
    ]);
  });

  it('looks up each parameter on its own when entries are partial', () => {
    const measures = [
      m('2026-09-01', 93, 75, null),
      m('2026-09-08', null, 74, 101),
      m('2026-09-15', 92, null, null),
    ];
    const s = measureSummary(makeData({ measures }));
    expect(s.params).toEqual([
      { key: 'chest', label: 'Груди', first: 93, last: 92, delta: -1 },
      { key: 'waist', label: 'Талія', first: 75, last: 74, delta: -1 },
      // A single reading: the delta is 0, as in the prototype.
      { key: 'hips', label: 'Стегна', first: 101, last: 101, delta: 0 },
    ]);
    expect(s.lastEntry).toEqual(measures[2]);
  });

  it('exports labels in display order', () => {
    expect(MEASURE_PARAMS.map((p) => p.label)).toEqual(['Груди', 'Талія', 'Стегна']);
    expect(MEASURE_LABELS.waist).toBe('Талія');
  });
});

describe('changeTone', () => {
  it('maps the sign with the ±0.04 dead zone', () => {
    expect(changeTone(null)).toBe('flat');
    expect(changeTone(undefined)).toBe('flat');
    expect(changeTone(Number.NaN)).toBe('flat');
    expect(changeTone(-0.5)).toBe('down');
    expect(changeTone(0.5)).toBe('up');
    expect(changeTone(0.04)).toBe('flat');
    expect(changeTone(-0.04)).toBe('flat');
    expect(changeTone(0.05)).toBe('up');
    expect(changeTone(-0.05)).toBe('down');
  });
});

describe('valueChange (baseline rule)', () => {
  const from = '2026-10-05';
  const to = '2026-10-09';
  const v = (date: ISODate, value: number): DatedValue => ({ date, value });

  it('is null without readings in range', () => {
    expect(valueChange([], from, to)).toBeNull();
    expect(valueChange([v('2026-09-28', 70)], from, to)).toBeNull();
    expect(valueChange([v('2026-10-10', 70)], from, to)).toBeNull();
  });

  it('is null for a single reading and nothing before', () => {
    expect(valueChange([v('2026-10-06', 70)], from, to)).toBeNull();
  });

  it('uses the last reading before the range as the baseline', () => {
    const values = [v('2026-09-21', 71), v('2026-09-28', 70), v('2026-10-06', 69.5)];
    expect(valueChange(values, from, to)).toBeCloseTo(-0.5);
  });

  it('uses the first reading in range without anything before', () => {
    expect(
      valueChange([v('2026-10-05', 70), v('2026-10-07', 69), v('2026-10-09', 68.6)], from, to),
    ).toBeCloseTo(-1.4);
  });

  it('includes both boundaries and ignores readings after `to`', () => {
    const values = [v('2026-10-04', 72), v('2026-10-05', 71), v('2026-10-09', 70), v('2026-10-10', 60)];
    expect(valueChange(values, from, to)).toBe(-2);
    expect(valueChange([v('2026-10-05', 71), v('2026-10-09', 70)], from, to)).toBe(-1);
  });

  it('reports 0 (not null) for an unchanged value against a baseline', () => {
    expect(valueChange([v('2026-09-28', 70), v('2026-10-06', 70)], from, to)).toBe(0);
  });
});

describe('rangeStats', () => {
  it('is empty without data', () => {
    expect(rangeStats(makeData(), MONDAY, TODAY)).toEqual({
      entries: 0,
      trainings: 0,
      avgKcal: null,
      weightChange: null,
      chestChange: null,
      waistChange: null,
      hipsChange: null,
    });
  });

  it('summarises days, weigh-ins and partial measurements in [from, today]', () => {
    const data = makeData({
      days: {
        '2026-10-04': day({ kcal: 2000, trained: true, types: ['Кардіо'] }),
        '2026-10-05': day({ kcal: 1500, trained: true, types: ['Кардіо'] }),
        '2026-10-06': day({ food: 'Суп', trained: false }),
        '2026-10-07': day({ food: 'Каша', kcal: 1700 }),
        '2026-10-09': day({ kcal: 1600, trained: true }),
        '2026-10-10': day({ kcal: 3000, trained: true }),
      },
      weights: [w('2026-09-28', 69), w('2026-10-05', 68.6), w('2026-10-09', 68.2)],
      measures: [
        m('2026-09-28', 93, 75, null),
        m('2026-10-05', null, 74, 100),
        m('2026-10-08', null, 73.5, 99.5),
      ],
    });
    const s = rangeStats(data, MONDAY, TODAY);
    expect(s.entries).toBe(4);
    expect(s.trainings).toBe(2);
    expect(s.avgKcal).toBe(1600);
    expect(s.weightChange).toBeCloseTo(-0.8);
    expect(s.chestChange).toBeNull();
    expect(s.waistChange).toBeCloseTo(-1.5);
    expect(s.hipsChange).toBeCloseTo(-0.5);
  });

  it('counts kcal 0 in the average but not kcal null', () => {
    const data = makeData({
      days: { [MONDAY]: day({ kcal: 0 }), [TODAY]: day({ kcal: 2000 }), '2026-10-06': day({ notes: 'x' }) },
    });
    expect(rangeStats(data, MONDAY, TODAY).avgKcal).toBe(1000);
  });

  it('exposes single-metric changes', () => {
    const data = makeData({ weights: [w('2026-09-28', 69), w('2026-10-06', 68)] });
    expect(metricChange(data, 'kg', MONDAY, TODAY)).toBe(-1);
    expect(metricChange(data, 'waist', MONDAY, TODAY)).toBeNull();
  });
});

describe('weekSummary', () => {
  const data = makeData({
    days: {
      '2026-10-04': day({ kcal: 2000, trained: true }),
      [MONDAY]: day({ kcal: 1500, trained: true }),
      '2026-10-08': day({ kcal: 1700, trained: false }),
      [SUNDAY]: day({ kcal: 1900, trained: true }),
    },
    weights: [w('2026-09-28', 69), w(MONDAY, 68.5)],
    measures: [m('2026-09-28', null, 75, null)],
  });

  it('covers Monday … today with the planned workouts count', () => {
    const s = weekSummary(data, TODAY);
    expect(s.trainings).toBe(1);
    expect(s.avgKcal).toBe(1600);
    expect(s.weightChange).toBeCloseTo(-0.5);
    expect(s.waistChange).toBeNull();
    expect(s.plannedPerWeek).toBe(3);
  });

  it('on Monday covers only Monday, on Sunday the whole week', () => {
    expect(weekSummary(data, MONDAY).trainings).toBe(1);
    expect(weekSummary(data, MONDAY).avgKcal).toBe(1500);
    expect(weekSummary(data, SUNDAY).trainings).toBe(2);
    expect(weekSummary(data, SUNDAY).avgKcal).toBe(1700);
  });

  it('reflects custom workout days', () => {
    const custom = makeData({
      settings: { rem: { ...emptyData().settings.rem, workout: { on: true, days: [], time: '18:00' } } },
    });
    expect(weekSummary(custom, TODAY).plannedPerWeek).toBe(0);
  });
});

describe('seriesInRange', () => {
  const weights = [
    w('2026-08-03', 72),
    w('2026-08-10', 71.5),
    w('2026-08-17', 71),
    w('2026-08-24', 70.6),
    w('2026-08-31', 70.2),
    w('2026-09-07', 69.9),
  ];
  const data = makeData({ weights });

  it('is empty without readings', () => {
    expect(seriesInRange(makeData(), 'kg', MONDAY)).toEqual([]);
  });

  it('returns the readings from `from` on when there are at least 4', () => {
    expect(seriesInRange(data, 'kg', '2026-08-10').map((p) => p.date)).toEqual([
      '2026-08-10',
      '2026-08-17',
      '2026-08-24',
      '2026-08-31',
      '2026-09-07',
    ]);
  });

  it('falls back to the last 4 readings overall', () => {
    expect(seriesInRange(data, 'kg', '2026-08-31')).toEqual([
      { date: '2026-08-17', value: 71 },
      { date: '2026-08-24', value: 70.6 },
      { date: '2026-08-31', value: 70.2 },
      { date: '2026-09-07', value: 69.9 },
    ]);
    expect(seriesInRange(data, 'kg', TODAY)).toHaveLength(4);
  });

  it('returns everything when there are fewer than 4 readings', () => {
    expect(seriesInRange(makeData({ weights: weights.slice(0, 2) }), 'kg', TODAY)).toHaveLength(2);
  });

  it('skips measurement entries without that parameter', () => {
    const measures = [
      m('2026-09-01', 93, 75, null),
      m('2026-09-08', null, 74, 101),
      m('2026-09-15', 92, null, 100),
    ];
    expect(seriesInRange(makeData({ measures }), 'hips', '2026-01-01')).toEqual([
      { date: '2026-09-08', value: 101 },
      { date: '2026-09-15', value: 100 },
    ]);
    expect(seriesInRange(makeData({ measures }), 'waist', '2026-01-01').map((p) => p.value)).toEqual([
      75, 74,
    ]);
  });
});

describe('chartGeometry', () => {
  it('is empty without points', () => {
    expect(chartGeometry([])).toEqual({
      viewBox: '0 0 320 120',
      line: '',
      area: '',
      dots: [],
      tag: null,
      from: '',
      to: '',
    });
  });

  it('centres a single point', () => {
    const g = chartGeometry([{ date: '2026-10-05', value: 65.4 }]);
    expect(g.line).toBe('M160.0 60.0');
    expect(g.area).toBe('M160.0 60.0 L160.0 120 L160.0 120 Z');
    expect(g.dots).toEqual([{ date: '2026-10-05', value: 65.4, leftPct: 50, topPct: 50, size: 12 }]);
    expect(g.tag).toEqual({ leftPct: 50, topPct: 50, text: '65,4' });
    expect(g.from).toBe('05.10');
    expect(g.to).toBe('05.10');
  });

  it('maps two points with insets and 18% padding', () => {
    const g = chartGeometry(pts(70, 68));
    expect(g.line).toBe('M6.0 23.2 L314.0 96.8');
    expect(g.area).toBe('M6.0 23.2 L314.0 96.8 L314.0 120 L6.0 120 Z');
    expect(g.dots).toHaveLength(2);
    expect(g.dots[0]?.leftPct).toBeCloseTo(1.875);
    expect(g.dots[0]?.topPct).toBeCloseTo((23.2353 / 120) * 100, 2);
    expect(g.dots[0]?.size).toBe(7);
    expect(g.dots[1]?.leftPct).toBeCloseTo(98.125);
    expect(g.dots[1]?.topPct).toBeCloseTo((96.7647 / 120) * 100, 2);
    expect(g.dots[1]?.size).toBe(12);
    expect(g.tag?.text).toBe('68');
    expect(g.tag?.leftPct).toBeCloseTo(98.125);
    expect(g.from).toBe('01.09');
    expect(g.to).toBe('02.09');
  });

  it('spaces points evenly', () => {
    expect(chartGeometry(pts(3, 2, 1)).line).toMatch(/^M6\.0 \S+ L160\.0 \S+ L314\.0 \S+$/);
  });

  it('expands a flat line to a span of 1', () => {
    expect(chartGeometry(pts(65, 65, 65)).line).toBe('M6.0 60.0 L160.0 60.0 L314.0 60.0');
    // Span 0.5 → ±0.5 → 1.5, then padding.
    expect(chartGeometry(pts(65, 65.5)).line).toBe('M6.0 72.3 L314.0 47.7');
    // A span of exactly 1 is not expanded (same shape as 70 → 68).
    expect(chartGeometry(pts(66, 65)).line).toBe('M6.0 23.2 L314.0 96.8');
  });

  it('supports a custom height', () => {
    const g = chartGeometry([{ date: '2026-10-05', value: 65 }], 150);
    expect(g.viewBox).toBe('0 0 320 150');
    expect(g.line).toBe('M160.0 75.0');
    expect(g.area).toBe('M160.0 75.0 L160.0 150 L160.0 150 Z');
    expect(g.dots[0]?.topPct).toBe(50);
  });

  it('hides all but the last dot above 16 points', () => {
    const sixteen = chartGeometry(pts(...Array.from({ length: 16 }, (_, i) => 70 - i * 0.1)));
    expect(sixteen.dots.map((d) => d.size)).toEqual([...Array<number>(15).fill(7), 12]);
    const seventeen = chartGeometry(pts(...Array.from({ length: 17 }, (_, i) => 70 - i * 0.1)));
    expect(seventeen.dots.map((d) => d.size)).toEqual([...Array<number>(16).fill(0), 12]);
  });

  it('formats the tag with up to one decimal', () => {
    expect(chartGeometry(pts(70, 65.25)).tag?.text).toBe('65,3');
  });
});

describe('workoutStats', () => {
  it('is zero without data', () => {
    expect(workoutStats(makeData(), TODAY)).toEqual({
      total: 0,
      thisWeek: 0,
      thisMonth: 0,
      avgPerWeek: 0,
      plannedPerWeek: 3,
    });
  });

  const days = {
    '2026-09-11': day({ trained: true, types: ['Кардіо'] }),
    '2026-09-30': day({ trained: true }),
    '2026-10-01': day({ trained: true }),
    [MONDAY]: day({ trained: true }),
    '2026-10-06': day({ trained: false }),
    '2026-10-07': day({ kcal: 1500 }),
    [TODAY]: day({ trained: true }),
  };

  it('counts only trained === true', () => {
    expect(workoutStats(makeData({ days }), TODAY)).toEqual({
      total: 5,
      thisWeek: 2,
      thisMonth: 3,
      avgPerWeek: 1.25, // 5 workouts over 28 days since the first record
      plannedPerWeek: 3,
    });
  });

  it('measures the average from the earliest record of any kind', () => {
    const s = workoutStats(makeData({ days, weights: [w('2026-08-14', 70)] }), TODAY);
    expect(s.avgPerWeek).toBeCloseTo(5 / (56 / 7));
  });

  it('uses at least one week for the average', () => {
    expect(workoutStats(makeData({ days: { [TODAY]: day({ trained: true }) } }), TODAY).avgPerWeek).toBe(1);
    const recent = { '2026-10-07': day({ trained: true }), [TODAY]: day({ trained: true }) };
    expect(workoutStats(makeData({ days: recent }), TODAY).avgPerWeek).toBe(2);
  });

  it('this week on Monday and on Sunday', () => {
    const week = { ...days, [SUNDAY]: day({ trained: true }) };
    expect(workoutStats(makeData({ days: week }), MONDAY).thisWeek).toBe(1);
    expect(workoutStats(makeData({ days: week }), SUNDAY).thisWeek).toBe(3);
  });

  it('this month is the calendar month, the week may span two months', () => {
    const s = workoutStats(
      makeData({ days: { ...days, '2026-11-01': day({ trained: true }) } }),
      '2026-11-01',
    );
    expect(s.thisMonth).toBe(1);
    expect(s.thisWeek).toBe(1); // Monday 2026-10-26 … Sunday 2026-11-01
  });
});

describe('typeRanking', () => {
  it('is empty without workouts', () => {
    expect(typeRanking(makeData(), MONDAY, TODAY)).toEqual([]);
    expect(typeRanking(makeData({ days: { [TODAY]: day({ trained: true }) } }), MONDAY, TODAY)).toEqual([]);
  });

  it('ranks types of trained days in range, relative to the top one', () => {
    const data = makeData({
      days: {
        '2026-10-04': day({ trained: true, types: ['Прес', 'Прес'] }),
        [MONDAY]: day({ trained: true, types: ['Кардіо', 'Прес'] }),
        '2026-10-06': day({ trained: true, types: ['Кардіо'] }),
        '2026-10-07': day({ trained: false, types: ['Верх тіла'] }),
        '2026-10-08': day({ trained: true, types: ['Кардіо', 'Верх тіла', 'Прес'] }),
        [TODAY]: day({ trained: null, types: ['Кардіо'] }),
        '2026-10-10': day({ trained: true, types: ['Низ тіла'] }),
      },
    });
    const r = typeRanking(data, MONDAY, TODAY);
    expect(r.map(({ label, n }) => [label, n])).toEqual([
      ['Кардіо', 3],
      ['Прес', 2],
      ['Верх тіла', 1],
    ]);
    expect(r[0]?.pct).toBe(100);
    expect(r[1]?.pct).toBeCloseTo(66.667, 2);
    expect(r[2]?.pct).toBeCloseTo(33.333, 2);
  });

  it('breaks ties by first appearance, regardless of object order or numeric names', () => {
    const days: Record<ISODate, DayEntry> = {};
    days['2026-10-08'] = day({ trained: true, types: ['10', 'Прес'] });
    days['2026-10-06'] = day({ trained: true, types: ['Кардіо'] });
    days['2026-10-07'] = day({ trained: true, types: ['Прес'] });
    const r = typeRanking(makeData({ days }), MONDAY, TODAY);
    expect(r.map((t) => t.label)).toEqual(['Прес', 'Кардіо', '10']);
    expect(r.map((t) => t.pct)).toEqual([100, 50, 50]);
  });
});

describe('kcalBars', () => {
  const goalMax = 1700 * 1.25;

  it('week: 7 labelled daily bars Mon…Sun, including days after today', () => {
    const data = makeData({
      days: {
        '2026-10-04': day({ kcal: 5000 }),
        [MONDAY]: day({ kcal: 1500 }),
        '2026-10-06': day({ food: 'Суп' }),
        '2026-10-07': day({ kcal: 2000 }),
        [TODAY]: day({ kcal: 0 }),
        [SUNDAY]: day({ kcal: 1800 }),
      },
    });
    const k = kcalBars(data, 'week', TODAY);
    expect(k.bars.map((b) => b.date)).toEqual([
      MONDAY,
      '2026-10-06',
      '2026-10-07',
      '2026-10-08',
      TODAY,
      '2026-10-10',
      SUNDAY,
    ]);
    expect(k.bars.map((b) => b.label)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']);
    expect(k.bars.map((b) => b.value)).toEqual([1500, null, 2000, null, 0, null, 1800]);
    expect(k.bars.map((b) => b.heightPct)).toEqual([70.6, 3, 94.1, 3, 3, 3, 84.7]);
    expect(k.bars.map((b) => b.tone)).toEqual(['ok', 'empty', 'over', 'empty', 'ok', 'empty', 'over']);
    expect(k.max).toBe(goalMax);
    expect(k.goalPct).toBeCloseTo(80);
    expect(k.labeled).toBe(true);
    expect(k.note).toBe('');
    expect(k.gap).toBe('8px');
  });

  it('a value above goal × 1.25 sets the scale', () => {
    const k = kcalBars(makeData({ days: { [TODAY]: day({ kcal: 3400 }) } }), 'week', TODAY);
    expect(k.max).toBe(3400);
    expect(k.goalPct).toBe(50);
    expect(k.bars[4]?.heightPct).toBe(100);
  });

  it('a value exactly at the goal is within the goal', () => {
    expect(kcalTone(1700, 1700)).toBe('ok');
    expect(kcalTone(1701, 1700)).toBe('over');
    expect(kcalTone(null, 1700)).toBe('empty');
  });

  it('month: 30 unlabelled daily bars ending today', () => {
    const data = makeData({ days: { '2026-09-09': day({ kcal: 1000 }), '2026-09-10': day({ kcal: 1200 }) } });
    const k = kcalBars(data, 'month', TODAY);
    expect(k.bars).toHaveLength(30);
    expect(k.bars[0]).toMatchObject({ date: '2026-09-10', value: 1200, label: '' });
    expect(k.bars.at(-1)?.date).toBe(TODAY);
    expect(k.labeled).toBe(false);
    expect(k.note).toBe('');
    expect(k.gap).toBe('3px');
  });

  it('3 months: weekly averages from the Monday on or before the period start', () => {
    const data = makeData({
      days: {
        '2026-07-06': day({ kcal: 1000 }), // before the period (starts Sun 2026-07-12) but in its first week
        '2026-07-05': day({ kcal: 9000 }), // the week before: ignored
        '2026-10-01': day({ kcal: 2000 }),
        [MONDAY]: day({ kcal: 1600 }),
        '2026-10-06': day({ kcal: 1800, trained: true }),
        '2026-10-07': day({ food: 'Суп' }),
      },
    });
    const k = kcalBars(data, 'q', TODAY);
    expect(k.bars).toHaveLength(14);
    expect(k.bars[0]).toMatchObject({ date: '2026-07-06', value: 1000, tone: 'ok', label: '' });
    expect(k.bars.every((b) => weekdayOf(b.date) === 1)).toBe(true);
    expect(k.bars.at(-2)).toMatchObject({ date: '2026-09-28', value: 2000, tone: 'over' });
    expect(k.bars.at(-1)).toMatchObject({ date: MONDAY, value: 1700, tone: 'ok' });
    expect(k.bars[1]).toMatchObject({ value: null, tone: 'empty', heightPct: 3 });
    expect(k.note).toBe('· середнє за тиждень');
    expect(k.gap).toBe('3px');
    expect(k.labeled).toBe(false);
  });

  it('all time starts at the week of the first record', () => {
    const k = kcalBars(makeData({ days: { '2026-09-02': day({ kcal: 1500 }) } }), 'all', TODAY);
    expect(k.bars[0]?.date).toBe('2026-08-31');
    expect(k.bars).toHaveLength(6);
    expect(k.note).toBe('· середнє за тиждень');
  });

  it('all time without data is a single empty bar for this week', () => {
    const k = kcalBars(makeData(), 'all', TODAY);
    expect(k.bars).toEqual([{ date: MONDAY, value: null, heightPct: 3, tone: 'empty', label: '' }]);
    expect(k.max).toBe(goalMax);
    expect(k.goalPct).toBeCloseTo(80);
  });
});

describe('kcalAverages', () => {
  const data = makeData({
    days: {
      '2026-09-20': day({ kcal: 1000 }),
      '2026-10-01': day({ kcal: 1500 }),
      '2026-10-06': day({ kcal: 1700 }),
      '2026-10-07': day({ food: 'Суп' }),
      '2026-10-08': day({ kcal: 1900 }),
    },
  });

  it('week, calendar month and the selected period', () => {
    expect(kcalAverages(data, TODAY, 'month')).toEqual({ week: 1800, month: 1700, period: 1525 });
    expect(kcalAverages(data, TODAY, 'week').period).toBe(1800);
    expect(kcalAverages(data, TODAY, 'all').period).toBe(1525);
  });

  it('on the 1st the month is today only', () => {
    expect(kcalAverages(data, '2026-10-01', 'week').month).toBe(1500);
  });

  it('is null without kcal', () => {
    expect(kcalAverages(makeData(), TODAY, 'q')).toEqual({ week: null, month: null, period: null });
  });
});

describe('kcalHistory', () => {
  const data = makeData({
    days: {
      '2026-09-01': day({ kcal: 4250 }),
      '2026-10-01': day({ kcal: 1500 }),
      '2026-10-03': day({ food: 'Суп' }),
      [MONDAY]: day({ kcal: 0 }),
      '2026-10-06': day({ kcal: 2125 }),
    },
  });

  it('lists days with kcal newest first on the given scale', () => {
    const h = kcalHistory(data, 7, kcalBars(data, 'week', TODAY).max);
    expect(h.total).toBe(4);
    expect(h.items).toEqual([
      { date: '2026-10-06', kcal: 2125, pct: 100, tone: 'over' },
      { date: MONDAY, kcal: 0, pct: 0, tone: 'ok' },
      { date: '2026-10-01', kcal: 1500, pct: (1500 / 2125) * 100, tone: 'ok' },
      { date: '2026-09-01', kcal: 4250, pct: 100, tone: 'over' }, // capped
    ]);
  });

  it('follows the period scale', () => {
    const max = kcalBars(data, 'q', TODAY).max;
    expect(max).toBe(4250);
    expect(kcalHistory(data, 1, max).items[0]?.pct).toBe(50);
  });

  it('respects the limit', () => {
    expect(kcalHistory(data, 2, 2125).items.map((i) => i.date)).toEqual(['2026-10-06', MONDAY]);
    expect(kcalHistory(data, 0, 2125)).toEqual({ items: [], total: 4 });
    expect(kcalHistory(data, -1, 2125).items).toEqual([]);
  });

  it('guards a zero scale', () => {
    expect(kcalHistory(data, 1, 0).items[0]?.pct).toBe(0);
  });
});

describe('dayStatus', () => {
  const data = makeData({
    days: {
      '2026-10-01': day({ food: 'Каша', kcal: 1500, trained: false }),
      '2026-10-02': day({ food: 'Каша', kcal: 0, trained: true, types: ['Прес'] }),
      '2026-10-03': day({ food: 'Каша', kcal: 1500 }),
      '2026-10-04': day({ notes: 'Відпочинок' }),
      '2026-10-05': day({ kcal: 1500, trained: true }),
      '2026-10-06': day({ food: '   ', kcal: 1500, trained: true }),
    },
  });

  it('full needs food, kcal and a yes/no workout mark', () => {
    expect(dayStatus(data, '2026-10-01')).toEqual({ status: 'full', label: 'Заповнено' });
    expect(dayStatus(data, '2026-10-02').status).toBe('full');
  });

  it('partial for any other recorded day', () => {
    expect(dayStatus(data, '2026-10-03')).toEqual({ status: 'partial', label: 'Частково' });
    expect(dayStatus(data, '2026-10-04').status).toBe('partial');
    expect(dayStatus(data, '2026-10-05').status).toBe('partial');
    expect(dayStatus(data, '2026-10-06').status).toBe('partial');
  });

  it('empty without a record', () => {
    expect(dayStatus(data, '2026-10-07')).toEqual({ status: 'empty', label: 'Порожньо' });
    expect(DAY_STATUS_LABELS).toEqual({ full: 'Заповнено', partial: 'Частково', empty: 'Порожньо' });
  });
});

describe('calendarMonth', () => {
  const data = makeData({
    days: {
      '2026-10-01': day({ kcal: 1500 }),
      '2026-10-02': day({ food: 'Каша' }),
      '2026-10-03': day({ food: 'Каша', kcal: 1500, trained: true, types: ['Кардіо'] }),
      '2026-10-04': day({ trained: false }),
      '2026-10-05': day({ notes: 'Нотатка' }),
    },
    weights: [w('2026-10-06', 68)],
    measures: [m('2026-10-07', null, 74, null)],
  });
  const cell = (cells: (CalendarCell | null)[], date: ISODate): CalendarCell | undefined =>
    cells.find((c): c is CalendarCell => c?.date === date);

  it('builds a Monday-first grid with leading blanks', () => {
    const cal = calendarMonth(data, 2026, 9, TODAY, '2026-10-03');
    expect(cal.title).toBe('Жовтень 2026');
    expect(cal.weekdays).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']);
    // 1 October 2026 is a Thursday.
    expect(cal.cells.slice(0, 3)).toEqual([null, null, null]);
    expect(cal.cells).toHaveLength(3 + 31);
    expect(cal.cells[3]?.date).toBe('2026-10-01');
    expect(cal.cells.at(-1)?.day).toBe(31);
  });

  it('marks food, workouts, weigh-ins and the day state', () => {
    const { cells } = calendarMonth(data, 2026, 9, TODAY, '2026-10-03');
    expect(cell(cells, '2026-10-01')).toMatchObject({ hasEntry: true, food: true, trained: false });
    expect(cell(cells, '2026-10-02')).toMatchObject({ food: true, trained: false });
    expect(cell(cells, '2026-10-03')).toMatchObject({ food: true, trained: true, isSelected: true });
    expect(cell(cells, '2026-10-04')).toMatchObject({ hasEntry: true, food: false, trained: false });
    expect(cell(cells, '2026-10-05')).toMatchObject({ hasEntry: true, food: false, weighOrMeasure: false });
    expect(cell(cells, '2026-10-06')).toMatchObject({ hasEntry: false, weighOrMeasure: true });
    expect(cell(cells, '2026-10-07')?.weighOrMeasure).toBe(true);
    expect(cell(cells, TODAY)).toEqual({
      date: TODAY,
      day: 9,
      hasEntry: false,
      food: false,
      trained: false,
      weighOrMeasure: false,
      isToday: true,
      isFuture: false,
      isSelected: false,
    });
    expect(cell(cells, '2026-10-10')).toMatchObject({ isToday: false, isFuture: true });
    expect(cell(cells, '2026-10-08')?.isFuture).toBe(false);
  });

  it('handles months starting on Sunday and Monday, and leap years', () => {
    const feb = calendarMonth(data, 2026, 1, TODAY, TODAY);
    expect(feb.cells.filter((c) => c === null)).toHaveLength(6);
    expect(feb.cells.filter((c) => c !== null)).toHaveLength(28);
    const june = calendarMonth(data, 2026, 5, TODAY, TODAY);
    expect(june.cells[0]?.date).toBe('2026-06-01');
    expect(calendarMonth(data, 2028, 1, TODAY, TODAY).cells.at(-1)?.date).toBe('2028-02-29');
  });

  it('normalises the month and knows whether next is allowed', () => {
    expect(calendarMonth(data, 2026, 12, TODAY, TODAY)).toMatchObject({
      year: 2027,
      month0: 0,
      title: 'Січень 2027',
    });
    expect(calendarMonth(data, 2026, -1, TODAY, TODAY)).toMatchObject({
      year: 2025,
      month0: 11,
      title: 'Грудень 2025',
    });
    expect(calendarMonth(data, 2026, 9, TODAY, TODAY)).toMatchObject({
      isCurrentMonth: true,
      canGoNext: false,
    });
    expect(calendarMonth(data, 2026, 8, TODAY, TODAY)).toMatchObject({
      isCurrentMonth: false,
      canGoNext: true,
    });
    expect(calendarMonth(data, 2025, 11, TODAY, TODAY).canGoNext).toBe(true);
    expect(calendarMonth(data, 2026, 10, TODAY, TODAY)).toMatchObject({
      isCurrentMonth: false,
      canGoNext: false,
    });
  });

  it('shifts months across years', () => {
    expect(shiftMonth(2026, 11, 1)).toEqual({ year: 2027, month0: 0 });
    expect(shiftMonth(2026, 0, -1)).toEqual({ year: 2025, month0: 11 });
    expect(shiftMonth(2026, 5)).toEqual({ year: 2026, month0: 5 });
  });
});

describe('recentDays and daysInRange', () => {
  const days: Record<ISODate, DayEntry> = {};
  for (let i = 0; i < 10; i++) days[addDays('2026-09-01', i * 3)] = day({ kcal: 1500 + i });
  const data = makeData({ days });

  it('lists the newest records first, 8 by default', () => {
    const r = recentDays(data);
    expect(r).toHaveLength(8);
    expect(r[0]).toEqual({ date: '2026-09-28', entry: day({ kcal: 1509 }) });
    expect(r.at(-1)?.date).toBe('2026-09-07');
    expect(recentDays(data, 2).map((d) => d.date)).toEqual(['2026-09-28', '2026-09-25']);
    expect(recentDays(makeData())).toEqual([]);
  });

  it('returns days in range oldest first regardless of insertion order', () => {
    const unordered = makeData({
      days: {
        '2026-10-08': day({ kcal: 1 }),
        '2026-10-06': day({ kcal: 2 }),
        '2026-10-01': day({ kcal: 3 }),
      },
    });
    expect(daysInRange(unordered, MONDAY, TODAY).map((d) => d.date)).toEqual(['2026-10-06', '2026-10-08']);
  });
});

describe('next reminder', () => {
  const rem = (weekday: number, on = true): WeeklyReminder => ({
    on,
    day: weekday as Weekday,
    time: '08:00',
  });

  it('is off when disabled', () => {
    expect(nextReminderLabel(rem(5, false), false, TODAY)).toEqual({
      date: null,
      label: 'вимкнено',
      time: null,
      text: 'вимкнено',
    });
  });

  it('today counts unless already done', () => {
    expect(nextReminderLabel(rem(5), false, TODAY)).toEqual({
      date: TODAY,
      label: 'Сьогодні',
      time: '08:00',
      text: 'Сьогодні · 08:00',
    });
    expect(nextReminderLabel(rem(5), true, TODAY)).toMatchObject({
      date: '2026-10-16',
      label: 'Пт, 16 жовтня',
      text: 'Пт, 16 жовтня · 08:00',
    });
  });

  it('tomorrow and later weekdays', () => {
    expect(nextReminderLabel(rem(6), true, TODAY)).toMatchObject({ date: '2026-10-10', label: 'Завтра' });
    expect(nextReminderLabel(rem(1), false, TODAY)).toMatchObject({
      date: '2026-10-12',
      label: 'Пн, 12 жовтня',
    });
    expect(nextReminderLabel(rem(4), false, TODAY)).toMatchObject({
      date: '2026-10-15',
      label: 'Чт, 15 жовтня',
    });
  });

  it('crosses month boundaries and handles Sunday as today', () => {
    expect(nextReminderLabel(rem(1), false, '2026-10-30').label).toBe('Пн, 2 листопада');
    expect(nextReminderLabel(rem(0), false, SUNDAY).label).toBe('Сьогодні');
    expect(nextReminderLabel(rem(1), false, SUNDAY).label).toBe('Завтра');
  });

  it('falls back for an invalid weekday', () => {
    expect(nextReminderLabel(rem(9), false, TODAY)).toMatchObject({ date: null, label: '—' });
  });

  it('skips today once the weigh-in / measurements are recorded', () => {
    const settings = emptyData().settings; // weigh Mon 08:00, measure Mon 08:30
    const data = makeData({ weights: [w(MONDAY, 68)], settings });
    expect(nextWeighIn(data, MONDAY)).toMatchObject({
      label: 'Пн, 12 жовтня',
      text: 'Пн, 12 жовтня · 08:00',
    });
    expect(nextMeasurements(data, MONDAY)).toMatchObject({ label: 'Сьогодні', text: 'Сьогодні · 08:30' });
    const measured = makeData({ measures: [m(MONDAY, null, 74, null)] });
    expect(nextMeasurements(measured, MONDAY).label).toBe('Пн, 12 жовтня');
  });
});

describe('dueReminders', () => {
  it('lists today’s reminders that are not done, in banner order', () => {
    expect(dueReminders(makeData(), MONDAY)).toEqual(['weigh', 'measure', 'workout']);
    expect(dueReminders(makeData(), '2026-10-06')).toEqual([]);
    expect(dueReminders(makeData(), '2026-10-07')).toEqual(['workout']);
  });

  it('drops reminders once done (a «no» workout mark counts)', () => {
    const done = makeData({
      days: { [MONDAY]: day({ trained: false }) },
      weights: [w(MONDAY, 68)],
      measures: [m(MONDAY, 93, null, null)],
    });
    expect(dueReminders(done, MONDAY)).toEqual([]);
    expect(dueReminders(makeData({ days: { [MONDAY]: day({ trained: true }) } }), MONDAY)).toEqual([
      'weigh',
      'measure',
    ]);
    expect(dueReminders(makeData({ days: { [MONDAY]: day({ food: 'Каша' }) } }), MONDAY)).toContain(
      'workout',
    );
  });

  it('ignores reminders that are off', () => {
    const base = emptyData().settings.rem;
    const off = makeData({
      settings: {
        rem: {
          workout: { ...base.workout, on: false },
          weigh: { ...base.weigh, on: false },
          measure: { ...base.measure, on: false },
        },
      },
    });
    expect(dueReminders(off, MONDAY)).toEqual([]);
  });
});

describe('across DST changes (Europe/Kyiv)', () => {
  // Node re-reads TZ when it is assigned, so local `Date`s below really cross clock changes.
  beforeAll(() => {
    vi.stubEnv('TZ', 'Europe/Kyiv');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  const consecutive = (dates: ISODate[]): boolean =>
    dates.every((d, i) => i === 0 || diffDays(dates[i - 1] ?? d, d) === 1);

  it('really runs in a zone with DST', () => {
    expect(new Date(2026, 9, 24).getTimezoneOffset()).not.toBe(new Date(2026, 9, 26).getTimezoneOffset());
  });

  it('period starts land on the right calendar days', () => {
    expect(periodStart(makeData(), 'month', '2026-11-10')).toBe('2026-10-12');
    expect(periodStart(makeData(), 'q', '2026-04-15')).toBe('2026-01-16');
    expect(periodStart(makeData(), 'week', '2026-10-25')).toBe('2026-10-19');
    expect(periodStart(makeData(), 'week', '2026-03-29')).toBe('2026-03-23');
  });

  it('daily bars are consecutive and weekly bars are Mondays', () => {
    const month = kcalBars(makeData(), 'month', '2026-11-10').bars.map((b) => b.date);
    expect(month).toHaveLength(30);
    expect(consecutive(month)).toBe(true);
    expect(month[0]).toBe('2026-10-12');
    expect(
      kcalBars(makeData(), 'week', '2026-10-25')
        .bars.map((b) => b.date)
        .at(-1),
    ).toBe('2026-10-25');
    const weeks = kcalBars(makeData(), 'q', '2026-04-15').bars.map((b) => b.date);
    expect(weeks.every((d) => weekdayOf(d) === 1)).toBe(true);
    expect(weeks[0]).toBe('2026-01-12');
    expect(weeks.at(-1)).toBe('2026-04-13');
  });

  it('the weekly workout average counts calendar days', () => {
    const data = makeData({
      days: { '2026-03-02': day({ trained: true }), '2026-03-30': day({ trained: true }) },
    });
    expect(workoutStats(data, '2026-03-30').avgPerWeek).toBe(0.5);
  });

  it('calendar months list every day once', () => {
    for (const month0 of [2, 9]) {
      const dates = calendarMonth(makeData(), 2026, month0, TODAY, TODAY)
        .cells.filter((c): c is CalendarCell => c !== null)
        .map((c) => c.date);
      expect(dates).toHaveLength(31);
      expect(consecutive(dates)).toBe(true);
    }
  });

  it('next reminder across the clock change', () => {
    expect(nextReminderLabel({ on: true, day: 1, time: '08:00' }, false, '2026-10-24')).toMatchObject({
      date: '2026-10-26',
      label: 'Пн, 26 жовтня',
    });
  });
});
