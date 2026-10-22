import {
  API,
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
  type OkResponse,
  type PushKeyResponse,
  type PushTestResponse,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import { createRateLimiter, type RateLimiterOptions } from '../../auth/rateLimit';
import { TEST_MESSAGE } from '../../push/messages';
import { isAllowedPushEndpoint } from '../../push/transport';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import { currentUser, type AppEnv } from '../types';
import type { RouteDeps } from './deps';

const OK: OkResponse = { ok: true };
const TEST_TTL_SECONDS = 600;

/** Test notifications per account (every attempt counts): enough to try a few devices, not a request pump. */
export const PUSH_TEST_LIMIT: RateLimiterOptions = { maxFailures: 5, windowMs: 10 * 60_000 };

export const PUSH_SERVICE_NOT_ALLOWED = 'Цей сервіс сповіщень не підтримується';

const unavailable = (c: Context): Response => apiError(c, 503, 'push_unavailable', MESSAGES.pushUnavailable);

const userAgentOf = (c: Context): string | null => c.req.header('user-agent')?.slice(0, 300) ?? null;

/** Push subscriptions belong to the signed-in user (docs/multi-user.md §5.4, D15). */
export function registerPushRoutes(app: Hono<AppEnv>, { push, data, auth, logger, now }: RouteDeps): void {
  const testLimiter = createRateLimiter(PUSH_TEST_LIMIT);

  app.get(API.pushKey, auth, (c) => {
    if (!push) return unavailable(c);
    const body: PushKeyResponse = { key: push.publicKey };
    return c.json(body);
  });

  app.post(API.pushSubscribe, auth, limitBody(BODY_LIMITS.small), async (c) => {
    if (!push) return unavailable(c);
    const user = currentUser(c);
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = pushSubscribeRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    const { subscription, timezone } = parsed.data;
    // Only the browsers' push services (https, default port, no IP literals): anything else would make the server
    // POST wherever an account points it, internal addresses included.
    if (!isAllowedPushEndpoint(subscription.endpoint)) return badRequest(c, PUSH_SERVICE_NOT_ALLOWED);

    const result = push
      .forUser(user.id)
      .subscribe(
        { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
        userAgentOf(c),
      );
    // Another user's endpoint without the same browser subscription's key: nothing moved, nothing else changes.
    if (result === 'conflict') return apiError(c, 403, 'forbidden', MESSAGES.forbidden);
    // Reminders fire in the zone of the device that receives them: follow it when it reports a
    // different zone (an alias of the stored one, e.g. Europe/Kiev for Europe/Kyiv, is not).
    const stored = timezone ? data.forUser(user.id).setTimezone(timezone) : null;
    if (stored) logger.info(`settings.timezone of user ${user.id} set to ${stored} by push subscribe`);
    return c.json(OK);
  });

  app.post(API.pushUnsubscribe, auth, limitBody(BODY_LIMITS.small), async (c) => {
    if (!push) return unavailable(c);
    const user = currentUser(c);
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = pushUnsubscribeRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    // Without `auth` (old clients) only the caller's own row; with it, whoever owns that browser subscription.
    push.forUser(user.id).unsubscribe(parsed.data.endpoint, parsed.data.auth);
    return c.json(OK);
  });

  app.post(API.pushTest, auth, async (c) => {
    if (!push) return unavailable(c);
    const user = currentUser(c);
    // Every attempt counts: each one is an outbound request per device.
    const decision = testLimiter.check(user.id, now());
    if (decision.limited) {
      c.header('Retry-After', String(decision.retryAfter));
      return apiError(c, 429, 'rate_limited', MESSAGES.rateLimited);
    }
    testLimiter.fail(user.id, now());
    const summary = await push.forUser(user.id).send(TEST_MESSAGE, { ttl: TEST_TTL_SECONDS });
    const res: PushTestResponse = { ok: true, sent: summary.sent };
    return c.json(res);
  });
}
