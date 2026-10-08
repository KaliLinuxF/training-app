import { createHash, randomBytes } from 'node:crypto';
import { num } from '../db/rows';
import type { Database } from '../db/sqlite';

const DAY_MS = 86_400_000;

/** Cookie and session lifetime: 400 days (the browser maximum), renewed while in use. */
export const SESSION_TTL_MS = 400 * DAY_MS;
export const SESSION_TTL_SECONDS = SESSION_TTL_MS / 1000;
/** Sliding renewal happens at most once per day per session. */
export const SESSION_RENEW_AFTER_MS = DAY_MS;

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export interface SessionCheck {
  /** True when the expiry was pushed forward and the cookie should be re-sent. */
  renewed: boolean;
}

export interface SessionStore {
  /** Creates a session and returns its random token (only the SHA-256 is stored). */
  create(now: number): string;
  /** Null when the token is unknown or expired. */
  check(token: string, now: number): SessionCheck | null;
  revoke(token: string): void;
  purgeExpired(now: number): number;
}

export function revokeAllSessions(db: Database): void {
  db.exec('DELETE FROM sessions');
}

export function createSessionStore(db: Database): SessionStore {
  const q = {
    insert: db.prepare(
      'INSERT INTO sessions (token_hash, created_at, renewed_at, expires_at) VALUES (?, ?, ?, ?)',
    ),
    find: db.prepare('SELECT renewed_at, expires_at FROM sessions WHERE token_hash = ?'),
    renew: db.prepare('UPDATE sessions SET renewed_at = ?, expires_at = ? WHERE token_hash = ?'),
    remove: db.prepare('DELETE FROM sessions WHERE token_hash = ?'),
    purge: db.prepare('DELETE FROM sessions WHERE expires_at <= ?'),
  };

  return {
    create(now) {
      const token = randomBytes(32).toString('base64url');
      q.insert.run(hashToken(token), now, now, now + SESSION_TTL_MS);
      return token;
    },

    check(token, now) {
      if (!TOKEN_RE.test(token)) return null;
      const hash = hashToken(token);
      const row = q.find.get(hash);
      if (!row) return null;
      if (num(row, 'expires_at') <= now) {
        q.remove.run(hash);
        return null;
      }
      if (now - num(row, 'renewed_at') < SESSION_RENEW_AFTER_MS) return { renewed: false };
      q.renew.run(now, now + SESSION_TTL_MS, hash);
      return { renewed: true };
    },

    revoke(token) {
      if (TOKEN_RE.test(token)) q.remove.run(hashToken(token));
    },

    purgeExpired(now) {
      return Number(q.purge.run(now).changes);
    },
  };
}
