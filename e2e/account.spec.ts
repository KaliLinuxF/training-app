/**
 * «Акаунт» (docs/multi-user.md §9.5, §11.2): the signed-in account's own page — change the password (every other
 * device of that account is signed out, this one stays signed in on a fresh cookie), rename the login (a taken name
 * is refused, the new name works at the next login), and «Вийти» at the bottom of the page (D30).
 *
 * Rules: anna and admin are never changed — the password and rename tests run on a throwaway account made with
 * `createUser()` and deleted in `finally`. This file makes one failed password check, one taken-name rename and one
 * refused login with the old name, each followed by a success; no server-derived dates are asserted.
 */
import type { Locator, Page } from '@playwright/test';
import { API } from '../packages/shared/src/index';
import { seedData } from './fixtures/data';
import type { App } from './support/app';
import { BASE_URL, USERNAME } from './support/env';
import { apiLogin, createUser, loginContext, uniqueUsername, type TestUser } from './support/server';
import { expect, test } from './support/test';

/** The «Пароль» card and its fields. */
function passwordCard(app: App) {
  const card = app.region('Пароль');
  return {
    card,
    current: card.getByLabel('Поточний пароль', { exact: true }),
    next: card.getByLabel('Новий пароль', { exact: true }),
    repeat: card.getByLabel('Повтори новий пароль', { exact: true }),
    submit: card.getByRole('button', { name: 'Змінити пароль', exact: true }),
    alert: card.getByRole('alert'),
  };
}

/** The «Імʼя для входу» card and its edit form. */
function nameCard(app: App) {
  const card = app.region('Імʼя для входу');
  return {
    card,
    edit: card.getByRole('button', { name: 'Змінити', exact: true }),
    name: card.getByLabel('Нове імʼя', { exact: true }),
    password: card.getByLabel('Пароль', { exact: true }),
    save: card.getByRole('button', { name: 'Зберегти імʼя', exact: true }),
    alert: card.getByRole('alert'),
  };
}

async function box(locator: Locator, what: string) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`${what} is not visible`);
  return b;
}

/** Signs this browser context in as `user` (data seeded, so «Перші кроки» stays closed) and opens «Акаунт». */
async function openAs(app: App, page: Page, user: TestUser): Promise<void> {
  await user.api.importData(seedData('demo'));
  await loginContext(page.context(), user.creds);
  await app.goto('/');
  await app.openSettings('Акаунт');
  await expect(app.region('Профіль')).toContainText(user.creds.username);
}

test.describe('«Акаунт» of a throwaway account', () => {
  test.use({ authed: false, seed: null });

  test('a wrong current password is refused in the card, nothing changes', async ({
    app,
    page,
    admin,
    playwright,
  }) => {
    const user = await createUser(playwright, admin);
    try {
      await openAs(app, page, user);
      const p = passwordCard(app);
      // The form tells password managers which account the new password is for.
      await expect(p.card.locator('input[name="username"][autocomplete="username"]')).toHaveValue(
        user.creds.username,
      );
      await expect(p.current).toHaveAttribute('autocomplete', 'current-password');
      await expect(p.next).toHaveAttribute('autocomplete', 'new-password');
      await expect(p.repeat).toHaveAttribute('autocomplete', 'new-password');

      await p.current.fill('not-the-password');
      await p.next.fill('brand-new-password');
      await p.repeat.fill('brand-new-password');
      await p.submit.click();
      await expect(p.alert).toHaveText('Поточний пароль неправильний');
      await expect(p.current).toBeFocused();
      // The old password still works.
      const check = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        await apiLogin(check, user.creds);
      } finally {
        await check.dispose();
      }
    } finally {
      await user.dispose();
    }
  });

  test('changing the password signs other devices out; this one stays signed in', async ({
    app,
    page,
    admin,
    playwright,
  }) => {
    const user = await createUser(playwright, admin);
    const next = `new-${user.creds.password}`;
    try {
      await openAs(app, page, user);
      // Another device of the same account (its own cookie jar).
      expect((await user.api.rawGet(API.me)).status()).toBe(200);

      const p = passwordCard(app);
      await p.current.fill(user.creds.password);
      await p.next.fill(next);
      await p.repeat.fill(next);
      await p.submit.click();
      await expect(app.toast('Пароль змінено')).toBeVisible();
      // Disabled while it worked, the button has the focus back (not <body>).
      await expect(p.submit).toBeFocused();
      await expect(p.current).toHaveValue('');
      await expect(p.next).toHaveValue('');
      await expect(p.repeat).toHaveValue('');
      await expect(p.card.getByText(/^Пароль змінено /)).toBeVisible();

      // The other device is out; this one keeps working after a reload (the server rotated its cookie).
      expect((await user.api.rawGet(API.me)).status()).toBe(401);
      await app.reload();
      await app.openSettings('Акаунт');
      await expect(app.region('Профіль')).toContainText(user.creds.username);
      expect((await page.context().request.get(API.me)).status()).toBe(200);

      // The new password works at login.
      const fresh = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        expect((await apiLogin(fresh, { username: user.creds.username, password: next })).id).toBe(user.id);
      } finally {
        await fresh.dispose();
      }
    } finally {
      await user.dispose();
    }
  });

  test('rename: a taken name is refused, the new one shows everywhere and works at login', async ({
    app,
    page,
    admin,
    playwright,
  }) => {
    const user = await createUser(playwright, admin);
    const renamed = uniqueUsername('ren');
    try {
      await openAs(app, page, user);
      const n = nameCard(app);
      await expect(n.edit).toHaveAttribute('aria-expanded', 'false');
      await n.edit.click();
      await expect(n.edit).toHaveAttribute('aria-expanded', 'true');
      await expect(n.name).toBeFocused();
      await expect(n.name).toHaveAttribute('autocomplete', 'username');
      await expect(n.name).toHaveAttribute('autocapitalize', 'none');
      await expect(n.password).toHaveAttribute('autocomplete', 'current-password');
      await expect(n.card.getByText('Після зміни входь з новим імʼям.')).toBeVisible();

      // anna's name is taken.
      await n.name.fill(USERNAME);
      await n.password.fill(user.creds.password);
      await n.save.click();
      await expect(n.alert).toHaveText('Це імʼя вже зайняте');
      await expect(n.name).toBeFocused();

      await n.name.fill(renamed);
      await n.save.click();
      await expect(app.toast('Імʼя змінено')).toBeVisible();
      await expect(n.name).toHaveCount(0);
      await expect(n.card).toContainText(renamed);
      await expect(app.region('Профіль')).toContainText(renamed);
      if (test.info().project.name === 'iphone') await app.settingsBack().click();
      await expect(app.settingsRow('Акаунт')).toHaveAccessibleName(`Акаунт ${renamed}`);
      await expect.poll(async () => (await app.deviceCache()).user?.username).toBe(renamed);

      // The old name is gone (one refused login), the new one signs in through the login screen.
      const old = await user.api.rawPost(API.login, {
        username: user.creds.username,
        password: user.creds.password,
      });
      expect(old.status()).toBe(401);
      await app.logoutUi();
      await app.loginUi({ username: renamed, password: user.creds.password });
      await app.ready();
      await app.openSettings('Акаунт');
      await expect(app.region('Профіль')).toContainText(renamed);
    } finally {
      // `dispose()` deletes the account under its current name.
      await user.dispose();
    }
  });
});

test.describe('«Акаунт» of anna', () => {
  test('«Вийти» sits at the bottom of «Акаунт» and no longer on the list', async ({ app, page }) => {
    await app.goto('/settings');
    await expect(page.getByRole('button', { name: 'Вийти', exact: true })).toHaveCount(0);
    await app.openSettings('Акаунт');

    const logout = page.getByRole('button', { name: 'Вийти', exact: true });
    await expect(logout).toBeVisible();
    await expect(app.region('Профіль')).toContainText(USERNAME);
    // (Not the date: it comes from the server's clock.)
    await expect(app.region('Профіль')).toContainText('Користувач · з ');
    const below = await box(logout, '«Вийти»');
    for (const name of ['Профіль', 'Пароль', 'Імʼя для входу']) {
      const card = await box(app.region(name), name);
      expect(below.y, `«Вийти» under «${name}»`).toBeGreaterThan(card.y + card.height - 1);
    }
    // Every target on the page is at least 44px tall; the fields have 16px text (no zoom on iOS).
    for (const field of await page.locator('main input:not([tabindex="-1"])').all()) {
      expect(parseFloat(await field.evaluate((el) => getComputedStyle(el).fontSize))).toBe(16);
      expect((await box(field, 'field')).height).toBeGreaterThanOrEqual(44);
    }
    expect((await box(logout, '«Вийти»')).height).toBeGreaterThanOrEqual(44);
  });

  test('on a 320px phone «Акаунт» has no side scroll', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone widths');
    await page.setViewportSize({ width: 320, height: 640 });
    await app.gotoSettings('Акаунт');
    await nameCard(app).edit.click();
    const overflow = await page.evaluate(
      () => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth,
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
