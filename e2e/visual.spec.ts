/**
 * Visual review pass (not pixel assertions): every screen and sheet mode, light and dark, saved to
 * e2e/__screenshots__/<project>/<scheme>/ for a human to look through (redesign A «Чек-лист дня», meals and
 * Б · Ж · В of docs/meals-macros.md §7).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page, TestInfo } from '@playwright/test';
import {
  API,
  coachSummary,
  normalizeDay,
  type AdminInvite,
  type AdminOverview,
  type AppData,
  type FoodEstimateResponse,
  type InviteCreatedResponse,
  type LinkResponse,
  type SessionUser,
} from '../packages/shared/src/index';
import {
  COACH_PHOTO_IDS,
  COACH_STUB_IDS,
  COACH_STUB_NAMES,
  coachClientPayload,
  coachClientsPayload,
} from './fixtures/coach';
import { USERNAME_LABEL } from './support/app';
import { stubCoachClient, stubCoachClients, stubCoachPhotos } from './support/coachApi';
import {
  clientRow,
  clientsRegion,
  clientTab,
  dayView,
  expectNoSideScroll,
  openClient,
  openClients,
  showFilter,
} from './support/coachUi';
import { BASE_URL, FIXED_NOW, TODAY } from './support/env';
import { FOOD_JPEG, mockFood, PHOTO_ESTIMATE, PHOTO_ID } from './support/food';
import type { ServerApi } from './support/server';
import { expect, test } from './support/test';

const OUT = fileURLToPath(new URL('./__screenshots__/', import.meta.url));

// ── Accounts: fixed answers relative to FIXED_NOW (the browser clock is fixed, the server's is real; throwaway
//    account names are time-based), so the screenshots are the same on every run (docs/multi-user.md §11.2) ──────

const NOW = FIXED_NOW.getTime();
const DAY = 86_400_000;
/** A well-formed one-time link token (the check endpoints are stubbed, so nobody has to issue it). */
const LINK_TOKEN = 'e2eVisualLinkToken_0123456789abcdefghijklmn';

/** `GET /api/auth/me` answers the real account (its id keeps `X-Legko-User` right) with fixed dates. */
async function stubMe(page: Page, api: ServerApi, patch: Partial<SessionUser> = {}): Promise<SessionUser> {
  const user: SessionUser = {
    ...(await api.me()),
    createdAt: Date.parse('2026-08-03T09:00:00+03:00'),
    passwordChange: { at: NOW - DAY, via: 'reset', by: 'admin' },
    ...patch,
  };
  await page.route(`**${API.me}`, (route) => route.fulfill({ json: { ok: true, user } }));
  return user;
}

/** `GET /api/admin/users`: the admin (self), anna, a disabled and a pending account, two pending invites. */
async function stubOverview(page: Page, admin: ServerApi, server: ServerApi): Promise<AdminOverview> {
  const ai = (today: number, last30Days: number, customLimit: number | null = null) => ({
    today,
    last30Days,
    limit: customLimit ?? 40,
    customLimit,
  });
  const overview: AdminOverview = {
    users: [
      {
        id: admin.id,
        username: 'admin',
        role: 'admin',
        status: 'active',
        createdAt: NOW - 40 * DAY,
        lastSeenAt: NOW - 5 * 60_000,
        ai: ai(0, 2),
        self: true,
      },
      {
        id: server.id,
        username: 'anna',
        role: 'user',
        status: 'active',
        createdAt: Date.parse('2026-08-03T09:00:00+03:00'),
        lastSeenAt: NOW - 2 * 3600_000,
        ai: ai(3, 41),
        self: false,
      },
      {
        id: 'c'.repeat(32),
        username: 'olya',
        role: 'user',
        status: 'disabled',
        createdAt: NOW - 12 * DAY,
        lastSeenAt: NOW - 3 * DAY,
        ai: ai(0, 9, 20),
        self: false,
      },
      {
        id: 'd'.repeat(32),
        username: 'ira.k',
        role: 'admin',
        status: 'pending',
        createdAt: NOW - DAY,
        lastSeenAt: null,
        ai: ai(0, 0),
        self: false,
      },
    ],
    invites: [
      {
        id: 'e'.repeat(32),
        note: 'для Олі',
        role: 'user',
        createdAt: NOW - DAY,
        expiresAt: NOW + 6 * DAY,
        createdBy: 'admin',
      },
      {
        id: 'f'.repeat(32),
        note: '',
        role: 'admin',
        createdAt: NOW - 3600_000,
        expiresAt: NOW + 7 * DAY,
        createdBy: null,
      },
    ],
    limits: { perUser: 40, global: 150 },
    aiToday: { used: 12, ceiling: 150 },
  };
  await page.route(`**${API.adminUsers}`, (route) =>
    route.request().method() === 'GET' ? route.fulfill({ json: overview }) : route.fallback(),
  );
  return overview;
}

/** The invite / reset checks answer a usable link (expiry relative to FIXED_NOW). */
async function stubLinkChecks(page: Page): Promise<void> {
  await page.route(`**${API.inviteCheck}`, (route) =>
    route.fulfill({ json: { ok: true, expiresAt: NOW + 7 * DAY } }),
  );
  await page.route(`**${API.resetCheck}`, (route) =>
    route.fulfill({ json: { ok: true, username: 'anna', purpose: 'reset', expiresAt: NOW + DAY } }),
  );
}

/** The reset check answers `answer` instead (another name, the `setup` purpose). */
async function restubResetCheck(
  page: Page,
  answer: { username: string; purpose: 'reset' | 'setup' },
): Promise<void> {
  await page.unroute(`**${API.resetCheck}`);
  await page.route(`**${API.resetCheck}`, (route) =>
    route.fulfill({ json: { ok: true, ...answer, expiresAt: NOW + DAY } }),
  );
}

/** A throwaway account the mocked link flows sign in (nobody is created on the server). */
const OLYA: SessionUser = {
  id: 'b'.repeat(32),
  username: 'olya',
  role: 'user',
  createdAt: NOW,
  legacyOwner: false,
  passwordChange: null,
};

/**
 * «Створити запрошення» and «Посилання для нового пароля» answer fixed links (nothing is issued, so the shots show
 * the same token and expiry on every run).
 */
async function stubLinkCreation(page: Page): Promise<void> {
  const invite: AdminInvite = {
    id: '9'.repeat(32),
    note: '',
    role: 'user',
    createdAt: NOW,
    expiresAt: NOW + 7 * DAY,
    createdBy: 'admin',
  };
  const created: InviteCreatedResponse = {
    ok: true,
    path: `/invite#${LINK_TOKEN}`,
    expiresAt: NOW + 7 * DAY,
    invite,
  };
  const reset: LinkResponse = { ok: true, path: `/reset#${LINK_TOKEN}`, expiresAt: NOW + DAY };
  await page.route(`**${API.adminInviteCreate}`, (route) =>
    route.request().method() === 'POST' ? route.fulfill({ json: created }) : route.fallback(),
  );
  await page.route(`**${API.adminResetLink}`, (route) => route.fulfill({ json: reset }));
}

/** Fills the invite form (name, password twice) and sends it. */
async function submitInvite(page: Page, username: string): Promise<void> {
  await page.getByLabel(USERNAME_LABEL, { exact: true }).fill(username);
  await page.getByLabel('Пароль', { exact: true }).fill('e2e-visual-pass');
  await page.getByLabel('Повтори пароль', { exact: true }).fill('e2e-visual-pass');
  await page.getByRole('button', { name: 'Створити акаунт', exact: true }).click();
}

/** A plate with weighed and counted positions (the item editor's shots). */
const EDITOR_ESTIMATE: FoodEstimateResponse = {
  photoId: PHOTO_ID,
  items: [
    { name: 'Гречка', portion: '200 г', kcal: 220, protein: 8, fat: 2, carbs: 44 },
    { name: 'Котлета куряча', portion: '1 шт', kcal: 180, protein: 18, fat: 11, carbs: 3 },
    { name: 'Салат з огірків', portion: '100 г', kcal: 45, protein: 1, fat: 3.5, carbs: 3 },
  ],
  totalKcal: 445,
  comment: 'Олія в салаті — приблизно 1 ложка',
};

/**
 * Saves a screenshot. `fullPage` on desktop captures the whole page at once; on the phone the
 * floating tab bar is `position: fixed`, which a stitched full-page capture would paint in the
 * middle of the page, so long screens are saved as viewport-sized pages instead (`name-1`, `name-2`…).
 * A phone screen that fits the viewport (Home) is saved as one `name.png`.
 */
async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  const dir = join(OUT, info.project.name, scheme(info));
  mkdirSync(dir, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true })),
      ),
    );
  });
  const { total, view } = await page.evaluate(() => ({
    total: document.documentElement.scrollHeight,
    view: window.innerHeight,
  }));
  if (!fullPage || info.project.name !== 'iphone' || total <= view + 1) {
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage, animations: 'disabled' });
    return;
  }
  const step = view - 160; // overlap so nothing hides behind the tab bar between pages
  for (let i = 0, y = 0; y < total - 160 && i < 8; i++, y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    // The page may still grow or shrink a little (fonts, a late row): scroll again and compare with its height now.
    await expect
      .poll(() =>
        page.evaluate((top) => {
          const target = Math.min(
            top,
            Math.round(document.documentElement.scrollHeight - window.innerHeight),
          );
          if (Math.round(window.scrollY) !== target) window.scrollTo(0, top);
          return Math.round(window.scrollY) === target;
        }, y),
      )
      .toBe(true);
    await page.screenshot({ path: join(dir, `${name}-${i + 1}.png`), animations: 'disabled' });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** A sheet taller than its panel: the rest of it, scrolled to the bottom (`name-bottom`), then back to the top. */
async function sheetBottom(page: Page, info: TestInfo, sheet: Locator, name: string): Promise<void> {
  const scrolls = await sheet.evaluate((el) => el.scrollHeight > el.clientHeight + 1);
  if (!scrolls) return;
  await sheet.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  await shot(page, info, `${name}-bottom`);
  await sheet.evaluate((el) => el.scrollTo(0, 0));
}

/** The scheme set by `test.use` in the enclosing describe (recorded in the title path). */
const scheme = (info: TestInfo): string => (info.titlePath.includes('dark') ? 'dark' : 'light');

async function scrollTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

/**
 * A whole long page on the desktop without Chrome's full-page capture: that capture resizes the window to 1×1 for a
 * moment and the shell turns into the phone one and back (the tab strip no longer scrolls the page, but the swap still
 * remounts the shell mid-capture). So the window is made as tall as the page instead, shot, and restored. On the phone this is `shot(…, true)` (viewport-sized pages).
 */
async function tallShot(page: Page, info: TestInfo, name: string): Promise<void> {
  const size = page.viewportSize();
  if (info.project.name !== 'desktop' || !size) {
    await shot(page, info, name, true);
    return;
  }
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  await page.setViewportSize({ width: size.width, height: Math.max(size.height, height) });
  await expect.poll(() => page.evaluate(() => window.innerHeight)).toBe(Math.max(size.height, height));
  await shot(page, info, name);
  await page.setViewportSize(size);
}

/**
 * Scrolls to the top and waits until the page stays there (a tab switch may still be scrolling its strip into view);
 * a desktop full-page capture of a scrolled page would paint the sticky sidebar and period bar mid-page.
 */
async function settleAtTop(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() => {
        if (window.scrollY !== 0) window.scrollTo(0, 0);
        return window.scrollY;
      }),
    )
    .toBe(0);
}

/** Scrolls the page so `locator` sits near the top of the viewport (below the sticky bar / notch). */
async function scrollToTop(page: Page, locator: Locator, offset = 80): Promise<void> {
  const top = await locator.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top - offset));
}

/** The computed colour of a token (`--accD` …) as the page resolves it. */
const tokenColor = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

/**
 * «Клієнти» with the stub roster of e2e/fixtures/coach.ts (olya, marta, ivan, sofia, taras, petro; relative to
 * FIXED_NOW): the list, each client page and every coach photo (FOOD_JPEG) are served by `page.route`, so the shots
 * do not depend on the real server clock or on other accounts. Returns the requested coach photo URLs (live).
 */
async function stubCoach(page: Page, admin: ServerApi): Promise<string[]> {
  await stubMe(page, admin, {
    createdAt: NOW - 40 * DAY,
    passwordChange: { at: NOW - 40 * DAY, via: 'setup', by: null },
  });
  await stubCoachClients(page, coachClientsPayload());
  for (const name of COACH_STUB_NAMES) await stubCoachClient(page, coachClientPayload(name));
  return stubCoachPhotos(page, FOOD_JPEG);
}

/**
 * The 'meals' seed with a big second breakfast and lower goals: 1 760 / 1 700 ккал (over) and
 * «Б 52/45 · Ж 59/60 · В 183 г» (protein over, fat just under, carbs without a goal).
 */
function overGoals(data: AppData): AppData {
  const today = data.days[TODAY];
  if (!today?.meals) throw new Error('the meals seed has meals today');
  data.days[TODAY] = normalizeDay({
    ...today,
    meals: [
      ...today.meals,
      {
        id: 'e2eBrunch001',
        type: 'Перекус',
        time: '09:55',
        text: 'Сирники зі сметаною і медом',
        kcal: 1300,
        protein: 40,
        fat: 50,
        carbs: 120,
      },
    ],
  });
  data.settings.macroGoals = { protein: 45, fat: 60, carbs: null };
  return data;
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test.describe('logged out', () => {
      test.use({ authed: false });

      test('login', async ({ page }, info) => {
        await page.goto('/');
        await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toBeVisible();
        await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
        await shot(page, info, '01-login', true);
        // A refused login, mocked (a real one would count against the shared limits).
        await page.route(`**${API.login}`, (r) =>
          r.fulfill({
            status: 401,
            json: { error: 'bad_credentials', message: 'Неправильне імʼя або пароль' },
          }),
        );
        await page.getByLabel(USERNAME_LABEL, { exact: true }).fill('anna');
        await page.getByLabel('Пароль', { exact: true }).fill('wrong-password');
        await page.getByRole('button', { name: 'Увійти', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveText('Неправильне імʼя або пароль');
        await shot(page, info, '02-login-error', true);
        // «Маю посилання»: paste an invite / reset link into the installed app.
        await page.getByRole('button', { name: 'Маю посилання', exact: true }).click();
        await expect(
          page.getByLabel('Встав посилання із запрошенням або для нового пароля', { exact: true }),
        ).toBeFocused();
        await shot(page, info, '03-login-link', true);
      });

      test('invite and reset links', async ({ page }, info) => {
        await stubLinkChecks(page);
        await page.goto(`/invite#${LINK_TOKEN}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Запрошення в Легко' })).toBeVisible();
        await expect(page.getByText('Посилання одноразове, діє до 21 жовтня.')).toBeVisible();
        await shot(page, info, '04-invite', true);
        if (info.project.name === 'iphone') {
          await page.setViewportSize({ width: 320, height: 640 });
          await expectNoSideScroll(page, 'invite 320');
          await shot(page, info, '04-invite-320', true);
          await page.setViewportSize({ width: 390, height: 844 });
        }

        // A taken name (mocked: a real accept would use the link up): the error under the form, focus in the name.
        await page.route(`**${API.inviteAccept}`, (route) =>
          route.fulfill({ status: 409, json: { error: 'username_taken', message: 'Username taken' } }),
        );
        await submitInvite(page, 'olya');
        await expect(page.getByRole('alert')).toHaveText('Це імʼя вже зайняте — обери інше');
        await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toBeFocused();
        await shot(page, info, '04-invite-taken', true);

        // A used invite explains itself.
        await page.unroute(`**${API.inviteCheck}`);
        await page.route(`**${API.inviteCheck}`, (route) =>
          route.fulfill({
            status: 410,
            json: { error: 'link_invalid', message: 'Посилання не працює', reason: 'used' },
          }),
        );
        // A fresh page load (the same path with only a new fragment would not reload).
        await page.goto('about:blank');
        await page.goto(`/invite#${LINK_TOKEN}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Посилання не працює' })).toBeVisible();
        await shot(page, info, '05-invite-used', true);

        await page.goto(`/reset#${LINK_TOKEN}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Новий пароль' })).toBeVisible();
        await expect(page.getByText('для anna', { exact: true })).toBeVisible();
        await shot(page, info, '06-reset', true);
        // Passwords that do not match (checked before anything is sent): the error, focus in the repeat field.
        await page.getByLabel('Новий пароль', { exact: true }).fill('e2e-visual-pass');
        await page.getByLabel('Повтори пароль', { exact: true }).fill('e2e-visual-pasz');
        await page.getByRole('button', { name: 'Зберегти пароль', exact: true }).click();
        await expect(page.getByRole('alert')).toHaveText('Паролі не збігаються');
        await expect(page.getByLabel('Повтори пароль', { exact: true })).toBeFocused();
        await shot(page, info, '06-reset-mismatch', true);

        // The setup link the owner opens after `create-admin admin`: «Створення пароля», its own expiry line.
        await restubResetCheck(page, { username: 'admin', purpose: 'setup' });
        await page.goto('about:blank');
        await page.goto(`/reset#${LINK_TOKEN}`);
        await expect(page.getByRole('heading', { level: 1, name: 'Створення пароля' })).toBeVisible();
        await expect(page.getByText('для admin', { exact: true })).toBeVisible();
        await expect(page.getByText(/діє до 15 жовтня, 10:00/)).toBeVisible();
        await shot(page, info, '06-setup', true);
      });

      test('«Готово» after a link in iPhone Safari', async ({ page }, info) => {
        test.skip(
          info.project.name !== 'iphone',
          'iOS Safari only: anywhere else the page reloads into the app',
        );
        await stubLinkChecks(page);
        // Mocked answers (a real accept would create an account): the link signs «olya» in.
        await page.route(`**${API.inviteAccept}`, (route) =>
          route.fulfill({ json: { ok: true, user: OLYA } }),
        );
        await page.goto(`/invite#${LINK_TOKEN}`);
        await submitInvite(page, 'olya');
        await expect(page.getByRole('heading', { level: 1, name: 'Акаунт створено' })).toBeVisible();
        await expect(page.getByText('Імʼя для входу: olya')).toBeVisible();
        await shot(page, info, '08-invite-done', true);

        // The device is olya's now: a password link for her ends in «Пароль збережено».
        await restubResetCheck(page, { username: 'olya', purpose: 'reset' });
        await page.route(`**${API.resetComplete}`, (route) =>
          route.fulfill({ json: { ok: true, user: OLYA } }),
        );
        await page.goto('about:blank');
        await page.goto(`/reset#${LINK_TOKEN}`);
        await expect(page.getByText('для olya', { exact: true })).toBeVisible();
        await page.getByLabel('Новий пароль', { exact: true }).fill('e2e-visual-pass-2');
        await page.getByLabel('Повтори пароль', { exact: true }).fill('e2e-visual-pass-2');
        await page.getByRole('button', { name: 'Зберегти пароль', exact: true }).click();
        await expect(page.getByRole('heading', { level: 1, name: 'Пароль збережено' })).toBeVisible();
        await shot(page, info, '08-reset-done', true);
      });
    });

    test('a link opened while signed in: sign out first', async ({ page }, info) => {
      await stubLinkChecks(page);
      await page.goto(`/invite#${LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Запрошення в Легко' })).toBeVisible();
      await expect(
        page.getByText('На цьому пристрої вже ввійдено як anna. Щоб створити новий акаунт, спершу вийди.'),
      ).toBeVisible();
      await shot(page, info, '09-invite-signed-in', true);
      // Someone else's password link.
      await restubResetCheck(page, { username: 'olya', purpose: 'reset' });
      await page.goto(`/reset#${LINK_TOKEN}`);
      await expect(
        page.getByText('Це посилання для olya, а на цьому пристрої ввійдено як anna.'),
      ).toBeVisible();
      await shot(page, info, '09-reset-signed-in', true);
    });

    test('login after an expired session with an unsent change', async ({ app, page, context }, info) => {
      await app.goto('/');
      await context.setOffline(true);
      await app.trainingToggle('Не було').click();
      await expect(app.toast('Відмічено: без тренування')).toBeVisible();
      await context.clearCookies();
      await context.setOffline(false);
      await expect(app.loginButton()).toBeVisible();
      await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toHaveValue('anna');
      await expect(page.getByText(/^На цьому пристрої є зміни anna/)).toBeVisible();
      // The «Відмічено…» toast from before the session ended would cover the logo.
      await expect(app.toast('Відмічено: без тренування')).toBeHidden({ timeout: 10_000 });
      await shot(page, info, '07-login-pending', true);
    });

    test('«Акаунт»', async ({ app, page, context, server }, info) => {
      await stubMe(page, server);
      await mockFood(page, { status: { enabled: true, remainingToday: 37, limitToday: 40 } });
      await app.gotoSettings('Акаунт');
      await expect(app.region('Профіль')).toContainText('Користувач · з 3 серпня 2026');
      await expect(app.region('Пароль')).toContainText('Пароль задано 13 жовтня за посиланням від admin.');
      await expect(app.region('Підрахунки калорій')).toContainText('Сьогодні ще 37 з 40');
      await scrollTop(page);
      await shot(page, info, '49-settings-account', true);
      const nameCard = app.region('Імʼя для входу');
      await nameCard.getByRole('button', { name: 'Змінити', exact: true }).click();
      await expect(nameCard.getByLabel('Нове імʼя', { exact: true })).toBeFocused();
      await scrollToTop(page, nameCard, 120);
      await shot(page, info, '49-settings-account-rename');
      await nameCard.getByRole('button', { name: 'Скасувати', exact: true }).click();

      // Offline: account changes are online only, so the button is off and says why.
      const passwordCard = app.region('Пароль');
      await context.setOffline(true);
      await expect(passwordCard.getByText('Потрібен інтернет', { exact: true })).toBeVisible();
      await expect(passwordCard.getByRole('button', { name: 'Змінити пароль', exact: true })).toBeDisabled();
      await scrollToTop(page, passwordCard, 120);
      await shot(page, info, '49-settings-account-offline');
      await context.setOffline(false);
      await expect(passwordCard.getByRole('button', { name: 'Змінити пароль', exact: true })).toBeEnabled();

      // A wrong current password (mocked: a real one would count against the password limiter).
      await page.route(`**${API.accountPassword}`, (route) =>
        route.fulfill({ status: 403, json: { error: 'wrong_password', message: 'Wrong password' } }),
      );
      await passwordCard.getByLabel('Поточний пароль', { exact: true }).fill('not-my-password');
      await passwordCard.getByLabel('Новий пароль', { exact: true }).fill('e2e-visual-pass');
      await passwordCard.getByLabel('Повтори новий пароль', { exact: true }).fill('e2e-visual-pass');
      await passwordCard.getByRole('button', { name: 'Змінити пароль', exact: true }).click();
      await expect(passwordCard.getByRole('alert')).toHaveText('Поточний пароль неправильний');
      await expect(passwordCard.getByLabel('Поточний пароль', { exact: true })).toBeFocused();
      await scrollToTop(page, passwordCard, 120);
      await shot(page, info, '49-settings-account-wrong-password');
    });

    test.describe('the admin', () => {
      test.use({ account: 'admin' });

      test('settings list, «Користувачі», the user sheet and the delete panel', async ({
        app,
        page,
        admin,
        server,
      }, info) => {
        await stubMe(page, admin, {
          createdAt: NOW - 40 * DAY,
          passwordChange: { at: NOW - 40 * DAY, via: 'setup', by: null },
        });
        await stubOverview(page, admin, server);
        await app.goto('/settings');
        await expect(app.settingsRow('Користувачі')).toContainText('4 акаунти');
        await expect(app.settingsRow('Акаунт')).toContainText('admin');
        await shot(page, info, '40-settings-admin', true);

        await app.gotoSettings('Користувачі');
        await expect(app.region('Акаунти · 4')).toBeVisible();
        await expect(app.region('Запрошення · 2')).toBeVisible();
        await shot(page, info, '491-settings-users', true);

        await app
          .region('Акаунти · 4')
          .getByRole('button', { name: /^anna( |$)/ })
          .click();
        const sheet = app.userSheet('anna');
        await expect(sheet).toContainText('Користувач · з 3 серпня 2026');
        await shot(page, info, '492-user-sheet');
        await sheetBottom(page, info, sheet, '492-user-sheet');

        await sheet.getByRole('button', { name: 'Видалити акаунт…', exact: true }).click();
        await expect(
          sheet.getByRole('textbox', { name: 'Імʼя для підтвердження', exact: true }),
        ).toBeFocused();
        await shot(page, info, '493-user-sheet-delete');

        if (info.project.name === 'iphone') {
          await page.setViewportSize({ width: 320, height: 640 });
          await expectNoSideScroll(page, 'delete panel 320');
          await shot(page, info, '493-user-sheet-delete-320');
          // Back to the details (Escape leaves the delete panel first).
          await page.keyboard.press('Escape');
          await expect(sheet.getByRole('radiogroup', { name: 'Роль' })).toBeVisible();
          await expectNoSideScroll(page, 'user sheet 320');
          await shot(page, info, '492-user-sheet-320');
          await sheetBottom(page, info, sheet, '492-user-sheet-320');
        }
      });

      test('«Користувачі» at 320, a fresh invite link and a password link in the user sheet', async ({
        app,
        page,
        admin,
        server,
      }, info) => {
        const phone = info.project.name === 'iphone';
        await stubMe(page, admin, {
          createdAt: NOW - 40 * DAY,
          passwordChange: { at: NOW - 40 * DAY, via: 'setup', by: null },
        });
        await stubOverview(page, admin, server);
        await stubLinkCreation(page);
        await app.gotoSettings('Користувачі');
        await expect(app.region('Акаунти · 4')).toBeVisible();
        if (phone) {
          // The rows with two pills and a status («ira.k», Адмін, Пароль не задано) wrap here.
          await page.setViewportSize({ width: 320, height: 640 });
          await expectNoSideScroll(page, '«Користувачі» 320');
          await shot(page, info, '491-settings-users-320', true);
          await page.setViewportSize({ width: 390, height: 844 });
        }

        // «Створити запрошення» → the link card: the link, «Поділитися» / «Скопіювати», its expiry, «Готово».
        const create = page.getByRole('button', { name: 'Створити запрошення', exact: true });
        await create.click();
        const card = app.region('Запрошення готове');
        await expect(card.getByRole('heading', { name: 'Запрошення готове' })).toBeFocused();
        await expect(card.getByRole('textbox', { name: 'Посилання', exact: true })).toHaveValue(
          `${BASE_URL}/invite#${LINK_TOKEN}`,
        );
        // The fixed expiry (NOW + 7 days), whatever the wording around it.
        await expect(card).toContainText('21 жовтня, 10:00');
        await scrollToTop(page, app.region('Запросити людину'), 120);
        // A viewport shot on desktop too: Chrome's full-page capture resizes the window for a moment, which swaps
        // the desktop shell for the phone one and back — the card's state (the link) would not survive it.
        await shot(page, info, '494-link-card');
        if (phone) {
          await page.setViewportSize({ width: 320, height: 640 });
          await expectNoSideScroll(page, 'invite link card 320');
          await scrollToTop(page, card, 100);
          await shot(page, info, '494-link-card-320');
          await page.setViewportSize({ width: 390, height: 844 });
        }
        // «Готово»: the link is gone for good, focus is back on the button that made it.
        await card.getByRole('button', { name: 'Готово', exact: true }).click();
        await expect(card).toHaveCount(0);
        await expect(create).toBeFocused();

        // anna's sheet → «Посилання для нового пароля»: the same card in the sheet, the old password still works.
        await app
          .region('Акаунти · 4')
          .getByRole('button', { name: /^anna( |$)/ })
          .click();
        const sheet = app.userSheet('anna');
        await sheet.getByRole('button', { name: 'Посилання для нового пароля', exact: true }).click();
        const reset = sheet.getByRole('region', { name: 'Посилання готове', exact: true });
        await expect(reset.getByRole('heading', { name: 'Посилання готове' })).toBeFocused();
        await expect(reset.getByRole('textbox', { name: 'Посилання', exact: true })).toHaveValue(
          `${BASE_URL}/reset#${LINK_TOKEN}`,
        );
        await expect(reset).toContainText(/Старий пароль \S+, доки посиланням не скористаються/);
        await reset.scrollIntoViewIfNeeded();
        await shot(page, info, '495-user-sheet-reset-link');
        if (phone) {
          await page.setViewportSize({ width: 320, height: 640 });
          await expectNoSideScroll(page, 'user sheet with the password link 320');
          await reset.scrollIntoViewIfNeeded();
          await shot(page, info, '495-user-sheet-reset-link-320');
        }
      });
    });

    // «Клієнти» — the admin as a read-only coach (docs/coach-cabinet.md §6, §8.2): stubbed API, 70–78.
    test.describe('coach', () => {
      test.use({ account: 'admin' });

      test('the clients list, «Потребують уваги», 320 and a narrow desktop table', async ({
        page,
        admin,
      }, info) => {
        const phone = info.project.name === 'iphone';
        await stubCoach(page, admin);
        await openClients(page);
        await expect(clientRow(page, 'olya')).toBeVisible();
        await expect(page.getByRole('button', { name: 'Потребують уваги · 4', exact: true })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Усі · 6', exact: true })).toBeVisible();
        for (const name of COACH_STUB_NAMES) await expect(clientRow(page, name)).toHaveCount(1);
        await expectNoSideScroll(page, 'clients list');
        // The desktop table fits the window; a long phone list is saved as pages.
        await shot(page, info, '70-coach-list', phone);

        await showFilter(page, 'Потребують уваги');
        for (const name of ['olya', 'marta', 'ivan', 'petro'])
          await expect(clientRow(page, name)).toHaveCount(1);
        for (const name of ['sofia', 'taras']) await expect(clientRow(page, name)).toHaveCount(0);
        await shot(page, info, '71-coach-list-attention', phone);
        await showFilter(page, 'Усі');

        if (phone) {
          await page.setViewportSize({ width: 320, height: 640 });
          await expect(clientRow(page, 'petro')).toBeVisible();
          await expectNoSideScroll(page, 'clients list 320');
          await shot(page, info, '77-coach-list-320', true);
          await page.setViewportSize({ width: 390, height: 844 });
          return;
        }

        // 1000px: the table is wider than its region, which scrolls on its own; scrolled all the way right, the
        // sticky name column stays at the left edge and paints over the cells (opaque --card).
        await page.setViewportSize({ width: 1000, height: 800 });
        await expect.poll(() => page.evaluate(() => window.innerWidth)).toBe(1000);
        const region = clientsRegion(page);
        const scrolled = await region.evaluate((el) => {
          el.scrollLeft = el.scrollWidth;
          return el.scrollLeft;
        });
        expect(scrolled, 'the table region scrolls sideways at 1000px').toBeGreaterThan(0);
        const name = clientRow(page, 'olya').locator('th[scope="row"]');
        const regionBox = await region.boundingBox();
        const nameBox = await name.boundingBox();
        if (!regionBox || !nameBox) throw new Error('the table is not rendered');
        expect(Math.abs(nameBox.x - regionBox.x), 'the name column sticks to the left').toBeLessThanOrEqual(
          2,
        );
        const cover = await name.evaluate((el) => {
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width - 8, r.top + r.height / 2);
          return { onTop: !!hit && el.contains(hit), background: getComputedStyle(el).backgroundColor };
        });
        expect(cover.onTop, 'the name cell paints over the scrolled cells').toBe(true);
        expect(cover.background).not.toMatch(/transparent|rgba\(.*, 0\)/);
        await shot(page, info, '78-coach-list-narrow');
        // Checked after the shot so a failure still leaves the picture for review: the page never scrolls sideways.
        await expectNoSideScroll(page, 'clients list 1000');
        await page.setViewportSize({ width: 1280, height: 800 });
      });

      test('a client: «Огляд», «Прогрес», «Календар» with photos, «Харчування», a new client', async ({
        page,
        admin,
      }, info) => {
        // Shot 74 needs sofia's meals day with photos and a client without any flag (docs/coach-cabinet.md §8.3).
        const sofia = coachClientPayload('sofia');
        const breakfast = sofia.data.days['2026-10-13']?.meals?.flatMap((m) => m.photos ?? []) ?? [];
        expect(breakfast).toEqual(expect.arrayContaining([...COACH_PHOTO_IDS.slice(0, 2)]));
        const sofiaItem = coachClientsPayload().clients.find((c) => c.client.id === COACH_STUB_IDS.sofia);
        if (!sofiaItem) throw new Error('sofia is in the stub list');
        expect(coachSummary(sofiaItem, FIXED_NOW, 7).flags).toEqual([]);

        const photos = await stubCoach(page, admin);
        await openClients(page);
        await openClient(page, 'olya');
        await expect(page.getByText('Лише перегляд', { exact: true })).toBeVisible();
        await expect(page.getByText('Калорії +15% за 7 днів').first()).toBeVisible();
        await settleAtTop(page);
        await tallShot(page, info, '72-coach-overview');

        await clientTab(page, 'Прогрес');
        await expect(page.getByRole('radio', { name: 'Тиждень' })).toBeVisible();
        await expect(page.getByRole('main').getByRole('button', { name: /Записати/ })).toHaveCount(0);
        await settleAtTop(page);
        await tallShot(page, info, '73-coach-progress');

        await page.goto(`/coach/${COACH_STUB_IDS.sofia}?tab=calendar&date=2026-10-13`);
        const day = dayView(page);
        await expect(day).toBeVisible();
        await expect(day).toContainText('Кардіо');
        // The meals come in their own card «Прийоми їжі» under the day card.
        await expect(
          page
            .getByRole('main')
            .getByText(/^Сніданок/)
            .first(),
        ).toBeVisible();
        await expect.poll(() => photos.length).toBeGreaterThanOrEqual(2);
        for (const url of photos) expect(url).toContain(`/api/coach/clients/${COACH_STUB_IDS.sofia}/photos/`);
        await settleAtTop(page);
        await tallShot(page, info, '74-coach-calendar');

        await clientTab(page, 'Харчування');
        await expect(page.getByText('Калорії по днях').first()).toBeVisible();
        await settleAtTop(page);
        await tallShot(page, info, '75-coach-nutrition');

        await page.goto(`/coach/${COACH_STUB_IDS.ivan}`);
        await expect(page.getByRole('heading', { level: 1, name: 'ivan', exact: true })).toBeVisible();
        await expect(
          page.getByText('Записи зʼявляться тут, щойно людина почне вести щоденник.'),
        ).toBeVisible();
        await settleAtTop(page);
        await tallShot(page, info, '76-coach-empty');
      });
    });

    test('screens', async ({ app, page }, info) => {
      await app.goto('/');
      await expect(app.homeRow('Їжа')).toContainText('Записано');
      await shot(page, info, '10-home', true);

      await app.go('Календар');
      await shot(page, info, '20-calendar', true);
      // A tapped day scrolls its card into view above the tab bar.
      await page
        .getByRole('group', { name: /^\S+ 2026$/ })
        .getByRole('button', { name: /^7 жовтня/ })
        .click();
      await expect(app.region('7 жовтня 2026')).toBeVisible();
      await shot(page, info, '21-calendar-day');

      await app.go('Прогрес');
      await shot(page, info, '30-progress-week', true);
      await page.getByRole('radio', { name: 'Весь час' }).click();
      await scrollTop(page);
      await shot(page, info, '31-progress-all', true);
      await page.evaluate(() => window.scrollTo(0, 900));
      await shot(page, info, '32-progress-scrolled-sticky');
      const history = page.getByRole('group', { name: 'Історія калорій' });
      await history.getByRole('button', { name: 'Показати ще' }).click();
      await expect(history.getByRole('button', { name: /Відкрити в календарі$/ })).toHaveCount(10);
      await scrollToTop(page, history.getByRole('heading', { name: 'Історія калорій' }), 120);
      await shot(page, info, '33-progress-history-more');

      await app.go('Налаштування');
      await shot(page, info, '40-settings', true);
      await app.gotoSettings('Нагадування');
      await shot(page, info, '42-settings-reminders', true);
      await app.gotoSettings('Цілі');
      await shot(page, info, '43-settings-goals', true);
      await app.gotoSettings('Типи тренувань');
      await shot(page, info, '44-settings-workouts', true);
      await app.gotoSettings('Вигляд');
      await shot(page, info, '45-settings-appearance', true);
      await app.gotoSettings('Дані і копія');
      await shot(page, info, '46-settings-data', true);

      // The day's list of a day from before meals existed: one block «Їжа за день» and the hint.
      await app.goto('/');
      const list = await app.openFoodDay();
      await expect(app.mealRow(list, 'Їжа за день')).toBeVisible();
      await shot(page, info, '63-food-day-legacy');
    });

    test('home states', async ({ app, page, server }, info) => {
      // Weigh-in and measurement day = today (Wednesday), a planned workout, today's kcal over the goal.
      const due = await server.getData();
      due.settings.rem.weigh.day = 3;
      due.settings.rem.measure.day = 3;
      due.days[TODAY] = { food: '', trained: null, types: [], notes: '', ...due.days[TODAY], kcal: 1820 };
      await server.importData(due);
      await app.goto('/');
      await expect(app.homeRow('Вага')).toContainText('Сьогодні');
      await expect(app.homeRow('Тренування')).toContainText('За планом о 18:00');
      await expect(app.homeRow('Їжа')).toContainText('1 820 / 1 700 ккал');
      await shot(page, info, '12-home-due', true);

      // The latest weigh-in is the goal weight.
      const reached = await server.getData();
      const latest = [...reached.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      if (!latest) throw new Error('the demo data has weigh-ins');
      reached.settings.goal = latest.kg;
      await server.importData(reached);
      await app.reload();
      const hero = app.region('Поточна вага');
      await expect(hero).toContainText('✓ Ціль досягнута');
      // Readable on the hero in both themes (light text on the dark hero, dark text on the light-grey dark hero).
      const contrast = await hero.getByText('✓ Ціль досягнута').evaluate((el) => {
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = (c: string) => {
          const [r = 0, g = 0, b = 0] = rgb(c).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        let bg = 'rgba(0, 0, 0, 0)';
        for (let n: Element | null = el; n && /rgba\(.*, 0\)|transparent/.test(bg); n = n.parentElement)
          bg = getComputedStyle(n).backgroundColor;
        const [a, b] = [lum(getComputedStyle(el).color), lum(bg)].sort((x, y) => y - x) as [number, number];
        return (a + 0.05) / (b + 0.05);
      });
      expect(contrast, '«✓ Ціль досягнута» contrast on the hero').toBeGreaterThanOrEqual(4.5);
      await shot(page, info, '13-home-goal-reached');
    });

    test('offline home', async ({ app, page, context }, info) => {
      await app.goto('/');
      await context.setOffline(true);
      await expect(page.getByText('Офлайн · зміни збережено на телефоні')).toBeVisible();
      await app.trainingToggle('Не було').click();
      await expect(app.toast('Відмічено: без тренування')).toBeVisible();
      await shot(page, info, '11-home-offline');
      // In-app navigation: a page load needs the network (the e2e run blocks the service worker).
      await app.openSettings('Дані і копія');
      await expect(app.region('Дані')).toContainText('Офлайн');
      // The toast would cover the back link.
      await expect(app.toast('Відмічено: без тренування')).toBeHidden({ timeout: 10_000 });
      await shot(page, info, '41-settings-offline-data');
    });

    test('sheets', async ({ app, page }, info) => {
      const food = await mockFood(page);
      await app.goto('/');

      await app.recordButton().click();
      await expect(app.sheet('Що записати?')).toBeVisible();
      await shot(page, info, '50-sheet-menu');
      // «Їжа» swaps the menu to a new meal: the type by the time of day, the AI row above «Що я їла» (focused).
      await app.sheet('Що записати?').getByRole('button', { name: /^Їжа/ }).click();
      const meal = app.sheet('Прийом їжі');
      const text = meal.getByRole('textbox', { name: 'Що я їла', exact: true });
      await expect(text).toBeFocused();
      await shot(page, info, '51-sheet-meal');

      // A text estimate: the positions join the meal (Б · Ж · В per row, «Прибрати ці позиції»).
      await text.fill('борщ 300 г і 2 скибки хліба');
      await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
      const card = meal.getByRole('region', { name: 'Позиції', exact: true });
      await expect(card).toContainText(/Разом\s*320\s*ккал/);
      await card.scrollIntoViewIfNeeded();
      await shot(page, info, '53-sheet-meal-estimate');
      // «✨ Додати ще» opens the composer for what she forgot.
      const more = meal.getByRole('button', { name: 'Додати ще: порахувати калорії', exact: true });
      await more.click();
      await expect(meal.getByRole('textbox', { name: 'Що ще порахувати?', exact: true })).toBeFocused();
      await shot(page, info, '52-sheet-meal-composer');
      await more.click();
      await expect(meal.getByRole('textbox', { name: 'Що ще порахувати?', exact: true })).toHaveCount(0);

      // A photo estimate: its position is appended, the photo joins the meal.
      await page.unroute('**/api/food/estimate');
      await page.route('**/api/food/estimate', (r) => r.fulfill({ json: PHOTO_ESTIMATE }));
      await meal.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: 'plate.jpg',
        mimeType: 'image/jpeg',
        buffer: FOOD_JPEG,
      });
      await expect(card).toContainText(/Разом\s*740\s*ккал/);
      await card.scrollIntoViewIfNeeded();
      await shot(page, info, '54-sheet-meal-photo-estimate');
      const thumb = meal.locator(`img[src="/api/photos/${PHOTO_ID}/thumb"]`);
      await expect(thumb).toBeVisible();
      await thumb.scrollIntoViewIfNeeded();
      await shot(page, info, '55-sheet-meal-photos');
      await meal.getByRole('button', { name: 'Фото їжі', exact: true }).click();
      await expect(page.getByRole('dialog', { name: 'Фото їжі' })).toBeVisible();
      await shot(page, info, '56-photo-viewer');
      await page.keyboard.press('Escape');
      await expect(page.getByRole('dialog', { name: 'Фото їжі' })).toBeHidden();
      const edit = meal.getByRole('button', { name: 'Змінити', exact: true });
      await edit.scrollIntoViewIfNeeded();
      await edit.click();
      await shot(page, info, '57-sheet-meal-frequent-edit');
      await meal.getByRole('button', { name: 'Готово', exact: true }).click();
      await sheetBottom(page, info, meal, '57-sheet-meal');
      await app.saveMeal(meal);
      await shot(page, info, '59-home-after-save-toast');
      expect(food.estimates).toHaveLength(1); // the photo estimate went to the replacement route

      // A meal typed by hand, over the kcal limit.
      const manual = await app.newMeal();
      const kcal = manual.getByRole('textbox', { name: 'Калорії', exact: true });
      await kcal.fill('25000');
      // Under the field and, as the reason «Зберегти» waits, in the footer.
      await expect(manual.getByText('Калорії — не більше 20 000 ккал')).toHaveCount(2);
      await kcal.scrollIntoViewIfNeeded();
      await shot(page, info, '58-sheet-meal-kcal-error');
      await manual.getByRole('button', { name: 'Закрити', exact: true }).click();
      await page
        .getByRole('alertdialog', { name: 'Є незбережені зміни' })
        .getByRole('button', { name: 'Закрити', exact: true })
        .click();
      await app.expectSheetClosed();

      await app.goto('/calendar');
      // Tapping today's cell brings its tall day card (food lines + the photo) into view.
      await page
        .getByRole('group', { name: /^\S+ 2026$/ })
        .getByRole('button', { name: /^14 жовтня/ })
        .click();
      if (info.project.name === 'iphone')
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(
        app.region('14 жовтня 2026').getByRole('heading', { name: '14 жовтня 2026' }),
      ).toBeInViewport();
      await shot(page, info, '22-calendar-day-with-photos');

      await app.goto('/?sheet=weight');
      const weight = app.sheet('Контрольне зважування');
      await shot(page, info, '60-sheet-weight');
      await weight.getByRole('textbox', { name: 'Вага', exact: true }).fill('500');
      await shot(page, info, '61-sheet-weight-error');

      await app.goto('/?sheet=measure');
      const measure = app.sheet('Заміри тіла');
      await shot(page, info, '70-sheet-measure');
      await measure.locator('input[name="chest"]').fill('5');
      await shot(page, info, '71-sheet-measure-error');

      await app.goto('/');
      const workout = await app.record('Тренування');
      await shot(page, info, '75-sheet-workout');
      await workout.getByRole('button', { name: 'Було', exact: true }).click();
      await workout.getByRole('button', { name: 'Кардіо', exact: true }).click();
      await workout.getByRole('button', { name: '+ Нотатка до дня' }).click();
      await expect(workout.getByRole('textbox', { name: 'Нотатки' })).toBeFocused();
      await workout.getByRole('button', { name: '+ Свій тип' }).click();
      await expect(workout.getByRole('textbox', { name: 'Новий тип тренування' })).toBeFocused();
      await shot(page, info, '76-sheet-workout-trained');

      await app.goto('/calendar?date=2026-10-13');
      await app.region('13 жовтня 2026').getByRole('button', { name: 'Редагувати день' }).click();
      const day = app.sheet('Запис дня');
      await expect(day).toContainText('13 жовтня 2026');
      await expect(app.mealList(day).getByRole('button')).toHaveCount(3);
      await shot(page, info, '77-sheet-day-full');
      await sheetBottom(page, info, day, '77-sheet-day-full');

      if (info.project.name === 'iphone') {
        await app.goto('/');
        await page.getByRole('button', { name: 'Як?' }).click();
        await expect(app.sheet('Встановлення на iPhone')).toBeVisible();
        await shot(page, info, '80-sheet-install');
      }
    });

    test('positions and the item editor', async ({ app, page }, info) => {
      await mockFood(page, { estimate: EDITOR_ESTIMATE });
      await app.goto('/');
      const meal = await app.newMeal();
      await meal.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: 'plate.jpg',
        mimeType: 'image/jpeg',
        buffer: FOOD_JPEG,
      });
      const card = meal.getByRole('region', { name: 'Позиції', exact: true });
      await expect(card).toContainText(/Разом\s*445\s*ккал/);
      await card.scrollIntoViewIfNeeded();
      // The clean list: one tappable row per position, its Б · Ж · В on the second line.
      await shot(page, info, '531-estimate-list');

      // A position the model priced.
      await card.getByRole('button', { name: /^Котлета куряча, / }).click();
      const editor = app.sheet('Позиція');
      await expect(editor).toBeVisible();
      await shot(page, info, '532-editor-row');
      if (info.project.name === 'iphone') {
        await editor.evaluate((el) => el.scrollTo(0, el.scrollHeight));
        await shot(page, info, '532-editor-row-bottom');
        await editor.evaluate((el) => el.scrollTo(0, 0));
      }

      // Another dish: the model has to price it.
      await editor.getByRole('textbox', { name: 'Що це', exact: true }).fill('Котлета свиняча');
      await expect(editor.getByText('змінено — уточни калорії')).toBeVisible();
      await shot(page, info, '533-editor-changed-name');
      // What changed is in view, not under the sticky footer: «✨ Перерахувати» is in the footer next
      // to «Готово», and the stale number above it (on the phone its note and «Вписати вручну» too).
      const footer = editor.getByRole('button', { name: 'Готово', exact: true }).locator('xpath=../..');
      await expect(footer.getByRole('button', { name: 'Перерахувати' })).toBeInViewport();
      const footerTop = await footer.evaluate((el) => el.getBoundingClientRect().top);
      const bottomOf = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().bottom);
      expect(await bottomOf(editor.getByText(/^180\s*ккал$/))).toBeLessThanOrEqual(footerTop);
      if (info.project.name === 'iphone') {
        expect(await bottomOf(editor.getByText('змінено — уточни калорії'))).toBeLessThanOrEqual(footerTop);
        expect(await bottomOf(editor.getByRole('button', { name: 'Вписати вручну' }))).toBeLessThanOrEqual(
          footerTop,
        );
      }
      await editor.getByRole('button', { name: 'Закрити', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Скасувати зміни' }).click();
      await expect(editor).toBeHidden();

      // A new position: «Часті страви» under the name, then one of them picked.
      await card.getByRole('button', { name: '+ позиція' }).click();
      const added = app.sheet('Нова позиція');
      await expect(added).toBeVisible();
      await shot(page, info, '535-editor-new');
      await added.getByRole('textbox', { name: 'Що це', exact: true }).fill('ка');
      await shot(page, info, '534-editor-suggestion');
      await added.getByRole('button', { name: /^Кава з молоком, / }).click();
      await expect(added).toContainText('як у «Частих стравах»');
      await shot(page, info, '536-editor-dish-picked');
      await added.getByRole('button', { name: 'Додати позицію' }).click();
      await expect(added).toBeHidden();
      await card.scrollIntoViewIfNeeded();
      await shot(page, info, '537-estimate-list-after');

      // «Позиція» with its Б · Ж · В line, then «Вписати вручну» with the kcal and the three macro fields.
      await card.getByRole('button', { name: /^Гречка, / }).click();
      await expect(editor).toBeVisible();
      await expect(editor).toContainText(/Б\s8\s·\sЖ\s2\s·\sВ\s44\sг/);
      await shot(page, info, '67-item-editor-macros');
      await editor.getByRole('button', { name: 'Вписати вручну', exact: true }).click();
      await expect(editor.getByRole('textbox', { name: 'Вуглеводи', exact: true })).toBeVisible();
      await shot(page, info, '67-item-editor-macros-manual');
      await sheetBottom(page, info, editor, '67-item-editor-macros-manual');
    });

    test.describe('meals', () => {
      test.use({ seed: 'meals' });

      test('Home with Б · Ж · В, without and with goals', async ({ app, page, server }, info) => {
        const plain = await server.getData();
        plain.settings.macroGoals = { protein: null, fat: null, carbs: null };
        await server.importData(plain);
        await app.goto('/');
        await expect(app.homeRow('Їжа')).toContainText(/Б\s12\s·\sЖ\s9\s·\sВ\s63\sг\s·\s2\sприйоми/);
        await shot(page, info, '14-home-macros', true);

        // Over the kcal goal and over the protein goal: both lavender (--accD), never red.
        await server.importData(overGoals(await server.getData()));
        await app.reload();
        const food = app.homeRow('Їжа');
        await expect(food).toContainText('1 760 / 1 700 ккал');
        await expect(food).toContainText(/Б\s52\/45\s·\sЖ\s59\/60\s·\sВ\s183\sг/);
        const accD = await tokenColor(page, '--accD');
        const over = food.locator('span').filter({ hasText: /^52$/ });
        await expect(over).toHaveCount(1);
        // Polled: the colour may settle a moment after the fresh data renders (seen once in a full dark run).
        await expect
          .poll(() => over.evaluate((el) => getComputedStyle(el).color), { message: 'over-goal protein' })
          .toBe(accD);
        const under = food.locator('span').filter({ hasText: /^59$/ });
        expect(await under.evaluate((el) => getComputedStyle(el).color), 'fat under its goal').not.toBe(accD);
        await shot(page, info, '15-home-macros-goals-over', true);
      });

      test('the day’s list, the stacked meal editor and «Позиція» (depth 2)', async ({ app, page }, info) => {
        await mockFood(page);
        await app.goto('/');
        const list = await app.openFoodDay();
        await expect(list.getByRole('region', { name: 'Підсумок дня' })).toContainText('460 / 1 700 ккал');
        await shot(page, info, '62-food-day-list');
        await sheetBottom(page, info, list, '62-food-day-list');

        // An existing meal with positions, stacked above the list.
        await app.mealRow(list, 'Сніданок').click();
        const meal = app.sheet('Прийом їжі');
        await expect(meal.getByRole('region', { name: 'Позиції', exact: true })).toBeVisible();
        await shot(page, info, '65-meal-positions');
        await sheetBottom(page, info, meal, '65-meal-positions');

        // «Їжа» → «Прийом їжі» → «Позиція»: three sheets, each one above the other.
        await meal
          .getByRole('region', { name: 'Позиції', exact: true })
          .getByRole('button', { name: /^Вівсянка з бананом, / })
          .click();
        await expect(app.sheet('Позиція')).toBeVisible();
        await expect(app.dialogs).toHaveCount(3);
        await shot(page, info, '68-meal-stacked-depth2');
        await page.keyboard.press('Escape');
        await expect(app.sheet('Позиція')).toBeHidden();
        await page.keyboard.press('Escape');
        await expect(meal).toBeHidden();

        // A meal without positions: «Калорії» and the folded «+ Б · Ж · В», then opened.
        await app.mealRow(list, 'Перекус').click();
        await expect(meal.getByRole('textbox', { name: 'Калорії', exact: true })).toHaveValue('80');
        await shot(page, info, '66-meal-manual');
        await meal.getByRole('button', { name: /^\+ Б · Ж · В/ }).click();
        await expect(meal.getByRole('textbox', { name: 'Білки', exact: true })).toBeFocused();
        await shot(page, info, '66-meal-manual-open');
        await sheetBottom(page, info, meal, '66-meal-manual-open');

        // A new meal from «+» on a day with meals: the next type (Перекус), the day's total, «Усі прийоми за день →».
        await app.goto('/');
        const fresh = await app.newMeal();
        await expect(app.mealType(fresh, 'Перекус')).toHaveAttribute('aria-pressed', 'true');
        await expect(fresh.getByRole('button', { name: 'Усі прийоми за день →', exact: true })).toBeVisible();
        await expect(fresh.getByRole('textbox', { name: 'Що я їла', exact: true })).toBeFocused();
        await shot(page, info, '64-meal-new');
        await sheetBottom(page, info, fresh, '64-meal-new');
      });

      test('calendar, progress and settings with meals', async ({ app, page }, info) => {
        await app.goto('/calendar?date=2026-10-13');
        const oct13 = app.region('13 жовтня 2026');
        await expect(oct13.getByRole('button', { name: /^Їжа/ })).toContainText(
          /Б\s114\s·\sЖ\s62\s·\sВ\s181\sг/,
        );
        await scrollToTop(page, oct13);
        await shot(page, info, '23-calendar-day-meals');

        await app.go('Прогрес');
        const nutrition = app.region('Харчування');
        await expect(nutrition).toContainText('Б · Ж · В — середнє за день');
        await scrollToTop(page, nutrition, 120);
        await shot(page, info, '34-progress-macros');

        await app.gotoSettings('Прийоми їжі');
        await shot(page, info, '47-settings-meal-types', true);
        await page.getByRole('button', { name: 'Змінити', exact: true }).click();
        await expect(page.getByRole('textbox', { name: 'Назва: Сніданок', exact: true })).toBeVisible();
        await shot(page, info, '47-settings-meal-types-edit', true);

        await app.gotoSettings('Цілі');
        const goals = page.getByRole('region', { name: 'Цілі: білки, жири, вуглеводи' });
        await expect(goals.getByRole('textbox', { name: 'Ціль: білки, г на день' })).toHaveValue('90');
        const carbs = goals.getByRole('textbox', { name: 'Ціль: вуглеводи, г на день' });
        await carbs.fill('2000');
        await carbs.press('Enter');
        await expect(goals.getByRole('alert')).toHaveText('Від 1 до 1 000 г');
        await scrollToTop(page, goals, 120);
        await shot(page, info, '48-settings-goals-macros');
      });

      test('the narrowest phone (320px): no clipping, no sideways scroll', async ({
        app,
        page,
        server,
      }, info) => {
        test.skip(info.project.name !== 'iphone', 'phone widths only');
        await mockFood(page);
        await page.setViewportSize({ width: 320, height: 640 });
        await server.importData(overGoals(await server.getData()));
        await app.goto('/');
        await expect(app.homeRow('Їжа')).toContainText('1 760 / 1 700 ккал');
        await expectNoSideScroll(page, 'Home');
        await shot(page, info, '15-home-macros-goals-over-320', true);

        const list = await app.openFoodDay();
        await expectNoSideScroll(page, '«Їжа»');
        await shot(page, info, '62-food-day-list-320');
        await app.mealRow(list, 'Сніданок').click();
        const meal = app.sheet('Прийом їжі');
        await expect(meal.getByRole('region', { name: 'Позиції', exact: true })).toBeVisible();
        await expectNoSideScroll(page, '«Прийом їжі»');
        await shot(page, info, '65-meal-positions-320');

        await app.goto('/');
        const fresh = await app.newMeal();
        await expect(fresh.getByRole('textbox', { name: 'Що я їла', exact: true })).toBeFocused();
        await expectNoSideScroll(page, 'new «Прийом їжі»');
        await shot(page, info, '64-meal-new-320');

        await app.goto('/calendar?date=2026-10-13');
        const oct13 = app.region('13 жовтня 2026');
        await scrollToTop(page, oct13);
        await expectNoSideScroll(page, 'calendar');
        await shot(page, info, '23-calendar-day-meals-320');

        await app.go('Прогрес');
        await scrollToTop(page, app.region('Харчування'), 120);
        await expectNoSideScroll(page, 'progress');
        await shot(page, info, '34-progress-macros-320');

        await app.gotoSettings('Прийоми їжі');
        await page.getByRole('button', { name: 'Змінити', exact: true }).click();
        await expectNoSideScroll(page, '«Прийоми їжі» edit mode');
        await shot(page, info, '47-settings-meal-types-edit-320', true);
      });
    });

    test.describe('brand-new account', () => {
      test.use({ seed: 'empty' });

      test('setup and empty states', async ({ app, page }, info) => {
        await app.goto('/');
        const setup = app.sheet('Перші кроки');
        await expect(setup).toBeVisible();
        await shot(page, info, '90-sheet-setup');
        await setup.getByRole('textbox', { name: 'Цільова вага' }).fill('');
        await shot(page, info, '91-sheet-setup-error');
        await setup.getByRole('textbox', { name: 'Цільова вага' }).fill('60');
        await setup.getByRole('button', { name: 'Закрити' }).click();
        await app.expectSheetClosed();
        await shot(page, info, '92-home-empty', true);
        await app.go('Календар');
        await shot(page, info, '93-calendar-empty', true);
        await app.go('Прогрес');
        await shot(page, info, '94-progress-empty', true);
      });
    });
  });
}
