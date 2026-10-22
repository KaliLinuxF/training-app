import { createECDH, randomBytes } from 'node:crypto';
import {
  createServer,
  request as httpRequest,
  type IncomingMessage,
  type Server,
  type ServerResponse,
} from 'node:http';
import type { AddressInfo } from 'node:net';
import webpush from 'web-push';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createWebPushTransport, isAllowedPushEndpoint, type RequestFn } from './transport';

const vapid = { subject: 'https://fit.triple-a.dev', ...webpush.generateVAPIDKeys() };

/** A real browser key pair: the payload is actually encrypted. */
function browserKeys(): { p256dh: string; auth: string } {
  const ecdh = createECDH('prime256v1');
  ecdh.generateKeys();
  return { p256dh: ecdh.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') };
}

const sub = { endpoint: 'https://web.push.apple.com/QGx1?v=2', ...browserKeys() };

interface Received {
  method: string | undefined;
  url: string | undefined;
  headers: IncomingMessage['headers'];
  body: Buffer;
}

let server: Server;
let port = 0;
let received: Received[];
let closed: number;
let respond: (res: ServerResponse) => void;

beforeEach(async () => {
  received = [];
  closed = 0;
  respond = (res) => res.writeHead(201).end();
  server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      received.push({ method: req.method, url: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.on('close', () => closed++);
      // A client that went away mid-answer must not crash the test server.
      res.on('error', () => undefined);
      respond(res);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  port = (server.address() as AddressInfo).port;
});

afterEach(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

/** Sends what would go to the push service to the local server instead (plain http). */
const toLocal: RequestFn = (options, callback) =>
  httpRequest({ ...options, hostname: '127.0.0.1', port }, callback);

const transport = (options: { deadlineMs?: number; maxResponseBytes?: number } = {}) =>
  createWebPushTransport(vapid, { request: toLocal, ...options });

/** Writes `chunk` every `ms` until the client goes away. */
function drip(res: ServerResponse, chunk: string, ms: number): void {
  const timer = setInterval(() => res.write(chunk), ms);
  res.on('close', () => clearInterval(timer));
}

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://web.push.apple.com/QGx1',
    'https://api.push.apple.com/x',
    'https://fcm.googleapis.com/fcm/send/abc:def',
    'https://fcm.googleapis.com/wp/abc',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://wns2-par02p.notify.windows.com/w/?token=abc',
    'https://WEB.PUSH.APPLE.COM/upper-case-host',
    'https://web.push.apple.com:443/default-port-spelled-out',
  ])('allows %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'https://127.0.0.1:2019/load',
    'https://127.0.0.1/load',
    'https://[::1]/x',
    'https://2130706433/x',
    'https://localhost/x',
    'https://victim.example/x',
    'https://fcm.googleapis.com.evil.example/x',
    'https://web.push.apple.com.evil.example/x',
    'https://evilpush.apple.com/x',
    'https://push.apple.com/x',
    'https://notify.windows.com/x',
    'https://web.push.apple.com./trailing-dot',
    'https://web.push.apple.com:8443/x',
    'https://user:pass@web.push.apple.com/x',
    'https://user@fcm.googleapis.com/x',
    'http://web.push.apple.com/x',
    'not a url',
  ])('refuses %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });
});

describe('web-push transport', () => {
  it('POSTs the encrypted message with VAPID, aes128gcm, TTL and urgency to the endpoint path', async () => {
    const result = await transport().send(sub, '{"title":"x"}', { ttl: 60, urgency: 'high' });
    expect(result).toEqual({ ok: true });
    expect(received).toHaveLength(1);
    const [req] = received;
    expect(req?.method).toBe('POST');
    expect(req?.url).toBe('/QGx1?v=2');
    expect(req?.headers).toMatchObject({
      ttl: '60',
      urgency: 'high',
      'content-encoding': 'aes128gcm',
      'content-type': 'application/octet-stream',
    });
    expect(req?.headers.authorization).toMatch(/^vapid t=.+, k=.+/);
    // Encrypted: the plain text is not on the wire.
    expect(req?.body.length).toBeGreaterThan(0);
    expect(req?.body.toString('utf8')).not.toContain('title');
  });

  it('maps a refusal to its status code and a short reason', async () => {
    respond = (res) => res.writeHead(410).end('{"reason":"Unregistered"}');
    const result = await transport().send(sub, '{}', { ttl: 60, urgency: 'normal' });
    expect(result).toEqual({ ok: false, statusCode: 410, reason: 'HTTP 410 {"reason":"Unregistered"}' });
  });

  it('reads at most maxResponseBytes of an answer and drops the connection', async () => {
    respond = (res) => {
      res.writeHead(500);
      drip(res, 'x'.repeat(64 * 1024), 1);
    };
    const started = Date.now();
    const result = await transport({ maxResponseBytes: 4096, deadlineMs: 10_000 }).send(sub, '{}', {
      ttl: 60,
      urgency: 'normal',
    });
    expect(result).toEqual({ ok: false, statusCode: 500, reason: `HTTP 500 ${'x'.repeat(120)}` });
    expect(Date.now() - started).toBeLessThan(5_000);
    await expect.poll(() => closed).toBe(1);
  });

  it('a push service that drips its refusal cannot hold a send past the deadline', async () => {
    respond = (res) => {
      res.writeHead(503);
      drip(res, 'z', 20);
    };
    const started = Date.now();
    const result = await transport({ deadlineMs: 300 }).send(sub, '{}', { ttl: 60, urgency: 'normal' });
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(result).toMatchObject({ ok: false, statusCode: 503 });
    expect(result.ok === false && result.reason).toMatch(/^HTTP 503 z+$/);
    await expect.poll(() => closed).toBe(1);
  });

  it('no answer at all: a retryable failure (statusCode null) once the deadline passes', async () => {
    respond = () => {
      // Never answers.
    };
    const result = await transport({ deadlineMs: 300 }).send(sub, '{}', { ttl: 60, urgency: 'normal' });
    expect(result).toEqual({ ok: false, statusCode: null, reason: 'no answer within 300 ms' });
    await expect.poll(() => closed).toBe(1);
  });

  it('a 2xx settles as soon as its headers arrive, even when the body never ends', async () => {
    respond = (res) => {
      res.writeHead(201);
      drip(res, 'y', 20);
    };
    const result = await transport({ deadlineMs: 10_000 }).send(sub, '{}', { ttl: 60, urgency: 'normal' });
    expect(result).toEqual({ ok: true });
    await expect.poll(() => closed).toBe(1);
  });

  it('maps network errors to statusCode null', async () => {
    const gone = createServer();
    await new Promise<void>((resolve) => gone.listen(0, '127.0.0.1', resolve));
    const deadPort = (gone.address() as AddressInfo).port;
    await new Promise<void>((resolve) => gone.close(() => resolve()));
    const refused: RequestFn = (options, callback) =>
      httpRequest({ ...options, hostname: '127.0.0.1', port: deadPort }, callback);
    const result = await createWebPushTransport(vapid, { request: refused }).send(sub, '{}', {
      ttl: 60,
      urgency: 'normal',
    });
    expect(result).toMatchObject({ ok: false, statusCode: null });
    expect(result.ok === false && result.reason).toMatch(/ECONNREFUSED/);
  });

  it('never contacts an endpoint off the push services, whatever the stored row says', async () => {
    let requests = 0;
    const counting: RequestFn = (options, callback) => {
      requests++;
      return toLocal(options, callback);
    };
    const t = createWebPushTransport(vapid, { request: counting });
    for (const endpoint of [
      'https://127.0.0.1:2019/load',
      'https://victim.example/x',
      'http://web.push.apple.com/x',
    ]) {
      expect(await t.send({ ...sub, endpoint }, '{}', { ttl: 60, urgency: 'normal' })).toEqual({
        ok: false,
        statusCode: null,
        reason: 'not a known push service',
      });
    }
    expect(requests).toBe(0);
    expect(received).toEqual([]);
  });

  it('malformed browser keys fail without a request', async () => {
    const result = await transport().send({ ...sub, p256dh: 'p', auth: 'a' }, '{}', {
      ttl: 60,
      urgency: 'normal',
    });
    expect(result).toMatchObject({ ok: false, statusCode: null });
    expect(received).toEqual([]);
  });
});
