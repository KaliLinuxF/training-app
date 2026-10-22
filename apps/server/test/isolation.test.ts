import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API,
  coachClientPath,
  coachClientsPath,
  defaultSettings,
  emptyData,
  photoThumbUrl,
  photoUrl,
  type AppData,
  type CoachClientResponse,
  type CoachClientsResponse,
  type FoodStatusResponse,
  type Meal,
  type Op,
} from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserId } from '../src/db/users';
import type { FoodEstimator } from '../src/food/estimator';
import { PHOTO_GC_GRACE_MS } from '../src/photos/store';
import {
  ADMIN_PASSWORD,
  createTestServer,
  fakeJpeg,
  json,
  type TestServer,
  type TestServerOptions,
} from './helpers';

/**
 * Security-critical (docs/multi-user.md §3–§5, §11.1): user B can never read, change or delete what belongs to user A —
 * days, meals, weights, measures, dishes, settings, photos, push subscriptions, AI allowance — through any feature
 * route. A and B use the SAME dates and names throughout, so a missing `user_id` scope would collide.
 */

const D1 = '2026-10-08';
const D2 = '2026-10-09';
const DISH = 'Борщ';

const meal = (patch: Partial<Meal> = {}): Meal => ({
  id: 'breakfast001',
  type: 'Сніданок',
  time: '08:30',
  text: 'Тост з тунцем',
  kcal: 420,
  protein: 27,
  fat: 11,
  carbs: 36,
  ...patch,
});

/** Tables with a `user_id`: everything a user owns. */
const OWNED_TABLES = [
  'days',
  'weights',
  'measures',
  'foods',
  'user_settings',
  'photos',
  'push_subscriptions',
  'reminder_log',
  'ai_usage',
  'exercises',
  'workouts',
  'workout_sessions',
  'steps',
] as const;

/** A's workouts and steps (schema v5); B reuses exactly these ids. */
const A_EXERCISE = 'ownExercise01';
const A_WORKOUT = 'workout00001';
const A_SESSION = 'session00001';
const workoutSession = (name: string, rev = 0): Op => ({
  kind: 'session.put',
  value: {
    id: A_SESSION,
    date: D1,
    workoutId: A_WORKOUT,
    name,
    createdAt: 1,
    startedAt: null,
    finishedAt: null,
    durationSec: 1800,
    status: 'done',
    exercises: [],
    notes: '',
    rev,
    deviceId: null,
  },
});
const ownExercise = (name: string): Op => ({
  kind: 'exercise.put',
  value: { id: A_EXERCISE, name, kind: 'cardio', primary: ['quads'], secondary: [], equipment: 'other', met: 7 },
});
const ownWorkout = (name: string): Op => ({
  kind: 'workout.put',
  value: { id: A_WORKOUT, name, days: [1, 3], items: [] },
});

/** Every stored row of one user, column for column (the "byte-identical" check). */
function rowsOf(s: TestServer, id: UserId): Record<string, unknown[]> {
  return Object.fromEntries(
    OWNED_TABLES.map((table) => [
      table,
      s.db.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY 1, 2`).all(id),
    ]),
  );
}

const count = (rows: Record<string, unknown[]>): Record<string, number> =>
  Object.fromEntries(Object.entries(rows).map(([t, r]) => [t, r.length]));

interface FakeModel extends FoodEstimator {
  calls: number;
}

function fakeModel(): FakeModel {
  const model: FakeModel = {
    calls: 0,
    async estimate() {
      model.calls++;
      return {
        items: [{ name: 'Борщ', portion: '300 г', kcal: 180, protein: 6, fat: 9, carbs: 19 }],
        comment: '',
      };
    },
    async recalculate(input) {
      model.calls++;
      return { kcal: input.items.map(() => 100), macros: [], comment: '' };
    },
  };
  return model;
}

const subscription = (name: string, auth = `auth-${name}`) => ({
  endpoint: `https://web.push.apple.com/${name}`,
  keys: { p256dh: `p256dh-${name}`, auth },
});

let photosDir: string;
beforeEach(() => {
  photosDir = mkdtempSync(join(tmpdir(), 'legko-isolation-'));
});
afterEach(() => rmSync(photosDir, { recursive: true, force: true }));

interface Account {
  id: UserId;
  cookie: string;
}

/** anna (A) with a full record on D1 / D2, olya (B) with nothing yet. */
async function twoUsers(options: TestServerOptions = {}) {
  const model = fakeModel();
  const s = await createTestServer({ photosDir, estimator: model, ...options });
  const a: Account = { id: s.anna.id, cookie: await s.login('anna') };
  const b: Account = await s.createUser('olya');
  const photo = await s.photos.forUser(a.id).save({ full: fakeJpeg(2000, 1), thumb: fakeJpeg(200, 2) }, D2);

  const ops = (who: Account, list: unknown[], headers: { userHeader?: string | null } = {}) =>
    s.call(API.ops, { cookie: who.cookie, body: { ops: list }, ...headers });

  const aOps: Op[] = [
    {
      kind: 'day.put',
      date: D1,
      value: { food: 'Омлет', kcal: 1650, trained: true, types: ['Кардіо'], notes: 'A' },
    },
    { kind: 'meal.put', date: D2, value: meal({ photos: [photo] }) },
    { kind: 'day.meta', date: D2, value: { trained: true, types: ['Прес'], notes: 'A notes' } },
    { kind: 'weight.put', date: D1, kg: 65.4 },
    { kind: 'measure.put', date: D1, value: { chest: 90, waist: 70, hips: 98 } },
    { kind: 'food.use', date: D1, value: { name: DISH, portion: '300 г', kcal: 180, protein: 6 } },
    {
      kind: 'settings.put',
      value: {
        ...defaultSettings(),
        goal: 57,
        timezone: 'Europe/Warsaw',
        mealTypes: ['Сніданок', 'Ланч'],
        stepsGoal: 9000,
      },
    },
    ownExercise('Вправа A'),
    ownWorkout('Тренування A'),
    workoutSession('Сесія A'),
    { kind: 'session.delete', id: 'sessionGoneA1' },
    { kind: 'steps.put', date: D1, steps: 8400 },
  ];
  expect((await ops(a, aOps)).status).toBe(200);
  await s.call(API.pushSubscribe, { cookie: a.cookie, body: { subscription: subscription('a') } });

  const dataOf = async (who: Account) => json<AppData>(await s.call(API.data, { cookie: who.cookie }));
  const aBefore = rowsOf(s, a.id);
  const aData = await dataOf(a);
  return { s, model, a, b, photo, ops, dataOf, aBefore, aData };
}

describe('B cannot read A’s data', () => {
  it('GET /api/data and /api/export show only B’s own data (defaults while B has none)', async () => {
    const { s, b, dataOf, aData } = await twoUsers();
    expect(aData.days[D1]?.food).toBe('Омлет');

    const own = await dataOf(b);
    expect(own).toEqual({ ...emptyData(), settings: defaultSettings() });

    const exported = await s.call(API.export, { cookie: b.cookie });
    expect(exported.status).toBe(200);
    const text = await exported.text();
    expect(JSON.parse(text)).toEqual(own);
    for (const secret of ['Омлет', 'Тост з тунцем', 'A notes', 'Europe/Warsaw', DISH, '65.4']) {
      expect(text).not.toContain(secret);
    }
  });

  it('with data on the same dates, each sees only their own', async () => {
    const { s, a, b, ops, dataOf, aData } = await twoUsers();
    await ops(b, [
      {
        kind: 'day.put',
        date: D1,
        value: { food: 'Каша', kcal: 900, trained: false, types: [], notes: 'B' },
      },
      { kind: 'weight.put', date: D1, kg: 80 },
    ]);
    expect(await dataOf(a)).toEqual(aData);
    const own = await dataOf(b);
    expect(Object.keys(own.days)).toEqual([D1]);
    expect(own.days[D1]?.food).toBe('Каша');
    expect(own.weights).toEqual([{ date: D1, kg: 80 }]);
    // The export file name follows each user's own zone (A: Warsaw, B: Kyiv; same day here).
    const disposition = (await s.call(API.export, { cookie: b.cookie })).headers.get('Content-Disposition');
    expect(disposition).toBe('attachment; filename="legko-2026-10-09.json"');
  });

  it('an admin is just another user here: the data routes show the admin’s own (empty) data', async () => {
    const { s } = await twoUsers();
    const admin = await s.login('admin');
    expect((await json<AppData>(await s.call(API.data, { cookie: admin }))).days).toEqual({});
  });
});

describe('B cannot modify or delete A’s data', () => {
  it('B’s puts on A’s dates (day, meal with A’s meal id, meta, weight, measure, settings, dish) leave A identical', async () => {
    const { s, a, b, ops, aBefore, aData, dataOf } = await twoUsers();
    const res = await ops(b, [
      { kind: 'day.put', date: D1, value: { food: 'Чуже', kcal: 1, trained: false, types: [], notes: 'B' } },
      { kind: 'meal.put', date: D2, value: meal({ text: 'Підмінено', kcal: 1 }) },
      { kind: 'day.meta', date: D2, value: { notes: 'B was here' } },
      { kind: 'day.meta', date: D1, value: { trained: false } },
      { kind: 'weight.put', date: D1, kg: 99 },
      { kind: 'measure.put', date: D1, value: { chest: 101, waist: 81, hips: 111 } },
      { kind: 'settings.put', value: { ...defaultSettings(), goal: 99, timezone: 'Asia/Tokyo' } },
      { kind: 'food.use', date: D1, value: { name: DISH, portion: '1 кг', kcal: 999 } },
    ]);
    expect(res.status).toBe(200);
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect(await dataOf(a)).toEqual(aData);
    // …and B got exactly their own copies.
    const own = await dataOf(b);
    expect(own.days[D1]?.food).toBe('Чуже');
    expect(own.days[D2]?.meals?.map((m) => m.text)).toEqual(['Підмінено']);
    expect(own.settings.goal).toBe(99);
    expect(own.foods.map((f) => [f.name, f.count])).toEqual([[DISH, 1]]);
  });

  it('B’s deletes (day, meal, weight, measure, dish) leave A’s rows', async () => {
    const { s, a, b, ops, aBefore } = await twoUsers();
    const res = await ops(b, [
      { kind: 'day.delete', date: D1 },
      { kind: 'day.delete', date: D2 },
      { kind: 'meal.delete', date: D2, id: 'breakfast001' },
      { kind: 'weight.delete', date: D1 },
      { kind: 'measure.delete', date: D1 },
      { kind: 'food.delete', name: DISH },
    ]);
    expect(res.status).toBe(200);
    expect(rowsOf(s, a.id)).toEqual(aBefore);
  });

  it('B’s import replaces only B’s data: A’s counts and rows are unchanged', async () => {
    const { s, a, b, aBefore, aData, dataOf } = await twoUsers();
    const backup: AppData = {
      ...aData,
      days: { [D1]: { food: 'Імпорт B', kcal: 500, trained: null, types: [], notes: '' } },
    };
    expect((await s.call(API.import, { cookie: b.cookie, body: backup })).status).toBe(200);
    expect(count(rowsOf(s, a.id))).toEqual(count(aBefore));
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect((await dataOf(b)).days).toEqual(backup.days);

    // An empty import by B wipes B only.
    const empty: AppData = { ...emptyData(), settings: defaultSettings() };
    expect((await s.call(API.import, { cookie: b.cookie, body: empty })).status).toBe(200);
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect(await dataOf(b)).toEqual(empty);
  });
});

describe('X-Legko-User (D11) on the feature routes', () => {
  it('an ops POST naming A on B’s cookie → 409, nothing applied to anyone', async () => {
    const { s, a, b, ops, aBefore } = await twoUsers();
    const bBefore = rowsOf(s, b.id);
    const res = await ops(b, [{ kind: 'weight.put', date: D1, kg: 50 }], { userHeader: a.id });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({ error: 'user_mismatch' });
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect(rowsOf(s, b.id)).toEqual(bBefore);
  });

  it('an ops POST WITHOUT the header on B’s login-created session → 409, nothing applied', async () => {
    const { s, a, b, ops, aBefore } = await twoUsers();
    const bBefore = rowsOf(s, b.id);
    const res = await ops(b, [{ kind: 'weight.put', date: D1, kg: 50 }], { userHeader: null });
    expect(res.status).toBe(409);
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect(rowsOf(s, b.id)).toEqual(bBefore);
  });

  it('data and import naming A on B’s cookie → 409; A’s data is neither shown nor replaced', async () => {
    const { s, a, b, aBefore, aData } = await twoUsers();
    const read = await s.call(API.data, { cookie: b.cookie, userHeader: a.id });
    expect(read.status).toBe(409);
    expect(await read.text()).not.toContain('Омлет');
    const write = await s.call(API.import, {
      cookie: b.cookie,
      userHeader: a.id,
      body: { ...aData, weights: [] },
    });
    expect(write.status).toBe(409);
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect(rowsOf(s, b.id).days).toEqual([]);
  });
});

describe('photos', () => {
  it('B cannot read A’s photo: full and thumb → 404, the same answer as for an unknown id', async () => {
    const { s, a, b, photo } = await twoUsers();
    for (const url of [photoUrl(photo), photoThumbUrl(photo)]) {
      expect((await s.call(url, { cookie: a.cookie })).status).toBe(200);
      const res = await s.call(url, { cookie: b.cookie });
      expect(res.status, url).toBe(404);
      expect(await json(res)).toEqual({ error: 'not_found', message: 'Не знайдено' });
    }
  });

  it('a recalculation by B with A’s photoId → 404 not_found, no model call, no budget spent', async () => {
    const { s, b, photo, model } = await twoUsers();
    const status = async () => json<FoodStatusResponse>(await s.call(API.foodStatus, { cookie: b.cookie }));
    const before = await status();
    const res = await s.call(API.foodEstimate, {
      cookie: b.cookie,
      body: { date: D2, items: [{ name: 'Хліб', portion: '' }], photoId: photo },
    });
    expect(res.status).toBe(404);
    expect(await json(res)).toEqual({ error: 'not_found', message: 'Фото не знайдено' });
    expect(model.calls).toBe(0);
    expect(await status()).toEqual(before);
  });

  it('B’s meal naming A’s photo neither unlocks it nor keeps it alive once A drops it', async () => {
    const { s, a, b, ops, photo } = await twoUsers();
    expect(
      (await ops(b, [{ kind: 'meal.put', date: D2, value: meal({ id: 'b-meal', photos: [photo] }) }])).status,
    ).toBe(200);
    expect((await s.call(photoUrl(photo), { cookie: b.cookie })).status).toBe(404);

    // While A references it, the GC keeps it.
    s.clock.now += PHOTO_GC_GRACE_MS + 1;
    expect(s.photos.collectGarbage(s.clock.now).photos).toEqual([]);

    // A drops her reference: B's reference counts for nothing.
    expect((await ops(a, [{ kind: 'meal.delete', date: D2, id: 'breakfast001' }])).status).toBe(200);
    expect(s.photos.collectGarbage(s.clock.now).photos).toEqual([photo]);
    expect((await s.call(photoUrl(photo), { cookie: a.cookie })).status).toBe(404);
    expect((await s.call(photoUrl(photo), { cookie: b.cookie })).status).toBe(404);
    expect(rowsOf(s, a.id).photos).toEqual([]);
  });
});

describe('push subscriptions', () => {
  const endpointsOf = (s: TestServer, id: UserId) =>
    s.subscriptions
      .forUser(id)
      .all()
      .map((x) => x.endpoint);

  it('B cannot unsubscribe A’s endpoint without A’s auth key', async () => {
    const { s, a, b } = await twoUsers();
    for (const body of [
      { endpoint: subscription('a').endpoint },
      { endpoint: subscription('a').endpoint, auth: 'auth-guess' },
    ]) {
      expect((await s.call(API.pushUnsubscribe, { cookie: b.cookie, body })).status).toBe(200);
    }
    expect(endpointsOf(s, a.id)).toEqual([subscription('a').endpoint]);
  });

  it('B cannot move A’s endpoint by subscribing it with other keys: 403, A’s row and both timezones unchanged', async () => {
    const { s, a, b, aBefore } = await twoUsers();
    const res = await s.call(API.pushSubscribe, {
      cookie: b.cookie,
      body: { subscription: subscription('a', 'auth-guess'), timezone: 'Asia/Tokyo' },
    });
    expect(res.status).toBe(403);
    expect(await json(res)).toMatchObject({ error: 'forbidden' });
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect(s.data.forUser(a.id).settings().timezone).toBe('Europe/Warsaw');
    expect(s.data.forUser(b.id).settings().timezone).toBe('Europe/Kyiv');
    expect(endpointsOf(s, b.id)).toEqual([]);
  });

  it('B cannot change A’s timezone through its own push subscribe', async () => {
    const { s, a, b } = await twoUsers();
    const res = await s.call(API.pushSubscribe, {
      cookie: b.cookie,
      body: { subscription: subscription('b'), timezone: 'America/New_York' },
    });
    expect(res.status).toBe(200);
    expect(s.data.forUser(b.id).settings().timezone).toBe('America/New_York');
    expect(s.data.forUser(a.id).settings().timezone).toBe('Europe/Warsaw');
  });

  it('the same browser subscription (same auth) after a switch moves to B', async () => {
    const { s, a, b } = await twoUsers();
    const res = await s.call(API.pushSubscribe, {
      cookie: b.cookie,
      body: { subscription: subscription('a') },
    });
    expect(res.status).toBe(200);
    expect(endpointsOf(s, a.id)).toEqual([]);
    expect(endpointsOf(s, b.id)).toEqual([subscription('a').endpoint]);
  });

  it('B’s unsubscribe with the subscription’s auth removes A’s row at once (sign-in switch on one browser)', async () => {
    const { s, a, b } = await twoUsers();
    const res = await s.call(API.pushUnsubscribe, {
      cookie: b.cookie,
      body: { endpoint: subscription('a').endpoint, auth: 'auth-a' },
    });
    expect(res.status).toBe(200);
    expect(endpointsOf(s, a.id)).toEqual([]);
  });

  it('B’s test push reaches only B’s endpoint', async () => {
    const { s, b } = await twoUsers();
    await s.call(API.pushSubscribe, { cookie: b.cookie, body: { subscription: subscription('b') } });
    const res = await s.call(API.pushTest, { method: 'POST', cookie: b.cookie });
    expect(await json(res)).toEqual({ ok: true, sent: 1 });
    expect(s.transport.sent.map((x) => x.endpoint)).toEqual([subscription('b').endpoint]);
  });
});

describe('AI allowance', () => {
  it('B’s usage does not consume A’s per-user limit, but does consume the global ceiling', async () => {
    const { s, a, b } = await twoUsers({ aiLimits: { perUser: 2, global: 3 } });
    const estimate = (who: Account) =>
      s.call(API.foodEstimate, { cookie: who.cookie, body: { date: D2, text: 'борщ' } });
    const status = async (who: Account) =>
      json<FoodStatusResponse>(await s.call(API.foodStatus, { cookie: who.cookie }));

    expect((await estimate(b)).status).toBe(200);
    expect((await estimate(b)).status).toBe(200);
    expect((await estimate(b)).status).toBe(429);
    expect(await status(b)).toEqual({ enabled: true, remainingToday: 0, limitToday: 2 });
    // A's own two are untouched; only one global estimate is left for everybody.
    expect(await status(a)).toEqual({ enabled: true, remainingToday: 1, limitToday: 2 });
    expect(s.budget.usage(s.clock.now).byUser.get(a.id)).toBeUndefined();

    expect((await estimate(a)).status).toBe(200);
    const res = await estimate(a);
    expect(res.status).toBe(429);
    expect(await json(res)).toEqual({
      error: 'rate_limited',
      message: 'Підрахунки на сьогодні закінчилися. Спробуй завтра',
    });
    expect(rowsOf(s, a.id).ai_usage).toEqual([{ user_id: a.id, date: D2, count: 1 }]);
    expect(rowsOf(s, b.id).ai_usage).toEqual([{ user_id: b.id, date: D2, count: 2 }]);
  });
});

describe('workouts and steps (schema v5): B never reads or changes A’s', () => {
  it('B’s ops with A’s ids stay B’s own; A’s rows are byte-identical', async () => {
    const { s, a, b, ops, dataOf, aBefore, aData } = await twoUsers();
    expect(aData.exercises.map((e) => e.name)).toEqual(['Вправа A']);
    expect(aData.sessions.map((x) => x.name)).toEqual(['Сесія A']);
    expect(aData.deletedSessions).toEqual(['sessionGoneA1']);

    const res = await ops(b, [
      ownExercise('Вправа B'),
      { kind: 'exercise.delete', id: A_EXERCISE },
      ownExercise('Вправа B2'),
      ownWorkout('Тренування B'),
      { kind: 'workout.delete', id: A_WORKOUT },
      workoutSession('Сесія B', 99),
      { kind: 'session.delete', id: A_SESSION },
      { kind: 'session.put', value: { ...(workoutSession('Сесія B3', 100) as { value: object }).value, id: 'sessionGoneA1' } },
      { kind: 'steps.put', date: D1, steps: 100 },
      { kind: 'steps.delete', date: D1 },
      { kind: 'steps.put', date: D2, steps: 200 },
    ]);
    expect(res.status).toBe(200);
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect(await dataOf(a)).toEqual(aData);

    const own = await dataOf(b);
    expect(own.exercises.map((e) => e.name)).toEqual(['Вправа B2']);
    expect(own.workouts).toEqual([]);
    // B deleted «their» session id: a tombstone of B's; A's tombstone never blocks B's put of the same id.
    expect(own.sessions.map((x) => x.name)).toEqual(['Сесія B3']);
    expect(own.deletedSessions).toEqual([A_SESSION]);
    expect(own.steps).toEqual([{ date: D2, steps: 200 }]);
    expect(own.settings.stepsGoal).toBeNull();
    const text = JSON.stringify(own);
    for (const secret of ['Вправа A', 'Тренування A', 'Сесія A', '8400']) expect(text).not.toContain(secret);
  });

  it('an own exercise with a lib.* id is refused: nothing applied to anyone', async () => {
    const { s, a, b, ops, aBefore } = await twoUsers();
    const bBefore = rowsOf(s, b.id);
    const res = await ops(b, [
      { kind: 'steps.put', date: D1, steps: 5000 },
      {
        kind: 'exercise.put',
        value: { id: 'lib.plank', name: 'Планка', kind: 'time', primary: ['abs'], secondary: [], equipment: 'bodyweight', met: 3 },
      },
    ]);
    expect(res.status).toBe(400);
    expect(rowsOf(s, a.id)).toEqual(aBefore);
    expect(rowsOf(s, b.id)).toEqual(bBefore);
  });

  it('the coach reads A’s workouts read-only (GET only); a non-admin is refused', async () => {
    const { s, a, b, aBefore } = await twoUsers();
    const admin = await s.login('admin', ADMIN_PASSWORD);
    const detail = await s.call(coachClientPath(a.id), { cookie: admin });
    expect(detail.status).toBe(200);
    const body = await json<CoachClientResponse>(detail);
    expect(body.data.sessions.map((x) => x.name)).toEqual(['Сесія A']);
    expect(body.data.steps).toEqual([{ date: D1, steps: 8400 }]);
    expect(body.data.deletedSessions).toEqual([]);
    const list = await json<CoachClientsResponse>(
      await s.call(coachClientsPath({ from: '2026-10-01', to: '2026-10-15' }), { cookie: admin }),
    );
    const item = list.clients.find((c) => c.client.id === a.id);
    expect(item?.sessions.map((x) => x.name)).toEqual(['Сесія A']);
    expect(item?.steps).toEqual([{ date: D1, steps: 8400 }]);
    expect(item?.schedule).toEqual([{ id: A_WORKOUT, name: 'Тренування A', days: [1, 3] }]);
    for (const method of ['POST', 'PUT', 'DELETE'] as const) {
      const res = await s.call(coachClientPath(a.id), { method, cookie: admin, body: { ops: [ownWorkout('X')] } });
      expect(res.status, method).not.toBe(200);
    }
    expect((await s.call(coachClientPath(a.id), { cookie: b.cookie })).status).toBe(403);
    expect(rowsOf(s, a.id)).toEqual(aBefore);
  });
});
