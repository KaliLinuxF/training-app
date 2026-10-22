/**
 * Sessions and the login screen (docs/multi-user.md §9.1, §11.2): username + password, the same answer for a wrong
 * password and an unknown name, an expired session that keeps unsent changes, the offline start, logout from
 * «Акаунт», and the «Маю посилання» paste field.
 *
 * Rate limits are shared by the whole run: this file makes exactly two real failed logins, each followed by a
 * successful one; the other failures are mocked.
 */
import { USERNAME_LABEL } from './support/app';
import { PASSWORD, TODAY, USERNAME } from './support/env';
import { uniqueUsername } from './support/server';
import { expect, test } from './support/test';

const WRONG = 'Неправильне імʼя або пароль';
const FORGOT = 'Не памʼятаєш пароль? Попроси в адміністратора посилання для нового пароля.';
/** Under the form; hidden while FORGOT (the same advice) shows in the card. */
const FOOTER =
  'Немає акаунта або не памʼятаєш пароль? Попроси в адміністратора запрошення чи посилання для нового пароля.';

test.describe('session', () => {
  test('an expired session shows the login screen with her name, keeps unsynced changes and sends them after login', async ({
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
    await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toHaveValue(USERNAME);
    await expect(
      page.getByText(
        `На цьому пристрої є зміни ${USERNAME}, ще не надіслані на сервер. Увійди як ${USERNAME}, щоб їх надіслати.`,
      ),
    ).toBeVisible();
    expect((await server.getData()).days[TODAY]?.trained).toBeNull();

    await password.fill(PASSWORD);
    await app.loginButton().click();
    await app.ready();
    await expect(app.homeRow('Тренування')).toContainText('Не було');
    await expect(app.trainingToggle('Не було')).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => (await server.getData()).days[TODAY]?.trained).toBe(false);
  });

  test('a device with data opens at once even when the server does not answer', async ({ app, page }) => {
    await app.goto('/');
    await expect.poll(async () => (await app.deviceCache()).data).toBeTruthy();
    const { user } = await app.deviceCache();
    expect(user?.username).toBe(USERNAME);
    // One bar in a gym basement: every API request hangs (the app gives up on them after 15 s).
    await page.route('**/api/**', () => undefined);
    await page.reload();
    await app.ready();
    await expect(app.region('Поточна вага')).toContainText('65,4');
    await page.unrouteAll({ behavior: 'ignoreErrors' });
  });

  test('«Вийти» (in «Акаунт») always asks first, says what happens, and can be cancelled', async ({ app, page }) => {
    await app.gotoSettings('Акаунт');
    await page.getByRole('button', { name: 'Вийти', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Вийти з Легко на цьому пристрої?' });
    await expect(dialog).toContainText('Нагадування сюди більше не приходитимуть');
    await expect(dialog).toContainText('Усі записи залишаться на сервері.');
    await dialog.getByRole('button', { name: 'Скасувати' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Вийти', exact: true })).toBeEnabled();
    expect((await app.deviceCache()).data).toBeTruthy();
    const me = await page.context().request.get('/api/auth/me');
    expect(me.status()).toBe(200);
  });

  test('logout reloads to the login screen and leaves nothing of hers on the device', async ({ app, page }) => {
    await app.goto('/');
    await expect.poll(async () => (await app.deviceCache()).data).toBeTruthy();

    await app.logoutUi();

    await expect(page).toHaveURL(/\/$/);
    await expect(app.loginButton()).toBeVisible();
    await expect.poll(() => app.deviceKeys()).toEqual([]);
    await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toHaveValue('');
    const me = await page.context().request.get('/api/auth/me');
    expect(me.status()).toBe(401);
  });

  test('logging out and back in loads the data again', async ({ app, page }) => {
    await app.goto('/');
    await app.logoutUi();

    await app.loginUi();
    await app.ready();
    await app.go('Налаштування');
    await app.settingsRow('Дані і копія').click();
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    await app.go('Головна');
    await expect(app.region('Поточна вага')).toContainText('65,4');
    await app.go('Календар');
    await expect(app.region('14 жовтня 2026')).toContainText('Вівсянка з бананом, кава');
    await app.go('Прогрес');
    await expect(
      page
        .getByRole('group', { name: 'Історія калорій' })
        .getByRole('button', { name: /Відкрити в календарі$/ }),
    ).toHaveCount(3);
  });
});

test.describe('login', () => {
  test.use({ authed: false });

  test('a wrong password and an unknown name get the same answer and the hint; the right one opens the app', async ({
    page,
    app,
  }) => {
    await page.goto('/');
    await expect(page.getByRole('heading', { name: 'Легко', level: 1 })).toBeVisible();
    const name = page.getByLabel(USERNAME_LABEL, { exact: true });
    const password = page.getByLabel('Пароль', { exact: true });
    await expect(name).toHaveAttribute('autocomplete', 'username');
    await expect(password).toHaveAttribute('autocomplete', 'current-password');

    await name.fill(USERNAME);
    await password.fill('definitely-not-it');
    await app.loginButton().click();
    await expect(page.getByRole('alert')).toHaveText(WRONG);
    await expect(page.getByText(FORGOT)).toBeVisible();
    // The advice is shown once: the footer saying the same is hidden, «Маю посилання» stays.
    await expect(page.getByText(FOOTER)).toBeHidden();
    await expect(page.getByRole('button', { name: 'Маю посилання', exact: true })).toBeVisible();
    await expect(password).toHaveAttribute('aria-invalid', 'true');
    await expect(app.nav).toBeHidden();

    // An unknown name answers exactly like a wrong password.
    await name.fill(uniqueUsername('nobody'));
    await password.fill('definitely-not-it-either');
    await app.loginButton().click();
    await expect(page.getByRole('alert')).toHaveText(WRONG);
    await expect(page.getByText(FORGOT)).toBeVisible();

    // Typing again clears the error.
    await name.fill(USERNAME);
    await password.fill(PASSWORD);
    await expect(page.getByRole('alert')).toBeHidden();
    await app.loginButton().click();

    await app.ready();
    await expect(app.heading('Головна')).toBeVisible();
    expect((await app.deviceCache()).user?.username).toBe(USERNAME);

    await app.reload();
    await expect(app.heading('Головна')).toBeVisible();
  });

  test('rate limiting, a disabled account and an unreachable server get their own messages', async ({ page, app }) => {
    // Mocked: really tripping the limiter (5 failures / 15 min per IP) would lock out the rest of the run.
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 429, json: { error: 'rate_limited', message: 'Забагато спроб' } }),
    );
    await page.goto('/');
    await page.getByLabel(USERNAME_LABEL, { exact: true }).fill(USERNAME);
    const password = page.getByLabel('Пароль', { exact: true });
    await password.fill('whatever');
    await app.loginButton().click();
    await expect(page.getByRole('alert')).toHaveText('Забагато спроб — спробуй за кілька хвилин');
    await expect(page.getByText(FORGOT)).toBeVisible();

    await page.unroute('**/api/auth/login');
    await page.route('**/api/auth/login', (route) =>
      route.fulfill({ status: 403, json: { error: 'account_disabled', message: 'Акаунт вимкнено' } }),
    );
    await password.fill('whatever1');
    await app.loginButton().click();
    await expect(page.getByRole('alert')).toHaveText('Акаунт вимкнено. Звернись до адміністратора');

    await page.unroute('**/api/auth/login');
    await page.route('**/api/auth/login', (route) => route.abort('internetdisconnected'));
    await password.fill('whatever2');
    await app.loginButton().click();
    await expect(page.getByRole('alert')).toHaveText('Немає зʼєднання з сервером');
  });

  test('the eye button reveals the password; an empty form is not submitted', async ({ page, app }) => {
    await page.goto('/');
    const name = page.getByLabel(USERNAME_LABEL, { exact: true });
    const password = page.getByLabel('Пароль', { exact: true });
    await app.loginButton().click();
    await expect(page.getByRole('alert')).toBeHidden();
    await expect(name).toBeFocused();

    await name.fill(USERNAME);
    await app.loginButton().click();
    await expect(password).toBeFocused();

    await password.fill('secret');
    await expect(password).toHaveAttribute('type', 'password');
    const eye = page.getByRole('button', { name: 'Показати пароль' });
    await eye.click();
    await expect(eye).toHaveAttribute('aria-pressed', 'true');
    await expect(password).toHaveAttribute('type', 'text');
  });

  test('«Маю посилання» refuses a link that is not from Легко', async ({ page }) => {
    await page.goto('/');
    await expect(page.getByText(FOOTER)).toBeVisible();
    await page.getByRole('button', { name: 'Маю посилання', exact: true }).click();
    const field = page.getByLabel('Встав посилання із запрошенням або для нового пароля', { exact: true });
    await expect(field).toBeFocused();
    await expect(field).toHaveAttribute('type', 'url');
    await expect(field).toHaveAttribute('inputmode', 'url');

    await field.fill(`https://example.com/invite#${'x'.repeat(43)}`);
    await page.getByRole('button', { name: 'Відкрити', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveText('Це не схоже на посилання з Легко');
    await expect(page).toHaveURL(/\/$/);
  });
});
