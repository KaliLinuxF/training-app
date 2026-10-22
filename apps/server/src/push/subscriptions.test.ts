import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open';
import { createUserRepo } from '../db/users';
import { createSubscriptionRepo } from './subscriptions';

const setup = () => {
  const db = openDatabase(':memory:');
  const users = createUserRepo(db);
  const anna = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 }).id;
  const olya = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
  const repo = createSubscriptionRepo(db);
  return { db, users, anna, olya, repo, A: repo.forUser(anna), B: repo.forUser(olya) };
};

const sub = (endpoint: string, auth = 'auth-a', p256dh = 'p') => ({
  endpoint: `https://push.example/${endpoint}`,
  p256dh,
  auth,
});

const row = (db: ReturnType<typeof setup>['db'], endpoint: string) =>
  db
    .prepare(
      'SELECT user_id, p256dh, auth, user_agent, created_at, last_ok_at FROM push_subscriptions WHERE endpoint = ?',
    )
    .get(`https://push.example/${endpoint}`);

describe('push subscriptions per user (D15)', () => {
  it('stores and lists each user’s own devices', () => {
    const { A, B } = setup();
    expect(A.upsert(sub('a1'), 'iPhone', 1)).toBe('ok');
    expect(A.upsert(sub('a2'), null, 2)).toBe('ok');
    expect(B.upsert(sub('b1', 'auth-b'), null, 3)).toBe('ok');
    expect(A.all().map((s) => s.endpoint)).toEqual(['https://push.example/a1', 'https://push.example/a2']);
    expect(B.all()).toEqual([{ endpoint: 'https://push.example/b1', p256dh: 'p', auth: 'auth-b' }]);
  });

  it('a re-subscribe by the owner updates keys and keeps created_at / last_ok_at', () => {
    const { db, A } = setup();
    A.upsert(sub('a1'), 'old UA', 1);
    A.markOk('https://push.example/a1', 5);
    expect(A.upsert(sub('a1', 'auth-new', 'p-new'), 'new UA', 9)).toBe('ok');
    expect({ ...row(db, 'a1') }).toMatchObject({
      p256dh: 'p-new',
      auth: 'auth-new',
      user_agent: 'new UA',
      created_at: 1,
      last_ok_at: 5,
    });
  });

  it('moves an endpoint to another user only with the same auth key (same browser subscription)', () => {
    const { db, anna, olya, A, B } = setup();
    A.upsert(sub('shared', 'secret'), null, 1);
    A.markOk('https://push.example/shared', 2);
    // Endpoint alone: refused, the row is untouched.
    expect(B.upsert(sub('shared', 'guess'), 'evil', 5)).toBe('conflict');
    expect({ ...row(db, 'shared') }).toMatchObject({
      user_id: anna,
      auth: 'secret',
      created_at: 1,
      last_ok_at: 2,
    });
    // The same browser (same auth) after a switch: moved, with a fresh created_at / last_ok_at.
    expect(B.upsert(sub('shared', 'secret'), 'UA', 6)).toBe('ok');
    expect({ ...row(db, 'shared') }).toMatchObject({
      user_id: olya,
      created_at: 6,
      last_ok_at: null,
      user_agent: 'UA',
    });
    expect(A.all()).toEqual([]);
    expect(B.all().map((s) => s.endpoint)).toEqual(['https://push.example/shared']);
  });

  it('remove: own row always; another user’s row only with the matching auth', () => {
    const { A, B } = setup();
    A.upsert(sub('a1', 'secret-a'), null, 1);
    expect(B.remove('https://push.example/a1')).toBe(false);
    expect(B.remove('https://push.example/a1', 'wrong')).toBe(false);
    expect(A.all()).toHaveLength(1);
    expect(B.remove('https://push.example/a1', 'secret-a')).toBe(true);
    expect(A.all()).toEqual([]);

    A.upsert(sub('a2'), null, 1);
    expect(A.remove('https://push.example/a2')).toBe(true);
    expect(A.remove('https://push.example/a2')).toBe(false);
  });

  it('markOk and removeGone are scoped to the user', () => {
    const { db, A, B } = setup();
    A.upsert(sub('a1'), null, 1);
    B.markOk('https://push.example/a1', 99);
    expect(row(db, 'a1')?.last_ok_at).toBeNull();
    expect(B.removeGone('https://push.example/a1')).toBe(false);
    expect(A.all()).toHaveLength(1);
    A.markOk('https://push.example/a1', 7);
    expect(row(db, 'a1')?.last_ok_at).toBe(7);
    expect(A.removeGone('https://push.example/a1')).toBe(true);
  });

  it('recipients are users with devices who are not disabled; removeAllFor clears one user', () => {
    const { users, anna, olya, repo, A, B } = setup();
    expect(repo.recipients()).toEqual([]);
    A.upsert(sub('a1'), null, 1);
    A.upsert(sub('a2'), null, 1);
    B.upsert(sub('b1', 'b'), null, 1);
    expect(repo.recipients().sort()).toEqual([anna, olya].sort());
    users.setDisabled(olya, 5);
    expect(repo.recipients()).toEqual([anna]);
    expect(repo.removeAllFor(anna)).toBe(2);
    expect(A.all()).toEqual([]);
    expect(B.all()).toHaveLength(1);
  });
});
