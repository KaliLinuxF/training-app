import { meResponseSchema } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { createScryptGate, setUserPassword } from '../src/auth/password';
import {
  createRateLimiter,
  LOGIN_GLOBAL_LIMIT,
  LOGIN_SUCCESS_LIMIT,
  USERNAME_LIMIT,
} from '../src/auth/rateLimit';
import {
  hashToken,
  MAX_SESSIONS_PER_USER,
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS,
} from '../src/auth/sessions';
import { createApp } from '../src/http/app';
import { BODY_LIMITS } from '../src/http/bodyLimit';
import { LAST_SEEN_EVERY_MS } from '../src/http/middleware/requireAuth';
import {
  ADMIN_PASSWORD,
  createTestServer,
  json,
  ORIGIN,
  PASSWORD,
  postStream,
  sessionCookie,
  streamedBody,
  TEST_SCRYPT,
  type TestServer,
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
  ['/api/food/status', 'GET'],
  ['/api/food/estimate', 'POST'],
  ['/api/photos/AAAAAAAAAAAAAAAAAAAAAA', 'GET'],
  ['/api/photos/AAAAAAAAAAAAAAAAAAAAAA/thumb', 'GET'],
  ['/api/account/password', 'POST'],
  ['/api/account/username', 'POST'],
  ['/api/admin/users', 'GET'],
  ['/api/admin/invites', 'POST'],
  ['/api/admin/invites/revoke', 'POST'],
  ['/api/admin/users/reset-link', 'POST'],
  ['/api/admin/users/role', 'POST'],
  ['/api/admin/users/disable', 'POST'],
  ['/api/admin/users/delete', 'POST'],
  ['/api/admin/users/ai-limit', 'POST'],
  ['/api/admin/ai-limits', 'POST'],
];

const login = (username: string | undefined, password: string) =>
  username === undefined ? { body: { password } } : { body: { username, password } };

describe('login', () => {
  it('accepts username + password, sets a session cookie and answers { ok, user }', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/auth/login', login('anna', PASSWORD));
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(meResponseSchema.parse(body)).toEqual({
      ok: true,
      user: {
        id: s.anna.id,
        username: 'anna',
        role: 'user',
        createdAt: s.anna.createdAt,
        legacyOwner: true,
        passwordChange: null,
      },
    });
    const cookie = sessionCookie(res);
    expect(cookie).toMatch(/^sid=[A-Za-z0-9_-]{43}$/);
    const me = await s.call('/api/auth/me', { cookie });
    expect(me.status).toBe(200);
    expect(await json(me)).toEqual(body);
    // Sent a username: a v4 session (never legacy).
    expect(s.sessions.check(cookie?.slice(4) ?? '', s.clock.now)?.legacy).toBe(false);
  });

  it('matches the username case-insensitively and trims it', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/auth/login', login('  ADMIN ', ADMIN_PASSWORD));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ user: { id: s.admin.id, role: 'admin', legacyOwner: false } });
  });

  it('sets HttpOnly, SameSite=Lax, Path=/, 400-day Max-Age; Secure only in production', async () => {
    const dev = await createTestServer();
    const devHeader = (await dev.call('/api/auth/login', login('anna', PASSWORD))).headers.getSetCookie()[0];
    expect(devHeader).toContain('HttpOnly');
    expect(devHeader).toContain('SameSite=Lax');
    expect(devHeader).toContain('Path=/');
    expect(devHeader).toContain('Max-Age=34560000');
    expect(devHeader).not.toContain('Secure');

    const prod = await createTestServer({ production: true, publicOrigin: 'http://localhost' });
    const prodHeader = (
      await prod.call('/api/auth/login', login('anna', PASSWORD))
    ).headers.getSetCookie()[0];
    expect(prodHeader).toContain('Secure');
  });

  it('an unknown name, an account without a password and a wrong password answer identically (dummy verify)', async () => {
    const s = await createTestServer();
    s.users.create({ username: 'pending', role: 'admin', passwordHash: null, now: 0 });
    const bodies: unknown[] = [];
    for (const [username, password] of [
      ['nobody', PASSWORD],
      ['pending', PASSWORD],
      ['anna', 'wrong password'],
      ['a b c', PASSWORD], // not even a valid username: looked up like any other
    ] as const) {
      const before = s.scryptRuns();
      const res = await s.call('/api/auth/login', login(username, password));
      expect(res.status, username).toBe(401);
      expect(sessionCookie(res)).toBeNull();
      // The same scrypt work in every case: one verify.
      expect(s.scryptRuns() - before, username).toBe(1);
      bodies.push(await json(res));
    }
    expect(bodies[0]).toEqual({ error: 'bad_credentials', message: 'Неправильне імʼя або пароль' });
    for (const body of bodies) expect(body).toEqual(bodies[0]);
  });

  it('the alias legko signs in the legacy owner', async () => {
    const s = await createTestServer();
    for (const alias of ['legko', 'LEGKO']) {
      const res = await s.call('/api/auth/login', login(alias, PASSWORD));
      expect(res.status, alias).toBe(200);
      expect(await json(res)).toMatchObject({ user: { id: s.anna.id, username: 'anna' } });
    }
    expect((await s.call('/api/auth/login', login('legko', ADMIN_PASSWORD))).status).toBe(401);
  });

  it('a password-only login (the pre-v4 bundle) signs anna in on a LEGACY session; a wrong one is the standard 401', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/auth/login', login(undefined, PASSWORD));
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ user: { id: s.anna.id, legacyOwner: true } });
    const token = sessionCookie(res)?.slice(4) ?? '';
    expect(s.sessions.check(token, s.clock.now)?.legacy).toBe(true);

    // A wrong one: the code the pre-v4 bundle shows as «Неправильний пароль» (there is no name to get wrong).
    const BAD_PASSWORD = { error: 'bad_password', message: 'Неправильний пароль' };
    const before = s.scryptRuns();
    const wrong = await s.call('/api/auth/login', login(undefined, 'wrong password'));
    expect(wrong.status).toBe(401);
    expect(await json(wrong)).toEqual(BAD_PASSWORD);
    expect(s.scryptRuns() - before).toBe(1);
    // Even admin's password does not work without a username.
    const admins = await s.call('/api/auth/login', login(undefined, ADMIN_PASSWORD));
    expect(admins.status).toBe(401);
    expect(await json(admins)).toEqual(BAD_PASSWORD);
  });

  it('named logins keep the one bad_credentials body; only username-less ones get bad_password', async () => {
    const s = await createTestServer();
    const named = [
      await s.call('/api/auth/login', login('anna', 'wrong password')),
      await s.call('/api/auth/login', login('nobody', 'wrong password')),
      await s.call('/api/auth/login', login('legko', 'wrong password')),
    ];
    for (const res of named) {
      expect(res.status).toBe(401);
      expect(await json(res)).toEqual({ error: 'bad_credentials', message: 'Неправильне імʼя або пароль' });
    }
    const nameless = await s.call('/api/auth/login', login(undefined, 'wrong password'));
    expect(await json(nameless)).toMatchObject({ error: 'bad_password' });
  });

  it('without a legacy owner, a password-only login always fails like a wrong one', async () => {
    const s = await createTestServer({ users: false });
    s.users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 });
    const before = s.scryptRuns();
    const res = await s.call('/api/auth/login', login(undefined, PASSWORD));
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'bad_password', message: 'Неправильний пароль' });
    // The same dummy verify as for any other failure.
    expect(s.scryptRuns() - before).toBe(1);
  });

  it('a disabled account: 403 account_disabled only with the right password', async () => {
    const s = await createTestServer();
    s.users.setDisabled(s.anna.id, 1);
    const right = await s.call('/api/auth/login', login('anna', PASSWORD));
    expect(right.status).toBe(403);
    expect(await json(right)).toEqual({
      error: 'account_disabled',
      message: 'Акаунт вимкнено. Звернись до адміністратора',
    });
    expect(sessionCookie(right)).toBeNull();
    const wrong = await s.call('/api/auth/login', login('anna', 'wrong password'));
    expect(wrong.status).toBe(401);
  });

  it('validates the body', async () => {
    const s = await createTestServer();
    expect((await s.call('/api/auth/login', { body: { username: 'anna', password: '' } })).status).toBe(400);
    expect(
      (await s.call('/api/auth/login', { body: { username: 'x'.repeat(65), password: PASSWORD } })).status,
    ).toBe(400);
    expect((await s.call('/api/auth/login', { body: { username: '   ', password: PASSWORD } })).status).toBe(
      400,
    );
    const bad = await s.call('/api/auth/login', { body: '{not json' });
    expect(bad.status).toBe(400);
    expect(await json(bad)).toMatchObject({ error: 'bad_request' });
  });

  it('rate-limits after 5 failures per IP within 15 minutes', async () => {
    const s = await createTestServer({ trustProxy: true });
    const attempt = (ip: string, password = 'wrong password', username = 'anna') =>
      s.call('/api/auth/login', {
        body: { username, password },
        headers: { 'X-Forwarded-For': `203.0.113.9, ${ip}` },
      });

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

  it('rate-limits each username (also unknown ones and the alias) after 10 failures from any addresses', async () => {
    const s = await createTestServer({ trustProxy: true });
    const from = (i: number, username: string, password = 'wrong password') =>
      s.call('/api/auth/login', {
        body: { username, password },
        headers: { 'X-Forwarded-For': `198.51.100.${i}` },
      });

    // anna: 5 direct + 5 via the alias = 10 failures on the same key.
    for (let i = 0; i < USERNAME_LIMIT.maxFailures; i++) {
      expect((await from(i, i % 2 ? 'anna' : 'legko')).status).toBe(401);
    }
    const limited = await from(50, 'anna', PASSWORD);
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ error: 'rate_limited' });
    expect((await from(51, 'legko', PASSWORD)).status).toBe(429);
    // Other accounts are unaffected.
    expect((await from(52, 'admin', ADMIN_PASSWORD)).status).toBe(200);

    // An unknown name is limited the same way (nothing tells it apart).
    for (let i = 0; i < USERNAME_LIMIT.maxFailures; i++) await from(100 + i, 'ghost');
    expect((await from(150, 'ghost')).status).toBe(429);

    s.clock.now += 15 * 60_000;
    expect((await from(60, 'anna', PASSWORD)).status).toBe(200);
  });

  it('caps failed logins from all addresses together (botnet, many IPv6 addresses)', async () => {
    const s = await createTestServer({ trustProxy: true });
    const from = (ip: string, password = 'wrong password', username = `user${ip.length}`) =>
      s.call('/api/auth/login', { body: { username, password }, headers: { 'X-Forwarded-For': ip } });

    for (let i = 0; i < LOGIN_GLOBAL_LIMIT.maxFailures; i++) {
      expect((await from(`198.51.100.${i}`, 'wrong password', `name${i}`)).status).toBe(401);
    }
    const limited = await from('203.0.113.200', PASSWORD, 'anna');
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ error: 'rate_limited' });
    expect(Number(limited.headers.get('Retry-After'))).toBe(900);

    s.clock.now += 15 * 60_000;
    expect((await from('203.0.113.200', PASSWORD, 'anna')).status).toBe(200);
  });

  it('the global cap survives a restart (kept in kv.login_failures)', async () => {
    const s = await createTestServer({ trustProxy: true });
    for (let i = 0; i < LOGIN_GLOBAL_LIMIT.maxFailures; i++) {
      await s.call('/api/auth/login', {
        body: { username: `name${i}`, password: 'wrong password' },
        headers: { 'X-Forwarded-For': `198.51.100.${i}` },
      });
    }
    // A new app instance on the same database (a restart).
    const restarted = createApp({
      db: s.db,
      config: {
        production: false,
        publicOrigin: 'https://fit.triple-a.dev',
        trustProxy: true,
        staticDir: null,
      },
      photosDir: s.photosDir,
      now: () => s.clock.now,
      scrypt: TEST_SCRYPT,
    });
    const res = await restarted.request('/api/auth/login', {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', 'X-Forwarded-For': '203.0.113.1' },
      body: JSON.stringify({ username: 'anna', password: PASSWORD }),
    });
    expect(res.status).toBe(429);
  });

  it('counts an IPv6 client by its /64', async () => {
    const s = await createTestServer({ trustProxy: true });
    const from = (ip: string, password = 'wrong password') =>
      s.call('/api/auth/login', { body: { username: 'anna', password }, headers: { 'X-Forwarded-For': ip } });
    for (let i = 1; i <= 5; i++) expect((await from(`2001:db8:5:6::${i}`)).status).toBe(401);
    expect((await from('2001:db8:5:6:dead:beef::1', PASSWORD)).status).toBe(429);
    expect((await from('2001:db8:5:7::1', PASSWORD)).status).toBe(200);
  });

  it('successful logins never add up to the overall cap', async () => {
    const s = await createTestServer();
    for (let i = 0; i < LOGIN_GLOBAL_LIMIT.maxFailures + 5; i++) {
      expect((await s.call('/api/auth/login', login('anna', PASSWORD))).status).toBe(200);
    }
  });
});

describe('login: successful-login budget and the session cap', () => {
  const successLimit = (maxFailures: number) => createRateLimiter({ maxFailures, windowMs: 3600_000 });
  const from = (s: TestServer, ip: string, username: string, password: string) =>
    s.call('/api/auth/login', { body: { username, password }, headers: { 'X-Forwarded-For': ip } });
  const sessionsOf = (s: TestServer, id: string): number =>
    Number(s.db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(id)?.n);

  it('limits correct logins per username from any addresses; refused before any scrypt work', async () => {
    const s = await createTestServer({ trustProxy: true, loginSuccessLimiter: successLimit(3) });
    for (let i = 1; i <= 3; i++)
      expect((await from(s, `198.51.100.${i}`, 'anna', PASSWORD)).status).toBe(200);
    const before = s.scryptRuns();
    for (const [ip, username] of [
      ['198.51.100.50', 'anna'],
      ['198.51.100.51', 'legko'], // the alias shares anna's budget
    ] as const) {
      const limited = await from(s, ip, username, PASSWORD);
      expect(limited.status, username).toBe(429);
      expect(await json(limited)).toMatchObject({ error: 'rate_limited' });
      expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(sessionCookie(limited)).toBeNull();
    }
    expect(s.scryptRuns()).toBe(before);
    expect(sessionsOf(s, s.anna.id)).toBe(3);
    // Another user is not blocked by anna's budget; a refused login was no failure (the address is not throttled).
    expect((await from(s, '198.51.100.50', 'admin', ADMIN_PASSWORD)).status).toBe(200);
    // The budget refills after the window.
    s.clock.now += 3600_000;
    expect((await from(s, '198.51.100.60', 'anna', PASSWORD)).status).toBe(200);
  });

  it('limits correct logins per address (IPv6 by its /64) for every account together', async () => {
    const s = await createTestServer({ trustProxy: true, loginSuccessLimiter: successLimit(3) });
    const olya = await s.createUser('olya'); // one success from the default address, not from this /64
    expect(olya.cookie).toMatch(/^sid=/);
    expect((await from(s, '2001:db8:3:4::1', 'anna', PASSWORD)).status).toBe(200);
    expect((await from(s, '2001:db8:3:4::2', 'admin', ADMIN_PASSWORD)).status).toBe(200);
    expect((await from(s, '2001:db8:3:4:ffff::3', 'olya', PASSWORD)).status).toBe(200);
    const limited = await from(s, '2001:db8:3:4:abcd::9', 'olya', PASSWORD);
    expect(limited.status).toBe(429);
    // A neighbouring /64 has its own budget.
    expect((await from(s, '2001:db8:3:5::1', 'olya', PASSWORD)).status).toBe(200);
  });

  it('parallel correct logins cannot overshoot the budget', async () => {
    const s = await createTestServer({ trustProxy: true, loginSuccessLimiter: successLimit(3) });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, i) => from(s, `198.51.100.${10 + i}`, 'anna', PASSWORD)),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 200, 200, 429, 429, 429]);
    expect(sessionsOf(s, s.anna.id)).toBe(3);
  });

  it('wrong passwords do not use up the success budget', async () => {
    const s = await createTestServer({ trustProxy: true, loginSuccessLimiter: successLimit(2) });
    for (let i = 0; i < 4; i++) await from(s, `198.51.100.${20 + i}`, 'anna', 'wrong password');
    expect((await from(s, '198.51.100.30', 'anna', PASSWORD)).status).toBe(200);
    expect((await from(s, '198.51.100.31', 'anna', PASSWORD)).status).toBe(200);
    expect((await from(s, '198.51.100.32', 'anna', PASSWORD)).status).toBe(429);
  });

  it('every login keeps at most the cap of sessions per user; the oldest cookie stops working', async () => {
    const s = await createTestServer({ sessionsPerUser: 3 });
    const cookies: string[] = [];
    for (let i = 0; i < 5; i++) {
      cookies.push(await s.login('anna'));
      s.clock.now += 1000;
    }
    const admin = await s.login('admin');
    expect(sessionsOf(s, s.anna.id)).toBe(3);
    for (const gone of cookies.slice(0, 2))
      expect((await s.call('/api/auth/me', { cookie: gone })).status).toBe(401);
    for (const kept of cookies.slice(2))
      expect((await s.call('/api/auth/me', { cookie: kept })).status).toBe(200);
    expect((await s.call('/api/auth/me', { cookie: admin })).status).toBe(200);
  });

  it('production defaults: LOGIN_SUCCESS_LIMIT per name and MAX_SESSIONS_PER_USER sessions', async () => {
    const s = await createTestServer({ production: true, publicOrigin: ORIGIN });
    const cookies: string[] = [];
    for (let i = 0; i < LOGIN_SUCCESS_LIMIT.maxFailures; i++) {
      const res = await s.call('/api/auth/login', login('anna', PASSWORD));
      expect(res.status, `login ${i + 1}`).toBe(200);
      cookies.push(sessionCookie(res) ?? '');
      s.clock.now += 1000;
    }
    expect((await s.call('/api/auth/login', login('anna', PASSWORD))).status).toBe(429);
    expect(sessionsOf(s, s.anna.id)).toBe(MAX_SESSIONS_PER_USER);
    expect((await s.call('/api/auth/me', { cookie: cookies[0] })).status).toBe(401);
    expect((await s.call('/api/auth/me', { cookie: cookies.at(-1) })).status).toBe(200);
  });

  it('development defaults: no success budget and no session cap (the e2e suite signs in hundreds of times)', async () => {
    const s = await createTestServer();
    const first = await s.login('anna');
    for (let i = 0; i < LOGIN_SUCCESS_LIMIT.maxFailures + 5; i++) await s.login('anna');
    expect(sessionsOf(s, s.anna.id)).toBe(LOGIN_SUCCESS_LIMIT.maxFailures + 6);
    expect((await s.call('/api/auth/me', { cookie: first })).status).toBe(200);
  });
});

describe('login (more)', () => {
  it('parallel guesses from one address cannot slip past the limit', async () => {
    const s = await createTestServer();
    const results = await Promise.all(
      Array.from({ length: 12 }, () => s.call('/api/auth/login', login('anna', 'wrong password'))),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(statuses.filter((x) => x === 401)).toHaveLength(5);
    expect(statuses.filter((x) => x === 429)).toHaveLength(7);
  });

  it('a full scrypt gate answers 429 with Retry-After 5 (the attempt stays counted)', async () => {
    const s = await createTestServer({ scryptGate: createScryptGate({ maxInFlight: 1, maxQueued: 0 }) });
    const [a, b] = await Promise.all([
      s.call('/api/auth/login', login('anna', PASSWORD)),
      s.call('/api/auth/login', login('admin', ADMIN_PASSWORD)),
    ]);
    const statuses = [a?.status, b?.status].sort();
    expect(statuses).toEqual([200, 429]);
    const busy = a?.status === 429 ? a : b;
    expect(busy?.headers.get('Retry-After')).toBe('5');
    expect(await json(busy as Response)).toMatchObject({ error: 'rate_limited' });
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
    for (let i = 0; i < 5; i++) await s.call('/api/auth/login', login('anna', 'wrong password'));
    const body = streamedBody(16 * 1024 * 1024);
    const res = await postStream(s, '/api/auth/login', body);
    expect(res.status).toBe(429);
    expect(body.pulled()).toBe(0);
  });

  it('a successful login resets the failure counters', async () => {
    const s = await createTestServer();
    for (let i = 0; i < 4; i++) await s.call('/api/auth/login', login('anna', 'wrong password'));
    expect((await s.call('/api/auth/login', login('anna', PASSWORD))).status).toBe(200);
    for (let i = 0; i < 4; i++) {
      expect((await s.call('/api/auth/login', login('anna', 'wrong password'))).status).toBe(401);
    }
  });

  it('a login over another user’s cookie revokes that session (D26)', async () => {
    const s = await createTestServer();
    const annaCookie = await s.login('anna');
    const res = await s.call('/api/auth/login', { ...login('admin', ADMIN_PASSWORD), cookie: annaCookie });
    expect(res.status).toBe(200);
    expect((await s.call('/api/auth/me', { cookie: annaCookie })).status).toBe(401);
    expect((await s.call('/api/auth/me', { cookie: sessionCookie(res) })).status).toBe(200);
    // A failed login leaves the incoming session alone.
    const again = await s.login('anna');
    expect(
      (await s.call('/api/auth/login', { ...login('admin', 'wrong password'), cookie: again })).status,
    ).toBe(401);
    expect((await s.call('/api/auth/me', { cookie: again })).status).toBe(200);
  });
});

describe('sessions', () => {
  it('logout revokes the session and clears the cookie', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const res = await s.call('/api/auth/logout', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect(res.headers.getSetCookie()[0]).toMatch(/^sid=;.*Max-Age=0/);
    expect((await s.call('/api/auth/me', { cookie })).status).toBe(401);
  });

  it('logout without a session still succeeds', async () => {
    const s = await createTestServer();
    expect((await s.call('/api/auth/logout', { method: 'POST' })).status).toBe(200);
  });

  it('a new password (CLI set-password) revokes every session of that user only', async () => {
    const s = await createTestServer();
    const a = await s.login('anna');
    const b = await s.login('anna');
    const admin = await s.login('admin');
    await setUserPassword(s.db, s.anna.id, 'another long password', TEST_SCRYPT, { via: 'cli' });
    expect((await s.call('/api/auth/me', { cookie: a })).status).toBe(401);
    expect((await s.call('/api/auth/me', { cookie: b })).status).toBe(401);
    expect((await s.call('/api/auth/me', { cookie: admin })).status).toBe(200);
    expect((await s.call('/api/auth/login', login('anna', PASSWORD))).status).toBe(401);
    expect((await s.call('/api/auth/login', login('anna', 'another long password'))).status).toBe(200);
  });

  it('a disabled user’s sessions stop working at once', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    s.users.setDisabled(s.anna.id, s.clock.now);
    const res = await s.call('/api/auth/me', { cookie });
    expect(res.status).toBe(401);
    expect(res.headers.getSetCookie()[0]).toMatch(/^sid=;/);
  });

  it('roles are read on every request (no stale role in the session)', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    expect((await s.call('/api/admin/users', { cookie })).status).toBe(403);
    s.users.setRole(s.anna.id, 'admin');
    expect((await s.call('/api/admin/users', { cookie })).status).toBe(200);
    expect(await json(await s.call('/api/auth/me', { cookie }))).toMatchObject({ user: { role: 'admin' } });
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

  it('records activity (last_seen_at) at most every 5 minutes', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    const loginAt = s.clock.now;
    expect(s.users.byId(s.anna.id)?.lastSeenAt).toBe(loginAt);
    s.clock.now += LAST_SEEN_EVERY_MS - 1;
    await s.call('/api/auth/me', { cookie });
    expect(s.users.byId(s.anna.id)?.lastSeenAt).toBe(loginAt);
    s.clock.now += 1;
    await s.call('/api/auth/me', { cookie });
    expect(s.users.byId(s.anna.id)?.lastSeenAt).toBe(s.clock.now);
  });

  it.each(PROTECTED)('%s (%s) needs a session → 401 unauthorized', async (path, method) => {
    const s = await createTestServer();
    const res = await s.call(path, { method });
    expect(res.status).toBe(401);
    expect(await json(res)).toEqual({ error: 'unauthorized', message: expect.any(String) });
    const forged = await s.call(path, { method, cookie: 'sid=AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    expect(forged.status).toBe(401);
  });

  it('only the token hash is stored', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const token = cookie.slice(4);
    const rows = s.db.prepare('SELECT token_hash FROM sessions').all();
    expect(rows.map((r) => r.token_hash)).toContain(hashToken(token));
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it('health is public and reports the version', async () => {
    const s = await createTestServer();
    const res = await s.call('/api/health');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, version: 'test' });
  });
});
