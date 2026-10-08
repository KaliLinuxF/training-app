import webpush from 'web-push';
import type { VapidEnv } from '../config';
import { getKv, KV, setKv } from '../db/kv';
import type { Database } from '../db/sqlite';
import { transaction } from '../db/tx';

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

export type VapidSource = 'env' | 'database' | 'generated';

const BASE64URL_RE = /^[A-Za-z0-9_-]+$/;

/** Uncompressed P-256 public key (65 bytes, 0x04 prefix) and 32-byte private key, base64url. */
export function isValidVapidKeyPair(keys: VapidKeys): boolean {
  if (!BASE64URL_RE.test(keys.publicKey) || !BASE64URL_RE.test(keys.privateKey)) return false;
  const pub = Buffer.from(keys.publicKey, 'base64url');
  const priv = Buffer.from(keys.privateKey, 'base64url');
  return pub.length === 65 && pub[0] === 0x04 && priv.length === 32;
}

/**
 * Env keys win; otherwise keys live in `kv` and are generated on first start.
 * Throws on malformed keys so a typo in the env is noticed at start-up.
 */
export function loadVapidKeys(
  db: Database,
  env: Pick<VapidEnv, 'publicKey' | 'privateKey'>,
  generate: () => VapidKeys = () => webpush.generateVAPIDKeys(),
): { keys: VapidKeys; source: VapidSource } {
  if (env.publicKey && env.privateKey) {
    const keys = { publicKey: env.publicKey, privateKey: env.privateKey };
    if (!isValidVapidKeyPair(keys))
      throw new Error('VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not valid P-256 keys');
    return { keys, source: 'env' };
  }
  return transaction(db, () => {
    const publicKey = getKv(db, KV.vapidPublicKey);
    const privateKey = getKv(db, KV.vapidPrivateKey);
    if (publicKey && privateKey) {
      const keys = { publicKey, privateKey };
      if (!isValidVapidKeyPair(keys)) throw new Error('Stored VAPID keys are corrupt');
      return { keys, source: 'database' as const };
    }
    const keys = generate();
    setKv(db, KV.vapidPublicKey, keys.publicKey);
    setKv(db, KV.vapidPrivateKey, keys.privateKey);
    return { keys, source: 'generated' as const };
  });
}
