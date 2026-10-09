import { PASSWORD, TODAY } from './support/env';
import { expect, test } from './support/test';

test.describe('session', () => {
  test('an expired session shows the login screen, keeps unsynced changes and sends them after login', async ({
    app,
    page,
    context,
    server,
  }) => {
    await app.goto('/');
    await context.setOffline(true);
    await app.region('Сьогодні').getByRole('button', { name: 'Не було', exact: true }).click();
    await expect(app.toast('Відмічено: без тренування')).toBeVisible();

    // The server forgets this device's session (cookie gone) while it is offline.
    await context.clearCookies();
    await context.setOffline(false);
    const password = page.getByLabel('Пароль', { exact: true });
    await expect(password).toBeVisible();
    expect((await server.getData()).days[TODAY]?.trained).toBeNull();

    await password.fill(PASSWORD);
    await page.getByRole('button', { name: 'Увійти' }).click();
    await app.ready();
    await expect(app.region('Сьогодні')).toContainText('Тренування · Не було');
    await expect.poll(async () => (await server.getData()).days[TODAY]?.trained).toBe(false);
  });

  test('a device with data opens at once even when the server does not answer', async ({ app, page }) => {
    await app.goto('/');
    await expect.poll(async () => (await app.deviceCache()).data).toBeTruthy();
    // One bar in a gym basement: every API request hangs (the app gives up on them after 15 s).
    await page.route('**/api/**', () => undefined);
    await page.reload();
    await app.ready();
    await expect(app.region('Поточна вага')).toContainText('65,4');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('«Вийти» always asks first, says what happens, and can be cancelled', async ({ app, page }) => {
    await app.goto('/reminders');
    await page.getByRole('button', { name: 'Вийти' }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Вийти з Легко на цьому пристрої?' });
    await expect(dialog).toContainText('Нагадування сюди більше не приходитимуть');
    await expect(dialog).toContainText('Усі записи залишаться на сервері.');
    await dialog.getByRole('button', { name: 'Скасувати' }).click();
    await expect(dialog).toBeHidden();
    await expect(app.heading('Нагадування')).toBeVisible();
    expect((await app.deviceCache()).data).toBeTruthy();
    const me = await page.context().request.get('/api/auth/me');
    expect(me.status()).toBe(200);
  });

  test('logging out and back in without a reload loads the data again', async ({ app, page }) => {
    await app.goto('/reminders');
    await page.getByRole('button', { name: 'Вийти' }).click();
    await page
      .getByRole('alertdialog', { name: 'Вийти з Легко на цьому пристрої?' })
      .getByRole('button', { name: 'Вийти', exact: true })
      .click();
    const password = page.getByLabel('Пароль', { exact: true });
    await password.fill(PASSWORD);
    await page.getByRole('button', { name: 'Увійти' }).click();
    await app.ready();
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    await app.go('Головна');
    await expect(app.region('Поточна вага')).toContainText('65,4');
    await app.go('Календар');
    await expect(
      page.locator('section').filter({ hasText: 'Останні записи' }).getByRole('listitem'),
    ).toHaveCount(8);
  });
});

test.describe('login', () => {
  test.use({ authed: false });

  test('a wrong password shows an error, the right one opens the app and survives a reload', async ({
    page,
    app,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Легко', level: 1 })).toBeVisible();
    const password = page.getByLabel('Пароль', { exact: true });
    const submit = page.getByRole('button', { name: 'Увійти' });

    await password.fill('definitely-not-it');
    await submit.click();
    await expect(page.getByRole('alert')).toHaveText('Неправильний пароль');
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(app.nav).toBeHidden();

    // Typing again clears the error.
    await password.fill(PASSWORD);
    await expect(page.getByRole('alert')).toBeHidden();
    await submit.click();

    await app.ready();
    await expect(app.heading('Головна')).toBeVisible();

    await app.reload();
    await expect(app.heading('Головна')).toBeVisible();
  });

  test('rate limiting and an unreachable server get their own messages', async ({ page }) => {
    // Mocked: really tripping the limiter (5 failures / 15 min per IP) would lock out the rest of the run.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 429, json: { error: 'rate_limited', message: 'Забагато спроб' } }),
    );
    await page.goto('/');
    const password = page.getByLabel('Пароль', { exact: true });
    await password.fill('whatever');
    await page.getByRole('button', { name: 'Увійти' }).click();
    await expect(page.getByRole('alert')).toHaveText('Забагато спроб — спробуй за кілька хвилин');

    await page.unroute('**/api/auth/login');
    await page.route('**/api/auth/login', (route) => route.abort('internetdisconnected'));
    await password.fill('whatever2');
    await page.getByRole('button', { name: 'Увійти' }).click();
    await expect(page.getByRole('alert')).toHaveText('Немає зʼєднання з сервером');
  });

  test('the eye button reveals the password; an empty form is not submitted', async ({ page }) => {
    await page.goto('/');
    const password = page.getByLabel('Пароль', { exact: true });
    await page.getByRole('button', { name: 'Увійти' }).click();
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(password).toBeFocused();

    await password.fill('secret');
    await expect(password).toHaveAttribute('type', 'password');
    const eye = page.getByRole('button', { name: 'Показати пароль' });
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expect(password).toHaveAttribute('type', 'text');
  });
});
