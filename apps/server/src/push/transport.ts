import type { ClientRequest, IncomingMessage } from 'node:http';
import { request as httpsRequest, type RequestOptions } from 'node:https';
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

/**
 * The push services browsers hand out endpoints on: Apple (Safari, iPhone home-screen apps), Google FCM (Chrome and
 * the Chromium browsers), Mozilla autopush (Firefox) and Windows WNS (Edge on Windows). Exact hosts, plus subdomains
 * of the suffixes below. Any other host is refused: an invited user must not make the server POST to arbitrary (or
 * internal) addresses.
 */
const PUSH_HOSTS: ReadonlySet<string> = new Set([
  'web.push.apple.com',
  'fcm.googleapis.com',
  'updates.push.services.mozilla.com',
]);
const PUSH_HOST_SUFFIXES: readonly string[] = [
  '.push.apple.com',
  '.push.services.mozilla.com',
  '.notify.windows.com',
];

/**
 * True for an `https:` endpoint on a known push service, on the default port, without user info. Names only: an IP
 * literal, `localhost` or a trailing-dot spelling never matches.
 */
export function isAllowedPushEndpoint(endpoint: string): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.port !== '' || url.username !== '' || url.password !== '')
    return false;
  const host = url.hostname;
  return PUSH_HOSTS.has(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
}

/** Every delivery is settled within this, answered or not: a push service that drips its answer holds nothing up. */
export const PUSH_DEADLINE_MS = 20_000;
/** At most this much of an answer is read (only a refusal's short reason is used); the rest is never buffered. */
export const PUSH_MAX_RESPONSE_BYTES = 4096;

export type RequestFn = (options: RequestOptions, callback: (res: IncomingMessage) => void) => ClientRequest;

export interface WebPushTransportOptions {
  deadlineMs?: number;
  maxResponseBytes?: number;
  /** Default `https.request`; tests point it at a local server. */
  request?: RequestFn;
}

/** The encrypted request `web-push` prepared (VAPID `Authorization`, `TTL`, `Urgency`, `Content-Encoding`). */
export interface OutgoingPush {
  endpoint: string;
  method: string;
  headers: Record<string, string | number>;
  body: Buffer | null;
}

function refusal(statusCode: number, body: string): PushDelivery {
  // Push services answer with a short reason (Apple: {"reason":"BadJwtToken"}); no secrets in it.
  const detail = body.trim().slice(0, 120);
  return { ok: false, statusCode, reason: `HTTP ${statusCode}${detail ? ` ${detail}` : ''}` };
}

const messageOf = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * POSTs one prepared request with an overall deadline and a cap on how much of the answer is read (web-push's own
 * sender has only a socket idle timeout and buffers the whole answer). A 2xx settles as soon as its headers arrive.
 */
export function deliver(
  outgoing: OutgoingPush,
  { deadlineMs, maxResponseBytes, request }: Required<WebPushTransportOptions>,
): Promise<PushDelivery> {
  return new Promise<PushDelivery>((resolve) => {
    let settled = false;
    let req: ClientRequest | null = null;
    let statusCode: number | null = null;
    const chunks: Buffer[] = [];
    let received = 0;

    /** What is known so far: the refusal and the start of its reason, or no answer at all. */
    const answerSoFar = (fallback: string): PushDelivery =>
      statusCode === null
        ? { ok: false, statusCode: null, reason: fallback }
        : refusal(statusCode, Buffer.concat(chunks).subarray(0, maxResponseBytes).toString('utf8'));

    const timer = setTimeout(() => settle(answerSoFar(`no answer within ${deadlineMs} ms`)), deadlineMs);
    timer.unref();

    function settle(delivery: PushDelivery): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Nothing more is read or sent on this request.
      req?.destroy();
      resolve(delivery);
    }

    try {
      const url = new URL(outgoing.endpoint);
      req = request(
        {
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          method: outgoing.method,
          headers: outgoing.headers,
        },
        (res) => {
          // Destroying the request mid-answer makes the response emit `error` (ECONNRESET): never unhandled.
          res.on('error', (err) => settle(answerSoFar(err.message)));
          const code = res.statusCode ?? 0;
          statusCode = code;
          if (code >= 200 && code <= 299) {
            settle({ ok: true });
            return;
          }
          res.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
            received += chunk.length;
            if (received >= maxResponseBytes) settle(answerSoFar(''));
          });
          res.on('end', () => settle(answerSoFar('')));
        },
      );
    } catch (err) {
      settle({ ok: false, statusCode: null, reason: messageOf(err) });
      return;
    }
    req.on('error', (err) => settle(answerSoFar(err.message)));
    req.end(outgoing.body ?? undefined);
  });
}

export function createWebPushTransport(
  vapid: VapidKeys & { subject: string },
  options: WebPushTransportOptions = {},
): PushTransport {
  const limits: Required<WebPushTransportOptions> = {
    deadlineMs: options.deadlineMs ?? PUSH_DEADLINE_MS,
    maxResponseBytes: options.maxResponseBytes ?? PUSH_MAX_RESPONSE_BYTES,
    request: options.request ?? httpsRequest,
  };
  const vapidDetails = { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey };
  return {
    async send(sub, payload, opts) {
      // Rows stored before the host check existed are never contacted either.
      if (!isAllowedPushEndpoint(sub.endpoint))
        return { ok: false, statusCode: null, reason: 'not a known push service' };
      let outgoing: OutgoingPush;
      try {
        outgoing = webpush.generateRequestDetails(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload,
          { vapidDetails, TTL: opts.ttl, urgency: opts.urgency, contentEncoding: 'aes128gcm' },
        );
      } catch (err) {
        // Malformed keys: nothing was sent.
        return { ok: false, statusCode: null, reason: messageOf(err) };
      }
      return deliver(outgoing, limits);
    },
  };
}
