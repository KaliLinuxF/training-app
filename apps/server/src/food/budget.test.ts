import { describe, expect, it } from 'vitest';
import { getKv, KV, setKv } from '../db/kv';
import { openDatabase } from '../db/open';
import { createFoodBudget } from './budget';

describe('food budget', () => {
  it('counts per day and persists in kv', () => {
    const db = openDatabase(':memory:');
    const budget = createFoodBudget(db, 2);
    expect(budget.remaining('2026-10-09')).toBe(2);
    expect(budget.tryConsume('2026-10-09')).toBe(true);
    expect(budget.tryConsume('2026-10-09')).toBe(true);
    expect(budget.tryConsume('2026-10-09')).toBe(false);
    expect(budget.remaining('2026-10-09')).toBe(0);
    expect(JSON.parse(getKv(db, KV.foodBudget) ?? 'null')).toEqual({ date: '2026-10-09', count: 2 });

    // A restart (new instance on the same database) keeps the count.
    const again = createFoodBudget(db, 2);
    expect(again.remaining('2026-10-09')).toBe(0);
    // A new day starts from zero.
    expect(again.remaining('2026-10-10')).toBe(2);
    expect(again.tryConsume('2026-10-10')).toBe(true);
    expect(again.remaining('2026-10-10')).toBe(1);
  });

  it('a limit of 0 disables estimates; a corrupt record counts as unused', () => {
    const db = openDatabase(':memory:');
    expect(createFoodBudget(db, 0).tryConsume('2026-10-09')).toBe(false);
    for (const raw of ['not json', '{"date": 5, "count": "x"}', '[]']) {
      setKv(db, KV.foodBudget, raw);
      expect(createFoodBudget(db, 3).remaining('2026-10-09')).toBe(3);
    }
  });
});
