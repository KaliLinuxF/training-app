import {
  aiLimitsSchema,
  API,
  createInviteRequestSchema,
  deleteUserRequestSchema,
  inviteIdRequestSchema,
  setDisabledRequestSchema,
  setRoleRequestSchema,
  userAiLimitRequestSchema,
  userTargetRequestSchema,
  type AdminOverview,
  type AdminUser,
  type InviteCreatedResponse,
  type LinkResponse,
  type OkResponse,
} from '@legko/shared';
import type { Context, Hono } from 'hono';
import type { z } from 'zod';
import { AccountDisabled, type Actor } from '../../auth/accounts';
import type { UserRow } from '../../db/users';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { accountErrorResponse, apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import { currentSessionHash, currentUser, type AppEnv } from '../types';
import type { RouteDeps } from './deps';

const OK: OkResponse = { ok: true };

const statusOf = (u: UserRow): AdminUser['status'] =>
  u.disabledAt !== null ? 'disabled' : u.passwordHash === null ? 'pending' : 'active';

/**
 * «Користувачі» (docs/multi-user.md §6.3, §9.6): admins only (`auth` + `admin` on every route). The overview lists
 * accounts and pending invites — never anybody's records. Links come back as a path (`/invite#…`, `/reset#…`), shown
 * once; tokens are never logged.
 */
export function registerAdminRoutes(app: Hono<AppEnv>, deps: RouteDeps): void {
  const { auth, admin, users, tokens, accounts, food, now } = deps;
  const { budget } = food;
  const post = [auth, admin, limitBody(BODY_LIMITS.small)] as const;

  const actorOf = (c: Context<AppEnv>): Actor => ({
    user: currentUser(c),
    sessionHash: currentSessionHash(c),
  });

  async function parse<S extends z.ZodType>(c: Context<AppEnv>, schema: S): Promise<z.output<S> | Response> {
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = schema.safeParse(body.value);
    return parsed.success ? parsed.data : badRequest(c, describeIssue(parsed.error));
  }

  /** Raw ids from the body are looked up first (§4 item 1): unknown → 404. */
  const target = (c: Context<AppEnv>, userId: string): UserRow | Response =>
    users.byId(userId) ?? apiError(c, 404, 'not_found', MESSAGES.notFound);

  /** Runs an account operation and maps its typed errors. */
  async function run(c: Context<AppEnv>, fn: () => Response | Promise<Response>): Promise<Response> {
    try {
      return await fn();
    } catch (err) {
      const mapped = accountErrorResponse(c, err);
      if (mapped) return mapped;
      throw err;
    }
  }

  app.get(API.adminUsers, auth, admin, (c) => {
    const at = now();
    const me = currentUser(c);
    const usage = budget.usage(at);
    const limits = budget.limits();
    const list: AdminUser[] = users.list().map((u) => {
      const ai = usage.byUser.get(u.id);
      return {
        id: u.id,
        username: u.username,
        role: u.role,
        status: statusOf(u),
        createdAt: u.createdAt,
        lastSeenAt: u.lastSeenAt,
        ai: {
          today: ai?.today ?? 0,
          last30Days: ai?.last30Days ?? 0,
          limit: u.aiDailyLimit ?? limits.perUser,
          customLimit: u.aiDailyLimit,
        },
        self: u.id === me.id,
      };
    });
    const res: AdminOverview = {
      users: list,
      invites: tokens.pendingInvites(at),
      limits,
      aiToday: { used: usage.globalToday, ceiling: limits.global },
    };
    return c.json(res);
  });

  app.post(API.adminInviteCreate, ...post, async (c) => {
    const input = await parse(c, createInviteRequestSchema);
    if (input instanceof Response) return input;
    return run(c, () => {
      // UI invites are always for regular users (D19); promotion is one tap afterwards.
      const link = accounts.createInviteLink({
        role: 'user',
        note: input.note,
        createdBy: currentUser(c).id,
        now: now(),
      });
      const res: InviteCreatedResponse = {
        ok: true,
        path: link.path,
        expiresAt: link.expiresAt,
        invite: link.invite,
      };
      return c.json(res);
    });
  });

  app.post(API.adminInviteRevoke, ...post, async (c) => {
    const input = await parse(c, inviteIdRequestSchema);
    if (input instanceof Response) return input;
    if (!tokens.revokeInvite(input.id, now())) return apiError(c, 404, 'not_found', MESSAGES.notFound);
    deps.logger.info(`invite ${input.id} revoked by user ${currentUser(c).id}`);
    return c.json(OK);
  });

  app.post(API.adminResetLink, ...post, async (c) => {
    const input = await parse(c, userTargetRequestSchema);
    if (input instanceof Response) return input;
    const user = target(c, input.userId);
    if (user instanceof Response) return user;
    return run(c, () => {
      try {
        const link = accounts.createResetLink({ userId: user.id, createdBy: currentUser(c).id, now: now() });
        const res: LinkResponse = { ok: true, path: link.path, expiresAt: link.expiresAt };
        return c.json(res);
      } catch (err) {
        // Not the person's own login being refused: the admin's request conflicts with the account's state.
        if (err instanceof AccountDisabled)
          return apiError(c, 409, 'account_disabled', MESSAGES.accountDisabled);
        throw err;
      }
    });
  });

  app.post(API.adminSetRole, ...post, async (c) => {
    const input = await parse(c, setRoleRequestSchema);
    if (input instanceof Response) return input;
    const user = target(c, input.userId);
    if (user instanceof Response) return user;
    return run(c, () => {
      accounts.setRole(actorOf(c), user.id, input.role, now());
      return c.json(OK);
    });
  });

  app.post(API.adminSetDisabled, ...post, async (c) => {
    const input = await parse(c, setDisabledRequestSchema);
    if (input instanceof Response) return input;
    const user = target(c, input.userId);
    if (user instanceof Response) return user;
    return run(c, () => {
      accounts.setDisabled(actorOf(c), user.id, input.disabled, now());
      return c.json(OK);
    });
  });

  app.post(API.adminDeleteUser, ...post, async (c) => {
    const input = await parse(c, deleteUserRequestSchema);
    if (input instanceof Response) return input;
    const user = target(c, input.userId);
    if (user instanceof Response) return user;
    return run(c, () => {
      accounts.deleteUser(actorOf(c), user.id, input.confirmUsername, now());
      return c.json(OK);
    });
  });

  app.post(API.adminUserAiLimit, ...post, async (c) => {
    const input = await parse(c, userAiLimitRequestSchema);
    if (input instanceof Response) return input;
    const user = target(c, input.userId);
    if (user instanceof Response) return user;
    users.setAiLimit(user.id, input.limit);
    deps.logger.info(
      `user ${user.id} AI limit set to ${input.limit ?? 'default'} by user ${currentUser(c).id}`,
    );
    return c.json(OK);
  });

  app.post(API.adminAiLimits, ...post, async (c) => {
    const input = await parse(c, aiLimitsSchema);
    if (input instanceof Response) return input;
    budget.setLimits(input);
    deps.logger.info(
      `AI limits set to per user ${input.perUser}, global ${input.global} by user ${currentUser(c).id}`,
    );
    return c.json(OK);
  });
}
