import { defaultSettings, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { getKv, KV } from '../src/db/kv';
import { createSubscriptionRepo } from '../src/push/subscriptions';
import { createTestServer, json } from './helpers';

const subscription = (n: number) => ({
  endpoint: `https://web.push.apple.com/QGx${n}`,
  expirationTime: null,
  keys: { p256dh: `p256dh-${n}`, auth: `auth-${n}` },
});

describe('push routes', () => {
  it('serves the VAPID public key', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const res = await s.call('/api/push/public-key', { cookie });
    expect(await json(res)).toEqual({ key: 'test-public-key' });
  });

  it('subscribes, upserts by endpoint and unsubscribes', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const repo = createSubscriptionRepo(s.db);

    expect(
      (await s.call('/api/push/subscribe', { cookie, body: { subscription: subscription(1) } })).status,
    ).toBe(200);
    const rotated = { ...subscription(1), keys: { p256dh: 'new-key', auth: 'new-auth' } };
    expect((await s.call('/api/push/subscribe', { cookie, body: { subscription: rotated } })).status).toBe(
      200,
    );
    expect(repo.all()).toEqual([{ endpoint: subscription(1).endpoint, p256dh: 'new-key', auth: 'new-auth' }]);

    const res = await s.call('/api/push/unsubscribe', {
      cookie,
      body: { endpoint: subscription(1).endpoint },
    });
    expect(res.status).toBe(200);
    expect(repo.all()).toEqual([]);
    // Unknown endpoints are fine (the device may unsubscribe twice).
    expect(
      (await s.call('/api/push/unsubscribe', { cookie, body: { endpoint: subscription(9).endpoint } }))
        .status,
    ).toBe(200);
  });

  it('follows the device time zone sent with the subscription', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/push/subscribe', {
      cookie,
      body: { subscription: subscription(1), timezone: 'Europe/Warsaw' },
    });
    const data = await json<AppData>(await s.call('/api/data', { cookie }));
    expect(data.settings).toEqual({ ...defaultSettings(), timezone: 'Europe/Warsaw' });
  });

  it('stores the canonical zone and leaves settings alone for an alias of the stored one', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const subscribe = (timezone: string) =>
      s.call('/api/push/subscribe', { cookie, body: { subscription: subscription(1), timezone } });
    const settings = async () => (await json<AppData>(await s.call('/api/data', { cookie }))).settings;

    // Chrome reports the legacy id for Kyiv: same zone as the default, nothing is written.
    expect((await subscribe('Europe/Kiev')).status).toBe(200);
    expect(getKv(s.db, KV.settings)).toBeNull();

    await subscribe('Europe/Warsaw');
    expect((await settings()).timezone).toBe('Europe/Warsaw');
    expect((await subscribe('Europe/Kiev')).status).toBe(200);
    expect((await settings()).timezone).toBe('Europe/Kyiv');

    // A stored legacy spelling is not rewritten by the same zone under its new name.
    await s.call('/api/ops', {
      cookie,
      body: { ops: [{ kind: 'settings.put', value: { ...defaultSettings(), timezone: 'Europe/Kiev' } }] },
    });
    const before = getKv(s.db, KV.settings);
    expect((await subscribe('Europe/Kyiv')).status).toBe(200);
    expect(getKv(s.db, KV.settings)).toBe(before);
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
      const res = await s.call('/api/push/subscribe', { cookie, body });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'bad_request' });
    }
  });

  it('sends a test notification to every device and reports deliveries', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    for (const n of [1, 2, 3])
      await s.call('/api/push/subscribe', { cookie, body: { subscription: subscription(n) } });
    s.transport.outcomes.set(subscription(2).endpoint, { ok: false, statusCode: 410, reason: 'HTTP 410' });
    s.transport.outcomes.set(subscription(3).endpoint, { ok: false, statusCode: 500, reason: 'HTTP 500' });

    const res = await s.call('/api/push/test', { method: 'POST', cookie });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, sent: 1 });
    expect(s.transport.sent).toHaveLength(3);
    expect(s.transport.sent[0]?.payload).toEqual({
      title: 'Легко',
      body: 'Сповіщення працюють ✨',
      url: '/reminders',
      tag: 'test',
    });

    // 410 Gone → subscription deleted; 500 → kept for the next attempt.
    const left = createSubscriptionRepo(s.db)
      .all()
      .map((x) => x.endpoint);
    expect(left).toEqual([subscription(1).endpoint, subscription(3).endpoint]);
  });

  it('removes subscriptions on 404 as well', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/push/subscribe', { cookie, body: { subscription: subscription(1) } });
    s.transport.outcomes.set(subscription(1).endpoint, { ok: false, statusCode: 404, reason: 'HTTP 404' });
    expect(await json(await s.call('/api/push/test', { method: 'POST', cookie }))).toEqual({
      ok: true,
      sent: 0,
    });
    expect(createSubscriptionRepo(s.db).all()).toEqual([]);
  });

  it('records last_ok_at on success', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/push/subscribe', { cookie, body: { subscription: subscription(1) } });
    await s.call('/api/push/test', { method: 'POST', cookie });
    const row = s.db.prepare('SELECT last_ok_at, user_agent FROM push_subscriptions').get();
    expect(row?.last_ok_at).toBe(s.clock.now);
  });

  it('answers 503 push_unavailable when push is not configured', async () => {
    const s = await createTestServer({ pushAvailable: false });
    const cookie = await s.login();
    const res = await s.call('/api/push/public-key', { cookie });
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'push_unavailable' });
    expect((await s.call('/api/push/test', { method: 'POST', cookie })).status).toBe(503);
  });
});
