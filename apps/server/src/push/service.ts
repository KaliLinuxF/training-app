import type { Database } from '../db/sqlite';
import type { UserId } from '../db/users';
import { silentLogger, type Logger } from '../logger';
import type { PushMessage } from './messages';
import {
  createSubscriptionRepo,
  type StoredSubscription,
  type UpsertResult,
  type UserSubscriptions,
} from './subscriptions';
import type { PushDelivery, PushRequestOptions, PushTransport } from './transport';

export interface SendSummary {
  /** Subscriptions we tried. */
  attempted: number;
  /** Accepted by the push service. */
  sent: number;
  /** Deleted because the push service said 404/410 (gone). */
  removed: number;
  /** Failed for any other reason. */
  failed: number;
  /** Subset of `failed` worth retrying later (network error, 429, 5xx). */
  retryable: number;
}

/** One user's devices (docs/multi-user.md §5.4): everything here touches only that user's subscriptions. */
export interface UserPush {
  /**
   * Stores the browser subscription as this user's. `conflict`: the endpoint belongs to another user and the request
   * did not carry the same `auth` key (D15) — nothing was changed. Beyond `MAX_SUBSCRIPTIONS_PER_USER` devices the
   * oldest of this user's others are forgotten.
   */
  subscribe(sub: StoredSubscription, userAgent: string | null): UpsertResult;
  /**
   * Removes the endpoint when it is this user's, or — with `auth` — whoever owns it when the key matches (a switch on
   * the same browser, D15). True when a row went.
   */
  unsubscribe(endpoint: string, auth?: string): boolean;
  /** Sends `message` to this user's devices only; forgets the ones the push service reports gone. */
  send(message: PushMessage, options?: Partial<PushRequestOptions>): Promise<SendSummary>;
}

export interface PushService {
  readonly publicKey: string;
  forUser(id: UserId): UserPush;
  /** Users with at least one device who are not disabled: the reminder scheduler's list. */
  recipients(): UserId[];
}

export interface PushServiceDeps {
  db: Database;
  transport: PushTransport;
  publicKey: string;
  logger?: Logger;
  now?: () => number;
}

const DEFAULT_OPTIONS: PushRequestOptions = { ttl: 3 * 3600, urgency: 'high' };

/**
 * Devices one account keeps (phones, browsers, re-subscribed endpoints). A new one beyond this replaces the oldest, so
 * one account cannot make a single send fan out to hundreds of requests.
 */
export const MAX_SUBSCRIPTIONS_PER_USER = 10;

const isGone = (d: PushDelivery): boolean => !d.ok && (d.statusCode === 404 || d.statusCode === 410);
const isRetryable = (d: PushDelivery): boolean =>
  !d.ok && (d.statusCode === null || d.statusCode === 429 || d.statusCode >= 500);

/** Push endpoints are capability URLs: only their host is ever logged. */
function endpointHost(endpoint: string): string {
  try {
    return new URL(endpoint).host;
  } catch {
    return 'invalid-endpoint';
  }
}

export function createPushService({
  db,
  transport,
  publicKey,
  logger = silentLogger,
  now = Date.now,
}: PushServiceDeps): PushService {
  const repo = createSubscriptionRepo(db);

  async function sendTo(
    subs: UserSubscriptions,
    message: PushMessage,
    options: Partial<PushRequestOptions> | undefined,
  ): Promise<SendSummary> {
    const opts = { ...DEFAULT_OPTIONS, ...options };
    const payload = JSON.stringify(message);
    // The newest devices only, also for rows stored before the cap existed.
    const targets = subs.all().slice(-MAX_SUBSCRIPTIONS_PER_USER);
    const results = await Promise.all(targets.map((sub) => transport.send(sub, payload, opts)));
    const summary: SendSummary = { attempted: targets.length, sent: 0, removed: 0, failed: 0, retryable: 0 };
    results.forEach((delivery, i) => {
      const sub = targets[i];
      if (!sub) return;
      if (delivery.ok) {
        summary.sent++;
        subs.markOk(sub.endpoint, now());
        return;
      }
      if (isGone(delivery)) {
        summary.removed++;
        // Scoped: if the endpoint moved to another user meanwhile, their row stays.
        subs.removeGone(sub.endpoint);
        logger.info(`push: removed expired subscription at ${endpointHost(sub.endpoint)}`);
        return;
      }
      summary.failed++;
      if (isRetryable(delivery)) summary.retryable++;
      logger.warn(`push: delivery to ${endpointHost(sub.endpoint)} failed (${delivery.reason})`);
    });
    return summary;
  }

  return {
    publicKey,

    forUser(id) {
      const subs = repo.forUser(id);
      return {
        subscribe(sub, userAgent) {
          const result = subs.upsert(sub, userAgent, now());
          if (result !== 'ok') return result;
          // Synchronous with the upsert (no await in between), so parallel requests cannot overshoot the cap.
          const others = subs.all().filter((s) => s.endpoint !== sub.endpoint);
          const excess = others.length + 1 - MAX_SUBSCRIPTIONS_PER_USER;
          for (const old of others.slice(0, Math.max(0, excess))) {
            subs.remove(old.endpoint);
            logger.info(`push: user ${id} has ${MAX_SUBSCRIPTIONS_PER_USER} devices, forgot the oldest one`);
          }
          return result;
        },
        unsubscribe: (endpoint, auth) => subs.remove(endpoint, auth),
        send: (message, options) => sendTo(subs, message, options),
      };
    },

    recipients: () => repo.recipients(),
  };
}
