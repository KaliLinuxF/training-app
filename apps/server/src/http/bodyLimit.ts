import type { MiddlewareHandler } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { apiError, MESSAGES } from './errors';
import type { AppEnv } from './types';

/**
 * Request body caps in bytes, one per route. They are applied per route, AFTER the session check
 * (`app.post(path, auth, limitBody(…), handler)`): Hono's bodyLimit reads a body that has no
 * Content-Length (chunked, or HTTP/2 through Caddy) into memory up to the cap before the next
 * handler runs, so a cap in front of `auth` would let anyone make the server buffer that much.
 * Login is the only body read without a session, and it is tiny.
 */
export const BODY_LIMITS = {
  /** `{ password }` (≤ 200 characters). */
  login: 4 * 1024,
  /** A full import of years of data, or 500 ops at the schema's text limits (≈ 10.5 MB). */
  bulk: 16 * 1024 * 1024,
  /** Full photo (≤ 2.8 M base64 chars) + thumbnail (≤ 0.4 M) + text, as JSON: ≈ 3.3 MB at most. */
  foodEstimate: 4 * 1024 * 1024,
  /** Push subscribe / unsubscribe (≈ 2.5 KB at the schema limits). */
  small: 64 * 1024,
} as const;

/** 413 `payload_too_large` once the body is over `maxSize` bytes. */
export const limitBody = (maxSize: number, message: string = MESSAGES.tooLarge): MiddlewareHandler<AppEnv> =>
  bodyLimit({ maxSize, onError: (c) => apiError(c, 413, 'payload_too_large', message) });
