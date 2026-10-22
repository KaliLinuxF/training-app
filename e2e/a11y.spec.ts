import type { Locator, Page } from '@playwright/test';
import {
  API,
  normalizeDay,
  type AdminInvite,
  type AdminOverview,
  type AppData,
  type InviteCreatedResponse,
  type LinkResponse,
  type SessionUser,
} from '../packages/shared/src/index';
import { COACH_STUB_IDS, COACH_STUB_NAMES, coachClientPayload, coachClientsPayload } from './fixtures/coach';
import { e2eSession, meals as mealsSeed, training as trainingSeed } from './fixtures/data';
import { USERNAME_LABEL, type App } from './support/app';
import { stubCoachClient, stubCoachClients, stubCoachPhotos } from './support/coachApi';
import {
  clientRow,
  clientsRegion,
  clientTabs,
  columnHeader,
  openClients,
  type ClientTab,
} from './support/coachUi';
import { BASE_URL, FIXED_NOW, TODAY } from './support/env';
import { exerciseList, groupChip, openExercise, openLibrary, openNewExercise } from './support/exercises';
import { FOOD_JPEG, mockFood, PHOTO_ESTIMATE } from './support/food';
import type { ServerApi } from './support/server';
import { expect, test } from './support/test';
import { builderCards, footerConfirm, pageTitle, restBar, sessionCard, setCheck } from './support/workouts';

// ── Accounts: fixed answers relative to FIXED_NOW (the browser clock is fixed, the server's is real) ──────────────

const NOW = FIXED_NOW.getTime();
const DAY = 86_400_000;
/** A well-formed one-time link token (the check endpoints are stubbed, so nobody has to issue it). */
const LINK_TOKEN = 'e2eA11yLinkToken_0123456789abcdefghijklmnop';

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

/** «Створити запрошення» and «Посилання для нового пароля» answer fixed links (nothing is issued). */
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

/** Inputs below 16px make iOS Safari zoom in on focus (SPEC §2: «Inputs ≥ 16px font (no zoom)»). */
async function inputsBelow16px(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('input, textarea, select')]
      .filter((el) => el.getBoundingClientRect().width > 1 && (el as HTMLInputElement).type !== 'file')
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map(
        (el) => `${el.getAttribute('name') ?? el.getAttribute('aria-label') ?? el.outerHTML.slice(0, 60)}`,
      ),
  );
}

/**
 * The area a finger can actually hit, «W×H»: probed with `elementFromPoint` from the centre
 * outwards, so `::after` tap-area extensions count and overlapping neighbours do not.
 */
async function hitArea(locator: Locator): Promise<string> {
  await locator.scrollIntoViewIfNeeded();
  // In a sheet, «in view» may still be under its sticky header or footer: measure it in the middle of the panel
  // (and of a sideways-scrolling chip row).
  await locator.evaluate((el) => {
    if (el.closest('[role="dialog"]')) el.scrollIntoView({ block: 'center', inline: 'center' });
  });
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = (x: number, y: number) => {
      const t = document.elementFromPoint(x, y);
      return !!t && (t === el || el.contains(t));
    };
    const reach = (dx: number, dy: number) => {
      let n = 0;
      while (n < 30 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
      return n;
    };
    return `${reach(-1, 0) + reach(1, 0) + 1}×${reach(0, -1) + reach(0, 1) + 1}`;
  });
}

/** `hitArea` measured with the sheet's panel scrolled to its top: the sticky footer covers nothing above it. */
async function hitAreaAtTop(sheet: Locator, locator: Locator): Promise<string> {
  await sheet.evaluate((el) => el.scrollTo(0, 0));
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = (x: number, y: number) => {
      const t = document.elementFromPoint(x, y);
      return !!t && (t === el || el.contains(t));
    };
    const reach = (dx: number, dy: number) => {
      let n = 0;
      while (n < 30 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
      return n;
    };
    return `${reach(-1, 0) + reach(1, 0) + 1}×${reach(0, -1) + reach(0, 1) + 1}`;
  });
}

const below44 = (sizes: Record<string, string>) =>
  Object.entries(sizes).filter(([, s]) =>
    s
      .split('×')
      .map(Number)
      .some((n) => n < 44),
  );

/** The element's box once it is scrolled into view. */
async function box(
  locator: Locator,
  what: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error(`${what} is not rendered`);
  return b;
}

/** A control nested in another control (a button inside a row button, a link inside a button…). */
const NESTED_CONTROL =
  'button :is(button, a[href], input, textarea, select, [role="button"]), a[href] :is(button, a[href], input, textarea, select, [role="button"])';

/** Every open sheet, bottom to top: its dialog name, its z-index and whether it is `inert` (covered). */
async function sheetStack(page: Page): Promise<{ name: string; z: number; inert: boolean }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
      .map((dialog) => ({
        name:
          document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? '',
        z: Number(getComputedStyle(dialog.parentElement ?? dialog).zIndex),
        inert: dialog.closest('[inert]') !== null,
      }))
      .sort((a, b) => a.z - b.z),
  );
}

/** Whether a control of a covered sheet can still take focus (it must not: the sheet is inert). */
const takesFocus = (locator: Locator): Promise<boolean> =>
  locator.evaluate((el: HTMLElement) => {
    el.focus();
    return document.activeElement === el;
  });

/** Lower-cased words (letters and digits) of a label: what speech input matches, emoji and «+», «·», «→» aside. */
const words = (text: string): string[] =>
  text
    .toLocaleLowerCase('uk')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The visible text of a control: its text without `aria-hidden` parts (emoji) and visually hidden helpers. */
const visibleLabel = (locator: Locator): Promise<string> =>
  locator.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"], .visually-hidden').forEach((n) => n.remove());
    return copy.textContent ?? '';
  });

/**
 * WCAG 2.5.3 Label in Name: the accessible name contains the visible label (as words, in order, case aside),
 * so «Порахувати решту» works by voice although VoiceOver also reads what is left to count.
 */
async function expectLabelInName(locator: Locator, what: string): Promise<void> {
  const label = words(await visibleLabel(locator));
  expect(label.length, `${what}: has a visible label`).toBeGreaterThan(0);
  const pattern = label.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+');
  await expect(locator, what).toHaveAccessibleName(new RegExp(pattern, 'iu'));
}

/**
 * The 'meals' seed with a lunch added, so the day's protein is 68 g against the 90 g goal (12 + 56):
 * 980 ккал, Б 68 · Ж 23 · В 123 — still partial (the apple has no macros).
 */
function mealsWithLunch(): AppData {
  const data = mealsSeed();
  const today = data.days[TODAY];
  if (!today?.meals) throw new Error('the meals seed has meals today');
  data.days[TODAY] = normalizeDay({
    ...today,
    meals: [
      ...today.meals,
      {
        id: 'e2eLunch0001',
        type: 'Обід',
        time: '09:55',
        text: 'Курка з рисом',
        kcal: 520,
        protein: 56,
        fat: 14,
        carbs: 60,
      },
    ],
  });
  return data;
}

const mealText = (sheet: Locator) => sheet.getByRole('textbox', { name: 'Що я їла', exact: true });
const positions = (sheet: Locator) => sheet.getByRole('region', { name: 'Позиції', exact: true });

/**
 * A sheet that just opened has stopped moving: even with reduced motion its entry keeps the panel translated for a
 * frame or two after it is «visible» (a stacked sheet starts ~650px down), and a hit test in that frame misses.
 */
async function settled(sheet: Locator): Promise<void> {
  await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
}

/** Home «Їжа» → «Їжа» → the meal `title` stacked above it (settled). */
async function openMealFromList(app: App, title: string): Promise<{ list: Locator; editor: Locator }> {
  const list = await app.openFoodDay();
  await app.mealRow(list, title).click();
  const editor = app.sheet('Прийом їжі');
  await expect(editor).toBeVisible();
  await settled(editor);
  return { list, editor };
}

test.describe('structure (both projects)', () => {
  test('rows never nest a control inside another; the calendar food row keeps the food text as its description', async ({
    app,
  }) => {
    await app.goto('/');
    const today = app.region('Сьогодні');
    await expect(today.getByRole('button')).not.toHaveCount(0);
    await expect(today.locator(NESTED_CONTROL)).toHaveCount(0);

    await app.go('Календар');
    const day = app.region('14 жовтня 2026');
    await expect(day.getByRole('button', { name: 'Було', exact: true })).toBeVisible();
    await expect(day.locator(NESTED_CONTROL)).toHaveCount(0);
    // A short name («Їжа: калорії не вказані») must not hide the food text from a screen reader.
    await expect(day.getByRole('button', { name: /^Їжа/ })).toHaveAccessibleDescription(
      'Вівсянка з бананом, кава',
    );
  });

  test.describe('meals', () => {
    test.use({ seed: 'meals' });

    test('«Їжа» → «Прийом їжі» → «Позиція»: dialog names, z-index 60 / 62 / 64, the sheets below are inert, no nested controls', async ({
      app,
      page,
    }) => {
      await mockFood(page);
      await app.goto('/');
      const { list, editor } = await openMealFromList(app, 'Сніданок');
      await expect(list.getByRole('heading', { name: 'Їжа', exact: true })).toBeVisible();
      await expect(editor.getByRole('heading', { name: 'Прийом їжі', exact: true })).toBeVisible();
      await expect
        .poll(() => sheetStack(page))
        .toEqual([
          { name: 'Їжа', z: 60, inert: true },
          { name: 'Прийом їжі', z: 62, inert: false },
        ]);
      expect(await takesFocus(app.mealRow(list, 'Перекус'))).toBe(false);
      await expect(editor.locator(NESTED_CONTROL)).toHaveCount(0);

      // The item editor stacks above the meal: both sheets under it are inert.
      await positions(editor)
        .getByRole('button', { name: /^Вівсянка з бананом, / })
        .click();
      const item = app.sheet('Позиція');
      await expect(item).toBeVisible();
      await expect(item.getByRole('heading', { name: 'Позиція', exact: true })).toBeVisible();
      await expect
        .poll(() => sheetStack(page))
        .toEqual([
          { name: 'Їжа', z: 60, inert: true },
          { name: 'Прийом їжі', z: 62, inert: true },
          { name: 'Позиція', z: 64, inert: false },
        ]);
      expect(await takesFocus(mealText(editor))).toBe(false);
      await expect(item.locator(NESTED_CONTROL)).toHaveCount(0);

      // Closing the top one makes the meal live again; the list under it stays covered.
      await page.keyboard.press('Escape');
      await expect(item).toBeHidden();
      await expect
        .poll(() => sheetStack(page))
        .toEqual([
          { name: 'Їжа', z: 60, inert: true },
          { name: 'Прийом їжі', z: 62, inert: false },
        ]);
      expect(await takesFocus(mealText(editor))).toBe(true);

      // A new position is «Нова позиція».
      await positions(editor).getByRole('button', { name: '+ позиція', exact: true }).click();
      await expect(app.sheet('Нова позиція')).toBeVisible();
      await expect(app.sheet('Нова позиція').locator(NESTED_CONTROL)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(app.sheet('Нова позиція')).toBeHidden();

      await page.keyboard.press('Escape');
      await expect(editor).toBeHidden();
      await expect.poll(() => sheetStack(page)).toEqual([{ name: 'Їжа', z: 60, inert: false }]);
      // The list: rows are one button each (photos and notes outside them), and say they open a dialog.
      await expect(list.locator(NESTED_CONTROL)).toHaveCount(0);
      for (const title of ['Сніданок', 'Перекус'])
        await expect(app.mealRow(list, title)).toHaveAttribute('aria-haspopup', 'dialog');
      // A new meal from the list footer is «Прийом їжі» as well.
      await app.addMealButton(list).click();
      await expect(app.sheet('Прийом їжі')).toBeVisible();
      await expect(mealText(app.sheet('Прийом їжі'))).toBeFocused();
    });

    test('«+» → Їжа swaps the menu to «Прийом їжі» in the same dialog; «Запис дня» lists the meals without nesting', async ({
      app,
      page,
    }) => {
      await mockFood(page);
      await app.goto('/');
      const meal = await app.newMeal();
      await expect(meal.getByRole('heading', { name: 'Прийом їжі', exact: true })).toBeVisible();
      await expect.poll(() => sheetStack(page)).toEqual([{ name: 'Прийом їжі', z: 60, inert: false }]);
      await expect(meal.locator(NESTED_CONTROL)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await app.expectSheetClosed();

      await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
      const day = app.sheet('Запис дня');
      await expect(app.mealList(day).getByRole('button')).toHaveCount(2);
      await expect(day.locator(NESTED_CONTROL)).toHaveCount(0);
      await app.mealRow(day, 'Перекус').click();
      await expect
        .poll(() => sheetStack(page))
        .toEqual([
          { name: 'Запис дня', z: 60, inert: true },
          { name: 'Прийом їжі', z: 62, inert: false },
        ]);
    });
  });

  test.describe('the day’s totals', () => {
    test('the totals card shows «68 / 90 г» and VoiceOver reads «68 з 90 г»; the partial note is text', async ({
      app,
      server,
    }) => {
      // After the `page` fixture imported the default seed.
      await server.importData(mealsWithLunch());
      await app.goto('/');
      const list = await app.openFoodDay();
      const card = list.getByRole('region', { name: 'Підсумок дня', exact: true });
      await expect(card).toContainText('980 / 1 700 ккал');
      // What she sees keeps the slash…
      await expect(card.locator('[aria-hidden="true"]').filter({ hasText: /^68\s\/\s90\sг$/ })).toHaveCount(
        1,
      );
      // …what assistive tech gets has «з» instead, and no slash.
      const tree = await card.ariaSnapshot();
      expect(tree).toMatch(/Білки[\s\S]*68\sз\s90\sг/);
      expect(tree).toMatch(/Жири[\s\S]*23\sз\s60\sг/);
      expect(tree).toMatch(/Вуглеводи[\s\S]*123\sг/);
      expect(tree).not.toMatch(/68\s\/\s90/);
      expect(tree).toContain('Б · Ж · В пораховано не для всіх прийомів');
    });
  });
});

test.describe('iPhone ergonomics', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-only checks');

  test('every text input is at least 16px (no zoom on focus)', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');

    // «Прийом їжі»: the text, «+ Свій», the manual kcal and Б · Ж · В, the time.
    const meal = await app.newMeal();
    await meal.getByRole('button', { name: 'Додати свій тип прийому їжі', exact: true }).click();
    await expect(meal.getByRole('textbox', { name: 'Новий тип прийому їжі', exact: true })).toBeFocused();
    await meal.getByRole('button', { name: /^\+ Б · Ж · В/ }).click();
    await expect(meal.getByRole('textbox', { name: 'Білки', exact: true })).toBeFocused();
    await expect(meal.getByLabel('Час', { exact: true })).toBeVisible();
    expect(await inputsBelow16px(page), '«Прийом їжі» manual numbers, own type, time').toEqual([]);
    // After an estimate: the composer «Що ще порахувати?».
    await mealText(meal).fill('борщ і хліб');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await expect(positions(meal)).toBeVisible();
    await meal.getByRole('button', { name: 'Додати ще: порахувати калорії', exact: true }).click();
    await expect(meal.getByRole('textbox', { name: 'Що ще порахувати?', exact: true })).toBeFocused();
    expect(await inputsBelow16px(page), '«Прийом їжі» composer').toEqual([]);

    // «Тренування»: an own type, then the unfolded notes.
    await app.goto('/');
    const workout = await app.record('Тренування');
    await workout.getByRole('button', { name: 'Було', exact: true }).click();
    await workout.getByRole('button', { name: '+ Свій тип' }).click();
    await expect(workout.getByRole('textbox', { name: 'Новий тип тренування' })).toBeVisible();
    expect(await inputsBelow16px(page), '«Тренування» own type').toEqual([]);
    await workout.getByRole('button', { name: '+ Нотатка до дня' }).click();
    await expect(workout.getByRole('textbox', { name: 'Нотатки' })).toBeFocused();
    expect(await inputsBelow16px(page), '«Тренування» notes').toEqual([]);

    for (const [path, field] of [
      ['/settings/reminders', page.getByLabel('Час').first()],
      ['/settings/workouts', page.getByRole('textbox', { name: 'Свій тип тренування' })],
      ['/settings/meals', page.getByRole('textbox', { name: 'Новий тип прийому їжі' })],
      ['/settings/goals', page.getByRole('textbox', { name: 'Ціль: білки, г на день', exact: true })],
      [
        '/?sheet=weight',
        app.sheet('Контрольне зважування').getByRole('textbox', { name: 'Вага', exact: true }),
      ],
      ['/?sheet=measure', app.sheet('Заміри тіла').locator('input[name="chest"]')],
    ] as const) {
      await app.goto(path);
      await expect(field, path).toBeVisible();
      expect(await inputsBelow16px(page), path).toEqual([]);
    }

    // «Прийоми їжі» in edit mode: every name is a field.
    await app.gotoSettings('Прийоми їжі');
    await page.getByRole('button', { name: 'Змінити', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Назва: Сніданок', exact: true })).toBeVisible();
    expect(await inputsBelow16px(page), '«Прийоми їжі» edit mode').toEqual([]);
  });

  test.describe('logged out', () => {
    test.use({ authed: false });
    test('the login fields «Імʼя користувача» and «Пароль» are labelled and at least 16px', async ({
      page,
    }) => {
      await page.goto('/');
      const name = page.getByLabel(USERNAME_LABEL, { exact: true });
      const password = page.getByLabel('Пароль', { exact: true });
      await expect(name).toBeVisible();
      await expect(password).toBeVisible();
      await expect(name).toHaveAccessibleName(USERNAME_LABEL);
      await expect(password).toHaveAccessibleName('Пароль');
      // «Маю посилання» opens the paste field: also ≥ 16px.
      await page.getByRole('button', { name: 'Маю посилання', exact: true }).click();
      await expect(
        page.getByLabel('Встав посилання із запрошенням або для нового пароля', { exact: true }),
      ).toBeVisible();
      expect(await inputsBelow16px(page)).toEqual([]);
    });
  });

  // Text-sized controls (the kit ghost button is 35px tall, its ::after reaches 45px; the banner ✕ is 32px
  // with a 44px ::after; the back link has min-height 44).
  test('small text buttons extend their tap area to 44px', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const sizes: Record<string, string> = {
      'install hint «Сховати» ✕': await hitArea(page.getByRole('button', { name: 'Сховати' })),
      'install hint CTA «Як?»': await hitArea(page.getByRole('button', { name: 'Як?' })),
      '«Відкрити день →»': await hitArea(page.getByRole('button', { name: 'Відкрити день' })),
    };
    const meal = await app.newMeal();
    sizes['«Часті страви» «Змінити»'] = await hitArea(
      meal.getByRole('button', { name: 'Змінити', exact: true }),
    );
    sizes['«+ Б · Ж · В»'] = await hitArea(meal.getByRole('button', { name: /^\+ Б · Ж · В/ }));

    await app.goto('/');
    await app.recordButton().click();
    sizes['«Повний запис дня →»'] = await hitArea(
      app.sheet('Що записати?').getByRole('button', { name: 'Повний запис дня' }),
    );
    await app.goto('/');
    const workout = await app.record('Тренування');
    sizes['«+ Нотатка до дня»'] = await hitArea(workout.getByRole('button', { name: '+ Нотатка до дня' }));

    await app.gotoSettings('Цілі');
    sizes['«‹ Налаштування» back link'] = await hitArea(app.settingsBack());
    await app.gotoSettings('Нагадування');
    sizes['reminder switch'] = await hitArea(page.getByRole('switch').first());
    expect(below44(sizes)).toEqual([]);
  });

  test('Home «Сьогодні»: the rows span the card, the inline ✓ / ✕ are 44×44 beside the Тренування row', async ({
    app,
  }) => {
    await app.goto('/');
    const card = await box(app.region('Сьогодні'), '«Сьогодні»');
    const cardRight = card.x + card.width;
    const sizes: Record<string, string> = {};

    for (const name of ['Їжа', 'Вага', 'Заміри'] as const) {
      const row = await box(app.homeRow(name), name);
      expect(row.height, `${name}: height`).toBeGreaterThanOrEqual(56);
      expect(Math.abs(row.x - card.x), `${name}: starts at the card edge`).toBeLessThanOrEqual(2);
      expect(Math.abs(row.x + row.width - cardRight), `${name}: ends at the card edge`).toBeLessThanOrEqual(
        2,
      );
      sizes[name] = await hitArea(app.homeRow(name));
    }

    // Тренування: the row button and the toggle are siblings that share the line.
    const training = app.homeRow('Тренування');
    const button = await box(training, 'Тренування');
    const item = await box(training.locator('xpath=ancestor::li[1]'), 'Тренування row');
    const yes = await box(app.trainingToggle('Було'), '«Було»');
    const no = await box(app.trainingToggle('Не було'), '«Не було»');
    expect(Math.abs(button.x - card.x), 'Тренування: starts at the card edge').toBeLessThanOrEqual(2);
    expect(item.height, 'Тренування: row height').toBeGreaterThanOrEqual(56);
    expect(button.x + button.width, 'the row button stops before «Було»').toBeLessThanOrEqual(yes.x + 0.5);
    expect(
      Math.abs(no.x + no.width + 16 - cardRight),
      '«Не було» ends 16px inside the card',
    ).toBeLessThanOrEqual(2);
    for (const [name, b] of [
      ['Було', yes],
      ['Не було', no],
    ] as const) {
      expect(Math.round(b.width), `«${name}» width`).toBe(44);
      expect(Math.round(b.height), `«${name}» height`).toBe(44);
    }
    sizes['Тренування row'] = await hitArea(training);
    sizes['«Було»'] = await hitArea(app.trainingToggle('Було'));
    sizes['«Не було»'] = await hitArea(app.trainingToggle('Не було'));
    sizes['week row'] = await hitArea(app.weekLink());
    expect(below44(sizes)).toEqual([]);
  });

  // 40px controls (small buttons, segments, the sheet ✕) grow their hit area invisibly with ::after,
  // weekday buttons reach into the gaps of their 7-column row; «Історія калорій» rows are 44px tall.
  test('every control meets the 44px tap target', async ({ app, page }) => {
    await app.goto('/');
    await app.recordButton().click();
    const menu = app.sheet('Що записати?');
    const sizes: Record<string, string> = {};
    for (const name of ['Їжа', 'Тренування', 'Кроки', 'Вага', 'Заміри']) {
      const row = menu.getByRole('button', { name: new RegExp(`^${name}`) });
      expect((await box(row, name)).height, `menu «${name}» height`).toBeGreaterThanOrEqual(64);
      sizes[`menu «${name}»`] = await hitArea(row);
    }
    sizes['sheet «Закрити» ✕'] = await hitArea(menu.getByRole('button', { name: 'Закрити' }));

    await app.goto('/settings');
    for (const title of [
      'Нагадування',
      'Цілі',
      'Тренування',
      'Прийоми їжі',
      'Вигляд',
      'Дані і копія',
      'Акаунт',
    ] as const) {
      sizes[`settings «${title}»`] = await hitArea(app.settingsRow(title));
    }
    // «Вийти» moved to the bottom of «Акаунт» (D30).
    await app.gotoSettings('Акаунт');
    sizes['«Акаунт» «Вийти»'] = await hitArea(page.getByRole('button', { name: 'Вийти', exact: true }));
    await app.gotoSettings('Вигляд');
    sizes['theme segment «Авто»'] = await hitArea(page.getByRole('radio', { name: 'Авто' }));
    await app.gotoSettings('Нагадування');
    sizes['reminder switch'] = await hitArea(page.getByRole('switch').first());
    sizes['workout weekday «Пн»'] = await hitArea(page.getByRole('button', { name: 'Понеділок' }).first());

    await app.goto('/progress');
    sizes['period segment «Тиждень»'] = await hitArea(page.getByRole('radio', { name: 'Тиждень' }));
    sizes['«Історія калорій» row'] = await hitArea(
      page.getByRole('button', { name: /Відкрити в календарі$/ }).first(),
    );
    sizes['«Показати ще»'] = await hitArea(page.getByRole('button', { name: 'Показати ще' }));

    await app.goto('/calendar?date=2026-10-05');
    const oct5 = app.region('5 жовтня 2026');
    sizes['day cell'] = await hitArea(
      page
        .getByRole('group', { name: /^\S+ 2026$/ })
        .getByRole('button')
        .first(),
    );
    sizes['«Попередній місяць»'] = await hitArea(page.getByRole('button', { name: 'Попередній місяць' }));
    sizes['«Сьогодні» shortcut'] = await hitArea(page.getByRole('button', { name: 'Сьогодні', exact: true }));
    sizes['day row «Вага»'] = await hitArea(oct5.getByRole('button', { name: 'Вага: 65,7 кг', exact: true }));
    sizes['day card «Було»'] = await hitArea(oct5.getByRole('button', { name: 'Було', exact: true }));
    sizes['day card «Не було»'] = await hitArea(oct5.getByRole('button', { name: 'Не було', exact: true }));
    expect(below44(sizes)).toEqual([]);
  });

  test.describe('meals', () => {
    test.use({ seed: 'meals' });

    test('«Їжа» and «Прийом їжі»: every control meets the 44px tap target', async ({ app, page }) => {
      await mockFood(page);
      await app.goto('/');
      const { list, editor } = await openMealFromList(app, 'Сніданок');
      const sizes: Record<string, string> = {};

      // The stacked meal editor (an existing meal with positions).
      sizes['meal ✕'] = await hitAreaAtTop(
        editor,
        editor.getByRole('button', { name: 'Закрити', exact: true }),
      );
      for (const type of ['Сніданок', 'Обід', 'Вечеря', 'Перекус'])
        sizes[`type chip «${type}»`] = await hitArea(app.mealType(editor, type));
      sizes['«+ Свій»'] = await hitArea(
        editor.getByRole('button', { name: 'Додати свій тип прийому їжі', exact: true }),
      );
      sizes['«✨ Додати ще»'] = await hitArea(
        editor.getByRole('button', { name: 'Додати ще: порахувати калорії', exact: true }),
      );
      sizes['«📷 Фото»'] = await hitArea(
        editor.getByRole('button', { name: 'Порахувати калорії за фото', exact: true }),
      );
      const card = positions(editor);
      sizes['position row'] = await hitArea(card.getByRole('button', { name: /^Вівсянка з бананом, / }));
      sizes['«+ позиція»'] = await hitArea(card.getByRole('button', { name: '+ позиція', exact: true }));
      sizes['«Часті страви» chip'] = await hitArea(editor.getByRole('button', { name: /^Додати «Борщ»/ }));
      sizes['«Часті страви» «Змінити»'] = await hitArea(
        editor.getByRole('button', { name: 'Змінити', exact: true }),
      );
      sizes['«Прибрати час» ✕'] = await hitArea(
        editor.getByRole('button', { name: 'Прибрати час', exact: true }),
      );
      sizes['«Видалити прийом»'] = await hitArea(
        editor.getByRole('button', { name: 'Видалити прийом', exact: true }),
      );
      sizes['meal «Зберегти»'] = await hitArea(editor.getByRole('button', { name: 'Зберегти', exact: true }));
      await page.keyboard.press('Escape');
      await expect(editor).toBeHidden();

      // The list under it.
      sizes['list ✕'] = await hitAreaAtTop(list, list.getByRole('button', { name: 'Закрити', exact: true }));
      sizes['list «Попередній день»'] = await hitAreaAtTop(
        list,
        list.getByRole('button', { name: 'Попередній день', exact: true }),
      );
      for (const title of ['Сніданок', 'Перекус']) {
        expect(
          (await box(app.mealRow(list, title), title)).height,
          `row «${title}» height`,
        ).toBeGreaterThanOrEqual(56);
        sizes[`meal row «${title}»`] = await hitArea(app.mealRow(list, title));
      }
      sizes['«+ Прийом їжі»'] = await hitArea(app.addMealButton(list));

      // A new meal from «+» on a day with other meals: «Усі прийоми за день →», the folded Б · Ж · В, «+ Час».
      await page.keyboard.press('Escape');
      await app.expectSheetClosed();
      const meal = await app.newMeal();
      sizes['«Усі прийоми за день →»'] = await hitArea(
        meal.getByRole('button', { name: 'Усі прийоми за день →', exact: true }),
      );
      sizes['«+ Б · Ж · В»'] = await hitArea(meal.getByRole('button', { name: /^\+ Б · Ж · В/ }));
      sizes['date «Попередній день»'] = await hitAreaAtTop(
        meal,
        meal.getByRole('button', { name: 'Попередній день', exact: true }),
      );
      await meal.getByRole('button', { name: 'Прибрати час', exact: true }).click();
      sizes['«+ Час»'] = await hitArea(meal.getByRole('button', { name: '+ Час', exact: true }));

      // A photo estimate attaches the photo to the meal: its «Видалити фото» ✕ (a 26px dot with a tap area).
      await page.route('**/api/food/estimate', (route) => route.fulfill({ json: PHOTO_ESTIMATE }));
      const chooser = page.waitForEvent('filechooser');
      await meal.getByRole('button', { name: 'Порахувати калорії за фото', exact: true }).click();
      await (await chooser).setFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: FOOD_JPEG });
      const removePhoto = meal.getByRole('button', { name: 'Видалити фото' }).first();
      await expect(removePhoto).toBeVisible();
      sizes['«Видалити фото»'] = await hitArea(removePhoto);
      expect(below44(sizes)).toEqual([]);
    });

    test('Settings «Прийоми їжі» (view and edit mode) and the «Цілі» macro fields: 44px targets', async ({
      app,
      page,
    }) => {
      await app.gotoSettings('Прийоми їжі');
      const sizes: Record<string, string> = {};
      const types = page.getByRole('region', { name: 'Мої прийоми їжі', exact: true });
      // View mode: calm rows, ≥ 44px each, no controls in them.
      for (const name of ['Сніданок', 'Обід', 'Вечеря', 'Перекус']) {
        const row = types.getByRole('listitem').filter({ hasText: new RegExp(`^${name}$`) });
        expect((await box(row, name)).height, `view row «${name}»`).toBeGreaterThanOrEqual(44);
        await expect(row.locator('button, input')).toHaveCount(0);
      }
      sizes['«Змінити»'] = await hitArea(types.getByRole('button', { name: 'Змінити', exact: true }));
      sizes['«Додати»'] = await hitArea(types.getByRole('button', { name: 'Додати', exact: true }));
      const add = types.getByRole('textbox', { name: 'Новий тип прийому їжі', exact: true });
      expect((await box(add, 'add field')).height, 'add field height').toBeGreaterThanOrEqual(44);

      // Edit mode: a field and ↑ / ↓ / ✕ per row.
      await types.getByRole('button', { name: 'Змінити', exact: true }).click();
      await expect(types.getByRole('button', { name: 'Готово', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      sizes['«Готово»'] = await hitArea(types.getByRole('button', { name: 'Готово', exact: true }));
      sizes['«Вище: Обід»'] = await hitArea(types.getByRole('button', { name: 'Вище: Обід', exact: true }));
      sizes['«Нижче: Обід»'] = await hitArea(types.getByRole('button', { name: 'Нижче: Обід', exact: true }));
      sizes['«Видалити «Обід»»'] = await hitArea(
        types.getByRole('button', { name: 'Видалити «Обід»', exact: true }),
      );
      const name = types.getByRole('textbox', { name: 'Назва: Обід', exact: true });
      expect((await box(name, 'name field')).height, 'name field height').toBeGreaterThanOrEqual(44);
      await expect(types.locator(NESTED_CONTROL)).toHaveCount(0);
      // «Повернути стандартні» shows once a default is gone.
      await types.getByRole('button', { name: 'Видалити «Перекус»', exact: true }).click();
      sizes['«Повернути стандартні»'] = await hitArea(
        types.getByRole('button', { name: 'Повернути стандартні', exact: true }),
      );

      await app.gotoSettings('Цілі');
      for (const macro of ['білки', 'жири', 'вуглеводи']) {
        const field = page.getByRole('textbox', { name: `Ціль: ${macro}, г на день`, exact: true });
        expect((await box(field, macro)).height, `goal field «${macro}» height`).toBeGreaterThanOrEqual(44);
      }
      expect(below44(sizes)).toEqual([]);
    });
  });

  test('the positions of a meal and the item editor «Позиція»: 44px targets, no zoom on focus', async ({
    app,
    page,
  }) => {
    await mockFood(page);
    await app.goto('/');
    const meal = await app.newMeal();
    await mealText(meal).fill('борщ 300 г і 2 скибки хліба');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    const card = positions(meal);
    await expect(card).toBeVisible();
    const sizes: Record<string, string> = {
      'position row': await hitArea(card.getByRole('button', { name: /^Борщ, / })),
      '«+ позиція»': await hitArea(card.getByRole('button', { name: '+ позиція', exact: true })),
      '«Прибрати ці позиції»': await hitArea(
        meal.getByRole('button', { name: 'Прибрати ці позиції — останній підрахунок', exact: true }),
      ),
    };

    await card.getByRole('button', { name: /^Хліб житній, / }).click();
    const editor = app.sheet('Позиція');
    await expect(editor).toBeVisible();
    await settled(editor);
    sizes['editor ✕'] = await hitAreaAtTop(
      editor,
      editor.getByRole('button', { name: 'Закрити', exact: true }),
    );
    sizes['−'] = await hitAreaAtTop(editor, editor.getByRole('button', { name: 'Зменшити' }));
    sizes['+'] = await hitAreaAtTop(editor, editor.getByRole('button', { name: 'Збільшити' }));
    sizes['unit chip «мл»'] = await hitAreaAtTop(
      editor,
      editor.getByRole('button', { name: 'мл', exact: true }),
    );
    sizes['multiplier «½»'] = await hitAreaAtTop(editor, editor.getByRole('button', { name: /^½/ }));
    sizes['«Порція текстом»'] = await hitAreaAtTop(
      editor,
      editor.getByRole('button', { name: 'Порція текстом' }),
    );
    sizes['«Вписати вручну»'] = await hitAreaAtTop(
      editor,
      editor.getByRole('button', { name: 'Вписати вручну' }),
    );
    sizes['«Видалити позицію»'] = await hitArea(editor.getByRole('button', { name: 'Видалити позицію' }));
    sizes['«Готово»'] = await hitArea(editor.getByRole('button', { name: 'Готово', exact: true }));
    expect(below44(sizes)).toEqual([]);

    // Every field the editor can show: name, amount, free-text portion, kcal and Б · Ж · В by hand.
    expect(await inputsBelow16px(page)).toEqual([]);
    await editor.getByRole('button', { name: 'Вписати вручну' }).click();
    await editor.getByRole('button', { name: 'Порція текстом' }).click();
    for (const macro of ['Білки', 'Жири', 'Вуглеводи'])
      await expect(editor.getByRole('textbox', { name: macro, exact: true })).toBeVisible();
    expect(await inputsBelow16px(page)).toEqual([]);
  });

  test('the narrowest unit chip «г» in the item editor is 44px wide', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const meal = await app.newMeal();
    await mealText(meal).fill('борщ 300 г');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await positions(meal)
      .getByRole('button', { name: /^Борщ, / })
      .click();
    const editor = app.sheet('Позиція');
    await settled(editor);
    await editor.evaluate((el) => el.scrollTo(0, 0));
    const size = await hitArea(editor.getByRole('button', { name: 'г', exact: true }));
    expect(below44({ 'unit chip «г»': size })).toEqual([]);
  });

  test.describe('landscape', () => {
    // Plus / Pro Max in landscape: wider than the 900px desktop breakpoint, but a touch screen.
    test.use({ viewport: { width: 932, height: 430 }, screen: { width: 932, height: 430 } });

    test('a phone in landscape keeps the phone shell: tab bar and bottom sheets', async ({ app, page }) => {
      await app.goto('/');
      expect(await page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(900);
      // Tab bar «+» («Записати день»), not the sidebar's «+ Записати день».
      await expect(page.getByRole('button', { name: 'Записати день', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '+ Записати день', exact: true })).toHaveCount(0);

      await app.recordButton().click();
      const sheet = app.sheet('Що записати?');
      await expect(sheet).toBeVisible();
      // Bottom sheet (≤ 440px wide, docked to the bottom), not the centred 560px desktop modal.
      await expect
        .poll(async () => {
          const b = await sheet.boundingBox();
          return b && { narrow: b.width <= 440, bottom: Math.round(b.y + b.height) };
        })
        .toEqual({ narrow: true, bottom: 430 });
    });
  });
});

test.describe('accessible names contain the visible label (WCAG 2.5.3)', () => {
  test.use({ seed: 'meals' });

  test('the meal editor, the day’s list and Settings «Прийоми їжі»', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');

    // «+» → Їжа on a day with meals: the AI row, the chips, «+ Свій», the folded Б · Ж · В, the day link.
    const meal = await app.newMeal();
    await expectLabelInName(
      meal.getByRole('button', { name: 'Порахувати калорії', exact: true }),
      '«✨ Порахувати»',
    );
    await expectLabelInName(
      meal.getByRole('button', { name: 'Порахувати калорії за фото', exact: true }),
      '«📷 Фото»',
    );
    await expectLabelInName(
      meal.getByRole('button', { name: 'Додати свій тип прийому їжі', exact: true }),
      '«+ Свій»',
    );
    await expectLabelInName(meal.getByRole('button', { name: /^\+ Б · Ж · В/ }), '«+ Б · Ж · В»');
    await expectLabelInName(app.mealType(meal, 'Перекус'), 'type chip');
    await expectLabelInName(meal.getByRole('button', { name: /^Додати «Борщ»/ }), '«Часті страви» chip');
    // «Усі прийоми за день →» is named by its text alone.
    const showDay = meal.getByRole('button', { name: 'Усі прийоми за день →', exact: true });
    await expect(showDay).not.toHaveAttribute('aria-label');
    await expectLabelInName(showDay, '«Усі прийоми за день →»');
    // After an estimate the first button is «✨ Додати ще».
    await mealText(meal).fill('борщ і хліб');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await expect(positions(meal)).toBeVisible();
    await expectLabelInName(
      meal.getByRole('button', { name: 'Додати ще: порахувати калорії', exact: true }),
      '«✨ Додати ще»',
    );
    await page.keyboard.press('Escape');
    await page
      .getByRole('alertdialog', { name: 'Є незбережені зміни' })
      .getByRole('button', { name: 'Закрити', exact: true })
      .click();
    await app.expectSheetClosed();

    // A saved meal with more text than was counted: «✨ Порахувати решту» also reads the rest.
    const { list, editor } = await openMealFromList(app, 'Сніданок');
    await mealText(editor).fill('Вівсянка з бананом, кава з молоком, яблуко');
    const rest = editor.getByRole('button', { name: 'Порахувати решту: яблуко', exact: true });
    await expect(rest).toBeVisible();
    await expectLabelInName(rest, '«✨ Порахувати решту»');
    await expectLabelInName(app.addMealButton(list), '«+ Прийом їжі»');

    await app.gotoSettings('Прийоми їжі');
    await expectLabelInName(page.getByRole('button', { name: 'Змінити', exact: true }), '«Змінити»');
    await page.getByRole('button', { name: 'Змінити', exact: true }).click();
    await expectLabelInName(page.getByRole('button', { name: 'Готово', exact: true }), '«Готово»');
    // The «Цілі» fields are named «Ціль: білки, г на день» around their visible «Білки».
    await app.gotoSettings('Цілі');
    for (const macro of ['Білки', 'Жири', 'Вуглеводи']) {
      const field = page.getByRole('textbox', {
        name: `Ціль: ${macro.toLowerCase()}, г на день`,
        exact: true,
      });
      const label = await field.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent ?? '');
      expect(label.trim(), `«${macro}» field label`).toBe(macro);
      await expect(field).toHaveAccessibleName(new RegExp(macro, 'i'));
    }
  });

  // The visible «Прибрати ці позиції» is named «Прибрати ці позиції — останній підрахунок» (EstimateCard
  // `UNDO_LABEL`): the name starts with what it shows, so a voice command «Прибрати ці позиції» finds it.
  test('«Прибрати ці позиції» contains its visible label', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const meal = await app.newMeal();
    await mealText(meal).fill('борщ і хліб');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    const undo = meal.getByRole('button', { name: /^Прибрати/ }).filter({ hasText: 'Прибрати ці позиції' });
    await expect(undo).toHaveAccessibleName('Прибрати ці позиції — останній підрахунок');
    await expectLabelInName(undo, '«Прибрати ці позиції»');
  });
});

// ── Accounts on the phone: login, links, «Акаунт», «Користувачі» (docs/multi-user.md §9, §11.2) ─────────────────

/**
 * Everything a finger can aim at — except the sub-page back link «‹ Налаштування», whose 44px are 2px short on every
 * sub-page without a title row (its own `test.fixme` below documents that app bug).
 */
const TARGETS =
  'button, a[href]:not([aria-label^="Назад: "]), input:not([type="hidden"]):not([type="file"]), textarea, select, [role="switch"], [role="radio"], [role="checkbox"]';

/** No horizontal scroll: neither the page nor an open sheet is wider than the screen. */
async function expectNoSideScroll(page: Page, what: string): Promise<void> {
  const overflow = await page.evaluate(() => [
    document.documentElement.scrollWidth - document.documentElement.clientWidth,
    ...[...document.querySelectorAll<HTMLElement>('[role="dialog"]')].map(
      (d) => d.scrollWidth - d.clientWidth,
    ),
  ]);
  expect(Math.max(...overflow), `${what}: horizontal overflow`).toBeLessThanOrEqual(0);
}

/**
 * Every visible control in `scope` reaches 44×44 (measured centred on screen, so the floating tab bar covers nothing
 * a finger would aim at) and every field is ≥ 16px; visually hidden helpers (the Keychain username) are skipped.
 * `except` (a selector) leaves out controls a documented `test.fixme` measures instead.
 */
async function expectTouchFriendly(scope: Locator, what: string, except?: string): Promise<void> {
  const page = scope.page();
  const controls = scope.locator(TARGETS);
  const sizes: Record<string, string> = {};
  const count = await controls.count();
  expect(count, `${what}: has controls`).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    if (except && (await control.evaluate((el, sel) => el.matches(sel), except))) continue;
    const b = await control.boundingBox();
    if (!b || b.width < 2 || b.height < 2) continue;
    const name = await control.evaluate(
      (el) =>
        el.getAttribute('aria-label') ??
        (el.textContent?.trim() || el.getAttribute('name') || el.getAttribute('autocomplete') || el.tagName),
    );
    await control.evaluate((el) => el.scrollIntoView({ block: 'center', inline: 'nearest' }));
    sizes[`${what}: ${i} «${name.slice(0, 40)}»`] = await hitArea(control);
  }
  expect(below44(sizes)).toEqual([]);
  expect(await inputsBelow16px(page), `${what}: inputs`).toEqual([]);
}

/** The checks at the default 390×844 and at the narrowest phone, 320×568. */
async function atPhoneWidths(page: Page, run: (width: number) => Promise<void>): Promise<void> {
  const original = page.viewportSize();
  for (const size of [
    { width: 390, height: 844 },
    { width: 320, height: 568 },
  ]) {
    await page.setViewportSize(size);
    await run(size.width);
  }
  if (original) await page.setViewportSize(original);
}

/** `ACCOUNT_COPY.adminSees` and `INVITE_ADMIN_NOTE` (apps/web, docs/coach-cabinet.md §7.1): the same sentence. */
const ADMIN_SEES = 'Адміністратор бачить твої записи та прогрес.';

/** The computed colour of a token (`--muted` …) as the page resolves it (a probe span in <body>). */
const tokenColor = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement('span');
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

/** A secondary line stays readable: visible, computed font-size ≥ 13px, colour exactly the resolved `--muted`. */
async function expectMutedLine(line: Locator, what: string): Promise<void> {
  await line.scrollIntoViewIfNeeded();
  await expect(line, what).toBeVisible();
  const style = await line.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { size: parseFloat(cs.fontSize), color: cs.color };
  });
  expect(style.size, `${what}: font-size`).toBeGreaterThanOrEqual(13);
  expect(style.color, `${what}: colour = var(--muted)`).toBe(await tokenColor(line.page(), '--muted'));
}

test.describe('accounts on the phone: 390 and 320 wide (no side scroll, 44px targets, 16px inputs)', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone widths');

  // FIXME(app bug, ui/layout/ScreenHeader): the back link is 44px tall, but on every sub-page whose title has no
  // action beside it (Нагадування, Тренування, Прийоми їжі, Вигляд, Дані і копія, Акаунт, Користувачі) the <h1>
  // box overlaps its bottom 2px, so a finger reaches 42px (on «Цілі» it is 44px). Remove the .fixme once fixed.
  test.fixme('the «‹ Налаштування» back link reaches 44px on every settings sub-page', async ({ app }) => {
    const sizes: Record<string, string> = {};
    for (const slug of ['reminders', 'goals', 'workouts', 'meals', 'appearance', 'data', 'account']) {
      await app.goto(`/settings/${slug}`);
      sizes[`/settings/${slug}`] = await hitArea(app.settingsBack());
    }
    expect(below44(sizes)).toEqual([]);
  });

  test('login after an expired session: the unsent-changes hint and an error', async ({
    app,
    page,
    context,
  }) => {
    await app.goto('/');
    await context.setOffline(true);
    await app.trainingToggle('Не було').click();
    await expect(app.toast('Відмічено: без тренування')).toBeVisible();
    await context.clearCookies();
    await context.setOffline(false);
    await expect(app.loginButton()).toBeVisible();
    await expect(
      page.getByText(/^На цьому пристрої є зміни anna, ще не надіслані на сервер\./),
    ).toBeVisible();
    // A refused login, mocked (a real one would count against the shared limits).
    await page.route(`**${API.login}`, (route) =>
      route.fulfill({
        status: 401,
        json: { error: 'bad_credentials', message: 'Неправильне імʼя або пароль' },
      }),
    );
    await page.getByLabel('Пароль', { exact: true }).fill('not-the-password');
    await app.loginButton().click();
    await expect(page.getByRole('alert')).toHaveText('Неправильне імʼя або пароль');
    const login = page.locator('body');
    await atPhoneWidths(page, async (width) => {
      await expectNoSideScroll(page, `login ${width}`);
      await expectTouchFriendly(login, `login ${width}`);
    });
    // «Маю посилання» open as well.
    await page.getByRole('button', { name: 'Маю посилання', exact: true }).click();
    await expect(
      page.getByLabel('Встав посилання із запрошенням або для нового пароля', { exact: true }),
    ).toBeVisible();
    await atPhoneWidths(page, async (width) => {
      await expectNoSideScroll(page, `login + link ${width}`);
      await expectTouchFriendly(login, `login + link ${width}`);
    });
  });

  test.describe('links', () => {
    test.use({ authed: false, seed: null });

    test('the invite and the reset forms', async ({ page }) => {
      await stubLinkChecks(page);
      await page.goto(`/invite#${LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Запрошення в Home Fit' })).toBeVisible();
      await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toHaveAttribute(
        'autocomplete',
        'username',
      );
      await expect(page.getByLabel('Пароль', { exact: true })).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      await expect(page.getByLabel('Повтори пароль', { exact: true })).toHaveAttribute(
        'autocomplete',
        'new-password',
      );
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `invite ${width}`);
        await expectTouchFriendly(page.locator('body'), `invite ${width}`);
      });

      await page.goto(`/reset#${LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Новий пароль' })).toBeVisible();
      await expect(page.getByText('для anna', { exact: true })).toBeVisible();
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `reset ${width}`);
        await expectTouchFriendly(page.locator('body'), `reset ${width}`);
      });
    });
  });

  // Transparency (docs/coach-cabinet.md §7.1): one calm line, readable (≥ 13px) in --muted. There is no contrast
  // checker or axe in this suite; the colour is compared with the resolved token instead.
  test('«Акаунт»: the line «Адміністратор бачить…» is ≥ 13px in --muted', async ({ app, page }) => {
    await app.gotoSettings('Акаунт');
    const line = app.region('Профіль').getByText(ADMIN_SEES, { exact: true });
    await expect(line).toHaveCount(1);
    await atPhoneWidths(page, async (width) => {
      await expectNoSideScroll(page, `«Акаунт» ${width}`);
      await expectMutedLine(line, `«Акаунт» line ${width}`);
    });
  });

  test.describe('the invite line', () => {
    test.use({ authed: false, seed: null });

    test('the invite form: «Адміністратор бачить…» is ≥ 13px in --muted', async ({ page }) => {
      await stubLinkChecks(page);
      await page.goto(`/invite#${LINK_TOKEN}`);
      await expect(page.getByRole('heading', { level: 1, name: 'Запрошення в Home Fit' })).toBeVisible();
      const line = page.getByText(ADMIN_SEES, { exact: true });
      await expect(line).toHaveCount(1);
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `invite ${width}`);
        await expectMutedLine(line, `invite line ${width}`);
      });
    });
  });

  test('«Акаунт» with the rename form open', async ({ app, page, server }) => {
    await stubMe(page, server);
    await mockFood(page, { status: { enabled: true, remainingToday: 37, limitToday: 40 } });
    await app.gotoSettings('Акаунт');
    await expect(app.region('Профіль')).toContainText('anna');
    const nameCard = app.region('Імʼя для входу');
    await nameCard.getByRole('button', { name: 'Змінити', exact: true }).click();
    await expect(nameCard.getByLabel('Нове імʼя', { exact: true })).toBeVisible();
    const content = page.getByRole('main');
    await atPhoneWidths(page, async (width) => {
      await expectNoSideScroll(page, `«Акаунт» ${width}`);
      await expectTouchFriendly(content, `«Акаунт» ${width}`);
    });
  });

  test.describe('the admin', () => {
    test.use({ account: 'admin' });

    test('«Користувачі», the link cards, the user sheet and its delete panel', async ({
      app,
      page,
      admin,
      server,
    }) => {
      await stubMe(page, admin, {
        createdAt: NOW - 40 * DAY,
        passwordChange: { at: NOW - 40 * DAY, via: 'setup', by: null },
      });
      await stubOverview(page, admin, server);
      await stubLinkCreation(page);
      await app.gotoSettings('Користувачі');
      await expect(app.region('Акаунти · 4')).toBeVisible();
      await expect(app.region('Запрошення · 2')).toBeVisible();
      const content = page.getByRole('main');
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `«Користувачі» ${width}`);
        await expectTouchFriendly(content, `«Користувачі» ${width}`);
      });

      // A fresh invite link: the long read-only URL never widens the page, every button is a full target.
      await page.getByRole('button', { name: 'Створити запрошення', exact: true }).click();
      const invite = app.region('Запрошення готове');
      await expect(invite.getByRole('heading', { name: 'Запрошення готове' })).toBeFocused();
      await expect(invite.getByRole('textbox', { name: 'Посилання', exact: true })).toHaveValue(
        `${BASE_URL}/invite#${LINK_TOKEN}`,
      );
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `invite link card ${width}`);
        await expectTouchFriendly(invite, `invite link card ${width}`);
      });

      await app
        .region('Акаунти · 4')
        .getByRole('button', { name: /^anna( |$)/ })
        .click();
      const sheet = app.userSheet('anna');
      await expect(sheet).toBeVisible();
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `user sheet ${width}`);
        await expectTouchFriendly(sheet, `user sheet ${width}`);
      });

      // The password link card inside the sheet.
      await sheet.getByRole('button', { name: 'Посилання для нового пароля', exact: true }).click();
      const reset = sheet.getByRole('region', { name: 'Посилання готове', exact: true });
      await expect(reset.getByRole('heading', { name: 'Посилання готове' })).toBeFocused();
      await expect(reset.getByRole('textbox', { name: 'Посилання', exact: true })).toHaveValue(
        `${BASE_URL}/reset#${LINK_TOKEN}`,
      );
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `user sheet with the password link ${width}`);
        await expectTouchFriendly(reset, `password link card ${width}`);
      });

      await sheet.getByRole('button', { name: 'Видалити акаунт…', exact: true }).click();
      const typed = sheet.getByRole('textbox', { name: 'Імʼя для підтвердження', exact: true });
      await expect(typed).toBeFocused();
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `delete panel ${width}`);
        await expectTouchFriendly(sheet, `delete panel ${width}`);
      });
    });
  });
});

// ── «Клієнти» — the admin as a read-only coach (docs/coach-cabinet.md §6, §8.2): stubbed API ─────────────────────

const CLIENT_TABS: readonly ClientTab[] = ['Огляд', 'Прогрес', 'Календар', 'Харчування', 'Тренування'];

/** The day cells of a month grid (MonthCard: a `role="group"` named by the month title). */
const MONTH_DAY_CELLS = '[role="group"][aria-labelledby] button';

/** The stub roster of e2e/fixtures/coach.ts (relative to FIXED_NOW) for the list, every client page and photo. */
async function stubCoach(page: Page, admin: ServerApi): Promise<void> {
  await stubMe(page, admin, {
    createdAt: NOW - 40 * DAY,
    passwordChange: { at: NOW - 40 * DAY, via: 'setup', by: null },
  });
  await stubCoachClients(page, coachClientsPayload());
  for (const name of COACH_STUB_NAMES) await stubCoachClient(page, coachClientPayload(name));
  await stubCoachPhotos(page, FOOD_JPEG);
}

/** Header cells (`scope`, `aria-sort`) and, per body row, the scopes of its header cells and its first cell's tag. */
async function tableSemantics(region: Locator): Promise<{
  head: { scope: string | null; sort: string | null }[];
  rows: { scopes: string[]; first: string }[];
}> {
  return region.evaluate((el) => {
    const table = el.querySelector('table');
    if (!table) throw new Error('no table in the region');
    return {
      head: [...table.querySelectorAll('thead th')].map((th) => ({
        scope: th.getAttribute('scope'),
        sort: th.getAttribute('aria-sort'),
      })),
      rows: [...table.querySelectorAll('tbody tr')].map((tr) => ({
        scopes: [...tr.querySelectorAll(':scope > th')].map((th) => th.getAttribute('scope') ?? ''),
        first: tr.firstElementChild?.tagName ?? '',
      })),
    };
  });
}

/** `aria-sort` of every column header, in order. */
const ariaSorts = (region: Locator): Promise<(string | null)[]> =>
  region.locator('thead th').evaluateAll((ths) => ths.map((th) => th.getAttribute('aria-sort')));

/** The client names in table order. */
const rowNames = (region: Locator): Promise<string[]> =>
  region.locator('tbody th[scope="row"] a').allTextContents();

/** Presses Tab (at most `max` times) until `target` has the keyboard focus. */
async function tabTo(page: Page, target: Locator, what: string, max = 30): Promise<void> {
  for (let i = 0; i < max; i++) {
    if (await target.evaluate((el) => el === document.activeElement)) return;
    await page.keyboard.press('Tab');
  }
  await expect(target, `${what}: reached with Tab`).toBeFocused();
}

/** The focused control shows a ring: it matches `:focus-visible` and has a computed outline or box-shadow. */
async function expectFocusRing(target: Locator, what: string): Promise<void> {
  const ring = await target.evaluate((el) => {
    const cs = getComputedStyle(el);
    return {
      focusVisible: el.matches(':focus-visible'),
      outline: cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth) > 0,
      shadow: cs.boxShadow !== 'none',
      detail: `${cs.outlineStyle} ${cs.outlineWidth} ${cs.outlineColor} / ${cs.boxShadow}`,
    };
  });
  expect(ring.focusVisible, `${what}: :focus-visible`).toBe(true);
  expect(ring.outline || ring.shadow, `${what}: visible ring (${ring.detail})`).toBe(true);
}

/** Exactly one tab link is the current page (`aria-current="page"`): the one named `active`. */
async function expectCurrentTab(page: Page, active: ClientTab): Promise<void> {
  await expect(clientTabs(page).getByRole('link')).toHaveCount(CLIENT_TABS.length);
  for (const tab of CLIENT_TABS) {
    const link = clientTabs(page).getByRole('link', { name: tab, exact: true });
    if (tab === active) await expect(link, `«${tab}» is current`).toHaveAttribute('aria-current', 'page');
    else await expect(link, `«${tab}» is not current`).not.toHaveAttribute('aria-current');
  }
}

test.describe('«Клієнти» (the admin as a coach, stubbed)', () => {
  test.use({ account: 'admin' });

  test.describe('desktop', () => {
    test.skip(({ isMobile }) => isMobile, 'the table is the desktop layout');

    test('the clients table: scopes, aria-sort, keyboard sorting with a focus ring, a focusable region that fits 1280×800, a sticky header row', async ({
      page,
      admin,
    }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await stubCoach(page, admin);
      await openClients(page);
      const region = clientsRegion(page);
      await expect(clientRow(page, 'olya')).toBeVisible();

      // th scope=col on every header; in every body row one th scope=row, the first cell; aria-sort on each column.
      const { head, rows } = await tableSemantics(region);
      expect(head.map((h) => h.scope)).toEqual(Array(9).fill('col'));
      expect(rows).toEqual(Array(COACH_STUB_NAMES.length).fill({ scopes: ['row'], first: 'TH' }));
      // Default order (attention): no column is sorted, every sortable header says so.
      expect(head.map((h) => h.sort)).toEqual(Array(9).fill('none'));

      // The region is a named, focusable scroller that does not scroll sideways at 1280×800 with the stub roster.
      await expect(region).toHaveAttribute('tabindex', '0');
      const size = await region.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
      expect(size.scroll, 'table region scrollWidth <= clientWidth at 1280×800').toBeLessThanOrEqual(
        size.client,
      );
      await expectNoSideScroll(page, 'clients list 1280');
      expect(await inputsBelow16px(page), 'clients list inputs').toEqual([]);

      // Keyboard: Tab from the search field reaches the region (focusable, with a ring), then «Клієнт».
      await page.getByRole('searchbox', { name: 'Пошук за імʼям' }).focus();
      await tabTo(page, region, 'the table region');
      await expectFocusRing(region, 'the table region');
      const clientHeader = columnHeader(page, 'Клієнт');
      const clientButton = clientHeader.getByRole('button');
      await tabTo(page, clientButton, '«Клієнт» header');
      await expectFocusRing(clientButton, '«Клієнт» header button');

      await page.keyboard.press('Enter');
      await expect(clientHeader).toHaveAttribute('aria-sort', 'ascending');
      expect((await ariaSorts(region)).slice(1)).toEqual(Array(8).fill('none'));
      expect(await rowNames(region)).toEqual(['ivan', 'marta', 'olya', 'petro', 'sofia', 'taras']);
      await expect(clientButton).toBeFocused();
      await page.keyboard.press('Enter');
      await expect(clientHeader).toHaveAttribute('aria-sort', 'descending');
      expect(await rowNames(region)).toEqual(['taras', 'sofia', 'petro', 'olya', 'marta', 'ivan']);
      await page.keyboard.press('Enter');
      await expect(clientHeader).toHaveAttribute('aria-sort', 'none');
      expect(await ariaSorts(region)).toEqual(Array(9).fill('none'));
      await expectFocusRing(clientButton, '«Клієнт» header button after sorting');

      // A short window: the region scrolls vertically; at its last row the header row is still on top.
      await page.setViewportSize({ width: 1280, height: 560 });
      // The resize reaches the page a moment later; then the region's max-height (100dvh − 220px) is 340px.
      await expect
        .poll(() => region.evaluate((el) => el.scrollHeight - el.clientHeight), {
          message: 'the region scrolls vertically at 1280×560',
        })
        .toBeGreaterThan(0);
      const vertical = await region.evaluate((el) => {
        el.scrollTop = el.scrollHeight;
        return { top: el.scrollTop, overflow: el.scrollHeight - el.clientHeight };
      });
      expect(vertical.overflow, 'the region scrolls vertically at 1280×560').toBeGreaterThan(0);
      expect(vertical.top).toBeGreaterThan(0);
      const regionBox = await region.boundingBox();
      const lastBox = await region.locator('tbody tr').last().boundingBox();
      const headBox = await clientHeader.boundingBox();
      if (!regionBox || !lastBox || !headBox) throw new Error('the table is not rendered');
      expect(lastBox.y + lastBox.height, 'the last row is in view').toBeLessThanOrEqual(
        regionBox.y + regionBox.height + 1,
      );
      expect(
        Math.abs(headBox.y - regionBox.y),
        'the header row sticks to the top of the region',
      ).toBeLessThanOrEqual(2);
      const headerOnTop = await region.locator('thead th').evaluateAll((ths) =>
        ths.every((th) => {
          const r = th.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return !!hit && th.contains(hit);
        }),
      );
      expect(headerOnTop, 'every header cell is visible (not covered by rows)').toBe(true);
      await page.setViewportSize({ width: 1280, height: 800 });
    });

    test('a client page: tab links with aria-current and a focus ring, no side scroll', async ({
      page,
      admin,
    }) => {
      await stubCoach(page, admin);
      await page.goto(`/coach/${COACH_STUB_IDS.olya}`);
      await expect(page.getByRole('heading', { level: 1, name: 'olya', exact: true })).toBeVisible();
      await expectCurrentTab(page, 'Огляд');
      for (const tab of CLIENT_TABS) {
        await clientTabs(page).getByRole('link', { name: tab, exact: true }).click();
        await expectCurrentTab(page, tab);
        await expectNoSideScroll(page, `client «${tab}» 1280`);
        expect(await inputsBelow16px(page), `client «${tab}» inputs`).toEqual([]);
      }
      // The current tab link is reachable with the keyboard from the back link and shows a ring.
      const current = clientTabs(page).getByRole('link', { name: 'Харчування', exact: true });
      await page.getByRole('link', { name: 'Назад: Клієнти' }).focus();
      await tabTo(page, current, '«Харчування» tab');
      await expectFocusRing(current, '«Харчування» tab link');
    });
  });

  test.describe('phone', () => {
    test.skip(({ isMobile }) => !isMobile, 'phone widths');

    test('the list at 390 and 320: no side scroll, 44px targets, 16px inputs', async ({ page, admin }) => {
      await stubCoach(page, admin);
      await openClients(page);
      await expect(clientRow(page, 'olya')).toBeVisible();
      await expect(page.getByRole('combobox', { name: 'Сортування' })).toBeVisible();
      await atPhoneWidths(page, async (width) => {
        await expectNoSideScroll(page, `clients list ${width}`);
        await expectTouchFriendly(page.getByRole('main'), `clients list ${width}`);
      });
    });

    test('a client page at 390 and 320: every tab without side scroll, 44px targets, tab links with aria-current', async ({
      page,
      admin,
    }) => {
      await stubCoach(page, admin);
      for (const name of ['olya', 'sofia'] as const) {
        await page.goto(`/coach/${COACH_STUB_IDS[name]}`);
        await expect(page.getByRole('heading', { level: 1, name, exact: true })).toBeVisible();
        await expectCurrentTab(page, 'Огляд');
        for (const tab of CLIENT_TABS) {
          await clientTabs(page).getByRole('link', { name: tab, exact: true }).click();
          await expectCurrentTab(page, tab);
          await atPhoneWidths(page, async (width) => {
            await expectNoSideScroll(page, `${name} «${tab}» ${width}`);
            // The month's day cells at 320 are the shared MonthCard's known gap (the fixme below); at 390 they count.
            await expectTouchFriendly(
              page.getByRole('main'),
              `${name} «${tab}» ${width}`,
              width === 320 ? MONTH_DAY_CELLS : undefined,
            );
          });
        }
      }
    });

    // FIXME(app bug, screens/calendar/MonthCard.module.css): at 320×568 a day cell of the month grid is 36px wide
    // (seven `1fr` columns of a 284px card) and its `::after` only adds 2px, so a finger reaches 36×44 — in the
    // client's own «Календар» as well as in the coach's, which reuses the same MonthCard. At 390 it is ≥ 44.
    // Remove the .fixme once the cells reach 44px at 320 (e.g. a wider `::after` into the column gaps).
    test.fixme('the month grid day cells reach 44px at 320 (own calendar and the coach calendar)', async ({
      app,
      page,
      admin,
    }) => {
      await stubCoach(page, admin);
      await page.setViewportSize({ width: 320, height: 568 });
      const sizes: Record<string, string> = {};
      for (const [what, url] of [
        ['own calendar', '/calendar?date=2026-10-05'],
        ['coach calendar', `/coach/${COACH_STUB_IDS.olya}?tab=calendar&date=2026-10-05`],
      ] as const) {
        await app.goto(url);
        sizes[`${what}: day cell`] = await hitArea(
          page
            .getByRole('group', { name: /^\S+ 2026$/ })
            .getByRole('button')
            .first(),
        );
      }
      expect(below44(sizes)).toEqual([]);
    });
  });
});

// ── Workouts and steps (docs/workouts-steps-rebrand.md §3.19): names, roles, states, light + dark, reduced motion ──

/**
 * WCAG contrast ratio of the element's text against what is painted behind it. The tokens are OKLCH, so colours are
 * converted to sRGB through a canvas; translucent tints (a banner, the rest bar) are composited over the layers under
 * them, down to the first opaque one.
 */
const contrastOf = (locator: Locator): Promise<number> =>
  locator.evaluate((el) => {
    const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('no canvas');
    const toRgba = (css: string): [number, number, number, number] => {
      ctx.clearRect(0, 0, 1, 1);
      ctx.fillStyle = '#000';
      ctx.fillStyle = css;
      ctx.fillRect(0, 0, 1, 1);
      const [r = 0, g = 0, b = 0, a = 0] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a / 255];
    };
    const over = (top: [number, number, number, number], under: number[]): number[] =>
      under.slice(0, 3).map((u, i) => (top[i] ?? 0) * top[3] + u * (1 - top[3]));
    const lum = ([r = 0, g = 0, b = 0]: number[]) => {
      const lin = (v: number) => {
        const x = v / 255;
        return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    };
    const layers: [number, number, number, number][] = [];
    for (let n: Element | null = el; n; n = n.parentElement) {
      const layer = toRgba(getComputedStyle(n).backgroundColor);
      if (layer[3] > 0) layers.push(layer);
      if (layer[3] >= 0.999) break;
    }
    const base = layers.at(-1);
    let bg: number[] = base && base[3] >= 0.999 ? (layers.pop() ?? base).slice(0, 3) : [255, 255, 255];
    for (const layer of layers.reverse()) bg = over(layer, bg);
    const fg = over(toRgba(getComputedStyle(el).color), bg);
    const [a, b] = [lum(fg), lum(bg)].sort((x, y) => y - x) as [number, number];
    return (a + 0.05) / (b + 0.05);
  });

/**
 * Nothing under `scope` moves: every `transition-duration` / `animation-duration` is at most 1 ms (reduced motion; the
 * global rule of styles/global.css sets 0.01 ms, the components' own rules set none).
 */
async function expectStill(scope: Locator, what: string): Promise<void> {
  const moving = await scope.evaluate((root) =>
    [root, ...root.querySelectorAll('*')]
      .map((el) => {
        const cs = getComputedStyle(el);
        const dur = (v: string) => Math.max(...v.split(',').map((x) => parseFloat(x) || 0));
        return dur(cs.transitionDuration) > 0.001 ||
          (cs.animationName !== 'none' && dur(cs.animationDuration) > 0.001)
          ? `${el.tagName.toLowerCase()}.${String(el.getAttribute('class') ?? '').slice(0, 40)}`
          : null;
      })
      .filter((x): x is string => x !== null),
  );
  expect(moving, `${what}: no transition or animation under reduced motion`).toEqual([]);
}

/** The back link of a workouts page header («‹ Мої тренування», «‹ Згорнути»…): see the .fixme below. */
const WORKOUTS_BACK_LINK = 'a[aria-label="Згорнути тренування"], a[aria-label^="Назад: "]';

/** The library's group chips: one line that scrolls sideways on the phone (measured by `chipRowAreas`). */
const GROUP_CHIPS = '[role="group"][aria-label="Групи вправ"] button';

/**
 * The hit area of every chip of a sideways-scrolling row, each one scrolled to the middle of its row first (with the
 * row's scroll snapping paused, so the chip stays where a finger would have scrolled it).
 */
async function chipRowAreas(row: Locator): Promise<Record<string, string>> {
  const chips = row.getByRole('button');
  const sizes: Record<string, string> = {};
  for (let i = 0; i < (await chips.count()); i++) {
    const chip = chips.nth(i);
    await chip.evaluate((el: HTMLElement) => {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      let scroller = el.parentElement;
      while (scroller && getComputedStyle(scroller).overflowX !== 'auto') scroller = scroller.parentElement;
      if (!scroller) return;
      scroller.style.scrollSnapType = 'none';
      const chipBox = el.getBoundingClientRect();
      const rowBox = scroller.getBoundingClientRect();
      scroller.scrollLeft += chipBox.left + chipBox.width / 2 - (rowBox.left + rowBox.width / 2);
    });
    sizes[`chip «${(await chip.textContent())?.trim()}»`] = await hitArea(chip);
  }
  return sizes;
}

/** No control is nested in another control inside `scope`. */
async function expectNoNestedControls(scope: Locator, what: string): Promise<void> {
  expect(await scope.locator(NESTED_CONTROL).count(), `${what}: nested controls`).toBe(0);
}

/** The training seed's latest «Ноги + прес» (12 October, every set done, squat 40 kg — a record). */
async function latestLegs(server: ServerApi): Promise<string> {
  const session = (await server.getData()).sessions.find(
    (s) => s.date === '2026-10-12' && s.name === 'Ноги + прес' && s.status === 'done',
  );
  if (!session) throw new Error('the training seed has «Ноги + прес» on 12 October');
  return session.id;
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`workouts and steps — ${colorScheme}, reduced motion`, () => {
    test.use({ seed: 'training', colorScheme, reducedMotion: 'reduce' });

    test('«Вправи», an exercise, «Нова вправа» and the picker: roles, names, pressed states, colour + text', async ({
      page,
      isMobile,
    }) => {
      await openLibrary(page);
      await expect(page.getByRole('searchbox', { name: 'Пошук вправи', exact: true })).toBeVisible();
      const groups = page.getByRole('group', { name: 'Групи вправ', exact: true });
      await expect(groups.getByRole('button')).toHaveCount(10);
      for (const chip of [
        'Усі',
        'Груди',
        'Спина',
        'Плечі',
        'Руки',
        'Прес',
        'Ноги',
        'Сідниці',
        'Кардіо',
        'Мої',
      ] as const)
        await expect(groupChip(page, chip)).toHaveAttribute(
          'aria-pressed',
          chip === 'Усі' ? 'true' : 'false',
        );
      // Rows are links named by the exercise; their body-map thumbs are decorative.
      const list = exerciseList(page);
      await expect(list.getByRole('link', { name: /^Присідання зі штангою\s/ })).toBeVisible();
      await expect(list.getByRole('img')).toHaveCount(0);
      await expectNoNestedControls(page.getByRole('main'), '«Вправи»');
      if (isMobile) {
        await expectTouchFriendly(page.getByRole('main'), '«Вправи»', GROUP_CHIPS);
        expect(below44(await chipRowAreas(groups))).toEqual([]);
      }

      // The exercise: the body map is an image named by its muscles; the colour key repeats them as text.
      const detail = await openExercise(page, 'Присідання зі штангою');
      const map = detail.getByRole('img', { name: /^Основні мʼязи: квадрицепс, сідниці\. Допоміжні: / });
      await expect(map).toBeVisible();
      const fills = await map.evaluate((svg) => [
        ...new Set([...svg.querySelectorAll('path')].map((p) => getComputedStyle(p).fill)),
      ]);
      expect(fills, 'primary muscles are filled with --acc').toContain(await tokenColor(page, '--acc'));
      expect(fills, 'secondary muscles are filled with --accLine').toContain(
        await tokenColor(page, '--accLine'),
      );
      await expectStill(map, 'body map');
      await expect(detail.getByText('Задня поверхня стегна', { exact: false }).first()).toBeVisible();
      const progress = detail.getByRole('region', { name: 'Прогрес', exact: true });
      await expect(progress.getByRole('img', { name: /^Найкращий підхід, кг: з / })).toBeVisible();
      await expect(detail.getByRole('region', { name: 'Рекорди', exact: true })).toBeVisible();
      await expect(
        detail.getByRole('region', { name: 'Останні тренування', exact: true }).getByRole('link').first(),
      ).toHaveAccessibleName(/^12 жовтня · Ноги \+ прес/);
      const hint = progress.getByText('Минулого разу всі підходи виконано — спробуй +2,5 кг');
      await expect(hint).toBeVisible();
      expect(await hint.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(
        13,
      );
      expect(await contrastOf(hint), 'hint contrast').toBeGreaterThanOrEqual(4.5);

      // «Нова вправа»: a named modal; the map is decorative there (the chips are the input), errors are described.
      await openLibrary(page);
      const editor = await openNewExercise(page, page);
      await expect(editor).toHaveAttribute('aria-modal', 'true');
      await settled(editor);
      await expect(editor.getByRole('img')).toHaveCount(0);
      await expect(
        editor.getByRole('radiogroup', { name: 'Тип', exact: true }).getByRole('radio'),
      ).toHaveCount(4);
      await expect(editor.getByRole('radio', { name: 'З вагою', exact: true })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      await expect(editor.getByRole('radiogroup', { name: 'Інтенсивність', exact: true })).toBeVisible();
      const muscles = editor.getByRole('group', { name: 'Мʼязи' });
      await expect(muscles.locator('button[aria-pressed]')).toHaveCount(15);
      await expect(muscles.locator('button[aria-pressed="true"]')).toHaveCount(0);
      await muscles.getByRole('button', { name: 'Груди', exact: true }).click();
      const chest = muscles.getByRole('button', { name: 'Груди · основний', exact: true });
      await expect(chest).toHaveAttribute('aria-pressed', 'true');
      await chest.click();
      await expect(muscles.getByRole('button', { name: 'Груди · допоміжний', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expectStill(muscles, 'muscle chips');
      await editor.getByRole('button', { name: 'Зберегти', exact: true }).click();
      const name = editor.getByRole('textbox', { name: 'Назва', exact: true });
      await expect(name).toHaveAttribute('aria-invalid', 'true');
      await expect(name).toHaveAccessibleDescription('Дай вправі назву');
      await expect(
        editor.getByRole('alert').filter({ hasText: 'Обери хоча б один основний мʼяз' }),
      ).toBeVisible();
      expect(
        await contrastOf(editor.getByText('Дай вправі назву')),
        'error text contrast',
      ).toBeGreaterThanOrEqual(4.5);
      await expectNoNestedControls(editor, '«Нова вправа»');
      if (isMobile) await expectTouchFriendly(editor, '«Нова вправа»');
      await editor.getByRole('button', { name: 'Закрити' }).click();
      await expect(editor).toBeHidden();

      // The picker (multi): rows are toggles, «Додати (N)» names the count and is disabled at 0.
      await page.goto('/workouts/new');
      await expect(pageTitle(page, 'Нове тренування')).toBeVisible();
      await page.getByRole('button', { name: '+ Додати вправи', exact: true }).click();
      const picker = page.getByRole('dialog', { name: 'Додати вправи', exact: true });
      await expect(picker).toHaveAttribute('aria-modal', 'true');
      await settled(picker);
      await expect(picker.getByRole('button', { name: 'Додати (0)', exact: true })).toBeDisabled();
      const rows = picker.getByRole('region', { name: 'Вправи', exact: true });
      await picker.getByRole('searchbox', { name: 'Пошук вправи', exact: true }).fill('Планка');
      const plank = rows.getByRole('button', { name: /^Планка\s/ });
      await expect(plank).toHaveAttribute('aria-pressed', 'false');
      await plank.click();
      await expect(plank).toHaveAttribute('aria-pressed', 'true');
      await expect(picker.getByRole('button', { name: 'Додати (1)', exact: true })).toBeEnabled();
      await expectNoNestedControls(picker, 'picker');
      if (isMobile) await expectTouchFriendly(picker, 'picker');
    });

    test('the builder: named ↑ / ↓ (disabled at the ends), focus stays, a polite live region, the «⋯» menu', async ({
      page,
      isMobile,
    }) => {
      await page.goto('/workouts/edit/demoWorkoutLegs');
      await expect(pageTitle(page, 'Ноги + прес')).toBeVisible();
      await expect(builderCards(page)).toHaveCount(4);
      await expect(
        page.getByRole('button', { name: 'Вгору: Присідання зі штангою', exact: true }),
      ).toBeDisabled();
      await expect(page.getByRole('button', { name: 'Вниз: Планка', exact: true })).toBeDisabled();
      // The drag handle is pointer-only and hidden from assistive tech; the arrows are the accessible way.
      const handles = await builderCards(page).evaluateAll((cards) =>
        cards.map((card) => card.querySelector('[aria-hidden="true"] svg') !== null),
      );
      expect(handles).toEqual([true, true, true, true]);

      const down = page.getByRole('button', { name: 'Вниз: Присідання зі штангою', exact: true });
      await down.click();
      await expect(down).toBeFocused();
      const live = page.locator('[aria-live="polite"]').filter({ hasText: 'Присідання зі штангою — 2 з 4' });
      await expect(live).toHaveCount(1);
      await expect(live).toHaveClass(/visually-hidden/);

      const more = page.getByRole('button', { name: 'Дії: Скручування', exact: true });
      await expect(more).toHaveAttribute('aria-haspopup', 'menu');
      await expect(more).toHaveAttribute('aria-expanded', 'false');
      await more.click();
      await expect(more).toHaveAttribute('aria-expanded', 'true');
      const menu = page.getByRole('menu', { name: 'Дії: Скручування', exact: true });
      await expect(menu.getByRole('menuitem')).toHaveText(['Дублювати', 'Видалити']);
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);

      // The weekday picker names the days in full; «Змінити» opens one named stepper per line.
      await expect(
        page.getByRole('group', { name: 'Дні тренувань' }).getByRole('button', { name: 'Середа' }),
      ).toHaveAttribute('aria-pressed', 'true');
      await page.getByRole('button', { name: 'Змінити: Присідання зі штангою', exact: true }).click();
      for (const label of ['Вага', 'Відпочинок'])
        for (const dir of ['менше', 'більше'])
          await expect(page.getByRole('button', { name: `${label}: ${dir}`, exact: true })).toBeVisible();
      await expectNoNestedControls(page.getByRole('main'), 'builder');
      if (isMobile) {
        await expect(page.getByRole('navigation', { name: 'Основна навігація' })).toHaveCount(0);
        await expectTouchFriendly(page.getByRole('main'), 'builder');
      }
    });

    test('the session: a timer that is not live, aria-pressed sets, the footer names the set, the rest is announced once', async ({
      app,
      page,
      isMobile,
    }) => {
      await app.goto('/');
      await app
        .region('Сьогодні')
        .getByRole('button', { name: 'Почати тренування «Ноги + прес»', exact: true })
        .click();
      await expect(pageTitle(page, 'Ноги + прес')).toBeVisible();

      const timer = page.getByRole('timer', { name: /^Тривалість \d+:\d\d$/ });
      await expect(timer).toBeVisible();
      await expect(timer).not.toHaveAttribute('aria-live', /polite|assertive/);
      const squat = sessionCard(page, 'Присідання зі штангою');
      await expect(squat).toHaveAttribute('aria-current', 'step');
      await expect(page.locator('li[aria-current="step"]')).toHaveCount(1);
      await expect(setCheck(squat, 1)).toHaveAttribute('aria-pressed', 'false');
      await expect(squat.getByRole('list', { name: 'Підходи: Присідання зі штангою' })).toBeVisible();

      const footer = footerConfirm(page);
      await expectLabelInName(footer, 'footer confirm');
      await expect(footer).toHaveAccessibleName(/^✓ Підхід 1 · 12 × 40\sкг$/);
      expect((await box(footer, 'footer')).height, 'footer button height').toBeGreaterThanOrEqual(44);
      expect(await contrastOf(footer), 'footer text contrast').toBeGreaterThanOrEqual(4.5);
      await footer.click();
      await expect(setCheck(squat, 1)).toHaveAttribute('aria-pressed', 'true');
      await expect(footer).toHaveAccessibleName(/^✓ Підхід 2 · /);

      // The rest bar: a named group; its time is a timer; the end is said once, politely.
      const rest = restBar(page);
      await expect(rest.getByRole('timer')).toBeVisible();
      for (const name of ['Відпочинок: мінус 15 секунд', 'Відпочинок: плюс 15 секунд', 'Пропустити'])
        await expectLabelInName(rest.getByRole('button', { name, exact: true }), name);
      const announce = page.locator('[aria-live="polite"]').filter({ hasText: 'Час! Наступний підхід' });
      await expect(announce).toHaveCount(0);
      await page.clock.fastForward(95_000);
      await expect(rest.getByRole('timer')).toHaveText(/^Відпочинок завершено/);
      await expect(announce).toHaveCount(1);
      await expect(announce).toHaveText('Час! Наступний підхід');
      expect(await contrastOf(rest.getByRole('timer')), 'rest text contrast').toBeGreaterThanOrEqual(4.5);
      await expectStill(rest, 'rest bar');
      if (isMobile) {
        await expect(page.getByRole('navigation', { name: 'Основна навігація' })).toHaveCount(0);
        // The bar never covers the footer button.
        const bar = await box(rest, 'rest bar');
        const btn = await box(footer, 'footer');
        expect(bar.y + bar.height, 'the rest bar sits above the footer button').toBeLessThanOrEqual(
          btn.y + 0.5,
        );
        // «‹ Згорнути» is the known 42px back link (the .fixme «the back links of the workouts pages» below).
        await expectTouchFriendly(page.getByRole('main'), 'session', WORKOUTS_BACK_LINK);
      }

      // The card menu is a real menu button.
      const more = squat.getByRole('button', { name: 'Дії: Присідання зі штангою', exact: true });
      await expect(more).toHaveAttribute('aria-haspopup', 'menu');
      await more.click();
      await expect(page.getByRole('menuitem', { name: 'Пропустити вправу', exact: true })).toBeVisible();
      await page.keyboard.press('Escape');
      await expectNoNestedControls(page.getByRole('main'), 'session');
    });

    test('the session on another device is read-only: the banner, «Продовжити тут», no toggles', async ({
      page,
      server,
    }) => {
      const data = trainingSeed();
      data.sessions = [
        ...data.sessions,
        e2eSession({
          id: 'e2eOtherDevice01',
          workoutId: 'demoWorkoutLegs',
          name: 'Ноги + прес',
          deviceId: 'e2eOtherPhone001',
          createdAt: NOW - 10 * 60_000,
          startedAt: NOW - 10 * 60_000,
        }),
      ];
      await server.importData(data);
      await page.goto('/workouts/session/e2eOtherDevice01');
      await expect(pageTitle(page, 'Ноги + прес')).toBeVisible();
      const banner = page.getByText('Тренування триває на іншому пристрої', { exact: true });
      await expect(banner).toBeVisible();
      expect(await contrastOf(banner), 'banner text contrast').toBeGreaterThanOrEqual(4.5);
      const takeOver = page.getByRole('button', { name: 'Продовжити тут', exact: true });
      await expect(takeOver).toBeVisible();
      expect((await box(takeOver, '«Продовжити тут»')).height).toBeGreaterThanOrEqual(32);
      await expect(page.locator('button[aria-pressed]')).toHaveCount(0);
      await expect(footerConfirm(page)).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Завершити', exact: true })).toHaveCount(0);
      // Read-only sets still say whether they are done.
      await expect(page.getByText('не виконано', { exact: true }).first()).toBeAttached();
      await takeOver.click();
      await expect(banner).toHaveCount(0);
      await expect(footerConfirm(page)).toBeVisible();
    });

    test('the summary and the steps sheet: a status line, the strip, records; a labelled big input with named steppers', async ({
      app,
      page,
      server,
      isMobile,
    }) => {
      await page.goto(`/workouts/session/${await latestLegs(server)}`);
      await expect(pageTitle(page, 'Ноги + прес')).toBeVisible();
      // «✓ Тренування збережено» is only said right after finishing.
      await expect(page.getByRole('status').filter({ hasText: 'Тренування збережено' })).toHaveCount(0);
      const strip = page.getByLabel('Підсумок тренування', { exact: true });
      await expect(strip).toBeVisible();
      await expect(strip.getByRole('term')).toHaveText(['Тривалість', 'Обʼєм', 'Підходів', 'Спалено']);
      const records = page.getByRole('region', { name: 'Нові рекорди', exact: true });
      await expect(records).toContainText(/Присідання зі штангою\s*40\sкг \(було 37,5\)/);
      const exerciseLink = page.getByRole('link', { name: /^Присідання зі штангою/ }).first();
      await expect(exerciseLink).toHaveAttribute('href', '/workouts/library/lib.back-squat');
      await expect(page.getByRole('button', { name: 'Змінити', exact: true })).toBeVisible();
      await expectNoNestedControls(page.getByRole('main'), 'summary');
      if (isMobile) await expectTouchFriendly(page.getByRole('main'), 'summary');

      await app.goto('/?sheet=steps');
      const sheet = app.sheet('Кроки');
      await expect(sheet).toHaveAttribute('aria-modal', 'true');
      await settled(sheet);
      const input = sheet.getByRole('textbox', { name: 'Кроки за день', exact: true });
      await expect(input).toHaveAttribute('inputmode', 'numeric');
      expect(await input.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))).toBeGreaterThanOrEqual(
        28,
      );
      for (const name of ['Мінус 1000 кроків', 'Мінус 500 кроків', 'Плюс 500 кроків', 'Плюс 1000 кроків'])
        await expectLabelInName(sheet.getByRole('button', { name, exact: true }), name);
      await sheet.getByRole('button', { name: 'Плюс 1000 кроків', exact: true }).click();
      await expect(input).toHaveValue('1 000');
      await expect(sheet.getByText('Ціль 8 000 — ще 7 000', { exact: true })).toBeVisible();
      expect(await contrastOf(input), 'the count contrast').toBeGreaterThanOrEqual(4.5);
      for (const name of ['Попередній день', 'Наступний день'])
        await expect(sheet.getByRole('button', { name, exact: true })).toBeVisible();
      await expectNoNestedControls(sheet, 'steps sheet');
      await expectStill(sheet, 'steps sheet');
      if (isMobile) await expectTouchFriendly(sheet, 'steps sheet');
    });

    // FIXME(app bug, features/workouts/PageHeader): like ScreenHeader's «‹ Налаштування» (the .fixme above), the back
    // link of the workouts pages is 44px tall but the <h1> below overlaps its bottom 2px, so a finger reaches 42px
    // (measured: 61×42 on «Мої тренування», the builder, the summary and the live session). Remove the .fixme (and
    // WORKOUTS_BACK_LINK) once the header leaves the link its 44px.
    test.fixme('the back links of the workouts pages reach 44px', async ({ app, page, server }) => {
      const sizes: Record<string, string> = {};
      for (const path of [
        '/workouts',
        '/workouts/edit/demoWorkoutLegs',
        `/workouts/session/${await latestLegs(server)}`,
      ]) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        sizes[path] = await hitArea(page.locator(WORKOUTS_BACK_LINK).first());
      }
      await app.goto('/');
      await app.region('Сьогодні').getByRole('button', { name: 'Почати тренування «Ноги + прес»' }).click();
      sizes['live session'] = await hitArea(page.locator(WORKOUTS_BACK_LINK).first());
      expect(below44(sizes)).toEqual([]);
    });

    test.describe('the coach (stubbed)', () => {
      test.use({ account: 'admin' });

      test('«Тренування» of a client: a named period card, session groups of static rows; the «Кроки» column', async ({
        page,
        admin,
        isMobile,
      }) => {
        await stubCoach(page, admin);
        if (!isMobile) {
          await openClients(page);
          const steps = columnHeader(page, 'Кроки');
          await expect(steps).toHaveAttribute('scope', 'col');
          await expect(steps).toHaveAttribute('aria-sort', 'none');
          await expect(steps.getByRole('button')).toBeVisible();
          // The cell is read as a sentence, not as «8 300 / 8 000».
          await expect(clientRow(page, 'sofia')).toContainText(
            /кроків у середньому [\d\s]+ на день за 7 днів, ціль 8\s000/,
          );
        }

        await page.goto(`/coach/${COACH_STUB_IDS.sofia}?tab=workouts&days=30`);
        await expect(page.getByRole('heading', { level: 1, name: 'sofia', exact: true })).toBeVisible();
        await expectCurrentTab(page, 'Тренування');
        await expect(page.getByRole('heading', { level: 2, name: 'Тренування', exact: true })).toBeAttached();
        const period = page.getByRole('region', { name: 'За 30 днів', exact: true });
        await expect(period).toContainText('Розклад: ');
        expect(
          await contrastOf(period.getByText(/^Розклад: /)),
          'schedule line contrast',
        ).toBeGreaterThanOrEqual(4.5);
        const group = page.getByRole('region', { name: '12 жовтня · Ноги + прес', exact: true });
        await expect(group).toContainText('Присідання зі штангою');
        const main = page.getByRole('main');
        await expect(group.getByRole('button')).toHaveCount(0);
        await expect(period.getByRole('button')).toHaveCount(0);
        await expect(group.getByRole('link')).toHaveCount(0);
        await expect(main.locator('a[href^="/workouts"]')).toHaveCount(0);
        for (const role of ['checkbox', 'switch', 'textbox', 'spinbutton'] as const)
          await expect(main.getByRole(role)).toHaveCount(0);
        await expectNoSideScroll(page, 'coach «Тренування»');
        expect(await inputsBelow16px(page), 'coach «Тренування» inputs').toEqual([]);
        if (isMobile) await expectTouchFriendly(main, 'coach «Тренування»');
      });
    });
  });
}
