import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  API,
  MAX_PENDING_INVITES,
  RESET_TTL_MS,
  type AdminOverview,
  type InviteCreatedResponse,
  type LinkResponse,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { hashToken } from '../src/auth/sessions';
import { ADMIN_PASSWORD, createTestServer, fakeJpeg, json, PASSWORD, type TestServer } from './helpers';

const ID = '0123456789abcdef0123456789abcdef';

/** Every admin route with a valid body (for the 403 sweep). */
const adminCalls = (s: TestServer): [string, 'GET' | 'POST', unknown][] => [
  [API.adminUsers, 'GET', undefined],
  [API.adminInviteCreate, 'POST', { note: 'x' }],
  [API.adminInviteRevoke, 'POST', { id: ID }],
  [API.adminResetLink, 'POST', { userId: s.anna.id }],
  [API.adminSetRole, 'POST', { userId: s.anna.id, role: 'admin' }],
  [API.adminSetDisabled, 'POST', { userId: s.admin.id, disabled: true }],
  [API.adminDeleteUser, 'POST', { userId: s.admin.id, confirmUsername: 'admin' }],
  [API.adminUserAiLimit, 'POST', { userId: s.anna.id, limit: 1000 }],
  [API.adminAiLimits, 'POST', { perUser: 1000, global: 10_000 }],
];

const overview = async (s: TestServer, cookie: string): Promise<AdminOverview> => {
  const res = await s.call(API.adminUsers, { cookie });
  expect(res.status).toBe(200);
  return json<AdminOverview>(res);
};

const tokenOf = (path: string): string => path.slice(path.indexOf('#') + 1);

describe('admin routes: access', () => {
  it('a regular user gets 403 forbidden on EVERY admin route, and nothing changes', async () => {
    const s = await createTestServer();
    const cookie = await s.login('anna');
    const usersBefore = s.users.list();
    for (const [path, method, body] of adminCalls(s)) {
      const res = await s.call(path, { method, body, cookie });
      expect(res.status, path).toBe(403);
      expect(await json(res)).toEqual({ error: 'forbidden', message: 'Немає доступу' });
    }
    expect(s.users.list()).toEqual(usersBefore);
    expect(s.tokens.pendingInviteCount(s.clock.now)).toBe(0);
    expect(s.budget.limits()).toEqual({ perUser: 40, global: 150 });
  });

  it('a demoted admin loses access on the very next request', async () => {
    const s = await createTestServer();
    const admin2 = await s.createUser('admin2', 'admin');
    const admin1 = await s.login('admin');
    expect((await s.call(API.adminUsers, { cookie: admin2.cookie })).status).toBe(200);
    expect(
      (await s.call(API.adminSetRole, { body: { userId: admin2.id, role: 'user' }, cookie: admin1 })).status,
    ).toBe(200);
    // Demotion revoked their sessions; even a fresh login has no admin access.
    expect((await s.call(API.adminUsers, { cookie: admin2.cookie })).status).toBe(401);
    const again = await s.login('admin2');
    expect((await s.call(API.adminUsers, { cookie: again })).status).toBe(403);
  });
});

describe('GET /api/admin/users', () => {
  it('lists accounts and pending invites — never anybody’s records', async () => {
    const s = await createTestServer();
    s.data.forUser(s.anna.id).apply([
      {
        kind: 'day.put',
        date: '2026-10-09',
        value: { food: 'СЕКРЕТНИЙ БОРЩ', kcal: 900, trained: null, types: [], notes: 'нотатка' },
      },
      { kind: 'weight.put', date: '2026-10-09', kg: 61.7 },
    ]);
    const pending = s.users.create({
      username: 'pending',
      role: 'user',
      passwordHash: null,
      now: s.clock.now,
    });
    const off = s.users.create({ username: 'off', role: 'user', passwordHash: 'h', now: s.clock.now });
    s.users.setDisabled(off.id, s.clock.now);
    s.users.setAiLimit(off.id, 3);
    s.budget.forUser(s.anna.id).tryConsume(s.clock.now);
    s.budget.forUser(s.anna.id).tryConsume(s.clock.now);
    const cookie = await s.login('admin');
    await s.call(API.adminInviteCreate, { body: { note: 'для Олі' }, cookie });
    s.tokens.createInvite({ role: 'admin', note: '', createdBy: null, now: s.clock.now - 1 });

    const res = await s.call(API.adminUsers, { cookie });
    const text = await res.clone().text();
    expect(text).not.toContain('СЕКРЕТНИЙ');
    expect(text).not.toContain('нотатка');
    expect(text).not.toContain('61.7');
    expect(text).not.toContain('scrypt');
    const body = await json<AdminOverview>(res);
    expect(Object.keys(body).sort()).toEqual(['aiToday', 'invites', 'limits', 'users']);
    for (const user of body.users) {
      expect(Object.keys(user).sort()).toEqual([
        'ai',
        'createdAt',
        'id',
        'lastSeenAt',
        'role',
        'self',
        'status',
        'username',
      ]);
    }
    const byName = Object.fromEntries(body.users.map((u) => [u.username, u]));
    expect(byName.anna).toEqual({
      id: s.anna.id,
      username: 'anna',
      role: 'user',
      status: 'active',
      createdAt: s.anna.createdAt,
      lastSeenAt: null,
      ai: { today: 2, last30Days: 2, limit: 40, customLimit: null },
      self: false,
    });
    expect(byName.admin).toMatchObject({
      role: 'admin',
      status: 'active',
      self: true,
      lastSeenAt: s.clock.now,
    });
    expect(byName.pending).toMatchObject({ id: pending.id, status: 'pending' });
    expect(byName.off).toMatchObject({ status: 'disabled', ai: { limit: 3, customLimit: 3, today: 0 } });
    expect(body.invites.map((i) => [i.note, i.role, i.createdBy])).toEqual([
      ['для Олі', 'user', 'admin'],
      ['', 'admin', null],
    ]);
    expect(body.limits).toEqual({ perUser: 40, global: 150 });
    expect(body.aiToday).toEqual({ used: 2, ceiling: 150 });
  });
});

describe('invites', () => {
  it('creates a role-user invite (path with the token in the fragment), lists it and revokes it once', async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    const res = await s.call(API.adminInviteCreate, { body: { note: '  для Олі  ' }, cookie });
    expect(res.status).toBe(200);
    const body = await json<InviteCreatedResponse>(res);
    expect(body.path).toMatch(/^\/invite#[A-Za-z0-9_-]{43}$/);
    expect(body.invite).toEqual({
      id: expect.stringMatching(/^[0-9a-f]{32}$/),
      note: 'для Олі',
      role: 'user',
      createdAt: s.clock.now,
      expiresAt: body.expiresAt,
      createdBy: 'admin',
    });
    expect((await overview(s, cookie)).invites.map((i) => i.id)).toEqual([body.invite.id]);
    // The token is not stored.
    expect(JSON.stringify(s.db.prepare('SELECT * FROM invites').all())).not.toContain(tokenOf(body.path));

    expect((await s.call(API.adminInviteRevoke, { body: { id: body.invite.id }, cookie })).status).toBe(200);
    const again = await s.call(API.adminInviteRevoke, { body: { id: body.invite.id }, cookie });
    expect(again.status).toBe(404);
    expect((await s.call(API.adminInviteRevoke, { body: { id: ID }, cookie })).status).toBe(404);
    expect((await s.call(API.adminInviteRevoke, { body: { id: 'nope' }, cookie })).status).toBe(400);
    expect((await overview(s, cookie)).invites).toEqual([]);
  });

  it('a note over 60 characters is 400', async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    expect((await s.call(API.adminInviteCreate, { body: { note: 'x'.repeat(61) }, cookie })).status).toBe(
      400,
    );
    expect((await s.call(API.adminInviteCreate, { body: {}, cookie })).status).toBe(200);
  });

  it(`at most ${MAX_PENDING_INVITES} pending invites → 409 limit_reached`, async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    for (let i = 0; i < MAX_PENDING_INVITES; i++) {
      expect((await s.call(API.adminInviteCreate, { body: {}, cookie })).status).toBe(200);
    }
    const res = await s.call(API.adminInviteCreate, { body: {}, cookie });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({
      error: 'limit_reached',
      message: 'Забагато активних запрошень — скасуй старі',
    });
  });
});

describe('reset links', () => {
  it('reset for a user with a password, setup for one without; 404 unknown; 409 for a disabled account', async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    const res = await s.call(API.adminResetLink, { body: { userId: s.anna.id }, cookie });
    const body = await json<LinkResponse>(res);
    expect(body).toEqual({
      ok: true,
      path: expect.stringMatching(/^\/reset#[A-Za-z0-9_-]{43}$/),
      expiresAt: s.clock.now + RESET_TTL_MS,
    });
    expect(s.tokens.checkReset(tokenOf(body.path), s.clock.now)).toMatchObject({
      ok: true,
      link: { purpose: 'reset', userId: s.anna.id, createdBy: s.admin.id },
    });
    const pending = s.users.create({ username: 'pending', role: 'user', passwordHash: null, now: 0 });
    const setup = await json<LinkResponse>(
      await s.call(API.adminResetLink, { body: { userId: pending.id }, cookie }),
    );
    expect(s.tokens.checkReset(tokenOf(setup.path), s.clock.now)).toMatchObject({
      link: { purpose: 'setup' },
    });

    expect((await s.call(API.adminResetLink, { body: { userId: ID }, cookie })).status).toBe(404);
    s.users.setDisabled(s.anna.id, s.clock.now);
    const disabled = await s.call(API.adminResetLink, { body: { userId: s.anna.id }, cookie });
    expect(disabled.status).toBe(409);
    expect(await json(disabled)).toMatchObject({ error: 'account_disabled' });
  });

  it('an admin can make a reset link for themselves', async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    expect((await s.call(API.adminResetLink, { body: { userId: s.admin.id }, cookie })).status).toBe(200);
  });
});

describe('roles (D18)', () => {
  it('promotes and demotes; the last usable admin cannot be demoted', async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    const last = await s.call(API.adminSetRole, { body: { userId: s.admin.id, role: 'user' }, cookie });
    expect(last.status).toBe(409);
    expect(await json(last)).toEqual({ error: 'last_admin', message: 'Це єдиний адміністратор' });
    expect(s.users.byId(s.admin.id)?.role).toBe('admin');

    expect(
      (await s.call(API.adminSetRole, { body: { userId: s.anna.id, role: 'admin' }, cookie })).status,
    ).toBe(200);
    expect(s.users.byId(s.anna.id)?.role).toBe('admin');
    // Self-demotion is fine while another usable admin exists; this session survives it.
    expect(
      (await s.call(API.adminSetRole, { body: { userId: s.admin.id, role: 'user' }, cookie })).status,
    ).toBe(200);
    expect(s.users.byId(s.admin.id)?.role).toBe('user');
    expect((await s.call(API.me, { cookie })).status).toBe(200);
    expect((await s.call(API.adminUsers, { cookie })).status).toBe(403);
    expect((await s.call(API.adminSetRole, { body: { userId: ID, role: 'user' }, cookie })).status).toBe(403);
  });

  it('a pending or disabled admin does not count as usable', async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    s.users.create({ username: 'pending', role: 'admin', passwordHash: null, now: 0 });
    const off = s.users.create({ username: 'off', role: 'admin', passwordHash: 'h', now: 0 });
    s.users.setDisabled(off.id, 1);
    expect(
      (await s.call(API.adminSetRole, { body: { userId: s.admin.id, role: 'user' }, cookie })).status,
    ).toBe(409);
  });

  it('demotion revokes the target’s sessions', async () => {
    const s = await createTestServer();
    const admin2 = await s.createUser('admin2', 'admin');
    const cookie = await s.login('admin');
    expect(
      (await s.call(API.adminSetRole, { body: { userId: admin2.id, role: 'user' }, cookie })).status,
    ).toBe(200);
    expect((await s.call(API.me, { cookie: admin2.cookie })).status).toBe(401);
    expect((await s.call(API.adminSetRole, { body: { userId: ID, role: 'user' }, cookie })).status).toBe(404);
  });
});

describe('disable / enable', () => {
  it('disable signs the account out everywhere, drops its push devices and pending resets; enable restores login', async () => {
    const s = await createTestServer();
    const annaCookie = await s.login('anna');
    s.subscriptions
      .forUser(s.anna.id)
      .upsert({ endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' }, null, 0);
    const reset = s.tokens.createReset({
      userId: s.anna.id,
      purpose: 'reset',
      createdBy: s.admin.id,
      now: s.clock.now,
    });
    const cookie = await s.login('admin');
    expect(
      (await s.call(API.adminSetDisabled, { body: { userId: s.anna.id, disabled: true }, cookie })).status,
    ).toBe(200);
    expect(s.users.byId(s.anna.id)?.disabledAt).toBe(s.clock.now);
    expect((await s.call(API.me, { cookie: annaCookie })).status).toBe(401);
    expect(s.subscriptions.forUser(s.anna.id).all()).toEqual([]);
    expect(s.tokens.checkReset(reset.token, s.clock.now)).toEqual({ ok: false, reason: 'revoked' });
    expect((await s.call(API.login, { body: { username: 'anna', password: PASSWORD } })).status).toBe(403);
    // Her records stay.
    expect(s.users.byId(s.anna.id)).not.toBeNull();

    expect(
      (await s.call(API.adminSetDisabled, { body: { userId: s.anna.id, disabled: false }, cookie })).status,
    ).toBe(200);
    expect((await s.call(API.login, { body: { username: 'anna', password: PASSWORD } })).status).toBe(200);
  });

  it('nobody can disable themselves', async () => {
    const s = await createTestServer();
    await s.createUser('admin2', 'admin');
    const cookie = await s.login('admin');
    const res = await s.call(API.adminSetDisabled, { body: { userId: s.admin.id, disabled: true }, cookie });
    expect(res.status).toBe(409);
    expect(await json(res)).toEqual({ error: 'self_action', message: 'Із власним акаунтом так не можна' });
    expect(
      (await s.call(API.adminSetDisabled, { body: { userId: ID, disabled: true }, cookie })).status,
    ).toBe(404);
  });
});

describe('delete', () => {
  it('removes the account’s rows and photo files and keeps everybody else’s', async () => {
    const s = await createTestServer();
    const olya = await s.createUser('olya');
    const day = { food: 'x', kcal: null, trained: null, types: [], notes: '' };
    for (const id of [s.anna.id, olya.id]) {
      s.data.forUser(id).apply([
        { kind: 'day.put', date: '2026-10-09', value: day },
        { kind: 'weight.put', date: '2026-10-09', kg: 60 },
        { kind: 'food.use', date: '2026-10-09', value: { name: 'Кава', portion: '', kcal: 40 } },
      ]);
    }
    const upload = { full: fakeJpeg(100), thumb: fakeJpeg(20) };
    const olyaPhoto = await s.photos.forUser(olya.id).save(upload, '2026-10-09');
    const annaPhoto = await s.photos.forUser(s.anna.id).save(upload, '2026-10-09');
    s.subscriptions
      .forUser(olya.id)
      .upsert({ endpoint: 'https://push.example/o', p256dh: 'p', auth: 'o' }, null, 0);
    const cookie = await s.login('admin');

    const mismatch = await s.call(API.adminDeleteUser, {
      body: { userId: olya.id, confirmUsername: 'anna' },
      cookie,
    });
    expect(mismatch.status).toBe(400);
    expect(await json(mismatch)).toEqual({
      error: 'bad_request',
      message: 'Імʼя для підтвердження не збігається',
    });
    expect(s.users.byId(olya.id)).not.toBeNull();

    const res = await s.call(API.adminDeleteUser, {
      body: { userId: olya.id, confirmUsername: 'OLYA' },
      cookie,
    });
    expect(res.status).toBe(200);
    expect(s.users.byId(olya.id)).toBeNull();
    expect((await s.call(API.me, { cookie: olya.cookie })).status).toBe(401);
    for (const table of ['days', 'weights', 'foods', 'photos', 'push_subscriptions', 'sessions']) {
      const n = s.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id = ?`).get(olya.id)?.n;
      expect(n, table).toBe(0);
    }
    expect(existsSync(join(s.photosDir, `${olyaPhoto}.jpg`))).toBe(false);
    expect(existsSync(join(s.photosDir, `${olyaPhoto}_t.jpg`))).toBe(false);
    // anna's rows and files are intact.
    expect(s.data.forUser(s.anna.id).read()).toMatchObject({ weights: [{ date: '2026-10-09', kg: 60 }] });
    expect(existsSync(join(s.photosDir, `${annaPhoto}.jpg`))).toBe(true);
    expect(await s.photos.forUser(s.anna.id).read(annaPhoto, 'full')).not.toBeNull();
  });

  it('refuses deleting yourself; 404 for an unknown account', async () => {
    const s = await createTestServer();
    await s.createUser('admin2', 'admin');
    const cookie = await s.login('admin');
    const self = await s.call(API.adminDeleteUser, {
      body: { userId: s.admin.id, confirmUsername: 'admin' },
      cookie,
    });
    expect(self.status).toBe(409);
    expect(await json(self)).toMatchObject({ error: 'self_action' });
    expect(
      (await s.call(API.adminDeleteUser, { body: { userId: ID, confirmUsername: 'x' }, cookie })).status,
    ).toBe(404);
  });

  it('deleting another admin revokes their links first (created_by still names them)', async () => {
    const s = await createTestServer();
    const admin2 = await s.createUser('admin2', 'admin');
    const link = await json<LinkResponse>(
      await s.call(API.adminResetLink, { body: { userId: s.anna.id }, cookie: admin2.cookie }),
    );
    const cookie = await s.login('admin');
    expect(
      (await s.call(API.adminDeleteUser, { body: { userId: admin2.id, confirmUsername: 'admin2' }, cookie }))
        .status,
    ).toBe(200);
    expect(s.tokens.checkReset(tokenOf(link.path), s.clock.now)).toEqual({ ok: false, reason: 'revoked' });
  });
});

describe('AI limits', () => {
  it('per-user override: set, shown in the overview, back to the default with null; bounds; 404', async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    expect(
      (await s.call(API.adminUserAiLimit, { body: { userId: s.anna.id, limit: 7 }, cookie })).status,
    ).toBe(200);
    const annaRow = (await overview(s, cookie)).users.find((u) => u.id === s.anna.id);
    expect(annaRow?.ai).toMatchObject({ limit: 7, customLimit: 7 });
    expect(s.budget.forUser(s.anna.id).limit()).toBe(7);
    expect(
      (await s.call(API.adminUserAiLimit, { body: { userId: s.anna.id, limit: null }, cookie })).status,
    ).toBe(200);
    expect(s.budget.forUser(s.anna.id).limit()).toBe(40);
    for (const limit of [-1, 1001, 2.5, '5']) {
      expect(
        (await s.call(API.adminUserAiLimit, { body: { userId: s.anna.id, limit }, cookie })).status,
        String(limit),
      ).toBe(400);
    }
    expect((await s.call(API.adminUserAiLimit, { body: { userId: ID, limit: 1 }, cookie })).status).toBe(404);
  });

  it('global limits: saved in kv, win over the defaults, bounds checked', async () => {
    const s = await createTestServer();
    const cookie = await s.login('admin');
    expect((await s.call(API.adminAiLimits, { body: { perUser: 0, global: 10_000 }, cookie })).status).toBe(
      200,
    );
    const body = await overview(s, cookie);
    expect(body.limits).toEqual({ perUser: 0, global: 10_000 });
    expect(body.aiToday.ceiling).toBe(10_000);
    expect(s.budget.limitsSource()).toBe('kv');
    expect(s.budget.forUser(s.anna.id).remaining(s.clock.now)).toBe(0);
    for (const limits of [
      { perUser: 1001, global: 1 },
      { perUser: 1, global: 10_001 },
      { perUser: -1, global: 1 },
      { perUser: 1.5, global: 1 },
      { perUser: 1 },
    ]) {
      expect((await s.call(API.adminAiLimits, { body: limits, cookie })).status, JSON.stringify(limits)).toBe(
        400,
      );
    }
    expect(s.budget.limits()).toEqual({ perUser: 0, global: 10_000 });
  });
});

describe('admin sessions', () => {
  it('a self-demotion keeps the acting session but revokes the admin’s other sessions', async () => {
    const s = await createTestServer();
    await s.createUser('admin2', 'admin');
    const acting = await s.login('admin', ADMIN_PASSWORD);
    const other = await s.login('admin', ADMIN_PASSWORD);
    expect(
      (await s.call(API.adminSetRole, { body: { userId: s.admin.id, role: 'user' }, cookie: acting })).status,
    ).toBe(200);
    expect((await s.call(API.me, { cookie: acting })).status).toBe(200);
    expect((await s.call(API.me, { cookie: other })).status).toBe(401);
    expect(s.sessions.check(acting.slice(4), s.clock.now)?.tokenHash).toBe(hashToken(acting.slice(4)));
  });
});
