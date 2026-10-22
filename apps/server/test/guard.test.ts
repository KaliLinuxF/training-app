import { API, USER_HEADER } from '@legko/shared';
import { Hono, type Context } from 'hono';
import { describe, expect, it } from 'vitest';
import { BODY_LIMITS } from '../src/http/bodyLimit';
import { requireAuth } from '../src/http/middleware/requireAuth';
import { currentUser, type AppEnv } from '../src/http/types';
import {
  createTestServer,
  json,
  PASSWORD,
  postStream,
  sessionCookie,
  streamedBody,
  type TestServer,
} from './helpers';

const login = { body: { username: 'anna', password: PASSWORD } };

/** The new public / account / admin POST routes: all behind the same origin + JSON guard. */
const NEW_POSTS = [
  API.inviteCheck,
  API.inviteAccept,
  API.resetCheck,
  API.resetComplete,
  API.accountPassword,
  API.accountUsername,
  API.adminInviteCreate,
  API.adminInviteRevoke,
  API.adminResetLink,
  API.adminSetRole,
  API.adminSetDisabled,
  API.adminDeleteUser,
  API.adminUserAiLimit,
  API.adminAiLimits,
];

describe('origin and content-type checks on POST', () => {
  it('accepts the request’s own origin, PUBLIC_ORIGIN and (in dev) the Vite origins', async () => {
    const s = await createTestServer();
    for (const origin of [
      'http://localhost',
      'https://fit.triple-a.dev',
      'http://localhost:5173',
      'http://127.0.0.1:5173',
      'http://localhost:5204',
      'http://[::1]:5201',
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

  it.each(NEW_POSTS)('%s is behind the origin and JSON guard too', async (path) => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    for (const origin of [null, 'https://evil.example']) {
      const res = await s.call(path, { body: {}, cookie, origin });
      expect(res.status, `${path} ${String(origin)}`).toBe(403);
      expect(await json(res)).toMatchObject({ error: 'forbidden_origin' });
    }
    const form = await s.call(path, {
      body: 'token=x',
      cookie,
      contentType: 'application/x-www-form-urlencoded',
    });
    expect(form.status).toBe(403);
  });

  it('does not allow the Vite dev origins in production', async () => {
    const s = await createTestServer({ production: true });
    const res = await s.call('/api/auth/login', { ...login, origin: 'http://localhost:5173' });
    expect(res.status).toBe(403);
    expect((await s.call('/api/auth/login', { ...login, origin: 'http://127.0.0.1:5204' })).status).toBe(403);
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

describe('X-Legko-User (D11): a device copy never reaches another account', () => {
  const WEIGHT_OPS = { ops: [{ kind: 'weight.put', date: '2026-10-10', kg: 99 }] };

  /** anna's rows straight from the repo (never through the data routes). */
  const annaData = (s: TestServer) => s.data.forUser(s.anna.id).read();

  it('a header naming another user → 409 user_mismatch on every authed route, nothing applied', async () => {
    const s = await createTestServer();
    s.data.forUser(s.anna.id).apply([{ kind: 'weight.put', date: '2026-10-01', kg: 65 }]);
    const before = annaData(s);
    const cookie = await s.login('anna');
    for (const [path, method, body] of [
      [API.data, 'GET', undefined],
      [API.ops, 'POST', WEIGHT_OPS],
      [API.import, 'POST', { ...before, weights: [] }],
      [API.export, 'GET', undefined],
      [API.me, 'GET', undefined],
      [API.foodStatus, 'GET', undefined],
    ] as const) {
      const res = await s.call(path, { method, body, cookie, userHeader: s.admin.id });
      expect(res.status, path).toBe(409);
      expect(await json(res)).toEqual({
        error: 'user_mismatch',
        message: 'На цьому пристрої ввійдено в інший акаунт',
      });
    }
    expect(annaData(s)).toEqual(before);
    expect(s.data.forUser(s.admin.id).read().weights).toEqual([]);
  });

  it('a session made by a v4 login must send the header on data / ops / import (missing → 409, nothing changes)', async () => {
    const s = await createTestServer();
    const before = annaData(s);
    const cookie = await s.login('anna');
    for (const [path, method, body] of [
      [API.data, 'GET', undefined],
      [API.ops, 'POST', WEIGHT_OPS],
      [API.import, 'POST', { ...before, weights: [{ date: '2026-10-10', kg: 1 }] }],
    ] as const) {
      const res = await s.call(path, { method, body, cookie, userHeader: null });
      expect(res.status, path).toBe(409);
      expect(await json(res)).toMatchObject({ error: 'user_mismatch' });
    }
    expect(annaData(s)).toEqual(before);
    // Routes without the rule work without the header.
    expect((await s.call(API.me, { cookie, userHeader: null })).status).toBe(200);
  });

  it('a legacy (migrated) session works without the header; the first header clears the flag', async () => {
    const s = await createTestServer();
    const app = new Hono<AppEnv>();
    const auth = requireAuth({
      sessions: s.sessions,
      users: s.users,
      now: () => s.clock.now,
      secureCookie: false,
    });
    const echo = (c: Context<AppEnv>) => c.json({ user: currentUser(c).id });
    app.get(API.data, auth, echo);
    app.post(API.ops, auth, echo);
    app.post(API.import, auth, echo);
    const request = (path: string, method: 'GET' | 'POST', cookie: string, header?: string) =>
      app.request(path, {
        method,
        headers: { Cookie: cookie, ...(header ? { [USER_HEADER]: header } : {}) },
      });

    // As the v4 migration copies her sessions (and as a username-less login creates them).
    const legacy = `sid=${s.sessions.create(s.anna.id, s.clock.now, { legacy: true })}`;
    for (const [path, method] of [
      [API.data, 'GET'],
      [API.ops, 'POST'],
      [API.import, 'POST'],
    ] as const) {
      const res = await request(path, method, legacy);
      expect(res.status, path).toBe(200);
      expect(await json(res)).toEqual({ user: s.anna.id });
    }
    // The new bundle takes over: the header clears the flag…
    expect((await request(API.data, 'GET', legacy, s.anna.id)).status).toBe(200);
    expect(s.sessions.check(legacy.slice(4), s.clock.now)?.legacy).toBe(false);
    // …after which the header is required like on any v4 session.
    expect((await request(API.ops, 'POST', legacy)).status).toBe(409);
    expect((await request(API.ops, 'POST', legacy, s.anna.id)).status).toBe(200);

    // A legacy session never accepts another user's id.
    const other = `sid=${s.sessions.create(s.anna.id, s.clock.now, { legacy: true })}`;
    expect((await request(API.data, 'GET', other, s.admin.id)).status).toBe(409);
    expect(s.sessions.check(other.slice(4), s.clock.now)?.legacy).toBe(true);

    // A v4 session with the right header passes.
    const v4 = await s.login('anna');
    expect((await request(API.import, 'POST', v4, s.anna.id)).status).toBe(200);
    expect((await request(API.import, 'POST', v4)).status).toBe(409);
  });

  it('a username-less login creates a legacy session (the pre-v4 bundle keeps syncing)', async () => {
    const s = await createTestServer();
    const res = await s.call(API.login, { body: { password: PASSWORD } });
    const cookie = sessionCookie(res) ?? '';
    const check = s.sessions.check(cookie.slice(4), s.clock.now);
    expect(check).toMatchObject({ legacy: true, user: { id: s.anna.id } });
  });
});

describe('API error shape', () => {
  it('unknown /api routes → 404 JSON', async () => {
    const s = await createTestServer();
    for (const path of ['/api/nope', '/api', '/api/data/extra', '/api/admin/nope']) {
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
    const cookie = await s.login('admin');
    expect((await s.call(API.adminUsers, { cookie })).headers.get('Cache-Control')).toBe('no-store');
  });

  it('rejects oversized bodies', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const res = await s.call('/api/ops', { cookie, body: 'x'.repeat(16 * 1024 * 1024 + 1) });
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ error: 'payload_too_large' });
  });
});

describe('request body limits', () => {
  const MB = 1024 * 1024;
  const ROUTE_LIMITS: [string, number][] = [
    ['/api/ops', BODY_LIMITS.bulk],
    ['/api/import', BODY_LIMITS.bulk],
    ['/api/food/estimate', BODY_LIMITS.foodEstimate],
    ['/api/push/subscribe', BODY_LIMITS.small],
    ['/api/push/unsubscribe', BODY_LIMITS.small],
    [API.accountPassword, BODY_LIMITS.small],
    [API.accountUsername, BODY_LIMITS.small],
    [API.adminInviteCreate, BODY_LIMITS.small],
    [API.adminDeleteUser, BODY_LIMITS.small],
    [API.adminAiLimits, BODY_LIMITS.small],
  ];

  it.each(ROUTE_LIMITS)('%s does not read a body before the session check', async (path) => {
    const s = await createTestServer();
    const body = streamedBody(32 * MB);
    const res = await postStream(s, path, body);
    expect(res.status).toBe(401);
    expect(body.pulled()).toBe(0);
  });

  it.each(ROUTE_LIMITS)('%s stops reading at its cap (%i bytes) → 413', async (path, cap) => {
    const s = await createTestServer();
    const cookie = await s.login(path.startsWith('/api/admin') ? 'admin' : 'anna');
    const chunk = 16 * 1024;
    const body = streamedBody(cap + 4 * chunk, chunk);
    const res = await postStream(s, path, body, { Cookie: cookie });
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ error: 'payload_too_large' });
    expect(body.pulled()).toBeLessThanOrEqual(cap + chunk);
  });

  it('an admin route does not read a non-admin’s body', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    const body = streamedBody(32 * MB);
    const res = await postStream(s, API.adminInviteCreate, body, { Cookie: cookie });
    expect(res.status).toBe(403);
    expect(body.pulled()).toBe(0);
  });

  it.each([API.inviteCheck, API.inviteAccept, API.resetCheck, API.resetComplete])(
    '%s (public) reads at most a few KB',
    async (path) => {
      const s = await createTestServer();
      const body = streamedBody(16 * MB, 1024);
      const res = await postStream(s, path, body);
      expect(res.status).toBe(413);
      expect(body.pulled()).toBeLessThanOrEqual(BODY_LIMITS.login + 1024);
    },
  );

  it('a declared Content-Length over the cap is refused without reading', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const body = streamedBody(MB);
    const res = await postStream(s, '/api/push/subscribe', body, {
      Cookie: cookie,
      'Content-Length': String(BODY_LIMITS.small + 1),
    });
    expect(res.status).toBe(413);
    expect(body.pulled()).toBe(0);
  });
});
