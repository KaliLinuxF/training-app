import { text } from '../db/rows';
import type { Database } from '../db/sqlite';
import type { UserId } from '../db/users';

export interface StoredSubscription {
  endpoint: string;
  p256dh: string;
  auth: string;
}

/** `conflict`: the endpoint belongs to another user and the request did not prove the same browser subscription. */
export type UpsertResult = 'ok' | 'conflict';

/** One user's push subscriptions (docs/multi-user.md §5.4, D15). */
export interface UserSubscriptions {
  /**
   * Stores the subscription as this user's. An endpoint another user owns moves here only when `auth` (the browser
   * subscription's own secret) equals the stored one; otherwise nothing changes and the result is `conflict`.
   */
  upsert(sub: StoredSubscription, userAgent: string | null, now: number): UpsertResult;
  /**
   * Deletes the endpoint when it is this user's, or — with `auth` — when `auth` matches whoever owns it (a switch on
   * the same browser). Without `auth` (old clients) only this user's own row. True when a row went.
   */
  remove(endpoint: string, auth?: string): boolean;
  /** This user's devices, oldest first. */
  all(): StoredSubscription[];
  markOk(endpoint: string, now: number): void;
  /** The push service said 404 / 410: forget this user's endpoint. */
  removeGone(endpoint: string): boolean;
}

export interface SubscriptionRepo {
  forUser(id: UserId): UserSubscriptions;
  /** Users who have at least one subscription and are not disabled (the reminder scheduler's list). */
  recipients(): UserId[];
  /** Deletes every subscription of `id` (disable). Returns how many. */
  removeAllFor(id: UserId): number;
}

export function createSubscriptionRepo(db: Database): SubscriptionRepo {
  const q = {
    // A cross-user move needs the same `auth`; a move restarts created_at / last_ok_at (a new owner's device).
    upsert: db.prepare(
      `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, user_agent, created_at, last_ok_at)
       VALUES (?, ?, ?, ?, ?, ?, NULL)
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
         user_agent = excluded.user_agent,
         created_at = CASE WHEN push_subscriptions.user_id = excluded.user_id
                           THEN push_subscriptions.created_at ELSE excluded.created_at END,
         last_ok_at = CASE WHEN push_subscriptions.user_id = excluded.user_id
                           THEN push_subscriptions.last_ok_at ELSE NULL END
       WHERE push_subscriptions.user_id = excluded.user_id OR push_subscriptions.auth = excluded.auth`,
    ),
    removeOwn: db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?'),
    removeOwnOrAuth: db.prepare(
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND (user_id = ? OR auth = ?)',
    ),
    all: db.prepare(
      'SELECT endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ? ORDER BY created_at, endpoint',
    ),
    markOk: db.prepare('UPDATE push_subscriptions SET last_ok_at = ? WHERE endpoint = ? AND user_id = ?'),
    recipients: db.prepare(
      `SELECT DISTINCT s.user_id FROM push_subscriptions s JOIN users u ON u.id = s.user_id
       WHERE u.disabled_at IS NULL ORDER BY s.user_id`,
    ),
    removeAllFor: db.prepare('DELETE FROM push_subscriptions WHERE user_id = ?'),
  };

  const changed = (result: { changes: number | bigint }): boolean => Number(result.changes) > 0;

  function forUser(id: UserId): UserSubscriptions {
    return {
      upsert(sub, userAgent, now) {
        const result = q.upsert.run(sub.endpoint, id, sub.p256dh, sub.auth, userAgent, now);
        return changed(result) ? 'ok' : 'conflict';
      },
      remove(endpoint, auth) {
        return changed(
          auth === undefined ? q.removeOwn.run(endpoint, id) : q.removeOwnOrAuth.run(endpoint, id, auth),
        );
      },
      all() {
        return q.all.all(id).map((row) => ({
          endpoint: text(row, 'endpoint'),
          p256dh: text(row, 'p256dh'),
          auth: text(row, 'auth'),
        }));
      },
      markOk(endpoint, now) {
        q.markOk.run(now, endpoint, id);
      },
      removeGone(endpoint) {
        return changed(q.removeOwn.run(endpoint, id));
      },
    };
  }

  return {
    forUser,
    recipients: () => q.recipients.all().map((row) => text(row, 'user_id') as UserId),
    removeAllFor: (id) => Number(q.removeAllFor.run(id).changes),
  };
}
