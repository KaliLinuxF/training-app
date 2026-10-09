import {
  applyOps,
  defaultSettings,
  emptyData,
  LIMITS,
  MAX_OPS_PER_REQUEST,
  WORKOUT_TYPES,
  type AppData,
  type DayEntry,
  type Op,
  type Settings,
  type Weekday,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { createTestServer, json, seededRandom, type TestServer } from './helpers';

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: 'Омлет',
  kcal: 1650,
  trained: true,
  types: ['Кардіо'],
  notes: '',
  ...patch,
});

async function postOps(s: TestServer, cookie: string, ops: unknown[]): Promise<Response> {
  return s.call('/api/ops', { cookie, body: { ops } });
}

async function getData(s: TestServer, cookie: string): Promise<AppData> {
  const res = await s.call('/api/data', { cookie });
  expect(res.status).toBe(200);
  return json<AppData>(res);
}

describe('POST /api/ops', () => {
  it('applies a batch in order and reports how many ops were applied', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const ops: Op[] = [
      { kind: 'day.put', date: '2026-10-10', value: day({ food: '  Омлет  ' }) },
      { kind: 'weight.put', date: '2026-10-10', kg: 65.4 },
      { kind: 'weight.put', date: '2026-10-03', kg: 66 },
      { kind: 'weight.put', date: '2026-10-10', kg: 65.3 },
      { kind: 'measure.put', date: '2026-10-10', value: { chest: 90, waist: 70.5, hips: null } },
    ];
    const res = await postOps(s, cookie, ops);
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({ ok: true, applied: 5 });

    const data = await getData(s, cookie);
    expect(data.days).toEqual({ '2026-10-10': day() });
    expect(data.weights).toEqual([
      { date: '2026-10-03', kg: 66 },
      { date: '2026-10-10', kg: 65.3 },
    ]);
    expect(data.measures).toEqual([{ date: '2026-10-10', chest: 90, waist: 70.5, hips: null }]);
    expect(data).toEqual(applyOps(emptyData(), ops));
  });

  it('treats an empty day as a delete and drops types without a workout', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await postOps(s, cookie, [
      { kind: 'day.put', date: '2026-10-10', value: day() },
      { kind: 'day.put', date: '2026-10-11', value: day({ trained: false, types: ['Кардіо'] }) },
      { kind: 'day.put', date: '2026-10-12', value: day({ trained: null, types: ['Прес'] }) },
    ]);
    await postOps(s, cookie, [
      {
        kind: 'day.put',
        date: '2026-10-10',
        value: { food: ' ', kcal: null, trained: null, types: ['Прес'], notes: '  ' },
      },
    ]);
    const data = await getData(s, cookie);
    expect(Object.keys(data.days).sort()).toEqual(['2026-10-11', '2026-10-12']);
    expect(data.days['2026-10-11']?.types).toEqual([]);
    expect(data.days['2026-10-12']?.types).toEqual([]);
  });

  it('deletes are idempotent', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const ops = [
      { kind: 'day.delete', date: '2026-10-10' },
      { kind: 'weight.delete', date: '2026-10-10' },
      { kind: 'measure.delete', date: '2026-10-10' },
    ];
    expect((await postOps(s, cookie, ops)).status).toBe(200);
    expect((await postOps(s, cookie, ops)).status).toBe(200);
    expect(await getData(s, cookie)).toEqual(emptyData());
  });

  it('returns default settings until settings are saved, then the saved ones', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    expect((await getData(s, cookie)).settings).toEqual(defaultSettings());
    const settings: Settings = { ...defaultSettings(), goal: 58.5, onboarded: true, customTypes: ['Йога'] };
    await postOps(s, cookie, [{ kind: 'settings.put', value: settings }]);
    expect((await getData(s, cookie)).settings).toEqual(settings);
  });

  it('rejects the batch at the first invalid op, with its index, applying nothing', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await postOps(s, cookie, [{ kind: 'weight.put', date: '2026-10-01', kg: 67 }]);
    const before = await getData(s, cookie);

    const res = await postOps(s, cookie, [
      { kind: 'weight.put', date: '2026-10-02', kg: 66.8 },
      { kind: 'day.put', date: '2026-10-02', value: day() },
      { kind: 'weight.put', date: '2026-02-30', kg: 66 },
      { kind: 'nope' },
    ]);
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'invalid_op', index: 2 });
    expect(await getData(s, cookie)).toEqual(before);
  });

  it.each([
    ['not an object', [1]],
    ['unknown kind', [{ kind: 'day.patch', date: '2026-10-10' }]],
    ['kcal too big', [{ kind: 'day.put', date: '2026-10-10', value: day({ kcal: 20001 }) }]],
    [
      'all-empty measurement',
      [{ kind: 'measure.put', date: '2026-10-10', value: { chest: null, waist: null, hips: null } }],
    ],
    ['bad time zone', [{ kind: 'settings.put', value: { ...defaultSettings(), timezone: 'Mars/Base' } }]],
  ])('invalid_op for %s', async (_name, ops) => {
    const s = await createTestServer();
    const cookie = await s.login();
    const res = await postOps(s, cookie, ops);
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'invalid_op', index: 0 });
  });

  it('rejects malformed batches with bad_request', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const tooMany = Array.from({ length: MAX_OPS_PER_REQUEST + 1 }, () => ({
      kind: 'day.delete',
      date: '2026-10-10',
    }));
    for (const body of [{}, { ops: [] }, { ops: 'x' }, [], { ops: tooMany }]) {
      const res = await s.call('/api/ops', { cookie, body });
      expect(res.status).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'bad_request' });
    }
    const notJson = await s.call('/api/ops', { cookie, body: '{"ops": [' });
    expect(notJson.status).toBe(400);
  });
});

describe('day photos and «Часті страви» ops', () => {
  it('stores day photos de-duplicated and omits an empty list', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const a = 'AAAAAAAAAAAAAAAAAAAAAA';
    const b = 'BBBBBBBBBBBBBBBBBBBBBB';
    await postOps(s, cookie, [
      { kind: 'day.put', date: '2026-10-10', value: day({ photos: [a, b, a] }) },
      { kind: 'day.put', date: '2026-10-11', value: day({ photos: [] }) },
      // A day holding only a photo is not empty.
      {
        kind: 'day.put',
        date: '2026-10-12',
        value: { food: '', kcal: null, trained: null, types: [], notes: '', photos: [b] },
      },
    ]);
    const data = await getData(s, cookie);
    expect(data.days['2026-10-10']?.photos).toEqual([a, b]);
    expect(data.days['2026-10-11']).toEqual(day());
    expect(data.days['2026-10-11']).not.toHaveProperty('photos');
    expect(data.days['2026-10-12']?.photos).toEqual([b]);
  });

  it('food.use upserts by case-insensitive name; food.delete removes it', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const ops: Op[] = [
      { kind: 'food.use', date: '2026-10-08', value: { name: 'Борщ', portion: '300 г', kcal: 180 } },
      { kind: 'food.use', date: '2026-10-09', value: { name: 'Кава з молоком', portion: '', kcal: 60 } },
      { kind: 'food.use', date: '2026-10-10', value: { name: ' борщ ', portion: '400 г', kcal: 240 } },
      // An older date never moves lastUsed back.
      { kind: 'food.use', date: '2026-10-01', value: { name: 'БОРЩ', portion: '350 г', kcal: 210 } },
    ];
    expect((await postOps(s, cookie, ops)).status).toBe(200);
    const data = await getData(s, cookie);
    expect(data.foods).toEqual([
      { name: 'Кава з молоком', portion: '', kcal: 60, count: 1, lastUsed: '2026-10-09' },
      { name: 'БОРЩ', portion: '350 г', kcal: 210, count: 3, lastUsed: '2026-10-10' },
    ]);
    expect(data).toEqual(applyOps(emptyData(), ops));

    await postOps(s, cookie, [
      { kind: 'food.delete', name: 'борщ' },
      { kind: 'food.delete', name: 'Немає такої' },
    ]);
    expect((await getData(s, cookie)).foods).toEqual([data.foods[0]]);
  });

  it('keeps at most LIMITS.foods dishes, evicting like useFood()', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    // 240 uses of 217 distinct dishes (every 10th is the same favourite).
    const ops: Op[] = Array.from({ length: 240 }, (_, i) => ({
      kind: 'food.use',
      date: `2026-10-${String(1 + (i % 28)).padStart(2, '0')}`,
      value: { name: `Страва ${i % 10 === 0 ? 'улюблена' : i}`, portion: '', kcal: i },
    }));
    expect((await postOps(s, cookie, ops)).status).toBe(200);
    const data = await getData(s, cookie);
    expect(data.foods).toHaveLength(LIMITS.foods);
    expect(data.foods.find((f) => f.name === 'Страва улюблена')?.count).toBe(24);
    expect(data).toEqual(applyOps(emptyData(), ops));
  });

  it('validates food ops', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    for (const op of [
      { kind: 'food.use', date: '2026-10-10', value: { name: '  ', portion: '', kcal: 100 } },
      { kind: 'food.use', date: '2026-10-10', value: { name: 'Борщ', portion: '', kcal: 1.5 } },
      {
        kind: 'food.use',
        date: '2026-10-10',
        value: { name: 'x'.repeat(LIMITS.foodName + 1), portion: '', kcal: 1 },
      },
      { kind: 'food.delete', name: '' },
      { kind: 'day.put', date: '2026-10-10', value: day({ photos: ['../../etc/passwd'] }) },
    ]) {
      const res = await postOps(s, cookie, [op]);
      expect(res.status, JSON.stringify(op)).toBe(400);
      expect(await json(res)).toMatchObject({ error: 'invalid_op', index: 0 });
    }
  });
});

/** Random op generator over a small date pool so puts, overwrites and deletes collide often. */
function randomOps(rnd: () => number, count: number): Op[] {
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
  const chance = (p: number): boolean => rnd() < p;
  const dates = ['2026-03-28', '2026-03-29', '2026-10-24', '2026-10-25', '2026-10-26', '2027-01-01'];
  const texts = ['', ' ', 'Омлет', '  гречка з куркою ', 'Салат\nі суп', 'нотатка'];
  const typePool = [...WORKOUT_TYPES, ' Кардіо ', 'Йога'];
  const photoPool = ['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBB', 'C-C_C-C_C-C_C-C_C-C_Cc'];
  // Same dish in different spellings: food ops are keyed by foodKey() (trimmed, lower-case).
  const dishPool = [
    'Борщ',
    ' борщ ',
    'БОРЩ',
    'Вівсянка з бананом',
    'Кава з молоком',
    'кава З МОЛОКОМ',
    'Ґрінка',
  ];
  const portionPool = ['', '250 г', ' 1 скибка ', '1 чашка (250 мл)'];
  const cm = (): number | null => (chance(0.3) ? null : Math.round((60 + rnd() * 50) * 10) / 10);

  const randomDay = (): DayEntry => {
    const day: DayEntry = {
      food: pick(texts),
      kcal: chance(0.4) ? null : Math.floor(rnd() * 3000),
      trained: pick([true, false, null] as const),
      types: Array.from({ length: Math.floor(rnd() * 4) }, () => pick(typePool)),
      notes: pick(texts),
    };
    // Absent, empty, or with duplicates (normalizeDay de-duplicates and drops an empty list).
    if (chance(0.6)) day.photos = Array.from({ length: Math.floor(rnd() * 4) }, () => pick(photoPool));
    return day;
  };

  const randomSettings = (): Settings => {
    const days = Array.from({ length: Math.floor(rnd() * 4) }, () => Math.floor(rnd() * 7) as Weekday);
    return {
      goal: Math.round((50 + rnd() * 20) * 10) / 10,
      kcalGoal: 1200 + Math.floor(rnd() * 1000),
      rem: {
        workout: { on: chance(0.5), days, time: pick(['07:00', '18:00', '23:55']) },
        weigh: { on: chance(0.5), day: Math.floor(rnd() * 7) as Weekday, time: '08:00' },
        measure: { on: chance(0.5), day: Math.floor(rnd() * 7) as Weekday, time: '08:30' },
      },
      timezone: pick(['Europe/Kyiv', 'Europe/Warsaw', 'UTC']),
      customTypes: chance(0.5) ? [] : ['Йога', 'Плавання'],
      onboarded: chance(0.5),
    };
  };

  const makers: (() => Op)[] = [
    () => ({ kind: 'day.put', date: pick(dates), value: randomDay() }),
    () => ({
      kind: 'day.put',
      date: pick(dates),
      value: { food: ' ', kcal: null, trained: null, types: [], notes: '' },
    }),
    () => ({ kind: 'day.delete', date: pick(dates) }),
    () => ({ kind: 'weight.put', date: pick(dates), kg: Math.round((55 + rnd() * 20) * 10) / 10 }),
    () => ({ kind: 'weight.delete', date: pick(dates) }),
    () => {
      const value = { chest: cm(), waist: cm(), hips: cm() };
      if (value.chest === null && value.waist === null && value.hips === null) value.waist = 70;
      return { kind: 'measure.put', date: pick(dates), value };
    },
    () => ({ kind: 'measure.delete', date: pick(dates) }),
    () => ({ kind: 'settings.put', value: randomSettings() }),
    () => ({
      kind: 'food.use',
      date: pick(dates),
      value: { name: pick(dishPool), portion: pick(portionPool), kcal: Math.floor(rnd() * 900) },
    }),
    () => ({
      kind: 'food.use',
      date: pick(dates),
      value: { name: pick(dishPool), portion: pick(portionPool), kcal: Math.floor(rnd() * 900) },
    }),
    () => ({ kind: 'food.delete', name: pick(dishPool) }),
  ];
  return Array.from({ length: count }, () => pick(makers)());
}

describe('server persistence matches applyOps()', () => {
  // Every batch is applied exactly once on each side: food.use is not idempotent under replay.
  it.each([1, 7, 42, 2026, 31337])('random op sequences, seed %i', async (seed) => {
    const rnd = seededRandom(seed);
    const s = await createTestServer();
    const cookie = await s.login();
    let expected = emptyData();
    let sawFoods = false;
    let sawPhotos = false;

    for (let round = 0; round < 12; round++) {
      const batch = randomOps(rnd, 1 + Math.floor(rnd() * 25));
      const res = await postOps(s, cookie, batch);
      expect(res.status).toBe(200);
      expected = applyOps(expected, batch);
      expect(await getData(s, cookie)).toEqual(expected);
      sawFoods ||= expected.foods.some((f) => f.count > 1);
      sawPhotos ||= Object.values(expected.days).some((d) => d.photos !== undefined);
    }
    // Guards the generator: the interesting cases really occurred.
    expect({ sawFoods, sawPhotos }).toEqual({ sawFoods: true, sawPhotos: true });
  });
});
