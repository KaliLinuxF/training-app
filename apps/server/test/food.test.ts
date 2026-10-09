import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultSettings,
  photoIdSchema,
  photoThumbUrl,
  photoUrl,
  type FoodEstimateResponse,
  type FoodStatusResponse,
} from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  FoodAiError,
  type FoodEstimate,
  type FoodEstimateInput,
  type FoodEstimator,
} from '../src/food/estimator';
import { createPhotoStore, PHOTO_GC_GRACE_MS, PHOTO_MAX_BYTES } from '../src/photos/store';
import { createTestServer, fakeJpeg, json, type TestServerOptions } from './helpers';

const DAY_MS = 24 * 3600_000;
const ESTIMATE = '/api/food/estimate';
const STATUS = '/api/food/status';

const result: FoodEstimate = {
  items: [
    { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320 },
    { name: 'Кава з молоком', portion: '1 чашка (250 мл)', kcal: 60 },
  ],
  comment: 'Порцію вівсянки оцінено приблизно',
};

interface FakeEstimator extends FoodEstimator {
  inputs: FoodEstimateInput[];
  /** What the next calls do; default: resolve with `result`. */
  next: (() => FoodEstimate | Promise<FoodEstimate>) | null;
}

function fakeEstimator(): FakeEstimator {
  const fake: FakeEstimator = {
    inputs: [],
    next: null,
    async estimate(input) {
      fake.inputs.push(input);
      return fake.next ? fake.next() : result;
    },
  };
  return fake;
}

const full = fakeJpeg(40_000, 1);
const thumb = fakeJpeg(4_000, 2);
const image = { full: full.toString('base64'), thumb: thumb.toString('base64') };

let photosRoot: string;
beforeEach(() => {
  photosRoot = mkdtempSync(join(tmpdir(), 'legko-food-'));
});
afterEach(() => {
  rmSync(photosRoot, { recursive: true, force: true });
});

async function setup(options: TestServerOptions = {}) {
  const estimator = fakeEstimator();
  const photosDir = join(photosRoot, 'photos');
  const s = await createTestServer({ estimator, photosDir, ...options });
  const cookie = await s.login();
  const estimate = (body: unknown, extra: { cookie?: string | null; origin?: string | null } = {}) =>
    s.call(ESTIMATE, { cookie, body, ...extra });
  const status = async () => json<FoodStatusResponse>(await s.call(STATUS, { cookie }));
  const photoRows = (): number => Number(s.db.prepare('SELECT COUNT(*) AS n FROM photos').get()?.n);
  return { s, cookie, estimator, photosDir, estimate, status, photoRows };
}

describe('GET /api/food/status', () => {
  it('is disabled without an API key (no estimator)', async () => {
    const { status } = await setup({ estimator: null });
    expect(await status()).toEqual({ enabled: false, remainingToday: 60 });
  });

  it('is enabled with an estimator and reports the remaining budget', async () => {
    const { status, estimate } = await setup({ foodDailyLimit: 5 });
    expect(await status()).toEqual({ enabled: true, remainingToday: 5 });
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(200);
    expect(await status()).toEqual({ enabled: true, remainingToday: 4 });
  });

  it('requires a session', async () => {
    const { s } = await setup();
    const res = await s.call(STATUS);
    expect(res.status).toBe(401);
    expect(await json(res)).toMatchObject({ error: 'unauthorized' });
  });
});

describe('POST /api/food/estimate', () => {
  it('estimates a text description', async () => {
    const { estimate, estimator, photosDir } = await setup();
    const res = await estimate({ date: '2026-10-09', text: '  вівсянка з бананом, кава з молоком ' });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await json<FoodEstimateResponse>(res)).toEqual({
      photoId: null,
      items: result.items,
      totalKcal: 380,
      comment: result.comment,
    });
    expect(estimator.inputs).toEqual([{ text: 'вівсянка з бананом, кава з молоком', imageBase64: null }]);
    expect(existsSync(photosDir)).toBe(false);
  });

  it('stores the photo before calling the model and returns its id', async () => {
    const { s, cookie, estimate, estimator, photosDir, photoRows } = await setup();
    estimator.next = () => {
      // The files and the row already exist while the model runs.
      expect(readdirSync(photosDir)).toHaveLength(2);
      expect(photoRows()).toBe(1);
      return result;
    };
    const res = await estimate({ date: '2026-10-08', text: 'обід', image });
    expect(res.status).toBe(200);
    const body = await json<FoodEstimateResponse>(res);
    expect(photoIdSchema.safeParse(body.photoId).success).toBe(true);
    expect(body.photoId).toHaveLength(22);
    const id = body.photoId ?? '';
    expect(readdirSync(photosDir).sort()).toEqual([`${id}.jpg`, `${id}_t.jpg`].sort());
    expect(s.db.prepare('SELECT date, bytes, thumb_bytes FROM photos WHERE id = ?').get(id)).toEqual({
      date: '2026-10-08',
      bytes: full.length,
      thumb_bytes: thumb.length,
    });
    expect(estimator.inputs).toEqual([{ text: 'обід', imageBase64: image.full }]);

    // Served back exactly, with long-lived private caching.
    for (const [url, bytes] of [
      [photoUrl(id), full],
      [photoThumbUrl(id), thumb],
    ] as const) {
      const photo = await s.call(url, { cookie });
      expect(photo.status).toBe(200);
      expect(photo.headers.get('Content-Type')).toBe('image/jpeg');
      expect(photo.headers.get('Cache-Control')).toBe('private, max-age=31536000, immutable');
      expect(photo.headers.get('X-Content-Type-Options')).toBe('nosniff');
      expect(Buffer.from(await photo.arrayBuffer()).equals(bytes)).toBe(true);
    }
  });

  it('accepts a photo without text', async () => {
    const { estimate, estimator } = await setup();
    const res = await estimate({ date: '2026-10-09', image });
    expect(res.status).toBe(200);
    expect(estimator.inputs[0]).toEqual({ text: '', imageBase64: image.full });
  });

  it.each([
    ['neither text nor photo', { date: '2026-10-09' }],
    ['blank text', { date: '2026-10-09', text: '   ' }],
    ['bad date', { date: '2026-02-30', text: 'борщ' }],
    ['text too long', { date: '2026-10-09', text: 'б'.repeat(1001) }],
    ['not base64', { date: '2026-10-09', image: { full: 'not base64 at all!', thumb: image.thumb } }],
    ['thumbnail missing', { date: '2026-10-09', image: { full: image.full } }],
  ])('rejects %s with bad_request', async (_name, body) => {
    const { estimate, estimator, status } = await setup();
    const res = await estimate(body);
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'bad_request' });
    expect(estimator.inputs).toHaveLength(0);
    expect((await status()).remainingToday).toBe(60);
  });

  it('rejects invalid JSON', async () => {
    const { estimate } = await setup();
    const res = await estimate('{"date": ');
    expect(res.status).toBe(400);
  });

  it('accepts only JPEG photos (magic bytes FF D8 FF)', async () => {
    const { estimate, estimator, photoRows } = await setup();
    const png = Buffer.from('\x89PNG\r\n\x1a\n0000000000000000', 'latin1').toString('base64');
    for (const img of [
      { full: png, thumb: image.thumb },
      { full: image.full, thumb: png },
    ]) {
      const res = await estimate({ date: '2026-10-09', image: img });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'bad_request' });
    }
    expect(estimator.inputs).toHaveLength(0);
    expect(photoRows()).toBe(0);
  });

  it('413 payload_too_large for a photo over 2 MB decoded or a body over the route limit', async () => {
    const { estimate, estimator, photoRows, status } = await setup();
    const big = { full: fakeJpeg(PHOTO_MAX_BYTES + 1).toString('base64'), thumb: image.thumb };
    const tooBig = await estimate({ date: '2026-10-09', image: big });
    expect(tooBig.status).toBe(413);
    expect(await json(tooBig)).toMatchObject({ error: 'payload_too_large' });

    const huge = await estimate(`{"date":"2026-10-09","text":"${'x'.repeat(4 * 1024 * 1024)}"}`);
    expect(huge.status).toBe(413);
    expect(await json(huge)).toMatchObject({ error: 'payload_too_large' });

    expect(estimator.inputs).toHaveLength(0);
    expect(photoRows()).toBe(0);
    expect((await status()).remainingToday).toBe(60);
  });

  it('allows ~3.5 MB request bodies (largest photo the schema accepts)', async () => {
    const { estimate } = await setup();
    const fullB64 = fakeJpeg(PHOTO_MAX_BYTES).toString('base64');
    const thumbB64 = fakeJpeg(290 * 1024).toString('base64');
    const body = JSON.stringify({
      date: '2026-10-09',
      text: 'й'.repeat(1000),
      image: { full: fullB64, thumb: thumbB64 },
    });
    expect(body.length).toBeGreaterThan(3_100_000);
    expect((await estimate(body)).status).toBe(200);
  });

  it('answers 503 ai_unavailable when the feature is disabled', async () => {
    const { estimate, photoRows } = await setup({ estimator: null });
    const res = await estimate({ date: '2026-10-09', text: 'борщ', image });
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'ai_unavailable' });
    expect(photoRows()).toBe(0);
  });

  it('requires a session and passes the mutation guard', async () => {
    const { estimate } = await setup();
    const anon = await estimate({ date: '2026-10-09', text: 'борщ' }, { cookie: null });
    expect(anon.status).toBe(401);
    const foreign = await estimate({ date: '2026-10-09', text: 'борщ' }, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(await json(foreign)).toMatchObject({ error: 'forbidden_origin' });
  });

  it.each([
    ['ai_unavailable', 503],
    ['ai_failed', 502],
  ] as const)('maps FoodAiError %s to %i', async (code, httpStatus) => {
    const { estimate, estimator, photoRows } = await setup();
    estimator.next = () => {
      throw new FoodAiError(code, 'test');
    };
    const res = await estimate({ date: '2026-10-09', text: 'борщ', image });
    expect(res.status).toBe(httpStatus);
    expect(await json(res)).toEqual({ error: code, message: expect.any(String) });
    // The photo was stored first; nothing references it, so the daily clean-up will remove it.
    expect(photoRows()).toBe(1);
  });

  it('unexpected estimator errors are 500 internal', async () => {
    const { estimate, estimator } = await setup();
    estimator.next = () => {
      throw new Error('bug');
    };
    const res = await estimate({ date: '2026-10-09', text: 'борщ' });
    expect(res.status).toBe(500);
    expect(await json(res)).toMatchObject({ error: 'internal' });
  });
});

describe('daily estimate budget', () => {
  it('429 rate_limited once the limit is used, counting failed calls too', async () => {
    const { estimate, estimator, status, photoRows } = await setup({ foodDailyLimit: 2 });
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(200);
    estimator.next = () => {
      throw new FoodAiError('ai_failed', 'test');
    };
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(502);
    expect(await status()).toEqual({ enabled: true, remainingToday: 0 });

    const res = await estimate({ date: '2026-10-09', text: 'борщ', image });
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({
      error: 'rate_limited',
      message: 'Ліміт підрахунків на сьогодні вичерпано',
    });
    // 12:00 in Kyiv: 12 hours until the budget renews.
    expect(res.headers.get('Retry-After')).toBe(String(12 * 3600));
    expect(estimator.inputs).toHaveLength(2);
    expect(photoRows()).toBe(0);
  });

  it('renews at midnight Kyiv time', async () => {
    const { s, estimate, status } = await setup({ foodDailyLimit: 1 });
    s.clock.now = Date.UTC(2026, 9, 9, 20, 59); // 23:59 in Kyiv
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(200);
    const limited = await estimate({ date: '2026-10-09', text: 'борщ' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    s.clock.now = Date.UTC(2026, 9, 9, 21, 1); // 00:01 on Oct 10 in Kyiv
    expect(await status()).toEqual({ enabled: true, remainingToday: 1 });
    expect((await estimate({ date: '2026-10-10', text: 'борщ' })).status).toBe(200);
  });

  it('changing settings.timezone (ops or push subscribe) does not open a fresh budget', async () => {
    const { s, cookie, estimate, estimator, status } = await setup({ foodDailyLimit: 1 });
    s.clock.now = Date.UTC(2026, 9, 9, 20, 0); // 23:00 in Kyiv
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(200);

    // Kiritimati is already on Oct 10 and Pago Pago still on Oct 9 — neither is a new budget day.
    for (const timezone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York']) {
      const put = await s.call('/api/ops', {
        cookie,
        body: { ops: [{ kind: 'settings.put', value: { ...defaultSettings(), timezone } }] },
      });
      expect(put.status).toBe(200);
      expect(await status(), timezone).toEqual({ enabled: true, remainingToday: 0 });
      expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status, timezone).toBe(429);
    }
    await s.call('/api/push/subscribe', {
      cookie,
      body: {
        subscription: { endpoint: 'https://web.push.apple.com/x', keys: { p256dh: 'p', auth: 'a' } },
        timezone: 'Pacific/Kiritimati',
      },
    });
    expect((await estimate({ date: '2026-10-10', text: 'борщ' })).status).toBe(429);
    expect(estimator.inputs).toHaveLength(1);
  });
});

describe('GET /api/photos/:id', () => {
  it('requires a session', async () => {
    const { s, estimate } = await setup();
    const { photoId } = await json<FoodEstimateResponse>(await estimate({ date: '2026-10-09', image }));
    for (const url of [photoUrl(photoId ?? ''), photoThumbUrl(photoId ?? '')]) {
      const res = await s.call(url);
      expect(res.status).toBe(401);
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

  it('400 for a malformed id, 404 JSON for an unknown one', async () => {
    const { s, cookie } = await setup();
    for (const id of [
      'short',
      'has.dot.in.it.0000000000',
      `${'a'.repeat(41)}`,
      '..%2F..%2Flegko.db0000000',
    ]) {
      const res = await s.call(`/api/photos/${id}`, { cookie });
      expect(res.status, id).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'bad_request' });
    }
    for (const url of [photoUrl('AAAAAAAAAAAAAAAAAAAAAA'), photoThumbUrl('AAAAAAAAAAAAAAAAAAAAAA')]) {
      const res = await s.call(url, { cookie });
      expect(res.status).toBe(404);
      expect(res.headers.get('Content-Type')).toContain('application/json');
      expect(res.headers.get('Cache-Control')).toBe('no-store');
      expect(await json(res)).toMatchObject({ error: 'not_found' });
    }
  });
});

describe('photo garbage collection (end to end)', () => {
  it('removes estimate photos that never made it into a day, after 24 h', async () => {
    const { s, cookie, estimate, photosDir } = await setup();
    const used =
      (await json<FoodEstimateResponse>(await estimate({ date: '2026-10-09', image }))).photoId ?? '';
    const unused =
      (await json<FoodEstimateResponse>(await estimate({ date: '2026-10-09', image }))).photoId ?? '';
    await s.call('/api/ops', {
      cookie,
      body: {
        ops: [
          {
            kind: 'day.put',
            date: '2026-10-09',
            value: { food: 'Обід', kcal: 380, trained: null, types: [], notes: '', photos: [used] },
          },
        ],
      },
    });

    const store = createPhotoStore(s.db, photosDir);
    expect(store.collectGarbage(s.clock.now + DAY_MS / 2).photos).toEqual([]);
    expect(store.collectGarbage(s.clock.now + PHOTO_GC_GRACE_MS + 1).photos).toEqual([unused]);
    expect((await s.call(photoUrl(used), { cookie })).status).toBe(200);
    expect((await s.call(photoUrl(unused), { cookie })).status).toBe(404);
  });
});
