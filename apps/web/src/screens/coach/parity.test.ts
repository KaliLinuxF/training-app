/**
 * Parity (docs/coach-cabinet.md C5): the coach's numbers (shared `coachSummary`) equal what the client's own Progress
 * computes with `lib/stats` on the same data — weight progress, the change of the week / of 30 days, workouts of the
 * week, the kcal / Б · Ж · В averages over the same full-day window, and (docs/workouts-steps-rebrand.md §1.7) the
 * steps over the same full days (shared `stepsStats`) and the done sessions / their kcal of the workouts range.
 */
import {
  addDays,
  clientToday,
  coachItemFromData,
  coachSummary,
  coachWindow,
  mondayOf,
  stepsStats,
  type AppData,
  type CoachClient,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  averageKcal,
  doneSessionsIn,
  macroAverages,
  rangeStats,
  sessionsKcalIn,
  weightSummary,
  workoutStats,
} from '@/lib/stats';
import { progressData, TODAY } from '../progress/progress.fixtures';
import { NOW as COACH_NOW, TODAY as COACH_TODAY, training } from './coach.fixtures';

/** Noon in Kyiv on the fixtures' today (Friday 2026-10-09). */
const NOW = new Date(`${TODAY}T09:00:00Z`);
const CLIENT: CoachClient = {
  id: 'c0ac0000000000000000000000000001',
  username: 'olya',
  status: 'active',
  createdAt: NOW.getTime() - 90 * 86_400_000,
  lastSeenAt: NOW.getTime(),
};

function kyiv(data: AppData): AppData {
  return { ...data, settings: { ...data.settings, timezone: 'Europe/Kyiv' } };
}

describe('coachSummary ≡ lib/stats on the progress fixtures', () => {
  const data = kyiv(progressData());
  const item = coachItemFromData(CLIENT, data, coachWindow(NOW));
  const week = coachSummary(item, NOW, 7);
  const month = coachSummary(item, NOW, 30);

  it('sees the same today', () => {
    expect(clientToday(data.settings.timezone, NOW)).toBe(TODAY);
    expect(week.today).toBe(TODAY);
  });

  it('weight: progress to the goal and the change since the start (weightSummary)', () => {
    const ws = weightSummary(data);
    expect(week.weight.goalPct).toBeCloseTo(ws.pct, 10);
    expect(week.weight.sinceStart).toBeCloseTo(-(ws.lost ?? 0), 10);
    expect(week.weight.current).toBe(ws.last?.kg);
    expect(week.weight.left).toBeCloseTo(ws.left ?? 0, 10);
  });

  it('weight change of Monday … today and of the last 30 days (valueChange via rangeStats)', () => {
    expect(week.weight.change).toBe(rangeStats(data, mondayOf(TODAY), TODAY).weightChange);
    expect(month.weight.change).toBe(rangeStats(data, addDays(TODAY, -29), TODAY).weightChange);
    expect(week.weight.change).not.toBeNull();
  });

  it('workouts of this week (workoutStats.thisWeek)', () => {
    expect(week.workouts.done).toBe(workoutStats(data, TODAY).thisWeek);
    expect(week.workouts.planned).toBe(workoutStats(data, TODAY).plannedPerWeek);
  });

  it('kcal and Б · Ж · В averages over the same full days (averageKcal, macroAverages)', () => {
    for (const [summary, p] of [
      [week, 7],
      [month, 30],
    ] as const) {
      const from = addDays(TODAY, -p);
      const to = addDays(TODAY, -1);
      expect(summary.kcal.avg).toBe(averageKcal(data, from, to));
      const macros = macroAverages(data, from, to);
      expect(summary.macros.avg).toEqual({ protein: macros.protein, fat: macros.fat, carbs: macros.carbs });
      expect(summary.macros.days).toBe(macros.days);
    }
    expect(week.macros.days).toBeGreaterThan(0);
  });
});

describe('coachSummary ≡ shared stepsStats and lib/stats sessions on the training fixture', () => {
  const data = training();
  const item = coachItemFromData(CLIENT, data, coachWindow(COACH_NOW));

  it.each([7, 30] as const)('period %i: the steps of the same full days, the sessions of the same range', (p) => {
    const summary = coachSummary(item, COACH_NOW, p);
    const today = COACH_TODAY;
    const goal = data.settings.stepsGoal;
    const steps = stepsStats(data.steps, addDays(today, -p), addDays(today, -1), goal);
    expect(summary.steps).toEqual({ ...steps, goal });
    expect(summary.steps.avg).toBe(8300);
    const from = p === 7 ? mondayOf(today) : addDays(today, -29);
    expect(summary.sessions).toEqual({
      count: doneSessionsIn(data, from, today).length,
      kcal: sessionsKcalIn(data, from, today),
    });
  });

  it('counts the goal days only with a goal', () => {
    const summary = coachSummary(item, COACH_NOW, 7);
    // 9 100, 10 500 and 8 300 reach 8 000.
    expect(summary.steps).toMatchObject({ days: 5, goalDays: 3, goal: 8000 });
    const noGoal = { ...data, settings: { ...data.settings, stepsGoal: null } };
    const without = coachSummary(coachItemFromData(CLIENT, noGoal, coachWindow(COACH_NOW)), COACH_NOW, 7);
    expect(without.steps).toMatchObject({ goalDays: 0, goal: null, avg: 8300 });
  });
});
