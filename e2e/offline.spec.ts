import type { Page } from '@playwright/test';
import { API, applyOps, type AppData, type Op } from '../packages/shared/src/index';
import { e2eSession } from './fixtures/data';
import { TODAY } from './support/env';
import { sessionOf } from './support/server';
import { expect, test } from './support/test';

const OFFLINE_NOTE = 'Офлайн · зміни збережено на телефоні';

/** Waits until the service worker has precached the shell and controls the page. */
async function waitForServiceWorker(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await expect.poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null)).toBe(true);
}

test.describe('offline', () => {
  // The offline shell needs the real service worker.
  test.use({ serviceWorkers: 'allow' });

  test('a workout and a meal saved offline survive an offline reload and reach the server once online', async ({
    app,
    page,
    context,
    server,
  }) => {
    await app.goto('/');
    await waitForServiceWorker(page);

    await context.setOffline(true);
    await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();

    // The workout through the day sheet (`day.meta`: the mark and the type only).
    await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
    const sheet = app.sheet('Запис дня');
    await sheet.getByRole('button', { name: 'Було', exact: true }).click();
    await sheet.getByRole('button', { name: 'Прес', exact: true }).click();
    await app.save(sheet);

    // A meal with only its kcal (`meal.put`): the day sheet has no kcal field any more.
    const meal = await app.newMeal();
    await expect(app.mealType(meal, 'Сніданок')).toHaveAttribute('aria-pressed', 'true');
    await meal.getByRole('textbox', { name: 'Калорії', exact: true }).fill('1620');
    await app.saveMeal(meal);
    await expect(app.homeRow('Їжа')).toContainText('1 620 / 1 700 ккал');
    const before = (await server.getData()).days[TODAY];
    expect(before?.kcal).toBeNull();
    expect(before?.meals).toBeUndefined();

    // Reload without network: the service worker serves the app, IndexedDB the data.
    await page.reload();
    await app.ready();
    await expect(app.homeRow('Їжа')).toContainText('1 620 / 1 700 ккал');
    await expect(app.homeRow('Тренування')).toContainText('Прес');
    await expect(app.trainingToggle('Було')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
    // The day's list from the device cache: the new meal and the old text as its own block.
    const list = await app.openFoodDay();
    await expect(app.mealRow(list, 'Сніданок')).toBeVisible();
    await expect(app.mealRow(list, 'Їжа за день')).toBeVisible();
    await list.getByRole('button', { name: 'Закрити', exact: true }).click();
    await app.expectSheetClosed();
    // In-app navigation (the list row, not a page load): the sync status of the data sub-page.
    await app.openSettings('Дані і копія');
    await expect(app.region('Дані')).toContainText('Офлайн — 2 зміни чекають на інтернет');

    // Calendar and progress work offline too.
    await app.go('Календар');
    await expect(app.region('14 жовтня 2026')).toContainText('Прес');
    await expect(
      app.region('14 жовтня 2026').getByRole('button', { name: /^Тренування/ }),
    ).toHaveAccessibleName('Тренування: було, Прес');

    await context.setOffline(false);
    // The server got both: the workout, and the meal next to today's old text (now the untyped meal 'legacy').
    await expect
      .poll(async () => {
        const day = (await server.getData()).days[TODAY];
        return {
          kcal: day?.kcal,
          trained: day?.trained,
          types: day?.types,
          notes: day?.notes,
          meals: day?.meals?.map(({ id, type, text, kcal }) => ({
            id: id === 'legacy' ? id : 'new',
            type,
            text,
            kcal,
          })),
        };
      })
      .toEqual({
        kcal: 1620,
        trained: true,
        types: ['Прес'],
        notes: '',
        meals: [
          { id: 'new', type: 'Сніданок', text: '', kcal: 1620 },
          { id: 'legacy', type: '', text: 'Вівсянка з бананом, кава', kcal: null },
        ],
      });
    const stored = (await server.getData()).days[TODAY];
    expect(stored?.meals?.[0]?.time).toMatch(/^10:\d\d$/);
    // Old clients still read the derived day text.
    expect(stored?.food).toBe('Сніданок\nВівсянка з бананом, кава');
    await app.openSettings('Дані і копія');
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    await app.go('Головна');
    await expect(page.getByText(OFFLINE_NOTE)).toBeHidden();
  });

  test('cold start offline with the device cache opens the app; the login screen explains when there is none', async ({
    app,
    page,
    context,
  }) => {
    await app.goto('/');
    await waitForServiceWorker(page);
    await context.setOffline(true);
    await page.reload();
    await app.ready();
    await expect(app.region('Поточна вага')).toContainText('65,4');

    // Logged out (local data wiped; «Вийти» is in «Акаунт», reached in-app) and offline: the reload comes from the
    // service worker, and the login screen says why it cannot sign in.
    await app.logoutUi();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await expect.poll(() => app.deviceKeys()).toEqual([]);
    await page.reload();
    await expect(
      page.getByText('Немає зʼєднання з сервером. Увійти можна, щойно зʼявиться інтернет.'),
    ).toBeVisible();
  });
});

/** The outbox survives a lost answer: replaying an idempotent op is harmless (no service worker: plain routing). */
test.describe('offline outbox (workouts)', () => {
  test('a queued session.put whose answer is lost is sent again, and the server keeps exactly one session', async ({
    app,
    page,
    server,
  }) => {
    const user = await server.me();
    const session = e2eSession({ id: 'e2eOffline001' });
    const ops: Op[] = [
      { kind: 'session.put', value: session },
      { kind: 'steps.put', date: TODAY, steps: 4200 },
    ];
    // The first ops request reaches the server, but its answer never comes back (connection reset).
    let posts = 0;
    await page.route('**/api/ops', async (route) => {
      posts++;
      if (posts > 1) return route.continue();
      await route.fetch();
      return route.abort('connectionreset');
    });
    // Queued on this phone while offline (the session screens belong to their own package).
    await page.goto(API.health);
    await app.seedDeviceCopy(user, applyOps(await server.getData(), ops), [
      { id: 'e2e-session-op-1', op: ops[0] },
      { id: 'e2e-session-op-2', op: ops[1] },
    ]);
    await app.goto('/');

    await expect.poll(async () => (await app.deviceCache()).outbox, { timeout: 15_000 }).toEqual([]);
    expect(posts).toBeGreaterThanOrEqual(2);
    const stored = await server.getData();
    expect(stored.sessions.filter((s) => s.id === session.id)).toHaveLength(1);
    expect(sessionOf(stored, session.id)).toMatchObject({ status: 'active', rev: 0 });
    expect(stored.steps.filter((s) => s.date === TODAY)).toEqual([{ date: TODAY, steps: 4200 }]);
    const device = (await app.deviceCache()).data as AppData;
    expect(sessionOf(device, session.id)).toMatchObject({ status: 'active' });
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });
});
