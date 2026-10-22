import {
  API,
  INVITE_TTL_MS,
  RESET_TTL_MS,
  type InviteCreatedResponse,
  type LinkResponse,
  type LoginResponse,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { LINK_LIMIT } from '../src/auth/rateLimit';
import { verifyPassword } from '../src/auth/password';
import {
  ADMIN_PASSWORD,
  createTestServer,
  json,
  PASSWORD,
  postStream,
  sessionCookie,
  streamedBody,
  type TestServer,
} from './helpers';

const tokenOf = (path: string): string => path.slice(path.indexOf('#') + 1);
const NEW_PASSWORD = 'brand new password';

async function invite(s: TestServer, cookie?: string): Promise<string> {
  const res = await s.call(API.adminInviteCreate, {
    body: { note: 'для Олі' },
    cookie: cookie ?? (await s.login('admin')),
  });
  expect(res.status).toBe(200);
  return tokenOf((await json<InviteCreatedResponse>(res)).path);
}

async function resetLink(s: TestServer, userId: string, cookie?: string): Promise<string> {
  const res = await s.call(API.adminResetLink, {
    body: { userId },
    cookie: cookie ?? (await s.login('admin')),
  });
  expect(res.status).toBe(200);
  return tokenOf((await json<LinkResponse>(res)).path);
}

const accept = (
  s: TestServer,
  token: string,
  username = 'olya',
  password = PASSWORD,
  extra: { cookie?: string; ip?: string } = {},
) =>
  s.call(API.inviteAccept, {
    body: { token, username, password },
    cookie: extra.cookie,
    headers: extra.ip ? { 'X-Forwarded-For': extra.ip } : {},
  });

const complete = (s: TestServer, token: string, password = NEW_PASSWORD, cookie?: string) =>
  s.call(API.resetComplete, { body: { token, password }, cookie });

const expectInvalid = async (res: Response, reason: string) => {
  expect(res.status).toBe(410);
  expect(await json(res)).toEqual({ error: 'link_invalid', message: 'Посилання не працює', reason });
};

describe('invite links', () => {
  it('check answers the expiry without using the link', async () => {
    const s = await createTestServer();
    const token = await invite(s);
    for (let i = 0; i < 2; i++) {
      const res = await s.call(API.inviteCheck, { body: { token } });
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ ok: true, expiresAt: s.clock.now + INVITE_TTL_MS });
    }
  });

  it('accept creates the account (role user), signs it in and uses up the link', async () => {
    const s = await createTestServer();
    const token = await invite(s);
    const res = await accept(s, token, ' Olya.K ', 'olya password');
    expect(res.status).toBe(200);
    const body = await json<LoginResponse>(res);
    expect(body).toEqual({
      ok: true,
      user: {
        id: expect.stringMatching(/^[0-9a-f]{32}$/),
        username: 'Olya.K',
        role: 'user',
        createdAt: s.clock.now,
        legacyOwner: false,
        passwordChange: null,
      },
    });
    const cookie = sessionCookie(res);
    expect(await json(await s.call(API.me, { cookie }))).toEqual(body);
    expect(s.sessions.check(cookie?.slice(4) ?? '', s.clock.now)?.legacy).toBe(false);
    const row = s.users.byKey('olya.k');
    expect(await verifyPassword('olya password', row?.passwordHash ?? '')).toBe(true);
    expect(s.db.prepare('SELECT used_by FROM invites').get()?.used_by).toBe(body.user.id);
    // A new account starts empty.
    expect(s.data.forUser(body.user.id as never).read().days).toEqual({});

    await expectInvalid(await accept(s, token, 'another'), 'used');
    await expectInvalid(await s.call(API.inviteCheck, { body: { token } }), 'used');
    expect(
      (await s.call(API.login, { body: { username: 'OLYA.K', password: 'olya password' } })).status,
    ).toBe(200);
  });

  it('reports every reason: unknown, revoked, used, expired; a malformed token is 400', async () => {
    const s = await createTestServer();
    await expectInvalid(await s.call(API.inviteCheck, { body: { token: 'A'.repeat(43) } }), 'unknown');
    await expectInvalid(await accept(s, 'B'.repeat(43)), 'unknown');

    const admin = await s.login('admin');
    const created = await json<InviteCreatedResponse>(
      await s.call(API.adminInviteCreate, { body: {}, cookie: admin }),
    );
    expect(
      (await s.call(API.adminInviteRevoke, { body: { id: created.invite.id }, cookie: admin })).status,
    ).toBe(200);
    await expectInvalid(await s.call(API.inviteCheck, { body: { token: tokenOf(created.path) } }), 'revoked');
    await expectInvalid(await accept(s, tokenOf(created.path)), 'revoked');

    const old = await invite(s, admin);
    s.clock.now += INVITE_TTL_MS;
    await expectInvalid(await s.call(API.inviteCheck, { body: { token: old } }), 'expired');
    await expectInvalid(await accept(s, old), 'expired');

    for (const token of ['short', 'A'.repeat(44), `${'A'.repeat(42)}=`]) {
      const res = await s.call(API.inviteCheck, { body: { token } });
      expect(res.status, token).toBe(400);
    }
  });

  it('refuses reserved and invalid names and weak passwords; the token stays usable', async () => {
    const s = await createTestServer();
    const token = await invite(s);
    for (const username of ['admin', 'Admin', 'legko', 'ab', 'a'.repeat(33), 'olya!', '...']) {
      const res = await accept(s, token, username);
      expect(res.status, username).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'invalid_username' });
    }
    const weak = await accept(s, token, 'olya', 'short');
    expect(weak.status).toBe(400);
    expect(await json(weak)).toEqual({ error: 'weak_password', message: 'Пароль — щонайменше 8 символів' });
    expect((await accept(s, token, 'olya')).status).toBe(200);
  });

  it('a taken name → 409 username_taken without hashing; the token is kept', async () => {
    const s = await createTestServer();
    const token = await invite(s);
    const before = s.scryptRuns();
    const res = await accept(s, token, 'ANNA');
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: 'username_taken', message: 'Це імʼя вже зайняте' });
    expect(s.scryptRuns()).toBe(before);
    expect((await s.call(API.inviteCheck, { body: { token } })).status).toBe(200);
    expect((await accept(s, token, 'olya')).status).toBe(200);
  });

  it('20 parallel accepts with a taken name: never a hash, the concurrent ones 429, the token survives', async () => {
    const s = await createTestServer({ trustProxy: true });
    const token = await invite(s);
    const before = s.scryptRuns();
    const results = await Promise.all(
      Array.from({ length: 20 }, () => accept(s, token, 'anna', PASSWORD, { ip: '198.51.100.7' })),
    );
    const statuses = results.map((r) => r.status);
    expect(s.scryptRuns()).toBe(before);
    expect(statuses.every((x) => x === 409 || x === 429)).toBe(true);
    expect(statuses.filter((x) => x === 429).length).toBeGreaterThan(0);
    expect(statuses.filter((x) => x === 409).length).toBeLessThanOrEqual(LINK_LIMIT.maxFailures);
    // Another address can still use the link.
    expect((await accept(s, token, 'olya', PASSWORD, { ip: '198.51.100.8' })).status).toBe(200);
  });

  it('two parallel accepts of the same token: one account, the other 429 or 410', async () => {
    const s = await createTestServer();
    const token = await invite(s);
    const [a, b] = await Promise.all([accept(s, token, 'olya'), accept(s, token, 'ira')]);
    const statuses = [a?.status, b?.status].sort();
    expect(statuses[0]).toBe(200);
    expect([410, 429]).toContain(statuses[1]);
    expect(s.users.list().filter((u) => ['olya', 'ira'].includes(u.usernameKey))).toHaveLength(1);
  });

  it('an admin invite from the CLI creates an admin', async () => {
    const s = await createTestServer();
    const { token } = s.tokens.createInvite({ role: 'admin', note: '', createdBy: null, now: s.clock.now });
    const res = await accept(s, token, 'boss');
    expect(await json(res)).toMatchObject({ user: { username: 'boss', role: 'admin' } });
  });

  it('accept over an existing cookie revokes that session (D26)', async () => {
    const s = await createTestServer();
    const token = await invite(s);
    const annaCookie = await s.login('anna');
    const res = await accept(s, token, 'olya', PASSWORD, { cookie: annaCookie });
    expect(res.status).toBe(200);
    expect((await s.call(API.me, { cookie: annaCookie })).status).toBe(401);
  });
});

describe('reset and setup links', () => {
  it('check names the account and the purpose', async () => {
    const s = await createTestServer();
    const token = await resetLink(s, s.anna.id);
    const res = await s.call(API.resetCheck, { body: { token } });
    expect(await json(res)).toEqual({
      ok: true,
      username: 'anna',
      purpose: 'reset',
      expiresAt: s.clock.now + RESET_TTL_MS,
    });
    const pending = s.users.create({ username: 'newbie', role: 'user', passwordHash: null, now: 0 });
    const setup = await resetLink(s, pending.id);
    expect(await json(await s.call(API.resetCheck, { body: { token: setup } }))).toMatchObject({
      purpose: 'setup',
    });
  });

  it('complete sets the password, signs every device out, logs this browser in and records who made the link', async () => {
    const s = await createTestServer();
    const phone = await s.login('anna');
    const laptop = await s.login('anna');
    const token = await resetLink(s, s.anna.id);
    const res = await complete(s, token);
    expect(res.status).toBe(200);
    const body = await json<LoginResponse>(res);
    expect(body.user).toMatchObject({
      id: s.anna.id,
      username: 'anna',
      passwordChange: { at: s.clock.now, via: 'reset', by: 'admin' },
    });
    const cookie = sessionCookie(res);
    expect((await s.call(API.me, { cookie })).status).toBe(200);
    expect((await s.call(API.me, { cookie: phone })).status).toBe(401);
    expect((await s.call(API.me, { cookie: laptop })).status).toBe(401);
    expect((await s.call(API.login, { body: { username: 'anna', password: PASSWORD } })).status).toBe(401);
    expect((await s.call(API.login, { body: { username: 'anna', password: NEW_PASSWORD } })).status).toBe(
      200,
    );
    await expectInvalid(await complete(s, token, 'third password'), 'used');
  });

  it('reports every reason; a newer link revokes the older one', async () => {
    const s = await createTestServer();
    const admin = await s.login('admin');
    const first = await resetLink(s, s.anna.id, admin);
    const second = await resetLink(s, s.anna.id, admin);
    await expectInvalid(await s.call(API.resetCheck, { body: { token: first } }), 'revoked');
    await expectInvalid(await complete(s, first), 'revoked');
    await expectInvalid(await s.call(API.resetCheck, { body: { token: 'C'.repeat(43) } }), 'unknown');
    s.clock.now += RESET_TTL_MS;
    await expectInvalid(await s.call(API.resetCheck, { body: { token: second } }), 'expired');
    await expectInvalid(await complete(s, second), 'expired');
  });

  it('a weak password is 400 and keeps the link; a disabled account gets 403 and keeps it too', async () => {
    const s = await createTestServer();
    const token = await resetLink(s, s.anna.id);
    const weak = await complete(s, token, 'short');
    expect(weak.status).toBe(400);
    expect(await json(weak)).toMatchObject({ error: 'weak_password' });
    s.users.setDisabled(s.anna.id, s.clock.now);
    const disabled = await complete(s, token);
    expect(disabled.status).toBe(403);
    expect(await json(disabled)).toMatchObject({ error: 'account_disabled' });
    s.users.setDisabled(s.anna.id, null);
    expect((await complete(s, token)).status).toBe(200);
  });

  it('a setup link (create-admin) gives the account its first password', async () => {
    const s = await createTestServer();
    const owner = s.users.create({ username: 'owner', role: 'admin', passwordHash: null, now: s.clock.now });
    const { token } = s.tokens.createReset({
      userId: owner.id,
      purpose: 'setup',
      createdBy: null,
      now: s.clock.now,
    });
    const res = await complete(s, token);
    expect(await json(res)).toMatchObject({
      user: { username: 'owner', role: 'admin', passwordChange: { via: 'setup', by: null } },
    });
  });

  it('an admin’s completed reset revokes the invites and reset links they created (account recovery, D27)', async () => {
    const s = await createTestServer();
    const admin = await s.login('admin');
    const theirInvite = await invite(s, admin);
    const theirReset = await resetLink(s, s.anna.id, admin);
    const { token } = s.tokens.createReset({
      userId: s.admin.id,
      purpose: 'reset',
      createdBy: null,
      now: s.clock.now,
    });
    expect((await complete(s, token)).status).toBe(200);
    await expectInvalid(await s.call(API.inviteCheck, { body: { token: theirInvite } }), 'revoked');
    await expectInvalid(await s.call(API.resetCheck, { body: { token: theirReset } }), 'revoked');
  });

  it('complete over another user’s cookie revokes that session', async () => {
    const s = await createTestServer();
    const adminCookie = await s.login('admin');
    const token = await resetLink(s, s.anna.id, adminCookie);
    expect((await complete(s, token, NEW_PASSWORD, adminCookie)).status).toBe(200);
    expect((await s.call(API.me, { cookie: adminCookie })).status).toBe(401);
  });
});

describe('links die with their creator’s authority (D27)', () => {
  const cases = [
    [
      'demote',
      (s: TestServer, admin2: string, cookie: string) =>
        s.call(API.adminSetRole, { body: { userId: admin2, role: 'user' }, cookie }),
    ],
    [
      'disable',
      (s: TestServer, admin2: string, cookie: string) =>
        s.call(API.adminSetDisabled, { body: { userId: admin2, disabled: true }, cookie }),
    ],
    [
      'delete',
      (s: TestServer, admin2: string, cookie: string) =>
        s.call(API.adminDeleteUser, { body: { userId: admin2, confirmUsername: 'admin2' }, cookie }),
    ],
  ] as const;

  it.each(cases)(
    'admin1 %ss admin2 → admin2’s reset link for anna and invite are revoked',
    async (_name, act) => {
      const s = await createTestServer();
      const admin2 = await s.createUser('admin2', 'admin');
      const resetForAnna = await resetLink(s, s.anna.id, admin2.cookie);
      const admin2Invite = await invite(s, admin2.cookie);
      const admin1 = await s.login('admin');
      expect((await act(s, admin2.id, admin1)).status).toBe(200);
      await expectInvalid(await s.call(API.resetCheck, { body: { token: resetForAnna } }), 'revoked');
      await expectInvalid(await complete(s, resetForAnna), 'revoked');
      await expectInvalid(await s.call(API.inviteCheck, { body: { token: admin2Invite } }), 'revoked');
      await expectInvalid(await accept(s, admin2Invite), 'revoked');
      // anna's password is untouched.
      expect((await s.call(API.login, { body: { username: 'anna', password: PASSWORD } })).status).toBe(200);
    },
  );
});

describe('link throttle', () => {
  it('10 failures per address → 429 even for a good link; other addresses unaffected; a success resets it', async () => {
    const s = await createTestServer({ trustProxy: true });
    const good = await invite(s);
    const from = (ip: string, token: string) =>
      s.call(API.inviteCheck, { body: { token }, headers: { 'X-Forwarded-For': ip } });
    for (let i = 0; i < LINK_LIMIT.maxFailures; i++) {
      expect((await from('198.51.100.1', `${'D'.repeat(42)}${i}`)).status).toBe(410);
    }
    const limited = await from('198.51.100.1', good);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect((await from('198.51.100.2', good)).status).toBe(200);

    // A successful accept resets the address's failures.
    for (let i = 0; i < LINK_LIMIT.maxFailures - 1; i++) await from('198.51.100.3', `${'E'.repeat(42)}${i}`);
    expect((await accept(s, good, 'olya', PASSWORD, { ip: '198.51.100.3' })).status).toBe(200);
    for (let i = 0; i < LINK_LIMIT.maxFailures - 1; i++) {
      expect((await from('198.51.100.3', `${'F'.repeat(42)}${i}`)).status).toBe(410);
    }

    s.clock.now += 15 * 60_000;
    expect((await from('198.51.100.1', `${'G'.repeat(43)}`)).status).toBe(410);
  });

  it('an IPv6 client counts by its /64: rotating addresses inside it gets no fresh budget (410s and taken names)', async () => {
    const s = await createTestServer({ trustProxy: true });
    const good = await invite(s);
    const before = s.scryptRuns();
    // One valid invite, used to probe names from a new address of the same /64 each time (409 before any hash) …
    for (let i = 1; i <= LINK_LIMIT.maxFailures / 2; i++) {
      const res = await accept(s, good, 'anna', PASSWORD, { ip: `2001:db8:7:8::${i.toString(16)}` });
      expect(res.status).toBe(409);
    }
    // … and bad tokens from more addresses of it.
    for (let i = 1; i <= LINK_LIMIT.maxFailures / 2; i++) {
      const res = await s.call(API.inviteCheck, {
        body: { token: `${'K'.repeat(42)}${i}` },
        headers: { 'X-Forwarded-For': `2001:db8:7:8:${i.toString(16)}::1` },
      });
      expect(res.status).toBe(410);
    }
    expect(s.scryptRuns()).toBe(before);
    for (const ip of ['2001:db8:7:8:dead:beef:0:1', '[2001:db8:7:8::ffff]']) {
      const probe = await accept(s, good, 'admin', PASSWORD, { ip });
      expect(probe.status, ip).toBe(429);
      expect(await json(probe)).toMatchObject({ error: 'rate_limited' });
      const check = await s.call(API.inviteCheck, {
        body: { token: good },
        headers: { 'X-Forwarded-For': ip },
      });
      expect(check.status, ip).toBe(429);
    }
    // The neighbouring /64 is a different client; the invite is still unused.
    expect((await accept(s, good, 'olya', PASSWORD, { ip: '2001:db8:7:9::1' })).status).toBe(200);
  });

  it('a successful accept resets the whole /64', async () => {
    const s = await createTestServer({ trustProxy: true });
    const good = await invite(s);
    for (let i = 1; i < LINK_LIMIT.maxFailures; i++) {
      await s.call(API.inviteCheck, {
        body: { token: `${'L'.repeat(42)}${i}` },
        headers: { 'X-Forwarded-For': `2001:db8:a:b::${i}` },
      });
    }
    expect((await accept(s, good, 'olya', PASSWORD, { ip: '2001:db8:a:b::ff' })).status).toBe(200);
    for (let i = 1; i < LINK_LIMIT.maxFailures; i++) {
      const res = await s.call(API.inviteCheck, {
        body: { token: `${'M'.repeat(42)}${i}` },
        headers: { 'X-Forwarded-For': `2001:db8:a:b:${i}::2` },
      });
      expect(res.status).toBe(410);
    }
  });

  it('a throttled client is refused before its body is read', async () => {
    const s = await createTestServer();
    for (let i = 0; i < LINK_LIMIT.maxFailures; i++) {
      await s.call(API.resetCheck, { body: { token: `${'H'.repeat(42)}${i}` } });
    }
    const body = streamedBody(16 * 1024 * 1024);
    const res = await postStream(s, API.resetComplete, body);
    expect(res.status).toBe(429);
    expect(body.pulled()).toBe(0);
  });

  it('link failures do not count against the login throttle', async () => {
    const s = await createTestServer();
    for (let i = 0; i < LINK_LIMIT.maxFailures; i++) {
      await s.call(API.inviteCheck, { body: { token: `${'J'.repeat(42)}${i}` } });
    }
    expect((await s.call(API.login, { body: { username: 'admin', password: ADMIN_PASSWORD } })).status).toBe(
      200,
    );
  });
});
