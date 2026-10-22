import { describe, expect, it } from 'vitest';
import {
  AI_LIMIT_BOUNDS,
  ALIAS_USERNAMES,
  API,
  DEFAULT_AI_LIMITS,
  INVITE_TTL_MS,
  LEGACY_OWNER_ID,
  LINK_PATHS,
  RESERVED_USERNAMES,
  RESET_TTL_MS,
  USER_HEADER,
  aiLimitsSchema,
  changePasswordRequestSchema,
  createInviteRequestSchema,
  deleteUserRequestSchema,
  inviteAcceptRequestSchema,
  inviteIdRequestSchema,
  linkCheckRequestSchema,
  linkPath,
  linkTokenSchema,
  loginRequestSchema,
  meResponseSchema,
  newPasswordSchema,
  parseLink,
  pushUnsubscribeRequestSchema,
  renameRequestSchema,
  resetCompleteRequestSchema,
  sessionUserSchema,
  setDisabledRequestSchema,
  setRoleRequestSchema,
  tokenFromHash,
  userAiLimitRequestSchema,
  userIdSchema,
  usernameKey,
  usernameProblem,
  usernameSchema,
  userTargetRequestSchema,
  type SessionUser,
} from './index';

/** 43 base64url characters, like a real token (32 random bytes). */
const TOKEN = 'Qm9vLWJhcl9iYXotUXV4LTEyMzQ1Njc4OTBhYmNkZWZ';
const ORIGIN = 'https://fit.triple-a.dev';
const ID = '0123456789abcdef0123456789abcdef';

const user = (over: Partial<SessionUser> = {}): SessionUser => ({
  id: ID,
  username: 'Olya',
  role: 'user',
  createdAt: 1_760_000_000_000,
  legacyOwner: false,
  passwordChange: null,
  ...over,
});

describe('constants', () => {
  it('match the contract', () => {
    expect(TOKEN).toHaveLength(43);
    expect(ALIAS_USERNAMES).toEqual(['legko']);
    expect(RESERVED_USERNAMES).toEqual(['legko', 'admin']);
    expect(LEGACY_OWNER_ID).toBe('00000000000000000000000000000001');
    expect(userIdSchema.safeParse(LEGACY_OWNER_ID).success).toBe(true);
    expect(INVITE_TTL_MS).toBe(7 * 24 * 3600 * 1000);
    expect(RESET_TTL_MS).toBe(24 * 3600 * 1000);
    expect(DEFAULT_AI_LIMITS).toEqual({ perUser: 40, global: 150 });
    expect(Object.isFrozen(DEFAULT_AI_LIMITS)).toBe(true);
    expect(aiLimitsSchema.safeParse(DEFAULT_AI_LIMITS).success).toBe(true);
    expect(LINK_PATHS).toEqual({ invite: '/invite', reset: '/reset' });
    expect(USER_HEADER).toBe('X-Legko-User');
  });

  it('has the new API paths', () => {
    expect(API).toMatchObject({
      inviteCheck: '/api/auth/invite/check',
      inviteAccept: '/api/auth/invite/accept',
      resetCheck: '/api/auth/reset/check',
      resetComplete: '/api/auth/reset/complete',
      accountPassword: '/api/account/password',
      accountUsername: '/api/account/username',
      adminUsers: '/api/admin/users',
      adminInviteCreate: '/api/admin/invites',
      adminInviteRevoke: '/api/admin/invites/revoke',
      adminResetLink: '/api/admin/users/reset-link',
      adminSetRole: '/api/admin/users/role',
      adminSetDisabled: '/api/admin/users/disable',
      adminDeleteUser: '/api/admin/users/delete',
      adminUserAiLimit: '/api/admin/users/ai-limit',
      adminAiLimits: '/api/admin/ai-limits',
    });
    // The public link endpoints sit under /api/auth/, which the server treats as public.
    for (const path of [API.inviteCheck, API.inviteAccept, API.resetCheck, API.resetComplete]) {
      expect(path.startsWith('/api/auth/')).toBe(true);
    }
  });
});

describe('usernames', () => {
  it('needs 3–32 characters after trimming', () => {
    expect(usernameProblem('ab')).toBe('length');
    expect(usernameProblem('abc')).toBeNull();
    expect(usernameProblem('a'.repeat(32))).toBeNull();
    expect(usernameProblem('a'.repeat(33))).toBe('length');
    expect(usernameProblem('')).toBe('length');
    expect(usernameProblem('  ab  ')).toBe('length');
    expect(usernameProblem('  olya  ')).toBeNull();
  });

  it('allows latin letters, digits, dot, underscore and hyphen, with at least one letter or digit', () => {
    for (const ok of ['olya', 'Olya.K', 'anna_2', 'a-b', '007', 'x..', '._a']) {
      expect(usernameProblem(ok), ok).toBeNull();
    }
    expect(usernameProblem('olé')).toBe('chars');
    expect(usernameProblem('Оля')).toBe('chars'); // Cyrillic
    expect(usernameProblem('olya k')).toBe('chars');
    expect(usernameProblem('...')).toBe('chars');
    expect(usernameProblem('_-.')).toBe('chars');
    expect(usernameProblem('olya@home')).toBe('chars');
    expect(usernameProblem('olʼya')).toBe('chars');
  });

  it('reserves legko and admin in any case', () => {
    expect(usernameProblem('Legko')).toBe('reserved');
    expect(usernameProblem('Admin')).toBe('reserved');
    expect(usernameProblem(' ADMIN ')).toBe('reserved');
    expect(usernameProblem('admin1')).toBeNull();
    expect(usernameProblem('legko.app')).toBeNull();
  });

  it('allowAdmin lets admin through but never legko', () => {
    expect(usernameProblem('admin', { allowAdmin: true })).toBeNull();
    expect(usernameProblem('Admin', { allowAdmin: true })).toBeNull();
    expect(usernameProblem('legko', { allowAdmin: true })).toBe('reserved');
    expect(usernameProblem('LEGKO', { allowAdmin: true })).toBe('reserved');
    expect(usernameProblem('admin', { allowAdmin: false })).toBe('reserved');
  });

  it('keys are trimmed and lower-cased', () => {
    expect(usernameKey('  Olya.K ')).toBe('olya.k');
    expect(usernameKey('ANNA')).toBe('anna');
    expect(usernameKey('anna')).toBe(usernameKey(' Anna'));
  });

  it('usernameSchema trims and refuses what usernameProblem refuses', () => {
    expect(usernameSchema.parse('  olya ')).toBe('olya');
    expect(usernameSchema.safeParse('ab').success).toBe(false);
    expect(usernameSchema.safeParse('olé').success).toBe(false);
    expect(usernameSchema.safeParse('admin').success).toBe(false);
    expect(usernameSchema.safeParse('legko').success).toBe(false);
  });
});

describe('one-time links', () => {
  it('linkPath puts the token in the fragment', () => {
    expect(linkPath('invite', TOKEN)).toBe(`/invite#${TOKEN}`);
    expect(linkPath('reset', TOKEN)).toBe(`/reset#${TOKEN}`);
  });

  it('tokenFromHash takes exactly # + 43 base64url characters', () => {
    expect(tokenFromHash(`#${TOKEN}`)).toBe(TOKEN);
    expect(tokenFromHash(`#${'-_'.repeat(21)}A`)).toBe(`${'-_'.repeat(21)}A`);
    expect(tokenFromHash(`#${TOKEN.slice(1)}`)).toBeNull(); // 42
    expect(tokenFromHash(`#${TOKEN}A`)).toBeNull(); // 44
    expect(tokenFromHash(TOKEN)).toBeNull(); // no '#'
    expect(tokenFromHash(`#${TOKEN.slice(1)}+`)).toBeNull(); // base64, not base64url
    expect(tokenFromHash(`#${TOKEN.slice(1)}=`)).toBeNull();
    expect(tokenFromHash(`#${TOKEN.slice(0, 42)}\n`)).toBeNull();
    expect(tokenFromHash('')).toBeNull();
    expect(tokenFromHash('#')).toBeNull();
  });

  it('parseLink accepts invite and reset links of this origin', () => {
    expect(parseLink(`${ORIGIN}/invite#${TOKEN}`, ORIGIN)).toEqual({ kind: 'invite', token: TOKEN });
    expect(parseLink(`${ORIGIN}/reset#${TOKEN}`, ORIGIN)).toEqual({ kind: 'reset', token: TOKEN });
    // Pasted with surrounding white space (messengers add a newline).
    expect(parseLink(`  ${ORIGIN}/invite#${TOKEN}\n`, ORIGIN)).toEqual({ kind: 'invite', token: TOKEN });
    expect(parseLink(`http://127.0.0.1:3399/reset#${TOKEN}`, 'http://127.0.0.1:3399')).toEqual({
      kind: 'reset',
      token: TOKEN,
    });
  });

  it('parseLink refuses other origins', () => {
    expect(parseLink(`https://evil.example/invite#${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseLink(`http://fit.triple-a.dev/invite#${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseLink(`https://fit.triple-a.dev:8443/invite#${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseLink(`https://sub.fit.triple-a.dev/invite#${TOKEN}`, ORIGIN)).toBeNull();
  });

  it('parseLink refuses other paths', () => {
    expect(parseLink(`${ORIGIN}/#${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseLink(`${ORIGIN}/invite/#${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseLink(`${ORIGIN}/settings#${TOKEN}`, ORIGIN)).toBeNull();
    expect(parseLink(`${ORIGIN}/invite/${TOKEN}`, ORIGIN)).toBeNull(); // token in the path, not the fragment
  });

  it('parseLink refuses a bad fragment', () => {
    expect(parseLink(`${ORIGIN}/invite`, ORIGIN)).toBeNull();
    expect(parseLink(`${ORIGIN}/invite#`, ORIGIN)).toBeNull();
    expect(parseLink(`${ORIGIN}/invite#${TOKEN.slice(1)}`, ORIGIN)).toBeNull();
    expect(parseLink(`${ORIGIN}/invite#${TOKEN}A`, ORIGIN)).toBeNull();
    expect(parseLink(`${ORIGIN}/invite?token=${TOKEN}`, ORIGIN)).toBeNull();
  });

  it('parseLink never throws on garbage', () => {
    for (const junk of ['', '   ', 'hello', 'Маю посилання', '/invite#' + TOKEN, '://', 'http://', 'javascript:alert(1)']) {
      expect(parseLink(junk, ORIGIN), junk).toBeNull();
    }
    expect(parseLink(`data:text/plain,/invite#${TOKEN}`, 'null')).toBeNull();
    expect(parseLink(undefined as unknown as string, ORIGIN)).toBeNull();
  });

  it('linkTokenSchema accepts exactly 43 base64url characters', () => {
    expect(linkTokenSchema.safeParse(TOKEN).success).toBe(true);
    expect(linkTokenSchema.safeParse(TOKEN.slice(1)).success).toBe(false);
    expect(linkTokenSchema.safeParse(`${TOKEN}A`).success).toBe(false);
    expect(linkTokenSchema.safeParse(`${TOKEN.slice(1)}/`).success).toBe(false);
    expect(linkCheckRequestSchema.safeParse({ token: TOKEN }).success).toBe(true);
    expect(linkCheckRequestSchema.safeParse({}).success).toBe(false);
  });
});

describe('request schemas', () => {
  it('login: the username is optional (the legko alias) and trimmed', () => {
    expect(loginRequestSchema.parse({ password: 'secret' })).toEqual({ password: 'secret' });
    expect(loginRequestSchema.parse({ username: '  Anna ', password: 'secret' })).toEqual({
      username: 'Anna',
      password: 'secret',
    });
    // Not format-checked: an invalid name must answer like a wrong one.
    expect(loginRequestSchema.safeParse({ username: 'olé k', password: 'x' }).success).toBe(true);
    expect(loginRequestSchema.safeParse({ username: '   ', password: 'secret' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ username: 'a'.repeat(65), password: 'secret' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ username: 'anna', password: '' }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ username: 'anna', password: 'x'.repeat(201) }).success).toBe(false);
    expect(loginRequestSchema.safeParse({ username: 'anna' }).success).toBe(false);
  });

  it('push unsubscribe: auth is optional', () => {
    const endpoint = 'https://web.push.apple.com/QAbc';
    expect(pushUnsubscribeRequestSchema.parse({ endpoint })).toEqual({ endpoint });
    expect(pushUnsubscribeRequestSchema.parse({ endpoint, auth: 'k3y' })).toEqual({ endpoint, auth: 'k3y' });
    expect(pushUnsubscribeRequestSchema.safeParse({ endpoint, auth: '' }).success).toBe(false);
    expect(pushUnsubscribeRequestSchema.safeParse({ endpoint, auth: 'a'.repeat(101) }).success).toBe(false);
    expect(pushUnsubscribeRequestSchema.safeParse({ endpoint: 'not a url' }).success).toBe(false);
  });

  it('invite accept, reset complete, account changes cap sizes only', () => {
    expect(inviteAcceptRequestSchema.safeParse({ token: TOKEN, username: 'olya', password: 'longenough' }).success).toBe(
      true,
    );
    // Rules are checked by the route (invalid_username / weak_password), not here.
    expect(inviteAcceptRequestSchema.safeParse({ token: TOKEN, username: 'x', password: 'short' }).success).toBe(true);
    expect(inviteAcceptRequestSchema.safeParse({ token: 'nope', username: 'olya', password: 'longenough' }).success).toBe(
      false,
    );
    expect(
      inviteAcceptRequestSchema.safeParse({ token: TOKEN, username: 'a'.repeat(65), password: 'longenough' }).success,
    ).toBe(false);
    expect(resetCompleteRequestSchema.safeParse({ token: TOKEN, password: 'x'.repeat(200) }).success).toBe(true);
    expect(resetCompleteRequestSchema.safeParse({ token: TOKEN, password: 'x'.repeat(201) }).success).toBe(false);
    expect(changePasswordRequestSchema.safeParse({ currentPassword: '', newPassword: 'longenough' }).success).toBe(false);
    expect(changePasswordRequestSchema.safeParse({ currentPassword: 'old', newPassword: 'new' }).success).toBe(true);
    expect(renameRequestSchema.safeParse({ username: 'olya.k', password: '' }).success).toBe(false);
    expect(renameRequestSchema.safeParse({ username: 'olya.k', password: 'pw' }).success).toBe(true);
  });

  it('new passwords are 8–200 characters', () => {
    expect(newPasswordSchema.safeParse('1234567').success).toBe(false);
    expect(newPasswordSchema.safeParse('12345678').success).toBe(true);
    expect(newPasswordSchema.safeParse('x'.repeat(200)).success).toBe(true);
    expect(newPasswordSchema.safeParse('x'.repeat(201)).success).toBe(false);
  });

  it('admin requests', () => {
    expect(createInviteRequestSchema.parse({})).toEqual({ note: '' });
    expect(createInviteRequestSchema.parse({ note: '  для Олі ' })).toEqual({ note: 'для Олі' });
    expect(createInviteRequestSchema.safeParse({ note: 'x'.repeat(61) }).success).toBe(false);
    expect(inviteIdRequestSchema.safeParse({ id: ID }).success).toBe(true);
    expect(userTargetRequestSchema.safeParse({ userId: ID }).success).toBe(true);
    expect(setRoleRequestSchema.safeParse({ userId: ID, role: 'admin' }).success).toBe(true);
    expect(setRoleRequestSchema.safeParse({ userId: ID, role: 'owner' }).success).toBe(false);
    expect(setDisabledRequestSchema.safeParse({ userId: ID, disabled: true }).success).toBe(true);
    expect(setDisabledRequestSchema.safeParse({ userId: ID, disabled: 'yes' }).success).toBe(false);
    expect(deleteUserRequestSchema.safeParse({ userId: ID, confirmUsername: 'olya' }).success).toBe(true);
    expect(deleteUserRequestSchema.safeParse({ userId: ID }).success).toBe(false);
    expect(userAiLimitRequestSchema.safeParse({ userId: ID, limit: null }).success).toBe(true);
    expect(userAiLimitRequestSchema.safeParse({ userId: ID, limit: 0 }).success).toBe(true);
    expect(userAiLimitRequestSchema.safeParse({ userId: ID, limit: 1000 }).success).toBe(true);
    expect(userAiLimitRequestSchema.safeParse({ userId: ID, limit: 1001 }).success).toBe(false);
    expect(userAiLimitRequestSchema.safeParse({ userId: ID, limit: 2.5 }).success).toBe(false);
  });

  it('aiLimitsSchema bounds', () => {
    expect(aiLimitsSchema.safeParse({ perUser: 0, global: 0 }).success).toBe(true);
    expect(aiLimitsSchema.safeParse({ perUser: AI_LIMIT_BOUNDS.perUser.max, global: AI_LIMIT_BOUNDS.global.max }).success).toBe(
      true,
    );
    expect(aiLimitsSchema.safeParse({ perUser: 1001, global: 150 }).success).toBe(false);
    expect(aiLimitsSchema.safeParse({ perUser: 40, global: 10_001 }).success).toBe(false);
    expect(aiLimitsSchema.safeParse({ perUser: -1, global: 150 }).success).toBe(false);
    expect(aiLimitsSchema.safeParse({ perUser: 40.5, global: 150 }).success).toBe(false);
    expect(aiLimitsSchema.safeParse({ perUser: 40 }).success).toBe(false);
  });

  it('userIdSchema: 32 lowercase hex characters', () => {
    expect(userIdSchema.safeParse(ID).success).toBe(true);
    expect(userIdSchema.safeParse(ID.toUpperCase()).success).toBe(false);
    expect(userIdSchema.safeParse(ID.slice(1)).success).toBe(false);
    expect(userIdSchema.safeParse(`${ID}0`).success).toBe(false);
    expect(userIdSchema.safeParse(`${ID.slice(1)}g`).success).toBe(false);
    expect(userIdSchema.safeParse('').success).toBe(false);
  });
});

describe('session user', () => {
  it('meResponseSchema rejects a bare { ok: true } (an old server) and accepts a full user', () => {
    expect(meResponseSchema.safeParse({ ok: true }).success).toBe(false);
    expect(meResponseSchema.safeParse({ ok: false, user: user() }).success).toBe(false);
    expect(meResponseSchema.parse({ ok: true, user: user() })).toEqual({ ok: true, user: user() });
    const changed = user({
      role: 'admin',
      legacyOwner: true,
      id: LEGACY_OWNER_ID,
      passwordChange: { at: 1_761_000_000_000, via: 'reset', by: 'admin' },
    });
    expect(meResponseSchema.parse({ ok: true, user: changed }).user).toEqual(changed);
  });

  it('sessionUserSchema checks every field', () => {
    expect(sessionUserSchema.safeParse(user({ id: 'abc' })).success).toBe(false);
    expect(sessionUserSchema.safeParse(user({ username: '' })).success).toBe(false);
    expect(sessionUserSchema.safeParse({ ...user(), role: 'owner' }).success).toBe(false);
    expect(sessionUserSchema.safeParse({ ...user(), legacyOwner: undefined }).success).toBe(false);
    expect(sessionUserSchema.safeParse({ ...user(), passwordChange: undefined }).success).toBe(false);
    expect(
      sessionUserSchema.safeParse(user({ passwordChange: { at: 1, via: 'magic' as 'self', by: null } })).success,
    ).toBe(false);
    for (const via of ['self', 'reset', 'setup', 'cli'] as const) {
      expect(sessionUserSchema.safeParse(user({ passwordChange: { at: 1, via, by: null } })).success, via).toBe(true);
    }
    // Unknown keys from a newer server are dropped, not refused.
    expect(sessionUserSchema.parse({ ...user(), extra: 1 })).toEqual(user());
  });
});
