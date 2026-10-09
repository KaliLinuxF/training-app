import type { MiddlewareHandler } from 'hono';
import { apiError, MESSAGES } from '../errors';
import { isJsonContentType, normalizeOrigin, requestOrigin } from '../request';
import type { AppEnv } from '../types';

/** The Vite dev server (proxying `/api` to us). */
export const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173'] as const;

/** Outside production any loopback dev server may call us (several dev stacks can run side by side). */
const LOOPBACK_DEV_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1|\[::1\]):\d{1,5}$/;

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface MutationGuardOptions {
  publicOrigin: string;
  production: boolean;
  trustProxy: boolean;
}

/**
 * CSRF guard for every non-GET request: the `Origin` must be ours (public origin, the origin the
 * request was addressed to, or the dev server outside production) and the body must be JSON
 * (which a cross-site form cannot send). Both failures → 403 `forbidden_origin`.
 */
export function mutationGuard({
  publicOrigin,
  production,
  trustProxy,
}: MutationGuardOptions): MiddlewareHandler<AppEnv> {
  const allowed = new Set<string>([publicOrigin, ...(production ? [] : DEV_ORIGINS)]);
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();
    const origin = normalizeOrigin(c.req.header('origin'));
    const devLoopback = !production && origin !== null && LOOPBACK_DEV_ORIGIN.test(origin);
    if (!origin || !(allowed.has(origin) || devLoopback || origin === requestOrigin(c, trustProxy))) {
      return apiError(c, 403, 'forbidden_origin', MESSAGES.forbiddenOrigin);
    }
    if (!isJsonContentType(c.req.header('content-type'))) {
      return apiError(c, 403, 'forbidden_origin', MESSAGES.needsJson);
    }
    return next();
  };
}
