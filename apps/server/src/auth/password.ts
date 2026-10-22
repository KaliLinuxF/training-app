import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { PASSWORD_LIMITS, type PasswordChangeVia } from '@legko/shared';
import type { Database } from '../db/sqlite';
import { createTokenRepo } from '../db/tokens';
import { atomic } from '../db/tx';
import { createUserRepo, type UserId } from '../db/users';
import { createSessionStore } from './sessions';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** ~32 MiB and ~100 ms per hash on a small VPS. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
export const PASSWORD_MIN_LENGTH = PASSWORD_LIMITS.min;
export const PASSWORD_MAX_LENGTH = PASSWORD_LIMITS.max;

// ── Concurrency cap (D31) ─────────────────────────────────────────────────────────────────────────────────────────

/** The gate's queue is full: the route answers 429 `rate_limited` with `Retry-After: 5`. */
export class ScryptBusy extends Error {
  override name = 'ScryptBusy';
  constructor() {
    super('Too many password checks in progress');
  }
}

/** Seconds a client is told to wait when the gate is full. */
export const SCRYPT_BUSY_RETRY_AFTER = 5;

export interface ScryptGateOptions {
  /** Hashes / verifies running at once (each takes a libuv thread and ~32 MiB). */
  maxInFlight?: number;
  /** Waiting callers beyond those; one more throws `ScryptBusy`. */
  maxQueued?: number;
}

export interface ScryptGate {
  /** Runs `task` when a slot is free (FIFO). Rejects with `ScryptBusy` when the queue is full. */
  run<T>(task: () => Promise<T>): Promise<T>;
  stats(): { inFlight: number; queued: number; started: number };
}

/**
 * At most `maxInFlight` scrypt runs at a time app-wide, the rest wait in a FIFO queue of `maxQueued`: one endpoint (or
 * a parallel burst) cannot monopolise libuv's 4-thread pool, which photo file I/O shares.
 */
export function createScryptGate({ maxInFlight = 2, maxQueued = 16 }: ScryptGateOptions = {}): ScryptGate {
  let inFlight = 0;
  let started = 0;
  const queue: (() => void)[] = [];

  const execute = <T>(task: () => Promise<T>): Promise<T> => {
    inFlight++;
    started++;
    return new Promise<T>((resolve) => resolve(task())).finally(() => {
      inFlight--;
      const next = queue.shift();
      if (next) next();
    });
  };

  return {
    run(task) {
      if (inFlight < maxInFlight && queue.length === 0) return execute(task);
      if (queue.length >= maxQueued) return Promise.reject(new ScryptBusy());
      return new Promise((resolve, reject) => {
        queue.push(() => {
          execute(task).then(resolve, reject);
        });
      });
    },
    stats: () => ({ inFlight, queued: queue.length, started }),
  };
}

/** The app-wide gate (tests inject their own through `createApp({ scryptGate })`). */
export const defaultScryptGate: ScryptGate = createScryptGate();

// ── Hashing ───────────────────────────────────────────────────────────────────────────────────────────────────────

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r + 1024 * 1024 };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

const format = (params: ScryptParams, salt: Buffer, key: Buffer): string =>
  ['scrypt', params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join('$');

/** Format: `scrypt$N$r$p$<salt b64url>$<hash b64url>`. Goes through the scrypt gate. */
export async function hashPassword(
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
  gate: ScryptGate = defaultScryptGate,
): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await gate.run(() => derive(password, salt, params));
  return format(params, salt, key);
}

interface ParsedHash {
  params: ScryptParams;
  salt: Buffer;
  key: Buffer;
}

function parseHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return null;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  if (!N || !r || !p || !Number.isInteger(N) || !Number.isInteger(r) || !Number.isInteger(p)) return null;
  const salt = Buffer.from(parts[4] ?? '', 'base64url');
  const key = Buffer.from(parts[5] ?? '', 'base64url');
  if (salt.length === 0 || key.length === 0) return null;
  return { params: { N, r, p }, salt, key };
}

/** Constant-time compare of the derived key; goes through the scrypt gate. */
export async function verifyPassword(
  password: string,
  stored: string,
  gate: ScryptGate = defaultScryptGate,
): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await gate.run(() => derive(password, parsed.salt, parsed.params));
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

const dummies = new Map<string, string>();

/**
 * A well-formed hash with `params` that no password matches (random salt and a random 64-byte "key", i.e. the hash of
 * an unknown random password). Verified for unknown users and users without a password, so the work — and the time —
 * is the same as for a real account. Memoised per parameter set.
 */
export function createDummyHash(params: ScryptParams = DEFAULT_SCRYPT): string {
  const id = `${params.N}:${params.r}:${params.p}`;
  let hash = dummies.get(id);
  if (!hash) {
    hash = format(params, randomBytes(SALT_BYTES), randomBytes(KEY_LENGTH));
    dummies.set(id, hash);
  }
  return hash;
}

/** Returns a reason the password is unacceptable, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  return null;
}

// ── Storing a new password (§3.3 matrix) ──────────────────────────────────────────────────────────────────────────

export interface PasswordChangeOptions {
  via: PasswordChangeVia;
  /** The link creator (reset / setup); null for self / CLI. */
  by?: UserId | null;
  /** A session that survives (none by default: D26 revokes the current one too and the route sets a fresh cookie). */
  keepSessionHash?: string;
}

export interface PasswordChangeEffects {
  sessionsRevoked: number;
  linksRevoked: number;
}

/**
 * Stores an already computed hash and applies the invalidation matrix: every session of the user (except
 * `keepSessionHash`), the pending reset links FOR the user, and — after a reset / setup / CLI change of an admin
 * (account recovery, D27) — every pending link that admin created. Runs inside the caller's transaction, or in its own.
 */
export function storePasswordHash(
  db: Database,
  userId: UserId,
  hash: string,
  now: number,
  { via, by = null, keepSessionHash }: PasswordChangeOptions,
): PasswordChangeEffects {
  return atomic(db, () => {
    const users = createUserRepo(db);
    const tokens = createTokenRepo(db);
    const user = users.byId(userId);
    if (!user) throw new Error('setUserPassword: unknown user');
    users.setPasswordHash(userId, hash, { now, via, by });
    const sessionsRevoked = createSessionStore(db).revokeAllFor(
      userId,
      keepSessionHash ? { except: keepSessionHash } : {},
    );
    let linksRevoked = tokens.revokeResetsFor(userId, now);
    if (via !== 'self' && user.role === 'admin') linksRevoked += tokens.revokeCreatedBy(userId, now);
    return { sessionsRevoked, linksRevoked };
  });
}

/**
 * Hashes `password` (through the gate, before any transaction) and stores it with `storePasswordHash`. The caller
 * has validated it (`passwordProblem`).
 */
export async function setUserPassword(
  db: Database,
  userId: UserId,
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
  options: PasswordChangeOptions & { gate?: ScryptGate; now?: number },
): Promise<PasswordChangeEffects> {
  const hash = await hashPassword(password, params, options.gate);
  return storePasswordHash(db, userId, hash, options.now ?? Date.now(), options);
}
