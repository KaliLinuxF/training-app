import { MAX_PENDING_INVITES, RESET_TTL_MS, tokenFromHash } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import type { Config } from '../config';
import { openDatabase } from '../db/open';
import { createTokenRepo } from '../db/tokens';
import { createUserRepo, UsernameTaken } from '../db/users';
import { createLogger } from '../logger';
import { createSubscriptionRepo } from '../push/subscriptions';
import {
  AccountDisabled,
  AlreadyAdmin,
  ConfirmMismatch,
  createAccountService,
  ExistsAsUser,
  InvalidUsername,
  LastAdmin,
  LinkInvalid,
  SelfAction,
  TooManyInvites,
  UserNotFound,
  WeakPassword,
} from './accounts';
import { applyDevUsers } from './devUsers';
import { createScryptGate, verifyPassword } from './password';
import { createSessionStore, hashToken } from './sessions';

const cheap = { N: 1024, r: 8, p: 1 };
const T0 = Date.UTC(2026, 9, 21, 9, 0);

function setup() {
  const db = openDatabase(':memory:');
  const lines: string[] = [];
  const logger = createLogger('info', (line) => lines.push(line));
  const users = createUserRepo(db);
  const tokens = createTokenRepo(db, logger);
  const sessions = createSessionStore(db);
  const gate = createScryptGate();
  const removed: string[] = [];
  const accounts = createAccountService({
    db,
    users,
    tokens,
    sessions,
    subscriptions: createSubscriptionRepo(db),
    removePhotoFiles: (ids) => removed.push(...ids),
    logger,
    scrypt: cheap,
    gate,
  });
  return { db, users, tokens, sessions, accounts, gate, lines, removed };
}

const tokenOf = (path: string): string => tokenFromHash(path.slice(path.indexOf('#'))) ?? '';

describe('accounts: CLI create-admin (bootstrap without a password in chat or history)', () => {
  it('creates an admin with no usable password and a 24 h single-use setup link', async () => {
    const { users, tokens, accounts, lines } = setup();
    const { path, expiresAt, user } = accounts.createAdmin('admin', T0);
    expect(path).toMatch(/^\/reset#[A-Za-z0-9_-]{43}$/);
    expect(expiresAt).toBe(T0 + RESET_TTL_MS);
    expect(user).toMatchObject({ username: 'admin', role: 'admin', passwordHash: null });
    expect(tokens.checkReset(tokenOf(path), T0 + 1)).toMatchObject({
      ok: true,
      link: { purpose: 'setup', userId: user.id, createdBy: null },
    });
    // The token never reaches the log.
    expect(lines.join('\n')).not.toContain(tokenOf(path));

    const signed = await accounts.completeReset({
      token: tokenOf(path),
      password: 'chosen in browser',
      now: T0 + 2,
    });
    expect(signed.user).toMatchObject({ username: 'admin', role: 'admin' });
    expect(signed.user.passwordChange).toEqual({ at: T0 + 2, via: 'setup', by: null });
    const row = users.byId(user.id);
    expect(await verifyPassword('chosen in browser', row?.passwordHash ?? '')).toBe(true);
    await expect(
      accounts.completeReset({ token: tokenOf(path), password: 'second use', now: T0 + 3 }),
    ).rejects.toEqual(new LinkInvalid('used'));
  });

  it('refuses an existing admin, an existing regular user (with its role), and invalid names', () => {
    const { users, accounts } = setup();
    users.create({ username: 'Admin', role: 'admin', passwordHash: 'h', now: 0 });
    users.create({ username: 'boss', role: 'user', passwordHash: 'h', now: 0 });
    expect(() => accounts.createAdmin('admin', T0)).toThrow(AlreadyAdmin);
    expect(() => accounts.createAdmin('BOSS', T0)).toThrow(ExistsAsUser);
    expect(() => accounts.createAdmin('legko', T0)).toThrow(InvalidUsername);
    expect(() => accounts.createAdmin('a b', T0)).toThrow(InvalidUsername);
    expect(users.count()).toBe(2);
  });
});

describe('accounts: CLI set-password / rename-user / set-role', () => {
  it('cliSetPassword: via cli, signs the user out everywhere, refuses unknown users and weak passwords', async () => {
    const { users, sessions, accounts } = setup();
    const anna = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 });
    const token = sessions.create(anna.id, 0);
    await expect(accounts.cliSetPassword('nobody', 'long enough', T0)).rejects.toBeInstanceOf(UserNotFound);
    await expect(accounts.cliSetPassword('anna', 'short', T0)).rejects.toBeInstanceOf(WeakPassword);
    const row = await accounts.cliSetPassword('ANNA', 'long enough', T0);
    expect(row.passwordChangedVia).toBe('cli');
    expect(sessions.check(token, T0)).toBeNull();
  });

  it('renameUser allows admin, refuses legko and taken names', () => {
    const { users, accounts } = setup();
    const a = users.create({ username: 'owner', role: 'admin', passwordHash: 'h', now: 0 });
    users.create({ username: 'anna', role: 'user', passwordHash: 'h', now: 0 });
    expect(accounts.renameUser(a.id, 'admin').username).toBe('admin');
    expect(() => accounts.renameUser(a.id, 'legko')).toThrow(InvalidUsername);
    expect(() => accounts.renameUser(a.id, 'Anna')).toThrow(UsernameTaken);
  });

  it('setRole from the CLI never removes the last usable admin; promotion works with none', () => {
    const { users, accounts } = setup();
    const anna = users.create({ username: 'anna', role: 'user', passwordHash: 'h', now: 0 });
    accounts.setRole(null, anna.id, 'admin', T0);
    expect(() => accounts.setRole(null, anna.id, 'user', T0)).toThrow(LastAdmin);
    const pending = users.create({ username: 'pending', role: 'admin', passwordHash: null, now: 0 });
    // A pending admin is not usable: anna is still the last one; the pending one may be demoted.
    expect(() => accounts.setRole(null, anna.id, 'user', T0)).toThrow(LastAdmin);
    accounts.setRole(null, pending.id, 'user', T0);
    expect(users.byId(pending.id)?.role).toBe('user');
  });
});

describe('accounts: admin rules', () => {
  it('self actions and the delete confirmation', () => {
    const { users, sessions, accounts } = setup();
    const admin = users.create({ username: 'admin', role: 'admin', passwordHash: 'h', now: 0 });
    const anna = users.create({ username: 'anna', role: 'user', passwordHash: 'h', now: 0 });
    const actor = {
      user: { ...admin, passwordChange: null },
      sessionHash: hashToken(sessions.create(admin.id, 0)),
    };
    expect(() => accounts.setDisabled(actor, admin.id, true, T0)).toThrow(SelfAction);
    expect(() => accounts.deleteUser(actor, admin.id, 'admin', T0)).toThrow(SelfAction);
    expect(() => accounts.deleteUser(actor, anna.id, 'olya', T0)).toThrow(ConfirmMismatch);
    expect(accounts.deleteUser(actor, anna.id, ' ANNA ', T0)).toEqual([]);
    expect(users.byId(anna.id)).toBeNull();
  });

  it('the last usable admin can be neither disabled nor deleted (checked inside the transaction)', () => {
    const { users, accounts } = setup();
    const admin = users.create({ username: 'admin', role: 'admin', passwordHash: 'h', now: 0 });
    expect(() => accounts.setDisabled(null, admin.id, true, T0)).toThrow(LastAdmin);
    expect(() => accounts.deleteUser(null, admin.id, 'admin', T0)).toThrow(LastAdmin);
    const second = users.create({ username: 'second', role: 'admin', passwordHash: 'h', now: 0 });
    accounts.setDisabled(null, admin.id, true, T0);
    expect(() => accounts.setDisabled(null, second.id, true, T0)).toThrow(LastAdmin);
    expect(() => accounts.deleteUser(null, second.id, 'second', T0)).toThrow(LastAdmin);
    // A disabled admin is not usable: deleting it is fine.
    expect(accounts.deleteUser(null, admin.id, 'admin', T0)).toEqual([]);
  });

  it('a reset link for a disabled account is refused; a pending account gets a setup link', () => {
    const { users, accounts } = setup();
    const off = users.create({ username: 'off', role: 'user', passwordHash: 'h', now: 0 });
    users.setDisabled(off.id, 1);
    expect(() => accounts.createResetLink({ userId: off.id, createdBy: null, now: T0 })).toThrow(
      AccountDisabled,
    );
    const pending = users.create({ username: 'pending', role: 'user', passwordHash: null, now: 0 });
    expect(accounts.createResetLink({ userId: pending.id, createdBy: null, now: T0 }).purpose).toBe('setup');
  });

  it(`refuses a ${MAX_PENDING_INVITES + 1}st pending invite`, () => {
    const { accounts } = setup();
    for (let i = 0; i < MAX_PENDING_INVITES; i++) {
      accounts.createInviteLink({ role: 'user', note: `n${i}`, createdBy: null, now: T0 });
    }
    expect(() =>
      accounts.createInviteLink({ role: 'user', note: 'one more', createdBy: null, now: T0 }),
    ).toThrow(TooManyInvites);
  });

  it('an invite accept rejects a taken name before hashing and keeps the token', async () => {
    const { users, tokens, accounts, gate } = setup();
    users.create({ username: 'olya', role: 'user', passwordHash: 'h', now: 0 });
    const { path } = accounts.createInviteLink({ role: 'user', note: '', createdBy: null, now: T0 });
    await expect(
      accounts.registerWithInvite({
        token: tokenOf(path),
        username: 'OLYA',
        password: 'long enough',
        now: T0,
      }),
    ).rejects.toBeInstanceOf(UsernameTaken);
    expect(gate.stats().started).toBe(0);
    expect(tokens.checkInvite(tokenOf(path), T0).ok).toBe(true);
  });
});

describe('dev bootstrap (applyDevUsers)', () => {
  const config = (devUsers: Config['devUsers']) => ({ devUsers });

  it('creates the dev user (legacy owner) and the dev admin; sets a password only when missing', async () => {
    const { db, users } = setup();
    const logger = createLogger('silent');
    await applyDevUsers(
      db,
      config([
        { username: 'anna', password: 'dev password', role: 'user' },
        { username: 'admin', password: 'dev admin password', role: 'admin' },
      ]),
      logger,
      cheap,
    );
    const anna = users.byKey('anna');
    const admin = users.byKey('admin');
    expect(anna).toMatchObject({ role: 'user', legacyOwner: true });
    expect(admin).toMatchObject({ role: 'admin', legacyOwner: false });
    expect(await verifyPassword('dev password', anna?.passwordHash ?? '')).toBe(true);

    // Second start with other passwords: existing passwords are kept.
    await applyDevUsers(db, config([{ username: 'anna', password: 'changed', role: 'user' }]), logger, cheap);
    expect(users.byKey('anna')?.passwordHash).toBe(anna?.passwordHash);
    expect(users.count()).toBe(2);

    // An account without a password gets the dev one.
    const pending = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 });
    await applyDevUsers(
      db,
      config([{ username: 'olya', password: 'olya dev pw', role: 'user' }]),
      logger,
      cheap,
    );
    expect(await verifyPassword('olya dev pw', users.byId(pending.id)?.passwordHash ?? '')).toBe(true);
    expect(users.byId(pending.id)?.legacyOwner).toBe(false);
  });

  it('nothing in production (config.devUsers is empty there)', async () => {
    const { db, users } = setup();
    await applyDevUsers(db, config([]), createLogger('silent'), cheap);
    expect(users.count()).toBe(0);
  });
});
