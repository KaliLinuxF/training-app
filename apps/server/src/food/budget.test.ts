import { describe, expect, it } from 'vitest';
import { createDataRepos } from '../db/data';
import { getKv, KV, setKv } from '../db/kv';
import { openDatabase } from '../db/open';
import { createUserRepo } from '../db/users';
import { AI_USAGE_KEEP_DAYS, createFoodBudget, FOOD_BUDGET_TIMEZONE } from './budget';

/** Kyiv is UTC+3 in October 2026 (until the 25th). */
const kyiv = (day: number, hour: number, minute = 0): number => Date.UTC(2026, 9, day, hour - 3, minute);

const setup = (limits = { perUser: 2, global: 3 }) => {
  const db = openDatabase(':memory:');
  const users = createUserRepo(db);
  const anna = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 }).id;
  const olya = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
  const ira = users.create({ username: 'ira', role: 'user', passwordHash: null, now: 0 }).id;
  const budget = createFoodBudget(db, limits);
  return { db, users, anna, olya, ira, budget };
};

describe('food budget: per user and global (D16)', () => {
  it('counts per user per Kyiv day and persists (ai_usage + kv.food_budget)', () => {
    const { db, anna, budget } = setup();
    const A = budget.forUser(anna);
    const noon = kyiv(9, 12);
    expect(A.limit()).toBe(2);
    expect(A.remaining(noon)).toBe(2);
    expect(A.tryConsume(noon)).toBe('ok');
    expect(A.tryConsume(noon)).toBe('ok');
    expect(A.tryConsume(noon)).toBe('user_limit');
    expect(A.remaining(noon)).toBe(0);
    expect(
      db
        .prepare('SELECT user_id, date, count FROM ai_usage')
        .all()
        .map((r) => ({ ...r })),
    ).toEqual([{ user_id: anna, date: '2026-10-09', count: 2 }]);
    expect(JSON.parse(getKv(db, KV.foodBudget) ?? 'null')).toEqual({ date: '2026-10-09', count: 2 });

    // A restart (new instance on the same database) keeps the counts; a new day starts from zero.
    const again = createFoodBudget(db, { perUser: 2, global: 3 }).forUser(anna);
    expect(again.remaining(kyiv(9, 23, 59))).toBe(0);
    expect(again.remaining(kyiv(10, 0, 1))).toBe(2);
    expect(again.tryConsume(kyiv(10, 0, 1))).toBe('ok');
    expect(again.remaining(kyiv(10, 8))).toBe(1);
  });

  it('the global ceiling stops everybody; remaining is the smaller allowance', () => {
    const { anna, olya, ira, budget } = setup();
    const noon = kyiv(9, 12);
    expect(budget.forUser(anna).tryConsume(noon)).toBe('ok');
    expect(budget.forUser(anna).tryConsume(noon)).toBe('ok');
    expect(budget.forUser(olya).remaining(noon)).toBe(1); // own 2 left, everybody 1 left
    expect(budget.forUser(olya).tryConsume(noon)).toBe('ok');
    expect(budget.forUser(ira).remaining(noon)).toBe(0);
    expect(budget.forUser(ira).tryConsume(noon)).toBe('global_limit');
    expect(budget.usage(noon).globalToday).toBe(3);
  });

  it('a refused call counts nothing anywhere', () => {
    const { db, anna, olya, budget } = setup({ perUser: 1, global: 1 });
    const noon = kyiv(9, 12);
    expect(budget.forUser(anna).tryConsume(noon)).toBe('ok');
    expect(budget.forUser(anna).tryConsume(noon)).toBe('user_limit');
    expect(budget.forUser(olya).tryConsume(noon)).toBe('global_limit');
    expect(db.prepare('SELECT SUM(count) AS n FROM ai_usage').get()?.n).toBe(1);
    expect(JSON.parse(getKv(db, KV.foodBudget) ?? 'null')).toEqual({ date: '2026-10-09', count: 1 });
  });

  it('a per-user override wins over the default, 0 turns AI off for that user only', () => {
    const { users, anna, olya, budget } = setup({ perUser: 2, global: 100 });
    users.setAiLimit(anna, 5);
    users.setAiLimit(olya, 0);
    expect(budget.forUser(anna).limit()).toBe(5);
    expect(budget.forUser(olya).limit()).toBe(0);
    expect(budget.forUser(olya).remaining(kyiv(9, 12))).toBe(0);
    expect(budget.forUser(olya).tryConsume(kyiv(9, 12))).toBe('user_limit');
    for (let i = 0; i < 5; i++) expect(budget.forUser(anna).tryConsume(kyiv(9, 12))).toBe('ok');
    expect(budget.forUser(anna).tryConsume(kyiv(9, 12))).toBe('user_limit');
  });

  it('admin-saved limits (kv.ai_limits) win over the defaults; a global 0 turns AI off', () => {
    const { db, anna, budget } = setup({ perUser: 2, global: 3 });
    expect(budget.limits()).toEqual({ perUser: 2, global: 3 });
    expect(budget.limitsSource()).toBe('defaults');
    budget.setLimits({ perUser: 10, global: 0 });
    expect(budget.limits()).toEqual({ perUser: 10, global: 0 });
    expect(budget.limitsSource()).toBe('kv');
    expect(budget.forUser(anna).limit()).toBe(10);
    expect(budget.forUser(anna).remaining(kyiv(9, 12))).toBe(0);
    expect(budget.forUser(anna).tryConsume(kyiv(9, 12))).toBe('global_limit');
    expect(() => budget.setLimits({ perUser: 1001, global: 1 })).toThrow();
    expect(() => budget.setLimits({ perUser: 1, global: 10_001 })).toThrow();
    // A corrupt record falls back to the defaults.
    setKv(db, KV.aiLimits, '{"perUser":"x"}');
    expect(budget.limits()).toEqual({ perUser: 2, global: 3 });
    expect(budget.limitsSource()).toBe('defaults');
  });

  it('usage: per user today and over the last 30 days; prune drops counts older than 90 days', () => {
    const { db, anna, olya, budget } = setup({ perUser: 100, global: 1000 });
    for (const [day, n] of [
      [1, 3],
      [9, 2],
    ] as const) {
      for (let i = 0; i < n; i++) budget.forUser(anna).tryConsume(kyiv(day, 12));
    }
    budget.forUser(olya).tryConsume(kyiv(9, 13));
    db.prepare("INSERT INTO ai_usage (user_id, date, count) VALUES (?, '2026-09-01', 50)").run(anna);
    db.prepare("INSERT INTO ai_usage (user_id, date, count) VALUES (?, '2026-06-01', 9)").run(anna);
    const usage = budget.usage(kyiv(9, 18));
    expect(usage.globalToday).toBe(3);
    expect(usage.byUser.get(anna)).toEqual({ today: 2, last30Days: 5 });
    expect(usage.byUser.get(olya)).toEqual({ today: 1, last30Days: 1 });

    expect(AI_USAGE_KEEP_DAYS).toBe(90);
    expect(budget.prune(kyiv(9, 18))).toBe(1); // 2026-06-01 is older than 90 days
    expect(db.prepare('SELECT COUNT(*) AS n FROM ai_usage').get()?.n).toBe(4);
  });

  it('runs on Kyiv days whatever settings.timezone says', () => {
    expect(FOOD_BUDGET_TIMEZONE).toBe('Europe/Kyiv');
    const { db, anna, budget } = setup({ perUser: 1, global: 10 });
    const A = budget.forUser(anna);
    expect(A.tryConsume(kyiv(9, 23, 30))).toBe('ok');

    // Kiritimati (UTC+14) is already on Oct 10, Pago Pago (UTC−11) still on Oct 9: no fresh budget.
    const data = createDataRepos(db).forUser(anna);
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York']) {
      data.setTimezone(zone);
      expect(A.remaining(kyiv(9, 23, 45)), zone).toBe(0);
      expect(A.tryConsume(kyiv(9, 23, 45)), zone).toBe('user_limit');
    }
    expect(A.remaining(kyiv(10, 0, 0))).toBe(1);
  });

  it('reports the seconds until the next Kyiv midnight', () => {
    const { budget } = setup();
    expect(budget.secondsUntilReset(kyiv(9, 12))).toBe(12 * 3600);
    expect(budget.secondsUntilReset(kyiv(9, 23, 59))).toBe(60);
    expect(budget.secondsUntilReset(kyiv(10, 0, 0))).toBe(24 * 3600);
  });

  it('a corrupt global record counts as unused', () => {
    const { db, anna, budget } = setup({ perUser: 3, global: 3 });
    for (const raw of ['not json', '{"date": 5, "count": "x"}', '[]']) {
      setKv(db, KV.foodBudget, raw);
      expect(budget.forUser(anna).remaining(kyiv(9, 12))).toBe(3);
    }
  });
});
