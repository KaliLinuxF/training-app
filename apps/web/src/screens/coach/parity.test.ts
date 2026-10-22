/**
 * Parity (docs/coach-cabinet.md C5): the coach's numbers (shared `coachSummary`) equal what the client's own Progress
 * computes with `lib/stats` on the same data — weight progress, the change of the week / of 30 days, workouts of the
 * week, and the kcal / Б · Ж · В averages over the same full-day window.
 */
import {
  addDays,
  clientToday,
  coachItemFromData,
  coachSummary,
  coachWindow,
  mondayOf,
  type AppData,
  type CoachClient,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { averageKcal, macroAverages, rangeStats, weightSummary, workoutStats } from '@/lib/stats';
import { progressData, TODAY } from '../progress/progress.fixtures';

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
