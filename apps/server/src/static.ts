import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import type { Context, MiddlewareHandler } from 'hono';
import { getMimeType } from 'hono/utils/mime';

export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const NO_CACHE = 'no-cache';

/** Vite puts every content-hashed file under `/assets/`. */
const isHashedAsset = (urlPath: string): boolean => urlPath.startsWith('/assets/');

export const cacheControlFor = (urlPath: string): string => (isHashedAsset(urlPath) ? IMMUTABLE : NO_CACHE);

export const isApiPath = (urlPath: string): boolean => urlPath === '/api' || urlPath.startsWith('/api/');

/** Maps a URL path to a file under `root`, or null when it could escape `root` or is hidden. */
export function resolveStaticPath(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (segments.some((s) => s === '..' || (s.startsWith('.') && s !== '.well-known'))) return null;
  const relative = decoded.endsWith('/') || segments.length === 0 ? [...segments, 'index.html'] : segments;
  const full = resolve(root, ...relative);
  return full.startsWith(root.endsWith(sep) ? root : root + sep) ? full : null;
}

/** Client-side routes (`/calendar`, `/progress?…`) get `index.html`; missing files with an extension 404. */
function wantsSpaFallback(c: Context, urlPath: string): boolean {
  if (isHashedAsset(urlPath)) return false;
  const last = urlPath.split('/').pop() ?? '';
  return extname(last) === '' || (c.req.header('accept') ?? '').includes('text/html');
}

const etagOf = (size: number, mtimeMs: number): string =>
  `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;

async function fileResponse(c: Context, file: string, urlPath: string): Promise<Response | null> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return null;
  }
  if (!info.isFile()) return null;
  const etag = etagOf(info.size, info.mtimeMs);
  const headers: Record<string, string> = {
    'Content-Type': getMimeType(file) ?? 'application/octet-stream',
    'Cache-Control': cacheControlFor(urlPath),
    ETag: etag,
    'Last-Modified': info.mtime.toUTCString(),
  };
  const ifNoneMatch = c.req.header('if-none-match');
  if (ifNoneMatch && ifNoneMatch.split(',').some((t) => t.trim() === etag)) return c.body(null, 304, headers);
  const body = await readFile(file);
  return c.body(new Uint8Array(body), 200, headers);
}

/**
 * Serves the built web app from `root` (absolute path) with cache headers and the SPA fallback.
 * Mount after the API routes; it ignores `/api/*` and non-GET requests.
 */
export function serveWebApp(root: string): MiddlewareHandler {
  const base = resolve(root);
  const indexFile = resolve(base, 'index.html');
  return async (c, next) => {
    const method = c.req.method;
    const urlPath = c.req.path;
    if ((method !== 'GET' && method !== 'HEAD') || isApiPath(urlPath)) return next();

    const file = resolveStaticPath(base, urlPath);
    const direct = file ? await fileResponse(c, file, urlPath) : null;
    if (direct) return direct;

    if (wantsSpaFallback(c, urlPath)) {
      const index = await fileResponse(c, indexFile, '/index.html');
      if (index) return index;
    }
    return next();
  };
}
