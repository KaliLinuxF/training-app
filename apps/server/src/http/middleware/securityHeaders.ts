import type { MiddlewareHandler } from 'hono';

export const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "img-src 'self' data: blob:",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self'",
  "worker-src 'self'",
  "manifest-src 'self'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export function securityHeaders({ hsts }: { hsts: boolean }): MiddlewareHandler {
  const headers: [string, string][] = [
    ['Content-Security-Policy', CONTENT_SECURITY_POLICY],
    ['X-Content-Type-Options', 'nosniff'],
    ['X-Frame-Options', 'DENY'],
    ['Referrer-Policy', 'strict-origin-when-cross-origin'],
    ['Cross-Origin-Opener-Policy', 'same-origin'],
    ['Cross-Origin-Resource-Policy', 'same-origin'],
    ['Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'],
  ];
  if (hsts) headers.push(['Strict-Transport-Security', 'max-age=31536000']);
  return async (c, next) => {
    await next();
    for (const [name, value] of headers) c.header(name, value);
  };
}

/**
 * API responses are personal data: never store them in any cache — unless the route chose a
 * policy itself (immutable food photos: `private`, i.e. the browser cache only).
 */
export const noStore: MiddlewareHandler = async (c, next) => {
  await next();
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store');
};
