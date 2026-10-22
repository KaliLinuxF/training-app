import type { Context } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { SESSION_TTL_SECONDS, type SessionStore } from '../auth/sessions';

export const SESSION_COOKIE = 'sid';

const baseOptions = (secure: boolean) => ({ httpOnly: true, sameSite: 'Lax', path: '/', secure }) as const;

export const readSessionCookie = (c: Context): string | undefined => getCookie(c, SESSION_COOKIE);

/** `sid`: HttpOnly, SameSite=Lax, Path=/, Max-Age 400 days, Secure in production. */
export function setSessionCookie(c: Context, token: string, secure: boolean): void {
  setCookie(c, SESSION_COOKIE, token, { ...baseOptions(secure), maxAge: SESSION_TTL_SECONDS });
}

export function clearSessionCookie(c: Context, secure: boolean): void {
  deleteCookie(c, SESSION_COOKIE, baseOptions(secure));
}

/**
 * Login / invite accept / reset complete (D26): the session of the incoming `sid` cookie — whoever it belonged to —
 * is revoked before the new one's cookie is set, so an overwritten cookie never leaves a live session behind.
 */
export function replaceSessionCookie(
  c: Context,
  sessions: SessionStore,
  token: string,
  secure: boolean,
): void {
  const incoming = readSessionCookie(c);
  if (incoming && incoming !== token) sessions.revoke(incoming);
  setSessionCookie(c, token, secure);
}
