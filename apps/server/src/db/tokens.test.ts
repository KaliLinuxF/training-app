import { INVITE_TTL_MS, RESET_TTL_MS } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { openDatabase } from './open';
import type { Database } from './sqlite';
import { createTokenRepo, hashToken, LINK_PURGE_AFTER_MS } from './tokens';
import { transaction } from './tx';
import { createUserRepo } from './users';

const T0 = Date.UTC(2026, 9, 21, 9, 0);

const setup = () => {
  const db = openDatabase(':memory:');
  const users = createUserRepo(db);
  const admin = users.create({ username: 'admin', role: 'admin', passwordHash: 'h', now: 0 });
  const admin2 = users.create({ username: 'admin2', role: 'admin', passwordHash: 'h', now: 0 });
  const anna = users.create({ username: 'anna', role: 'user', passwordHash: 'h', now: 0 });
  return { db, users, tokens: createTokenRepo(db), admin: admin.id, admin2: admin2.id, anna: anna.id };
};

/** Every TEXT value stored anywhere in the database. */
function everyStoredText(db: Database): string[] {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  return tables.flatMap((t) =>
    db
      .prepare(`SELECT * FROM ${String(t.name)}`)
      .all()
      .flatMap((row) => Object.values(row).filter((v): v is string => typeof v === 'string')),
  );
}

describe('one-time links: invites', () => {
  it('stores only the SHA-256 of a 43-char base64url token; the token itself is nowhere at rest', () => {
    const { db, tokens, admin } = setup();
    const { token, invite } = tokens.createInvite({
      role: 'user',
      note: 'для Олі',
      createdBy: admin,
      now: T0,
    });
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(invite).toMatchObject({
      role: 'user',
      note: 'для Олі',
      createdBy: admin,
      expiresAt: T0 + INVITE_TTL_MS,
    });
    expect(invite.id).toMatch(/^[0-9a-f]{32}$/);
    const stored = everyStoredText(db);
    expect(stored).toContain(hashToken(token));
    expect(stored.some((v) => v.includes(token))).toBe(false);
  });

  it('checks without consuming, then reports unknown → revoked → used → expired', () => {
    const { tokens, admin, anna } = setup();
    const a = tokens.createInvite({ role: 'user', note: '', createdBy: admin, now: T0 });
    expect(tokens.checkInvite(a.token, T0 + 1)).toMatchObject({ ok: true, link: { id: a.invite.id } });
    expect(tokens.checkInvite(a.token, T0 + 1).ok).toBe(true);
    expect(tokens.checkInvite('x'.repeat(43), T0)).toEqual({ ok: false, reason: 'unknown' });
    expect(tokens.checkInvite('short', T0)).toEqual({ ok: false, reason: 'unknown' });
    expect(tokens.checkInvite(a.token, T0 + INVITE_TTL_MS)).toEqual({ ok: false, reason: 'expired' });

    expect(tokens.consumeInvite(a.token, T0 + 2, anna)).toBe(true);
    expect(tokens.checkInvite(a.token, T0 + 3)).toEqual({ ok: false, reason: 'used' });
    // Used beats expired.
    expect(tokens.checkInvite(a.token, T0 + INVITE_TTL_MS + 1)).toEqual({ ok: false, reason: 'used' });

    const b = tokens.createInvite({ role: 'user', note: '', createdBy: admin, now: T0 });
    expect(tokens.revokeInvite(b.invite.id, T0 + 1)).toBe(true);
    expect(tokens.revokeInvite(b.invite.id, T0 + 2)).toBe(false);
    // Revoked beats expired.
    expect(tokens.checkInvite(b.token, T0 + INVITE_TTL_MS + 1)).toEqual({ ok: false, reason: 'revoked' });
    expect(tokens.consumeInvite(b.token, T0 + 3, anna)).toBe(false);
  });

  it('a race of two consumes: exactly one wins', () => {
    const { db, tokens, admin, anna, admin2 } = setup();
    const { token } = tokens.createInvite({ role: 'user', note: '', createdBy: admin, now: T0 });
    const results = [
      transaction(db, () => tokens.consumeInvite(token, T0 + 1, anna)),
      transaction(db, () => tokens.consumeInvite(token, T0 + 1, admin2)),
    ];
    expect(results).toEqual([true, false]);
    expect(db.prepare('SELECT used_by FROM invites').get()?.used_by).toBe(anna);
  });

  it('an expired invite cannot be consumed or revoked', () => {
    const { tokens, admin, anna } = setup();
    const { token, invite } = tokens.createInvite({ role: 'user', note: '', createdBy: admin, now: T0 });
    expect(tokens.consumeInvite(token, T0 + INVITE_TTL_MS, anna)).toBe(false);
    expect(tokens.revokeInvite(invite.id, T0 + INVITE_TTL_MS)).toBe(false);
  });

  it('lists pending invites newest first with the creator’s username (null = CLI)', () => {
    const { tokens, admin } = setup();
    tokens.createInvite({ role: 'admin', note: '', createdBy: null, now: T0 });
    const second = tokens.createInvite({ role: 'user', note: 'для Олі', createdBy: admin, now: T0 + 1 });
    const used = tokens.createInvite({ role: 'user', note: 'used', createdBy: admin, now: T0 + 2 });
    tokens.consumeInvite(used.token, T0 + 3, admin);
    const pending = tokens.pendingInvites(T0 + 4);
    expect(pending.map((i) => [i.note, i.role, i.createdBy])).toEqual([
      ['для Олі', 'user', 'admin'],
      ['', 'admin', null],
    ]);
    expect(pending[0]).toEqual({
      id: second.invite.id,
      note: 'для Олі',
      role: 'user',
      createdAt: T0 + 1,
      expiresAt: T0 + 1 + INVITE_TTL_MS,
      createdBy: 'admin',
    });
    expect(tokens.pendingInviteCount(T0 + 4)).toBe(2);
  });
});

describe('one-time links: reset / setup', () => {
  it('one live link per user: a new one revokes the older pending ones', () => {
    const { tokens, admin, anna } = setup();
    const first = tokens.createReset({ userId: anna, purpose: 'reset', createdBy: admin, now: T0 });
    const second = tokens.createReset({ userId: anna, purpose: 'reset', createdBy: null, now: T0 + 1 });
    expect(tokens.checkReset(first.token, T0 + 2)).toEqual({ ok: false, reason: 'revoked' });
    expect(tokens.checkReset(second.token, T0 + 2)).toMatchObject({
      ok: true,
      link: { userId: anna, purpose: 'reset', createdBy: null, expiresAt: T0 + 1 + RESET_TTL_MS },
    });
    expect(tokens.consumeReset(second.token, T0 + 3)).toBe(true);
    expect(tokens.consumeReset(second.token, T0 + 3)).toBe(false);
    expect(tokens.checkReset(second.token, T0 + 4)).toEqual({ ok: false, reason: 'used' });
    expect(
      tokens.checkReset(
        second.token.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A')),
        T0,
      ),
    ).toEqual({
      ok: false,
      reason: 'unknown',
    });
  });

  it('expires after 24 hours', () => {
    const { tokens, anna } = setup();
    const { token } = tokens.createReset({ userId: anna, purpose: 'setup', createdBy: null, now: T0 });
    expect(tokens.checkReset(token, T0 + RESET_TTL_MS - 1).ok).toBe(true);
    expect(tokens.checkReset(token, T0 + RESET_TTL_MS)).toEqual({ ok: false, reason: 'expired' });
    expect(tokens.consumeReset(token, T0 + RESET_TTL_MS)).toBe(false);
  });

  it('nothing raw at rest', () => {
    const { db, tokens, anna } = setup();
    const { token } = tokens.createReset({ userId: anna, purpose: 'reset', createdBy: null, now: T0 });
    expect(everyStoredText(db).some((v) => v.includes(token))).toBe(false);
  });
});

describe('one-time links: revocation (D27) and housekeeping', () => {
  it('revokeCreatedBy revokes the invites and reset links an admin made, nobody else’s', () => {
    const { tokens, admin, admin2, anna } = setup();
    const byAdmin2Invite = tokens.createInvite({ role: 'user', note: '', createdBy: admin2, now: T0 });
    const byAdmin2Reset = tokens.createReset({ userId: anna, purpose: 'reset', createdBy: admin2, now: T0 });
    const byAdminInvite = tokens.createInvite({ role: 'user', note: '', createdBy: admin, now: T0 });
    const cliInvite = tokens.createInvite({ role: 'user', note: '', createdBy: null, now: T0 });
    expect(tokens.revokeCreatedBy(admin2, T0 + 1)).toBe(2);
    expect(tokens.checkInvite(byAdmin2Invite.token, T0 + 2)).toEqual({ ok: false, reason: 'revoked' });
    expect(tokens.checkReset(byAdmin2Reset.token, T0 + 2)).toEqual({ ok: false, reason: 'revoked' });
    expect(tokens.checkInvite(byAdminInvite.token, T0 + 2).ok).toBe(true);
    expect(tokens.checkInvite(cliInvite.token, T0 + 2).ok).toBe(true);
    expect(tokens.revokeCreatedBy(admin2, T0 + 3)).toBe(0);
  });

  it('revokeResetsFor revokes the links FOR a user only', () => {
    const { tokens, admin, anna } = setup();
    const forAnna = tokens.createReset({ userId: anna, purpose: 'reset', createdBy: admin, now: T0 });
    const forAdmin = tokens.createReset({ userId: admin, purpose: 'reset', createdBy: null, now: T0 });
    expect(tokens.revokeResetsFor(anna, T0 + 1)).toBe(1);
    expect(tokens.checkReset(forAnna.token, T0 + 2)).toEqual({ ok: false, reason: 'revoked' });
    expect(tokens.checkReset(forAdmin.token, T0 + 2).ok).toBe(true);
  });

  it('revokeAll and listPending (no token or hash in the listing)', () => {
    const { tokens, admin, anna } = setup();
    const inv = tokens.createInvite({ role: 'admin', note: 'n', createdBy: null, now: T0 });
    const rst = tokens.createReset({ userId: anna, purpose: 'setup', createdBy: admin, now: T0 + 1 });
    const list = tokens.listPending(T0 + 2);
    expect(list).toEqual([
      {
        id: inv.invite.id,
        kind: 'invite',
        role: 'admin',
        forUsername: null,
        createdBy: null,
        note: 'n',
        createdAt: T0,
        expiresAt: T0 + INVITE_TTL_MS,
      },
      {
        id: rst.reset.id,
        kind: 'setup',
        role: null,
        forUsername: 'anna',
        createdBy: 'admin',
        note: '',
        createdAt: T0 + 1,
        expiresAt: T0 + 1 + RESET_TTL_MS,
      },
    ]);
    const text = JSON.stringify(list);
    expect(text).not.toContain(inv.token);
    expect(text).not.toContain(hashToken(inv.token));
    expect(tokens.revokeAll(T0 + 3)).toBe(2);
    expect(tokens.listPending(T0 + 4)).toEqual([]);
  });

  it('purges links used, revoked or expired more than 30 days ago; keeps the rest', () => {
    const { db, tokens, admin, anna } = setup();
    const old = tokens.createInvite({ role: 'user', note: 'old', createdBy: admin, now: T0 });
    tokens.consumeInvite(old.token, T0 + 1, anna);
    const revoked = tokens.createInvite({ role: 'user', note: 'revoked', createdBy: admin, now: T0 });
    tokens.revokeInvite(revoked.invite.id, T0 + 1);
    tokens.createReset({ userId: anna, purpose: 'reset', createdBy: null, now: T0 }); // expires T0 + 24 h
    const later = T0 + 10 * 86_400_000;
    tokens.createInvite({ role: 'user', note: 'pending', createdBy: admin, now: later });
    expect(tokens.purge(T0 + 1 + LINK_PURGE_AFTER_MS - 1)).toBe(0);
    expect(tokens.purge(T0 + RESET_TTL_MS + LINK_PURGE_AFTER_MS + 1)).toBe(3);
    expect(
      db
        .prepare('SELECT note FROM invites')
        .all()
        .map((r) => r.note),
    ).toEqual(['pending']);
    expect(db.prepare('SELECT COUNT(*) AS n FROM password_resets').get()?.n).toBe(0);
  });

  it('a deleted creator leaves the link with created_by NULL; a deleted target takes its reset links', () => {
    const { db, users, tokens, admin2, anna } = setup();
    tokens.createInvite({ role: 'user', note: '', createdBy: admin2, now: T0 });
    tokens.createReset({ userId: anna, purpose: 'reset', createdBy: null, now: T0 });
    transaction(db, () => {
      users.delete(admin2);
      users.delete(anna);
    });
    expect(db.prepare('SELECT created_by FROM invites').get()?.created_by).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM password_resets').get()?.n).toBe(0);
  });
});
