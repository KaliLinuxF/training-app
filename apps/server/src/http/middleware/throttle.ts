import type { Context, MiddlewareHandler } from 'hono';
import type { RateLimiter } from '../../auth/rateLimit';
import { apiError, MESSAGES } from '../errors';
import { clientIp } from '../request';
import { currentUser, type AppEnv } from '../types';

/** 429 `rate_limited` with `Retry-After` when `limiter` refuses `key`; null otherwise. */
export function refuseIfLimited(c: Context, limiter: RateLimiter, key: string, now: number): Response | null {
  const limit = limiter.check(key, now);
  if (!limit.limited) return null;
  c.header('Retry-After', String(limit.retryAfter));
  return apiError(c, 429, 'rate_limited', MESSAGES.rateLimited);
}

/**
 * Per-address throttle for the public endpoints: a throttled client is turned away before its body is read (it costs
 * no more than its headers).
 */
export function ipThrottle(
  limiter: RateLimiter,
  now: () => number,
  trustProxy: boolean,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const refused = refuseIfLimited(c, limiter, clientIp(c, trustProxy), now());
    if (refused) return refused;
    await next();
  };
}

/** Per-user throttle (after `requireAuth`); `count: true` records every attempt that gets through. */
export function userThrottle(
  limiter: RateLimiter,
  now: () => number,
  { count = false }: { count?: boolean } = {},
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const id = currentUser(c).id;
    const at = now();
    const refused = refuseIfLimited(c, limiter, id, at);
    if (refused) return refused;
    if (count) limiter.fail(id, at);
    await next();
  };
}
