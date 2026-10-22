/**
 * «Користувачі» (docs/multi-user.md §9.6, §11.2): only an admin sees it; inviting (link card, copy, pending row,
 * revoke), the user sheet (role, the sole-admin lock, a reset link, disable / enable, delete with the typed name),
 * the AI limits, and the desktop pane + centred modal.
 *
 * Rules: anna and admin are never changed — every account touched here is a throwaway one from `createUser()`,
 * deleted (or demoted) in `finally`; the AI limits are restored after each test; pending invites are revoked by the
 * suite's auto fixture. This file makes one refused login (a disabled account) and one refused link (a revoked
 * invite), each followed by a success; no server-derived dates are asserted.
 */
import type { Locator, Page } from '@playwright/test';
import { API, type AdminOverview, type AiLimits } from '../packages/shared/src/index';
import { USERNAME_LABEL, type App } from './support/app';
import { ADMIN_USERNAME, BASE_URL } from './support/env';
import {
  apiLogin,
  createUser,
  tokenOf,
  uniqueUsername,
  type ServerApi,
  type TestUser,
} from './support/server';
import { expect, test } from './support/test';

const escapeRegExp = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function box(locator: Locator, what: string) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`${what} is not visible`);
  return b;
}

/** The «Акаунти · N» list. */
const accounts = (app: App): Locator => app.region(/^Акаунти · \d+$/);

/** An account's row in «Акаунти» (a button named «<name> …»). */
const accountRow = (app: App, username: string): Locator =>
  accounts(app).getByRole('button', { name: new RegExp(`^${escapeRegExp(username)}( |$)`) });

/** The pending invite rows («Запрошення · N»). */
const invites = (app: App): Locator => app.region(/^Запрошення · \d+$/);

/** Opens «Користувачі» and the sheet of `username`. */
async function openUser(app: App, username: string): Promise<Locator> {
  await app.gotoSettings('Користувачі');
  await accountRow(app, username).click();
  const sheet = app.userSheet(username);
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Answers the open in-app confirm with `button`. */
async function confirmWith(page: Page, button: string): Promise<void> {
  await page.getByRole('alertdialog').getByRole('button', { name: button, exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

/** Usable admins (role admin, active) of the overview. */
const usableAdmins = (overview: AdminOverview) =>
  overview.users.filter((u) => u.role === 'admin' && u.status === 'active');

/** Puts a throwaway account back to role user if a test left it promoted, then deletes it. */
async function cleanUp(admin: ServerApi, user: TestUser): Promise<void> {
  const current = (await admin.overview()).users.find((u) => u.id === user.id);
  if (current?.role === 'admin') await admin.setRole(user.id, 'user');
  await user.dispose();
}

test.describe('who sees «Користувачі»', () => {
  test('anna does not: no row, and /settings/users goes back to the list', async ({ app, page }) => {
    await app.goto('/settings');
    await expect(app.settingsRow('Акаунт')).toBeVisible();
    await expect(app.settingsRow('Користувачі')).toHaveCount(0);
    await app.goto('/settings/users');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(app.heading('Налаштування')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Користувачі' })).toHaveCount(0);
  });

  test.describe('the admin', () => {
    test.use({ account: 'admin' });

    test('does: the row opens the page with the accounts and no records of anyone', async ({
      app,
      admin,
    }) => {
      await app.goto('/');
      await app.openSettings('Користувачі');
      const overview = await admin.overview();
      await expect(app.region(`Акаунти · ${overview.users.length}`)).toBeVisible();
      await expect(accountRow(app, ADMIN_USERNAME)).toContainText('Це ти');
      await expect(accountRow(app, ADMIN_USERNAME)).toContainText('Адмін');
      await expect(app.region('Запросити людину')).toBeVisible();
      await expect(app.region('Підрахунки калорій')).toBeVisible();
    });
  });
});

test.describe('invites', () => {
  test.use({ account: 'admin' });

  test('create with a note → link card → copy → pending row → revoke → the link is dead', async ({
    app,
    page,
    context,
    browser,
  }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE_URL });
    const note = `e2e ${uniqueUsername('n')}`.slice(0, 40);
    await app.gotoSettings('Користувачі');

    const card = app.region('Запросити людину');
    await card.getByLabel('Підпис (для себе)', { exact: true }).fill(note);
    await card.getByRole('button', { name: 'Створити запрошення', exact: true }).click();

    const link = app.region('Запрошення готове');
    await expect(link).toBeVisible();
    const url = link.getByRole('textbox', { name: 'Посилання', exact: true });
    const href = await url.inputValue();
    expect(href).toMatch(new RegExp(`^${escapeRegExp(BASE_URL)}/invite#[A-Za-z0-9_-]{43}$`));
    await expect(link.getByText(/^Одноразове, діє до .+\.$/)).toBeVisible();
    await expect(link.getByText('Посилання видно тільки зараз — надішли його або збережи.')).toBeVisible();

    await link.getByRole('button', { name: 'Скопіювати', exact: true }).click();
    await expect(app.toast('Скопійовано')).toBeVisible();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(href);

    await link.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(link).toHaveCount(0);

    // The pending row names the note and its creator.
    const row = invites(app).getByRole('listitem').filter({ hasText: note });
    await expect(row).toContainText('від admin');
    await row.getByRole('button', { name: `Скасувати запрошення «${note}»` }).click();
    await confirmWith(page, 'Скасувати запрошення');
    await expect(app.toast('Запрошення скасовано')).toBeVisible();
    await expect(page.getByRole('listitem').filter({ hasText: note })).toHaveCount(0);
    // The place is kept: another invite's «Скасувати» or «Акаунти · N», never <body>.
    await expect.poll(() => page.evaluate(() => document.activeElement?.tagName ?? 'BODY')).not.toBe('BODY');

    // Someone opens the link anyway (another browser): it explains itself.
    const other = await browser.newContext({ baseURL: BASE_URL });
    try {
      const stranger = await other.newPage();
      await stranger.goto(new URL(href).pathname + new URL(href).hash);
      await expect(stranger.getByRole('heading', { level: 1, name: 'Посилання не працює' })).toBeVisible();
      await expect(stranger.getByText('Запрошення скасовано.')).toBeVisible();
    } finally {
      await other.close();
    }
  });

  test('an invite made in the console says «з консолі»; an admin invite has the «Адмін» pill', async ({
    app,
    page,
  }) => {
    // The UI only makes user invites (D19); stub the overview with the two kinds the CLI can make.
    await page.route(`**${API.adminUsers}`, async (route) => {
      const response = await route.fetch();
      const body = (await response.json()) as AdminOverview;
      const expiresAt = Date.now() + 86_400_000;
      body.invites = [
        {
          id: 'a'.repeat(32),
          note: 'з консолі',
          role: 'user',
          createdAt: Date.now(),
          expiresAt,
          createdBy: null,
        },
        { id: 'b'.repeat(32), note: '', role: 'admin', createdAt: Date.now(), expiresAt, createdBy: null },
      ];
      await route.fulfill({ response, json: body });
    });
    await app.gotoSettings('Користувачі');
    const rows = app.region('Запрошення · 2').getByRole('listitem');
    await expect(rows.nth(0)).toContainText(/до .+ · з консолі/);
    await expect(rows.nth(1)).toContainText('Без підпису');
    await expect(rows.nth(1)).toContainText('Адмін');
  });
});

test.describe('the user sheet', () => {
  test.use({ account: 'admin' });

  test('role: make a throwaway account an admin and back', async ({ app, page, admin, playwright }) => {
    const user = await createUser(playwright, admin);
    try {
      const sheet = await openUser(app, user.creds.username);
      const role = sheet.getByRole('radiogroup', { name: 'Роль' });
      await expect(role.getByRole('radio', { name: 'Користувач' })).toHaveAttribute('aria-checked', 'true');

      await role.getByRole('radio', { name: 'Адміністратор' }).click();
      await expect(page.getByRole('alertdialog')).toContainText(
        `Зробити ${user.creds.username} адміністратором?`,
      );
      await confirmWith(page, 'Зробити адміністратором');
      await expect(app.toast('Роль змінено')).toBeVisible();
      await expect(role.getByRole('radio', { name: 'Адміністратор' })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect
        .poll(async () => (await admin.overview()).users.find((u) => u.id === user.id)?.role)
        .toBe('admin');

      await role.getByRole('radio', { name: 'Користувач' }).click();
      await expect(page.getByRole('alertdialog')).toContainText(
        `Забрати права адміністратора в ${user.creds.username}?`,
      );
      await confirmWith(page, 'Забрати права');
      await expect(role.getByRole('radio', { name: 'Користувач' })).toHaveAttribute('aria-checked', 'true');
      await expect
        .poll(async () => (await admin.overview()).users.find((u) => u.id === user.id)?.role)
        .toBe('user');
    } finally {
      await cleanUp(admin, user);
    }
  });

  test('the only usable admin cannot change their own role', async ({ app, admin }) => {
    const usable = usableAdmins(await admin.overview());
    expect(
      usable.map((u) => u.username),
      'precondition: exactly one usable admin — an earlier spec left another one promoted',
    ).toEqual([ADMIN_USERNAME]);
    const sheet = await openUser(app, ADMIN_USERNAME);
    for (const radio of await sheet.getByRole('radiogroup', { name: 'Роль' }).getByRole('radio').all()) {
      await expect(radio).toBeDisabled();
    }
    await expect(sheet.getByText('Єдиний адміністратор — спершу признач іншого')).toBeVisible();
    // Yourself: no disable, no delete.
    await expect(sheet.getByRole('button', { name: 'Вимкнути акаунт' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Видалити акаунт…' })).toHaveCount(0);
  });

  test('a reset link for a throwaway account, shown once in the sheet', async ({
    app,
    admin,
    playwright,
  }) => {
    const user = await createUser(playwright, admin);
    try {
      const sheet = await openUser(app, user.creds.username);
      await sheet.getByRole('button', { name: 'Посилання для нового пароля', exact: true }).click();
      const link = sheet.getByRole('region', { name: 'Посилання готове' });
      await expect(link).toBeVisible();
      const href = await link.getByRole('textbox', { name: 'Посилання', exact: true }).inputValue();
      expect(href).toMatch(new RegExp(`^${escapeRegExp(BASE_URL)}/reset#[A-Za-z0-9_-]{43}$`));
      await expect(
        link.getByText('Одноразове, діє 24 години. Старий пароль працює, доки посиланням не скористаються.'),
      ).toBeVisible();
      // It is a working link for that account (checking it uses nothing up).
      const check = await admin.rawPost(API.resetCheck, { token: tokenOf(href) });
      expect(check.status()).toBe(200);
      expect(((await check.json()) as { username: string }).username).toBe(user.creds.username);

      await link.getByRole('button', { name: 'Готово', exact: true }).click();
      await expect(link).toHaveCount(0);
      await expect(
        sheet.getByRole('button', { name: 'Посилання для нового пароля', exact: true }),
      ).toBeFocused();
    } finally {
      await cleanUp(admin, user);
    }
  });

  test('disable → the login says so → enable → the login works again', async ({
    app,
    page,
    admin,
    playwright,
    browser,
  }) => {
    const user = await createUser(playwright, admin);
    try {
      let sheet = await openUser(app, user.creds.username);
      await sheet.getByRole('button', { name: 'Вимкнути акаунт', exact: true }).click();
      await expect(page.getByRole('alertdialog')).toContainText(`Вимкнути акаунт ${user.creds.username}?`);
      await confirmWith(page, 'Вимкнути');
      await expect(app.toast('Акаунт вимкнено')).toBeVisible();
      // The focus is back on the same button (disabled while it worked), now «Увімкнути акаунт».
      await expect(sheet.getByRole('button', { name: 'Увімкнути акаунт', exact: true })).toBeFocused();
      // A disabled account gets no reset link; its devices are signed out.
      await expect(sheet.getByText('Щоб надіслати посилання, спершу ввімкни акаунт.')).toBeVisible();
      await expect(sheet.getByRole('button', { name: /^Посилання для/ })).toHaveCount(0);
      expect((await user.api.rawGet(API.me)).status()).toBe(401);
      await page.keyboard.press('Escape');
      await expect(accountRow(app, user.creds.username)).toContainText('Вимкнено');

      // Their login (another browser) is refused with the reason.
      const other = await browser.newContext({ baseURL: BASE_URL });
      try {
        const theirs = await other.newPage();
        await theirs.goto('/');
        await theirs.getByLabel(USERNAME_LABEL, { exact: true }).fill(user.creds.username);
        await theirs.getByLabel('Пароль', { exact: true }).fill(user.creds.password);
        await theirs.getByRole('button', { name: 'Увійти', exact: true }).click();
        await expect(theirs.getByText('Акаунт вимкнено. Звернись до адміністратора')).toBeVisible();
      } finally {
        await other.close();
      }

      sheet = await openUser(app, user.creds.username);
      await sheet.getByRole('button', { name: 'Увімкнути акаунт', exact: true }).click();
      await expect(app.toast('Акаунт увімкнено')).toBeVisible();
      await expect(sheet.getByRole('button', { name: 'Вимкнути акаунт', exact: true })).toBeVisible();
      const again = await playwright.request.newContext({ baseURL: BASE_URL });
      try {
        expect((await apiLogin(again, user.creds)).id).toBe(user.id);
      } finally {
        await again.dispose();
      }
    } finally {
      await cleanUp(admin, user);
    }
  });

  test('delete only after typing the name; the account and its row are gone', async ({
    app,
    page,
    admin,
    playwright,
  }) => {
    const user = await createUser(playwright, admin, { username: uniqueUsername('del') });
    try {
      const sheet = await openUser(app, user.creds.username);
      await sheet.getByRole('button', { name: 'Видалити акаунт…', exact: true }).click();
      await expect(
        sheet.getByRole('heading', { name: `Видалити акаунт ${user.creds.username}?` }),
      ).toBeVisible();
      const typed = sheet.getByRole('textbox', { name: 'Імʼя для підтвердження', exact: true });
      await expect(typed).toBeFocused();
      for (const [attr, value] of [
        ['autocapitalize', 'none'],
        ['autocomplete', 'off'],
        ['autocorrect', 'off'],
        ['spellcheck', 'false'],
      ] as const) {
        await expect(typed).toHaveAttribute(attr, value);
      }
      const remove = sheet.getByRole('button', { name: 'Видалити назавжди', exact: true });
      await expect(remove).toBeDisabled();
      await typed.fill(user.creds.username.slice(0, -1));
      await expect(remove).toBeDisabled();

      // Escape leaves the delete panel first, not the sheet.
      await page.keyboard.press('Escape');
      await expect(sheet).toBeVisible();
      await expect(typed).toHaveCount(0);

      await sheet.getByRole('button', { name: 'Видалити акаунт…', exact: true }).click();
      await typed.fill(user.creds.username.toUpperCase());
      await expect(remove).toBeEnabled();
      await remove.click();
      await expect(app.toast(`Акаунт ${user.creds.username} видалено`)).toBeVisible();
      await expect(sheet).toHaveCount(0);
      await expect(accountRow(app, user.creds.username)).toHaveCount(0);
      // Its row (the sheet's opener) is gone: the focus is on «Акаунти · N», not on <body>.
      await expect(accounts(app).getByRole('heading', { name: /^Акаунти · \d+$/ })).toBeFocused();
      expect((await admin.overview()).users.some((u) => u.id === user.id)).toBe(false);
      expect((await user.api.rawGet(API.me)).status()).toBe(401);
    } finally {
      // Already gone: a no-op then.
      await cleanUp(admin, user);
    }
  });

  test('an own AI limit for a throwaway account', async ({ app, admin, playwright }) => {
    const user = await createUser(playwright, admin);
    try {
      const sheet = await openUser(app, user.creds.username);
      const toggle = sheet.getByRole('switch', { name: 'Окремий ліміт підрахунків' });
      await expect(toggle).toHaveAttribute('aria-checked', 'false');
      await toggle.click();
      const stepper = sheet.getByRole('group', { name: 'Ліміт на день' });
      await stepper.getByRole('button', { name: 'Збільшити ліміт' }).click();
      await sheet.getByRole('button', { name: 'Зберегти ліміт', exact: true }).click();
      await expect(app.toast('Збережено')).toBeVisible();
      // One step above the default it started from.
      const perUser = (await admin.overview()).limits.perUser;
      await expect
        .poll(async () => (await admin.overview()).users.find((u) => u.id === user.id)?.ai.customLimit)
        .toBeGreaterThan(Math.min(perUser, 995));
      await expect(sheet.getByRole('button', { name: 'Зберегти ліміт', exact: true })).toHaveCount(0);
      // «Зберегти ліміт» went away with the focus on it: the switch above takes it.
      await expect(toggle).toBeFocused();
    } finally {
      await cleanUp(admin, user);
    }
  });
});

test.describe('AI limits', () => {
  test.use({ account: 'admin' });

  let original: AiLimits | null = null;

  test.beforeEach(async ({ admin }) => {
    original = (await admin.overview()).limits;
  });

  test.afterEach(async ({ admin }) => {
    if (original) await admin.setAiLimits(original);
    original = null;
  });

  test('«Зберегти ліміти» is enabled only once a limit changed, and saves it', async ({ app, admin }) => {
    await app.gotoSettings('Користувачі');
    const card = app.region('Підрахунки калорій');
    const save = card.getByRole('button', { name: 'Зберегти ліміти', exact: true });
    await expect(save).toBeDisabled();
    await expect(card.getByText('0 — підрахунки вимкнено.')).toBeVisible();
    await card
      .getByRole('group', { name: 'На людину за день' })
      .getByRole('button', { name: 'Збільшити ліміт на людину' })
      .click();
    await expect(save).toBeEnabled();
    await save.click();
    await expect(app.toast('Збережено')).toBeVisible();
    await expect(save).toBeDisabled();
    // Nothing is left to save, so the button stays disabled: the card title holds the focus instead of <body>.
    await expect(card.getByRole('heading', { name: 'Підрахунки калорій', exact: true })).toBeFocused();
    const before = original?.perUser ?? 0;
    await expect.poll(async () => (await admin.overview()).limits.perUser).toBeGreaterThan(before);
  });
});

test.describe('layout', () => {
  test.use({ account: 'admin' });

  test('the page is a pane next to the list; the user sheet is the centred modal', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');
    await app.gotoSettings('Користувачі');
    await expect(app.settingsRow('Користувачі')).toHaveAttribute('aria-current', 'page');
    const pane = app.region('Користувачі');
    await expect(pane.getByRole('heading', { level: 2, name: 'Користувачі' })).toBeVisible();
    const [list, detail] = [
      await box(page.getByRole('navigation', { name: 'Розділи налаштувань' }), 'list'),
      await box(pane, 'pane'),
    ];
    expect(list.x + list.width).toBeLessThanOrEqual(detail.x);
    expect(detail.width).toBeLessThanOrEqual(640.5);

    await accountRow(app, ADMIN_USERNAME).click();
    const sheet = app.userSheet(ADMIN_USERNAME);
    await expect(sheet).toBeVisible();
    const modal = await box(sheet, 'user sheet');
    const viewport = page.viewportSize();
    if (!viewport) throw new Error('no viewport');
    expect(modal.width).toBeLessThanOrEqual(560.5);
    // Centred (a scrollbar gutter may shift it by a few px).
    expect(Math.abs(modal.x + modal.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(12);
    expect(modal.y).toBeGreaterThan(0);
    await page.keyboard.press('Escape');
    await expect(sheet).toHaveCount(0);
  });

  test('on a 320px phone the page and the sheet have no side scroll', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone widths');
    await page.setViewportSize({ width: 320, height: 640 });
    const sideScroll = () =>
      page.evaluate(
        () => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth,
      );
    await app.gotoSettings('Користувачі');
    expect(await sideScroll()).toBeLessThanOrEqual(0);
    await accountRow(app, ADMIN_USERNAME).click();
    const sheet = app.userSheet(ADMIN_USERNAME);
    await expect(sheet).toBeVisible();
    const role = await box(sheet.getByRole('radiogroup', { name: 'Роль' }), 'Роль');
    const panel = await box(sheet, 'sheet');
    expect(role.x + role.width).toBeLessThanOrEqual(panel.x + panel.width);
  });
});
