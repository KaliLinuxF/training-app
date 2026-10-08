import { API, loginRequestSchema, type OkResponse } from '@legko/shared';
import type { Hono } from 'hono';
import { getPasswordHash, verifyPassword } from '../../auth/password';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '../cookies';
import { apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import { clientIp } from '../request';
import type { AppEnv } from '../types';
import type { RouteDeps } from './deps';

const OK: OkResponse = { ok: true };

export function registerAuthRoutes(app: Hono<AppEnv>, deps: RouteDeps): void {
  const { db, sessions, loginLimiter, logger, now, auth, secureCookie, trustProxy } = deps;

  app.post(API.login, async (c) => {
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = loginRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));

    const ip = clientIp(c, trustProxy);
    const limit = loginLimiter.check(ip, now());
    if (limit.limited) {
      c.header('Retry-After', String(limit.retryAfter));
      return apiError(c, 429, 'rate_limited', MESSAGES.rateLimited);
    }
    // Counted before the (slow) hash check so parallel guesses cannot slip past the limit;
    // a successful login clears it again.
    loginLimiter.fail(ip, now());

    const hash = getPasswordHash(db);
    if (!hash) {
      logger.warn(
        'Login attempt, but no password is set. Run the CLI: cli.js set-password (see start-up log)',
      );
      return apiError(c, 401, 'bad_password', MESSAGES.badPassword);
    }
    if (!(await verifyPassword(parsed.data.password, hash))) {
      return apiError(c, 401, 'bad_password', MESSAGES.badPassword);
    }

    loginLimiter.reset(ip);
    setSessionCookie(c, sessions.create(now()), secureCookie);
    return c.json(OK);
  });

  // Works without a live session too: signing out must always succeed for the client.
  app.post(API.logout, (c) => {
    const token = readSessionCookie(c);
    if (token) sessions.revoke(token);
    clearSessionCookie(c, secureCookie);
    return c.json(OK);
  });

  app.get(API.me, auth, (c) => c.json(OK));
}
