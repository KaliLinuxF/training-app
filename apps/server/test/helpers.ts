import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Hono } from 'hono';
import { setPassword, type ScryptParams } from '../src/auth/password';
import { createApp } from '../src/http/app';
import type { AppEnv } from '../src/http/types';
import { openDatabase } from '../src/db/open';
import type { Database } from '../src/db/sqlite';
import type { FoodEstimator } from '../src/food/estimator';
import { createPushService, type PushService } from '../src/push/service';
import type { StoredSubscription } from '../src/push/subscriptions';
import type { PushDelivery, PushRequestOptions, PushTransport } from '../src/push/transport';

/** `app.request()` URLs are `http://localhost/...`, so this is the request's own origin. */
export const ORIGIN = 'http://localhost';
export const PASSWORD = 'correct horse battery';
/** Cheap parameters keep the suite fast; production uses DEFAULT_SCRYPT. */
export const TEST_SCRYPT: ScryptParams = { N: 1024, r: 8, p: 1 };

export interface FakeTransport extends PushTransport {
  sent: { endpoint: string; payload: unknown; options: PushRequestOptions }[];
  /** Per-endpoint canned outcome; default `{ ok: true }`. */
  outcomes: Map<string, PushDelivery>;
}

export function fakeTransport(): FakeTransport {
  const sent: FakeTransport['sent'] = [];
  const outcomes = new Map<string, PushDelivery>();
  return {
    sent,
    outcomes,
    async send(sub: StoredSubscription, payload: string, options: PushRequestOptions) {
      sent.push({ endpoint: sub.endpoint, payload: JSON.parse(payload) as unknown, options });
      return outcomes.get(sub.endpoint) ?? { ok: true };
    },
  };
}

export interface Clock {
  now: number;
}

export interface CallOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  /** Serialised as JSON unless already a string. POSTs default to `{}`. */
  body?: unknown;
  cookie?: string | null;
  /** `null` omits the header. Default: same origin for non-GET requests. */
  origin?: string | null;
  contentType?: string | null;
  headers?: Record<string, string>;
}

export interface TestServer {
  app: Hono<AppEnv>;
  db: Database;
  photosDir: string;
  clock: Clock;
  push: PushService;
  transport: FakeTransport;
  call(path: string, options?: CallOptions): Promise<Response>;
  /** Logs in with `PASSWORD` and returns the `sid=…` cookie pair. */
  login(): Promise<string>;
}

export interface TestServerOptions {
  password?: string | null;
  production?: boolean;
  trustProxy?: boolean;
  staticDir?: string | null;
  publicOrigin?: string;
  pushAvailable?: boolean;
  /** Default: a unique path under the OS temp dir that only exists once a photo is stored. */
  photosDir?: string;
  /** AI estimator; default none (feature disabled). */
  estimator?: FoodEstimator | null;
  foodDailyLimit?: number;
}

export function sessionCookie(res: Response): string | null {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';');
    if (pair?.startsWith('sid=') && pair.length > 4) return pair;
  }
  return null;
}

export async function createTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const {
    password = PASSWORD,
    production = false,
    trustProxy = false,
    staticDir = null,
    publicOrigin = 'https://fit.triple-a.dev',
    pushAvailable = true,
    photosDir = join(tmpdir(), `legko-test-photos-${randomUUID()}`),
    estimator = null,
    foodDailyLimit,
  } = options;
  const db = openDatabase(':memory:');
  if (password !== null) await setPassword(db, password, TEST_SCRYPT);
  const clock: Clock = { now: Date.UTC(2026, 9, 9, 9, 0) };
  const now = () => clock.now;
  const transport = fakeTransport();
  const push = createPushService({ db, transport, publicKey: 'test-public-key', now });
  const app = createApp({
    db,
    config: { production, publicOrigin, trustProxy, staticDir },
    push: pushAvailable ? push : null,
    photosDir,
    food: { estimator, dailyLimit: foodDailyLimit },
    now,
    version: 'test',
  });

  const call = (path: string, opts: CallOptions = {}): Promise<Response> => {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const headers = new Headers(opts.headers);
    const mutating = method !== 'GET';
    const origin = opts.origin === undefined ? (mutating ? ORIGIN : null) : opts.origin;
    if (origin !== null) headers.set('Origin', origin);
    const contentType =
      opts.contentType === undefined ? (mutating ? 'application/json' : null) : opts.contentType;
    if (contentType !== null) headers.set('Content-Type', contentType);
    if (opts.cookie) headers.set('Cookie', opts.cookie);
    const body = mutating
      ? typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body ?? {})
      : undefined;
    return Promise.resolve(app.request(path, { method, headers, body }));
  };

  const login = async (): Promise<string> => {
    const res = await call('/api/auth/login', { body: { password: PASSWORD } });
    const cookie = sessionCookie(res);
    if (res.status !== 200 || !cookie) throw new Error(`login failed: ${res.status}`);
    return cookie;
  };

  return { app, db, photosDir, clock, push, transport, call, login };
}

export async function json<T = unknown>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Deterministic PRNG (mulberry32) for the randomized tests. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bytes that pass the JPEG magic check; the content is irrelevant to the server. */
export function fakeJpeg(size: number, fill = 7): Buffer {
  const bytes = Buffer.alloc(size, fill);
  bytes.set([0xff, 0xd8, 0xff, 0xe0]);
  return bytes;
}

export interface StreamedBody {
  stream: ReadableStream<Uint8Array>;
  /** Bytes the server has pulled from the stream so far. */
  pulled(): number;
}

/**
 * A request body of `totalBytes` with no Content-Length (like chunked uploads or HTTP/2 through
 * Caddy), produced only when the server reads it: shows how much a route buffered.
 */
export function streamedBody(totalBytes: number, chunkBytes = 64 * 1024): StreamedBody {
  let pulled = 0;
  const stream = new ReadableStream<Uint8Array>(
    {
      pull(controller) {
        if (pulled >= totalBytes) {
          controller.close();
          return;
        }
        const size = Math.min(chunkBytes, totalBytes - pulled);
        pulled += size;
        controller.enqueue(new Uint8Array(size).fill(0x20));
      },
    },
    // Nothing is pulled ahead of a read.
    { highWaterMark: 0 },
  );
  return { stream, pulled: () => pulled };
}

/** POSTs a streamed body straight to the app (`call()` always sends strings). */
export function postStream(
  server: TestServer,
  path: string,
  body: StreamedBody,
  headers: Record<string, string> = {},
): Promise<Response> {
  return Promise.resolve(
    server.app.request(path, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...headers },
      body: body.stream,
      duplex: 'half',
    }),
  );
}
