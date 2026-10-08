import webpush from 'web-push';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createWebPushTransport } from './transport';

const vapid = { subject: 'https://fit.triple-a.dev', ...webpush.generateVAPIDKeys() };
const sub = { endpoint: 'https://web.push.apple.com/QGx1', p256dh: 'p', auth: 'a' };

afterEach(() => vi.restoreAllMocks());

describe('web-push transport', () => {
  it('sends with VAPID, aes128gcm, TTL and urgency', async () => {
    const send = vi
      .spyOn(webpush, 'sendNotification')
      .mockResolvedValue({ statusCode: 201, body: '', headers: {} });
    const result = await createWebPushTransport(vapid).send(sub, '{"title":"x"}', {
      ttl: 60,
      urgency: 'high',
    });
    expect(result).toEqual({ ok: true });
    expect(send).toHaveBeenCalledWith(
      { endpoint: sub.endpoint, keys: { p256dh: 'p', auth: 'a' } },
      '{"title":"x"}',
      {
        vapidDetails: { subject: vapid.subject, publicKey: vapid.publicKey, privateKey: vapid.privateKey },
        TTL: 60,
        urgency: 'high',
        contentEncoding: 'aes128gcm',
        timeout: expect.any(Number),
      },
    );
  });

  it('maps push-service errors to a status code', async () => {
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(
      new webpush.WebPushError('Gone', 410, {}, '{"reason":"Unregistered"}', sub.endpoint),
    );
    const result = await createWebPushTransport(vapid).send(sub, '{}', { ttl: 60, urgency: 'normal' });
    expect(result).toEqual({ ok: false, statusCode: 410, reason: 'HTTP 410 {"reason":"Unregistered"}' });
  });

  it('maps network errors to statusCode null', async () => {
    vi.spyOn(webpush, 'sendNotification').mockRejectedValue(new Error('getaddrinfo ENOTFOUND'));
    const result = await createWebPushTransport(vapid).send(sub, '{}', { ttl: 60, urgency: 'normal' });
    expect(result).toEqual({ ok: false, statusCode: null, reason: 'getaddrinfo ENOTFOUND' });
  });
});
