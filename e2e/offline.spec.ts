import type { Page } from '@playwright/test';
import { TODAY } from './support/env';
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

  test('a day saved offline survives an offline reload and reaches the server once online', async ({
    app,
    page,
    context,
    server,
  }) => {
    await app.goto('/');
    await waitForServiceWorker(page);

    await context.setOffline(true);
    await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();

    await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
    const sheet = app.sheet('Запис дня');
    await sheet.getByRole('button', { name: 'Було', exact: true }).click();
    await sheet.getByRole('button', { name: 'Прес', exact: true }).click();
    await sheet.getByRole('textbox', { name: 'Калорії за день' }).fill('1620');
    await app.save(sheet);
    await expect(app.homeRow('Їжа')).toContainText('1 620 / 1 700 ккал');
    expect((await server.getData()).days[TODAY]?.kcal).toBeNull();

    // Reload without network: the service worker serves the app, IndexedDB the data.
    await page.reload();
    await app.ready();
    await expect(app.homeRow('Їжа')).toContainText('1 620 / 1 700 ккал');
    await expect(app.homeRow('Тренування')).toContainText('Прес');
    await expect(app.trainingToggle('Було')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByText(OFFLINE_NOTE)).toBeVisible();
    // In-app navigation (the list row, not a page load): the sync status of the data sub-page.
    await app.openSettings('Дані і копія');
    await expect(app.region('Дані')).toContainText('Офлайн — 1 зміна чекає на інтернет');

    // Calendar and progress work offline too.
    await app.go('Календар');
    await expect(app.region('14 жовтня 2026')).toContainText('Прес');
    await expect(
      app.region('14 жовтня 2026').getByRole('button', { name: /^Тренування/ }),
    ).toHaveAccessibleName('Тренування: було, Прес');

    await context.setOffline(false);
    await expect
      .poll(async () => (await server.getData()).days[TODAY])
      .toEqual({ food: 'Вівсянка з бананом, кава', kcal: 1620, trained: true, types: ['Прес'], notes: '' });
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

    // Logged out (local data wiped) and offline: the login screen says why it cannot sign in.
    await app.go('Налаштування');
    await page.getByRole('button', { name: 'Вийти', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Вийти з Легко на цьому пристрої?' })
      .getByRole('button', { name: 'Вийти', exact: true })
      .click();
    await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
    await page.reload();
    await expect(
      page.getByText('Немає зʼєднання з сервером. Увійти можна, щойно зʼявиться інтернет.'),
    ).toBeVisible();
  });
});
