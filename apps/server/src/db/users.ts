import { randomBytes } from 'node:crypto';
import {
  usernameKey,
  type PasswordChange,
  type PasswordChangeVia,
  type SessionUser,
  type UserRole,
} from '@legko/shared';
import { num, numOrNull, text, textOrNull } from './rows';
import type { Database, Row } from './sqlite';

/**
 * A user id that came from the database (`users.byId` / `byKey` / `create`) or from the session (`requireAuth`).
 * Per-user repositories only accept this type (`forUser(id: UserId)`), so a raw request value cannot reach them
 * without being looked up first (docs/multi-user.md §4).
 */
export type UserId = string & { readonly __brand: 'UserId' };

const USER_ID_RE = /^[0-9a-f]{32}$/;

/** A row of `users`, plus the username of whoever made the link that last set the password (D28). */
export interface UserRow {
  id: UserId;
  /** As typed. */
  username: string;
  /** `usernameKey(username)`: the unique, case-insensitive lookup key. */
  usernameKey: string;
  /** Null = no usable password yet (create-admin, until the setup link is used). */
  passwordHash: string | null;
  role: UserRole;
  createdAt: number;
  passwordChangedAt: number | null;
  passwordChangedVia: PasswordChangeVia | null;
  passwordChangedBy: UserId | null;
  /** The creator's username (LEFT JOIN); null for self / CLI / a deleted creator. */
  passwordChangedByName: string | null;
  lastSeenAt: number | null;
  disabledAt: number | null;
  /** Null = the default per-user AI limit. */
  aiDailyLimit: number | null;
  legacyOwner: boolean;
}

/** The signed-in account as routes see it (`c.var.user`); the same shape as the API's `SessionUser`. */
export interface AuthedUser extends SessionUser {
  id: UserId;
}

export class UsernameTaken extends Error {
  override name = 'UsernameTaken';
  constructor() {
    super('Username is taken');
  }
}

const ROLES: readonly string[] = ['admin', 'user'];
const VIAS: readonly string[] = ['self', 'reset', 'setup', 'cli'];

function role(row: Row, column: string): UserRole {
  const v = text(row, column);
  if (!ROLES.includes(v)) throw new TypeError(`Column ${column}: unexpected role`);
  return v as UserRole;
}

function via(row: Row, column: string): PasswordChangeVia | null {
  const v = textOrNull(row, column);
  if (v === null) return null;
  if (!VIAS.includes(v)) throw new TypeError(`Column ${column}: unexpected value`);
  return v as PasswordChangeVia;
}

/**
 * Columns every user query selects, `u` = the user, `c` = the creator of their last password link. Used with
 * `FROM users u LEFT JOIN users c ON c.id = u.password_changed_by`.
 */
export const USER_COLUMNS = `u.id, u.username, u.username_key, u.password_hash, u.role, u.created_at,
  u.password_changed_at, u.password_changed_via, u.password_changed_by, c.username AS changed_by_name,
  u.last_seen_at, u.disabled_at, u.ai_daily_limit, u.legacy_owner`;

/** Reads a row selected with `USER_COLUMNS` (column names as aliased there). */
export function userFromRow(row: Row): UserRow {
  return {
    id: text(row, 'id') as UserId,
    username: text(row, 'username'),
    usernameKey: text(row, 'username_key'),
    passwordHash: textOrNull(row, 'password_hash'),
    role: role(row, 'role'),
    createdAt: num(row, 'created_at'),
    passwordChangedAt: numOrNull(row, 'password_changed_at'),
    passwordChangedVia: via(row, 'password_changed_via'),
    passwordChangedBy: textOrNull(row, 'password_changed_by') as UserId | null,
    passwordChangedByName: textOrNull(row, 'changed_by_name'),
    lastSeenAt: numOrNull(row, 'last_seen_at'),
    disabledAt: numOrNull(row, 'disabled_at'),
    aiDailyLimit: numOrNull(row, 'ai_daily_limit'),
    legacyOwner: num(row, 'legacy_owner') === 1,
  };
}

/** The `SessionUser` view of a row (never the hash or any admin-only field). */
export function authedUser(row: UserRow): AuthedUser {
  const passwordChange: PasswordChange | null =
    row.passwordChangedAt !== null && row.passwordChangedVia !== null
      ? { at: row.passwordChangedAt, via: row.passwordChangedVia, by: row.passwordChangedByName }
      : null;
  return {
    id: row.id,
    username: row.username,
    role: row.role,
    createdAt: row.createdAt,
    legacyOwner: row.legacyOwner,
    passwordChange,
  };
}

/** Role admin, not disabled, has a password: what «the last admin» counts (D18). */
export const isUsableAdmin = (u: Pick<UserRow, 'role' | 'disabledAt' | 'passwordHash'>): boolean =>
  u.role === 'admin' && u.disabledAt === null && u.passwordHash !== null;

export const newUserId = (): UserId => randomBytes(16).toString('hex') as UserId;

export interface NewUser {
  /** Already validated by the caller (`usernameProblem`); trimmed here. */
  username: string;
  role: UserRole;
  passwordHash: string | null;
  now: number;
  /** Only the dev bootstrap sets this (the migration owns the legacy owner otherwise). */
  legacyOwner?: boolean;
}

export interface PasswordStamp {
  now: number;
  via: PasswordChangeVia;
  /** The link creator; null for self / CLI. */
  by: UserId | null;
}

export interface UserRepo {
  /** Null for an unknown or malformed id. */
  byId(raw: string): UserRow | null;
  /** Exact `username_key` lookup (no `legko` alias: the login route resolves it). */
  byKey(key: string): UserRow | null;
  legacyOwner(): UserRow | null;
  /** Everybody, oldest first. */
  list(): UserRow[];
  count(): number;
  /** Throws `UsernameTaken`. */
  create(input: NewUser): UserRow;
  setPasswordHash(id: UserId, hash: string, stamp: PasswordStamp): void;
  /** Throws `UsernameTaken`. */
  rename(id: UserId, username: string): void;
  setRole(id: UserId, role: UserRole): void;
  setDisabled(id: UserId, at: number | null): void;
  setAiLimit(id: UserId, limit: number | null): void;
  /** `last_seen_at = now`. */
  touch(id: UserId, now: number): void;
  /**
   * Deletes the user; every per-user row goes with it (ON DELETE CASCADE). Returns the ids of the photos that
   * were theirs: the caller removes the files after the transaction commits. Call inside a transaction.
   */
  delete(id: UserId): string[];
  usableAdminCount(): number;
}

const isUniqueKeyViolation = (err: unknown): boolean =>
  err instanceof Error && err.message.includes('users.username_key');

export function createUserRepo(db: Database): UserRepo {
  const q = {
    byId: db.prepare(
      `SELECT ${USER_COLUMNS} FROM users u LEFT JOIN users c ON c.id = u.password_changed_by WHERE u.id = ?`,
    ),
    byKey: db.prepare(
      `SELECT ${USER_COLUMNS} FROM users u LEFT JOIN users c ON c.id = u.password_changed_by
       WHERE u.username_key = ?`,
    ),
    legacyOwner: db.prepare(
      `SELECT ${USER_COLUMNS} FROM users u LEFT JOIN users c ON c.id = u.password_changed_by
       WHERE u.legacy_owner = 1`,
    ),
    list: db.prepare(
      `SELECT ${USER_COLUMNS} FROM users u LEFT JOIN users c ON c.id = u.password_changed_by
       ORDER BY u.created_at, u.username_key`,
    ),
    count: db.prepare('SELECT COUNT(*) AS n FROM users'),
    insert: db.prepare(
      `INSERT INTO users (id, username, username_key, password_hash, role, created_at, legacy_owner)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    setHash: db.prepare(
      `UPDATE users SET password_hash = ?, password_changed_at = ?, password_changed_via = ?,
         password_changed_by = ? WHERE id = ?`,
    ),
    rename: db.prepare('UPDATE users SET username = ?, username_key = ? WHERE id = ?'),
    setRole: db.prepare('UPDATE users SET role = ? WHERE id = ?'),
    setDisabled: db.prepare('UPDATE users SET disabled_at = ? WHERE id = ?'),
    setAiLimit: db.prepare('UPDATE users SET ai_daily_limit = ? WHERE id = ?'),
    touch: db.prepare('UPDATE users SET last_seen_at = ? WHERE id = ?'),
    photosOf: db.prepare('SELECT id FROM photos WHERE user_id = ? ORDER BY id'),
    delete: db.prepare('DELETE FROM users WHERE id = ?'),
    usableAdmins: db.prepare(
      `SELECT COUNT(*) AS n FROM users
       WHERE role = 'admin' AND disabled_at IS NULL AND password_hash IS NOT NULL`,
    ),
  };

  const one = (row: Row | undefined): UserRow | null => (row ? userFromRow(row) : null);

  return {
    byId: (raw) => (USER_ID_RE.test(raw) ? one(q.byId.get(raw)) : null),
    byKey: (key) => one(q.byKey.get(key)),
    legacyOwner: () => one(q.legacyOwner.get()),
    list: () => q.list.all().map(userFromRow),
    count: () => num(q.count.get() ?? { n: 0 }, 'n'),

    create({ username, role: newRole, passwordHash, now, legacyOwner = false }) {
      const name = username.trim();
      const id = newUserId();
      try {
        q.insert.run(id, name, usernameKey(name), passwordHash, newRole, now, legacyOwner ? 1 : 0);
      } catch (err) {
        if (isUniqueKeyViolation(err)) throw new UsernameTaken();
        throw err;
      }
      const row = one(q.byId.get(id));
      if (!row) throw new Error('user insert failed');
      return row;
    },

    setPasswordHash(id, hash, { now, via: how, by }) {
      q.setHash.run(hash, now, how, by, id);
    },

    rename(id, username) {
      const name = username.trim();
      try {
        q.rename.run(name, usernameKey(name), id);
      } catch (err) {
        if (isUniqueKeyViolation(err)) throw new UsernameTaken();
        throw err;
      }
    },

    setRole(id, next) {
      q.setRole.run(next, id);
    },
    setDisabled(id, at) {
      q.setDisabled.run(at, id);
    },
    setAiLimit(id, limit) {
      q.setAiLimit.run(limit, id);
    },
    touch(id, now) {
      q.touch.run(now, id);
    },

    delete(id) {
      const photos = q.photosOf.all(id).map((row) => text(row, 'id'));
      q.delete.run(id);
      return photos;
    },

    usableAdminCount: () => num(q.usableAdmins.get() ?? { n: 0 }, 'n'),
  };
}
