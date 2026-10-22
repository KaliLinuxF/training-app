import { describe, expect, it } from 'vitest';
import { openDatabase } from './open';
import { transaction } from './tx';
import { authedUser, createUserRepo, isUsableAdmin, UsernameTaken } from './users';

const setup = () => {
  const db = openDatabase(':memory:');
  return { db, users: createUserRepo(db) };
};

describe('users repo', () => {
  it('creates users with random 32-hex ids, the name as typed and a lower-case key', () => {
    const { users } = setup();
    const a = users.create({ username: '  Anna.K ', role: 'user', passwordHash: 'scrypt$h', now: 5 });
    const b = users.create({ username: 'olya', role: 'admin', passwordHash: null, now: 6 });
    expect(a.id).toMatch(/^[0-9a-f]{32}$/);
    expect(a.id).not.toBe(b.id);
    expect(a).toMatchObject({
      username: 'Anna.K',
      usernameKey: 'anna.k',
      passwordHash: 'scrypt$h',
      role: 'user',
      createdAt: 5,
      legacyOwner: false,
      disabledAt: null,
      lastSeenAt: null,
      aiDailyLimit: null,
    });
    expect(users.byId(a.id)?.username).toBe('Anna.K');
    expect(users.byKey('anna.k')?.id).toBe(a.id);
    expect(users.byKey('Anna.K')).toBeNull(); // keys are looked up already normalised
    expect(users.list().map((u) => u.username)).toEqual(['Anna.K', 'olya']);
    expect(users.count()).toBe(2);
  });

  it('usernames are unique case-insensitively (create and rename)', () => {
    const { users } = setup();
    const a = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 });
    expect(() => users.create({ username: 'ANNA', role: 'user', passwordHash: null, now: 0 })).toThrow(
      UsernameTaken,
    );
    const b = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 });
    expect(() => users.rename(b.id, 'Anna')).toThrow(UsernameTaken);
    users.rename(a.id, 'ANNA'); // own key, other case
    expect(users.byId(a.id)?.username).toBe('ANNA');
    users.rename(b.id, 'olya.k');
    expect(users.byKey('olya.k')?.id).toBe(b.id);
    expect(users.byKey('olya')).toBeNull();
  });

  it('byId returns null for unknown and malformed ids', () => {
    const { users } = setup();
    expect(users.byId('0'.repeat(32))).toBeNull();
    expect(users.byId("' OR 1=1 --")).toBeNull();
    expect(users.byId('')).toBeNull();
  });

  it('only one legacy owner can exist', () => {
    const { users } = setup();
    users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0, legacyOwner: true });
    expect(users.legacyOwner()?.username).toBe('anna');
    expect(() =>
      users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0, legacyOwner: true }),
    ).toThrow();
  });

  it('updates role, disabled, AI limit and last seen; enforces the AI limit bounds', () => {
    const { users } = setup();
    const u = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 });
    users.setRole(u.id, 'admin');
    users.setDisabled(u.id, 99);
    users.setAiLimit(u.id, 7);
    users.touch(u.id, 123);
    expect(users.byId(u.id)).toMatchObject({
      role: 'admin',
      disabledAt: 99,
      aiDailyLimit: 7,
      lastSeenAt: 123,
    });
    users.setDisabled(u.id, null);
    users.setAiLimit(u.id, null);
    expect(users.byId(u.id)).toMatchObject({ disabledAt: null, aiDailyLimit: null });
    expect(() => users.setAiLimit(u.id, 1001)).toThrow();
    expect(() => users.setAiLimit(u.id, -1)).toThrow();
  });

  it('records how the password was set, naming the link creator (D28)', () => {
    const { users } = setup();
    const admin = users.create({ username: 'admin', role: 'admin', passwordHash: 'h', now: 0 });
    const anna = users.create({ username: 'anna', role: 'user', passwordHash: 'h', now: 0 });
    expect(authedUser(anna).passwordChange).toBeNull();
    users.setPasswordHash(anna.id, 'h2', { now: 50, via: 'reset', by: admin.id });
    const row = users.byId(anna.id);
    expect(row?.passwordHash).toBe('h2');
    expect(authedUser(row ?? anna)).toEqual({
      id: anna.id,
      username: 'anna',
      role: 'user',
      createdAt: 0,
      legacyOwner: false,
      passwordChange: { at: 50, via: 'reset', by: 'admin' },
    });
    // A deleted creator leaves `by` null (ON DELETE SET NULL).
    users.delete(admin.id);
    expect(authedUser(users.byId(anna.id) ?? anna).passwordChange).toEqual({
      at: 50,
      via: 'reset',
      by: null,
    });
  });

  it('delete cascades and returns the photo ids', () => {
    const { db, users } = setup();
    const a = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 });
    const b = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 });
    const photo = db.prepare(
      'INSERT INTO photos (id, user_id, date, created_at, bytes, thumb_bytes) VALUES (?, ?, ?, 0, 1, 1)',
    );
    photo.run('AAAAAAAAAAAAAAAAAAAAAA', a.id, '2026-10-10');
    photo.run('BBBBBBBBBBBBBBBBBBBBBB', b.id, '2026-10-10');
    db.prepare('INSERT INTO weights (user_id, date, kg, updated_at) VALUES (?, ?, 60, 0)').run(
      a.id,
      '2026-10-10',
    );
    db.prepare('INSERT INTO weights (user_id, date, kg, updated_at) VALUES (?, ?, 60, 0)').run(
      b.id,
      '2026-10-10',
    );
    expect(transaction(db, () => users.delete(a.id))).toEqual(['AAAAAAAAAAAAAAAAAAAAAA']);
    expect(users.byId(a.id)).toBeNull();
    expect(
      db
        .prepare('SELECT id FROM photos')
        .all()
        .map((r) => r.id),
    ).toEqual(['BBBBBBBBBBBBBBBBBBBBBB']);
    expect(
      db
        .prepare('SELECT user_id FROM weights')
        .all()
        .map((r) => r.user_id),
    ).toEqual([b.id]);
  });

  it('counts usable admins: role admin, enabled, with a password', () => {
    const { users } = setup();
    expect(users.usableAdminCount()).toBe(0);
    const a = users.create({ username: 'admin', role: 'admin', passwordHash: 'h', now: 0 });
    users.create({ username: 'pending', role: 'admin', passwordHash: null, now: 0 });
    users.create({ username: 'anna', role: 'user', passwordHash: 'h', now: 0 });
    const d = users.create({ username: 'off', role: 'admin', passwordHash: 'h', now: 0 });
    users.setDisabled(d.id, 1);
    expect(users.usableAdminCount()).toBe(1);
    expect(isUsableAdmin(users.byId(a.id) ?? a)).toBe(true);
    expect(isUsableAdmin(users.byId(d.id) ?? d)).toBe(false);
  });
});
