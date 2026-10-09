import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { CONTENT_SECURITY_POLICY } from '../src/http/middleware/securityHeaders';
import { createTestServer, json, type TestServer } from './helpers';

let root: string;
let s: TestServer;

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), 'legko-static-'));
  mkdirSync(join(root, 'assets'));
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>Легко</title>');
  writeFileSync(join(root, 'sw.js'), 'self.addEventListener("push", () => {});');
  writeFileSync(join(root, 'manifest.webmanifest'), '{"name":"Легко"}');
  writeFileSync(join(root, 'apple-touch-icon.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(join(root, 'assets', 'index-B4x9Qz1a.js'), 'console.log(1)');
  writeFileSync(join(root, 'assets', 'index-C2pL0aZx.css'), 'body{}');
  writeFileSync(join(root, '.env'), 'SECRET=1');
  s = await createTestServer({ staticDir: root });
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

describe('static web app', () => {
  it('serves hashed assets as immutable', async () => {
    const res = await s.call('/assets/index-B4x9Qz1a.js');
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('text/javascript');
    expect(res.headers.get('Cache-Control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toBe('console.log(1)');
    expect((await s.call('/assets/index-C2pL0aZx.css')).headers.get('Content-Type')).toContain('text/css');
  });

  it.each([
    ['/', 'text/html'],
    ['/index.html', 'text/html'],
    ['/sw.js', 'text/javascript'],
    ['/manifest.webmanifest', 'application/manifest+json'],
  ])('%s is served with no-cache', async (path, type) => {
    const res = await s.call(path);
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain(type);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
  });

  it('answers conditional requests with 304', async () => {
    const first = await s.call('/sw.js');
    const etag = first.headers.get('ETag');
    expect(etag).toBeTruthy();
    const second = await s.call('/sw.js', { headers: { 'If-None-Match': etag ?? '' } });
    expect(second.status).toBe(304);
    expect(await second.text()).toBe('');
  });

  it('falls back to index.html for client-side routes', async () => {
    for (const path of [
      '/calendar',
      '/progress',
      '/settings',
      '/settings/reminders',
      // Old bookmarks and delivered test notifications: the client redirects to /settings/reminders.
      '/reminders/',
      '/calendar?date=2026-10-10',
    ]) {
      const res = await s.call(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/html');
      expect(res.headers.get('Cache-Control')).toBe('no-cache');
      expect(await res.text()).toContain('<title>Легко</title>');
    }
  });

  it('404s missing files with an extension and missing hashed assets', async () => {
    expect((await s.call('/assets/index-OLD.js')).status).toBe(404);
    expect((await s.call('/favicon.ico')).status).toBe(404);
  });

  it('never serves dotfiles or paths outside the root', async () => {
    expect(await (await s.call('/.env')).text()).not.toContain('SECRET');
    for (const path of ['/..%2f..%2fpackage.json', '/%2e%2e/%2e%2e/etc/passwd', '/assets/..%5c..%5c.env']) {
      const res = await s.call(path);
      expect(await res.text(), path).not.toContain('SECRET');
    }
  });

  it('keeps /api/* as JSON 404s', async () => {
    const res = await s.call('/api/unknown');
    expect(res.status).toBe(404);
    expect(await json(res)).toMatchObject({ error: 'not_found' });
  });

  it('sends the CSP and other security headers with pages', async () => {
    const res = await s.call('/');
    expect(res.headers.get('Content-Security-Policy')).toBe(CONTENT_SECURITY_POLICY);
    expect(CONTENT_SECURITY_POLICY).toBe(
      "default-src 'self'; img-src 'self' data: blob:; style-src 'self' 'unsafe-inline'; font-src 'self' data:; " +
        "connect-src 'self'; worker-src 'self'; manifest-src 'self'; frame-ancestors 'none'; base-uri 'self'; " +
        "form-action 'self'",
    );
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    expect(res.headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  });

  it('adds HSTS only in production', async () => {
    expect((await s.call('/')).headers.get('Strict-Transport-Security')).toBeNull();
    const prod = await createTestServer({ staticDir: root, production: true });
    expect((await prod.call('/')).headers.get('Strict-Transport-Security')).toBe('max-age=31536000');
  });

  it('answers HEAD like GET without a body', async () => {
    const res = await s.app.request('/index.html', { method: 'HEAD' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-cache');
    expect(await res.text()).toBe('');
  });

  it('without STATIC_DIR non-API paths are plain 404s', async () => {
    const api = await createTestServer();
    const res = await api.call('/calendar');
    expect(res.status).toBe(404);
  });
});
