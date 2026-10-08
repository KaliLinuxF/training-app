import { silentLogger, type Logger } from '../logger';
import type { PushMessage } from './messages';
import { createSubscriptionRepo, type StoredSubscription, type SubscriptionRepo } from './subscriptions';
import type { PushDelivery, PushRequestOptions, PushTransport } from './transport';
import type { Database } from '../db/sqlite';

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

export interface PushService {
  readonly publicKey: string;
  subscribe(sub: StoredSubscription, userAgent: string | null): void;
  unsubscribe(endpoint: string): void;
  sendToAll(message: PushMessage, options?: Partial<PushRequestOptions>): Promise<SendSummary>;
}

export interface PushServiceDeps {
  db: Database;
  transport: PushTransport;
  publicKey: string;
  logger?: Logger;
  now?: () => number;
}

const DEFAULT_OPTIONS: PushRequestOptions = { ttl: 3 * 3600, urgency: 'high' };

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
  const subs: SubscriptionRepo = createSubscriptionRepo(db);

  return {
    publicKey,

    subscribe(sub, userAgent) {
      subs.upsert(sub, userAgent, now());
    },

    unsubscribe(endpoint) {
      subs.remove(endpoint);
    },

    async sendToAll(message, options) {
      const opts = { ...DEFAULT_OPTIONS, ...options };
      const payload = JSON.stringify(message);
      const targets = subs.all();
      const results = await Promise.all(targets.map((sub) => transport.send(sub, payload, opts)));
      const summary: SendSummary = {
        attempted: targets.length,
        sent: 0,
        removed: 0,
        failed: 0,
        retryable: 0,
      };
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
          subs.remove(sub.endpoint);
          logger.info(`push: removed expired subscription at ${endpointHost(sub.endpoint)}`);
          return;
        }
        summary.failed++;
        if (isRetryable(delivery)) summary.retryable++;
        logger.warn(`push: delivery to ${endpointHost(sub.endpoint)} failed (${delivery.reason})`);
      });
      return summary;
    },
  };
}
