import { describe, expect, it } from 'vitest';
import { getKv, KV, setKv } from '../db/kv';
import { openDatabase } from '../db/open';
import { createLogger } from '../logger';
import { getPasswordHash, hashPassword, passwordProblem, setPassword, verifyPassword } from './password';
import {
  addressKey,
  createLoginLimiter,
  createRateLimiter,
  kvFailureLog,
  LOGIN_GLOBAL_LIMIT,
  LOGIN_RATE_LIMIT,
  memoryFailureLog,
} from './rateLimit';
import { createSessionStore, hashToken, SESSION_RENEW_AFTER_MS, SESSION_TTL_MS } from './sessions';

const cheap = { N: 1024, r: 8, p: 1 };

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

  it('stores the hash in kv, never the password', async () => {
    const db = openDatabase(':memory:');
    await setPassword(db, 'stored password', cheap);
    const stored = getPasswordHash(db);
    expect(stored).not.toContain('stored password');
    expect(await verifyPassword('stored password', stored ?? '')).toBe(true);
  });
});

describe('sessions', () => {
  it('stores only the SHA-256 of the token', () => {
    const db = openDatabase(':memory:');
    const store = createSessionStore(db);
    const token = store.create(0);
    const rows = db.prepare('SELECT token_hash FROM sessions').all();
    expect(rows).toEqual([{ token_hash: hashToken(token) }]);
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('validates, renews after a day and expires after 400 idle days', () => {
    const store = createSessionStore(openDatabase(':memory:'));
    const token = store.create(0);
    expect(store.check(token, 1000)).toEqual({ renewed: false });
    expect(store.check(token, SESSION_RENEW_AFTER_MS)).toEqual({ renewed: true });
    expect(store.check(token, SESSION_RENEW_AFTER_MS + 1000)).toEqual({ renewed: false });
    expect(store.check(token, SESSION_RENEW_AFTER_MS + SESSION_TTL_MS - 1)).toEqual({ renewed: true });
    expect(store.check(token, 3 * SESSION_TTL_MS)).toBeNull();
  });

  it('rejects unknown, malformed and revoked tokens', () => {
    const store = createSessionStore(openDatabase(':memory:'));
    const token = store.create(0);
    expect(store.check('A'.repeat(43), 0)).toBeNull();
    expect(store.check('short', 0)).toBeNull();
    store.revoke(token);
    expect(store.check(token, 0)).toBeNull();
  });

  it('purges expired sessions', () => {
    const store = createSessionStore(openDatabase(':memory:'));
    store.create(0);
    const fresh = store.create(SESSION_TTL_MS);
    expect(store.purgeExpired(SESSION_TTL_MS)).toBe(1);
    expect(store.check(fresh, SESSION_TTL_MS)).toEqual({ renewed: false });
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
