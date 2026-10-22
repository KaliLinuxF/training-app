import { API, USER_HEADER } from '@legko/shared';
import type { Context, MiddlewareHandler } from 'hono';
import type { SessionStore } from '../../auth/sessions';
import type { UserRepo } from '../../db/users';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '../cookies';
import { apiError, MESSAGES } from '../errors';
import { currentUser, type AppEnv } from '../types';

/** `users.last_seen_at` is written at most this often per user. */
export const LAST_SEEN_EVERY_MS = 5 * 60_000;

export interface RequireAuthOptions {
  sessions: SessionStore;
  users: Pick<UserRepo, 'touch'>;
  now: () => number;
  secureCookie: boolean;
}

/** The routes that read or replace a device's whole copy: a v4 session must say whose copy it is (D11). */
function needsUserHeader(c: Context): boolean {
  const { method, path } = c.req;
  return (
    (method === 'GET' && path === API.data) ||
    (method === 'POST' && (path === API.ops || path === API.import))
  );
}

/**
 * 401 `unauthorized` without a live session (a disabled user's sessions are dead too). Otherwise sets `c.var.user`
 * and `c.var.sessionHash`, re-sends the cookie when the session was renewed and refreshes `last_seen_at`.
 *
 * 409 `user_mismatch`, before the route touches anything, when `X-Legko-User` names another user — or when it is
 * missing on `GET /api/data`, `POST /api/ops` or `POST /api/import` and the session is not legacy (D11): a tab that
 * still holds someone else's device copy must never read or write this account. A matching header on a legacy
 * session clears the flag (the new bundle has taken over).
 */
export function requireAuth({
  sessions,
  users,
  now,
  secureCookie,
}: RequireAuthOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = readSessionCookie(c);
    const at = now();
    const check = token ? sessions.check(token, at) : null;
    if (!token || !check) {
      if (token) clearSessionCookie(c, secureCookie);
      return apiError(c, 401, 'unauthorized', MESSAGES.unauthorized);
    }
    const header = c.req.header(USER_HEADER);
    if (header !== undefined ? header !== check.user.id : !check.legacy && needsUserHeader(c)) {
      return apiError(c, 409, 'user_mismatch', MESSAGES.userMismatch);
    }
    if (header !== undefined && check.legacy) sessions.clearLegacy(check.tokenHash);
    if (check.renewed) setSessionCookie(c, token, secureCookie);
    if (check.lastSeenAt === null || at - check.lastSeenAt >= LAST_SEEN_EVERY_MS)
      users.touch(check.user.id, at);
    c.set('user', check.user);
    c.set('sessionHash', check.tokenHash);
    return next();
  };
}

/** After `requireAuth`: 403 `forbidden` unless the signed-in user is an admin (read from `users` on every request). */
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (currentUser(c).role !== 'admin') return apiError(c, 403, 'forbidden', MESSAGES.forbidden);
  return next();
};
