/**
 * Accounts (docs/multi-user.md §3.1, §6.1): usernames, roles, one-time links, AI limits and the shapes the server
 * returns about users. Shared by the server (validation, CLI), the web app (forms, link screens, «Користувачі») and
 * the e2e support layer.
 */

export type UserRole = 'admin' | 'user';
export const USER_ROLES = ['admin', 'user'] as const satisfies readonly UserRole[];

export const USERNAME_LIMITS = { min: 3, max: 32 } as const;
/** Allowed characters and length of a (trimmed) username; it also needs at least one letter or digit. */
export const USERNAME_RE = /^[A-Za-z0-9._-]{3,32}$/;
/** Never usable as a username anywhere: `legko` is the login alias of the legacy owner (D3, D24). */
export const ALIAS_USERNAMES = ['legko'] as const;
/** Refused for invite registration and self-rename (D2); only the CLI / dev bootstrap may use `admin`. */
export const RESERVED_USERNAMES = ['legko', 'admin'] as const;
/** The v4 migration's id for the legacy owner when `kv.legacy_user` names none (D1). */
export const LEGACY_OWNER_ID = '00000000000000000000000000000001';

export const PASSWORD_LIMITS = { min: 8, max: 200 } as const;
export const INVITE_NOTE_MAX = 60;
export const MAX_PENDING_INVITES = 20;
export const INVITE_TTL_MS = 7 * 86_400_000;
/** Reset and setup links. */
export const RESET_TTL_MS = 86_400_000;

export interface AiLimits {
  /** AI estimates per user per (Kyiv) day; a user's own `ai_daily_limit` overrides it. 0 = off. */
  perUser: number;
  /** Ceiling for everybody together per (Kyiv) day. 0 = AI off. */
  global: number;
}

export const DEFAULT_AI_LIMITS: Readonly<AiLimits> = Object.freeze({ perUser: 40, global: 150 });
export const AI_LIMIT_BOUNDS = {
  perUser: { min: 0, max: 1000 },
  global: { min: 0, max: 10_000 },
} as const;

/** Paths of the one-time links; the token travels in the URL fragment (D4): `/invite#<token>`. */
export const LINK_PATHS = { invite: '/invite', reset: '/reset' } as const;
export type LinkKind = keyof typeof LINK_PATHS;
/** Why a one-time link cannot be used (`410 link_invalid` + `reason`), checked in this order. */
export type LinkProblem = 'unknown' | 'expired' | 'used' | 'revoked';

/** Request header with the device user's id (D11), sent with `GET /api/data`, `POST /api/ops` and `POST /api/import`. */
export const USER_HEADER = 'X-Legko-User';

export type UsernameProblem = 'length' | 'chars' | 'reserved';

/** Case-insensitive lookup key of a username (`users.username_key`). */
export function usernameKey(name: string): string {
  return name.trim().toLowerCase();
}

const HAS_LETTER_OR_DIGIT = /[A-Za-z0-9]/;

/**
 * What is wrong with a username someone wants to register or rename to (input is trimmed first), or null.
 * `allowAdmin` (CLI, dev bootstrap) lets `admin` through; `legko` is always `reserved`.
 * Login does not use this: any 1–64 characters are looked up, so an invalid name answers like a wrong one.
 */
export function usernameProblem(name: string, opts: { allowAdmin?: boolean } = {}): UsernameProblem | null {
  const trimmed = name.trim();
  if (trimmed.length < USERNAME_LIMITS.min || trimmed.length > USERNAME_LIMITS.max) return 'length';
  if (!USERNAME_RE.test(trimmed) || !HAS_LETTER_OR_DIGIT.test(trimmed)) return 'chars';
  const key = usernameKey(trimmed);
  if ((ALIAS_USERNAMES as readonly string[]).includes(key)) return 'reserved';
  if ((RESERVED_USERNAMES as readonly string[]).includes(key) && !(key === 'admin' && opts.allowAdmin === true)) {
    return 'reserved';
  }
  return null;
}

/** Path of a one-time link (the UI prefixes `location.origin`, the CLI `PUBLIC_ORIGIN`): `/invite#<token>`. */
export function linkPath(kind: LinkKind, token: string): string {
  return `${LINK_PATHS[kind]}#${token}`;
}

/** 32 random bytes in base64url without padding. */
const HASH_TOKEN_RE = /^#([A-Za-z0-9_-]{43})$/;

/** `'#<43 base64url chars>'` (a `location.hash`) → the token, else null. */
export function tokenFromHash(hash: string): string | null {
  if (typeof hash !== 'string') return null;
  return HASH_TOKEN_RE.exec(hash)?.[1] ?? null;
}

/**
 * The WHATWG `URL` of browsers and Node, as far as `parseLink` needs it (this package compiles without DOM / node
 * types; nothing is emitted, so the global is used at run time).
 */
declare const URL: new (input: string) => {
  readonly protocol: string;
  readonly origin: string;
  readonly pathname: string;
  readonly hash: string;
};

/**
 * A pasted link (D29) → `{ kind, token }` when it is an http(s) URL on `origin` whose path is one of `LINK_PATHS` and
 * whose fragment is a valid token; otherwise null. Never throws.
 */
export function parseLink(value: string, origin: string): { kind: LinkKind; token: string } | null {
  if (typeof value !== 'string' || typeof origin !== 'string') return null;
  let url: InstanceType<typeof URL>;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  if (url.origin !== origin) return null;
  const kind = (Object.keys(LINK_PATHS) as LinkKind[]).find((k) => LINK_PATHS[k] === url.pathname);
  if (!kind) return null;
  const token = tokenFromHash(url.hash);
  return token === null ? null : { kind, token };
}

/** How the current password was set (D28). */
export type PasswordChangeVia = 'self' | 'reset' | 'setup' | 'cli';

export interface PasswordChange {
  at: number;
  via: PasswordChangeVia;
  /** The link creator's username; null = self / CLI / a deleted creator. */
  by: string | null;
}

/** The signed-in account (`GET /api/auth/me`, login, invite accept, reset complete, rename). */
export interface SessionUser {
  /** 32 lowercase hex characters; never reused. */
  id: string;
  /** As typed at registration / rename. */
  username: string;
  role: UserRole;
  createdAt: number;
  /** The account migrated from the single-user installation (owns the legacy device cache, D1). */
  legacyOwner: boolean;
  passwordChange: PasswordChange | null;
}

/** A row of «Користувачі» (admins only): never any of the person's records. */
export interface AdminUser {
  id: string;
  username: string;
  role: UserRole;
  /** `pending` = no password yet (a setup link is due). */
  status: 'active' | 'disabled' | 'pending';
  createdAt: number;
  /** Last activity (requests), not the last login; null = never. */
  lastSeenAt: number | null;
  ai: {
    today: number;
    last30Days: number;
    /** The limit in force today (`customLimit` ?? the per-user default). */
    limit: number;
    /** The account's own limit; null = the default. */
    customLimit: number | null;
  };
  /** The admin looking at the list. */
  self: boolean;
}

/** A pending invite. */
export interface AdminInvite {
  id: string;
  note: string;
  role: UserRole;
  createdAt: number;
  expiresAt: number;
  /**
   * The creator's **username**; null = made in the CLI. (Pending links of demoted / disabled / deleted admins are
   * revoked, D27, so a pending invite never names a deleted creator.)
   */
  createdBy: string | null;
}

/** `GET /api/admin/users`. */
export interface AdminOverview {
  users: AdminUser[];
  invites: AdminInvite[];
  limits: AiLimits;
  aiToday: { used: number; ceiling: number };
}
