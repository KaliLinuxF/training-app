import {
  linkPath,
  MAX_PENDING_INVITES,
  usernameKey,
  usernameProblem,
  type LinkProblem,
  type UserRole,
  type UsernameProblem,
  type AdminInvite,
} from '@legko/shared';
import type { Database } from '../db/sqlite';
import type { TokenRepo } from '../db/tokens';
import { transaction } from '../db/tx';
import {
  authedUser,
  isUsableAdmin,
  UsernameTaken,
  type AuthedUser,
  type UserId,
  type UserRepo,
  type UserRow,
} from '../db/users';
import { silentLogger, type Logger } from '../logger';
import type { SubscriptionRepo } from '../push/subscriptions';
import {
  DEFAULT_SCRYPT,
  defaultScryptGate,
  hashPassword,
  passwordProblem,
  storePasswordHash,
  verifyPassword,
  createDummyHash,
  type ScryptGate,
  type ScryptParams,
} from './password';
import type { SessionStore } from './sessions';

/**
 * Account operations shared by the HTTP routes (auth / links / account / admin) and the CLI (docs/multi-user.md §3,
 * §7). Rules live here once: username / password policy, the last-usable-admin and self rules (D18), and the
 * session / link invalidation matrix (§3.3, D26, D27). Every mutating step runs in one `BEGIN IMMEDIATE`; scrypt is
 * computed before it (through the gate, D31). Failures are typed errors that the routes map to API codes.
 */

export { UsernameTaken } from '../db/users';

export class AccountError extends Error {
  override name = 'AccountError';
}
export class InvalidUsername extends AccountError {
  override name = 'InvalidUsername';
  constructor(readonly problem: UsernameProblem) {
    super(`Invalid username (${problem})`);
  }
}
export class WeakPassword extends AccountError {
  override name = 'WeakPassword';
  constructor(readonly problem: string) {
    super(problem);
  }
}
export class WrongPassword extends AccountError {
  override name = 'WrongPassword';
  constructor() {
    super('Wrong password');
  }
}
export class LinkInvalid extends AccountError {
  override name = 'LinkInvalid';
  constructor(readonly reason: LinkProblem) {
    super(`Link is ${reason}`);
  }
}
export class AccountDisabled extends AccountError {
  override name = 'AccountDisabled';
  constructor() {
    super('Account is disabled');
  }
}
export class UserNotFound extends AccountError {
  override name = 'UserNotFound';
  constructor() {
    super('No such user');
  }
}
export class LastAdmin extends AccountError {
  override name = 'LastAdmin';
  constructor() {
    super('This is the last usable admin');
  }
}
export class SelfAction extends AccountError {
  override name = 'SelfAction';
  constructor() {
    super('Not allowed on your own account');
  }
}
export class TooManyInvites extends AccountError {
  override name = 'TooManyInvites';
  constructor() {
    super(`At most ${MAX_PENDING_INVITES} pending invites`);
  }
}
export class ConfirmMismatch extends AccountError {
  override name = 'ConfirmMismatch';
  constructor() {
    super('The confirmation does not match the username');
  }
}
/** CLI `create-admin` on a name that is already an admin. */
export class AlreadyAdmin extends AccountError {
  override name = 'AlreadyAdmin';
  constructor(readonly username: string) {
    super(`User ${username} already exists (admin)`);
  }
}
/** CLI `create-admin` on a name that belongs to a regular user. */
export class ExistsAsUser extends AccountError {
  override name = 'ExistsAsUser';
  constructor(readonly username: string) {
    super(`User ${username} exists as a regular user`);
  }
}

/** Who performs an admin action: an admin's session, or the server CLI (`null`). */
export interface Actor {
  user: AuthedUser;
  /** The acting request's session (kept when an admin demotes themselves). */
  sessionHash: string;
}

export interface SignedIn {
  user: AuthedUser;
  /** The new session's token (the route sets the cookie). */
  sessionToken: string;
}

export interface CreatedLink {
  /** `/invite#<token>` or `/reset#<token>`: shown once, never logged. */
  path: string;
  expiresAt: number;
}

export interface AccountServiceDeps {
  db: Database;
  users: UserRepo;
  tokens: TokenRepo;
  sessions: SessionStore;
  subscriptions: Pick<SubscriptionRepo, 'removeAllFor'>;
  /** Removes photo files after a user delete commits. */
  removePhotoFiles?: (ids: readonly string[]) => void;
  logger?: Logger;
  scrypt?: ScryptParams;
  gate?: ScryptGate;
}

export interface AccountService {
  /** Verifies `password` for an existing user (through the gate; a user without a password never matches). */
  verify(user: Pick<UserRow, 'passwordHash'>, password: string): Promise<boolean>;

  registerWithInvite(input: {
    token: string;
    username: string;
    password: string;
    now: number;
  }): Promise<SignedIn>;
  completeReset(input: { token: string; password: string; now: number }): Promise<SignedIn>;

  /** D26: every session of the user dies (the current one too); returns the new session for this device. */
  changePassword(userId: UserId, currentPassword: string, newPassword: string, now: number): Promise<string>;
  /** Own rename (password required, `admin` reserved). Sessions are kept. */
  renameSelf(userId: UserId, username: string, password: string): Promise<AuthedUser>;
  /** CLI `rename-user` (`admin` allowed, `legko` never). */
  renameUser(userId: UserId, username: string): AuthedUser;

  /** UI invites are role user (D19); the CLI may pass `admin`. */
  createInviteLink(input: {
    role: UserRole;
    note: string;
    createdBy: UserId | null;
    now: number;
  }): CreatedLink & { invite: AdminInvite };
  /** `setup` when the user has no password yet; revokes their older pending links. */
  createResetLink(input: {
    userId: UserId;
    createdBy: UserId | null;
    now: number;
  }): CreatedLink & { purpose: 'reset' | 'setup'; user: UserRow };

  setRole(actor: Actor | null, userId: UserId, role: UserRole, now: number): void;
  setDisabled(actor: Actor | null, userId: UserId, disabled: boolean, now: number): void;
  /** Returns the removed photo ids (their files are already removed when `removePhotoFiles` is set). */
  deleteUser(actor: Actor | null, userId: UserId, confirmUsername: string, now: number): string[];

  /** CLI `set-password <user>`: like a completed reset (via `cli`). */
  cliSetPassword(username: string, password: string, now: number): Promise<UserRow>;
  /** CLI `create-admin <user>`: an admin without a password plus a setup link. */
  createAdmin(username: string, now: number): CreatedLink & { user: UserRow };
}

export function createAccountService({
  db,
  users,
  tokens,
  sessions,
  subscriptions,
  removePhotoFiles,
  logger = silentLogger,
  scrypt = DEFAULT_SCRYPT,
  gate = defaultScryptGate,
}: AccountServiceDeps): AccountService {
  const hash = (password: string): Promise<string> => hashPassword(password, scrypt, gate);

  const verify = (user: Pick<UserRow, 'passwordHash'>, password: string): Promise<boolean> =>
    user.passwordHash === null
      ? verifyPassword(password, createDummyHash(scrypt), gate).then(() => false)
      : verifyPassword(password, user.passwordHash, gate);

  const requireUser = (id: UserId): UserRow => {
    const user = users.byId(id);
    if (!user) throw new UserNotFound();
    return user;
  };

  const checkPassword = (password: string): void => {
    const problem = passwordProblem(password);
    if (problem) throw new WeakPassword(problem);
  };

  const checkName = (username: string, allowAdmin: boolean): string => {
    const problem = usernameProblem(username, { allowAdmin });
    if (problem) throw new InvalidUsername(problem);
    return username.trim();
  };

  /** The last-usable-admin rule (D18), inside the caller's `BEGIN IMMEDIATE`. */
  const guardLastAdmin = (target: UserRow): void => {
    if (isUsableAdmin(target) && users.usableAdminCount() <= 1) throw new LastAdmin();
  };

  const logRevoked = (count: number, by: UserId, why: string): void => {
    if (count > 0) logger.info(`links revoked: ${count} (created by user ${by}, ${why})`);
  };

  return {
    verify,

    async registerWithInvite({ token, username, password, now }) {
      const check = tokens.checkInvite(token, now);
      if (!check.ok) throw new LinkInvalid(check.reason);
      const name = checkName(username, false);
      checkPassword(password);
      // A taken name is refused BEFORE any hashing (D31): the token stays usable.
      if (users.byKey(usernameKey(name))) throw new UsernameTaken();
      const passwordHash = await hash(password);
      const result = transaction(db, () => {
        if (users.byKey(usernameKey(name))) throw new UsernameTaken();
        const user = users.create({ username: name, role: check.link.role, passwordHash, now });
        if (!tokens.consumeInvite(token, now, user.id)) {
          const again = tokens.checkInvite(token, now);
          throw new LinkInvalid(again.ok ? 'used' : again.reason);
        }
        const sessionToken = sessions.create(user.id, now);
        users.touch(user.id, now);
        return { user: authedUser({ ...user, lastSeenAt: now }), sessionToken };
      });
      logger.info(`user ${result.user.id} created via invite ${check.link.id} (${result.user.role})`);
      return result;
    },

    async completeReset({ token, password, now }) {
      const check = tokens.checkReset(token, now);
      if (!check.ok) throw new LinkInvalid(check.reason);
      const target = requireUser(check.link.userId);
      if (target.disabledAt !== null) throw new AccountDisabled();
      checkPassword(password);
      const passwordHash = await hash(password);
      const result = transaction(db, () => {
        const current = requireUser(check.link.userId);
        if (current.disabledAt !== null) throw new AccountDisabled();
        if (!tokens.consumeReset(token, now)) {
          const again = tokens.checkReset(token, now);
          throw new LinkInvalid(again.ok ? 'used' : again.reason);
        }
        const effects = storePasswordHash(db, current.id, passwordHash, now, {
          via: check.link.purpose,
          by: check.link.createdBy,
        });
        const sessionToken = sessions.create(current.id, now);
        users.touch(current.id, now);
        return { user: authedUser(requireUser(current.id)), sessionToken, effects };
      });
      logger.info(`${check.link.purpose} link ${check.link.id} used for user ${result.user.id}`);
      logRevoked(result.effects.linksRevoked, result.user.id, `password set via ${check.link.purpose}`);
      return { user: result.user, sessionToken: result.sessionToken };
    },

    async changePassword(userId, currentPassword, newPassword, now) {
      const user = requireUser(userId);
      checkPassword(newPassword);
      if (!(await verify(user, currentPassword))) throw new WrongPassword();
      const passwordHash = await hash(newPassword);
      const sessionToken = transaction(db, () => {
        requireUser(userId);
        storePasswordHash(db, userId, passwordHash, now, { via: 'self' });
        return sessions.create(userId, now);
      });
      logger.info(`user ${userId} changed their password (all sessions revoked)`);
      return sessionToken;
    },

    async renameSelf(userId, username, password) {
      const user = requireUser(userId);
      const name = username.trim();
      // Changing only the case of your own name is always allowed (even for «admin»).
      const sameKey = usernameKey(name) === user.usernameKey;
      if (!sameKey || usernameProblem(name, { allowAdmin: true }) !== null) checkName(name, false);
      if (!(await verify(user, password))) throw new WrongPassword();
      transaction(db, () => {
        const holder = users.byKey(usernameKey(name));
        if (holder && holder.id !== userId) throw new UsernameTaken();
        users.rename(userId, name);
      });
      logger.info(`user ${userId} renamed`);
      return authedUser(requireUser(userId));
    },

    renameUser(userId, username) {
      const name = checkName(username, true);
      transaction(db, () => {
        requireUser(userId);
        const holder = users.byKey(usernameKey(name));
        if (holder && holder.id !== userId) throw new UsernameTaken();
        users.rename(userId, name);
      });
      logger.info(`user ${userId} renamed (cli)`);
      return authedUser(requireUser(userId));
    },

    createInviteLink({ role, note, createdBy, now }) {
      const { token, invite } = transaction(db, () => {
        if (tokens.pendingInviteCount(now) >= MAX_PENDING_INVITES) throw new TooManyInvites();
        return tokens.createInvite({ role, note, createdBy, now });
      });
      const creator = createdBy ? (users.byId(createdBy)?.username ?? null) : null;
      return {
        path: linkPath('invite', token),
        expiresAt: invite.expiresAt,
        invite: {
          id: invite.id,
          note: invite.note,
          role: invite.role,
          createdAt: invite.createdAt,
          expiresAt: invite.expiresAt,
          createdBy: creator,
        },
      };
    },

    createResetLink({ userId, createdBy, now }) {
      const { token, reset, user } = transaction(db, () => {
        const target = requireUser(userId);
        if (target.disabledAt !== null) throw new AccountDisabled();
        const purpose = target.passwordHash === null ? 'setup' : 'reset';
        return { ...tokens.createReset({ userId, purpose, createdBy, now }), user: target };
      });
      return { path: linkPath('reset', token), expiresAt: reset.expiresAt, purpose: reset.purpose, user };
    },

    setRole(actor, userId, role, now) {
      const revoked = transaction(db, () => {
        const target = requireUser(userId);
        if (target.role === role) return 0;
        if (role === 'user') guardLastAdmin(target);
        users.setRole(userId, role);
        if (role === 'admin') return 0;
        // Demotion: the target's sessions (but not the acting request's own) and the links they made (D27).
        const self = actor?.user.id === userId;
        sessions.revokeAllFor(userId, self && actor ? { except: actor.sessionHash } : {});
        return tokens.revokeCreatedBy(userId, now);
      });
      logger.info(`user ${userId} role set to ${role} by ${actor ? `user ${actor.user.id}` : 'cli'}`);
      logRevoked(revoked, userId, 'demoted');
    },

    setDisabled(actor, userId, disabled, now) {
      const revoked = transaction(db, () => {
        const target = requireUser(userId);
        if (actor?.user.id === userId) throw new SelfAction();
        if (!disabled) {
          users.setDisabled(userId, null);
          return 0;
        }
        if (target.disabledAt !== null) return 0;
        guardLastAdmin(target);
        users.setDisabled(userId, now);
        sessions.revokeAllFor(userId);
        subscriptions.removeAllFor(userId);
        return tokens.revokeResetsFor(userId, now) + tokens.revokeCreatedBy(userId, now);
      });
      logger.info(
        `user ${userId} ${disabled ? 'disabled' : 'enabled'} by ${actor ? `user ${actor.user.id}` : 'cli'}`,
      );
      logRevoked(revoked, userId, 'disabled');
    },

    deleteUser(actor, userId, confirmUsername, now) {
      const { photos, revoked } = transaction(db, () => {
        const target = requireUser(userId);
        if (usernameKey(confirmUsername) !== target.usernameKey) throw new ConfirmMismatch();
        if (actor?.user.id === userId) throw new SelfAction();
        guardLastAdmin(target);
        // Before the delete, while `created_by` still names them (D27).
        const linksRevoked = tokens.revokeCreatedBy(userId, now);
        return { photos: users.delete(userId), revoked: linksRevoked };
      });
      removePhotoFiles?.(photos);
      logger.info(
        `user ${userId} deleted by ${actor ? `user ${actor.user.id}` : 'cli'} (${photos.length} photo(s))`,
      );
      logRevoked(revoked, userId, 'deleted');
      return photos;
    },

    async cliSetPassword(username, password, now) {
      const user = users.byKey(usernameKey(username));
      if (!user) throw new UserNotFound();
      checkPassword(password);
      const passwordHash = await hash(password);
      const effects = transaction(db, () => {
        requireUser(user.id);
        return storePasswordHash(db, user.id, passwordHash, now, { via: 'cli' });
      });
      logger.info(`user ${user.id} password set (cli; ${effects.sessionsRevoked} session(s) revoked)`);
      logRevoked(effects.linksRevoked, user.id, 'password set via cli');
      return requireUser(user.id);
    },

    createAdmin(username, now) {
      const name = checkName(username, true);
      const { token, reset, user } = transaction(db, () => {
        const existing = users.byKey(usernameKey(name));
        if (existing?.role === 'admin') throw new AlreadyAdmin(existing.username);
        if (existing) throw new ExistsAsUser(existing.username);
        const created = users.create({ username: name, role: 'admin', passwordHash: null, now });
        return {
          ...tokens.createReset({ userId: created.id, purpose: 'setup', createdBy: null, now }),
          user: created,
        };
      });
      logger.info(`admin user ${user.id} created (cli, setup link pending)`);
      return { path: linkPath('reset', token), expiresAt: reset.expiresAt, user };
    },
  };
}
