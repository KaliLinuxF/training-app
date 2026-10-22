/**
 * Several accounts on one server and on one device (docs/multi-user.md §11.2, owned by the e2e gate):
 *
 * - API isolation: a second account sees, changes, exports and imports only its own data; another account's photo
 *   id is a 404; every admin route is a 403 for ordinary users; `X-Legko-User` naming someone else, or missing on a
 *   session made by a v4 login, is a 409 with nothing applied (D11);
 * - the same browser: logging out and in as someone else never shows or keeps the previous person's copy; an expired
 *   session with an unsent change asks before switching (D12, §8.2);
 * - a device copy from before accounts (the legacy keys) is anna's: shown, adopted, and its pending op sent;
 * - the admin bootstrap: `cli.js create-admin` prints a setup link; the new admin chooses the password in the
 *   browser and lands on «Користувачі» (§13).
 *
 * Rules (§11.2): anna and admin are never changed (they only read here); every other account is a throwaway one,
 * deleted in `finally` (the bootstrapped admin too, so exactly one usable admin remains); this file makes no failed
 * login and no failed link attempt; no server-derived date is asserted.
 */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import type { APIResponse, Page } from '@playwright/test';
import {
  API,
  emptyData,
  photoThumbUrl,
  photoUrl,
  USER_HEADER,
  type AppData,
  type Op,
} from '../packages/shared/src/index';
import { seedData } from './fixtures/data';
import type { App } from './support/app';
import { BASE_URL, TODAY } from './support/env';
import {
  apiLogin,
  createUser,
  loginContext,
  ServerApi,
  uniqueUsername,
  type TestUser,
} from './support/server';
import { expect, test } from './support/test';

const CLI = fileURLToPath(new URL('../apps/server/dist/cli.js', import.meta.url));

/** The error code of a JSON error answer. */
async function errorOf(res: APIResponse): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error;
}

async function expectStatus(res: APIResponse, status: number, code?: string): Promise<void> {
  expect(res.status(), `${res.url()}: ${await res.text()}`).toBe(status);
  if (code) expect(await errorOf(res)).toBe(code);
}

/** The «Сьогодні» workout mark «Не було», set on Home (saved through the outbox). */
async function markNoWorkout(app: App): Promise<void> {
  await app.region('Сьогодні').getByRole('button', { name: 'Не було', exact: true }).click();
  await expect(app.toast('Відмічено: без тренування')).toBeVisible();
}

/** Closes «Перші кроки» (a brand-new account gets it by itself) without saving. */
async function closeSetup(app: App): Promise<void> {
  const setup = app.sheet('Перші кроки');
  await expect(setup).toBeVisible();
  await setup.getByRole('button', { name: 'Закрити' }).click();
  await app.expectSheetClosed();
}

/** Writes idb-keyval entries (default store) the way the app keeps them; run on a same-origin page. */
function writeDeviceStore(page: Page, entries: Record<string, unknown>): Promise<void> {
  return page.evaluate(
    (values) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open('keyval-store');
        open.onupgradeneeded = () => open.result.createObjectStore('keyval');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const tx = db.transaction('keyval', 'readwrite');
          const store = tx.objectStore('keyval');
          for (const [key, value] of Object.entries(values)) store.put(value, key);
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
      }),
    entries,
  );
}

/** Deletes a throwaway account the test created outside `createUser()` (if it exists). */
async function deleteByName(admin: ServerApi, username: string): Promise<void> {
  const found = (await admin.overview()).users.find((u) => u.username === username);
  if (found) await admin.deleteUser(found.id, found.username);
}

test.describe('API isolation between accounts', () => {
  test.skip(({ isMobile }) => !isMobile, 'API level: runs once, in the iphone project');

  let other: TestUser | null = null;
  test.beforeEach(async ({ server, admin, playwright }) => {
    // The demo with training: anna also has workouts, sessions, an own exercise and steps.
    await server.importData(seedData('training'));
    other = await createUser(playwright, admin);
  });
  test.afterEach(async () => {
    await other?.dispose();
    other = null;
  });
  const b = (): TestUser => {
    if (!other) throw new Error('no second account');
    return other;
  };

  test('a new account sees none of anna’s records; its ops, export and import never touch hers', async ({
    server,
  }) => {
    const anna = await server.getData();
    // Precondition: anna has something on every table.
    expect(Object.keys(anna.days).length).toBeGreaterThan(10);
    expect(anna.weights.length).toBeGreaterThan(2);
    expect(anna.measures.length).toBeGreaterThan(1);
    expect(anna.foods.length).toBeGreaterThan(0);
    expect(anna.settings.onboarded).toBe(true);
    expect(anna.workouts.length).toBeGreaterThan(0);
    expect(anna.sessions.length).toBeGreaterThan(1);
    expect(anna.exercises.length).toBeGreaterThan(0);
    expect(anna.steps.length).toBeGreaterThan(1);

    // B starts empty: nothing of anna's, default settings.
    expect(await b().api.getData()).toEqual(emptyData());
    expect(await b().api.exportData()).toEqual(emptyData());

    // B writes on exactly anna's dates and keys — even her meal ids and dish names.
    const mealDay = Object.entries(anna.days).find(([, d]) => (d.meals?.length ?? 0) >= 2);
    if (!mealDay) throw new Error('the demo set has meal days');
    const [mealDate, { meals = [] }] = mealDay;
    const [firstMeal, secondMeal] = meals;
    if (!firstMeal || !secondMeal) throw new Error('two meals on that day');
    // The same meal id as anna's, without positions (so the typed kcal counts).
    const { items: _items, ...plainMeal } = firstMeal;
    const [firstWeight] = anna.weights;
    const lastWeight = anna.weights.at(-1);
    const [firstMeasure] = anna.measures;
    const [dish] = anna.foods;
    if (!firstWeight || !lastWeight || !firstMeasure || !dish) throw new Error('demo records missing');
    const oldestDay = Object.keys(anna.days).sort()[0] ?? TODAY;
    const [workout] = anna.workouts;
    const [session, secondSession] = anna.sessions;
    const [exercise] = anna.exercises;
    const [firstSteps, secondSteps] = anna.steps;
    if (!workout || !session || !secondSession || !exercise || !firstSteps || !secondSteps)
      throw new Error('training records missing');
    const ops: Op[] = [
      { kind: 'day.meta', date: TODAY, value: { trained: true, notes: 'B' } },
      { kind: 'meal.put', date: mealDate, value: { ...plainMeal, text: 'Чужий сніданок', kcal: 111 } },
      { kind: 'meal.delete', date: mealDate, id: secondMeal.id },
      { kind: 'day.delete', date: oldestDay },
      { kind: 'weight.put', date: lastWeight.date, kg: 99.5 },
      { kind: 'weight.delete', date: firstWeight.date },
      { kind: 'measure.delete', date: firstMeasure.date },
      { kind: 'food.delete', name: dish.name },
      { kind: 'settings.put', value: { ...emptyData().settings, goal: 99, onboarded: true } },
      // Workouts and steps: anna's ids and dates.
      { kind: 'workout.delete', id: workout.id },
      { kind: 'exercise.delete', id: exercise.id },
      { kind: 'session.delete', id: session.id },
      { kind: 'session.put', value: { ...secondSession, name: 'Чуже тренування', rev: secondSession.rev + 5 } },
      { kind: 'steps.delete', date: firstSteps.date },
      { kind: 'steps.put', date: secondSteps.date, steps: 123 },
    ];
    await expectStatus(await b().api.sendOps(ops), 200);
    expect(await server.getData(), 'anna’s data after B’s ops').toEqual(anna);

    // B's own data is exactly what B wrote.
    const own = await b().api.getData();
    expect(Object.keys(own.days).sort()).toEqual([mealDate, TODAY].sort());
    expect(own.days[TODAY]).toMatchObject({ trained: true, notes: 'B' });
    expect(own.days[mealDate]?.meals?.map((m) => [m.id, m.text])).toEqual([[firstMeal.id, 'Чужий сніданок']]);
    expect(own.weights).toEqual([{ date: lastWeight.date, kg: 99.5 }]);
    expect(own.measures).toEqual([]);
    expect(own.foods).toEqual([]);
    expect(own.settings.goal).toBe(99);
    expect(own.workouts).toEqual([]);
    expect(own.exercises).toEqual([]);
    expect(own.sessions.map((x) => [x.id, x.name])).toEqual([[secondSession.id, 'Чуже тренування']]);
    expect(own.deletedSessions).toEqual([session.id]);
    expect(own.steps).toEqual([{ date: secondSteps.date, steps: 123 }]);

    // B's backup file holds only B's data.
    const exported = await b().api.exportData();
    expect(exported).toEqual(own);
    expect(JSON.stringify(exported)).not.toContain(anna.days[TODAY]?.food ?? '\u0000');

    // B's import replaces only B's data, on the same dates as anna's.
    const backup = seedData('meals');
    backup.settings.goal = 77;
    await b().api.importData(backup);
    expect(await server.getData(), 'anna’s data after B’s import').toEqual(anna);
    const imported = await b().api.getData();
    expect(Object.keys(imported.days).sort()).toEqual(Object.keys(backup.days).sort());
    expect(imported.weights).toHaveLength(backup.weights.length);
    expect(imported.settings.goal).toBe(77);
    expect(await server.exportData(), 'anna’s export').toEqual(anna);
  });

  test('a photo id that is not yours is a 404', async ({ server }) => {
    const id = randomBytes(16).toString('hex');
    for (const api of [b().api, server]) {
      await expectStatus(await api.rawGet(photoUrl(id)), 404);
      await expectStatus(await api.rawGet(photoThumbUrl(id)), 404);
    }
  });

  test('every admin route is a 403 for anna and for another ordinary account; nothing changes', async ({
    server,
    admin,
  }) => {
    const before = await admin.overview();
    const target = b().id;
    const routes: [path: string, body: unknown][] = [
      [API.adminInviteCreate, { note: 'e2e not admin' }],
      [API.adminInviteRevoke, { id: '0'.repeat(32) }],
      [API.adminResetLink, { userId: target }],
      [API.adminSetRole, { userId: target, role: 'admin' }],
      [API.adminSetDisabled, { userId: target, disabled: true }],
      [API.adminDeleteUser, { userId: target, confirmUsername: b().creds.username }],
      [API.adminUserAiLimit, { userId: target, limit: 0 }],
      // The current values: even a broken guard would change nothing here.
      [API.adminAiLimits, { ...before.limits }],
    ];
    for (const api of [server, b().api]) {
      await expectStatus(await api.rawGet(API.adminUsers), 403, 'forbidden');
      for (const [path, body] of routes) await expectStatus(await api.rawPost(path, body), 403, 'forbidden');
    }

    const after = await admin.overview();
    expect(after.invites).toEqual(before.invites);
    expect(after.limits).toEqual(before.limits);
    const victim = after.users.find((u) => u.id === target);
    expect(victim).toMatchObject({ role: 'user', status: 'active', ai: { customLimit: null } });
    expect(after.users.find((u) => u.id === server.id)).toMatchObject({ role: 'user', status: 'active' });
  });

  test('X-Legko-User naming another account is a 409 and applies nothing', async ({ server }) => {
    const anna = await server.getData();
    const op: Op = { kind: 'weight.put', date: TODAY, kg: 50 };
    const res = await b().api.sendOps([op], { [USER_HEADER]: server.id });
    await expectStatus(res, 409, 'user_mismatch');
    // The other way round as well: anna's cookie, B's id.
    await expectStatus(await server.sendOps([op], { [USER_HEADER]: b().id }), 409, 'user_mismatch');
    const get = await b().api.rawGet(API.data, { [USER_HEADER]: server.id });
    await expectStatus(get, 409, 'user_mismatch');

    expect((await b().api.getData()).weights).toEqual([]);
    expect(await server.getData()).toEqual(anna);
  });

  test('a session made by a login with a username must send X-Legko-User on data, ops and import', async ({
    server,
    playwright,
  }) => {
    const anna = await server.getData();
    const request = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      const user = await apiLogin(request, b().creds);
      expect(user.id).toBe(b().id);
      const fresh = new ServerApi(request, b().creds);
      fresh.useSession(user);

      const ops: Op[] = [{ kind: 'weight.put', date: TODAY, kg: 51 }];
      await expectStatus(await fresh.rawPost(API.ops, { ops }), 409, 'user_mismatch');
      await expectStatus(await fresh.rawGet(API.data), 409, 'user_mismatch');
      await expectStatus(await fresh.rawPost(API.import, seedData('demo')), 409, 'user_mismatch');

      // Nothing was applied, for B or for anna; with the header the same session works.
      const own: AppData = await fresh.getData();
      expect(own).toEqual(emptyData());
      expect(await server.getData()).toEqual(anna);
      await expectStatus(await fresh.sendOps(ops), 200);
      expect((await fresh.getData()).weights).toEqual([{ date: TODAY, kg: 51 }]);
    } finally {
      await request.dispose();
    }
  });
});

test.describe('one device, several accounts', () => {
  test.use({ authed: false, seed: null });

  let people: TestUser[] = [];
  test.afterEach(async () => {
    for (const person of people) await person.dispose();
    people = [];
  });

  test('A logs out, B logs in to an empty app holding only B’s keys, B logs out, A sees A’s data again', async ({
    app,
    page,
    admin,
    playwright,
  }) => {
    const a = await createUser(playwright, admin);
    const b = await createUser(playwright, admin);
    people = [a, b];
    await a.api.importData(seedData('demo'));

    await page.goto('/');
    await app.loginUi(a.creds);
    await app.ready();
    await expect(app.region('Поточна вага')).toContainText('65,4');
    await expect.poll(async () => (await app.deviceCache()).user?.id).toBe(a.id);

    await app.logoutUi();
    await expect.poll(() => app.deviceKeys()).toEqual([]);

    await app.loginUi(b.creds);
    await app.ready();
    // A brand-new account: «Перші кроки», nothing of A's.
    await expect(app.sheet('Перші кроки')).toBeVisible();
    await expect.poll(async () => (await app.deviceCache()).user?.id).toBe(b.id);
    await expect.poll(async () => (await app.deviceKeys()).includes(`legko.data.${b.id}`)).toBe(true);
    const allowed = ['legko.user', `legko.data.${b.id}`, `legko.outbox.${b.id}`];
    const keys = await app.deviceKeys();
    expect(
      keys.filter((key) => !allowed.includes(key)),
      `only B's keys: ${keys.join(', ')}`,
    ).toEqual([]);
    const stored = JSON.stringify(await app.deviceEntries());
    expect(stored).not.toContain(a.id);
    expect(stored).not.toContain(a.creds.username);
    expect(stored).not.toContain('65.4');
    await closeSetup(app);

    await app.logoutUi();
    await expect.poll(() => app.deviceKeys()).toEqual([]);

    await app.loginUi(a.creds);
    await app.ready();
    await expect(app.region('Поточна вага')).toContainText('65,4');
    await expect(app.dialogs).toHaveCount(0);
    expect((await app.deviceCache()).user?.id).toBe(a.id);
    expect((await app.deviceKeys()).some((key) => key.includes(b.id))).toBe(false);
  });

  test('an expired session with an unsent change asks before B signs in; cancel stays, confirm drops it', async ({
    app,
    page,
    context,
    admin,
    playwright,
  }) => {
    const a = await createUser(playwright, admin);
    const b = await createUser(playwright, admin);
    people = [a, b];
    await a.api.importData(seedData('demo'));
    await loginContext(context, a.creds);
    await app.goto('/');
    await expect(app.region('Поточна вага')).toContainText('65,4');

    // Offline, a change waits in the outbox; then the session is gone (cookie cleared).
    await context.setOffline(true);
    await markNoWorkout(app);
    await context.clearCookies();
    await context.setOffline(false);
    await expect(app.loginButton()).toBeVisible();
    await expect(
      page.getByText(
        `На цьому пристрої є зміни ${a.creds.username}, ще не надіслані на сервер. Увійди як ${a.creds.username}, щоб їх надіслати.`,
      ),
    ).toBeVisible();

    const ask = page.getByRole('alertdialog', { name: `Увійти як ${b.creds.username}?` });
    await app.loginUi(b.creds);
    await expect(ask).toContainText(
      `Зміни ${a.creds.username}, ще не надіслані на сервер: 1. Якщо ввійти іншим акаунтом, їх буде втрачено.`,
    );
    await ask.getByRole('button', { name: 'Скасувати', exact: true }).click();
    await expect(ask).toBeHidden();
    await expect(app.loginButton()).toBeVisible();
    await expect(app.nav).toBeHidden();
    // The session that login made was ended again.
    expect((await context.request.get(API.me)).status()).toBe(401);
    expect((await app.deviceCache()).user?.id).toBe(a.id);

    await app.loginUi(b.creds);
    await ask.getByRole('button', { name: `Увійти як ${b.creds.username}`, exact: true }).click();
    await app.ready();
    await expect(app.sheet('Перші кроки')).toBeVisible();
    await expect.poll(async () => (await app.deviceCache()).user?.id).toBe(b.id);

    // A's change reached nobody: not B, and not A either (it was dropped with A's copy).
    expect((await b.api.getData()).days).toEqual({});
    expect((await a.api.getData()).days[TODAY]?.trained).toBeNull();
    const keys = await app.deviceKeys();
    expect(
      keys.some((key) => key.includes(a.id)),
      keys.join(', '),
    ).toBe(false);
    const outbox = (await app.deviceCache()).outbox;
    expect(Array.isArray(outbox) ? outbox : []).toEqual([]);
  });
});

test.describe('a device copy from before accounts', () => {
  test('the legacy keys with a pending op are anna’s: shown at once, adopted, and the op reaches the server', async ({
    app,
    page,
    server,
  }) => {
    const stored = await server.getData();
    expect(stored.days[TODAY]?.trained ?? null).toBeNull();
    // What the pre-accounts app kept on this phone: a weigh-in only it has, and today's «Не було» still unsent.
    const copy = structuredClone(stored);
    copy.weights = [...copy.weights.filter((w) => w.date !== TODAY), { date: TODAY, kg: 63.9 }];
    const today = copy.days[TODAY] ?? { food: '', kcal: null, trained: null, types: [], notes: '' };
    copy.days[TODAY] = { ...today, trained: false };
    const outbox = [
      { id: 'e2e-legacy-op-1', op: { kind: 'day.meta', date: TODAY, value: { trained: false } } },
    ];

    // `me` waits until the copy has been seen on screen.
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    await page.route(`**${API.me}`, async (route) => {
      await held;
      await route.continue();
    });

    // A same-origin page that is not the app, to write the device store before the app ever runs.
    await page.goto(API.health);
    await writeDeviceStore(page, { 'legko.data': copy, 'legko.outbox': outbox });

    await page.goto('/');
    await app.ready();
    await expect(app.region('Поточна вага')).toContainText('63,9');
    await expect(app.trainingToggle('Не було')).toHaveAttribute('aria-pressed', 'true');
    // Provisional: whose copy it is is not known yet, so nothing was sent.
    expect((await server.getData()).days[TODAY]?.trained ?? null).toBeNull();

    release();
    await expect.poll(async () => (await server.getData()).days[TODAY]?.trained).toBe(false);
    // The server's records take over (the 63,9 was never an op), the unsent mark stays.
    await expect(app.region('Поточна вага')).toContainText('65,4');
    await expect(app.trainingToggle('Не було')).toHaveAttribute('aria-pressed', 'true');

    await expect.poll(() => app.deviceKeys()).not.toContain('legko.data');
    const keys = await app.deviceKeys();
    expect(keys).not.toContain('legko.outbox');
    expect(keys).toContain('legko.user');
    expect(keys).toContain(`legko.data.${server.id}`);
    const cache = await app.deviceCache();
    expect(cache.user).toMatchObject({ id: server.id, legacyOwner: true });
    await expect.poll(async () => (await app.deviceCache()).outbox).toEqual([]);
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});

test.describe('admin bootstrap', () => {
  test.use({ authed: false, seed: null });

  test('`cli.js create-admin` prints a setup link; the password is chosen in the browser; lands on «Користувачі»', async ({
    app,
    page,
    admin,
  }, info) => {
    const dataDir = process.env.LEGKO_E2E_DATA_DIR;
    if (!dataDir) throw new Error('LEGKO_E2E_DATA_DIR is not set (playwright.config.ts sets it)');
    const username = uniqueUsername('own');
    try {
      const printed = execFileSync(process.execPath, [CLI, 'create-admin', username], {
        env: { ...process.env, DATA_DIR: dataDir, PUBLIC_ORIGIN: BASE_URL, NODE_ENV: 'development' },
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      expect(printed).toContain(`Admin account ${username} created, without a password.`);
      const link = /^(\S+\/reset#[A-Za-z0-9_-]{43})$/m.exec(printed)?.[1];
      if (!link) throw new Error(`no setup link in:\n${printed}`);
      expect(new URL(link).origin).toBe(BASE_URL);
      // No password yet: the account shows as pending to the admin.
      expect((await admin.overview()).users.find((u) => u.username === username)).toMatchObject({
        role: 'admin',
        status: 'pending',
      });

      await page.goto(new URL(link).pathname + new URL(link).hash);
      await expect(page.getByRole('heading', { level: 1, name: 'Створення пароля' })).toBeVisible();
      await expect(page.getByText(`для ${username}`, { exact: true })).toBeVisible();
      expect(new URL(page.url()).hash).toBe('');
      const password = `e2e-own-${username}`;
      await page.getByLabel('Новий пароль', { exact: true }).fill(password);
      await page.getByLabel('Повтори пароль', { exact: true }).fill(password);
      await page.getByRole('button', { name: 'Зберегти пароль', exact: true }).click();
      if (info.project.name === 'iphone') {
        // iPhone Safari (not the home-screen app): «Готово» first (D29).
        await page.getByRole('button', { name: 'Продовжити в Safari', exact: true }).click();
      }

      await app.ready();
      await expect(page).toHaveURL(/\/settings\/users$/);
      await expect(page.getByRole('heading', { name: 'Користувачі', exact: true }).first()).toBeVisible();
      await expect(app.region(/^Акаунти · \d+$/)).toContainText(username);
      expect((await app.deviceCache()).user).toMatchObject({ username, role: 'admin' });
      expect((await admin.overview()).users.find((u) => u.username === username)?.status).toBe('active');
    } finally {
      await deleteByName(admin, username);
    }
  });
});
