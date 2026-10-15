import {
  applyOps,
  defaultSettings,
  emptyData,
  hasLegacyFood,
  LEGACY_MEAL_ID,
  LIMITS,
  MAX_OPS_PER_REQUEST,
  normalizeDay,
  opSchema,
  WORKOUT_TYPES,
  type AppData,
  type DayEntry,
  type DayMeta,
  type FoodUse,
  type Meal,
  type MealItem,
  type Op,
  type Settings,
  type SettingsPut,
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

describe('meals, day.meta and Rule L ops', () => {
  const D = '2026-10-10';
  const P1 = 'AAAAAAAAAAAAAAAAAAAAAA';
  const P2 = 'BBBBBBBBBBBBBBBBBBBBBB';
  const meal = (patch: Partial<Meal> = {}): Meal => ({
    id: 'breakfast001',
    type: 'Сніданок',
    time: '08:30',
    text: 'Тост з тунцем, кава',
    kcal: 420,
    protein: 27,
    fat: 11,
    carbs: 36,
    ...patch,
  });
  const lunch = meal({
    id: 'lunch0000001',
    type: 'Обід',
    time: '13:10',
    text: 'Борщ',
    kcal: 500,
    protein: null,
  });

  /** Posts the ops and checks that the server stored exactly what applyOps() gives on the previous state. */
  async function session() {
    const s = await createTestServer();
    const cookie = await s.login();
    let reference = emptyData();
    const send = async (ops: unknown[]): Promise<AppData> => {
      const res = await postOps(s, cookie, ops);
      expect(res.status, await res.clone().text()).toBe(200);
      reference = applyOps(
        reference,
        ops.map((op) => opSchema.parse(op)),
      );
      const data = await getData(s, cookie);
      expect(data).toEqual(reference);
      return data;
    };
    return { s, cookie, send };
  }

  /** The legacy view an old client has of a stored day (it knows no meals). */
  const oldView = (d: DayEntry | undefined, patch: Partial<DayEntry> = {}): DayEntry => ({
    food: d?.food ?? '',
    kcal: d?.kcal ?? null,
    trained: d?.trained ?? null,
    types: d?.types ?? [],
    notes: d?.notes ?? '',
    ...(d?.photos ? { photos: d.photos } : {}),
    ...patch,
  });

  it('meal.put converts a legacy day, upserts by id; meal.delete removes; derived fields follow', async () => {
    const { send } = await session();
    await send([{ kind: 'day.put', date: D, value: day({ food: 'Борщ', kcal: 500, photos: [P1] }) }]);
    let data = await send([{ kind: 'meal.put', date: D, value: meal({ photos: [P2] }) }]);
    expect(data.days[D]?.meals?.map((m) => m.id)).toEqual(['breakfast001', LEGACY_MEAL_ID]);
    expect(data.days[D]).toMatchObject({
      food: 'Сніданок: Тост з тунцем, кава\nБорщ',
      kcal: 920,
      photos: [P2, P1],
    });

    data = await send([
      { kind: 'meal.put', date: D, value: meal({ text: 'Омлет', kcal: 300, photos: [P2] }) },
    ]);
    expect(data.days[D]?.meals?.[0]).toMatchObject({ text: 'Омлет', kcal: 300 });
    data = await send([{ kind: 'meal.delete', date: D, id: LEGACY_MEAL_ID }]);
    expect(data.days[D]).toMatchObject({ food: 'Сніданок: Омлет', kcal: 300, photos: [P2] });
    data = await send([{ kind: 'meal.delete', date: D, id: 'breakfast001' }]);
    // The workout mark is kept, nothing of the food is left; without it the day goes away.
    expect(data.days[D]).toEqual(day({ food: '', kcal: null }));
    // Unknown ids and missing days are no-ops.
    await send([
      { kind: 'meal.delete', date: D, id: 'nope' },
      { kind: 'meal.delete', date: '2026-10-11', id: 'x' },
    ]);
  });

  it('a meal day round-trips through the database, positions and macros included', async () => {
    const { send } = await session();
    const withItems = meal({
      text: '',
      items: [
        { name: 'Тост з тунцем', portion: '2 шт', kcal: 310, protein: 24, fat: 8, carbs: 31 },
        { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: 3.5, carbs: null },
      ],
    });
    const data = await send([
      { kind: 'meal.put', date: D, value: withItems },
      { kind: 'meal.put', date: D, value: lunch },
    ]);
    expect(data.days[D]?.meals?.[0]).toMatchObject({ kcal: 370, protein: 27, fat: 11.5, carbs: 31 });
    expect(data.days[D]?.kcal).toBe(870);
  });

  it('a 21st meal changes nothing', async () => {
    const { send } = await session();
    const meals = Array.from({ length: 20 }, (_, i) => ({
      kind: 'meal.put',
      date: D,
      value: meal({ id: `m${i}`, time: null, text: `страва ${i}` }),
    }));
    const full = await send(meals);
    expect(full.days[D]?.meals).toHaveLength(20);
    const after = await send([{ kind: 'meal.put', date: D, value: meal({ id: 'm20', text: 'ще одна' }) }]);
    expect(after.days[D]).toEqual(full.days[D]);
  });

  it('day.meta writes only the keys it carries, keeps meals, creates no empty day', async () => {
    const { send } = await session();
    await send([{ kind: 'meal.put', date: D, value: meal() }]);
    let data = await send([{ kind: 'day.meta', date: D, value: { trained: true, types: ['Кардіо'] } }]);
    expect(data.days[D]).toMatchObject({ trained: true, types: ['Кардіо'], notes: '' });
    data = await send([{ kind: 'day.meta', date: D, value: { notes: 'Сон 8 год' } }]);
    expect(data.days[D]).toMatchObject({ trained: true, types: ['Кардіо'], notes: 'Сон 8 год' });
    data = await send([{ kind: 'day.meta', date: D, value: { trained: false } }]);
    expect(data.days[D]).toMatchObject({ trained: false, types: [], notes: 'Сон 8 год' });
    expect(data.days[D]?.meals).toHaveLength(1);
    data = await send([{ kind: 'day.meta', date: '2026-10-11', value: { notes: ' ' } }]);
    expect(data.days).not.toHaveProperty('2026-10-11');
  });

  it('Rule L (a, b, c): old-client day.put keeps meals, adds new lines once, ignores removals', async () => {
    const { send } = await session();
    const stored = (
      await send([
        { kind: 'meal.put', date: D, value: meal({ photos: [P1] }) },
        { kind: 'meal.put', date: D, value: lunch },
      ])
    ).days[D];
    // (a) ✓ from an old client.
    let data = await send([
      { kind: 'day.put', date: D, value: oldView(stored, { trained: true, types: ['Прес'] }) },
    ]);
    expect(data.days[D]).toEqual({ ...stored, trained: true, types: ['Прес'] });
    // (b) an appended line + more kcal → one untyped meal; a replay adds nothing.
    const appended = oldView(data.days[D], {
      food: `${stored?.food}\nСалат — 200 ккал`,
      kcal: 1120,
      photos: [P1, P2],
    });
    data = await send([{ kind: 'day.put', date: D, value: appended }]);
    const extra = data.days[D]?.meals?.[2];
    expect(extra).toMatchObject({ type: '', time: null, text: 'Салат — 200 ккал', kcal: 200, photos: [P2] });
    expect(extra?.id).toMatch(/^old-/);
    const replayed = await send([{ kind: 'day.put', date: D, value: appended }]);
    expect(replayed.days[D]).toEqual(data.days[D]);
    // (c) removals are ignored.
    const cut = await send([
      { kind: 'day.put', date: D, value: oldView(stored, { food: '', kcal: null, photos: [] }) },
    ]);
    expect(cut.days[D]?.meals).toEqual(data.days[D]?.meals);
  });

  it('Rule L (d, g): a stale outbox op adds nothing; an old day.delete keeps meals, clears the mark', async () => {
    const { send } = await session();
    await send([
      { kind: 'day.put', date: D, value: day({ food: 'борщ', kcal: 500, trained: true, notes: 'n' }) },
    ]);
    const converted = await send([
      {
        kind: 'meal.put',
        date: D,
        value: {
          id: LEGACY_MEAL_ID,
          type: 'Обід',
          time: null,
          text: 'борщ',
          kcal: 500,
          protein: null,
          fat: null,
          carbs: null,
        },
      },
    ]);
    expect(converted.days[D]?.food).toBe('Обід: борщ');
    // (d) an op queued by an old client before the conversion.
    const d = await send([
      { kind: 'day.put', date: D, value: day({ food: 'борщ', kcal: 500, trained: true, notes: 'n' }) },
    ]);
    expect(d.days[D]?.meals).toEqual(converted.days[D]?.meals);
    // (g) old day.delete.
    const g = await send([{ kind: 'day.delete', date: D }]);
    expect(g.days[D]).toMatchObject({ trained: null, types: [], notes: '', food: 'Обід: борщ', kcal: 500 });
    expect(g.days[D]?.meals).toHaveLength(1);
  });

  it('Rule L (h): at 20 meals the extra merges into the last meal without positions; a replay adds nothing', async () => {
    const { send } = await session();
    const ops = Array.from({ length: 20 }, (_, i) => ({
      kind: 'meal.put',
      date: D,
      value: meal({ id: i === 4 ? LEGACY_MEAL_ID : `m${i}`, time: null, text: `страва ${i}`, kcal: 10 }),
    }));
    const full = (await send(ops)).days[D];
    const value = oldView(full, { food: `${full?.food}\nСалат`, kcal: (full?.kcal ?? 0) + 150 });
    const merged = await send([{ kind: 'day.put', date: D, value }]);
    expect(merged.days[D]?.meals).toHaveLength(20);
    expect(merged.days[D]?.meals?.[4]).toMatchObject({
      id: LEGACY_MEAL_ID,
      text: 'страва 4\nСалат',
      kcal: 160,
    });
    expect((await send([{ kind: 'day.put', date: D, value }])).days[D]).toEqual(merged.days[D]);
  });

  it('known limits (e, f): a deleted meal comes back from a stale client; its kcal increase is lost', async () => {
    const { send } = await session();
    const dinner = meal({ id: 'dinner000001', type: 'Вечеря', time: '19:00', text: 'Салат', kcal: 500 });
    const before = (
      await send([
        { kind: 'meal.put', date: D, value: meal() },
        { kind: 'meal.put', date: D, value: dinner },
      ])
    ).days[D];
    await send([{ kind: 'meal.delete', date: D, id: dinner.id }]);
    const e = await send([{ kind: 'day.put', date: D, value: oldView(before, { trained: true }) }]);
    expect(e.days[D]?.meals?.[1]).toMatchObject({ type: '', text: 'Вечеря: Салат', kcal: 500 });

    const F = '2026-10-11';
    await send([{ kind: 'day.put', date: F, value: day({ food: 'борщ', kcal: 500 }) }]);
    await send([
      {
        kind: 'meal.put',
        date: F,
        value: meal({ id: 'obid00000001', type: 'Обід', time: '13:00', text: 'суп', kcal: 300 }),
      },
    ]);
    const f = await send([{ kind: 'day.put', date: F, value: day({ food: 'борщ, хліб', kcal: 650 }) }]);
    expect(f.days[F]?.kcal).toBe(800);
    expect(f.days[F]?.meals?.[2]).toMatchObject({ type: '', text: 'борщ, хліб', kcal: null });
  });

  it('a day.put carrying a meals key changes no meal', async () => {
    const { send } = await session();
    const stored = (await send([{ kind: 'meal.put', date: D, value: meal() }])).days[D];
    const data = await send([
      {
        kind: 'day.put',
        date: D,
        value: { ...oldView(stored), meals: [meal({ id: 'injected0001', text: 'чужий' })] },
      },
    ]);
    expect(data.days[D]).toEqual(stored);
    // On a legacy day too: the value is legacy-shaped.
    const legacy = await send([
      { kind: 'day.put', date: '2026-10-11', value: { ...day({ food: 'Каша' }), meals: [meal()] } },
    ]);
    expect(legacy.days['2026-10-11']).toEqual(day({ food: 'Каша' }));
  });

  it('settings.put without mealTypes / macroGoals keeps them; with them replaces them', async () => {
    const { send } = await session();
    await send([
      {
        kind: 'settings.put',
        value: {
          ...defaultSettings(),
          mealTypes: ['Сніданок', 'Після тренування'],
          macroGoals: { protein: 90, fat: 60, carbs: null },
        },
      },
    ]);
    const { mealTypes: _m, macroGoals: _g, ...oldClient } = { ...defaultSettings(), goal: 57 };
    let data = await send([{ kind: 'settings.put', value: oldClient }]);
    expect(data.settings).toMatchObject({
      goal: 57,
      mealTypes: ['Сніданок', 'Після тренування'],
      macroGoals: { protein: 90, fat: 60, carbs: null },
    });
    data = await send([
      {
        kind: 'settings.put',
        value: { ...defaultSettings(), mealTypes: [], macroGoals: { protein: null, fat: null, carbs: 200 } },
      },
    ]);
    expect(data.settings).toMatchObject({
      mealTypes: [],
      macroGoals: { protein: null, fat: null, carbs: 200 },
    });
  });

  it('food.use keeps dish macros (D13): own macros win, an old use keeps them only at the same kcal', async () => {
    const { send } = await session();
    let data = await send([
      {
        kind: 'food.use',
        date: D,
        value: { name: 'Борщ', portion: '300 г', kcal: 180, protein: 6, fat: 9, carbs: 19 },
      },
      { kind: 'food.use', date: D, value: { name: 'Яблуко', portion: '1 шт', kcal: 80 } },
    ]);
    expect(data.foods).toEqual([
      { name: 'Борщ', portion: '300 г', kcal: 180, count: 1, lastUsed: D, protein: 6, fat: 9, carbs: 19 },
      { name: 'Яблуко', portion: '1 шт', kcal: 80, count: 1, lastUsed: D },
    ]);
    data = await send([{ kind: 'food.use', date: D, value: { name: 'борщ', portion: '300 г', kcal: 180 } }]);
    expect(data.foods.find((f) => f.count === 2)).toMatchObject({ protein: 6, fat: 9, carbs: 19 });
    data = await send([{ kind: 'food.use', date: D, value: { name: 'Борщ', portion: '400 г', kcal: 240 } }]);
    expect(data.foods.find((f) => f.count === 3)).not.toHaveProperty('protein');
  });

  it.each([
    ['meal id', { kind: 'meal.put', date: D, value: { ...meal(), id: 'bad id' } }],
    ['meal macro step', { kind: 'meal.put', date: D, value: meal({ protein: 1.2 }) }],
    ['meal macro limit', { kind: 'meal.put', date: D, value: meal({ fat: 3001 }) }],
    ['meal type length', { kind: 'meal.put', date: D, value: meal({ type: 'т'.repeat(31) }) }],
    ['meal.delete id', { kind: 'meal.delete', date: D, id: '' }],
    ['empty day.meta', { kind: 'day.meta', date: D, value: {} }],
    [
      'macro goal',
      {
        kind: 'settings.put',
        value: { ...defaultSettings(), macroGoals: { protein: 0, fat: null, carbs: null } },
      },
    ],
    [
      'null dish macro',
      { kind: 'food.use', date: D, value: { name: 'Борщ', portion: '', kcal: 1, carbs: null } },
    ],
  ])('rejects an invalid new op (%s) with its index, applying nothing', async (_name, bad) => {
    const s = await createTestServer();
    const cookie = await s.login();
    const res = await postOps(s, cookie, [{ kind: 'meal.put', date: D, value: meal() }, bad]);
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'invalid_op', index: 1 });
    expect((await getData(s, cookie)).days).toEqual({});
  });

  it('stores the normalised meal (trims, 0.5 g, sums of positions)', async () => {
    const { send } = await session();
    const data = await send([
      {
        kind: 'meal.put',
        date: D,
        value: meal({
          type: '  Після   тренування ',
          text: '  протеїн  ',
          items: [{ name: ' Шейк ', portion: '', kcal: 120, protein: 24.5, fat: 1, carbs: 3 }],
        }),
      },
    ]);
    expect(data.days[D]?.meals?.[0]).toMatchObject({
      type: 'Після тренування',
      text: 'протеїн',
      kcal: 120,
      protein: 24.5,
    });
    expect(data.days[D]).toEqual(normalizeDay(data.days[D] as DayEntry));
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

  /** Without mealTypes / macroGoals half the time, as an old client sends it (the stored ones are kept). */
  const randomSettings = (): SettingsPut => {
    const days = Array.from({ length: Math.floor(rnd() * 4) }, () => Math.floor(rnd() * 7) as Weekday);
    const settings: SettingsPut = {
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
    if (chance(0.5))
      settings.mealTypes = pick([[], ['Сніданок', ' Після тренування ', 'сніданок'], ['Ланч']]);
    if (chance(0.5)) settings.macroGoals = { protein: pick([null, 90]), fat: pick([null, 60]), carbs: null };
    return settings;
  };

  const macro = (max: number): number | null => (chance(0.3) ? null : Math.round(rnd() * max * 2) / 2);
  const mealIds = ['m1', 'm2', 'm3', LEGACY_MEAL_ID, 'old-abc'];
  const randomItem = (): MealItem => ({
    name: pick(dishPool.filter((d) => d.trim())),
    portion: pick(portionPool),
    kcal: Math.floor(rnd() * 600),
    protein: macro(60),
    fat: macro(40),
    carbs: macro(90),
  });
  const randomMeal = (): Meal => {
    const meal: Meal = {
      id: pick(mealIds),
      type: pick(['', 'Сніданок', ' Обід ', 'Перекус', 'Після тренування']),
      time: pick([null, '08:30', '13:00', '19:30', '13:00']),
      // Sometimes empty: an empty meal deletes that meal.
      text: pick(['', '', ...texts]),
      kcal: chance(0.4) ? null : Math.floor(rnd() * 900),
      protein: macro(100),
      fat: macro(80),
      carbs: macro(150),
    };
    if (chance(0.3)) meal.photos = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => pick(photoPool));
    if (chance(0.3)) meal.items = Array.from({ length: 1 + Math.floor(rnd() * 3) }, randomItem);
    return meal;
  };
  const randomMeta = (): DayMeta => {
    const meta: DayMeta = {};
    if (chance(0.5)) meta.trained = pick([true, false, null] as const);
    if (chance(0.4)) meta.types = Array.from({ length: Math.floor(rnd() * 3) }, () => pick(typePool));
    if (chance(0.4) || Object.keys(meta).length === 0) meta.notes = pick(texts);
    return meta;
  };
  /** Food use, with all, some or no macro keys (never null: the key is omitted when unknown). */
  const randomUse = (): FoodUse => {
    const use: FoodUse = {
      name: pick(dishPool),
      portion: pick(portionPool),
      kcal: pick([180, 240, Math.floor(rnd() * 900)]),
    };
    if (chance(0.5)) use.protein = Math.round(rnd() * 80) / 2;
    if (chance(0.4)) use.fat = Math.round(rnd() * 60) / 2;
    if (chance(0.4)) use.carbs = Math.round(rnd() * 120) / 2;
    return use;
  };

  const makers: (() => Op)[] = [
    () => ({ kind: 'day.put', date: pick(dates), value: randomDay() }),
    // Legacy-shaped writes of an old client with food on whatever the day is now (Rule L on meal days).
    () => ({
      kind: 'day.put',
      date: pick(dates),
      value: { ...randomDay(), food: pick(['Омлет', 'Салат\nі суп']) },
    }),
    () => ({
      kind: 'day.put',
      date: pick(dates),
      value: { ...randomDay(), kcal: 400 + Math.floor(rnd() * 900) },
    }),
    () => ({ kind: 'day.meta', date: pick(dates), value: randomMeta() }),
    () => ({ kind: 'meal.put', date: pick(dates), value: randomMeal() }),
    () => ({ kind: 'meal.put', date: pick(dates), value: randomMeal() }),
    () => ({ kind: 'meal.put', date: pick(dates), value: randomMeal() }),
    () => ({ kind: 'meal.delete', date: pick(dates), id: pick(mealIds) }),
    () => ({ kind: 'food.use', date: pick(dates), value: randomUse() }),
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
    const saw = {
      foods: false,
      photos: false,
      mealDays: false,
      legacyConversion: false,
      ruleL: false,
      dishMacros: false,
      keptMealTypes: false,
    };

    for (let round = 0; round < 12; round++) {
      const batch = randomOps(rnd, 1 + Math.floor(rnd() * 25));
      const res = await postOps(s, cookie, batch);
      expect(res.status).toBe(200);
      // The server parses every op (zod defaults / trims / strips), so the reference gets the same values.
      const parsed = batch.map((op) => opSchema.parse(op));
      for (const op of parsed) {
        const before = 'date' in op ? expected.days[op.date] : undefined;
        const next = applyOps(expected, [op]);
        const after = 'date' in op ? next.days[op.date] : undefined;
        const ids = new Set(before?.meals?.map((m) => m.id) ?? []);
        if (
          op.kind === 'meal.put' &&
          hasLegacyFood(before) &&
          after?.meals?.some((m) => m.id === LEGACY_MEAL_ID)
        ) {
          saw.legacyConversion = true;
        }
        if (
          op.kind === 'day.put' &&
          before?.meals &&
          after?.meals?.some((m) => m.id.startsWith('old-') && !ids.has(m.id))
        ) {
          saw.ruleL = true;
        }
        if (op.kind === 'settings.put' && !op.value.mealTypes && expected.settings.mealTypes.length !== 4) {
          saw.keptMealTypes = true;
        }
        expected = next;
      }
      expect(await getData(s, cookie)).toEqual(expected);
      saw.foods ||= expected.foods.some((f) => f.count > 1);
      saw.photos ||= Object.values(expected.days).some((d) => d.photos !== undefined);
      saw.mealDays ||= Object.values(expected.days).some((d) => (d.meals?.length ?? 0) > 1);
      saw.dishMacros ||= expected.foods.some((f) => f.protein !== undefined);
    }
    // Guards the generator: the interesting cases really occurred.
    expect(saw).toEqual({
      foods: true,
      photos: true,
      mealDays: true,
      legacyConversion: true,
      ruleL: true,
      dishMacros: true,
      keptMealTypes: true,
    });
  });
});
