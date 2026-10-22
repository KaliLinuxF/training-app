import { createHash, randomBytes } from 'node:crypto';
import {
  INVITE_TTL_MS,
  RESET_TTL_MS,
  type AdminInvite,
  type LinkProblem,
  type UserRole,
} from '@legko/shared';
import { silentLogger, type Logger } from '../logger';
import { num, numOrNull, text, textOrNull } from './rows';
import type { Database, Row } from './sqlite';
import { atomic } from './tx';
import type { UserId } from './users';

/**
 * One-time links (docs/multi-user.md §3.4): invites (`/invite#<token>`) and password reset / setup links
 * (`/reset#<token>`). A token is 32 random bytes in base64url; only its SHA-256 (hex) is stored and looked up through
 * a UNIQUE index. Nothing here ever logs or returns a token except `create*` (shown exactly once).
 */

/** SHA-256 hex of a session or link token. */
export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const newLinkToken = (): string => randomBytes(32).toString('base64url');
/** Public id of a link (list / revoke): 32 hex characters, never the token. */
export const newLinkId = (): string => randomBytes(16).toString('hex');

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

/** Used, revoked or expired links are deleted this long afterwards. */
export const LINK_PURGE_AFTER_MS = 30 * 86_400_000;

export type ResetPurpose = 'reset' | 'setup';

export interface InviteRecord {
  id: string;
  role: UserRole;
  note: string;
  /** Null = made in the CLI (or the creator was deleted). */
  createdBy: UserId | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  usedBy: UserId | null;
  revokedAt: number | null;
}

export interface ResetRecord {
  id: string;
  userId: UserId;
  purpose: ResetPurpose;
  createdBy: UserId | null;
  createdAt: number;
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
}

export type LinkCheck<T> = { ok: true; link: T } | { ok: false; reason: LinkProblem };

/** A pending link for the CLI `list-links` (no token, no hash). */
export interface PendingLink {
  id: string;
  kind: 'invite' | ResetPurpose;
  /** Invites only. */
  role: UserRole | null;
  /** Reset / setup links: whose password it sets. */
  forUsername: string | null;
  /** Creator's username; null = CLI (or a deleted creator). */
  createdBy: string | null;
  note: string;
  createdAt: number;
  expiresAt: number;
}

export interface TokenRepo {
  createInvite(input: {
    role: UserRole;
    note: string;
    createdBy: UserId | null;
    now: number;
    ttlMs?: number;
  }): { token: string; invite: InviteRecord };
  /** Non-consuming: the invite if it is still usable, else why not (unknown → revoked → used → expired). */
  checkInvite(token: string, now: number): LinkCheck<InviteRecord>;
  /** Marks it used (only while pending): true when this call consumed it. Call inside the transaction that uses it. */
  consumeInvite(token: string, now: number, usedBy: UserId): boolean;
  /** Revokes a pending invite; false when unknown or no longer pending. */
  revokeInvite(id: string, now: number): boolean;
  /** Pending invites for «Користувачі», newest first; `createdBy` is the creator's username. */
  pendingInvites(now: number): AdminInvite[];
  pendingInviteCount(now: number): number;
  /** Creates a reset / setup link and revokes the user's older pending ones (one live link per user). */
  createReset(input: {
    userId: UserId;
    purpose: ResetPurpose;
    createdBy: UserId | null;
    now: number;
    ttlMs?: number;
  }): { token: string; reset: ResetRecord };
  checkReset(token: string, now: number): LinkCheck<ResetRecord>;
  consumeReset(token: string, now: number): boolean;
  /** D27: revokes every pending invite and reset link `userId` created. Returns how many. */
  revokeCreatedBy(userId: UserId, now: number): number;
  /** Revokes the pending reset / setup links FOR `userId`. Returns how many. */
  revokeResetsFor(userId: UserId, now: number): number;
  /** Revokes every pending link (CLI `revoke-links --all`). Returns how many. */
  revokeAll(now: number): number;
  /** Pending links for the CLI, oldest first. */
  listPending(now: number): PendingLink[];
  /** Deletes links used, revoked or expired more than 30 days ago. Returns how many. */
  purge(now: number): number;
}

const ROLES: readonly string[] = ['admin', 'user'];

function inviteFromRow(row: Row): InviteRecord {
  const r = text(row, 'role');
  if (!ROLES.includes(r)) throw new TypeError('invites.role: unexpected value');
  return {
    id: text(row, 'id'),
    role: r as UserRole,
    note: text(row, 'note'),
    createdBy: textOrNull(row, 'created_by') as UserId | null,
    createdAt: num(row, 'created_at'),
    expiresAt: num(row, 'expires_at'),
    usedAt: numOrNull(row, 'used_at'),
    usedBy: textOrNull(row, 'used_by') as UserId | null,
    revokedAt: numOrNull(row, 'revoked_at'),
  };
}

function resetFromRow(row: Row): ResetRecord {
  const p = text(row, 'purpose');
  if (p !== 'reset' && p !== 'setup') throw new TypeError('password_resets.purpose: unexpected value');
  return {
    id: text(row, 'id'),
    userId: text(row, 'user_id') as UserId,
    purpose: p,
    createdBy: textOrNull(row, 'created_by') as UserId | null,
    createdAt: num(row, 'created_at'),
    expiresAt: num(row, 'expires_at'),
    usedAt: numOrNull(row, 'used_at'),
    revokedAt: numOrNull(row, 'revoked_at'),
  };
}

/** State of a stored link, in the documented order (revoked → used → expired). */
function problemOf(
  link: { revokedAt: number | null; usedAt: number | null; expiresAt: number },
  now: number,
) {
  if (link.revokedAt !== null) return 'revoked' as const;
  if (link.usedAt !== null) return 'used' as const;
  if (link.expiresAt <= now) return 'expired' as const;
  return null;
}

export function createTokenRepo(db: Database, logger: Logger = silentLogger): TokenRepo {
  const q = {
    insertInvite: db.prepare(
      `INSERT INTO invites (id, token_hash, role, note, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    inviteByHash: db.prepare(
      `SELECT id, role, note, created_by, created_at, expires_at, used_at, used_by, revoked_at
       FROM invites WHERE token_hash = ?`,
    ),
    consumeInvite: db.prepare(
      `UPDATE invites SET used_at = ?, used_by = ?
       WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ),
    revokeInvite: db.prepare(
      `UPDATE invites SET revoked_at = ?
       WHERE id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ),
    pendingInvites: db.prepare(
      `SELECT i.id, i.note, i.role, i.created_at, i.expires_at, c.username AS created_by_name
       FROM invites i LEFT JOIN users c ON c.id = i.created_by
       WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
       ORDER BY i.created_at DESC, i.id`,
    ),
    pendingInviteCount: db.prepare(
      `SELECT COUNT(*) AS n FROM invites WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ),
    insertReset: db.prepare(
      `INSERT INTO password_resets (id, token_hash, user_id, purpose, created_by, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ),
    resetByHash: db.prepare(
      `SELECT id, user_id, purpose, created_by, created_at, expires_at, used_at, revoked_at
       FROM password_resets WHERE token_hash = ?`,
    ),
    consumeReset: db.prepare(
      `UPDATE password_resets SET used_at = ?
       WHERE token_hash = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ),
    revokeResetsFor: db.prepare(
      `UPDATE password_resets SET revoked_at = ?
       WHERE user_id = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ),
    revokeInvitesBy: db.prepare(
      `UPDATE invites SET revoked_at = ?
       WHERE created_by = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ),
    revokeResetsBy: db.prepare(
      `UPDATE password_resets SET revoked_at = ?
       WHERE created_by = ? AND used_at IS NULL AND revoked_at IS NULL AND expires_at > ?`,
    ),
    revokeAllInvites: db.prepare(
      'UPDATE invites SET revoked_at = ? WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
    ),
    revokeAllResets: db.prepare(
      'UPDATE password_resets SET revoked_at = ? WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
    ),
    pendingResets: db.prepare(
      `SELECT r.id, r.purpose, r.created_at, r.expires_at, t.username AS for_name, c.username AS created_by_name
       FROM password_resets r JOIN users t ON t.id = r.user_id LEFT JOIN users c ON c.id = r.created_by
       WHERE r.used_at IS NULL AND r.revoked_at IS NULL AND r.expires_at > ?
       ORDER BY r.created_at, r.id`,
    ),
    pendingInvitesForCli: db.prepare(
      `SELECT i.id, i.role, i.note, i.created_at, i.expires_at, c.username AS created_by_name
       FROM invites i LEFT JOIN users c ON c.id = i.created_by
       WHERE i.used_at IS NULL AND i.revoked_at IS NULL AND i.expires_at > ?
       ORDER BY i.created_at, i.id`,
    ),
    purgeInvites: db.prepare(`DELETE FROM invites WHERE used_at < ? OR revoked_at < ? OR expires_at < ?`),
    purgeResets: db.prepare(
      `DELETE FROM password_resets WHERE used_at < ? OR revoked_at < ? OR expires_at < ?`,
    ),
  };

  const checkInvite = (token: string, now: number): LinkCheck<InviteRecord> => {
    if (!TOKEN_RE.test(token)) return { ok: false, reason: 'unknown' };
    const row = q.inviteByHash.get(hashToken(token));
    if (!row) return { ok: false, reason: 'unknown' };
    const invite = inviteFromRow(row);
    const problem = problemOf(invite, now);
    return problem ? { ok: false, reason: problem } : { ok: true, link: invite };
  };

  const checkReset = (token: string, now: number): LinkCheck<ResetRecord> => {
    if (!TOKEN_RE.test(token)) return { ok: false, reason: 'unknown' };
    const row = q.resetByHash.get(hashToken(token));
    if (!row) return { ok: false, reason: 'unknown' };
    const reset = resetFromRow(row);
    const problem = problemOf(reset, now);
    return problem ? { ok: false, reason: problem } : { ok: true, link: reset };
  };

  const changes = (result: { changes: number | bigint }): number => Number(result.changes);

  return {
    createInvite({ role, note, createdBy, now, ttlMs = INVITE_TTL_MS }) {
      const token = newLinkToken();
      const invite: InviteRecord = {
        id: newLinkId(),
        role,
        note,
        createdBy,
        createdAt: now,
        expiresAt: now + ttlMs,
        usedAt: null,
        usedBy: null,
        revokedAt: null,
      };
      q.insertInvite.run(invite.id, hashToken(token), role, note, createdBy, now, invite.expiresAt);
      logger.info(`invite ${invite.id} (${role}) created by ${createdBy ?? 'cli'}`);
      return { token, invite };
    },

    checkInvite,

    consumeInvite(token, now, usedBy) {
      if (!TOKEN_RE.test(token)) return false;
      return changes(q.consumeInvite.run(now, usedBy, hashToken(token), now)) === 1;
    },

    revokeInvite(id, now) {
      return changes(q.revokeInvite.run(now, id, now)) === 1;
    },

    pendingInvites(now) {
      return q.pendingInvites.all(now).map((row) => {
        const r = text(row, 'role');
        return {
          id: text(row, 'id'),
          note: text(row, 'note'),
          role: (r === 'admin' ? 'admin' : 'user') satisfies UserRole,
          createdAt: num(row, 'created_at'),
          expiresAt: num(row, 'expires_at'),
          createdBy: textOrNull(row, 'created_by_name'),
        };
      });
    },

    pendingInviteCount: (now) => num(q.pendingInviteCount.get(now) ?? { n: 0 }, 'n'),

    createReset({ userId, purpose, createdBy, now, ttlMs = RESET_TTL_MS }) {
      const token = newLinkToken();
      const reset: ResetRecord = {
        id: newLinkId(),
        userId,
        purpose,
        createdBy,
        createdAt: now,
        expiresAt: now + ttlMs,
        usedAt: null,
        revokedAt: null,
      };
      atomic(db, () => {
        q.revokeResetsFor.run(now, userId, now);
        q.insertReset.run(reset.id, hashToken(token), userId, purpose, createdBy, now, reset.expiresAt);
      });
      logger.info(`${purpose} link ${reset.id} for user ${userId} created by ${createdBy ?? 'cli'}`);
      return { token, reset };
    },

    checkReset,

    consumeReset(token, now) {
      if (!TOKEN_RE.test(token)) return false;
      return changes(q.consumeReset.run(now, hashToken(token), now)) === 1;
    },

    revokeCreatedBy(userId, now) {
      return atomic(
        db,
        () =>
          changes(q.revokeInvitesBy.run(now, userId, now)) + changes(q.revokeResetsBy.run(now, userId, now)),
      );
    },

    revokeResetsFor(userId, now) {
      return changes(q.revokeResetsFor.run(now, userId, now));
    },

    revokeAll(now) {
      return atomic(
        db,
        () => changes(q.revokeAllInvites.run(now, now)) + changes(q.revokeAllResets.run(now, now)),
      );
    },

    listPending(now) {
      const invites: PendingLink[] = q.pendingInvitesForCli.all(now).map((row) => {
        const r = text(row, 'role');
        return {
          id: text(row, 'id'),
          kind: 'invite',
          role: r === 'admin' ? 'admin' : 'user',
          forUsername: null,
          createdBy: textOrNull(row, 'created_by_name'),
          note: text(row, 'note'),
          createdAt: num(row, 'created_at'),
          expiresAt: num(row, 'expires_at'),
        };
      });
      const resets: PendingLink[] = q.pendingResets.all(now).map((row) => ({
        id: text(row, 'id'),
        kind: text(row, 'purpose') === 'setup' ? 'setup' : 'reset',
        role: null,
        forUsername: text(row, 'for_name'),
        createdBy: textOrNull(row, 'created_by_name'),
        note: '',
        createdAt: num(row, 'created_at'),
        expiresAt: num(row, 'expires_at'),
      }));
      return [...invites, ...resets].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    },

    purge(now) {
      const cutoff = now - LINK_PURGE_AFTER_MS;
      return atomic(
        db,
        () =>
          changes(q.purgeInvites.run(cutoff, cutoff, cutoff)) +
          changes(q.purgeResets.run(cutoff, cutoff, cutoff)),
      );
    },
  };
}
