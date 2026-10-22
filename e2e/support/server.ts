/**
 * Direct access to the e2e server's HTTP API (outside the browser): log in as an account, replace its data, read
 * what actually reached the server, and — as the admin — manage accounts and one-time links
 * (docs/multi-user.md §11.3).
 *
 * The two built-in accounts come from the server's dev bootstrap: `USER` («anna», role user, the legacy owner) and
 * `ADMIN` («admin»). Specs never change their password, name, role or state; throwaway accounts come from
 * `createUser()`.
 */
import {
  expect,
  type APIRequestContext,
  type APIResponse,
  type BrowserContext,
  type PlaywrightWorkerArgs,
} from '@playwright/test';
import {
  API,
  meResponseSchema,
  tokenFromHash,
  USER_HEADER,
  USERNAME_LIMITS,
  usernameKey,
  type AdminOverview,
  type AiLimits,
  type AppData,
  type InviteCreatedResponse,
  type LinkResponse,
  type SessionUser,
  type UserRole,
  type WorkoutSession,
} from '../../packages/shared/src/index';
import { ADMIN_PASSWORD, ADMIN_USERNAME, BASE_URL, PASSWORD, USERNAME } from './env';

export interface Credentials {
  username: string;
  password: string;
}

/** The built-in `playwright` fixture (its `request.newContext()` makes a separate cookie jar). */
export type Playwright = PlaywrightWorkerArgs['playwright'];

/** «anna»: an ordinary user (the legacy owner); the default account of every helper. */
export const USER: Credentials = Object.freeze({ username: USERNAME, password: PASSWORD });
/** «admin»: the one admin. */
export const ADMIN: Credentials = Object.freeze({ username: ADMIN_USERNAME, password: ADMIN_PASSWORD });

type Headers = Record<string, string>;

/** Mutating requests need a same-origin `Origin` header (CSRF guard) and a JSON body. */
const MUTATION_HEADERS: Headers = { Origin: BASE_URL, 'Content-Type': 'application/json' };

/** `base` with `override` on top; header names are case-insensitive, so an override replaces any spelling of it. */
function mergeHeaders(base: Headers, override: Headers = {}): Headers {
  const replaced = new Set(Object.keys(override).map((name) => name.toLowerCase()));
  const kept = Object.entries(base).filter(([name]) => !replaced.has(name.toLowerCase()));
  return { ...Object.fromEntries(kept), ...override };
}

const urlOf = (path: string): string => (/^https?:\/\//.test(path) ? path : `${BASE_URL}${path}`);

/** The `user` of a `MeResponse` / `LoginResponse`, validated against the shared contract. */
async function sessionUserOf(res: APIResponse, what: string): Promise<SessionUser> {
  const body: unknown = await res.json();
  const parsed = meResponseSchema.safeParse(body);
  if (!parsed.success) throw new Error(`${what}: unexpected answer ${JSON.stringify(body)}`);
  return parsed.data.user;
}

/** Logs `request` in as `creds` (its cookie jar keeps the `sid` cookie) and returns the signed-in account. */
export async function apiLogin(request: APIRequestContext, creds: Credentials = USER): Promise<SessionUser> {
  const res = await request.post(urlOf(API.login), {
    data: { username: creds.username, password: creds.password },
    headers: MUTATION_HEADERS,
  });
  expect(res.status(), `login as ${creds.username} failed: ${await res.text()}`).toBe(200);
  return sessionUserOf(res, `login as ${creds.username}`);
}

/**
 * Logs a browser context in without the UI: the cookie set by the API response lands in the context's cookie jar,
 * so the next page load starts authenticated as `creds`.
 */
export const loginContext = (context: BrowserContext, creds: Credentials = USER): Promise<SessionUser> =>
  apiLogin(context.request, creds);

/** The token of a one-time link path or URL (`/invite#<token>`, `https://…/reset#<token>`). */
export function tokenOf(path: string): string {
  const hashAt = path.indexOf('#');
  const token = hashAt < 0 ? null : tokenFromHash(path.slice(hashAt));
  if (token === null) throw new Error(`no one-time link token in ${JSON.stringify(path)}`);
  return token;
}

export class ServerApi {
  private user: SessionUser | null = null;
  private readonly invites: string[] = [];

  constructor(
    readonly request: APIRequestContext,
    readonly creds: Credentials = USER,
  ) {}

  /** Logs in as `creds` and remembers the account: its id is the default `X-Legko-User`. */
  async login(): Promise<SessionUser> {
    this.user = await apiLogin(this.request, this.creds);
    return this.user;
  }

  /** Binds this client to a session its request context already holds (e.g. right after an invite accept). */
  useSession(user: SessionUser): void {
    this.user = user;
  }

  /** The account remembered by `login()` / `me()` / `useSession()`. */
  get account(): SessionUser {
    if (!this.user) throw new Error(`ServerApi(${this.creds.username}): not logged in yet — call login() first`);
    return this.user;
  }

  /** The remembered account's id. */
  get id(): string {
    return this.account.id;
  }

  /**
   * `GET /api/auth/me` (expects 200). Remembers the answer when no account is remembered yet or it is the same one
   * (fresh role / name); a session that now belongs to someone else does not change the remembered account.
   */
  async me(): Promise<SessionUser> {
    const res = await this.request.get(urlOf(API.me));
    expect(res.status(), `me (${this.creds.username}) failed: ${await res.text()}`).toBe(200);
    const user = await sessionUserOf(res, 'me');
    if (!this.user || this.user.id === user.id) this.user = user;
    return user;
  }

  /** `POST /api/auth/logout` (always 200); the remembered account stays (for header checks). */
  async logout(): Promise<void> {
    const res = await this.rawPost(API.logout, {});
    expect(res.status(), `logout failed: ${await res.text()}`).toBe(200);
  }

  private async ownId(): Promise<string> {
    return this.user?.id ?? (await this.me()).id;
  }

  /** Mutation headers + `X-Legko-User` = this account (D11), then `headers` on top. */
  private async dataHeaders(headers?: Headers): Promise<Headers> {
    return mergeHeaders({ ...MUTATION_HEADERS, [USER_HEADER]: await this.ownId() }, headers);
  }

  /** Replaces this account's data on the server (`POST /api/import`, expects 200). */
  async importData(data: AppData, headers?: Headers): Promise<void> {
    const res = await this.request.post(urlOf(API.import), { data, headers: await this.dataHeaders(headers) });
    expect(res.status(), `import (${this.creds.username}) failed: ${await res.text()}`).toBe(200);
  }

  /** What the server currently stores for this account (`GET /api/data`, expects 200). */
  async getData(headers?: Headers): Promise<AppData> {
    const res = await this.request.get(urlOf(API.data), {
      headers: mergeHeaders({ [USER_HEADER]: await this.ownId() }, headers),
    });
    expect(res.status(), `data (${this.creds.username}) failed: ${await res.text()}`).toBe(200);
    return (await res.json()) as AppData;
  }

  /**
   * Sends raw ops (`POST /api/ops` with the mutation headers and `X-Legko-User`), e.g. the exact shapes an old
   * client sends. Returns the response unchecked: the caller asserts the status (200, 400 `invalid_op` with an
   * index, 409 `user_mismatch`…). Without the header at all: `rawPost(API.ops, { ops })`.
   */
  async sendOps(ops: unknown[], headers?: Headers): Promise<APIResponse> {
    return this.request.post(urlOf(API.ops), { data: { ops }, headers: await this.dataHeaders(headers) });
  }

  /** This account's backup file (`GET /api/export`, expects 200), parsed. */
  async exportData(): Promise<AppData> {
    const res = await this.request.get(urlOf(API.export));
    expect(res.status(), `export (${this.creds.username}) failed: ${await res.text()}`).toBe(200);
    return (await res.json()) as AppData;
  }

  /** `POST path` with only the mutation headers (no `X-Legko-User`) + `headers`; unchecked. */
  rawPost(path: string, body: unknown, headers?: Headers): Promise<APIResponse> {
    return this.request.post(urlOf(path), { data: body, headers: mergeHeaders(MUTATION_HEADERS, headers) });
  }

  /** `GET path` with only `headers` (no `X-Legko-User`); unchecked. */
  rawGet(path: string, headers?: Headers): Promise<APIResponse> {
    return this.request.get(urlOf(path), { headers: headers ?? {} });
  }

  // ── Admin (the client must be logged in as an admin) ──────────────────────────────────────────────────────

  private async adminPost<T>(path: string, body: unknown, what: string): Promise<T> {
    const res = await this.rawPost(path, body);
    expect(res.status(), `${what} (${this.creds.username}) failed: ${await res.text()}`).toBe(200);
    return (await res.json()) as T;
  }

  /** `GET /api/admin/users`: accounts, pending invites, AI limits. */
  async overview(): Promise<AdminOverview> {
    const res = await this.request.get(urlOf(API.adminUsers));
    expect(res.status(), `admin overview (${this.creds.username}) failed: ${await res.text()}`).toBe(200);
    return (await res.json()) as AdminOverview;
  }

  /** Creates an invite (role user) and records its id (`createdInvites`). */
  async createInvite(note = ''): Promise<{ path: string; token: string; inviteId: string; expiresAt: number }> {
    const res = await this.adminPost<InviteCreatedResponse>(API.adminInviteCreate, { note }, 'create invite');
    this.invites.push(res.invite.id);
    return { path: res.path, token: tokenOf(res.path), inviteId: res.invite.id, expiresAt: res.expiresAt };
  }

  /** Ids of every invite this client created, oldest first (used, revoked or pending). */
  get createdInvites(): readonly string[] {
    return this.invites;
  }

  /** Revokes a pending invite (expects 200). */
  async revokeInvite(id: string): Promise<void> {
    await this.adminPost(API.adminInviteRevoke, { id }, 'revoke invite');
  }

  /** Revokes every pending invite of the overview; returns how many were revoked (the auto fixture runs it). */
  async revokePendingInvites(): Promise<number> {
    const { invites } = await this.overview();
    let revoked = 0;
    for (const invite of invites) {
      const res = await this.rawPost(API.adminInviteRevoke, { id: invite.id });
      // Used or revoked in the meantime.
      if (res.status() === 404) continue;
      expect(res.status(), `revoke invite ${invite.id} failed: ${await res.text()}`).toBe(200);
      revoked += 1;
    }
    return revoked;
  }

  /** A reset link for `userId` (a setup link when the account has no password yet). */
  async resetLink(userId: string): Promise<{ path: string; token: string; expiresAt: number }> {
    const res = await this.adminPost<LinkResponse>(API.adminResetLink, { userId }, 'reset link');
    return { path: res.path, token: tokenOf(res.path), expiresAt: res.expiresAt };
  }

  async setRole(userId: string, role: UserRole): Promise<void> {
    await this.adminPost(API.adminSetRole, { userId, role }, `set role ${role}`);
  }

  async setDisabled(userId: string, disabled: boolean): Promise<void> {
    await this.adminPost(API.adminSetDisabled, { userId, disabled }, disabled ? 'disable user' : 'enable user');
  }

  /** Deletes an account with all its data; `confirmUsername` must be its name (case-insensitive). */
  async deleteUser(userId: string, confirmUsername: string): Promise<void> {
    await this.adminPost(API.adminDeleteUser, { userId, confirmUsername }, 'delete user');
  }

  /** Saves the global AI limits (restore them in `afterEach`). */
  async setAiLimits(limits: AiLimits): Promise<void> {
    await this.adminPost(API.adminAiLimits, { perUser: limits.perUser, global: limits.global }, 'set AI limits');
  }

  /** One account's own AI limit; null = back to the default. */
  async setUserAiLimit(userId: string, limit: number | null): Promise<void> {
    await this.adminPost(API.adminUserAiLimit, { userId, limit }, 'set user AI limit');
  }

  /** The id of the account named `username` (case-insensitive), from the overview. */
  async userId(username: string): Promise<string> {
    const key = usernameKey(username);
    const found = (await this.overview()).users.find((u) => usernameKey(u.username) === key);
    if (!found) throw new Error(`no account named ${JSON.stringify(username)}`);
    return found.id;
  }
}

let uniqueCounter = 0;

/**
 * A username nobody has yet: `prefix` (lower-cased, [a-z0-9] only) + the time in base36 + a counter; ≤ 32
 * characters of [a-z0-9], never `admin` or `legko`.
 */
export function uniqueUsername(prefix = 'u'): string {
  const suffix = `${Date.now().toString(36)}${(uniqueCounter++).toString(36)}`;
  const head = prefix.toLowerCase().replace(/[^a-z0-9]/g, '') || 'u';
  return `${head.slice(0, Math.max(1, USERNAME_LIMITS.max - suffix.length))}${suffix}`.slice(0, USERNAME_LIMITS.max);
}

export interface TestUser {
  /** Logged in as the new account (its own request context and cookie jar). */
  api: ServerApi;
  creds: Credentials;
  id: string;
  user: SessionUser;
  /** Disposes the request context and deletes the account (if it still exists, under its current name). */
  dispose(): Promise<void>;
}

/**
 * A throwaway account (role user): `admin` creates an invite, a fresh request context accepts it (and stays logged
 * in as the new account). Call `dispose()` in a `finally`.
 */
export async function createUser(
  playwright: Playwright,
  admin: ServerApi,
  opts: { username?: string; password?: string } = {},
): Promise<TestUser> {
  const username = opts.username ?? uniqueUsername();
  const password = opts.password ?? `e2e-pw-${username}`;
  const { token } = await admin.createInvite(`e2e ${username}`.slice(0, 60));
  const request = await playwright.request.newContext({ baseURL: BASE_URL });
  let user: SessionUser;
  try {
    const res = await request.post(urlOf(API.inviteAccept), {
      data: { token, username, password },
      headers: MUTATION_HEADERS,
    });
    expect(res.status(), `invite accept for ${username} failed: ${await res.text()}`).toBe(200);
    user = await sessionUserOf(res, `invite accept for ${username}`);
  } catch (error) {
    await request.dispose();
    throw error;
  }

  const creds: Credentials = { username, password };
  const api = new ServerApi(request, creds);
  api.useSession(user);
  let disposed = false;
  return {
    api,
    creds,
    id: user.id,
    user,
    async dispose() {
      if (disposed) return;
      disposed = true;
      await request.dispose();
      const current = (await admin.overview()).users.find((u) => u.id === user.id);
      if (current) await admin.deleteUser(user.id, current.username);
    },
  };
}

/** The stored workout session `id` of `data` (server copy or device copy), or undefined. */
export const sessionOf = (data: AppData, id: string): WorkoutSession | undefined =>
  (data.sessions ?? []).find((s) => s.id === id);
