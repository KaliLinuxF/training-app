import { describe, expect, it } from 'vitest';
import { clearPassword, setPassword } from '../src/auth/password';
import { LOGIN_GLOBAL_LIMIT } from '../src/auth/rateLimit';
import { SESSION_RENEW_AFTER_MS, SESSION_TTL_MS } from '../src/auth/sessions';
import { BODY_LIMITS } from '../src/http/bodyLimit';
import {
  createTestServer,
  json,
  PASSWORD,
  postStream,
  sessionCookie,
  streamedBody,
  TEST_SCRYPT,
} from './helpers';

const PROTECTED: [string, 'GET' | 'POST'][] = [
  ['/api/data', 'GET'],
  ['/api/ops', 'POST'],
  ['/api/export', 'GET'],
  ['/api/import', 'POST'],
  ['/api/auth/me', 'GET'],
  ['/api/push/public-key', 'GET'],
  ['/api/push/subscribe', 'POST'],
  ['/api/push/unsubscribe', 'POST'],
  ['/api/push/test', 'POST'],
];

describe('login', () => {
  it('accepts the right password and sets a session cookie', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/auth/login', { body: { password: PASSWORD } });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/^sid=[A-Za-z0-9_-]{43}$/);
    const me = await s.call('/api/auth/me', { cookie });
    expect(me.status).toBe(200);
  });

  it('sets HttpOnly, SameSite=Lax, Path=/, 400-day Max-Age; Secure only in production', async () => {
    const dev = await createTestServer();
    const devHeader = (
      await dev.call('/api/auth/login', { body: { password: PASSWORD } })
    ).headers.getSetCookie()[0];
    expect(devHeader).toContain('HttpOnly');
    expect(devHeader).toContain('SameSite=Lax');
    expect(devHeader).toContain('Path=/');
    expect(devHeader).toContain('Max-Age=34560000');
    expect(devHeader).not.toContain('Secure');

    const prod = await createTestServer({ production: true, publicOrigin: 'http://localhost' });
    const prodHeader = (
      await prod.call('/api/auth/login', { body: { password: PASSWORD } })
    ).headers.getSetCookie()[0];
    expect(prodHeader).toContain('Secure');
  });

  it('rejects a wrong password with bad_password', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/auth/login', { body: { password: 'nope nope' } });
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: 'bad_password' });
    expect(sessionCookie(res)).toBeNull();
  });

  it('always fails with bad_password while no password is set', async () => {
    const s = await createTestServer({ password: null });
    const res = await s.call('/api/auth/login', { body: { password: PASSWORD } });
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: 'bad_password' });
  });

  it('validates the body', async () => {
    const s = await createTestServer();
    expect((await s.call('/api/auth/login', { body: { password: '' } })).status).toBe(400);
    const bad = await s.call('/api/auth/login', { body: '{not json' });
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ error: 'bad_request' });
  });

  it('rate-limits after 5 failures per IP within 15 minutes', async () => {
    const s = await createTestServer({ trustProxy: true });
    const attempt = (ip: string, password = 'wrong password') =>
      s.call('/api/auth/login', { body: { password }, headers: { 'X-Forwarded-For': `203.0.113.9, ${ip}` } });

    for (let i = 0; i < 5; i++) expect((await attempt('198.51.100.1')).status).toBe(401);
    const limited = await attempt('198.51.100.1', PASSWORD);
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ error: 'rate_limited' });
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);

    // Another address is unaffected; the right-most X-Forwarded-For entry is the one that counts.
    expect((await attempt('198.51.100.2', PASSWORD)).status).toBe(200);

    s.clock.now += 15 * 60_000;
    expect((await attempt('198.51.100.1', PASSWORD)).status).toBe(200);
  });

  it('caps failed logins from all addresses together (botnet, many IPv6 addresses)', async () => {
    const s = await createTestServer({ trustProxy: true });
    const from = (ip: string, password = 'wrong password') =>
      s.call('/api/auth/login', { body: { password }, headers: { 'X-Forwarded-For': ip } });

    for (let i = 0; i < LOGIN_GLOBAL_LIMIT.maxFailures; i++) {
      expect((await from(`198.51.100.${i}`)).status).toBe(401);
    }
    const limited = await from('203.0.113.200', PASSWORD);
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ error: 'rate_limited' });
    expect(Number(limited.headers.get('Retry-After'))).toBe(900);

    s.clock.now += 15 * 60_000;
    expect((await from('203.0.113.200', PASSWORD)).status).toBe(200);
  });

  it('counts an IPv6 client by its /64', async () => {
    const s = await createTestServer({ trustProxy: true });
    const from = (ip: string, password = 'wrong password') =>
      s.call('/api/auth/login', { body: { password }, headers: { 'X-Forwarded-For': ip } });
    for (let i = 1; i <= 5; i++) expect((await from(`2001:db8:5:6::${i}`)).status).toBe(401);
    expect((await from('2001:db8:5:6:dead:beef::1', PASSWORD)).status).toBe(429);
    expect((await from('2001:db8:5:7::1', PASSWORD)).status).toBe(200);
  });

  it('successful logins never add up to the overall cap', async () => {
    const s = await createTestServer();
    for (let i = 0; i < LOGIN_GLOBAL_LIMIT.maxFailures + 5; i++) {
      expect((await s.call('/api/auth/login', { body: { password: PASSWORD } })).status).toBe(200);
    }
  });

  it('parallel guesses from one address cannot slip past the limit', async () => {
    const s = await createTestServer();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => s.call('/api/auth/login', { body: { password: 'wrong password' } })),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((x) => x === 401)).toHaveLength(5);
    expect(statuses.filter((x) => x === 429)).toHaveLength(7);
  });

  it('reads at most a few KB of a login body', async () => {
    const s = await createTestServer();
    const body = streamedBody(16 * 1024 * 1024, 1024);
    const res = await postStream(s, '/api/auth/login', body);
    expect(res.status).toBe(413);
    expect(await json(res)).toMatchObject({ error: 'payload_too_large' });
    expect(body.pulled()).toBeLessThanOrEqual(BODY_LIMITS.login + 1024);
  });

  it('a throttled client is refused before its body is read', async () => {
    const s = await createTestServer();
    for (let i = 0; i < 5; i++) await s.call('/api/auth/login', { body: { password: 'wrong password' } });
    const body = streamedBody(16 * 1024 * 1024);
    const res = await postStream(s, '/api/auth/login', body);
    expect(res.status).toBe(429);
    expect(body.pulled()).toBe(0);
  });

  it('a successful login resets the failure counter', async () => {
    const s = await createTestServer();
    for (let i = 0; i < 4; i++) await s.call('/api/auth/login', { body: { password: 'wrong password' } });
    expect((await s.call('/api/auth/login', { body: { password: PASSWORD } })).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await s.call('/api/auth/login', { body: { password: 'wrong password' } })).status).toBe(401);
    }
  });
});

describe('sessions', () => {
  it('logout revokes the session and clears the cookie', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const res = await s.call('/api/auth/logout', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/^sid=;.*Max-Age=0/);
    expect((await s.call('/api/data', { cookie })).status).toBe(401);
  });

  it('logout without a session still succeeds', async () => {
    const s = await createTestServer();
    expect((await s.call('/api/auth/logout', { method: 'POST' })).status).toBe(200);
  });

  it('setting a new password revokes every session', async () => {
    const s = await createTestServer();
    const a = await s.login();
    const b = await s.login();
    await setPassword(s.db, 'another long password', TEST_SCRYPT);
    expect((await s.call('/api/data', { cookie: a })).status).toBe(401);
    expect((await s.call('/api/data', { cookie: b })).status).toBe(401);
    expect((await s.call('/api/auth/login', { body: { password: PASSWORD } })).status).toBe(401);
    expect((await s.call('/api/auth/login', { body: { password: 'another long password' } })).status).toBe(
      200,
    );
  });

  it('clearing the password revokes sessions too', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    clearPassword(s.db);
    expect((await s.call('/api/auth/me', { cookie })).status).toBe(401);
  });

  it('renews the cookie at most once a day (sliding expiry)', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const sameDay = await s.call('/api/auth/me', { cookie });
    expect(sameDay.headers.getSetCookie()).toEqual([]);

    s.clock.now += SESSION_RENEW_AFTER_MS;
    const renewed = await s.call('/api/auth/me', { cookie });
    expect(renewed.status).toBe(200);
    expect(renewed.headers.getSetCookie()[0]).toContain('Max-Age=34560000');

    // Renewal moved the expiry: still valid 399 days after the renewal…
    s.clock.now += SESSION_TTL_MS - SESSION_RENEW_AFTER_MS;
    expect((await s.call('/api/auth/me', { cookie })).status).toBe(200);
  });

  it('expires sessions that were not used for 400 days', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    s.clock.now += SESSION_TTL_MS;
    const res = await s.call('/api/auth/me', { cookie });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()[0]).toMatch(/^sid=;/);
  });

  it.each(PROTECTED)('%s (%s) needs a session → 401 unauthorized', async (path, method) => {
    const s = await createTestServer();
    const res = await s.call(path, { method });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'unauthorized', message: expect.any(String) });
    const forged = await s.call(path, { method, cookie: 'sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(forged.status).toBe(401);
  });

  it('health is public and reports the version', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/health');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, version: 'test' });
  });
});
