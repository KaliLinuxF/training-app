import {
  API,
  type ApiErrorCode,
  type AppData,
  type ErrorResponse,
  type HealthResponse,
  type OkResponse,
  type Op,
  type OpsResponse,
  type PushKeyResponse,
  type PushTestResponse,
} from '@legko/shared';

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

  /** Server unreachable / offline — safe to retry later. */
  get isNetwork(): boolean {
    return this.code === 'network' || this.status >= 500;
  }
}

async function request<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: method === 'POST' ? { 'Content-Type': 'application/json' } : undefined,
      body: method === 'POST' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new ApiError(0, 'network', 'Немає зʼєднання з сервером');
  }
  if (!res.ok) {
    let err: Partial<ErrorResponse> = {};
    try {
      err = (await res.json()) as ErrorResponse;
    } catch {
      // non-JSON error (proxy page etc.)
    }
    throw new ApiError(res.status, err.error ?? 'internal', err.message ?? res.statusText, err.index);
  }
  return (await res.json()) as T;
}

export const api = {
  health: () => request<HealthResponse>('GET', API.health),
  me: () => request<OkResponse>('GET', API.me),
  login: (password: string) => request<OkResponse>('POST', API.login, { password }),
  logout: () => request<OkResponse>('POST', API.logout),
  getData: () => request<AppData>('GET', API.data),
  sendOps: (ops: Op[]) => request<OpsResponse>('POST', API.ops, { ops }),
  importData: (data: AppData) => request<OkResponse>('POST', API.import, data),
  /** Plain link target: the browser downloads the JSON file with the session cookie. */
  exportUrl: API.export,
  pushPublicKey: () => request<PushKeyResponse>('GET', API.pushKey),
  pushSubscribe: (subscription: PushSubscriptionJSON, timezone: string) =>
    request<OkResponse>('POST', API.pushSubscribe, { subscription, timezone }),
  pushUnsubscribe: (endpoint: string) => request<OkResponse>('POST', API.pushUnsubscribe, { endpoint }),
  pushTest: () => request<PushTestResponse>('POST', API.pushTest),
};
