import {
  API,
  coachClientPath,
  coachClientsPath,
  meResponseSchema,
  USER_HEADER,
  type AdminOverview,
  type ApiErrorCode,
  type AppData,
  type CoachClientResponse,
  type CoachClientsResponse,
  type CoachWindow,
  type ErrorResponse,
  type FoodEstimateRequest,
  type FoodEstimateResponse,
  type FoodStatusResponse,
  type HealthResponse,
  type InviteCheckResponse,
  type InviteCreatedResponse,
  type LinkProblem,
  type LinkResponse,
  type LoginResponse,
  type MeResponse,
  type OkResponse,
  type Op,
  type OpsResponse,
  type PushKeyResponse,
  type PushTestResponse,
  type ResetCheckResponse,
  type UserRole,
} from '@legko/shared';

/**
 * Default limit for one request, response body included. A weak or captive network can leave a
 * fetch hanging for about a minute; giving up earlier lets the sync worker back off and retry,
 * and keeps start-up and logout from waiting on it.
 */
export const REQUEST_TIMEOUT_MS = 15_000;
/** The AI estimate itself may take up to a minute on the server. */
export const FOOD_ESTIMATE_TIMEOUT_MS = 60_000;
/** A backup upload carries all data at once, which can be slow on a phone connection. */
export const IMPORT_TIMEOUT_MS = 60_000;

export const NETWORK_MESSAGES = {
  offline: 'Немає зʼєднання з сервером',
  timeout: 'Сервер не відповідає',
} as const;

/** A 2xx answer without the account it must carry: an older server (a rollback, docs/multi-user.md §10). */
export const OUTDATED_SERVER_MESSAGE = 'Сервер відповів у застарілому форматі';

/**
 * `network` — the server could not be reached (or answered too slowly);
 * `outdated_server` — a 2xx `me` / login / link / rename answer without a valid `user` (client-side only).
 */
export type ApiErrorClientCode = ApiErrorCode | 'network' | 'outdated_server';

const LINK_PROBLEMS: readonly LinkProblem[] = ['unknown', 'expired', 'used', 'revoked'];

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorClientCode;
  readonly index: number | undefined;
  /** For `link_invalid` (410): why the one-time link cannot be used. */
  readonly reason: LinkProblem | undefined;

  constructor(status: number, code: ApiErrorClientCode, message: string, index?: number, reason?: LinkProblem) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.index = index;
    this.reason = reason;
  }

  /** Server unreachable / offline / too slow — safe to retry later. */
  get isNetwork(): boolean {
    return this.code === 'network' || this.status >= 500;
  }
}

export interface RequestOptions {
  /** Cancels the request; it then rejects with `ApiError('network')` (check `signal.aborted`). */
  signal?: AbortSignal;
  /** Gives up after this long with `ApiError('network')`. Default `REQUEST_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Extra request headers (`X-Legko-User`). */
  headers?: Record<string, string>;
}

/**
 * One abort signal for the request: fires on the caller's signal or when the time limit is up.
 * (Hand-rolled: `AbortSignal.any` needs iOS 17.4.)
 */
function requestSignal(signal: AbortSignal | undefined, timeoutMs: number) {
  const controller = new AbortController();
  let timedOut = false;
  const abort = () => controller.abort();
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  if (signal?.aborted) controller.abort();
  else signal?.addEventListener('abort', abort, { once: true });
  return {
    signal: controller.signal,
    networkError: () =>
      new ApiError(0, 'network', timedOut ? NETWORK_MESSAGES.timeout : NETWORK_MESSAGES.offline),
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
    },
  };
}

function linkProblemOf(value: unknown): LinkProblem | undefined {
  return LINK_PROBLEMS.find((p) => p === value);
}

function requestHeaders(method: 'GET' | 'POST', extra: Record<string, string> | undefined) {
  const base: Record<string, string> = method === 'POST' ? { 'Content-Type': 'application/json' } : {};
  const headers = { ...base, ...extra };
  return Object.keys(headers).length > 0 ? headers : undefined;
}

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  { signal, timeoutMs = REQUEST_TIMEOUT_MS, headers }: RequestOptions = {},
): Promise<T> {
  const limit = requestSignal(signal, timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: requestHeaders(method, headers),
        body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
        signal: limit.signal,
      });
    } catch {
      throw limit.networkError();
    }
    if (!res.ok) {
      let err: Partial<ErrorResponse> = {};
      try {
        err = (await res.json()) as ErrorResponse;
      } catch {
        // non-JSON error (proxy page etc.) or the body never arrived
      }
      throw new ApiError(
        res.status,
        err.error ?? 'internal',
        err.message ?? res.statusText,
        err.index,
        linkProblemOf(err.reason),
      );
    }
    try {
      return (await res.json()) as T;
    } catch (err) {
      // The body stalled and the limit (or the caller) cut it off.
      if (limit.signal.aborted) throw limit.networkError();
      throw err;
    }
  } finally {
    limit.dispose();
  }
}

/**
 * A `MeResponse` / `LoginResponse`, validated: a 2xx without a valid `user` (a v3 server answers `{ ok: true }`
 * to `me` and to a `{ username, password }` login alike) is `ApiError('outdated_server')`.
 */
async function withUser(answer: Promise<unknown>): Promise<MeResponse> {
  const body = await answer;
  const parsed = meResponseSchema.safeParse(body);
  if (!parsed.success) throw new ApiError(200, 'outdated_server', OUTDATED_SERVER_MESSAGE);
  return parsed.data;
}

/** `X-Legko-User: <device user id>` (D11): the server refuses (409 `user_mismatch`) a session of anyone else. */
const ownerHeader = (owner: string): Record<string, string> => ({ [USER_HEADER]: owner });

export const api = {
  health: () => request<HealthResponse>('GET', API.health),
  me: (): Promise<MeResponse> => withUser(request<unknown>('GET', API.me)),
  login: (username: string, password: string): Promise<LoginResponse> =>
    withUser(request<unknown>('POST', API.login, { username, password })),
  logout: () => request<OkResponse>('POST', API.logout),
  /** The device user's copy; `owner` = that user's id (sent as `X-Legko-User`). */
  getData: (owner: string) => request<AppData>('GET', API.data, undefined, { headers: ownerHeader(owner) }),
  sendOps: (ops: Op[], owner: string) =>
    request<OpsResponse>('POST', API.ops, { ops }, { headers: ownerHeader(owner) }),
  importData: (data: AppData, owner: string) =>
    request<OkResponse>('POST', API.import, data, { timeoutMs: IMPORT_TIMEOUT_MS, headers: ownerHeader(owner) }),
  /** Plain link target: the browser downloads the JSON file with the session cookie. */
  exportUrl: API.export,

  /** One-time links (`/invite#…`, `/reset#…`): 410 `link_invalid` with `reason` when unusable. */
  inviteCheck: (token: string) => request<InviteCheckResponse>('POST', API.inviteCheck, { token }),
  inviteAccept: (req: { token: string; username: string; password: string }): Promise<LoginResponse> =>
    withUser(request<unknown>('POST', API.inviteAccept, req)),
  resetCheck: (token: string) => request<ResetCheckResponse>('POST', API.resetCheck, { token }),
  resetComplete: (req: { token: string; password: string }): Promise<LoginResponse> =>
    withUser(request<unknown>('POST', API.resetComplete, req)),

  /** The signed-in account («Акаунт»). Online only. */
  account: {
    /** The response sets a fresh session cookie (every other session of the account ends, D26). */
    changePassword: (req: { currentPassword: string; newPassword: string }) =>
      request<OkResponse>('POST', API.accountPassword, req),
    rename: (req: { username: string; password: string }): Promise<MeResponse> =>
      withUser(request<unknown>('POST', API.accountUsername, req)),
  },

  /** «Користувачі» (admins only; 403 `forbidden` for everyone else). Online only. */
  admin: {
    overview: () => request<AdminOverview>('GET', API.adminUsers),
    createInvite: ({ note = '' }: { note?: string } = {}) =>
      request<InviteCreatedResponse>('POST', API.adminInviteCreate, { note }),
    revokeInvite: ({ id }: { id: string }) => request<OkResponse>('POST', API.adminInviteRevoke, { id }),
    resetLink: ({ userId }: { userId: string }) => request<LinkResponse>('POST', API.adminResetLink, { userId }),
    setRole: ({ userId, role }: { userId: string; role: UserRole }) =>
      request<OkResponse>('POST', API.adminSetRole, { userId, role }),
    setDisabled: ({ userId, disabled }: { userId: string; disabled: boolean }) =>
      request<OkResponse>('POST', API.adminSetDisabled, { userId, disabled }),
    deleteUser: ({ userId, confirmUsername }: { userId: string; confirmUsername: string }) =>
      request<OkResponse>('POST', API.adminDeleteUser, { userId, confirmUsername }),
    setUserAiLimit: ({ userId, limit }: { userId: string; limit: number | null }) =>
      request<OkResponse>('POST', API.adminUserAiLimit, { userId, limit }),
    setAiLimits: ({ perUser, global }: { perUser: number; global: number }) =>
      request<OkResponse>('POST', API.adminAiLimits, { perUser, global }),
  },

  /**
   * «Клієнти» (admins only; 403 `forbidden` for everyone else, 404 `not_found` for an id that is not a client).
   * GET only: the coach reads clients' records and never changes them. Online only, never cached on the device.
   */
  coach: {
    clients: (w: CoachWindow) => request<CoachClientsResponse>('GET', coachClientsPath(w)),
    client: (id: string) => request<CoachClientResponse>('GET', coachClientPath(id)),
  },

  pushPublicKey: () => request<PushKeyResponse>('GET', API.pushKey),
  pushSubscribe: (subscription: PushSubscriptionJSON, timezone: string) =>
    request<OkResponse>('POST', API.pushSubscribe, { subscription, timezone }),
  /**
   * `auth` = the browser subscription's own `keys.auth` (D15): with it the server removes the row whoever owns it
   * (a switch to another account), without it only the caller's own row.
   */
  pushUnsubscribe: (endpoint: string, auth?: string) =>
    request<OkResponse>('POST', API.pushUnsubscribe, auth ? { endpoint, auth } : { endpoint }),
  pushTest: () => request<PushTestResponse>('POST', API.pushTest),
  foodStatus: () => request<FoodStatusResponse>('GET', API.foodStatus),
  /**
   * AI calorie estimate from text and/or a downscaled JPEG (base64). Usually ~5–20 s, gives up
   * after `FOOD_ESTIMATE_TIMEOUT_MS`. Aborting `signal` rejects with `ApiError('network')`;
   * check `signal.aborted` to tell it apart.
   */
  foodEstimate: (req: FoodEstimateRequest, signal?: AbortSignal) =>
    request<FoodEstimateResponse>('POST', API.foodEstimate, req, {
      signal,
      timeoutMs: FOOD_ESTIMATE_TIMEOUT_MS,
    }),
};
