/**
 * HTTP API contract between `apps/web` and `apps/server` (accounts: docs/multi-user.md §6).
 * All bodies are JSON. The public routes are `health`, `auth/login`, `auth/logout`, `auth/invite/*` and
 * `auth/reset/*`; every other `/api/*` route (`auth/me` included) needs a session cookie, and `admin/*` an admin's.
 * Every request acts on the signed-in user's own data only. `GET /api/data`, `POST /api/ops` and `POST /api/import`
 * carry `X-Legko-User: <device user id>` (`USER_HEADER`, D11): a different id — or no header on a session created
 * by a v4 login — answers 409 `user_mismatch` with nothing applied. Mutating requests must send
 * `Content-Type: application/json` and a same-origin `Origin` header.
 */
import type { AppData } from './types';
import type { AdminInvite, LinkProblem, SessionUser } from './users';

export const API = {
  health: '/api/health', // GET  → HealthResponse
  login: '/api/auth/login', // POST { username?, password } → LoginResponse (sets cookie) | 401 bad_credentials (401 bad_password «Неправильний пароль» when no username: the pre-v4 bundle, D24) | 403 account_disabled | 429
  logout: '/api/auth/logout', // POST → OkResponse (clears cookie)
  me: '/api/auth/me', // GET  → MeResponse | 401
  data: '/api/data', // GET  → AppData (+ X-Legko-User)
  ops: '/api/ops', // POST { ops: Op[] } → OpsResponse (+ X-Legko-User)
  export: '/api/export', // GET  → AppData as a downloadable JSON file (only the signed-in user's)
  import: '/api/import', // POST AppData → OkResponse (replaces the signed-in user's data; + X-Legko-User)
  pushKey: '/api/push/public-key', // GET  → PushKeyResponse
  pushSubscribe: '/api/push/subscribe', // POST PushSubscribeRequest → OkResponse | 403 forbidden (another user's endpoint)
  pushUnsubscribe: '/api/push/unsubscribe', // POST { endpoint, auth? } → OkResponse
  pushTest: '/api/push/test', // POST → PushTestResponse
  foodStatus: '/api/food/status', // GET  → FoodStatusResponse
  foodEstimate: '/api/food/estimate', // POST FoodEstimateRequest → FoodEstimateResponse | 429 | 503 ai_unavailable | 502 ai_failed
  inviteCheck: '/api/auth/invite/check', // POST { token } → InviteCheckResponse | 410 link_invalid
  inviteAccept: '/api/auth/invite/accept', // POST { token, username, password } → LoginResponse (sets cookie)
  resetCheck: '/api/auth/reset/check', // POST { token } → ResetCheckResponse | 410 link_invalid
  resetComplete: '/api/auth/reset/complete', // POST { token, password } → LoginResponse (sets cookie)
  accountPassword: '/api/account/password', // POST { currentPassword, newPassword } → OkResponse (+ a fresh cookie, D26)
  accountUsername: '/api/account/username', // POST { username, password } → MeResponse
  adminUsers: '/api/admin/users', // GET  → AdminOverview
  adminInviteCreate: '/api/admin/invites', // POST { note? } → InviteCreatedResponse | 409 limit_reached
  adminInviteRevoke: '/api/admin/invites/revoke', // POST { id } → OkResponse | 404
  adminResetLink: '/api/admin/users/reset-link', // POST { userId } → LinkResponse | 404 | 409 account_disabled
  adminSetRole: '/api/admin/users/role', // POST { userId, role } → OkResponse | 404 | 409 last_admin
  adminSetDisabled: '/api/admin/users/disable', // POST { userId, disabled } → OkResponse | 404 | 409 last_admin / self_action
  adminDeleteUser: '/api/admin/users/delete', // POST { userId, confirmUsername } → OkResponse | 400 | 404 | 409
  adminUserAiLimit: '/api/admin/users/ai-limit', // POST { userId, limit } → OkResponse | 404
  adminAiLimits: '/api/admin/ai-limits', // POST { perUser, global } → OkResponse | 400
} as const;

/** Stored food photo (JPEG): full size and thumbnail. Auth required, immutable. */
export const photoUrl = (id: string): string => `/api/photos/${encodeURIComponent(id)}`;
export const photoThumbUrl = (id: string): string => `/api/photos/${encodeURIComponent(id)}/thumb`;

export interface OkResponse {
  ok: true;
}

export interface HealthResponse {
  ok: true;
  version: string;
}

export interface OpsResponse {
  ok: true;
  applied: number;
}

export interface PushKeyResponse {
  key: string;
}

export interface PushTestResponse {
  ok: true;
  sent: number;
}

/** `GET /api/auth/me` (was `OkResponse`; old clients only read the status). */
export interface MeResponse {
  ok: true;
  user: SessionUser;
}

/** `POST /api/auth/login`, `/api/auth/invite/accept`, `/api/auth/reset/complete`. */
export type LoginResponse = MeResponse;

export interface InviteCheckResponse {
  ok: true;
  expiresAt: number;
}

export interface ResetCheckResponse {
  ok: true;
  /** Whose password the link sets. */
  username: string;
  /** `setup` = the account has no password yet. */
  purpose: 'reset' | 'setup';
  expiresAt: number;
}

/** A freshly created one-time link: `path` = `/invite#<token>` or `/reset#<token>` (shown once, never logged). */
export interface LinkResponse {
  ok: true;
  path: string;
  expiresAt: number;
}

export interface InviteCreatedResponse extends LinkResponse {
  invite: AdminInvite;
}

export interface FoodStatusResponse {
  /** False when the server has no Anthropic API key — the UI hides the AI buttons. */
  enabled: boolean;
  /**
   * Estimates left today: the smaller of this user's and the global allowance, a whole number ≥ 0 and never
   * above `limitToday`.
   */
  remainingToday: number;
  /** This user's daily limit (absent from older servers); always ≥ `remainingToday`. */
  limitToday?: number;
}

export interface FoodEstimateItem {
  name: string;
  portion: string;
  kcal: number;
  /**
   * Grams of protein / fat / carbohydrate in that portion (0.5 g steps, 0–1 000), or null when the model gave no
   * usable number. Always set by the server (required, so every place that rebuilds an item keeps them).
   */
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}

export interface FoodEstimateResponse {
  /**
   * Id of the stored photo when one was sent (or, when recalculating, the `photoId` that was passed);
   * reference it from the meal's `photos` when saving.
   */
  photoId: string | null;
  /** When recalculating: exactly the sent items, same order, names/portions as sent, new kcal and macros. */
  items: FoodEstimateItem[];
  totalKcal: number;
  /** Short Ukrainian remark from the model (uncertainty, «це не схоже на їжу», …); may be empty. */
  comment: string;
}

/** Error body for every non-2xx response. */
export interface ErrorResponse {
  error: ApiErrorCode;
  message: string;
  /** For `invalid_op`: index of the rejected op in the request. */
  index?: number;
  /** For `link_invalid`: why the one-time link cannot be used. */
  reason?: LinkProblem;
}

export type ApiErrorCode =
  | 'unauthorized'
  /** Pre-v4 login failure; no longer sent (kept for old clients). */
  | 'bad_password'
  | 'bad_credentials'
  | 'account_disabled'
  | 'forbidden'
  | 'user_mismatch'
  | 'link_invalid'
  | 'username_taken'
  | 'invalid_username'
  | 'weak_password'
  | 'wrong_password'
  | 'last_admin'
  | 'self_action'
  | 'limit_reached'
  | 'rate_limited'
  | 'bad_request'
  | 'invalid_op'
  | 'forbidden_origin'
  | 'not_found'
  | 'push_unavailable'
  | 'ai_unavailable'
  | 'ai_failed'
  | 'payload_too_large'
  | 'internal';

export type DataResponse = AppData;

/** Deep links used by push notifications and the service worker. */
export const DEEP_LINKS = {
  workout: '/?sheet=day&trained=1',
  weigh: '/?sheet=weight',
  measure: '/?sheet=measure',
} as const;

/** «Налаштування → Нагадування» (the test notification opens it; the old `/reminders` redirects here). */
export const SETTINGS_REMINDERS_PATH = '/settings/reminders';
