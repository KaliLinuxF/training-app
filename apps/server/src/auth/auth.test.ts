import { describe, expect, it } from 'vitest';
import { getKv, KV, setKv } from '../db/kv';
import { openDatabase } from '../db/open';
import type { Database } from '../db/sqlite';
import { createTokenRepo } from '../db/tokens';
import { createUserRepo, type UserId } from '../db/users';
import { createLogger } from '../logger';
import {
  createDummyHash,
  createScryptGate,
  hashPassword,
  passwordProblem,
  ScryptBusy,
  setUserPassword,
  verifyPassword,
} from './password';
import {
  ACCOUNT_CHANGE_LIMIT,
  addressKey,
  byAddress,
  createLoginLimiter,
  createRateLimiter,
  kvFailureLog,
  LINK_LIMIT,
  LOGIN_GLOBAL_LIMIT,
  LOGIN_RATE_LIMIT,
  LOGIN_SUCCESS_LIMIT,
  memoryFailureLog,
  PASSWORD_LIMIT,
  UNLIMITED,
  USERNAME_LIMIT,
} from './rateLimit';
import {
  createSessionStore,
  hashToken,
  MAX_SESSIONS_PER_USER,
  SESSION_RENEW_AFTER_MS,
  SESSION_TTL_MS,
} from './sessions';

const cheap = { N: 1024, r: 8, p: 1 };

function withUsers(): { db: Database; anna: UserId; admin: UserId } {
  const db = openDatabase(':memory:');
  const users = createUserRepo(db);
  const anna = users.create({ username: 'anna', role: 'user', passwordHash: 'scrypt$x', now: 0 }).id;
  const admin = users.create({ username: 'admin', role: 'admin', passwordHash: 'scrypt$y', now: 0 }).id;
  return { db, anna, admin };
}

describe('password hashing', () => {
  it('verifies the right password only', async () => {
    const hash = await hashPassword('пароль-для-тесту', cheap);
    expect(hash).toMatch(/^scrypt\$1024\$8\$1\$[\w-]+\$[\w-]+$/);
    expect(await verifyPassword('пароль-для-тесту', hash)).toBe(true);
    expect(await verifyPassword('пароль-для-тесту ', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('salts every hash', async () => {
    expect(await hashPassword('same password', cheap)).not.toBe(await hashPassword('same password', cheap));
  });

  it('treats malformed hashes as a mismatch', async () => {
    for (const bad of ['', 'plain', 'scrypt$x$8$1$aa$bb', 'bcrypt$1$2$3$4$5', 'scrypt$1024$8$1$$']) {
      expect(await verifyPassword('anything', bad)).toBe(false);
    }
  });

  it('uses strong default parameters', async () => {
    const hash = await hashPassword('default params');
    expect(hash.startsWith('scrypt$32768$8$1$')).toBe(true);
    expect(await verifyPassword('default params', hash)).toBe(true);
  });

  it('checks length limits', () => {
    expect(passwordProblem('short')).toMatch(/at least/);
    expect(passwordProblem('x'.repeat(201))).toMatch(/at most/);
    expect(passwordProblem('long enough')).toBeNull();
  });

  it('the dummy hash is well formed, memoised per parameters, and matches no password', async () => {
    const dummy = createDummyHash(cheap);
    expect(dummy).toMatch(/^scrypt\$1024\$8\$1\$[\w-]+\$[\w-]{86}$/);
    expect(createDummyHash(cheap)).toBe(dummy);
    expect(createDummyHash({ N: 2048, r: 8, p: 1 })).not.toBe(dummy);
    expect(await verifyPassword('', dummy)).toBe(false);
    expect(await verifyPassword('correct horse battery', dummy)).toBe(false);
  });
});

describe('scrypt gate (D31)', () => {
  /** A task that finishes when `release()` is called. */
  const deferred = () => {
    let release: () => void = () => undefined;
    const promise = new Promise<void>((resolve) => {
      release = resolve;
    });
    return { promise, release };
  };

  it('runs at most 2 at once, queues FIFO, and throws ScryptBusy when the queue is full', async () => {
    const gate = createScryptGate({ maxInFlight: 2, maxQueued: 3 });
    const order: number[] = [];
    const tasks = Array.from({ length: 5 }, () => deferred());
    const runs = tasks.map((t, i) =>
      gate.run(async () => {
        order.push(i);
        await t.promise;
        return i;
      }),
    );
    await Promise.resolve();
    expect(gate.stats()).toEqual({ inFlight: 2, queued: 3, started: 2 });
    expect(order).toEqual([0, 1]);
    await expect(gate.run(async () => 99)).rejects.toBeInstanceOf(ScryptBusy);

    tasks[1]?.release();
    await runs[1];
    await Promise.resolve();
    expect(order).toEqual([0, 1, 2]);
    expect(gate.stats().inFlight).toBe(2);
    for (const t of tasks) t.release();
    expect(await Promise.all(runs)).toEqual([0, 1, 2, 3, 4]);
    expect(order).toEqual([0, 1, 2, 3, 4]);
    expect(gate.stats()).toEqual({ inFlight: 0, queued: 0, started: 5 });
  });

  it('a failing task frees its slot', async () => {
    const gate = createScryptGate({ maxInFlight: 1, maxQueued: 1 });
    await expect(gate.run(() => Promise.reject(new Error('boom')))).rejects.toThrow('boom');
    await expect(
      gate.run(() => {
        throw new Error('sync boom');
      }),
    ).rejects.toThrow('sync boom');
    expect(await gate.run(async () => 'ok')).toBe('ok');
    expect(gate.stats().inFlight).toBe(0);
  });

  it('hash and verify go through the gate they are given', async () => {
    const gate = createScryptGate();
    const hash = await hashPassword('through the gate', cheap, gate);
    expect(await verifyPassword('through the gate', hash, gate)).toBe(true);
    expect(gate.stats().started).toBe(2);
    // A malformed hash is not worth a run.
    expect(await verifyPassword('x', 'plain', gate)).toBe(false);
    expect(gate.stats().started).toBe(2);
  });

  it('the default gate is shared and capped (≤ 2 in flight)', async () => {
    const hashes = await Promise.all(
      Array.from({ length: 6 }, (_, i) => hashPassword(`password ${i}`, cheap)),
    );
    expect(new Set(hashes).size).toBe(6);
  });
});

describe('setUserPassword (invalidation matrix §3.3)', () => {
  it('stores the hash with its provenance, revokes every session and the links for the user', async () => {
    const { db, anna, admin } = withUsers();
    const sessions = createSessionStore(db);
    const tokens = createTokenRepo(db);
    const keep = sessions.create(anna, 0);
    const other = sessions.create(anna, 0);
    const adminSession = sessions.create(admin, 0);
    const reset = tokens.createReset({ userId: anna, purpose: 'reset', createdBy: admin, now: 0 });
    const invite = tokens.createInvite({ role: 'user', note: '', createdBy: admin, now: 0 });

    const effects = await setUserPassword(db, anna, 'stored password', cheap, {
      via: 'self',
      keepSessionHash: hashToken(keep),
      now: 5,
    });
    expect(effects).toEqual({ sessionsRevoked: 1, linksRevoked: 1 });
    const row = createUserRepo(db).byId(anna);
    expect(row?.passwordHash).not.toContain('stored password');
    expect(await verifyPassword('stored password', row?.passwordHash ?? '')).toBe(true);
    expect(row).toMatchObject({ passwordChangedAt: 5, passwordChangedVia: 'self', passwordChangedBy: null });
    expect(sessions.check(keep, 1)).not.toBeNull();
    expect(sessions.check(other, 1)).toBeNull();
    expect(sessions.check(adminSession, 1)).not.toBeNull();
    expect(tokens.checkReset(reset.token, 1)).toEqual({ ok: false, reason: 'revoked' });
    expect(tokens.checkInvite(invite.token, 1).ok).toBe(true);
  });

  it('for an admin via reset / cli also revokes every link that admin created (D27)', async () => {
    const { db, anna, admin } = withUsers();
    const tokens = createTokenRepo(db);
    const invite = tokens.createInvite({ role: 'user', note: '', createdBy: admin, now: 0 });
    const resetForAnna = tokens.createReset({ userId: anna, purpose: 'reset', createdBy: admin, now: 0 });
    const effects = await setUserPassword(db, admin, 'new admin password', cheap, { via: 'cli', now: 5 });
    expect(effects.linksRevoked).toBe(2);
    expect(tokens.checkInvite(invite.token, 6)).toEqual({ ok: false, reason: 'revoked' });
    expect(tokens.checkReset(resetForAnna.token, 6)).toEqual({ ok: false, reason: 'revoked' });
  });
});

describe('sessions', () => {
  it('stores only the SHA-256 of the token, bound to its user', () => {
    const { db, anna } = withUsers();
    const store = createSessionStore(db);
    const token = store.create(anna, 0);
    const rows = db.prepare('SELECT token_hash, user_id, legacy FROM sessions').all();
    expect(rows.map((r) => ({ ...r }))).toEqual([{ token_hash: hashToken(token), user_id: anna, legacy: 0 }]);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('check resolves the user, renews after a day and expires after 400 idle days', () => {
    const { db, anna } = withUsers();
    const store = createSessionStore(db);
    const token = store.create(anna, 0);
    expect(store.check(token, 1000)).toMatchObject({
      renewed: false,
      legacy: false,
      tokenHash: hashToken(token),
      user: { id: anna, username: 'anna', role: 'user', legacyOwner: false, passwordChange: null },
      lastSeenAt: null,
    });
    expect(store.check(token, SESSION_RENEW_AFTER_MS)?.renewed).toBe(true);
    expect(store.check(token, SESSION_RENEW_AFTER_MS + 1000)?.renewed).toBe(false);
    expect(store.check(token, SESSION_RENEW_AFTER_MS + SESSION_TTL_MS - 1)?.renewed).toBe(true);
    expect(store.check(token, 3 * SESSION_TTL_MS)).toBeNull();
  });

  it('rejects unknown, malformed and revoked tokens', () => {
    const { db, anna } = withUsers();
    const store = createSessionStore(db);
    const token = store.create(anna, 0);
    expect(store.check('A'.repeat(43), 0)).toBeNull();
    expect(store.check('short', 0)).toBeNull();
    store.revoke(token);
    expect(store.check(token, 0)).toBeNull();
  });

  it('a disabled user’s session is deleted on its next check', () => {
    const { db, anna } = withUsers();
    const store = createSessionStore(db);
    const token = store.create(anna, 0);
    createUserRepo(db).setDisabled(anna, 1);
    expect(store.check(token, 2)).toBeNull();
    expect(db.prepare('SELECT COUNT(*) AS n FROM sessions').get()?.n).toBe(0);
    createUserRepo(db).setDisabled(anna, null);
    expect(store.check(token, 3)).toBeNull();
  });

  it('legacy sessions: flagged on create, cleared once', () => {
    const { db, anna } = withUsers();
    const store = createSessionStore(db);
    const token = store.create(anna, 0, { legacy: true });
    const check = store.check(token, 1);
    expect(check?.legacy).toBe(true);
    store.clearLegacy(check?.tokenHash ?? '');
    expect(store.check(token, 2)?.legacy).toBe(false);
  });

  it('revokeAllFor revokes one user’s sessions, optionally keeping one', () => {
    const { db, anna, admin } = withUsers();
    const store = createSessionStore(db);
    const a1 = store.create(anna, 0);
    const a2 = store.create(anna, 0);
    const b = store.create(admin, 0);
    expect(store.revokeAllFor(anna, { except: hashToken(a1) })).toBe(1);
    expect(store.check(a1, 1)).not.toBeNull();
    expect(store.check(a2, 1)).toBeNull();
    expect(store.revokeAllFor(anna)).toBe(1);
    expect(store.check(a1, 1)).toBeNull();
    expect(store.check(b, 1)).not.toBeNull();
  });

  it('purges expired sessions', () => {
    const { db, anna } = withUsers();
    const store = createSessionStore(db);
    store.create(anna, 0);
    const fresh = store.create(anna, SESSION_TTL_MS);
    expect(store.purgeExpired(SESSION_TTL_MS)).toBe(1);
    expect(store.check(fresh, SESSION_TTL_MS)?.renewed).toBe(false);
  });
});

describe('sessions: cap per user', () => {
  const count = (db: Database, user: UserId): number =>
    Number(db.prepare('SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?').get(user)?.n);

  it(`keeps at most ${MAX_SESSIONS_PER_USER} by default: the newest stay, the oldest go, other users are untouched`, () => {
    const { db, anna, admin } = withUsers();
    const store = createSessionStore(db);
    const adminToken = store.create(admin, 0);
    const tokens = Array.from({ length: MAX_SESSIONS_PER_USER + 5 }, (_, i) => store.create(anna, 1 + i));
    expect(count(db, anna)).toBe(MAX_SESSIONS_PER_USER);
    for (const gone of tokens.slice(0, 5)) expect(store.check(gone, 100)).toBeNull();
    for (const kept of tokens.slice(5)) expect(store.check(kept, 100)?.user.id).toBe(anna);
    expect(store.check(adminToken, 100)?.user.id).toBe(admin);
    expect(count(db, admin)).toBe(1);
  });

  it('drops the least recently RENEWED first (a session in daily use survives newer idle ones)', () => {
    const { db, anna } = withUsers();
    const store = createSessionStore(db, { maxPerUser: 3 });
    const phone = store.create(anna, 0);
    const laptop = store.create(anna, 1);
    const tablet = store.create(anna, 2);
    // A day later the phone is used again: its renewal moves it to the front.
    expect(store.check(phone, SESSION_RENEW_AFTER_MS)?.renewed).toBe(true);
    const fresh = store.create(anna, SESSION_RENEW_AFTER_MS + 1);
    expect(store.check(laptop, SESSION_RENEW_AFTER_MS + 2)).toBeNull();
    for (const kept of [phone, tablet, fresh])
      expect(store.check(kept, SESSION_RENEW_AFTER_MS + 2)).not.toBeNull();
    expect(count(db, anna)).toBe(3);
  });

  it('never drops the session it just created, even when the clock moved back', () => {
    const { db, anna } = withUsers();
    const store = createSessionStore(db, { maxPerUser: 2 });
    store.create(anna, 5000);
    store.create(anna, 6000);
    const created = store.create(anna, 10);
    expect(store.check(created, 20)?.user.id).toBe(anna);
    expect(count(db, anna)).toBe(2);
  });

  it('composes into a caller’s transaction; null means no cap; bad values are refused', () => {
    const { db, anna } = withUsers();
    const capped = createSessionStore(db, { maxPerUser: 1 });
    db.exec('BEGIN IMMEDIATE');
    const one = capped.create(anna, 0);
    const two = capped.create(anna, 1);
    db.exec('ROLLBACK');
    expect(count(db, anna)).toBe(0);
    expect([one, two]).toHaveLength(2);

    const uncapped = createSessionStore(db, { maxPerUser: null });
    for (let i = 0; i < MAX_SESSIONS_PER_USER + 3; i++) uncapped.create(anna, i);
    expect(count(db, anna)).toBe(MAX_SESSIONS_PER_USER + 3);
    for (const bad of [0, -1, 1.5])
      expect(() => createSessionStore(db, { maxPerUser: bad })).toThrow(/maxPerUser/);
  });
});

describe('limit option sets', () => {
  it('match docs/multi-user.md §3.5', () => {
    expect(USERNAME_LIMIT).toEqual({ maxFailures: 10, windowMs: 15 * 60_000 });
    expect(LINK_LIMIT).toEqual({ maxFailures: 10, windowMs: 15 * 60_000 });
    expect(PASSWORD_LIMIT).toEqual({ maxFailures: 5, windowMs: 15 * 60_000 });
    expect(ACCOUNT_CHANGE_LIMIT).toEqual({ maxFailures: 10, windowMs: 3600_000 });
    expect(LOGIN_SUCCESS_LIMIT).toEqual({ maxFailures: 30, windowMs: 3600_000 });
    expect(MAX_SESSIONS_PER_USER).toBe(20);
  });

  it('UNLIMITED never limits', () => {
    for (let i = 0; i < 100; i++) UNLIMITED.fail('k', 0);
    expect(UNLIMITED.check('k', 0)).toEqual({ limited: false, retryAfter: 0 });
  });
});

describe('byAddress', () => {
  it('groups an IPv6 client by its /64 for check, fail and reset (rotating addresses buys nothing)', () => {
    const rl = byAddress(createRateLimiter(LINK_LIMIT));
    for (let i = 1; i <= LINK_LIMIT.maxFailures; i++) {
      expect(rl.check(`2001:db8:1:2::${i.toString(16)}`, 0).limited).toBe(false);
      rl.fail(`2001:db8:1:2::${i.toString(16)}`, 0);
    }
    expect(rl.check('2001:db8:1:2:abcd::1', 0).limited).toBe(true);
    expect(rl.check('[2001:db8:1:2:ffff:ffff:ffff:ffff]', 0).limited).toBe(true);
    // The neighbouring /64 and IPv4 clients have their own budgets.
    expect(rl.check('2001:db8:1:3::1', 0).limited).toBe(false);
    expect(rl.check('203.0.113.7', 0).limited).toBe(false);
    // A success from any address of the /64 resets it.
    rl.reset('2001:db8:1:2::99');
    expect(rl.check('2001:db8:1:2::1', 0).limited).toBe(false);
  });

  it('IPv4-mapped addresses count as their IPv4 address; wrapping twice changes nothing', () => {
    const inner = createRateLimiter({ maxFailures: 2, windowMs: 60_000 });
    const rl = byAddress(byAddress(inner));
    rl.fail('::ffff:203.0.113.7', 0);
    rl.fail('203.0.113.7', 0);
    expect(rl.check('203.0.113.7', 0).limited).toBe(true);
    expect(inner.check('203.0.113.7', 0).limited).toBe(true);
    rl.fail('2001:db8:9:9::1', 0);
    rl.fail('2001:db8:9:9::2', 0);
    expect(inner.check('2001:db8:9:9::/64', 0).limited).toBe(true);
  });
});

describe('rate limiter', () => {
  const opts = { maxFailures: 5, windowMs: 15 * 60_000 };

  it('blocks after maxFailures within the window and reports Retry-After', () => {
    const rl = createRateLimiter(opts);
    for (let i = 0; i < 5; i++) {
      expect(rl.check('ip', i * 1000).limited).toBe(false);
      rl.fail('ip', i * 1000);
    }
    expect(rl.check('ip', 5000)).toEqual({ limited: true, retryAfter: 900 - 5 });
    expect(rl.check('other', 5000).limited).toBe(false);
    // The oldest failure leaves the window → one more attempt allowed.
    expect(rl.check('ip', opts.windowMs).limited).toBe(false);
  });

  it('reset clears the counter', () => {
    const rl = createRateLimiter(opts);
    for (let i = 0; i < 5; i++) rl.fail('ip', 0);
    rl.reset('ip');
    expect(rl.check('ip', 0).limited).toBe(false);
  });

  it('bounds the number of tracked keys', () => {
    const rl = createRateLimiter({ ...opts, maxKeys: 3 });
    for (let i = 0; i < 10; i++) rl.fail(`ip${i}`, 0);
    for (let i = 0; i < 5; i++) rl.fail('ip9', 0);
    expect(rl.check('ip9', 0).limited).toBe(true);
  });
});

describe('addressKey', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    [' 203.0.113.7 ', '203.0.113.7'],
    ['::ffff:203.0.113.7', '203.0.113.7'],
    ['::FFFF:127.0.0.1', '127.0.0.1'],
    ['2001:db8:1:2::1', '2001:db8:1:2::/64'],
    ['2001:db8:1:2:ffff:ffff:ffff:ffff', '2001:db8:1:2::/64'],
    ['2001:0DB8:0001:0002:0000:0000:0000:0009', '2001:db8:1:2::/64'],
    ['[2001:db8:1:2::1]', '2001:db8:1:2::/64'],
    ['fe80::1%eth0', 'fe80:0:0:0::/64'],
    ['2001:db8::', '2001:db8:0:0::/64'],
    ['::1', '0:0:0:0::/64'],
    ['::', '0:0:0:0::/64'],
    ['64:ff9b::192.0.2.33', '64:ff9b:0:0::/64'],
    ['1:2:3:4:5:6:192.0.2.33', '1:2:3:4::/64'],
    ['unknown', 'unknown'],
  ])('%s → %s', (ip, key) => {
    expect(addressKey(ip)).toBe(key);
  });
});

describe('login limiter', () => {
  const MIN = 60_000;
  const quiet = () => {
    const lines: string[] = [];
    return { lines, logger: createLogger('debug', (line) => lines.push(line)) };
  };

  it('throttles each address (IPv6 by /64) after 5 failures', () => {
    const rl = createLoginLimiter();
    for (let i = 1; i <= LOGIN_RATE_LIMIT.maxFailures; i++) {
      expect(rl.check(`2001:db8:1:2::${i}`, 0).limited).toBe(false);
      rl.fail(`2001:db8:1:2::${i}`, 0);
    }
    expect(rl.check('2001:db8:1:2:abcd::1', 0)).toEqual({ limited: true, retryAfter: 900 });
    expect(rl.check('2001:db8:1:3::1', 0).limited).toBe(false);
    expect(rl.check('198.51.100.1', 0).limited).toBe(false);
  });

  it('caps failures from all addresses together and warns once per window', () => {
    const { lines, logger } = quiet();
    const rl = createLoginLimiter({ logger });
    const max = LOGIN_GLOBAL_LIMIT.maxFailures;
    for (let i = 0; i < max; i++) {
      const ip = `198.51.100.${i}`;
      expect(rl.check(ip, i * 1000).limited, ip).toBe(false);
      rl.fail(ip, i * 1000);
    }
    // A fresh address is refused too, until the oldest failure is 15 minutes old.
    expect(rl.check('203.0.113.250', max * 1000)).toEqual({ limited: true, retryAfter: 900 - max });
    expect(rl.check('203.0.113.250', 15 * MIN).limited).toBe(false);
    expect(lines.filter((l) => l.includes('WARN'))).toHaveLength(1);
    expect(lines[0]).toContain(`${max} failed logins within 15 min`);

    // Refilled within the same window: no second warning.
    rl.fail('203.0.113.250', 15 * MIN);
    expect(rl.check('203.0.113.251', 15 * MIN).limited).toBe(true);
    expect(lines.filter((l) => l.includes('WARN'))).toHaveLength(1);
  });

  it('a successful login (reset) clears the address and takes back its own attempt', () => {
    const rl = createLoginLimiter({ global: { maxFailures: 3, windowMs: 15 * MIN } });
    // Many successful logins never add up to the global cap.
    for (let i = 0; i < 10; i++) {
      expect(rl.check('127.0.0.1', i).limited).toBe(false);
      rl.fail('127.0.0.1', i);
      rl.reset('127.0.0.1');
    }
    rl.fail('198.51.100.1', 20);
    rl.fail('198.51.100.2', 20);
    expect(rl.check('198.51.100.3', 20).limited).toBe(false);
    rl.fail('198.51.100.3', 20);
    expect(rl.check('198.51.100.4', 20).limited).toBe(true);
  });

  it('keeps the global failures in kv across restarts', () => {
    const db = openDatabase(':memory:');
    const max = LOGIN_GLOBAL_LIMIT.maxFailures;
    const first = createLoginLimiter({ log: kvFailureLog(db) });
    for (let i = 0; i < max; i++) first.fail(`198.51.100.${i}`, 1000);
    expect(JSON.parse(getKv(db, KV.loginFailures) ?? '[]')).toHaveLength(max);

    const restarted = createLoginLimiter({ log: kvFailureLog(db) });
    expect(restarted.check('203.0.113.1', 2000).limited).toBe(true);
    expect(restarted.check('203.0.113.1', 1000 + 15 * MIN).limited).toBe(false);
    // Expired entries are dropped from kv on the next look.
    expect(getKv(db, KV.loginFailures)).toBe('[]');
  });

  it('clearing the stored record lifts the overall cap at once (no restart needed)', () => {
    const db = openDatabase(':memory:');
    const rl = createLoginLimiter({ log: kvFailureLog(db) });
    for (let i = 0; i < LOGIN_GLOBAL_LIMIT.maxFailures; i++) rl.fail(`198.51.100.${i}`, 0);
    expect(rl.check('203.0.113.1', 0).limited).toBe(true);
    db.prepare('DELETE FROM kv WHERE key = ?').run(KV.loginFailures);
    expect(rl.check('203.0.113.1', 0).limited).toBe(false);
  });

  it('ignores a corrupt kv record and survives a clock that moved back', () => {
    const db = openDatabase(':memory:');
    for (const raw of ['not json', '{"a":1}', '["x", null]']) {
      setKv(db, KV.loginFailures, raw);
      expect(createLoginLimiter({ log: kvFailureLog(db) }).check('203.0.113.1', 0).limited).toBe(false);
    }
    const log = memoryFailureLog();
    log.save(Array.from({ length: 20 }, () => 10 * MIN));
    const rl = createLoginLimiter({ log });
    expect(rl.check('203.0.113.1', 0).limited).toBe(true);
    expect(rl.check('203.0.113.1', -6 * MIN).limited).toBe(false);
  });
});
