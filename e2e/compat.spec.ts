/**
 * Compatibility of the meals release with what older builds send and keep (docs/meals-macros.md §3), checked
 * against the real server bundle over HTTP — no browser: an old cached PWA, an old offline outbox and old backup
 * files only ever talk to the API. Since accounts, `ServerApi` sends `X-Legko-User` by default (anna's v4 session
 * needs it); the last describe is the pre-accounts bundle itself (docs/multi-user.md §10).
 */
import type { APIResponse } from '@playwright/test';
import {
  API,
  DEFAULT_MEAL_TYPES,
  emptyMacroGoals,
  USER_HEADER,
  type AppData,
  type DayEntry,
  type LoginResponse,
} from '../packages/shared/src/index';
import { demo, MEALS_GOALS, MEALS_TODAY, meals, training } from './fixtures/data';
import { BASE_URL, PASSWORD, TODAY, USERNAME } from './support/env';
import type { ServerApi } from './support/server';
import { expect, test } from './support/test';

/** What every mutating request needs (CSRF guard). */
const MUTATION = { Origin: BASE_URL, 'Content-Type': 'application/json' };

/** What a build from before meals shows of a day — the derived fields — and sends back in its `day.put`. */
function oldView(d: DayEntry, patch: Partial<DayEntry> = {}): DayEntry {
  return {
    food: d.food,
    kcal: d.kcal,
    trained: d.trained,
    types: d.types,
    notes: d.notes,
    ...(d.photos ? { photos: d.photos } : {}),
    ...patch,
  };
}

async function expectOk(res: APIResponse): Promise<void> {
  expect(res.status(), await res.text()).toBe(200);
}

async function today(server: ServerApi): Promise<DayEntry> {
  const day = (await server.getData()).days[TODAY];
  expect(day, 'today is stored').toBeDefined();
  return day as DayEntry;
}

/** The demo set without anything a build before meals could not have written (meals, meal types, goals, macros). */
function oldBackup(): AppData {
  const data = demo();
  const days: AppData['days'] = {};
  for (const [date, day] of Object.entries(data.days)) {
    const { meals: _meals, ...legacy } = day;
    days[date] = legacy;
  }
  const { mealTypes: _types, macroGoals: _goals, ...settings } = data.settings;
  const foods = data.foods.map(({ protein: _p, fat: _f, carbs: _c, ...food }) => food);
  return { ...data, days, foods, settings: settings as AppData['settings'] };
}

test.describe('compatibility with old clients, outboxes and backups (API)', () => {
  test.skip(({ isMobile }) => !isMobile, 'API level: runs once, in the iphone project');

  test.beforeEach(async ({ server }) => {
    await server.importData(meals());
  });

  test('an old-shape day.put on a meal day keeps the meals and sets the workout mark', async ({ server }) => {
    const stored = await today(server);
    expect(stored.meals).toEqual(MEALS_TODAY);
    await expectOk(
      await server.sendOps([
        { kind: 'day.put', date: TODAY, value: oldView(stored, { trained: true, types: ['Кардіо'] }) },
      ]),
    );
    const after = await today(server);
    expect(after.meals).toEqual(MEALS_TODAY);
    expect(after).toMatchObject({ trained: true, types: ['Кардіо'], kcal: 460 });
  });

  test('an old-shape day.put with an extra line adds exactly one untyped meal; sending it again adds nothing', async ({
    server,
  }) => {
    const stored = await today(server);
    const value = oldView(stored, { food: `${stored.food}\nСалат з куркою`, kcal: (stored.kcal ?? 0) + 250 });
    await expectOk(await server.sendOps([{ kind: 'day.put', date: TODAY, value }]));
    const once = await today(server);
    expect(once.meals).toHaveLength(MEALS_TODAY.length + 1);
    const extra = once.meals?.find((m) => !MEALS_TODAY.some((t) => t.id === m.id));
    expect(extra).toMatchObject({ type: '', time: null, text: 'Салат з куркою', kcal: 250 });
    expect(extra?.id).toMatch(/^old-/);
    expect(once.kcal).toBe(710);

    // An outbox replays an op it is not sure was delivered.
    await expectOk(await server.sendOps([{ kind: 'day.put', date: TODAY, value }]));
    expect(await today(server)).toEqual(once);
  });

  test('an old day.delete on a meal day keeps the meals and clears the workout mark', async ({ server }) => {
    await expectOk(
      await server.sendOps([{ kind: 'day.meta', date: TODAY, value: { trained: true, notes: 'n' } }]),
    );
    expect((await today(server)).trained).toBe(true);
    await expectOk(await server.sendOps([{ kind: 'day.delete', date: TODAY }]));
    const after = await today(server);
    expect(after.meals).toEqual(MEALS_TODAY);
    expect(after).toMatchObject({ trained: null, types: [], notes: '' });
  });

  test('a day.put carrying a meals key changes no meal', async ({ server }) => {
    const stored = await today(server);
    const injected = {
      id: 'injected0001',
      type: 'Вечеря',
      time: '19:00',
      text: 'Не має з’явитися',
      kcal: 500,
      protein: null,
      fat: null,
      carbs: null,
    };
    await expectOk(
      await server.sendOps([
        { kind: 'day.put', date: TODAY, value: { ...oldView(stored), meals: [injected] } },
      ]),
    );
    expect(await today(server)).toEqual(stored);
  });

  test('settings.put without mealTypes / macroGoals keeps them', async ({ server }) => {
    const before = (await server.getData()).settings;
    await expectOk(
      await server.sendOps([
        { kind: 'settings.put', value: { ...before, mealTypes: ['Сніданок', 'Після тренування'] } },
      ]),
    );
    const { mealTypes: _types, macroGoals: _goals, ...oldClient } = { ...before, goal: 57.5 };
    await expectOk(await server.sendOps([{ kind: 'settings.put', value: oldClient }]));
    expect((await server.getData()).settings).toMatchObject({
      goal: 57.5,
      mealTypes: ['Сніданок', 'Після тренування'],
      macroGoals: MEALS_GOALS,
    });
  });

  test('an old backup imports: legacy days, the default meal types, no macro goals', async ({ server }) => {
    const backup = oldBackup();
    expect(JSON.stringify(backup)).not.toMatch(/"meals"|"mealTypes"|"macroGoals"|"protein"/);
    await server.importData(backup);
    const data = await server.getData();
    expect(Object.keys(data.days)).toEqual(Object.keys(backup.days));
    for (const day of Object.values(data.days)) expect(day).not.toHaveProperty('meals');
    // The derived text of the meal days is what an old backup kept: it is shown as one block.
    const yesterday =
      Object.keys(backup.days)
        .filter((d) => d < TODAY)
        .at(-1) ?? '';
    expect(data.days[yesterday]?.food).toBe(backup.days[yesterday]?.food);
    expect(data.days[yesterday]?.kcal).toBe(backup.days[yesterday]?.kcal);
    expect(data.settings.mealTypes).toEqual([...DEFAULT_MEAL_TYPES]);
    expect(data.settings.macroGoals).toEqual(emptyMacroGoals());
    expect(data.foods.some((f) => 'protein' in f)).toBe(false);
  });

  test('GET /api/export includes the meals and the new settings, and imports back unchanged', async ({
    server,
  }) => {
    const exported = await server.exportData();
    expect(exported.days[TODAY]?.meals).toEqual(MEALS_TODAY);
    expect(exported.settings.macroGoals).toEqual(MEALS_GOALS);
    expect(exported.settings.mealTypes).toEqual([...DEFAULT_MEAL_TYPES]);
    expect(exported.foods.find((f) => f.name === 'Борщ')).toMatchObject({ protein: 6, fat: 9, carbs: 19 });
    await server.importData(exported);
    expect(await server.getData()).toEqual(exported);
  });
});

test.describe('compatibility of the workouts and steps release with old clients and backups (API)', () => {
  test.skip(({ isMobile }) => !isMobile, 'API level: runs once, in the iphone project');

  test.beforeEach(async ({ server }) => {
    await server.importData(training());
  });

  test('raw v2 ops of an old client never erase sessions, workouts, steps or the steps goal', async ({ server }) => {
    const before = await server.getData();
    expect(before.sessions.length).toBeGreaterThan(0);
    const trainedDay = before.sessions.at(-1)?.date ?? '';
    const { stepsGoal: _goal, ...oldSettings } = { ...before.settings, goal: 59 };
    await expectOk(
      await server.sendOps([
        { kind: 'day.put', date: trainedDay, value: { food: 'Каша', kcal: 300, trained: false, types: [], notes: '' } },
        { kind: 'day.delete', date: trainedDay },
        { kind: 'day.meta', date: TODAY, value: { trained: true, types: ['Кардіо'] } },
        { kind: 'settings.put', value: oldSettings },
        { kind: 'weight.put', date: TODAY, kg: 64 },
      ]),
    );
    const after = await server.getData();
    expect(after.sessions).toEqual(before.sessions);
    expect(after.workouts).toEqual(before.workouts);
    expect(after.exercises).toEqual(before.exercises);
    expect(after.steps).toEqual(before.steps);
    expect(after.settings).toMatchObject({ goal: 59, stepsGoal: 8000 });
  });

  test('an old AppData (no workouts / steps keys, no stepsGoal) imports, with them empty', async ({ server }) => {
    const { exercises: _e, workouts: _w, sessions: _s, steps: _t, deletedSessions: _d, ...old } = demo();
    const { stepsGoal: _g, ...settings } = old.settings;
    const res = await server.request.post(`${BASE_URL}${API.import}`, {
      data: { ...old, settings },
      headers: { ...MUTATION, [USER_HEADER]: (await server.me()).id },
    });
    await expectOk(res);
    const data = await server.getData();
    expect(data).toMatchObject({ exercises: [], workouts: [], sessions: [], steps: [], deletedSessions: [] });
    expect(data.settings.stepsGoal).toBeNull();
    expect(data.days).toEqual(old.days);
  });

  test('an invalid steps op (0 steps) is refused and nothing is stored', async ({
    server,
  }) => {
    const res = await server.sendOps([{ kind: 'steps.put', date: TODAY, steps: 0 }]);
    expect(res.status()).toBe(400);
    expect((await server.getData()).steps.some((s) => s.date === TODAY)).toBe(false);
  });
});

test.describe('the pre-accounts bundle on her phone (docs/multi-user.md D3, D11, D24)', () => {
  test.skip(({ isMobile }) => !isMobile, 'API level: runs once, in the iphone project');

  test('a password-only login is anna on a legacy session that syncs without X-Legko-User until a header shows up', async ({
    server,
    playwright,
  }) => {
    await server.importData(meals());
    const old = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      // The old login form sends only the password.
      const login = await old.post(API.login, { data: { password: PASSWORD }, headers: MUTATION });
      await expectOk(login);
      const { user } = (await login.json()) as LoginResponse;
      expect(user).toMatchObject({ id: server.id, username: USERNAME, legacyOwner: true });

      // It never sends X-Legko-User: data and ops work on that session.
      const data = await old.get(API.data);
      await expectOk(data);
      expect(await data.json()).toEqual(await server.getData());
      await expectOk(
        await old.post(API.ops, {
          data: { ops: [{ kind: 'day.meta', date: TODAY, value: { notes: 'зі старої версії' } }] },
          headers: MUTATION,
        }),
      );
      expect((await today(server)).notes).toBe('зі старої версії');

      // The new bundle on the same cookie presents the header once: from then on the session needs it.
      await expectOk(await old.get(API.data, { headers: { [USER_HEADER]: server.id } }));
      expect((await old.get(API.data)).status()).toBe(409);

      // The Keychain alias «legko» (with a username) is a v4 login: its session is not legacy.
      const alias = await old.post(API.login, {
        data: { username: 'legko', password: PASSWORD },
        headers: MUTATION,
      });
      await expectOk(alias);
      expect(((await alias.json()) as LoginResponse).user.id).toBe(server.id);
      expect((await old.get(API.data)).status()).toBe(409);
      await expectOk(await old.get(API.data, { headers: { [USER_HEADER]: server.id } }));
    } finally {
      await old.dispose();
    }
  });
});
