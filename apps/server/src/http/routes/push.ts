import {
  API,
  pushSubscribeRequestSchema,
  pushUnsubscribeRequestSchema,
  type OkResponse,
  type PushKeyResponse,
  type PushTestResponse,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import { TEST_MESSAGE } from '../../push/messages';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import type { AppEnv } from '../types';
import type { RouteDeps } from './deps';

const OK: OkResponse = { ok: true };
const TEST_TTL_SECONDS = 600;

const unavailable = (c: Context): Response => apiError(c, 503, 'push_unavailable', MESSAGES.pushUnavailable);

const userAgentOf = (c: Context): string | null => c.req.header('user-agent')?.slice(0, 300) ?? null;

export function registerPushRoutes(app: Hono<AppEnv>, { push, data, auth, logger }: RouteDeps): void {
  app.get(API.pushKey, auth, (c) => {
    if (!push) return unavailable(c);
    const body: PushKeyResponse = { key: push.publicKey };
    return c.json(body);
  });

  app.post(API.pushSubscribe, auth, limitBody(BODY_LIMITS.small), async (c) => {
    if (!push) return unavailable(c);
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = pushSubscribeRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    const { subscription, timezone } = parsed.data;
    // Real push services are all https; anything else would make us POST to arbitrary hosts.
    if (new URL(subscription.endpoint).protocol !== 'https:')
      return badRequest(c, 'Push endpoint must be https');

    push.subscribe(
      { endpoint: subscription.endpoint, p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
      userAgentOf(c),
    );
    // Reminders fire in the zone of the device that receives them: follow it when it reports a
    // different zone (an alias of the stored one, e.g. Europe/Kiev for Europe/Kyiv, is not).
    const stored = timezone ? data.setTimezone(timezone) : null;
    if (stored) logger.info(`settings.timezone set to ${stored} by push subscribe`);
    return c.json(OK);
  });

  app.post(API.pushUnsubscribe, auth, limitBody(BODY_LIMITS.small), async (c) => {
    if (!push) return unavailable(c);
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = pushUnsubscribeRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    push.unsubscribe(parsed.data.endpoint);
    return c.json(OK);
  });

  app.post(API.pushTest, auth, async (c) => {
    if (!push) return unavailable(c);
    const summary = await push.sendToAll(TEST_MESSAGE, { ttl: TEST_TTL_SECONDS });
    const res: PushTestResponse = { ok: true, sent: summary.sent };
    return c.json(res);
  });
}
