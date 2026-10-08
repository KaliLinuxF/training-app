export interface RateLimitDecision {
  limited: boolean;
  /** Seconds until the next attempt is allowed (0 when not limited). */
  retryAfter: number;
}

export interface RateLimiter {
  check(key: string, now: number): RateLimitDecision;
  fail(key: string, now: number): void;
  reset(key: string): void;
}

export interface RateLimiterOptions {
  maxFailures: number;
  windowMs: number;
  /** Upper bound on tracked keys so a flood of addresses cannot grow memory without limit. */
  maxKeys?: number;
}

export const LOGIN_RATE_LIMIT: RateLimiterOptions = { maxFailures: 5, windowMs: 15 * 60_000 };

/** Sliding-window failure counter: `maxFailures` failures within `windowMs` block further attempts. */
export function createRateLimiter({
  maxFailures,
  windowMs,
  maxKeys = 10_000,
}: RateLimiterOptions): RateLimiter {
  const failures = new Map<string, number[]>();

  const recent = (key: string, now: number): number[] => {
    const list = (failures.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };

  const evictStale = (now: number): void => {
    for (const key of failures.keys()) recent(key, now);
    // Still too many: drop the oldest-inserted keys.
    for (const key of failures.keys()) {
      if (failures.size < maxKeys) break;
      failures.delete(key);
    }
  };

  return {
    check(key, now) {
      const list = recent(key, now);
      if (list.length < maxFailures) return { limited: false, retryAfter: 0 };
      const oldestRelevant = list[list.length - maxFailures] ?? now;
      return { limited: true, retryAfter: Math.max(1, Math.ceil((oldestRelevant + windowMs - now) / 1000)) };
    },
    fail(key, now) {
      if (!failures.has(key) && failures.size >= maxKeys) evictStale(now);
      failures.set(key, [...recent(key, now), now]);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}
