import { describe, expect, it } from 'vitest';
import { createTestServer, json, PASSWORD } from './helpers';

const login = { body: { password: PASSWORD } };

describe('origin and content-type checks on POST', () => {
  it('accepts the request’s own origin, PUBLIC_ORIGIN and (in dev) the Vite origins', async () => {
    const s = await createTestServer();
    for (const origin of [
      'http://localhost',
      'https://fit.triple-a.dev',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
    ]) {
      expect((await s.call('/api/auth/login', { ...login, origin })).status, origin).toBe(200);
    }
  });

  it('rejects a missing, foreign or "null" Origin with 403 forbidden_origin', async () => {
    const s = await createTestServer();
    for (const origin of [null, 'https://evil.example', 'null', 'https://fit.triple-a.dev.evil.example']) {
      const res = await s.call('/api/auth/login', { ...login, origin });
      expect(res.status, String(origin)).toBe(403);
      expect(await json(res)).toMatchObject({ error: 'forbidden_origin' });
    }
  });

  it('does not allow the Vite dev origins in production', async () => {
    const s = await createTestServer({ production: true });
    const res = await s.call('/api/auth/login', { ...login, origin: 'http://localhost:5173' });
    expect(res.status).toBe(403);
    expect((await s.call('/api/auth/login', { ...login, origin: 'https://fit.triple-a.dev' })).status).toBe(
      200,
    );
  });

  it('requires Content-Type: application/json (charset allowed)', async () => {
    const s = await createTestServer();
    for (const contentType of [
      null,
      'text/plain',
      'application/x-www-form-urlencoded',
      'multipart/form-data',
    ]) {
      const res = await s.call('/api/auth/login', { ...login, contentType });
      expect(res.status, String(contentType)).toBe(403);
      expect(await json(res)).toMatchObject({ error: 'forbidden_origin' });
    }
    const ok = await s.call('/api/auth/login', { ...login, contentType: 'application/json; charset=utf-8' });
    expect(ok.status).toBe(200);
  });

  it('uses X-Forwarded-Host/Proto only when the proxy is trusted', async () => {
    const forwarded = {
      ...login,
      origin: 'https://legko.example',
      headers: { 'X-Forwarded-Host': 'legko.example', 'X-Forwarded-Proto': 'https' },
    };
    const trusted = await createTestServer({ trustProxy: true });
    expect((await trusted.call('/api/auth/login', forwarded)).status).toBe(200);
    const untrusted = await createTestServer({ trustProxy: false });
    expect((await untrusted.call('/api/auth/login', forwarded)).status).toBe(403);
  });

  it('matches the Host header', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/auth/login', {
      ...login,
      origin: 'http://192.168.1.5:3000',
      headers: { Host: '192.168.1.5:3000' },
    });
    expect(res.status).toBe(200);
  });

  it('does not check GET requests', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/health', { origin: 'https://evil.example' });
    expect(res.status).toBe(200);
  });
});

describe('API error shape', () => {
  it('unknown /api routes → 404 JSON', async () => {
    const s = await createTestServer();
    for (const path of ['/api/nope', '/api', '/api/data/extra']) {
      const res = await s.call(path);
      expect(res.status, path).toBe(404);
      expect(await json(res)).toEqual({ error: 'not_found', message: expect.any(String) });
    }
  });

  it('API responses are never cached and carry the security headers', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/health');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Content-Security-Policy')).toContain("frame-ancestors 'none'");
  });

  it('rejects oversized bodies', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const res = await s.call('/api/ops', { cookie, body: 'x'.repeat(16 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ error: 'bad_request' });
  });
});
