import {
  API,
  changePasswordRequestSchema,
  renameRequestSchema,
  usernameKey,
  usernameProblem,
  type MeResponse,
  type OkResponse,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import { WrongPassword } from '../../auth/accounts';
import { passwordProblem, ScryptBusy } from '../../auth/password';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { setSessionCookie } from '../cookies';
import { accountErrorResponse, apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import { refuseIfLimited, userThrottle } from '../middleware/throttle';
import { currentUser, type AppEnv } from '../types';
import { scryptBusy } from './auth';
import type { RouteDeps } from './deps';

const OK: OkResponse = { ok: true };

/**
 * «Акаунт» (docs/multi-user.md §3.5, §9.5): change your own password, rename yourself. Both routes count every
 * attempt per user (`accountChangeLimiter`, 10 / hour) and wrong current passwords (`passwordLimiter`, 5 / 15 min:
 * counted synchronously before the hash check, reset after a right password).
 */
export function registerAccountRoutes(app: Hono<AppEnv>, deps: RouteDeps): void {
  const { auth, accounts, users, passwordLimiter, accountChangeLimiter, now, secureCookie } = deps;
  const guards = [
    auth,
    userThrottle(accountChangeLimiter, now, { count: true }),
    limitBody(BODY_LIMITS.small),
  ] as const;

  /** The password-limiter steps before the (slow) hash check; a Response when refused. */
  const countPasswordAttempt = (c: Context<AppEnv>): Response | null => {
    const id = currentUser(c).id;
    const at = now();
    const refused = refuseIfLimited(c, passwordLimiter, id, at);
    if (refused) return refused;
    passwordLimiter.fail(id, at);
    return null;
  };

  const mapError = (c: Context<AppEnv>, err: unknown): Response => {
    if (err instanceof ScryptBusy) return scryptBusy(c);
    const mapped = accountErrorResponse(c, err);
    if (mapped) return mapped;
    throw err;
  };

  app.post(API.accountPassword, ...guards, async (c) => {
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = changePasswordRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    const { currentPassword, newPassword } = parsed.data;
    if (passwordProblem(newPassword)) return apiError(c, 400, 'weak_password', MESSAGES.weakPassword);

    const refused = countPasswordAttempt(c);
    if (refused) return refused;
    const user = currentUser(c);
    try {
      // D26: every session of the account is revoked — this one too; this device gets a fresh cookie.
      const token = await accounts.changePassword(user.id, currentPassword, newPassword, now());
      passwordLimiter.reset(user.id);
      setSessionCookie(c, token, secureCookie);
      return c.json(OK);
    } catch (err) {
      return mapError(c, err);
    }
  });

  app.post(API.accountUsername, ...guards, async (c) => {
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = renameRequestSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    const { username, password } = parsed.data;
    const user = currentUser(c);
    const own = users.byId(user.id);
    const sameKey = own !== null && usernameKey(username) === own.usernameKey;
    // `admin` is reserved for self-rename; changing only the case of your own name is fine.
    if (usernameProblem(username, { allowAdmin: sameKey }) !== null) {
      return apiError(c, 400, 'invalid_username', MESSAGES.invalidUsername);
    }

    const refused = countPasswordAttempt(c);
    if (refused) return refused;
    try {
      const renamed = await accounts.renameSelf(user.id, username, password);
      passwordLimiter.reset(user.id);
      const res: MeResponse = { ok: true, user: renamed };
      return c.json(res);
    } catch (err) {
      // A right password followed by a taken name still resets the wrong-password counter.
      if (!(err instanceof WrongPassword) && !(err instanceof ScryptBusy)) passwordLimiter.reset(user.id);
      return mapError(c, err);
    }
  });
}
