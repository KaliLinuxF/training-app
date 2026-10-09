import { DEFAULT_TIMEZONE, zonedNow, type ISODate } from '@legko/shared';
import { getKv, KV, setKv } from '../db/kv';
import type { Database } from '../db/sqlite';
import { transaction } from '../db/tx';

/**
 * The budget's day runs in a fixed server zone, not in `settings.timezone`: the client can change
 * that setting, and each switch to a zone on another calendar date would open a fresh budget.
 * Kyiv is where the app is used, so "today" still ends at her midnight.
 */
export const FOOD_BUDGET_TIMEZONE = DEFAULT_TIMEZONE;

const MINUTES_PER_DAY = 24 * 60;

/**
 * Daily cap on AI estimates (cost guard). A call counts when the model is about to be called,
 * whatever its outcome. Persisted in `kv`, so restarts do not reset it. `now` is epoch ms.
 */
export interface FoodBudget {
  readonly limit: number;
  /** Calls left on the current budget day. */
  remaining(now: number): number;
  /** Counts one call; false (and nothing counted) when today's budget is used up. */
  tryConsume(now: number): boolean;
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

export function createFoodBudget(
  db: Database,
  limit: number,
  timeZone: string = FOOD_BUDGET_TIMEZONE,
): FoodBudget {
  const dayOf = (now: number) => zonedNow(timeZone, new Date(now));

  const usedOn = (date: ISODate): number => {
    const stored = parseStored(getKv(db, KV.foodBudget));
    return stored?.date === date ? stored.count : 0;
  };

  return {
    limit,
    remaining: (now) => Math.max(0, limit - usedOn(dayOf(now).date)),
    tryConsume: (now) =>
      transaction(db, () => {
        const { date } = dayOf(now);
        const used = usedOn(date);
        if (used >= limit) return false;
        setKv(db, KV.foodBudget, JSON.stringify({ date, count: used + 1 } satisfies Stored));
        return true;
      }),
    secondsUntilReset: (now) => (MINUTES_PER_DAY - dayOf(now).minutes) * 60,
  };
}
