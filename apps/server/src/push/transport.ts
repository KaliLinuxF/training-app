import webpush from 'web-push';
import type { StoredSubscription } from './subscriptions';
import type { VapidKeys } from './vapid';

export interface PushRequestOptions {
  /** Seconds the push service keeps the message for an offline device. */
  ttl: number;
  urgency: 'normal' | 'high';
}

export type PushDelivery = { ok: true } | { ok: false; statusCode: number | null; reason: string };

/** Sends one encrypted message. Never throws: failures come back as `{ ok: false }`. */
export interface PushTransport {
  send(sub: StoredSubscription, payload: string, options: PushRequestOptions): Promise<PushDelivery>;
}

const REQUEST_TIMEOUT_MS = 15_000;

export function createWebPushTransport(vapid: VapidKeys & { subject: string }): PushTransport {
  const vapidDetails = { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey };
  return {
    async send(sub, payload, options) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          {
            vapidDetails,
            TTL: options.ttl,
            urgency: options.urgency,
            contentEncoding: 'aes128gcm',
            timeout: REQUEST_TIMEOUT_MS,
          },
        );
        return { ok: true };
      } catch (err) {
        if (err instanceof webpush.WebPushError) {
          // Push services answer with a short reason (Apple: {"reason":"BadJwtToken"}); no secrets in it.
          const detail = typeof err.body === 'string' ? err.body.trim().slice(0, 120) : '';
          return {
            ok: false,
            statusCode: err.statusCode,
            reason: `HTTP ${err.statusCode}${detail ? ` ${detail}` : ''}`,
          };
        }
        return { ok: false, statusCode: null, reason: err instanceof Error ? err.message : String(err) };
      }
    },
  };
}
