import { text } from './rows';
import type { Database } from './sqlite';

/**
 * Keys of the global `kv` table (schema v4). The v3 keys `password_hash` and `settings` moved to `users` /
 * `user_settings` (docs/multi-user.md §2.1); they are deliberately absent here, so no code can read them any more
 * (the migration and the downgrade use string literals).
 */
export const KV = {
  vapidPublicKey: 'vapid_public_key',
  vapidPrivateKey: 'vapid_private_key',
  /** `{ date, count }`: AI estimates of everybody together on the current Kyiv day (the GLOBAL ceiling's counter). */
  foodBudget: 'food_budget',
  /** JSON array of epoch-ms times of recent failed logins from any address (global login cap). */
  loginFailures: 'login_failures',
  /** `{ perUser, global }`: AI limits saved by an admin (absent = the env / default limits). */
  aiLimits: 'ai_limits',
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
