import {
  API,
  type ApiErrorCode,
  type AppData,
  type ErrorResponse,
  type FoodEstimateRequest,
  type FoodEstimateResponse,
  type FoodStatusResponse,
  type HealthResponse,
  type OkResponse,
  type Op,
  type OpsResponse,
  type PushKeyResponse,
  type PushTestResponse,
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

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | 'network';
  readonly index: number | undefined;

  constructor(status: number, code: ApiErrorCode | 'network', message: string, index?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.index = index;
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

async function request<T>(
  method: 'GET' | 'POST',
  path: string,
  body?: unknown,
  { signal, timeoutMs = REQUEST_TIMEOUT_MS }: RequestOptions = {},
): Promise<T> {
  const limit = requestSignal(signal, timeoutMs);
  try {
    let res: Response;
    try {
      res = await fetch(path, {
        method,
        credentials: 'same-origin',
        cache: 'no-store',
        headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
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
      throw new ApiError(res.status, err.error ?? 'internal', err.message ?? res.statusText, err.index);
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

export const api = {
  health: () => request<HealthResponse>('GET', API.health),
  me: () => request<OkResponse>('GET', API.me),
  login: (password: string) => request<OkResponse>('POST', API.login, { password }),
  logout: () => request<OkResponse>('POST', API.logout),
  getData: () => request<AppData>('GET', API.data),
  sendOps: (ops: Op[]) => request<OpsResponse>('POST', API.ops, { ops }),
  importData: (data: AppData) =>
    request<OkResponse>('POST', API.import, data, { timeoutMs: IMPORT_TIMEOUT_MS }),
  /** Plain link target: the browser downloads the JSON file with the session cookie. */
  exportUrl: API.export,
  pushPublicKey: () => request<PushKeyResponse>('GET', API.pushKey),
  pushSubscribe: (subscription: PushSubscriptionJSON, timezone: string) =>
    request<OkResponse>('POST', API.pushSubscribe, { subscription, timezone }),
  pushUnsubscribe: (endpoint: string) => request<OkResponse>('POST', API.pushUnsubscribe, { endpoint }),
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
