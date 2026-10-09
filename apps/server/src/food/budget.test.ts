import { describe, expect, it } from 'vitest';
import { createDataRepo } from '../db/data';
import { getKv, KV, setKv } from '../db/kv';
import { openDatabase } from '../db/open';
import { createFoodBudget, FOOD_BUDGET_TIMEZONE } from './budget';

/** Kyiv is UTC+3 in October 2026 (until the 25th). */
const kyiv = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 9, day, hour - 3, minute);

describe('food budget', () => {
  it('counts per day and persists in kv', () => {
    const db = openDatabase(':memory:');
    const budget = createFoodBudget(db, 2);
    const noon = kyiv(9, 12);
    expect(budget.remaining(noon)).toBe(2);
    expect(budget.tryConsume(noon)).toBe(true);
    expect(budget.tryConsume(noon)).toBe(true);
    expect(budget.tryConsume(noon)).toBe(false);
    expect(budget.remaining(noon)).toBe(0);
    expect(JSON.parse(getKv(db, KV.foodBudget) ?? 'null')).toEqual({ date: '2026-10-09', count: 2 });

    // A restart (new instance on the same database) keeps the count.
    const again = createFoodBudget(db, 2);
    expect(again.remaining(kyiv(9, 23, 59))).toBe(0);
    // A new day starts from zero.
    expect(again.remaining(kyiv(10, 0, 1))).toBe(2);
    expect(again.tryConsume(kyiv(10, 0, 1))).toBe(true);
    expect(again.remaining(kyiv(10, 8))).toBe(1);
  });

  it('runs on Kyiv days whatever settings.timezone says', () => {
    expect(FOOD_BUDGET_TIMEZONE).toBe('Europe/Kyiv');
    const db = openDatabase(':memory:');
    const budget = createFoodBudget(db, 1);
    expect(budget.tryConsume(kyiv(9, 23, 30))).toBe(true);

    // Kiritimati (UTC+14) is already on Oct 10, Pago Pago (UTC−11) still on Oct 9: no fresh budget.
    const data = createDataRepo(db);
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York']) {
      data.setTimezone(zone);
      expect(budget.remaining(kyiv(9, 23, 45)), zone).toBe(0);
      expect(budget.tryConsume(kyiv(9, 23, 45)), zone).toBe(false);
    }
    expect(budget.remaining(kyiv(10, 0, 0))).toBe(1);
  });

  it('reports the seconds until the next Kyiv midnight', () => {
    const budget = createFoodBudget(openDatabase(':memory:'), 1);
    expect(budget.secondsUntilReset(kyiv(9, 12))).toBe(12 * 3600);
    expect(budget.secondsUntilReset(kyiv(9, 23, 59))).toBe(60);
    expect(budget.secondsUntilReset(kyiv(10, 0, 0))).toBe(24 * 3600);
  });

  it('a limit of 0 disables estimates; a corrupt record counts as unused', () => {
    const db = openDatabase(':memory:');
    const noon = kyiv(9, 12);
    expect(createFoodBudget(db, 0).tryConsume(noon)).toBe(false);
    for (const raw of ['not json', '{"date": 5, "count": "x"}', '[]']) {
      setKv(db, KV.foodBudget, raw);
      expect(createFoodBudget(db, 3).remaining(noon)).toBe(3);
    }
  });
});
