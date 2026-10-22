import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  defaultSettings,
  LIMITS,
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
  type FoodRecalcInput,
  type FoodRecalculation,
} from '../src/food/estimator';
import { createPhotoStore, PHOTO_GC_GRACE_MS, PHOTO_MAX_BYTES } from '../src/photos/store';
import { createTestServer, fakeJpeg, json, type TestServerOptions } from './helpers';

const DAY_MS = 24 * 3600_000;
const ESTIMATE = '/api/food/estimate';
const STATUS = '/api/food/status';

const result: FoodEstimate = {
  items: [
    { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, protein: 9, fat: 6, carbs: 58 },
    { name: 'Кава з молоком', portion: '1 чашка (250 мл)', kcal: 60, protein: 3, fat: 3, carbs: 5 },
  ],
  comment: 'Порцію вівсянки оцінено приблизно',
};

/** Default recalculation macros by position: 10 / 1 / 20 g, 20 / 2 / 40 g, … */
const recalcMacros = (i: number) => ({ protein: 10 * (i + 1), fat: i + 1, carbs: 20 * (i + 1) });

interface FakeEstimator extends FoodEstimator {
  inputs: FoodEstimateInput[];
  /** What the next calls do; default: resolve with `result`. */
  next: (() => FoodEstimate | Promise<FoodEstimate>) | null;
  recalcInputs: FoodRecalcInput[];
  /** What the next recalculations do; default: 100, 200, 300… kcal (and `recalcMacros`) by position. */
  nextRecalc: ((input: FoodRecalcInput) => FoodRecalculation | Promise<FoodRecalculation>) | null;
}

function fakeEstimator(): FakeEstimator {
  const fake: FakeEstimator = {
    inputs: [],
    next: null,
    recalcInputs: [],
    nextRecalc: null,
    async estimate(input) {
      fake.inputs.push(input);
      return fake.next ? fake.next() : result;
    },
    async recalculate(input) {
      fake.recalcInputs.push(input);
      if (fake.nextRecalc) return fake.nextRecalc(input);
      return {
        kcal: input.items.map((_, i) => 100 * (i + 1)),
        macros: input.items.map((_, i) => recalcMacros(i)),
        comment: 'Перераховано',
      };
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

/** The default AI limits of the server (config `FOOD_USER_DAILY_LIMIT` / `FOOD_DAILY_LIMIT`). */
const limits = (perUser: number, global = 150): TestServerOptions => ({ aiLimits: { perUser, global } });

async function setup(options: TestServerOptions = {}) {
  const estimator = fakeEstimator();
  const photosDir = join(photosRoot, 'photos');
  const s = await createTestServer({ estimator, photosDir, ...options });
  const cookie = await s.login();
  const estimate = (body: unknown, extra: { cookie?: string | null; origin?: string | null } = {}) =>
    s.call(ESTIMATE, { cookie, body, ...extra });
  const status = async (as: string = cookie) =>
    json<FoodStatusResponse>(await s.call(STATUS, { cookie: as }));
  const photoRows = (): number => Number(s.db.prepare('SELECT COUNT(*) AS n FROM photos').get()?.n);
  return { s, cookie, estimator, photosDir, estimate, status, photoRows };
}

describe('GET /api/food/status', () => {
  it('is disabled without an API key (no estimator)', async () => {
    const { status } = await setup({ estimator: null });
    expect(await status()).toEqual({ enabled: false, remainingToday: 40, limitToday: 40 });
  });

  it('is enabled with an estimator and reports her remaining budget and her limit', async () => {
    const { status, estimate } = await setup(limits(5));
    expect(await status()).toEqual({ enabled: true, remainingToday: 5, limitToday: 5 });
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(200);
    expect(await status()).toEqual({ enabled: true, remainingToday: 4, limitToday: 5 });
  });

  it('limitToday is her own limit: a per-user override, else the admin-saved default, else the config', async () => {
    const { s, status } = await setup(limits(5));
    s.budget.setLimits({ perUser: 7, global: 150 });
    expect(await status()).toEqual({ enabled: true, remainingToday: 7, limitToday: 7 });
    s.users.setAiLimit(s.anna.id, 3);
    expect(await status()).toEqual({ enabled: true, remainingToday: 3, limitToday: 3 });
    // remainingToday is the smaller of hers and everybody's.
    s.budget.setLimits({ perUser: 7, global: 2 });
    expect(await status()).toEqual({ enabled: true, remainingToday: 2, limitToday: 3 });
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
      // Cached per session cookie; no validators, so a cookie mismatch is never answered with a 304.
      expect(photo.headers.get('Vary')).toBe('Cookie');
      expect(photo.headers.get('ETag')).toBeNull();
      expect(photo.headers.get('Last-Modified')).toBeNull();
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
    expect((await status()).remainingToday).toBe(40);
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
    expect((await status()).remainingToday).toBe(40);
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

describe('POST /api/food/estimate (recalculate mode)', () => {
  const DATE = '2026-10-09';
  const UNKNOWN_PHOTO = 'AAAAAAAAAAAAAAAAAAAAAA';
  /** What she corrected on the result card: a different dish and grams, a drink without a portion. */
  const corrected = [
    { name: 'Вівсянка на молоці з бананом', portion: '300 г' },
    { name: 'Кава без цукру', portion: '' },
  ];

  it('prices her corrected items without a photo and echoes them verbatim, in order', async () => {
    const { estimate, estimator, photoRows } = await setup();
    const res = await estimate({
      date: DATE,
      items: [
        { name: '  Вівсянка на молоці з бананом ', portion: ' 300 г ' },
        { name: 'Кава без цукру', portion: '' },
      ],
    });
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(await json<FoodEstimateResponse>(res)).toEqual({
      photoId: null,
      items: [
        { name: 'Вівсянка на молоці з бананом', portion: '300 г', kcal: 100, ...recalcMacros(0) },
        { name: 'Кава без цукру', portion: '', kcal: 200, ...recalcMacros(1) },
      ],
      totalKcal: 300,
      comment: 'Перераховано',
    });
    expect(estimator.recalcInputs).toEqual([{ items: corrected, imageBase64: null }]);
    expect(estimator.inputs).toHaveLength(0);
    expect(photoRows()).toBe(0);
  });

  it('sends the stored photo for context and returns its id without storing it again', async () => {
    const { estimate, estimator, photosDir, photoRows } = await setup();
    const id = (await json<FoodEstimateResponse>(await estimate({ date: DATE, image }))).photoId ?? '';
    expect(photoRows()).toBe(1);

    const res = await estimate({ date: DATE, items: corrected, photoId: id });
    expect(res.status).toBe(200);
    const body = await json<FoodEstimateResponse>(res);
    expect(body.photoId).toBe(id);
    expect(body.items).toEqual([
      { ...corrected[0], kcal: 100, ...recalcMacros(0) },
      { ...corrected[1], kcal: 200, ...recalcMacros(1) },
    ]);
    expect(estimator.recalcInputs).toEqual([{ items: corrected, imageBase64: image.full }]);
    expect(photoRows()).toBe(1);
    expect(readdirSync(photosDir).sort()).toEqual([`${id}.jpg`, `${id}_t.jpg`].sort());
  });

  it('does not use text: items mean recalculation', async () => {
    const { estimate, estimator } = await setup();
    expect((await estimate({ date: DATE, text: 'вівсянка', items: corrected })).status).toBe(200);
    expect(estimator.recalcInputs).toEqual([{ items: corrected, imageBase64: null }]);
    expect(estimator.inputs).toHaveLength(0);
  });

  it('clamps the new kcal and macros to the API limits', async () => {
    const { estimate, estimator } = await setup();
    estimator.nextRecalc = () => ({
      kcal: [99_999, -40.2],
      macros: [
        { protein: 4000, fat: 0.3, carbs: -2 },
        { protein: Number.NaN, fat: null, carbs: 12.24 },
      ],
      comment: '',
    });
    const body = await json<FoodEstimateResponse>(await estimate({ date: DATE, items: corrected }));
    expect(body.items.map((item) => item.kcal)).toEqual([LIMITS.kcal.max, 0]);
    expect(body.items.map(({ protein, fat, carbs }) => [protein, fat, carbs])).toEqual([
      [LIMITS.macro.max, 0.5, 0],
      [null, null, 12],
    ]);
    expect(body.totalKcal).toBe(LIMITS.kcal.max);
  });

  it('returns null macros when the estimator gives none for an item', async () => {
    const { estimate, estimator } = await setup();
    estimator.nextRecalc = () => ({
      kcal: [300, 50],
      macros: [{ protein: 20, fat: 10, carbs: 30 }],
      comment: '',
    });
    const body = await json<FoodEstimateResponse>(await estimate({ date: DATE, items: corrected }));
    expect(body.items[1]).toEqual({ ...corrected[1], kcal: 50, protein: null, fat: null, carbs: null });
  });

  it('502 ai_failed when the estimator does not return one kcal per item', async () => {
    const { estimate, estimator, status } = await setup();
    for (const kcal of [[300], [300, 50, 10]]) {
      estimator.nextRecalc = () => ({ kcal, macros: [], comment: '' });
      const res = await estimate({ date: DATE, items: corrected });
      expect(res.status).toBe(502);
      expect(await json(res)).toEqual({ error: 'ai_failed', message: expect.any(String) });
    }
    expect((await status()).remainingToday).toBe(38);
  });

  it.each([
    ['ai_unavailable', 503],
    ['ai_failed', 502],
  ] as const)('maps FoodAiError %s to %i', async (code, httpStatus) => {
    const { estimate, estimator } = await setup();
    estimator.nextRecalc = () => {
      throw new FoodAiError(code, 'test');
    };
    const res = await estimate({ date: DATE, items: corrected });
    expect(res.status).toBe(httpStatus);
    expect(await json(res)).toEqual({ error: code, message: expect.any(String) });
  });

  it('404 not_found JSON for an unknown photo, without calling the model or spending the budget', async () => {
    const { estimate, estimator, status, photoRows } = await setup();
    const res = await estimate({ date: DATE, items: corrected, photoId: UNKNOWN_PHOTO });
    expect(res.status).toBe(404);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    expect(await json(res)).toEqual({ error: 'not_found', message: 'Фото не знайдено' });
    expect(estimator.recalcInputs).toHaveLength(0);
    expect(photoRows()).toBe(0);
    expect((await status()).remainingToday).toBe(40);
  });

  it('404 not_found (the same answer) for another user’s photo, without calling the model or spending', async () => {
    const { s, estimate, estimator, status } = await setup();
    const id = (await json<FoodEstimateResponse>(await estimate({ date: DATE, image }))).photoId ?? '';
    const olya = await s.createUser('olya');
    const before = await status(olya.cookie);

    const res = await estimate({ date: DATE, items: corrected, photoId: id }, { cookie: olya.cookie });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'not_found', message: 'Фото не знайдено' });
    expect(estimator.recalcInputs).toHaveLength(0);
    expect(await status(olya.cookie)).toEqual(before);
    // Still hers: the owner recalculates with it as usual.
    expect((await estimate({ date: DATE, items: corrected, photoId: id })).status).toBe(200);
  });

  it('404 once the daily clean-up has removed the photo', async () => {
    const { s, estimate, photosDir } = await setup();
    const id = (await json<FoodEstimateResponse>(await estimate({ date: DATE, image }))).photoId ?? '';
    createPhotoStore(s.db, photosDir).collectGarbage(s.clock.now + PHOTO_GC_GRACE_MS + 1);
    const res = await estimate({ date: DATE, items: corrected, photoId: id });
    expect(res.status).toBe(404);
  });

  it.each([
    ['items together with a new photo', { items: corrected, image }],
    ['photoId without items', { text: 'борщ', photoId: UNKNOWN_PHOTO }],
    ['photoId with a new photo', { image, photoId: UNKNOWN_PHOTO }],
    ['an empty list', { items: [] }],
    [
      'more than 30 items',
      { items: Array.from({ length: 31 }, () => ({ name: 'Хліб', portion: '1 скибка' })) },
    ],
    ['a blank name', { items: [{ name: '   ', portion: '100 г' }] }],
    ['a name too long', { items: [{ name: 'я'.repeat(LIMITS.foodName + 1), portion: '' }] }],
    ['a portion too long', { items: [{ name: 'Хліб', portion: 'г'.repeat(LIMITS.portion + 1) }] }],
    ['an item without a portion', { items: [{ name: 'Хліб' }] }],
    ['items that are not a list', { items: 'Хліб — 1 скибка' }],
    ['a malformed photoId', { items: corrected, photoId: '../../legko.db' }],
    ['no date', { date: undefined, items: corrected }],
  ])('rejects %s with bad_request', async (_name, fields) => {
    const { estimate, estimator, status, photoRows } = await setup();
    const res = await estimate({ date: DATE, ...fields });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'bad_request' });
    expect(estimator.inputs).toHaveLength(0);
    expect(estimator.recalcInputs).toHaveLength(0);
    expect(photoRows()).toBe(0);
    expect((await status()).remainingToday).toBe(40);
  });

  it('answers 503 ai_unavailable when the feature is disabled', async () => {
    const { estimate } = await setup({ estimator: null });
    const res = await estimate({ date: DATE, items: corrected, photoId: UNKNOWN_PHOTO });
    expect(res.status).toBe(503);
    expect(await json(res)).toMatchObject({ error: 'ai_unavailable' });
  });

  it('requires a session and passes the mutation guard', async () => {
    const { estimate, estimator } = await setup();
    const anon = await estimate({ date: DATE, items: corrected }, { cookie: null });
    expect(anon.status).toBe(401);
    expect(await json(anon)).toMatchObject({ error: 'unauthorized' });
    const foreign = await estimate({ date: DATE, items: corrected }, { origin: 'https://evil.example' });
    expect(foreign.status).toBe(403);
    expect(await json(foreign)).toMatchObject({ error: 'forbidden_origin' });
    expect(estimator.recalcInputs).toHaveLength(0);
  });

  it('counts each recalculation as one estimate, failed ones too, then 429', async () => {
    const { estimate, estimator, status, photoRows } = await setup(limits(3));
    const id = (await json<FoodEstimateResponse>(await estimate({ date: DATE, image }))).photoId ?? '';
    expect((await estimate({ date: DATE, items: corrected, photoId: id })).status).toBe(200);
    expect(await status()).toEqual({ enabled: true, remainingToday: 1, limitToday: 3 });
    estimator.nextRecalc = () => {
      throw new FoodAiError('ai_failed', 'test');
    };
    expect((await estimate({ date: DATE, items: corrected, photoId: id })).status).toBe(502);
    expect(await status()).toEqual({ enabled: true, remainingToday: 0, limitToday: 3 });

    const res = await estimate({ date: DATE, items: corrected, photoId: id });
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({
      error: 'rate_limited',
      message: 'Ліміт підрахунків на сьогодні вичерпано',
    });
    expect(res.headers.get('Retry-After')).toBe(String(12 * 3600));
    expect(estimator.recalcInputs).toHaveLength(2);
    expect(photoRows()).toBe(1);
  });
});

describe('daily estimate budget', () => {
  it('429 rate_limited once the limit is used, counting failed calls too', async () => {
    const { estimate, estimator, status, photoRows } = await setup(limits(2));
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(200);
    estimator.next = () => {
      throw new FoodAiError('ai_failed', 'test');
    };
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(502);
    expect(await status()).toEqual({ enabled: true, remainingToday: 0, limitToday: 2 });

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
    const { s, estimate, status } = await setup(limits(1, 1));
    s.clock.now = Date.UTC(2026, 9, 9, 20, 59); // 23:59 in Kyiv
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(200);
    const limited = await estimate({ date: '2026-10-09', text: 'борщ' });
    expect(limited.status).toBe(429);
    expect(limited.headers.get('Retry-After')).toBe('60');
    s.clock.now = Date.UTC(2026, 9, 9, 21, 1); // 00:01 on Oct 10 in Kyiv: both counters renewed
    expect(await status()).toEqual({ enabled: true, remainingToday: 1, limitToday: 1 });
    expect((await estimate({ date: '2026-10-10', text: 'борщ' })).status).toBe(200);
  });

  it('changing settings.timezone (ops or push subscribe) does not open a fresh budget', async () => {
    const { s, cookie, estimate, estimator, status } = await setup(limits(1));
    s.clock.now = Date.UTC(2026, 9, 9, 20, 0); // 23:00 in Kyiv
    expect((await estimate({ date: '2026-10-09', text: 'борщ' })).status).toBe(200);

    // Kiritimati is already on Oct 10 and Pago Pago still on Oct 9 — neither is a new budget day.
    for (const timezone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago', 'America/New_York']) {
      const put = await s.call('/api/ops', {
        cookie,
        body: { ops: [{ kind: 'settings.put', value: { ...defaultSettings(), timezone } }] },
      });
      expect(put.status).toBe(200);
      expect(await status(), timezone).toEqual({ enabled: true, remainingToday: 0, limitToday: 1 });
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

describe('per-user and global AI limits (docs/multi-user.md §5.3, D16)', () => {
  const GLOBAL_MESSAGE = 'Підрахунки на сьогодні закінчилися. Спробуй завтра';
  const USER_MESSAGE = 'Ліміт підрахунків на сьогодні вичерпано';
  const borscht = { date: '2026-10-09', text: 'борщ' };

  it('her own limit stops her only: the next user still has theirs, and both count globally', async () => {
    const { s, estimate, status } = await setup(limits(2, 5));
    const olya = await s.createUser('olya');
    for (let i = 0; i < 2; i++) expect((await estimate(borscht)).status).toBe(200);
    const res = await estimate(borscht);
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({ error: 'rate_limited', message: USER_MESSAGE });
    expect(await status()).toEqual({ enabled: true, remainingToday: 0, limitToday: 2 });

    expect(await status(olya.cookie)).toEqual({ enabled: true, remainingToday: 2, limitToday: 2 });
    expect((await estimate(borscht, { cookie: olya.cookie })).status).toBe(200);
    expect(await status(olya.cookie)).toEqual({ enabled: true, remainingToday: 1, limitToday: 2 });
    const usage = s.budget.usage(s.clock.now);
    expect(usage.globalToday).toBe(3);
    expect(usage.byUser.get(s.anna.id)?.today).toBe(2);
    expect(usage.byUser.get(olya.id)?.today).toBe(1);
  });

  it('the global ceiling stops everybody with its own message, before any photo is stored', async () => {
    const { s, estimate, estimator, status, photoRows } = await setup(limits(5, 2));
    const olya = await s.createUser('olya');
    expect((await estimate(borscht)).status).toBe(200);
    expect((await estimate(borscht, { cookie: olya.cookie })).status).toBe(200);

    for (const cookie of [undefined, olya.cookie]) {
      const res = await estimate({ ...borscht, image }, cookie ? { cookie } : {});
      expect(res.status).toBe(429);
      expect(await json(res)).toEqual({ error: 'rate_limited', message: GLOBAL_MESSAGE });
      expect(res.headers.get('Retry-After')).toBe(String(12 * 3600));
    }
    // A recalculation goes through the atomic check and gets the same answer.
    const recalc = await estimate({ date: '2026-10-09', items: [{ name: 'Хліб', portion: '' }] });
    expect(recalc.status).toBe(429);
    expect(await json(recalc)).toEqual({ error: 'rate_limited', message: GLOBAL_MESSAGE });

    expect(photoRows()).toBe(0);
    expect(estimator.inputs).toHaveLength(2);
    expect(await status()).toEqual({ enabled: true, remainingToday: 0, limitToday: 5 });
  });

  it('her own exhausted limit wins over the global message when both are used up', async () => {
    const { estimate } = await setup(limits(1, 1));
    expect((await estimate(borscht)).status).toBe(200);
    for (const body of [borscht, { ...borscht, image }]) {
      expect(await json(await estimate(body))).toEqual({ error: 'rate_limited', message: USER_MESSAGE });
    }
  });

  it('a per-user limit of 0 turns AI off for that user only (status says off, not «used up today»)', async () => {
    const { s, estimate, estimator, status } = await setup();
    const olya = await s.createUser('olya');
    s.users.setAiLimit(olya.id, 0);
    expect(await status(olya.cookie)).toEqual({ enabled: false, remainingToday: 0, limitToday: 0 });
    // The estimate route still refuses on its own.
    const res = await estimate(borscht, { cookie: olya.cookie });
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({ error: 'rate_limited', message: USER_MESSAGE });
    expect(estimator.inputs).toHaveLength(0);
    // Everybody else keeps AI.
    expect(await status()).toEqual({ enabled: true, remainingToday: 40, limitToday: 40 });
    expect((await estimate(borscht)).status).toBe(200);
  });

  it('a configured per-user default of 0 turns AI off for everyone without their own limit', async () => {
    const { s, status } = await setup(limits(0, 150));
    const olya = await s.createUser('olya');
    s.users.setAiLimit(olya.id, 3);
    expect(await status()).toEqual({ enabled: false, remainingToday: 0, limitToday: 0 });
    expect(await status(olya.cookie)).toEqual({ enabled: true, remainingToday: 3, limitToday: 3 });
  });

  it('a saved global ceiling of 0 turns AI off for everybody; a used-up ceiling does not', async () => {
    const { s, estimate, status } = await setup(limits(5, 150));
    const olya = await s.createUser('olya');
    s.budget.setLimits({ perUser: 5, global: 0 });
    for (const cookie of [undefined, olya.cookie])
      expect(await status(cookie)).toEqual({ enabled: false, remainingToday: 0, limitToday: 5 });
    expect(await json(await estimate(borscht))).toEqual({ error: 'rate_limited', message: GLOBAL_MESSAGE });

    // Used up for today is still «on» (the buttons explain the limit and it renews tomorrow).
    s.budget.setLimits({ perUser: 5, global: 1 });
    expect((await estimate(borscht)).status).toBe(200);
    expect(await status(olya.cookie)).toEqual({ enabled: true, remainingToday: 0, limitToday: 5 });
  });

  it('parallel estimates with one left store at most one photo and call the model once', async () => {
    const { s, estimate, estimator, photosDir, photoRows } = await setup();
    s.users.setAiLimit(s.anna.id, 1);
    const responses = await Promise.all(Array.from({ length: 8 }, () => estimate({ ...borscht, image })));
    const statuses = responses.map((r) => r.status).sort();
    expect(statuses).toEqual([200, 429, 429, 429, 429, 429, 429, 429]);
    for (const res of responses.filter((r) => r.status === 429))
      expect(await json(res)).toEqual({ error: 'rate_limited', message: USER_MESSAGE });
    expect(estimator.inputs).toHaveLength(1);
    expect(photoRows()).toBe(1);
    expect(readdirSync(photosDir)).toHaveLength(2);
  });

  it('a refused estimate stores no photo, also when only the global ceiling is used up', async () => {
    const { s, estimate, photoRows } = await setup(limits(5, 1));
    const olya = await s.createUser('olya');
    expect((await estimate(borscht)).status).toBe(200);
    const responses = await Promise.all(
      Array.from({ length: 4 }, () => estimate({ ...borscht, image }, { cookie: olya.cookie })),
    );
    expect(responses.map((r) => r.status)).toEqual([429, 429, 429, 429]);
    expect(photoRows()).toBe(0);
  });

  it('limits an admin saved win over the configured defaults', async () => {
    const { s, estimate } = await setup(limits(40, 150));
    s.budget.setLimits({ perUser: 1, global: 150 });
    expect((await estimate(borscht)).status).toBe(200);
    expect(await json(await estimate(borscht))).toEqual({ error: 'rate_limited', message: USER_MESSAGE });
  });

  it('the estimate photo is stored as the caller’s', async () => {
    const { s, estimate } = await setup();
    const olya = await s.createUser('olya');
    const res = await estimate({ ...borscht, image }, { cookie: olya.cookie });
    const id = (await json<FoodEstimateResponse>(res)).photoId ?? '';
    expect(s.db.prepare('SELECT user_id FROM photos WHERE id = ?').get(id)).toEqual({ user_id: olya.id });
  });
});

describe('GET /api/photos/:id', () => {
  it('serves a photo to its owner only: anyone else gets the same 404 as for an unknown id', async () => {
    const { s, cookie, estimate } = await setup();
    const id =
      (await json<FoodEstimateResponse>(await estimate({ date: '2026-10-09', image }))).photoId ?? '';
    const olya = await s.createUser('olya');
    const admin = await s.login('admin');
    for (const url of [photoUrl(id), photoThumbUrl(id)]) {
      expect((await s.call(url, { cookie })).status).toBe(200);
      for (const other of [olya.cookie, admin]) {
        const res = await s.call(url, { cookie: other });
        expect(res.status, url).toBe(404);
        expect(await json(res)).toEqual({ error: 'not_found', message: 'Не знайдено' });
        expect(res.headers.get('Cache-Control')).toBe('no-store');
      }
    }
  });

  it('a browser revalidating after an account switch gets 404 for the previous account’s photo, never a 304', async () => {
    const { s, cookie, estimate } = await setup();
    const id =
      (await json<FoodEstimateResponse>(await estimate({ date: '2026-10-09', image }))).photoId ?? '';
    const first = await s.call(photoUrl(id), { cookie });
    expect(first.status).toBe(200);
    // Same device, another account: the session cookie differs, so `Vary: Cookie` sends the request again.
    const olya = await s.createUser('olya');
    for (const url of [photoUrl(id), photoThumbUrl(id)]) {
      const res = await s.call(url, {
        cookie: olya.cookie,
        headers: { 'If-None-Match': '*', 'If-Modified-Since': new Date(s.clock.now).toUTCString() },
      });
      expect(res.status, url).toBe(404);
      expect(await json(res)).toEqual({ error: 'not_found', message: 'Не знайдено' });
      expect(res.headers.get('Cache-Control')).toBe('no-store');
    }
  });

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
