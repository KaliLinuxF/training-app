/**
 * HTTP API contract between `apps/web` and `apps/server`.
 * All bodies are JSON; all `/api/*` routes except `health`, `auth/login` and `auth/me`
 * require the session cookie. Mutating requests must send `Content-Type: application/json`
 * and a same-origin `Origin` header.
 */
import type { AppData } from './types';

export const API = {
  health: '/api/health', // GET  → HealthResponse
  login: '/api/auth/login', // POST LoginRequest → OkResponse (sets cookie) | 401 | 429
  logout: '/api/auth/logout', // POST → OkResponse (clears cookie)
  me: '/api/auth/me', // GET  → OkResponse | 401
  data: '/api/data', // GET  → AppData
  ops: '/api/ops', // POST { ops: Op[] } → OpsResponse
  export: '/api/export', // GET  → AppData as a downloadable JSON file
  import: '/api/import', // POST AppData → OkResponse (replaces everything)
  pushKey: '/api/push/public-key', // GET  → PushKeyResponse
  pushSubscribe: '/api/push/subscribe', // POST PushSubscribeRequest → OkResponse
  pushUnsubscribe: '/api/push/unsubscribe', // POST { endpoint } → OkResponse
  pushTest: '/api/push/test', // POST → PushTestResponse
  foodStatus: '/api/food/status', // GET  → FoodStatusResponse
  foodEstimate: '/api/food/estimate', // POST FoodEstimateRequest → FoodEstimateResponse | 429 | 503 ai_unavailable | 502 ai_failed
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

export interface FoodStatusResponse {
  /** False when the server has no Anthropic API key — the UI hides the AI buttons. */
  enabled: boolean;
  /** Estimates left today under the daily budget guard. */
  remainingToday: number;
}

export interface FoodEstimateItem {
  name: string;
  portion: string;
  kcal: number;
}

export interface FoodEstimateResponse {
  /** Id of the stored photo when one was sent; reference it from `DayEntry.photos` when adding. */
  photoId: string | null;
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
}

export type ApiErrorCode =
  | 'unauthorized'
  | 'bad_password'
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
