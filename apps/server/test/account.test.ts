import { API, type LinkResponse, type MeResponse } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { ACCOUNT_CHANGE_LIMIT, PASSWORD_LIMIT } from '../src/auth/rateLimit';
import { ADMIN_PASSWORD, createTestServer, json, PASSWORD, sessionCookie, type TestServer } from './helpers';

const NEW_PASSWORD = 'a new long password';

const changePassword = (s: TestServer, cookie: string, currentPassword: string, newPassword = NEW_PASSWORD) =>
  s.call(API.accountPassword, { body: { currentPassword, newPassword }, cookie });

const rename = (s: TestServer, cookie: string, username: string, password = PASSWORD) =>
  s.call(API.accountUsername, { body: { username, password }, cookie });

describe('POST /api/account/password', () => {
  it('rotates every session (D26): the old cookie dies, the fresh one works, other devices are signed out', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    const otherDevice = await s.login('anna');
    const res = await changePassword(s, cookie, PASSWORD);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true });
    const fresh = sessionCookie(res);
    expect(fresh).toMatch(/^sid=[A-Za-z0-9_-]{43}$/);
    expect(fresh).not.toBe(cookie);
    expect((await s.call(API.me, { cookie })).status).toBe(401);
    expect((await s.call(API.me, { cookie: otherDevice })).status).toBe(401);
    const me = await s.call(API.me, { cookie: fresh });
    expect(me.status).toBe(200);
    expect((await json<MeResponse>(me)).user.passwordChange).toEqual({
      at: s.clock.now,
      via: 'self',
      by: null,
    });
    expect((await s.call(API.login, { body: { username: 'anna', password: PASSWORD } })).status).toBe(401);
    expect((await s.call(API.login, { body: { username: 'anna', password: NEW_PASSWORD } })).status).toBe(
      200,
    );
  });

  it('a pending reset link for the account dies with the own password change', async () => {
    const s = await createTestServer();
    const admin = await s.login('admin');
    const link = await json<LinkResponse>(
      await s.call(API.adminResetLink, { body: { userId: s.anna.id }, cookie: admin }),
    );
    const token = link.path.slice(link.path.indexOf('#') + 1);
    const cookie = await s.login('anna');
    expect((await changePassword(s, cookie, PASSWORD)).status).toBe(200);
    const res = await s.call(API.resetCheck, { body: { token } });
    expect(res.status).toBe(410);
    expect(await json(res)).toMatchObject({ reason: 'revoked' });
  });

  it('a wrong current password → 403 wrong_password; a weak new one → 400 weak_password (no hash work)', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    const wrong = await changePassword(s, cookie, 'not my password');
    expect(wrong.status).toBe(403);
    expect(await json(wrong)).toEqual({ error: 'wrong_password', message: 'Поточний пароль неправильний' });
    expect(sessionCookie(wrong)).toBeNull();
    expect((await s.call(API.me, { cookie })).status).toBe(200);

    const before = s.scryptRuns();
    const weak = await changePassword(s, cookie, PASSWORD, 'short');
    expect(weak.status).toBe(400);
    expect(await json(weak)).toMatchObject({ error: 'weak_password' });
    expect(s.scryptRuns()).toBe(before);
    expect(
      (
        await s.call(API.accountPassword, {
          body: { currentPassword: '', newPassword: NEW_PASSWORD },
          cookie,
        })
      ).status,
    ).toBe(400);
  });

  it('10 parallel wrong current passwords → exactly 5 verifies, the rest 429', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    const before = s.scryptRuns();
    const results = await Promise.all(
      Array.from({ length: 10 }, () => changePassword(s, cookie, 'wrong password')),
    );
    const statuses = results.map((r) => r.status).sort();
    expect(s.scryptRuns() - before).toBe(PASSWORD_LIMIT.maxFailures);
    expect(statuses.filter((x) => x === 403)).toHaveLength(5);
    expect(statuses.filter((x) => x === 429)).toHaveLength(5);
    // Even the right password is refused while limited…
    expect((await changePassword(s, cookie, PASSWORD)).status).toBe(429);
    // …per user: another account is unaffected.
    const admin = await s.login('admin');
    expect((await changePassword(s, admin, ADMIN_PASSWORD)).status).toBe(200);
    // 11 attempts also used up the hourly account-change allowance.
    s.clock.now += 15 * 60_000;
    expect((await changePassword(s, cookie, PASSWORD)).status).toBe(429);
    s.clock.now += 45 * 60_000;
    expect((await changePassword(s, cookie, PASSWORD)).status).toBe(200);
  });

  it('a right password resets the wrong-password counter', async () => {
    const s = await createTestServer();
    let cookie = await s.login('anna');
    for (let i = 0; i < 4; i++) expect((await changePassword(s, cookie, 'wrong password')).status).toBe(403);
    const ok = await changePassword(s, cookie, PASSWORD, 'second password!');
    expect(ok.status).toBe(200);
    cookie = sessionCookie(ok) ?? '';
    for (let i = 0; i < 4; i++) expect((await changePassword(s, cookie, 'wrong password')).status).toBe(403);
    expect((await changePassword(s, cookie, 'second password!')).status).toBe(200);
  });
});

describe('POST /api/account/username', () => {
  it('renames: the new name logs in, the old one no longer does; sessions are kept', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    const res = await rename(s, cookie, ' Anna.K ');
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      ok: true,
      user: {
        id: s.anna.id,
        username: 'Anna.K',
        role: 'user',
        createdAt: s.anna.createdAt,
        legacyOwner: true,
        passwordChange: null,
      },
    });
    expect((await s.call(API.me, { cookie })).status).toBe(200);
    expect((await s.call(API.login, { body: { username: 'anna.k', password: PASSWORD } })).status).toBe(200);
    expect((await s.call(API.login, { body: { username: 'anna', password: PASSWORD } })).status).toBe(401);
    // The legacy alias follows the legacy owner.
    expect((await s.call(API.login, { body: { username: 'legko', password: PASSWORD } })).status).toBe(200);
  });

  it('refuses taken, reserved and invalid names and a wrong password', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    s.users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 });
    const taken = await rename(s, cookie, 'OLYA');
    expect(taken.status).toBe(409);
    expect(await json(taken)).toMatchObject({ error: 'username_taken' });
    for (const name of ['admin', 'legko', 'ab', 'олена', 'a b']) {
      const res = await rename(s, cookie, name);
      expect(res.status, name).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'invalid_username' });
    }
    const wrong = await rename(s, cookie, 'anna.k', 'wrong password');
    expect(wrong.status).toBe(403);
    expect(await json(wrong)).toMatchObject({ error: 'wrong_password' });
    expect(s.users.byId(s.anna.id)?.username).toBe('anna');
  });

  it('changing only the case of your own name is fine (even for «admin»)', async () => {
    const s = await createTestServer();
    const admin = await s.login('admin');
    expect(await json(await rename(s, admin, 'Admin', ADMIN_PASSWORD))).toMatchObject({
      user: { username: 'Admin' },
    });
    const anna = await s.login('anna');
    expect(await json(await rename(s, anna, 'ANNA'))).toMatchObject({ user: { username: 'ANNA' } });
  });

  it('the account change limiter counts every attempt, successful ones too', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    for (let i = 0; i < ACCOUNT_CHANGE_LIMIT.maxFailures; i++) {
      expect((await rename(s, cookie, `anna${i}`)).status, `attempt ${i}`).toBe(200);
    }
    const limited = await rename(s, cookie, 'anna.final');
    expect(limited.status).toBe(429);
    expect(await json(limited)).toMatchObject({ error: 'rate_limited' });
    // Shared by both account routes, per user.
    expect((await changePassword(s, cookie, PASSWORD)).status).toBe(429);
    const admin = await s.login('admin');
    expect((await rename(s, admin, 'Admin', ADMIN_PASSWORD)).status).toBe(200);
    s.clock.now += 3600_000;
    expect((await rename(s, cookie, 'anna.final')).status).toBe(200);
  });
});
