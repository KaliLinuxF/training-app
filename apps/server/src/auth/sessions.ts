import { randomBytes } from 'node:crypto';
import { num } from '../db/rows';
import type { Database } from '../db/sqlite';
import { hashToken } from '../db/tokens';
import { atomic } from '../db/tx';
import { authedUser, USER_COLUMNS, userFromRow, type AuthedUser, type UserId } from '../db/users';

export { hashToken } from '../db/tokens';

const DAY_MS = 86_400_000;

/** Cookie and session lifetime: 400 days (the browser maximum), renewed while in use. */
export const SESSION_TTL_MS = 400 * DAY_MS;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
/** Sliding renewal happens at most once per day per session. */
export const SESSION_RENEW_AFTER_MS = DAY_MS;
/**
 * Live sessions one user keeps: creating another drops the least recently renewed ones (then the oldest), so nobody
 * can grow the table by signing in over and over. Far more than one person's phones and browsers.
 */
export const MAX_SESSIONS_PER_USER = 20;

export interface SessionStoreOptions {
  /** Default `MAX_SESSIONS_PER_USER`; null = no cap (development, where the e2e suite signs in hundreds of times). */
  maxPerUser?: number | null;
}

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export interface SessionCheck {
  /** True when the expiry was pushed forward and the cookie should be re-sent. */
  renewed: boolean;
  /**
   * The session was copied from v3 or made by a username-less login (the pre-v4 bundle, D11 / D24): it may sync
   * without `X-Legko-User` until a request presents the header.
   */
  legacy: boolean;
  /** SHA-256 of the token (`c.var.sessionHash`). */
  tokenHash: string;
  user: AuthedUser;
  /** `users.last_seen_at` as stored (the middleware refreshes it at most every 5 minutes). */
  lastSeenAt: number | null;
}

export interface SessionStore {
  /**
   * Creates a session for `userId` and returns its random token (only the SHA-256 is stored). In the same transaction
   * the user's sessions beyond the cap are deleted (never the new one).
   */
  create(userId: UserId, now: number, options?: { legacy?: boolean }): string;
  /** Null when the token is unknown or expired, or its user is disabled (those rows are deleted). */
  check(token: string, now: number): SessionCheck | null;
  /** The first request that presents `X-Legko-User` on a legacy session clears its flag. */
  clearLegacy(tokenHash: string): void;
  revoke(token: string): void;
  /** Revokes every session of `userId`, except the one whose hash is `except`. Returns how many. */
  revokeAllFor(userId: UserId, options?: { except?: string }): number;
  purgeExpired(now: number): number;
}

export function createSessionStore(
  db: Database,
  { maxPerUser = MAX_SESSIONS_PER_USER }: SessionStoreOptions = {},
): SessionStore {
  if (maxPerUser !== null && (!Number.isInteger(maxPerUser) || maxPerUser < 1)) {
    throw new Error(`maxPerUser must be a positive integer or null, got ${maxPerUser}`);
  }
  const q = {
    insert: db.prepare(
      `INSERT INTO sessions (token_hash, user_id, created_at, renewed_at, expires_at, legacy)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
    // Keeps the newest `maxPerUser - 1` others (most recently renewed first) next to the new one.
    trim: db.prepare(
      `DELETE FROM sessions WHERE user_id = ? AND token_hash IN (
         SELECT token_hash FROM sessions WHERE user_id = ? AND token_hash <> ?
         ORDER BY renewed_at DESC, created_at DESC, rowid DESC LIMIT -1 OFFSET ?)`,
    ),
    find: db.prepare(
      `SELECT s.renewed_at AS session_renewed_at, s.expires_at AS session_expires_at, s.legacy AS session_legacy,
         ${USER_COLUMNS}
       FROM sessions s JOIN users u ON u.id = s.user_id LEFT JOIN users c ON c.id = u.password_changed_by
       WHERE s.token_hash = ?`,
    ),
    renew: db.prepare('UPDATE sessions SET renewed_at = ?, expires_at = ? WHERE token_hash = ?'),
    clearLegacy: db.prepare('UPDATE sessions SET legacy = 0 WHERE token_hash = ? AND legacy = 1'),
    remove: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    removeAllFor: db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash <> ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  return {
    create(userId, now, { legacy = false } = {}) {
      const token = randomBytes(32).toString('base64url');
      const hash = hashToken(token);
      atomic(db, () => {
        q.insert.run(hash, userId, now, now, now + SESSION_TTL_MS, legacy ? 1 : 0);
        if (maxPerUser !== null) q.trim.run(userId, userId, hash, maxPerUser - 1);
      });
      return token;
    },

    check(token, now) {
      if (!TOKEN_RE.test(token)) return null;
      const hash = hashToken(token);
      const row = q.find.get(hash);
      if (!row) return null;
      const user = userFromRow(row);
      if (num(row, 'session_expires_at') <= now || user.disabledAt !== null) {
        q.remove.run(hash);
        return null;
      }
      const base = {
        legacy: num(row, 'session_legacy') === 1,
        tokenHash: hash,
        user: authedUser(user),
        lastSeenAt: user.lastSeenAt,
      };
      if (now - num(row, 'session_renewed_at') < SESSION_RENEW_AFTER_MS) return { ...base, renewed: false };
      q.renew.run(now, now + SESSION_TTL_MS, hash);
      return { ...base, renewed: true };
    },

    clearLegacy(tokenHash) {
      q.clearLegacy.run(tokenHash);
    },

    revoke(token) {
      if (TOKEN_RE.test(token)) q.remove.run(hashToken(token));
    },

    revokeAllFor(userId, { except = '' } = {}) {
      return Number(q.removeAllFor.run(userId, except).changes);
    },

    purgeExpired(now) {
      return Number(q.purge.run(now).changes);
    },
  };
}
