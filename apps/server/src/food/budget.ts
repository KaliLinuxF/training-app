import type { ISODate } from '@legko/shared';
import { getKv, KV, setKv } from '../db/kv';
import type { Database } from '../db/sqlite';
import { transaction } from '../db/tx';

/**
 * Daily cap on AI estimates (cost guard). A call counts when the model is about to be called,
 * whatever its outcome. Persisted in `kv`, so restarts do not reset it; `date` is the user's
 * local day (settings.timezone), so the budget renews at her midnight.
 */
export interface FoodBudget {
  readonly limit: number;
  remaining(date: ISODate): number;
  /** Counts one call for `date`; false (and nothing counted) when the budget is used up. */
  tryConsume(date: ISODate): boolean;
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

export function createFoodBudget(db: Database, limit: number): FoodBudget {
  const usedOn = (date: ISODate): number => {
    const stored = parseStored(getKv(db, KV.foodBudget));
    return stored?.date === date ? stored.count : 0;
  };

  return {
    limit,
    remaining: (date) => Math.max(0, limit - usedOn(date)),
    tryConsume: (date) =>
      transaction(db, () => {
        const used = usedOn(date);
        if (used >= limit) return false;
        setKv(db, KV.foodBudget, JSON.stringify({ date, count: used + 1 } satisfies Stored));
        return true;
      }),
  };
}
