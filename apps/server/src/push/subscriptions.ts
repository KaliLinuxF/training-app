import { text } from '../db/rows';
import type { Database } from '../db/sqlite';

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

export interface SubscriptionRepo {
  upsert(sub: StoredSubscription, userAgent: string | null, now: number): void;
  remove(endpoint: string): boolean;
  all(): StoredSubscription[];
  markOk(endpoint: string, now: number): void;
}

export function createSubscriptionRepo(db: Database): SubscriptionRepo {
  const q = {
    upsert: db.prepare(
      `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent, created_at, last_ok_at)
       VALUES (?, ?, ?, ?, ?, NULL)
       ON CONFLICT (endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent`,
    ),
    remove: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?'),
    all: db.prepare('SELECT endpoint, p256dh, auth FROM push_subscriptions ORDER BY created_at'),
    markOk: db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ?'),
  };

  return {
    upsert(sub, userAgent, now) {
      q.upsert.run(sub.endpoint, sub.p256dh, sub.auth, userAgent, now);
    },
    remove(endpoint) {
      return Number(q.remove.run(endpoint).changes) > 0;
    },
    all() {
      return q.all.all().map((row) => ({
        endpoint: text(row, 'endpoint'),
        p256dh: text(row, 'p256dh'),
        auth: text(row, 'auth'),
      }));
    },
    markOk(endpoint, now) {
      q.markOk.run(now, endpoint);
    },
  };
}
