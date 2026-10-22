import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { API, USER_HEADER, type AiLimits, type UserRole } from '@legko/shared';
import type { Hono } from 'hono';
import { createScryptGate, hashPassword, type ScryptGate, type ScryptParams } from '../src/auth/password';
import type { RateLimiter } from '../src/auth/rateLimit';
import { createSessionStore, type SessionStore } from '../src/auth/sessions';
import { createDataRepos, type DataRepos } from '../src/db/data';
import { openDatabase } from '../src/db/open';
import type { Database } from '../src/db/sqlite';
import { createTokenRepo, type TokenRepo } from '../src/db/tokens';
import { createUserRepo, type UserId, type UserRepo, type UserRow } from '../src/db/users';
import { createFoodBudget, type FoodBudget } from '../src/food/budget';
import type { FoodEstimator } from '../src/food/estimator';
import { createApp } from '../src/http/app';
import type { AppEnv } from '../src/http/types';
import type { Logger } from '../src/logger';
import { createPhotoStore, type PhotoStore } from '../src/photos/store';
import { createPushService, type PushService } from '../src/push/service';
import {
  createSubscriptionRepo,
  type StoredSubscription,
  type SubscriptionRepo,
} from '../src/push/subscriptions';
import type { PushDelivery, PushRequestOptions, PushTransport } from '../src/push/transport';

/** `app.request()` URLs are `http://localhost/...`, so this is the request's own origin. */
export const ORIGIN = 'http://localhost';
/** anna's password (role user, the legacy owner). */
export const PASSWORD = 'correct horse battery';
/** admin's password (role admin). */
export const ADMIN_PASSWORD = 'admin horse battery';
/** Cheap parameters keep the suite fast; production uses DEFAULT_SCRYPT. */
export const TEST_SCRYPT: ScryptParams = { N: 1024, r: 8, p: 1 };
/** The default AI limits of the test server (as in production). */
export const TEST_AI_LIMITS: AiLimits = { perUser: 40, global: 150 };

/** Routes that require `X-Legko-User` on a v4 session (D11). */
const HEADER_PATHS: ReadonlySet<string> = new Set([API.data, API.ops, API.import]);

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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';
  /**
   * Serialised as JSON unless already a string. Mutating methods default to `{}`; GET, HEAD and OPTIONS never send
   * a body (and, like GET, no default Origin / Content-Type).
   */
  body?: unknown;
  cookie?: string | null;
  /** `null` omits the header. Default: same origin for non-GET requests. */
  origin?: string | null;
  contentType?: string | null;
  headers?: Record<string, string>;
  /**
   * `X-Legko-User`. Default: on `/api/data`, `/api/ops` and `/api/import`, the id of the user whose cookie
   * `login()` / `createUser()` returned. A string sends that value; `null` sends no header.
   */
  userHeader?: string | null;
}

export interface TestUser {
  id: UserId;
  username: string;
  /** `sid=…` of a fresh (non-legacy) session. */
  cookie: string;
}

export interface TestServer {
  app: Hono<AppEnv>;
  db: Database;
  photosDir: string;
  clock: Clock;
  push: PushService;
  transport: FakeTransport;
  users: UserRepo;
  tokens: TokenRepo;
  sessions: SessionStore;
  data: DataRepos;
  photos: PhotoStore;
  subscriptions: SubscriptionRepo;
  budget: FoodBudget;
  /** The seeded accounts (`users: false` → none; then these throw). */
  anna: UserRow;
  admin: UserRow;
  /** scrypt runs (hash or verify) that started through the app's gate so far. */
  scryptRuns(): number;
  call(path: string, options?: CallOptions): Promise<Response>;
  /** Logs in WITH a username (a v4, non-legacy session) and returns the `sid=…` cookie pair. Default anna. */
  login(username?: string, password?: string): Promise<string>;
  /** Creates an account (no invite) and logs it in. */
  createUser(username: string, role?: UserRole, password?: string): Promise<TestUser>;
  /** The user id behind a cookie made by `login()` / `createUser()`. */
  userIdOf(cookie: string | null | undefined): UserId | undefined;
}

export interface TestServerOptions {
  /** Seed anna (role user, legacy owner, `PASSWORD`) and admin (role admin, `ADMIN_PASSWORD`). Default true. */
  users?: boolean;
  production?: boolean;
  trustProxy?: boolean;
  staticDir?: string | null;
  publicOrigin?: string;
  pushAvailable?: boolean;
  /** Default: a unique path under the OS temp dir that only exists once a photo is stored. */
  photosDir?: string;
  /** AI estimator; default none (feature disabled). */
  estimator?: FoodEstimator | null;
  /** The default AI limits (config); admin-saved limits still win. Default `TEST_AI_LIMITS`. */
  aiLimits?: AiLimits;
  /** Default: a fresh gate per server (`scryptRuns()` counts it). */
  scryptGate?: ScryptGate;
  /** Successful-login budget; default as in `createApp` (production: `LOGIN_SUCCESS_LIMIT`, otherwise none). */
  loginSuccessLimiter?: RateLimiter;
  /** Live sessions per user; default as in `createApp` (production: `MAX_SESSIONS_PER_USER`, otherwise no cap). */
  sessionsPerUser?: number | null;
  /** The app's logger (e.g. one that captures lines); default silent. */
  logger?: Logger;
}

export function sessionCookie(res: Response): string | null {
  for (const header of res.headers.getSetCookie()) {
    const [pair] = header.split(';');
    if (pair?.startsWith('sid=') && pair.length > 4) return pair;
  }
  return null;
}

const missing = (name: string): UserRow => {
  throw new Error(`createTestServer({ users: false }) has no ${name}`);
};

export async function createTestServer(options: TestServerOptions = {}): Promise<TestServer> {
  const {
    users: seed = true,
    production = false,
    trustProxy = false,
    staticDir = null,
    publicOrigin = 'https://fit.triple-a.dev',
    pushAvailable = true,
    photosDir = join(tmpdir(), `legko-test-photos-${randomUUID()}`),
    estimator = null,
    aiLimits = TEST_AI_LIMITS,
    scryptGate = createScryptGate(),
    loginSuccessLimiter,
    sessionsPerUser,
    logger,
  } = options;
  const db = openDatabase(':memory:');
  const clock: Clock = { now: Date.UTC(2026, 9, 9, 9, 0) };
  const now = () => clock.now;
  const users = createUserRepo(db);

  let anna: UserRow | null = null;
  let admin: UserRow | null = null;
  if (seed) {
    // Hashed outside the app's gate, so scryptRuns() counts only what the tests do.
    const [annaHash, adminHash] = await Promise.all([
      hashPassword(PASSWORD, TEST_SCRYPT, createScryptGate()),
      hashPassword(ADMIN_PASSWORD, TEST_SCRYPT, createScryptGate()),
    ]);
    anna = users.create({
      username: 'anna',
      role: 'user',
      passwordHash: annaHash,
      now: clock.now,
      legacyOwner: true,
    });
    admin = users.create({ username: 'admin', role: 'admin', passwordHash: adminHash, now: clock.now });
  }

  const transport = fakeTransport();
  const push = createPushService({ db, transport, publicKey: 'test-public-key', now });
  const app = createApp({
    db,
    config: { production, publicOrigin, trustProxy, staticDir },
    push: pushAvailable ? push : null,
    photosDir,
    food: { estimator, limits: aiLimits },
    now,
    scrypt: TEST_SCRYPT,
    scryptGate,
    version: 'test',
    ...(loginSuccessLimiter ? { loginSuccessLimiter } : {}),
    ...(sessionsPerUser !== undefined ? { sessionsPerUser } : {}),
    ...(logger ? { logger } : {}),
  });

  const owners = new Map<string, UserId>();
  const userIdOf = (cookie: string | null | undefined): UserId | undefined =>
    cookie ? owners.get(cookie) : undefined;

  const call = (path: string, opts: CallOptions = {}): Promise<Response> => {
    const method = opts.method ?? (opts.body === undefined ? 'GET' : 'POST');
    const headers = new Headers(opts.headers);
    const mutating = method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS';
    const origin = opts.origin === undefined ? (mutating ? ORIGIN : null) : opts.origin;
    if (origin !== null) headers.set('Origin', origin);
    const contentType =
      opts.contentType === undefined ? (mutating ? 'application/json' : null) : opts.contentType;
    if (contentType !== null) headers.set('Content-Type', contentType);
    if (opts.cookie) headers.set('Cookie', opts.cookie);
    if (opts.userHeader !== undefined) {
      if (opts.userHeader !== null) headers.set(USER_HEADER, opts.userHeader);
    } else if (!headers.has(USER_HEADER) && HEADER_PATHS.has(path.split('?')[0] ?? path)) {
      const id = userIdOf(opts.cookie);
      if (id) headers.set(USER_HEADER, id);
    }
    const body = mutating
      ? typeof opts.body === 'string'
        ? opts.body
        : JSON.stringify(opts.body ?? {})
      : undefined;
    return Promise.resolve(app.request(path, { method, headers, body }));
  };

  const login = async (username = 'anna', password?: string): Promise<string> => {
    const pw = password ?? (username === 'admin' ? ADMIN_PASSWORD : PASSWORD);
    const res = await call(API.login, { body: { username, password: pw } });
    const cookie = sessionCookie(res);
    if (res.status !== 200 || !cookie) throw new Error(`login failed: ${res.status}`);
    const { user } = (await res.json()) as { user: { id: UserId } };
    owners.set(cookie, user.id);
    return cookie;
  };

  const createUser = async (
    username: string,
    role: UserRole = 'user',
    password = PASSWORD,
  ): Promise<TestUser> => {
    const passwordHash = await hashPassword(password, TEST_SCRYPT, createScryptGate());
    const row = users.create({ username, role, passwordHash, now: clock.now });
    const cookie = await login(username, password);
    return { id: row.id, username: row.username, cookie };
  };

  return {
    app,
    db,
    photosDir,
    clock,
    push,
    transport,
    users,
    tokens: createTokenRepo(db),
    sessions: createSessionStore(db),
    data: createDataRepos(db, now),
    photos: createPhotoStore(db, photosDir, now),
    subscriptions: createSubscriptionRepo(db),
    budget: createFoodBudget(db, aiLimits),
    get anna() {
      return anna ?? missing('anna');
    },
    get admin() {
      return admin ?? missing('admin');
    },
    scryptRuns: () => scryptGate.stats().started,
    call,
    login,
    createUser,
    userIdOf,
  };
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

/**
 * POSTs a streamed body straight to the app (`call()` always sends strings). Like `call()`, it adds
 * `X-Legko-User` on data / ops / import for a cookie made by `login()` / `createUser()`.
 */
export function postStream(
  server: TestServer,
  path: string,
  body: StreamedBody,
  headers: Record<string, string> = {},
): Promise<Response> {
  const extra: Record<string, string> = {};
  const id = server.userIdOf(headers.Cookie);
  if (id && HEADER_PATHS.has(path) && !(USER_HEADER in headers)) extra[USER_HEADER] = id;
  return Promise.resolve(
    server.app.request(path, {
      method: 'POST',
      headers: { Origin: ORIGIN, 'Content-Type': 'application/json', ...extra, ...headers },
      body: body.stream,
      duplex: 'half',
    }),
  );
}
