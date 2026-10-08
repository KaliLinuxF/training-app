import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open';
import { getPasswordHash, hashPassword, passwordProblem, setPassword, verifyPassword } from './password';
import { createRateLimiter } from './rateLimit';
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
