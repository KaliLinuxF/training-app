import {
  API,
  inviteAcceptRequestSchema,
  linkCheckRequestSchema,
  resetCompleteRequestSchema,
  type InviteCheckResponse,
  type LoginResponse,
  type ResetCheckResponse,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import { LinkInvalid, UsernameTaken, type SignedIn } from '../../auth/accounts';
import { ScryptBusy } from '../../auth/password';
import { byAddress } from '../../auth/rateLimit';
import { hashToken } from '../../db/tokens';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { replaceSessionCookie } from '../cookies';
import { accountErrorResponse, apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import { ipThrottle, refuseIfLimited } from '../middleware/throttle';
import { clientIp } from '../request';
import type { AppEnv } from '../types';
import { scryptBusy } from './auth';
import type { RouteDeps } from './deps';

/**
 * The four public one-time-link endpoints (docs/multi-user.md §3.4): `invite/check`, `invite/accept`, `reset/check`,
 * `reset/complete`. All sit behind a per-address throttle (checked before the body is read) and the login body cap.
 * A `410 link_invalid` answer and a taken name count as failures for the address; a successful accept / complete
 * resets them. Tokens are never logged.
 */
export function registerLinkRoutes(app: Hono<AppEnv>, deps: RouteDeps): void {
  const { tokens, users, accounts, sessions, now, trustProxy, secureCookie } = deps;
  // Every check, failure and reset below is keyed by `addressKey`: an IPv6 client counts by its /64, so rotating
  // addresses inside it buys no extra guesses (or username probes with one valid invite, §3.4).
  const linkLimiter = byAddress(deps.linkLimiter);
  /** Tokens being accepted / completed right now: a second request for the same one gets 429 (D31). */
  const inFlight = new Set<string>();

  const guards = [ipThrottle(linkLimiter, now, trustProxy), limitBody(BODY_LIMITS.login)] as const;

  /** Parses the body with `schema` after re-checking the throttle; a Response on failure. */
  async function parseBody<S extends z.ZodType>(
    c: Context<AppEnv>,
    schema: S,
  ): Promise<{ ip: string; data: z.output<S> } | Response> {
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = schema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    const ip = clientIp(c, trustProxy);
    const refused = refuseIfLimited(c, linkLimiter, ip, now());
    if (refused) return refused;
    return { ip, data: parsed.data };
  }

  const invalid = (c: Context, ip: string, reason: LinkInvalid['reason']): Response => {
    linkLimiter.fail(ip, now());
    return apiError(c, 410, 'link_invalid', MESSAGES.linkInvalid, { reason });
  };

  /** Runs an accept / complete for one token at a time, maps the typed errors and signs the browser in. */
  async function consume(
    c: Context<AppEnv>,
    ip: string,
    token: string,
    run: () => Promise<SignedIn>,
  ): Promise<Response> {
    const key = hashToken(token);
    if (inFlight.has(key)) return apiError(c, 429, 'rate_limited', MESSAGES.rateLimited);
    inFlight.add(key);
    try {
      const { user, sessionToken } = await run();
      linkLimiter.reset(ip);
      replaceSessionCookie(c, sessions, sessionToken, secureCookie);
      const res: LoginResponse = { ok: true, user };
      return c.json(res);
    } catch (err) {
      if (err instanceof ScryptBusy) return scryptBusy(c);
      if (err instanceof LinkInvalid) return invalid(c, ip, err.reason);
      if (err instanceof UsernameTaken) linkLimiter.fail(ip, now());
      const mapped = accountErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    } finally {
      inFlight.delete(key);
    }
  }

  app.post(API.inviteCheck, ...guards, async (c) => {
    const input = await parseBody(c, linkCheckRequestSchema);
    if (input instanceof Response) return input;
    const check = tokens.checkInvite(input.data.token, now());
    if (!check.ok) return invalid(c, input.ip, check.reason);
    const res: InviteCheckResponse = { ok: true, expiresAt: check.link.expiresAt };
    return c.json(res);
  });

  app.post(API.inviteAccept, ...guards, async (c) => {
    const input = await parseBody(c, inviteAcceptRequestSchema);
    if (input instanceof Response) return input;
    const { token, username, password } = input.data;
    return consume(c, input.ip, token, () =>
      accounts.registerWithInvite({ token, username, password, now: now() }),
    );
  });

  app.post(API.resetCheck, ...guards, async (c) => {
    const input = await parseBody(c, linkCheckRequestSchema);
    if (input instanceof Response) return input;
    const check = tokens.checkReset(input.data.token, now());
    if (!check.ok) return invalid(c, input.ip, check.reason);
    const user = users.byId(check.link.userId);
    if (!user) return invalid(c, input.ip, 'unknown');
    const res: ResetCheckResponse = {
      ok: true,
      username: user.username,
      purpose: check.link.purpose,
      expiresAt: check.link.expiresAt,
    };
    return c.json(res);
  });

  app.post(API.resetComplete, ...guards, async (c) => {
    const input = await parseBody(c, resetCompleteRequestSchema);
    if (input instanceof Response) return input;
    const { token, password } = input.data;
    return consume(c, input.ip, token, () => accounts.completeReset({ token, password, now: now() }));
  });
}
