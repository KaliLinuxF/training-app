import {
  addDays,
  aiLimitsSchema,
  DEFAULT_TIMEZONE,
  zonedNow,
  type AiLimits,
  type ISODate,
} from '@legko/shared';
import { getKv, KV, setKv } from '../db/kv';
import { num, numOrNull, text } from '../db/rows';
import type { Database } from '../db/sqlite';
import { transaction } from '../db/tx';
import type { UserId } from '../db/users';

/**
 * The budget's day runs in a fixed server zone, not in `settings.timezone`: the client can change
 * that setting, and each switch to a zone on another calendar date would open a fresh budget.
 * Kyiv is where the app is used, so "today" still ends at midnight there.
 */
export const FOOD_BUDGET_TIMEZONE = DEFAULT_TIMEZONE;

/** Per-user counts older than this are pruned (daily, with the photo GC). */
export const AI_USAGE_KEEP_DAYS = 90;

const MINUTES_PER_DAY = 24 * 60;

export type ConsumeResult = 'ok' | 'user_limit' | 'global_limit';

/** Where the limits in force come from: saved by an admin (`kv.ai_limits`) or the configured defaults. */
export type LimitsSource = 'kv' | 'defaults';

/** One user's daily AI allowance (docs/multi-user.md §5.3). `now` is epoch ms. */
export interface UserBudget {
  /** The user's own limit (`users.ai_daily_limit`) or the per-user default. 0 = off for this user. */
  limit(): number;
  /** Estimates left today: the smaller of this user's and everybody's allowance. */
  remaining(now: number): number;
  /**
   * Counts one model call against this user AND the global ceiling, atomically; nothing is counted when either is
   * used up.
   */
  tryConsume(now: number): ConsumeResult;
}

export interface AiUsage {
  /** Everybody together today (the global counter). */
  globalToday: number;
  /** Per user: today and the last 30 days (today included). Users without usage are absent. */
  byUser: Map<string, { today: number; last30Days: number }>;
}

/**
 * Daily caps on AI estimates (cost guard): per user (default 40) and a global ceiling (default 150), both on the Kyiv
 * day. A call counts when the model is about to be called, whatever its outcome. Persisted (`ai_usage`,
 * `kv.food_budget`), so restarts do not reset them.
 */
export interface FoodBudget {
  /** `kv.ai_limits` when an admin saved valid limits, else the defaults. */
  limits(): AiLimits;
  limitsSource(): LimitsSource;
  setLimits(limits: AiLimits): void;
  forUser(id: UserId): UserBudget;
  /** For the admin overview (counts only). */
  usage(now: number): AiUsage;
  /** Deletes per-user counts older than `AI_USAGE_KEEP_DAYS`. Returns how many rows. */
  prune(now: number): number;
  /** Seconds until the next budget day starts (for `Retry-After`). */
  secondsUntilReset(now: number): number;
}

interface Stored {
  date: ISODate;
  count: number;
}

function parseStored(raw: string | null): Stored | null {
  if (raw === null) return null;
  try {
    const v: unknown = JSON.parse(raw);
    if (typeof v !== 'object' || v === null || !('date' in v) || !('count' in v)) return null;
    const { date, count } = v;
    return typeof date === 'string' && typeof count === 'number' ? { date, count } : null;
  } catch {
    return null;
  }
}

function parseLimits(raw: string | null): AiLimits | null {
  if (raw === null) return null;
  try {
    const parsed = aiLimitsSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function createFoodBudget(
  db: Database,
  defaults: AiLimits,
  timeZone: string = FOOD_BUDGET_TIMEZONE,
): FoodBudget {
  const dayOf = (now: number) => zonedNow(timeZone, new Date(now));
  const q = {
    userLimit: db.prepare('SELECT ai_daily_limit FROM users WHERE id = ?'),
    used: db.prepare('SELECT count FROM ai_usage WHERE user_id = ? AND date = ?'),
    count: db.prepare(
      `INSERT INTO ai_usage (user_id, date, count) VALUES (?, ?, 1)
       ON CONFLICT (user_id, date) DO UPDATE SET count = count + 1`,
    ),
    // Admin overview: counts per user over the last 30 days (no content).
    usage: db.prepare(
      `SELECT user_id, SUM(CASE WHEN date = ? THEN count ELSE 0 END) AS today, SUM(count) AS total
       FROM ai_usage WHERE date >= ? AND date <= ? GROUP BY user_id`,
    ),
    prune: db.prepare('DELETE FROM ai_usage WHERE date < ?'),
  };

  const globalUsedOn = (date: ISODate): number => {
    const stored = parseStored(getKv(db, KV.foodBudget));
    return stored?.date === date ? stored.count : 0;
  };

  const limits = (): AiLimits => parseLimits(getKv(db, KV.aiLimits)) ?? { ...defaults };

  function forUser(id: UserId): UserBudget {
    const limit = (): number => {
      const row = q.userLimit.get(id);
      return (row ? numOrNull(row, 'ai_daily_limit') : null) ?? limits().perUser;
    };
    const usedOn = (date: ISODate): number => {
      const row = q.used.get(id, date);
      return row ? num(row, 'count') : 0;
    };
    return {
      limit,
      remaining(now) {
        const { date } = dayOf(now);
        const own = limit() - usedOn(date);
        const everybody = limits().global - globalUsedOn(date);
        return Math.max(0, Math.min(own, everybody));
      },
      tryConsume: (now) =>
        transaction(db, () => {
          const { date } = dayOf(now);
          if (usedOn(date) >= limit()) return 'user_limit';
          const global = globalUsedOn(date);
          if (global >= limits().global) return 'global_limit';
          q.count.run(id, date);
          setKv(db, KV.foodBudget, JSON.stringify({ date, count: global + 1 } satisfies Stored));
          return 'ok';
        }),
    };
  }

  return {
    limits,
    limitsSource: () => (parseLimits(getKv(db, KV.aiLimits)) ? 'kv' : 'defaults'),
    setLimits(next) {
      const parsed = aiLimitsSchema.parse(next);
      setKv(db, KV.aiLimits, JSON.stringify({ perUser: parsed.perUser, global: parsed.global }));
    },
    forUser,
    usage(now) {
      const { date } = dayOf(now);
      const byUser = new Map<string, { today: number; last30Days: number }>();
      for (const row of q.usage.all(date, addDays(date, -29), date)) {
        byUser.set(text(row, 'user_id'), { today: num(row, 'today'), last30Days: num(row, 'total') });
      }
      return { globalToday: globalUsedOn(date), byUser };
    },
    prune(now) {
      return Number(q.prune.run(addDays(dayOf(now).date, -AI_USAGE_KEEP_DAYS)).changes);
    },
    secondsUntilReset: (now) => (MINUTES_PER_DAY - dayOf(now).minutes) * 60,
  };
}
