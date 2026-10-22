import {
  DEFAULT_MEAL_TYPES,
  defaultSettings,
  emptyData,
  emptyMacroGoals,
  normalizeDay,
  type AppData,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { createTestServer, json } from './helpers';

const sample: AppData = {
  days: {
    '2026-10-09': {
      food: 'Вівсянка',
      kcal: 1500,
      trained: true,
      types: ['Кардіо', 'Прес'],
      notes: 'легко',
      photos: ['AAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBB'],
    },
    '2026-10-10': { food: '', kcal: 1800, trained: false, types: [], notes: '' },
  },
  weights: [
    { date: '2026-10-03', kg: 66 },
    { date: '2026-10-10', kg: 65.4 },
  ],
  measures: [{ date: '2026-10-10', chest: 90, waist: 70, hips: 98.5 }],
  foods: [
    { name: 'Вівсянка з бананом', portion: '250 г', kcal: 350, count: 4, lastUsed: '2026-10-09' },
    { name: 'Кава з молоком', portion: '1 чашка (250 мл)', kcal: 60, count: 9, lastUsed: '2026-10-10' },
  ],
  settings: { ...defaultSettings(), goal: 60, onboarded: true, stepsGoal: 9000 },
  // Workouts and steps (schema v5).
  exercises: [
    {
      id: 'ownExercise01',
      name: 'Степ-аеробіка',
      kind: 'cardio',
      primary: ['quads', 'calves'],
      secondary: ['glutes'],
      equipment: 'other',
      met: 7,
    },
  ],
  workouts: [
    {
      id: 'workout00001',
      name: 'Ноги + прес',
      days: [1, 3],
      items: [
        {
          key: 'item1',
          exerciseId: 'lib.back-squat',
          sets: [{ reps: 12, kg: 40, sec: null, min: null, km: null }],
          restSec: 90,
        },
      ],
    },
  ],
  sessions: [
    {
      id: 'session00001',
      date: '2026-10-09',
      workoutId: 'workout00001',
      name: 'Ноги + прес',
      createdAt: 1_760_000_000_000,
      startedAt: 1_760_000_000_000,
      finishedAt: 1_760_002_880_000,
      durationSec: 2880,
      status: 'done',
      exercises: [
        {
          key: 'item1',
          exerciseId: 'lib.back-squat',
          name: 'Присідання зі штангою',
          kind: 'weight',
          met: 5,
          equipment: 'barbell',
          primary: ['quads', 'glutes'],
          secondary: ['hamstrings'],
          restSec: 90,
          skipped: false,
          sets: [{ reps: 12, kg: 40, sec: null, min: null, km: null, done: true }],
        },
      ],
      notes: '',
      rev: 3,
      deviceId: null,
    },
  ],
  steps: [
    { date: '2026-10-09', steps: 8400 },
    { date: '2026-10-10', steps: 11000 },
  ],
  deletedSessions: ['goneSession01'],
};

describe('export / import', () => {
  it('round-trips everything', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const imported = await s.call('/api/import', { cookie, body: sample });
    expect(imported.status).toBe(200);
    expect(await json(imported)).toEqual({ ok: true });

    const res = await s.call('/api/export', { cookie });
    expect(res.status).toBe(200);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    // Clock is 2026-10-09 09:00 UTC = 12:00 in Kyiv.
    expect(res.headers.get('Content-Disposition')).toBe('attachment; filename="legko-2026-10-09.json"');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const exported = await json<AppData>(res);
    expect(exported).toEqual(sample);

    // Importing the export into a fresh server reproduces the same data.
    const other = await createTestServer();
    const otherCookie = await other.login();
    expect((await other.call('/api/import', { cookie: otherCookie, body: exported })).status).toBe(200);
    expect(await json(await other.call('/api/data', { cookie: otherCookie }))).toEqual(sample);
  });

  it('export is a plain download link (no X-Legko-User) named after the day in the user’s own zone', async () => {
    const s = await createTestServer();
    const anna = await s.login('anna');
    const olya = await s.createUser('olya');
    const zone = (cookie: string, timezone: string) =>
      s.call('/api/ops', {
        cookie,
        body: { ops: [{ kind: 'settings.put', value: { ...defaultSettings(), timezone } }] },
      });
    await zone(anna, 'Pacific/Kiritimati');
    await zone(olya.cookie, 'Pacific/Pago_Pago');
    // 11:00 UTC: already 10 October on Kiritimati (UTC+14), still 9 October in Pago Pago (UTC−11).
    s.clock.now = Date.UTC(2026, 9, 9, 11, 0);
    const disposition = async (cookie: string) =>
      (await s.call('/api/export', { cookie, userHeader: null })).headers.get('Content-Disposition');
    expect(await disposition(anna)).toBe('attachment; filename="legko-2026-10-10.json"');
    expect(await disposition(olya.cookie)).toBe('attachment; filename="legko-2026-10-09.json"');
  });

  it('import replaces the importer’s data only', async () => {
    const s = await createTestServer();
    const anna = await s.login('anna');
    const olya = await s.createUser('olya');
    expect((await s.call('/api/import', { cookie: anna, body: sample })).status).toBe(200);
    expect((await s.call('/api/import', { cookie: olya.cookie, body: emptyData() })).status).toBe(200);
    expect(await json(await s.call('/api/export', { cookie: anna }))).toEqual(sample);
    expect(await json(await s.call('/api/export', { cookie: olya.cookie }))).toEqual(emptyData());
  });

  it('replaces existing data instead of merging', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/ops', {
      cookie,
      body: {
        ops: [
          { kind: 'weight.put', date: '2025-01-01', kg: 80 },
          { kind: 'food.use', date: '2025-01-01', value: { name: 'Борщ', portion: '300 г', kcal: 180 } },
          { kind: 'food.use', date: '2025-01-01', value: { name: 'кава з молоком', portion: '', kcal: 40 } },
        ],
      },
    });
    await s.call('/api/import', { cookie, body: sample });
    const data = await json<AppData>(await s.call('/api/data', { cookie }));
    expect(data.weights).toEqual(sample.weights);
    expect(data.foods).toEqual(sample.foods);
  });

  it('an older backup (no workouts or steps) clears them: that is what restoring means', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/import', { cookie, body: sample });
    const { exercises: _e, workouts: _w, sessions: _s, steps: _t, deletedSessions: _d, ...old } = sample;
    const { stepsGoal: _g, ...oldSettings } = old.settings;
    expect((await s.call('/api/import', { cookie, body: { ...old, settings: oldSettings } })).status).toBe(200);
    const data = await json<AppData>(await s.call('/api/data', { cookie }));
    expect(data).toEqual({
      ...sample,
      settings: { ...sample.settings, stepsGoal: null },
      exercises: [],
      workouts: [],
      sessions: [],
      steps: [],
      deletedSessions: [],
    });
  });

  it('rejects a backup with an invalid session or a lib.* own exercise', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    for (const body of [
      { ...sample, exercises: [{ ...sample.exercises[0], id: 'lib.plank' }] },
      { ...sample, sessions: [{ ...sample.sessions[0], durationSec: -5 }] },
      { ...sample, steps: [...sample.steps, { date: '2026-10-09', steps: 5 }] },
    ]) {
      const res = await s.call('/api/import', { cookie, body });
      expect(res.status).toBe(400);
    }
  });

  it('imports a backup made before «Часті страви» existed (no foods → none)', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/import', { cookie, body: sample });
    const { foods: _foods, ...old } = sample;
    expect((await s.call('/api/import', { cookie, body: old })).status).toBe(200);
    expect(await json(await s.call('/api/data', { cookie }))).toEqual({ ...sample, foods: [] });
  });

  it('round-trips days with meals, meal types, macro goals and dish macros (export → import deep-equal)', async () => {
    const withMeals: AppData = {
      ...sample,
      days: {
        ...sample.days,
        '2026-10-11': normalizeDay({
          food: '',
          kcal: null,
          trained: true,
          types: ['Кардіо'],
          notes: '',
          meals: [
            {
              id: 'breakfast001',
              type: 'Сніданок',
              time: '08:30',
              text: 'Вівсянка з бананом, кава з молоком',
              kcal: null,
              protein: null,
              fat: null,
              carbs: null,
              items: [
                { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, protein: 9, fat: 6, carbs: 58 },
                { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 },
              ],
              photos: ['CCCCCCCCCCCCCCCCCCCCCC'],
            },
            {
              id: 'snack0000001',
              type: 'Перекус',
              time: '09:40',
              text: 'Яблуко',
              kcal: 80,
              protein: null,
              fat: null,
              carbs: null,
            },
          ],
        }),
      },
      foods: [
        ...sample.foods,
        {
          name: 'Борщ',
          portion: '300 г',
          kcal: 180,
          count: 3,
          lastUsed: '2026-10-11',
          protein: 6,
          fat: 9,
          carbs: 19,
        },
      ],
      settings: {
        ...sample.settings,
        mealTypes: ['Сніданок', 'Після тренування'],
        macroGoals: { protein: 90, fat: 60, carbs: null },
      },
    };
    const s = await createTestServer();
    const cookie = await s.login();
    expect((await s.call('/api/import', { cookie, body: withMeals })).status).toBe(200);
    const exported = await json<AppData>(await s.call('/api/export', { cookie }));
    expect(exported).toEqual(withMeals);
    expect(exported.days['2026-10-11']).toMatchObject({
      kcal: 460,
      food: 'Сніданок: Вівсянка з бананом, кава з молоком\nПерекус: Яблуко',
    });

    const other = await createTestServer();
    const otherCookie = await other.login();
    expect((await other.call('/api/import', { cookie: otherCookie, body: exported })).status).toBe(200);
    expect(await json(await other.call('/api/data', { cookie: otherCookie }))).toEqual(withMeals);
  });

  it('imports a backup made before meals and macros (no meals, meal types, macro goals or dish macros)', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const { mealTypes: _m, macroGoals: _g, ...oldSettings } = sample.settings;
    const old = { ...sample, settings: oldSettings };
    expect((await s.call('/api/import', { cookie, body: old })).status).toBe(200);
    const data = await json<AppData>(await s.call('/api/data', { cookie }));
    expect(data).toEqual({
      ...sample,
      settings: { ...sample.settings, mealTypes: [...DEFAULT_MEAL_TYPES], macroGoals: emptyMacroGoals() },
    });
    for (const day of Object.values(data.days)) expect(day).not.toHaveProperty('meals');
  });

  it('a backup day with meals: [] is a legacy day that keeps its food', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const body = { ...sample, days: { '2026-10-09': { ...sample.days['2026-10-09'], meals: [] } } };
    expect((await s.call('/api/import', { cookie, body })).status).toBe(200);
    const data = await json<AppData>(await s.call('/api/data', { cookie }));
    expect(data.days).toEqual({ '2026-10-09': sample.days['2026-10-09'] });
  });

  it('rejects a backup with duplicate meal ids', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const m = { id: 'x', type: '', time: null, text: 'a', kcal: null, protein: null, fat: null, carbs: null };
    const body = { ...sample, days: { '2026-10-09': { ...sample.days['2026-10-09'], meals: [m, m] } } };
    const res = await s.call('/api/import', { cookie, body });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'bad_request' });
  });

  it('normalises imported records the same way ops do', async () => {
    const s = await createTestServer();
    const cookie = await s.login();
    const messy: AppData = {
      ...emptyData(),
      days: {
        '2026-10-01': { food: '  ', kcal: null, trained: null, types: [], notes: '' },
        '2026-10-02': { food: ' Суп ', kcal: null, trained: false, types: ['Кардіо'], notes: '' },
      },
      measures: [{ date: '2026-10-01', chest: null, waist: null, hips: null }],
    };
    expect((await s.call('/api/import', { cookie, body: messy })).status).toBe(200);
    const data = await json<AppData>(await s.call('/api/data', { cookie }));
    expect(data.days).toEqual({
      '2026-10-02': { food: 'Суп', kcal: null, trained: false, types: [], notes: '' },
    });
    expect(data.measures).toEqual([]);
  });

  it.each([
    ['missing settings', { days: {}, weights: [], measures: [] }],
    ['duplicate weight dates', { ...sample, weights: [...sample.weights, { date: '2026-10-10', kg: 65 }] }],
    ['invalid date key', { ...sample, days: { '2026-13-01': sample.days['2026-10-09'] } }],
    ['weight out of range', { ...sample, weights: [{ date: '2026-10-10', kg: 4 }] }],
    [
      'duplicate dish names',
      { ...sample, foods: [...sample.foods, { ...sample.foods[0], name: ' ВІВСЯНКА з бананом' }] },
    ],
    [
      'bad photo id',
      { ...sample, days: { '2026-10-09': { ...sample.days['2026-10-09'], photos: ['../x'] } } },
    ],
    ['not an object', [1, 2, 3]],
  ])('rejects %s with bad_request and keeps the old data', async (_name, body) => {
    const s = await createTestServer();
    const cookie = await s.login();
    await s.call('/api/import', { cookie, body: sample });
    const res = await s.call('/api/import', { cookie, body });
    expect(res.status).toBe(400);
    expect(await json(res)).toMatchObject({ error: 'bad_request' });
    expect(await json(await s.call('/api/data', { cookie }))).toEqual(sample);
  });
});
