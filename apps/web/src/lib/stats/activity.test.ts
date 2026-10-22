import { emptyData, stepsStats, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  hasAnySteps,
  stepsChart,
  stepsGoalView,
  stepsKcalOn,
  stepsOn,
  stepsSummary,
  stepsText,
  stepsWord,
} from './activity';
import { periodStart } from './periods';
import {
  doneSessionsIn,
  sessionsKcalIn,
  topExercises,
  workoutBuckets,
  workoutChartBars,
} from './workouts';
import { session, squat, walk } from './workouts.testing';

const TODAY = '2026-10-14'; // Wednesday
const flat = (text: string | undefined) => (text ?? '').replace(/\s/g, ' ');

function data(patch: Partial<AppData> = {}): AppData {
  return { ...emptyData(), ...patch };
}

describe('steps words', () => {
  it('declines «крок»', () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25, 101, 8400].map(stepsWord)).toEqual([
      'крок',
      'кроки',
      'кроки',
      'кроків',
      'кроків',
      'кроків',
      'крок',
      'кроки',
      'кроків',
      'крок',
      'кроків',
    ]);
    expect(flat(stepsText(8400))).toBe('8 400 кроків');
    expect(stepsText(8400)).toContain(' кроків');
  });
});

describe('steps of a day', () => {
  const d = data({ steps: [{ date: TODAY, steps: 8000 }], weights: [{ date: '2026-10-01', kg: 80 }] });

  it('reads the day, its kcal at her weight that day, and whether she ever logged steps', () => {
    expect(stepsOn(d, TODAY)).toBe(8000);
    expect(stepsOn(d, '2026-10-13')).toBeNull();
    // 8 000 × 0,0005 × 80 = 320.
    expect(stepsKcalOn(d, TODAY)).toBe(320);
    expect(stepsKcalOn(d, '2026-10-13')).toBeNull();
    expect(hasAnySteps(d)).toBe(true);
    expect(hasAnySteps(data())).toBe(false);
  });

  it('the goal view: what is left, then reached; nothing without a goal', () => {
    expect(stepsGoalView(8400, null)).toBeNull();
    expect(flat(stepsGoalView(8400, 10000)?.text)).toBe('Ціль 10 000 — ще 1 600');
    expect(stepsGoalView(null, 10000)?.reached).toBe(false);
    expect(stepsGoalView(10000, 10000)).toEqual({ reached: true, text: 'Ціль виконано ✓' });
  });
});

describe('Progress «Кроки»', () => {
  const steps = [
    { date: '2026-10-12', steps: 6000 },
    { date: '2026-10-13', steps: 11000 },
    { date: TODAY, steps: 9000 },
    { date: '2026-09-01', steps: 4000 },
  ];

  it('stepsSummary is the shared stepsStats over the period (same numbers as the coach)', () => {
    const d = data({ steps, settings: { ...emptyData().settings, stepsGoal: 9000 } });
    const sum = stepsSummary(d, 'week', TODAY);
    expect(sum).toMatchObject(stepsStats(steps, periodStart(d, 'week', TODAY), TODAY, 9000));
    expect(sum).toMatchObject({ avg: 8667, days: 3, goalDays: 2, goal: 9000 });
    // 70 kg (no weigh-in): (210 + 385 + 315) / 3 ≈ 303.
    expect(sum.kcalPerDay).toBe(303);
    expect(stepsSummary(data(), 'week', TODAY)).toMatchObject({ avg: null, days: 0, kcalPerDay: null });
  });

  it('week: 7 daily bars Mon…Sun; a goal line and mint bars at the goal only with a goal', () => {
    const plain = stepsChart(data({ steps }), 'week', TODAY);
    expect(plain.bars.map((b) => b.label)).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']);
    expect(plain.bars.map((b) => b.value)).toEqual([6000, 11000, 9000, null, null, null, null]);
    expect(plain.goalPct).toBeNull();
    expect(plain.bars.map((b) => b.tone)).toEqual(['idle', 'idle', 'idle', 'empty', 'empty', 'empty', 'empty']);
    expect(plain.bars[1]?.heightPct).toBe(100);
    expect(plain.labeled).toBe(true);

    const goal = stepsChart(data({ steps, settings: { ...emptyData().settings, stepsGoal: 10000 } }), 'week', TODAY);
    expect(goal.goalPct).toBeCloseTo((10000 / 12500) * 100);
    expect(goal.bars.slice(0, 3).map((b) => b.tone)).toEqual(['idle', 'ok', 'idle']);
  });

  it('month: 30 daily bars; 3 months: weekly averages of the logged days', () => {
    expect(stepsChart(data({ steps }), 'month', TODAY).bars).toHaveLength(30);
    const q = stepsChart(data({ steps }), 'q', TODAY);
    expect(q.weekly).toBe(true);
    expect(q.bars.at(-1)).toMatchObject({ date: '2026-10-12', value: Math.round((6000 + 11000 + 9000) / 3) });
  });
});

describe('Progress «Тренування» sessions', () => {
  const sessions = [
    session({ date: '2026-10-12', exercises: [squat()] }),
    session({ date: TODAY, exercises: [squat(), squat({ key: 'k2' }), walk()] }),
    session({ date: '2026-10-13', exercises: [squat({ skipped: true })] }),
    session({ date: '2026-10-13', status: 'active', exercises: [squat()] }),
  ];

  it('only done sessions count', () => {
    expect(doneSessionsIn(data({ sessions }), '2026-10-12', TODAY)).toHaveLength(3);
  });

  it('week buckets: trained days per day and the volume of the done sessions', () => {
    const d = data({
      sessions,
      days: {
        '2026-10-12': { food: '', kcal: null, trained: true, types: [], notes: '' },
        [TODAY]: { food: '', kcal: null, trained: true, types: [], notes: '' },
      },
    });
    const buckets = workoutBuckets(d, 'week', TODAY);
    expect(buckets.map((b) => b.trainings)).toEqual([1, 0, 1, 0, 0, 0, 0]);
    // 3 × 12 × 40 = 1 440 per squat entry; the skipped one adds nothing.
    expect(buckets.map((b) => b.volume)).toEqual([1440, 0, 2880, 0, 0, 0, 0]);
    const bars = workoutChartBars(buckets, 'volume');
    expect(bars.map((b) => b.tone)).toEqual(['idle', 'empty', 'idle', 'empty', 'empty', 'empty', 'empty']);
    expect(bars[2]?.heightPct).toBe(100);
    expect(bars[0]?.heightPct).toBe(50);
  });

  it('month → weekly buckets from Monday; all → at most 12 months, the latest', () => {
    const d = data({ days: { '2025-01-05': { food: 'x', kcal: null, trained: true, types: [], notes: '' } } });
    expect(workoutBuckets(d, 'month', TODAY)[0]?.from).toBe('2026-09-14');
    const all = workoutBuckets(d, 'all', TODAY);
    expect(all).toHaveLength(12);
    expect(all.at(-1)).toMatchObject({ from: '2026-10-01', to: '2026-10-31' });
    expect(all[0]?.from).toBe('2025-11-01');
  });

  it('kcal of the period sums the done sessions at her weight', () => {
    const d = data({ sessions });
    const total = sessionsKcalIn(d, '2026-10-12', TODAY);
    expect(total).toBeGreaterThan(0);
    expect(sessionsKcalIn(d, '2026-10-15', '2026-10-20')).toBe(0);
  });

  it('top exercises: sessions per exercise (pooled within one), skipped ones left out, current names', () => {
    const top = topExercises(data({ sessions }), '2026-10-12', TODAY, 5);
    expect(top.map((t) => [t.exerciseId, t.n, t.pct])).toEqual([
      ['lib.back-squat', 2, 100],
      ['lib.walk', 1, 50],
    ]);
    // The library's name wins over an old snapshot.
    const renamed = topExercises(
      data({ sessions: [session({ exercises: [squat({ name: 'Старе імʼя' })] })] }),
      TODAY,
      TODAY,
      5,
    );
    expect(renamed[0]?.name).toBe('Присідання зі штангою');
    expect(topExercises(data({ sessions }), '2026-10-12', TODAY, 1)).toHaveLength(1);
  });
});
