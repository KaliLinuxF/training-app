import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';
import { deleteKv, getKv, KV, setKv } from '../db/kv';
import type { Database } from '../db/sqlite';
import { transaction } from '../db/tx';
import { revokeAllSessions } from './sessions';

export interface ScryptParams {
  N: number;
  r: number;
  p: number;
}

/** ~32 MiB and ~100 ms per hash on a small VPS. */
export const DEFAULT_SCRYPT: ScryptParams = { N: 2 ** 15, r: 8, p: 1 };

const KEY_LENGTH = 64;
const SALT_BYTES = 16;
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 200;

function derive(password: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
  const options: ScryptOptions = { ...params, maxmem: 256 * params.N * params.r + 1024 * 1024 };
  return new Promise((resolve, reject) => {
    scrypt(password.normalize('NFC'), salt, KEY_LENGTH, options, (err, key) =>
      err ? reject(err) : resolve(key),
    );
  });
}

/** Format: `scrypt$N$r$p$<salt b64url>$<hash b64url>`. */
export async function hashPassword(password: string, params: ScryptParams = DEFAULT_SCRYPT): Promise<string> {
  const salt = randomBytes(SALT_BYTES);
  const key = await derive(password, salt, params);
  return ['scrypt', params.N, params.r, params.p, salt.toString('base64url'), key.toString('base64url')].join(
    '$',
  );
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

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parsed = parseHash(stored);
  if (!parsed) return false;
  const key = await derive(password, parsed.salt, parsed.params);
  return key.length === parsed.key.length && timingSafeEqual(key, parsed.key);
}

/** Returns a reason the password is unacceptable, or null. */
export function passwordProblem(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH)
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`;
  if (password.length > PASSWORD_MAX_LENGTH)
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`;
  return null;
}

export const getPasswordHash = (db: Database): string | null => getKv(db, KV.passwordHash);

export const hasPassword = (db: Database): boolean => getPasswordHash(db) !== null;

/** Stores a new password hash and signs out every device. */
export async function setPassword(
  db: Database,
  password: string,
  params: ScryptParams = DEFAULT_SCRYPT,
): Promise<void> {
  const hash = await hashPassword(password, params);
  transaction(db, () => {
    setKv(db, KV.passwordHash, hash);
    revokeAllSessions(db);
  });
}

/** Test helper / recovery: removes the password (login then always fails). */
export function clearPassword(db: Database): void {
  transaction(db, () => {
    deleteKv(db, KV.passwordHash);
    revokeAllSessions(db);
  });
}
