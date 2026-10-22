import {
  ALIAS_USERNAMES,
  API,
  loginRequestSchema,
  usernameKey,
  type LoginResponse,
  type MeResponse,
  type OkResponse,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import { createDummyHash, SCRYPT_BUSY_RETRY_AFTER, ScryptBusy, verifyPassword } from '../../auth/password';
import { addressKey } from '../../auth/rateLimit';
import { authedUser } from '../../db/users';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { clearSessionCookie, readSessionCookie, replaceSessionCookie } from '../cookies';
import { apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import { ipThrottle, refuseIfLimited } from '../middleware/throttle';
import { clientIp } from '../request';
import { currentUser, type AppEnv } from '../types';
import type { RouteDeps } from './deps';

const OK: OkResponse = { ok: true };

/** 429 for a full scrypt gate (D31): the attempt stays counted. */
export function scryptBusy(c: Context): Response {
  c.header('Retry-After', String(SCRYPT_BUSY_RETRY_AFTER));
  return apiError(c, 429, 'rate_limited', MESSAGES.rateLimited);
}

export function registerAuthRoutes(app: Hono<AppEnv>, deps: RouteDeps): void {
  const {
    users,
    sessions,
    loginLimiter,
    usernameLimiter,
    loginSuccessLimiter,
    now,
    auth,
    secureCookie,
    trustProxy,
    scrypt,
    scryptGate,
    logger,
  } = deps;

  /**
   * The same 401 for every failure. A username-less login (only the pre-v4 bundle sends one, D24) gets the old
   * `bad_password` code, the only one that bundle shows as «Неправильний пароль»: it always targets the legacy owner,
   * so there is no name whose existence the answer could reveal.
   */
  const badCredentials = (c: Context, named: boolean): Response =>
    named
      ? apiError(c, 401, 'bad_credentials', MESSAGES.badCredentials)
      : apiError(c, 401, 'bad_password', MESSAGES.badPassword);

  /** Successful-login budget keys: the username key and the client address (IPv6 per /64). */
  const successKeys = (key: string, ip: string): string[] => [`name:${key}`, `addr:${addressKey(ip)}`];

  const refuseIfTooManySuccesses = (c: Context, keys: readonly string[], at: number): Response | null => {
    for (const key of keys) {
      const refused = refuseIfLimited(c, loginSuccessLimiter, key, at);
      if (refused) return refused;
    }
    return null;
  };

  /**
   * `POST /api/auth/login { username?, password }` (docs/multi-user.md §3.5). Every failure — an unknown name, an
   * account without a password, a wrong password — does the same work (a dummy hash is verified) and gets the same
   * 401 body. A missing username is the `legko` alias of the legacy owner (D3, D24) and creates a legacy session.
   * Successful logins have their own budget per name and per address (`LOGIN_SUCCESS_LIMIT` in production).
   */
  app.post(API.login, ipThrottle(loginLimiter, now, trustProxy), limitBody(BODY_LIMITS.login), async (c) => {
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = loginRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    const { username, password } = parsed.data;
    const named = username !== undefined;

    const ip = clientIp(c, trustProxy);
    const at = now();
    // Checked again now that the body is in: parallel requests may have failed meanwhile.
    const refusedIp = refuseIfLimited(c, loginLimiter, ip, at);
    if (refusedIp) return refusedIp;

    let key = usernameKey(username ?? ALIAS_USERNAMES[0]);
    if ((ALIAS_USERNAMES as readonly string[]).includes(key)) key = users.legacyOwner()?.usernameKey ?? key;
    const refusedName = refuseIfLimited(c, usernameLimiter, key, at);
    if (refusedName) return refusedName;
    // Before any scrypt work: a caller over the success budget costs nothing (and is not counted as a failure).
    const budget = successKeys(key, ip);
    const refusedSuccess = refuseIfTooManySuccesses(c, budget, at);
    if (refusedSuccess) return refusedSuccess;
    // Counted before the (slow) hash check, in the same tick as the checks, so parallel guesses cannot slip past
    // the limits; a successful login takes them back.
    loginLimiter.fail(ip, at);
    usernameLimiter.fail(key, at);

    const user = users.byKey(key);
    let ok: boolean;
    try {
      ok = await verifyPassword(password, user?.passwordHash ?? createDummyHash(scrypt), scryptGate);
    } catch (err) {
      if (err instanceof ScryptBusy) return scryptBusy(c);
      throw err;
    }
    if (!user || user.passwordHash === null || !ok) return badCredentials(c, named);
    if (user.disabledAt !== null) return apiError(c, 403, 'account_disabled', MESSAGES.accountDisabled);

    loginLimiter.reset(ip);
    usernameLimiter.reset(key);
    // Re-checked and recorded in one tick: parallel correct logins cannot overshoot the budget.
    const signedInAt = now();
    const overBudget = refuseIfTooManySuccesses(c, budget, signedInAt);
    if (overBudget) return overBudget;
    for (const k of budget) loginSuccessLimiter.fail(k, signedInAt);
    const token = sessions.create(user.id, now(), { legacy: username === undefined });
    users.touch(user.id, now());
    replaceSessionCookie(c, sessions, token, secureCookie);
    if (username === undefined) logger.info(`user ${user.id} signed in without a username (legacy session)`);
    const res: LoginResponse = { ok: true, user: authedUser(user) };
    return c.json(res);
  });

  // Works without a live session too: signing out must always succeed for the client.
  app.post(API.logout, (c) => {
    const token = readSessionCookie(c);
    if (token) sessions.revoke(token);
    clearSessionCookie(c, secureCookie);
    return c.json(OK);
  });

  app.get(API.me, auth, (c) => {
    const res: MeResponse = { ok: true, user: currentUser(c) };
    return c.json(res);
  });
}
