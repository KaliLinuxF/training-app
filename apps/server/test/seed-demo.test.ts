import {
  addDays,
  API,
  appDataSchema,
  dayMacros,
  lastPerformance,
  mealsOf,
  normalizeDay,
  progressionHint,
  sessionRecords,
  USER_HEADER,
  weekdayOf,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { DEFAULT_SEED_USERNAME, demoData, seedDemo } from '../scripts/seed-demo';
import { createTestServer, json, PASSWORD, type TestServer } from './helpers';

// The e2e clock's day (Wed 14 Oct 2026).
const TODAY = '2026-10-14';

describe('demo data (dev seed and e2e fixture)', () => {
  const data = demoData(TODAY);

  it('logs the six days before today as 3–4 typed meals that add up to the day’s kcal', () => {
    for (let back = 1; back <= 6; back++) {
      const date = addDays(TODAY, -back);
      const day = data.days[date];
      if (!day) continue;
      const meals = day.meals ?? [];
      expect(meals.length, date).toBeGreaterThanOrEqual(3);
      expect(meals.length, date).toBeLessThanOrEqual(4);
      expect(meals.reduce((sum, m) => sum + (m.kcal ?? 0), 0)).toBe(day.kcal);
      expect(meals.map((m) => m.id)).toEqual(meals.map((_, i) => `demo-${date}-${i}`));
      expect(meals[0]).toMatchObject({ type: 'Сніданок', time: '08:30' });
      expect(meals.at(-1)).toMatchObject({ type: 'Вечеря', time: '19:30' });
      for (const m of meals) expect(m.text[0]).toBe(m.text[0]?.toLocaleUpperCase('uk'));
      expect(day).toEqual(normalizeDay(day));
    }
  });

  it('13 October: 1 740 kcal as 520 / 700 / 520 with the type shares of macros', () => {
    const day = data.days['2026-10-13'];
    expect(mealsOf(day).map((m) => [m.type, m.kcal, m.text])).toEqual([
      ['Сніданок', 520, 'Тост з авокадо'],
      ['Обід', 700, 'Салат з куркою'],
      ['Вечеря', 520, 'Індичка з броколі'],
    ]);
    expect(day?.kcal).toBe(1740);
    expect(dayMacros(day)).toEqual({ protein: 114, fat: 62, carbs: 181 });
    // Yesterday's breakfast mirrors itself as one position.
    expect(day?.meals?.[0]?.items).toEqual([
      { name: 'Тост з авокадо', portion: '1 порція', kcal: 520, protein: 23, fat: 17, carbs: 68 },
    ]);
    expect(day?.meals?.[1]).not.toHaveProperty('items');
  });

  it('keeps today and the older days legacy', () => {
    expect(data.days[TODAY]).toEqual({
      food: 'Вівсянка з бананом, кава',
      kcal: null,
      trained: null,
      types: [],
      notes: '',
    });
    const older = Object.entries(data.days).filter(([date]) => date < addDays(TODAY, -6));
    expect(older.length).toBeGreaterThan(40);
    for (const [, day] of older) expect(day).not.toHaveProperty('meals');
  });

  it('gives the frequent dishes macros (except the apple)', () => {
    expect(data.foods.find((f) => f.name === 'Борщ')).toMatchObject({ protein: 6, fat: 9, carbs: 19 });
    expect(data.foods.find((f) => f.name === 'Яблуко')).not.toHaveProperty('protein');
  });

  it('is a valid backup that round-trips through the server unchanged', async () => {
    expect(appDataSchema.safeParse(data).success).toBe(true);
    const s = await createTestServer();
    const cookie = await s.login();
    expect((await s.call('/api/import', { cookie, body: data })).status).toBe(200);
    expect(await json(await s.call('/api/data', { cookie }))).toEqual(data);
  });
});

describe('demo data with training (dev seed, e2e "training")', () => {
  const plain = demoData(TODAY);
  const data = demoData(TODAY, { training: true });

  it('the default demo has no training: empty workouts and steps, no steps goal', () => {
    expect(demoData(TODAY, { training: false })).toEqual(plain);
    expect(plain).toMatchObject({ exercises: [], workouts: [], sessions: [], steps: [], deletedSessions: [] });
    expect(plain.settings.stepsGoal).toBeNull();
    // Training only adds: the rest is the same demo.
    expect(data.days).toEqual(plain.days);
    expect(data.weights).toEqual(plain.weights);
    expect(data.foods).toEqual(plain.foods);
  });

  it('two workouts on Пн/Ср and Пт, one own exercise, steps goal 8 000', () => {
    expect(data.workouts.map((w) => [w.name, w.days, w.items.length])).toEqual([
      ['Ноги + прес', [1, 3], 4],
      ['Верх тіла', [5], 4],
    ]);
    expect(data.exercises.map((e) => [e.name, e.kind, e.met])).toEqual([['Степ-аеробіка', 'cardio', 7]]);
    expect(data.settings.stepsGoal).toBe(8000);
    expect(appDataSchema.safeParse(data).success).toBe(true);
  });

  it('done sessions only on trained plan days of the 3 weeks before today; the latest squat 40 kg is the record', () => {
    expect(data.sessions.length).toBeGreaterThanOrEqual(5);
    for (const s of data.sessions) {
      expect(s.status).toBe('done');
      expect(s.date < TODAY && s.date >= addDays(TODAY, -21)).toBe(true);
      expect(data.days[s.date]?.trained).toBe(true);
      expect([1, 3, 5]).toContain(weekdayOf(s.date));
    }
    const legs = data.sessions.filter((s) => s.name === 'Ноги + прес');
    const latest = legs.at(-1);
    expect(latest?.date).toBe(addDays(TODAY, -2));
    expect(latest?.exercises[0]?.sets.map((x) => [x.reps, x.kg, x.done])).toEqual([
      [12, 40, true],
      [12, 40, true],
      [12, 40, true],
    ]);
    expect(legs.at(-2)?.exercises[0]?.sets[0]?.kg).toBe(37.5);
    const last = lastPerformance(data.sessions, 'lib.back-squat', { date: TODAY, createdAt: Date.now(), id: 'x' });
    expect(progressionHint(last)?.text).toContain('+2,5 кг');
    expect(sessionRecords(data.sessions, latest!)).toMatchObject([{ exerciseId: 'lib.back-squat', value: 40, previous: 37.5 }]);
  });

  it('steps on 12 of the 14 days before today (5 200–11 800), nothing today', () => {
    expect(data.steps).toHaveLength(12);
    for (const s of data.steps) {
      expect(s.date >= addDays(TODAY, -14) && s.date < TODAY).toBe(true);
      expect(s.steps).toBeGreaterThanOrEqual(5200);
      expect(s.steps).toBeLessThanOrEqual(11800);
    }
    expect(data.sessions.some((s) => s.date === TODAY)).toBe(false);
  });

  it('round-trips through the server unchanged', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    expect((await s.call('/api/import', { cookie, body: data })).status).toBe(200);
    expect(await json(await s.call('/api/data', { cookie }))).toEqual(data);
  });
});

describe('seedDemo (the dev script)', () => {
  const ORIGIN = 'http://127.0.0.1:3000';

  /** The script's fetch, answered by the in-process app; records what it sent. */
  function appFetch(s: TestServer) {
    const sent: { url: string; headers: Headers; body: string }[] = [];
    const request = async (url: string, init: RequestInit): Promise<Response> => {
      sent.push({ url, headers: new Headers(init.headers), body: String(init.body) });
      return s.app.request(url, init);
    };
    return { sent, request };
  }

  it('logs in with a username and imports into that account only, sending its id as X-Legko-User', async () => {
    const s = await createTestServer();
    const olya = await s.createUser('olya', 'user', 'olya-password');
    const { sent, request } = appFetch(s);

    const id = await seedDemo({
      origin: ORIGIN,
      username: 'olya',
      password: 'olya-password',
      today: TODAY,
      fetch: request,
    });
    expect(id).toBe(olya.id);
    expect(JSON.parse(sent[0]?.body ?? '{}')).toEqual({ username: 'olya', password: 'olya-password' });
    expect(sent[1]?.url).toBe(`${ORIGIN}${API.import}`);
    expect(sent[1]?.headers.get(USER_HEADER)).toBe(olya.id);

    expect(s.data.forUser(olya.id).read()).toEqual(demoData(TODAY));
    expect(s.data.forUser(s.anna.id).read().days).toEqual({});
  });

  it('defaults to anna and fails clearly on a wrong password, importing nothing', async () => {
    expect(DEFAULT_SEED_USERNAME).toBe('anna');
    const s = await createTestServer();
    const { sent, request } = appFetch(s);
    await expect(
      seedDemo({
        origin: ORIGIN,
        username: 'anna',
        password: 'wrong-password',
        today: TODAY,
        fetch: request,
      }),
    ).rejects.toThrow(/Login failed: 401/);
    expect(sent).toHaveLength(1);
    expect(s.data.forUser(s.anna.id).read().days).toEqual({});

    await seedDemo({ origin: ORIGIN, username: 'anna', password: PASSWORD, today: TODAY, fetch: request });
    expect(s.data.forUser(s.anna.id).read()).toEqual(demoData(TODAY));

    // The dev CLI seeds the training too.
    await seedDemo({ origin: ORIGIN, username: 'anna', password: PASSWORD, today: TODAY, training: true, fetch: request });
    expect(s.data.forUser(s.anna.id).read()).toEqual(demoData(TODAY, { training: true }));
  });
});
