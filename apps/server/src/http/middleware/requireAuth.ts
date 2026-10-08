import type { MiddlewareHandler } from 'hono';
import type { SessionStore } from '../../auth/sessions';
import { clearSessionCookie, readSessionCookie, setSessionCookie } from '../cookies';
import { apiError, MESSAGES } from '../errors';
import type { AppEnv } from '../types';

export interface RequireAuthOptions {
  sessions: SessionStore;
  now: () => number;
  secureCookie: boolean;
}

/** 401 `unauthorized` without a live session; re-sends the cookie when the session was renewed. */
export function requireAuth({ sessions, now, secureCookie }: RequireAuthOptions): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const token = readSessionCookie(c);
    const check = token ? sessions.check(token, now()) : null;
    if (!token || !check) {
      if (token) clearSessionCookie(c, secureCookie);
      return apiError(c, 401, 'unauthorized', MESSAGES.unauthorized);
    }
    if (check.renewed) setSessionCookie(c, token, secureCookie);
    return next();
  };
}
