import type { Context } from 'hono';
import type { AppEnv } from './types';

/** `scheme://host[:port]` of an http(s) URL, or null. */
export function normalizeOrigin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  try {
    const url = new URL(raw);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.origin : null;
  } catch {
    return null;
  }
}

const firstValue = (header: string | undefined): string | undefined =>
  header?.split(',')[0]?.trim() || undefined;

/** The origin the client used to reach us (proxy headers only when the proxy is trusted). */
export function requestOrigin(c: Context<AppEnv>, trustProxy: boolean): string | null {
  const url = new URL(c.req.url);
  const host =
    (trustProxy ? firstValue(c.req.header('x-forwarded-host')) : undefined) ??
    c.req.header('host') ??
    url.host;
  const proto =
    (trustProxy ? firstValue(c.req.header('x-forwarded-proto')) : undefined) ?? url.protocol.slice(0, -1);
  return normalizeOrigin(`${proto}://${host}`);
}

/**
 * Client address for rate limiting. Behind the proxy the right-most `X-Forwarded-For` entry is
 * the one our own proxy appended, so it cannot be spoofed by the client.
 */
export function clientIp(c: Context<AppEnv>, trustProxy: boolean): string {
  if (trustProxy) {
    const chain = (c.req.header('x-forwarded-for') ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    const last = chain.at(-1);
    if (last) return last;
  }
  return c.env?.incoming?.socket?.remoteAddress ?? 'unknown';
}

export const isJsonContentType = (header: string | undefined): boolean =>
  (header ?? '').split(';')[0]?.trim().toLowerCase() === 'application/json';
