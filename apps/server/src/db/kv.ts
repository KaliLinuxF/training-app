import { text } from './rows';
import type { Database } from './sqlite';

/** Keys of the `kv` table. */
export const KV = {
  passwordHash: 'password_hash',
  settings: 'settings',
  vapidPublicKey: 'vapid_public_key',
  vapidPrivateKey: 'vapid_private_key',
  /** `{ date, count }`: AI estimates attempted on the user's current local day. */
  foodBudget: 'food_budget',
} as const;

export type KvKey = (typeof KV)[keyof typeof KV];

export function getKv(db: Database, key: KvKey): string | null {
  const row = db.prepare('SELECT value FROM kv WHERE key = ?').get(key);
  return row ? text(row, 'value') : null;
}

export function setKv(db: Database, key: KvKey, value: string): void {
  db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value',
  ).run(key, value);
}

export function deleteKv(db: Database, key: KvKey): void {
  db.prepare('DELETE FROM kv WHERE key = ?').run(key);
}
