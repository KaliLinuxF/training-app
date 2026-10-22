/**
 * One-time links (docs/multi-user.md §8.4, §9.2, §9.3, §11.2): an admin-made invite registers a new account, a used
 * or garbage link explains itself, a signed-in device asks to sign out first, a reset link sets a new password (and
 * signs every other device of that person out), and — in iPhone Safari — the «Готово» state and the paste path
 * into the installed app (D29). The form says «Адміністратор бачить твої записи та прогрес.» right above «Створити
 * акаунт» (docs/coach-cabinet.md §7.1).
 *
 * Rules: anna and admin are never changed (throwaway accounts only, deleted in `finally`); at most two failed link
 * attempts in a row and one failed login; no server-derived dates are asserted.
 */
import type { Page } from '@playwright/test';
import { API, usernameKey } from '../packages/shared/src/index';
import { App, USERNAME_LABEL } from './support/app';
import { BASE_URL, USERNAME } from './support/env';
import { createUser, loginContext, uniqueUsername, type ServerApi } from './support/server';
import { expect, test } from './support/test';

const USED = 'Це запрошення вже використали. Якщо акаунт за ним уже створено — просто ввійди.';
const UNKNOWN = 'Посилання неправильне або неповне.';
const ASK_ADMIN = 'Попроси в адміністратора нове.';
const ADMIN_SEES = 'Адміністратор бачить твої записи та прогрес.';

/** Deletes the account named `username` if it exists (a registration a test made through the UI). */
async function deleteAccount(admin: ServerApi, username: string): Promise<void> {
  const key = usernameKey(username);
  const found = (await admin.overview()).users.find((u) => usernameKey(u.username) === key);
  if (found) await admin.deleteUser(found.id, found.username);
}

/** Fills the invite form and submits it. */
async function register(page: Page, username: string, password: string): Promise<void> {
  await page.getByLabel(USERNAME_LABEL, { exact: true }).fill(username);
  await page.getByLabel('Пароль', { exact: true }).fill(password);
  await page.getByLabel('Повтори пароль', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
}

/** A well-formed token nobody issued (the server answers 410 `unknown`). */
const randomToken = (): string => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  return Array.from({ length: 43 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join('');
};

test.describe('invite', () => {
  test.use({ authed: false });

  test('an invite registers a new account, which lands in the app with «Перші кроки»', async ({
    page,
    app,
    admin,
  }, testInfo) => {
    test.skip(testInfo.project.name === 'iphone', 'iPhone Safari shows «Готово» first (its own test)');
    const username = uniqueUsername('inv');
    const { path } = await admin.createInvite('e2e invite');
    try {
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Запрошення в Легко' })).toBeVisible();
      // The token left the address bar at once (it lives in sessionStorage for a reload).
      expect(new URL(page.url()).hash).toBe('');
      expect(new URL(page.url()).pathname).toBe('/invite');
      await expect(page.getByText(/^Посилання одноразове, діє до /)).toBeVisible();

      await register(page, username, `e2e-pass-${username}`);

      await app.ready();
      await expect(app.sheet('Перші кроки')).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/');
      expect((await app.deviceCache()).user?.username).toBe(username);
    } finally {
      await deleteAccount(admin, username);
    }
  });

  test('the form says the admin sees the records, inside it and right above «Створити акаунт»', async ({
    page,
    admin,
  }) => {
    // Nothing is registered: the pending invite is revoked by the suite's auto fixture.
    const { path } = await admin.createInvite('e2e invite line');
    await page.goto(path);
    const submit = page.getByRole('button', { name: 'Створити акаунт', exact: true });
    await expect(submit).toBeVisible();
    const line = page.locator('form').getByText(ADMIN_SEES, { exact: true });
    await expect(line).toBeVisible();
    await expect(page.getByText(ADMIN_SEES, { exact: true })).toHaveCount(1);
    // The line comes right before the button (document order and on screen).
    expect(await line.evaluate((el) => el.nextElementSibling?.textContent?.trim() ?? null)).toBe(
      'Створити акаунт',
    );
    const [above, button] = [await line.boundingBox(), await submit.boundingBox()];
    if (!above || !button) throw new Error('the line or the button is not visible');
    expect(above.y + above.height).toBeLessThanOrEqual(button.y + 0.5);
    // The repeat field is above the line.
    const repeat = await page.getByLabel('Повтори пароль', { exact: true }).boundingBox();
    if (!repeat) throw new Error('no repeat field');
    expect(repeat.y + repeat.height).toBeLessThanOrEqual(above.y + 0.5);
    // A line, not a pop-up.
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('a used invite says so, without the «ask the admin» line', async ({ page, admin, playwright }) => {
    const username = uniqueUsername('reuse');
    const { path, token } = await admin.createInvite('e2e reuse');
    // Somebody (another browser) already used it.
    const elsewhere = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      const res = await elsewhere.post(API.inviteAccept, {
        data: { token, username, password: `e2e-pass-${username}` },
        headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
      });
      expect(res.status(), await res.text()).toBe(200);

      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Посилання не працює' })).toBeVisible();
      await expect(page.getByText(USED)).toBeVisible();
      await expect(page.getByText(ASK_ADMIN)).toBeHidden();
      // Nobody is signed in on this device: «Увійти» leads to the login screen.
      await page.getByRole('button', { name: 'Увійти', exact: true }).click();
      await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
    } finally {
      await elsewhere.dispose();
      await deleteAccount(admin, username);
    }
  });

  test('a garbage token is an unknown link', async ({ page }) => {
    await page.goto(`/invite#${randomToken()}`);
    await expect(page.getByRole('heading', { level: 1, name: 'Посилання не працює' })).toBeVisible();
    await expect(page.getByText(UNKNOWN)).toBeVisible();
    await expect(page.getByText(ASK_ADMIN)).toBeVisible();
    await page.getByRole('button', { name: 'Увійти', exact: true }).click();
    await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toBeVisible();
  });
});

/** Opens an invite path and waits for its form (desktop and iPhone alike). */
async function openInvite(page: Page, path: string): Promise<Page> {
  await page.goto(path);
  await expect(page.getByRole('button', { name: 'Створити акаунт', exact: true })).toBeVisible();
  return page;
}

test.describe('invite on a signed-in device', () => {
  test('asks to sign out first; «Вийти й продовжити» keeps the link', async ({ page, admin }) => {
    const { path } = await admin.createInvite('e2e signed in');
    await page.goto(path);
    await expect(
      page.getByText(`На цьому пристрої вже ввійдено як ${USERNAME}. Щоб створити новий акаунт, спершу вийди.`),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'Повернутися в застосунок', exact: true })).toBeVisible();

    await page.getByRole('button', { name: 'Вийти й продовжити', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Вийти з Легко на цьому пристрої?' })
      .getByRole('button', { name: 'Вийти', exact: true })
      .click();

    // After the logout reload the same invite continues (the token survived in sessionStorage).
    await expect(page.getByRole('button', { name: 'Створити акаунт', exact: true })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/invite');
    await expect.poll(() => new App(page).deviceKeys()).toEqual([]);
  });
});

test.describe('reset link', () => {
  test.use({ authed: false });

  test('sets a new password: signed in here, the old password refused, other devices signed out', async ({
    page,
    app,
    admin,
    playwright,
    browser,
  }, testInfo) => {
    const user = await createUser(playwright, admin);
    const other = await browser.newContext({ baseURL: BASE_URL, serviceWorkers: 'block' });
    try {
      // Another device of that person, signed in and showing the app.
      await loginContext(other, user.creds);
      const otherApp = new App(await other.newPage());
      await otherApp.goto('/');

      const { path } = await admin.resetLink(user.id);
      await page.goto(path);
      await expect(page.getByRole('heading', { level: 1, name: 'Новий пароль' })).toBeVisible();
      await expect(page.getByText(`для ${user.creds.username}`, { exact: true })).toBeVisible();
      expect(new URL(page.url()).hash).toBe('');
      await expect(page.getByText('Після цього всі пристрої, де ввійдено в акаунт, вийдуть з нього.')).toBeVisible();

      const fresh = `e2e-new-${user.creds.username}`;
      await page.getByLabel('Новий пароль', { exact: true }).fill(fresh);
      await page.getByLabel('Повтори пароль', { exact: true }).fill(fresh);
      await page.getByRole('button', { name: 'Зберегти пароль', exact: true }).click();

      if (testInfo.project.name === 'iphone') {
        await expect(page.getByRole('heading', { level: 1, name: 'Пароль збережено' })).toBeVisible();
        await expect(page.getByText(`Імʼя для входу: ${user.creds.username}`)).toBeVisible();
        await page.getByRole('button', { name: 'Продовжити в Safari', exact: true }).click();
      }
      await app.ready();
      expect((await app.deviceCache()).user?.username).toBe(user.creds.username);

      // The old password no longer works (one failed login).
      const probe = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        const res = await probe.post(API.login, {
          data: user.creds,
          headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
        });
        expect(res.status()).toBe(401);
        // …and the new one does (resets the counters).
        const ok = await probe.post(API.login, {
          data: { username: user.creds.username, password: fresh },
          headers: { Origin: BASE_URL, 'Content-Type': 'application/json' },
        });
        expect(ok.status()).toBe(200);
      } finally {
        await probe.dispose();
      }

      // The other device was signed out by the reset.
      await otherApp.page.reload();
      await expect(otherApp.loginButton()).toBeVisible();
      await expect(otherApp.page.getByLabel(USERNAME_LABEL, { exact: true })).toHaveValue(user.creds.username);
    } finally {
      await other.close();
      await user.dispose();
    }
  });
});

test.describe('iPhone Safari (D29)', () => {
  test.use({ authed: false });
  test.skip(({ isMobile }) => !isMobile, 'iPhone Safari only (iPhone user agent, not the home-screen app)');

  test('a finished invite shows «Готово» with the name; «Продовжити в Safari» opens the app', async ({
    page,
    app,
    admin,
  }) => {
    const username = uniqueUsername('ios');
    const { path } = await admin.createInvite('e2e iphone');
    try {
      await openInvite(page, path);
      await expect(
        page.getByText('Легко вже на початковому екрані? Скопіюй посилання й встав його там: «Маю посилання».'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'Скопіювати посилання', exact: true })).toBeVisible();

      await register(page, username, `e2e-pass-${username}`);

      await expect(page.getByRole('heading', { level: 1, name: 'Акаунт створено' })).toBeVisible();
      await expect(page.getByText(`Імʼя для входу: ${username}`)).toBeVisible();
      await expect(
        page.getByText(
          'Нагадування приходять у застосунок на початковому екрані. Додай Легко туди й один раз увійди з цим імʼям і паролем.',
        ),
      ).toBeVisible();
      await expect(page.getByRole('list').getByRole('listitem').first()).toBeVisible();
      await expect(app.nav).toBeHidden();

      await page.getByRole('button', { name: 'Продовжити в Safari', exact: true }).click();
      await app.ready();
      await expect(app.sheet('Перші кроки')).toBeVisible();
      expect((await app.deviceCache()).user?.username).toBe(username);
    } finally {
      await deleteAccount(admin, username);
    }
  });

  test('the paste path: «Маю посилання» → the invite URL → registered and in the app', async ({
    page,
    app,
    admin,
  }) => {
    const username = uniqueUsername('paste');
    const { path } = await admin.createInvite('e2e paste');
    try {
      await page.goto('/');
      await page.getByRole('button', { name: 'Маю посилання', exact: true }).click();
      await page
        .getByLabel('Встав посилання із запрошенням або для нового пароля', { exact: true })
        .fill(`${BASE_URL}${path}`);
      await page.getByRole('button', { name: 'Відкрити', exact: true }).click();

      await expect(page.getByRole('heading', { level: 1, name: 'Запрошення в Легко' })).toBeVisible();
      expect(new URL(page.url()).pathname).toBe('/invite');
      expect(new URL(page.url()).hash).toBe('');
      await register(page, username, `e2e-pass-${username}`);

      // Still iPhone Safari here (the test browser is not the home-screen app): «Готово», then the app.
      await expect(page.getByText(`Імʼя для входу: ${username}`)).toBeVisible();
      await page.getByRole('button', { name: 'Продовжити в Safari', exact: true }).click();
      await app.ready();
      expect((await app.deviceCache()).user?.username).toBe(username);
    } finally {
      await deleteAccount(admin, username);
    }
  });
});
