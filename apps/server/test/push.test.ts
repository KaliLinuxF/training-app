import { API, defaultSettings, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import type { UserId } from '../src/db/users';
import { PUSH_TEST_LIMIT } from '../src/http/routes/push';
import { MAX_SUBSCRIPTIONS_PER_USER } from '../src/push/service';
import { createTestServer, json, type TestServer } from './helpers';

const subscription = (n: number, keys: { p256dh?: string; auth?: string } = {}) => ({
  endpoint: `https://web.push.apple.com/QGx${n}`,
  expirationTime: null,
  keys: { p256dh: keys.p256dh ?? `p256dh-${n}`, auth: keys.auth ?? `auth-${n}` },
});

const endpointsOf = (s: TestServer, id: UserId): string[] =>
  s.subscriptions
    .forUser(id)
    .all()
    .map((x) => x.endpoint);

/** The stored settings JSON of a user (null = never saved: defaults). */
const storedSettings = (s: TestServer, id: UserId): unknown =>
  s.db.prepare('SELECT value FROM user_settings WHERE user_id = ?').get(id)?.value ?? null;

describe('push routes', () => {
  it('serves the VAPID public key', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const res = await s.call(API.pushKey, { cookie });
    expect(await json(res)).toEqual({ key: 'test-public-key' });
  });

  it('subscribes as the signed-in user, upserts by endpoint and unsubscribes', async () => {
    const s = await createTestServer();
    const cookie = await s.login();

    expect(
      (await s.call(API.pushSubscribe, { cookie, body: { subscription: subscription(1) } })).status,
    ).toBe(200);
    // Her own endpoint again with rotated keys (iOS re-subscribes): replaced in place.
    const rotated = subscription(1, { p256dh: 'new-key', auth: 'new-auth' });
    expect((await s.call(API.pushSubscribe, { cookie, body: { subscription: rotated } })).status).toBe(200);
    expect(s.subscriptions.forUser(s.anna.id).all()).toEqual([
      { endpoint: subscription(1).endpoint, p256dh: 'new-key', auth: 'new-auth' },
    ]);
    expect(endpointsOf(s, s.admin.id)).toEqual([]);

    const res = await s.call(API.pushUnsubscribe, { cookie, body: { endpoint: subscription(1).endpoint } });
    expect(res.status).toBe(200);
    expect(endpointsOf(s, s.anna.id)).toEqual([]);
    // Unknown endpoints are fine (the device may unsubscribe twice).
    expect(
      (await s.call(API.pushUnsubscribe, { cookie, body: { endpoint: subscription(9).endpoint } })).status,
    ).toBe(200);
  });

  it('small routes still take realistic bodies (a 1900-character endpoint, 200-character keys)', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const big = {
      endpoint: `https://web.push.apple.com/${'Q'.repeat(1900)}`,
      keys: { p256dh: 'p'.repeat(200), auth: 'a'.repeat(100) },
    };
    const res = await s.call(API.pushSubscribe, {
      cookie,
      body: { subscription: big, timezone: 'Europe/Kyiv' },
    });
    expect(res.status).toBe(200);
    expect(endpointsOf(s, s.anna.id)).toEqual([big.endpoint]);
    const gone = await s.call(API.pushUnsubscribe, {
      cookie,
      body: { endpoint: big.endpoint, auth: big.keys.auth },
    });
    expect(gone.status).toBe(200);
    expect(endpointsOf(s, s.anna.id)).toEqual([]);
  });

  it('follows the device time zone sent with the subscription (the caller’s settings only)', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call(API.pushSubscribe, {
      cookie,
      body: { subscription: subscription(1), timezone: 'Europe/Warsaw' },
    });
    const data = await json<AppData>(await s.call(API.data, { cookie }));
    expect(data.settings).toEqual({ ...defaultSettings(), timezone: 'Europe/Warsaw' });
    expect(storedSettings(s, s.admin.id)).toBeNull();
  });

  it('stores the canonical zone and leaves settings alone for an alias of the stored one', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const subscribe = (timezone: string) =>
      s.call(API.pushSubscribe, { cookie, body: { subscription: subscription(1), timezone } });
    const settings = async () => (await json<AppData>(await s.call(API.data, { cookie }))).settings;

    // Chrome reports the legacy id for Kyiv: same zone as the default, nothing is written.
    expect((await subscribe('Europe/Kiev')).status).toBe(200);
    expect(storedSettings(s, s.anna.id)).toBeNull();

    await subscribe('Europe/Warsaw');
    expect((await settings()).timezone).toBe('Europe/Warsaw');
    expect((await subscribe('Europe/Kiev')).status).toBe(200);
    expect((await settings()).timezone).toBe('Europe/Kyiv');

    // A stored legacy spelling is not rewritten by the same zone under its new name.
    await s.call(API.ops, {
      cookie,
      body: { ops: [{ kind: 'settings.put', value: { ...defaultSettings(), timezone: 'Europe/Kiev' } }] },
    });
    const before = storedSettings(s, s.anna.id);
    expect((await subscribe('Europe/Kyiv')).status).toBe(200);
    expect(storedSettings(s, s.anna.id)).toBe(before);
  });

  it('validates subscriptions', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    for (const body of [
      {},
      { subscription: { endpoint: 'not a url', keys: { p256dh: 'a', auth: 'b' } } },
      { subscription: { ...subscription(1), keys: { p256dh: '', auth: 'b' } } },
      { subscription: { ...subscription(1), endpoint: 'http://push.example/insecure' } },
      { subscription: subscription(1), timezone: 'Mars/Base' },
    ]) {
      const res = await s.call(API.pushSubscribe, { cookie, body });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'bad_request' });
    }
    for (const body of [{}, { endpoint: subscription(1).endpoint, auth: '' }, { endpoint: 'x', auth: 'a' }]) {
      const res = await s.call(API.pushUnsubscribe, { cookie, body });
      expect(res.status).toBe(400);
    }
    expect(endpointsOf(s, s.anna.id)).toEqual([]);
  });

  it('accepts only the browsers’ push services: no IP literals, internal hosts, other ports or user info', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    for (const endpoint of [
      'https://127.0.0.1:2019/load',
      'https://127.0.0.1/load',
      'https://[::1]/x',
      'https://10.0.0.5/x',
      'https://localhost/x',
      'https://victim.example/x',
      'https://web.push.apple.com.victim.example/x',
      'https://web.push.apple.com:8443/x',
      'https://user@web.push.apple.com/x',
    ]) {
      const res = await s.call(API.pushSubscribe, {
        cookie,
        body: { subscription: { ...subscription(1), endpoint }, timezone: 'Asia/Tokyo' },
      });
      expect(res.status, endpoint).toBe(400);
      expect(await json(res)).toEqual({
        error: 'bad_request',
        message: 'Цей сервіс сповіщень не підтримується',
      });
    }
    expect(endpointsOf(s, s.anna.id)).toEqual([]);
    expect(storedSettings(s, s.anna.id)).toBeNull();
    // Nothing to send to, so nothing left the server.
    expect(await json(await s.call(API.pushTest, { method: 'POST', cookie }))).toEqual({ ok: true, sent: 0 });
    expect(s.transport.sent).toEqual([]);

    for (const endpoint of [
      'https://fcm.googleapis.com/fcm/send/abc',
      'https://updates.push.services.mozilla.com/wpush/v2/abc',
      'https://wns2-par02p.notify.windows.com/w/?token=abc',
    ]) {
      const res = await s.call(API.pushSubscribe, {
        cookie,
        body: { subscription: { ...subscription(1), endpoint } },
      });
      expect(res.status, endpoint).toBe(200);
    }
  });

  it(`keeps at most ${MAX_SUBSCRIPTIONS_PER_USER} devices per account, forgetting the oldest; others are untouched`, async () => {
    const s = await createTestServer();
    const anna = await s.login('anna');
    const olya = await s.createUser('olya');
    await s.call(API.pushSubscribe, { cookie: olya.cookie, body: { subscription: subscription(100) } });
    const subscribe = async (n: number) => {
      s.clock.now += 1000;
      expect(
        (await s.call(API.pushSubscribe, { cookie: anna, body: { subscription: subscription(n) } })).status,
      ).toBe(200);
    };
    for (let n = 1; n <= MAX_SUBSCRIPTIONS_PER_USER; n++) await subscribe(n);
    expect(endpointsOf(s, s.anna.id)).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);

    // Her oldest device re-subscribing (rotated keys) is not a new one: nothing is forgotten.
    await subscribe(1);
    expect(endpointsOf(s, s.anna.id)).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
    expect(endpointsOf(s, s.anna.id)).toContain(subscription(1).endpoint);

    await subscribe(11);
    await subscribe(12);
    const kept = endpointsOf(s, s.anna.id);
    expect(kept).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
    expect(kept).not.toContain(subscription(1).endpoint);
    expect(kept).not.toContain(subscription(2).endpoint);
    expect(kept).toContain(subscription(12).endpoint);
    expect(endpointsOf(s, olya.id)).toEqual([subscription(100).endpoint]);

    // So one test push is at most that many requests.
    await s.call(API.pushTest, { method: 'POST', cookie: anna });
    expect(s.transport.sent).toHaveLength(MAX_SUBSCRIPTIONS_PER_USER);
  });

  it('a send reaches at most the newest devices even when more rows were stored before the cap', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const rows = s.subscriptions.forUser(s.anna.id);
    for (let n = 1; n <= 30; n++)
      rows.upsert({ endpoint: subscription(n).endpoint, p256dh: 'p', auth: `a${n}` }, null, n);
    expect(await json(await s.call(API.pushTest, { method: 'POST', cookie }))).toEqual({
      ok: true,
      sent: MAX_SUBSCRIPTIONS_PER_USER,
    });
    expect(s.transport.sent.map((x) => x.endpoint).sort()).toEqual(
      Array.from({ length: MAX_SUBSCRIPTIONS_PER_USER }, (_, i) => subscription(21 + i).endpoint).sort(),
    );
  });

  it('throttles test notifications per account (every attempt counts); others keep theirs', async () => {
    const s = await createTestServer();
    const anna = await s.login('anna');
    const olya = await s.createUser('olya');
    await s.call(API.pushSubscribe, { cookie: anna, body: { subscription: subscription(1) } });
    for (let i = 0; i < PUSH_TEST_LIMIT.maxFailures; i++)
      expect((await s.call(API.pushTest, { method: 'POST', cookie: anna })).status).toBe(200);
    const limited = await s.call(API.pushTest, { method: 'POST', cookie: anna });
    expect(limited.status).toBe(429);
    expect(await json(limited)).toEqual({
      error: 'rate_limited',
      message: 'Забагато спроб. Спробуй пізніше',
    });
    expect(Number(limited.headers.get('Retry-After'))).toBeGreaterThan(0);
    expect(s.transport.sent).toHaveLength(PUSH_TEST_LIMIT.maxFailures);

    expect((await s.call(API.pushTest, { method: 'POST', cookie: olya.cookie })).status).toBe(200);
    s.clock.now += PUSH_TEST_LIMIT.windowMs;
    expect((await s.call(API.pushTest, { method: 'POST', cookie: anna })).status).toBe(200);
  });

  it('sends a test notification to every device of the caller and reports deliveries', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    for (const n of [1, 2, 3])
      await s.call(API.pushSubscribe, { cookie, body: { subscription: subscription(n) } });
    s.transport.outcomes.set(subscription(2).endpoint, { ok: false, statusCode: 410, reason: 'HTTP 410' });
    s.transport.outcomes.set(subscription(3).endpoint, { ok: false, statusCode: 500, reason: 'HTTP 500' });

    const res = await s.call(API.pushTest, { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, sent: 1 });
    expect(s.transport.sent).toHaveLength(3);
    expect(s.transport.sent[0]?.payload).toEqual({
      title: 'Легко',
      body: 'Сповіщення працюють ✨',
      url: '/settings/reminders',
      tag: 'test',
    });
    expect(s.transport.sent[0]?.options).toMatchObject({ ttl: 600 });

    // 410 Gone → subscription deleted; 500 → kept for the next attempt.
    expect(endpointsOf(s, s.anna.id)).toEqual([subscription(1).endpoint, subscription(3).endpoint]);
  });

  it('removes subscriptions on 404 as well', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call(API.pushSubscribe, { cookie, body: { subscription: subscription(1) } });
    s.transport.outcomes.set(subscription(1).endpoint, { ok: false, statusCode: 404, reason: 'HTTP 404' });
    expect(await json(await s.call(API.pushTest, { method: 'POST', cookie }))).toEqual({ ok: true, sent: 0 });
    expect(endpointsOf(s, s.anna.id)).toEqual([]);
  });

  it('records last_ok_at on success', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call(API.pushSubscribe, { cookie, body: { subscription: subscription(1) } });
    await s.call(API.pushTest, { method: 'POST', cookie });
    const row = s.db.prepare('SELECT last_ok_at, user_id FROM push_subscriptions').get();
    expect(row).toEqual({ last_ok_at: s.clock.now, user_id: s.anna.id });
  });

  it('answers 503 push_unavailable when push is not configured', async () => {
    const s = await createTestServer({ pushAvailable: false });
    const cookie = await s.login();
    const res = await s.call(API.pushKey, { cookie });
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'push_unavailable' });
    expect((await s.call(API.pushTest, { method: 'POST', cookie })).status).toBe(503);
    expect(
      (await s.call(API.pushSubscribe, { cookie, body: { subscription: subscription(1) } })).status,
    ).toBe(503);
    expect(
      (await s.call(API.pushUnsubscribe, { cookie, body: { endpoint: subscription(1).endpoint } })).status,
    ).toBe(503);
  });

  it('every push route requires a session', async () => {
    const s = await createTestServer();
    for (const [path, body] of [
      [API.pushKey, undefined],
      [API.pushSubscribe, { subscription: subscription(1) }],
      [API.pushUnsubscribe, { endpoint: subscription(1).endpoint }],
      [API.pushTest, {}],
    ] as const) {
      const res = await s.call(path, { body });
      expect(res.status, path).toBe(401);
    }
    expect(s.transport.sent).toEqual([]);
  });
});

describe('push subscriptions per user (D15)', () => {
  it('an endpoint another user owns cannot be taken with different keys: 403, row and timezone untouched', async () => {
    const s = await createTestServer();
    const anna = await s.login('anna');
    const olya = await s.createUser('olya');
    await s.call(API.pushSubscribe, { cookie: anna, body: { subscription: subscription(1) } });

    const res = await s.call(API.pushSubscribe, {
      cookie: olya.cookie,
      body: { subscription: subscription(1, { auth: 'guessed-auth' }), timezone: 'Asia/Tokyo' },
    });
    expect(res.status).toBe(403);
    expect(await json(res)).toEqual({ error: 'forbidden', message: 'Немає доступу' });
    expect(s.subscriptions.forUser(s.anna.id).all()).toEqual([
      { endpoint: subscription(1).endpoint, p256dh: 'p256dh-1', auth: 'auth-1' },
    ]);
    expect(endpointsOf(s, olya.id)).toEqual([]);
    expect(storedSettings(s, olya.id)).toBeNull();
  });

  it('the same browser subscription (same auth) moves to whoever signs in on that device', async () => {
    const s = await createTestServer();
    const anna = await s.login('anna');
    const olya = await s.createUser('olya');
    await s.call(API.pushSubscribe, { cookie: anna, body: { subscription: subscription(1) } });
    const moved = await s.call(API.pushSubscribe, {
      cookie: olya.cookie,
      body: { subscription: subscription(1), timezone: 'Europe/Warsaw' },
    });
    expect(moved.status).toBe(200);
    expect(endpointsOf(s, s.anna.id)).toEqual([]);
    expect(endpointsOf(s, olya.id)).toEqual([subscription(1).endpoint]);
    expect(s.data.forUser(olya.id).settings().timezone).toBe('Europe/Warsaw');
    expect(s.data.forUser(s.anna.id).settings().timezone).toBe('Europe/Kyiv');
  });

  it('unsubscribe without auth removes only the caller’s row; with the matching auth, whoever owns it', async () => {
    const s = await createTestServer();
    const anna = await s.login('anna');
    const olya = await s.createUser('olya');
    await s.call(API.pushSubscribe, { cookie: anna, body: { subscription: subscription(1) } });

    // An old client (no auth) or a wrong key: anna's row stays.
    for (const body of [
      { endpoint: subscription(1).endpoint },
      { endpoint: subscription(1).endpoint, auth: 'wrong-auth' },
    ]) {
      expect((await s.call(API.pushUnsubscribe, { cookie: olya.cookie, body })).status).toBe(200);
      expect(endpointsOf(s, s.anna.id)).toEqual([subscription(1).endpoint]);
    }
    // After a switch on the same browser the new user's client sends the subscription's own key.
    const res = await s.call(API.pushUnsubscribe, {
      cookie: olya.cookie,
      body: { endpoint: subscription(1).endpoint, auth: 'auth-1' },
    });
    expect(res.status).toBe(200);
    expect(endpointsOf(s, s.anna.id)).toEqual([]);
  });

  it('the test push reaches only the caller’s devices', async () => {
    const s = await createTestServer();
    const anna = await s.login('anna');
    const olya = await s.createUser('olya');
    await s.call(API.pushSubscribe, { cookie: anna, body: { subscription: subscription(1) } });
    await s.call(API.pushSubscribe, { cookie: olya.cookie, body: { subscription: subscription(2) } });
    await s.call(API.pushSubscribe, { cookie: olya.cookie, body: { subscription: subscription(3) } });

    expect(await json(await s.call(API.pushTest, { method: 'POST', cookie: olya.cookie }))).toEqual({
      ok: true,
      sent: 2,
    });
    expect(s.transport.sent.map((x) => x.endpoint).sort()).toEqual([
      subscription(2).endpoint,
      subscription(3).endpoint,
    ]);
    expect(s.push.recipients().sort()).toEqual([s.anna.id, olya.id].sort());
  });
});
