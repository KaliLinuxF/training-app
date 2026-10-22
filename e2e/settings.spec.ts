import type { Locator, Page } from '@playwright/test';
import { DEFAULT_MEAL_TYPES, type MacroGoals } from '../packages/shared/src/index';
import { MEALS_TODAY } from './fixtures/data';
import { SETTINGS_SLUGS, type App, type SettingsSection } from './support/app';
import { ADMIN_USERNAME, TODAY, USERNAME } from './support/env';
import type { ServerApi } from './support/server';
import { expect, test } from './support/test';

/** Every row of the list for an admin; a user has all but «Користувачі» (docs/multi-user.md D30). */
const SECTIONS = Object.keys(SETTINGS_SLUGS) as SettingsSection[];
const USER_SECTIONS = SECTIONS.filter((title) => title !== 'Користувачі');

const CAPTION = 'Легко · трекер схуднення';

const DEFAULT_TYPES = [...DEFAULT_MEAL_TYPES];

/** «Мої прийоми їжі» (Налаштування → Прийоми їжі): her list, the edit fields and buttons, the add form. */
function mealTypesCard(app: App) {
  const card = app.region('Мої прийоми їжі');
  return {
    card,
    /** The names in view mode (one list item each). */
    items: card.getByRole('list', { name: 'Типи, які можна вибрати для прийому їжі' }).getByRole('listitem'),
    edit: card.getByRole('button', { name: 'Змінити', exact: true }),
    done: card.getByRole('button', { name: 'Готово', exact: true }),
    field: (name: string) => card.getByRole('textbox', { name: `Назва: ${name}`, exact: true }),
    up: (name: string) => card.getByRole('button', { name: `Вище: ${name}`, exact: true }),
    down: (name: string) => card.getByRole('button', { name: `Нижче: ${name}`, exact: true }),
    remove: (name: string) => card.getByRole('button', { name: `Видалити «${name}»`, exact: true }),
    input: card.getByRole('textbox', { name: 'Новий тип прийому їжі', exact: true }),
    add: card.getByRole('button', { name: 'Додати', exact: true }),
    restore: card.getByRole('button', { name: 'Повернути стандартні', exact: true }),
    status: card.getByRole('status'),
  };
}

const MEAL_NOTE_DEFAULTS =
  'Тип нового прийому підказується за часом: 08:00 — Сніданок · 13:00 — Обід · 16:30 — Перекус · 19:00 — Вечеря. ' +
  'Його завжди можна змінити. Перейменування не змінює вже записані прийоми.';

/** The note under the card (generated from the meal editor's own preselection). */
const mealNote = (page: Page) => page.getByText(/^(Тип нового прийому підказується|Без типів новий прийом)/);

/**
 * The «Вийти» row — on the «Акаунт» page now, no longer on the list (D30). Only touched while no dialog is open: the
 * logout dialog has its own «Вийти».
 */
const logoutRow = (page: Page) => page.getByRole('button', { name: 'Вийти', exact: true });

/**
 * The phone list fits one screen at 390×844 (the Playwright iPhone) and 390×763 (the installed app's web view on an
 * iPhone 14: status bar, no URL bar), every row above the tab bar, no scroll, the first group right under the header.
 */
async function expectListFits(app: App, page: Page, rows: readonly SettingsSection[]): Promise<void> {
  for (const height of [844, 763]) {
    await page.setViewportSize({ width: 390, height });
    await app.goto('/settings');
    const at = `390×${height}`;
    // The worst case: an iPhone Safari tab shows the install badge, the tallest row.
    await expect(app.settingsRow('Нагадування')).toContainText('Потрібне встановлення');
    // The admin's «Користувачі» row has its count once the overview is in (same height either way).
    if (rows.includes('Користувачі'))
      await expect(app.settingsRow('Користувачі')).toContainText(/\d+ акаунт/);

    const bar = await box(app.nav, `tab bar @${at}`);
    for (const title of rows) {
      const b = await box(app.settingsRow(title), `«${title}» @${at}`);
      expect(b.y, `«${title}» top @${at}`).toBeGreaterThanOrEqual(0);
      expect(b.y + b.height, `«${title}» above the tab bar @${at}`).toBeLessThanOrEqual(bar.y);
    }
    // «Вийти» is not on the list any more.
    await expect(logoutRow(page)).toHaveCount(0);
    const overflow = await page.evaluate(
      () => (document.scrollingElement ?? document.documentElement).scrollHeight - window.innerHeight,
    );
    expect(overflow, `scrolls @${at}`).toBeLessThanOrEqual(1);

    // Classic layout (owner decision Q8): the first group sits right under the header, not docked low.
    const header = await box(
      page.locator('header').filter({ has: app.heading('Налаштування') }),
      `header @${at}`,
    );
    const list = await box(page.getByRole('navigation', { name: 'Розділи налаштувань' }), `list @${at}`);
    const gap = list.y - (header.y + header.height);
    expect(gap, `header → first group @${at}`).toBeGreaterThanOrEqual(0);
    expect(gap, `header → first group @${at}`).toBeLessThanOrEqual(24);
  }
}

/** Any push problem badge of the «Нагадування» row (push is never enabled in the e2e browsers). */
const PUSH_BADGE = /^(Сповіщення (вимкнені|заборонені|недоступні)|Потрібне встановлення)$/;

/** A section's title: the sub-page <h1> on the phone, the pane's <h2> on desktop. */
const sectionHeading = (page: Page, title: SettingsSection) =>
  page.getByRole('heading', { name: title, exact: true }).first();

async function box(locator: Locator, what: string) {
  const b = await locator.boundingBox();
  if (!b) throw new Error(`${what} is not visible`);
  return b;
}

/** Text taller than ~1.5 font sizes has wrapped onto a second line. */
const lines = (el: Element) => {
  const fontSize = parseFloat(getComputedStyle(el).fontSize);
  return Math.round(el.getBoundingClientRect().height / (fontSize * 1.25));
};

test.describe('settings list', () => {
  test('on the phone the whole list fits one screen, right under the header (user)', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout');
    await expectListFits(app, page, USER_SECTIONS);
    await expect(app.settingsRow('Користувачі')).toHaveCount(0);
    await expect(page.getByText(CAPTION, { exact: true })).toBeVisible();
  });

  test('each row sums up its section; «Акаунт» shows the name; the caption is there', async ({ app }) => {
    await app.goto('/');
    await app.go('Налаштування');
    await expect(app.settingsRow('Нагадування')).toContainText('3 увімк.');
    await expect(app.settingsRow('Цілі')).toContainText('60 кг · 1 700 ккал');
    await expect(app.settingsRow('Типи тренувань')).toContainText('7 типів');
    await expect(app.settingsRow('Прийоми їжі')).toContainText('4 типи');
    await expect(app.settingsRow('Вигляд')).toContainText('Авто');
    await expect(app.settingsRow('Дані і копія')).toContainText('Синхронізовано');
    await expect(app.settingsRow('Акаунт')).toHaveAccessibleName(`Акаунт ${USERNAME}`);
    await expect(app.settingsRow('Користувачі')).toHaveCount(0);
    await expect(logoutRow(app.page)).toHaveCount(0);
    await expect(app.page.getByText(CAPTION, { exact: true })).toBeVisible();
  });

  test('cancelling the logout dialog gives the focus back to «Вийти» (on «Акаунт»)', async ({
    app,
    page,
  }) => {
    await app.gotoSettings('Акаунт');
    const row = logoutRow(page);
    const dialog = page.getByRole('alertdialog');

    // Keyboard: Enter opens the dialog on «Скасувати», Escape closes it.
    await row.focus();
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('button', { name: 'Скасувати' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeEnabled();
    await expect(row).toBeFocused();

    // «Скасувати» itself does the same.
    await page.keyboard.press('Enter');
    await dialog.getByRole('button', { name: 'Скасувати' }).click();
    await expect(dialog).toHaveCount(0);
    await expect(row).toBeFocused();
    await expect(page).toHaveURL(/\/settings\/account$/);
  });

  test('in iPhone Safari the reminders row says the app needs installing; «Як?» explains how', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'iPhone Safari tab');
    await app.goto('/');
    await app.go('Налаштування');
    const row = app.settingsRow('Нагадування');
    // The badge is part of the link's name, not only its look.
    await expect(row).toHaveAccessibleName(/^Нагадування Потрібне встановлення/);
    await row.click();
    await expect(page.getByRole('heading', { level: 1, name: 'Нагадування', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/reminders$/);
    await app.region('Сповіщення на телефон').getByRole('button', { name: 'Як?' }).click();
    await expect(app.sheet('Встановлення на iPhone')).toBeVisible();
  });

  test('a row opens its sub-page; «‹ Налаштування» goes back to the list', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'the back link is phone only');
    await app.goto('/settings');
    await app.settingsRow('Цілі').click();
    const title = page.getByRole('heading', { level: 1, name: 'Цілі', exact: true });
    await expect(title).toBeVisible();
    await expect(page).toHaveURL(/\/settings\/goals$/);
    // Opened from the list: the new title has the focus (screen readers start there).
    await expect(title).toBeFocused();
    await expect(app.settingsBack()).toBeVisible();
    expect((await box(app.settingsBack(), 'back link')).height).toBeGreaterThanOrEqual(44);

    await app.settingsBack().click();
    await expect(app.heading('Налаштування')).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
    // The focus went away with the sub-page: the row that opened it takes it back (not <body>).
    await expect(app.settingsRow('Цілі')).toBeFocused();
    // It went back in the history (no new entry): forward returns to the sub-page.
    await page.goForward();
    await expect(title).toBeVisible();

    // A deep link has nothing to go back to: the back link replaces it with the list.
    await app.gotoSettings('Типи тренувань');
    await app.settingsBack().click();
    await expect(app.heading('Налаштування')).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(app.settingsRow('Типи тренувань')).toBeFocused();
  });

  test('the «Налаштування» tab and the system back return from a sub-page to the list', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'tab bar');
    const tab = app.nav.getByRole('link', { name: 'Налаштування', exact: true });

    await app.gotoSettings('Цілі');
    await tab.click();
    await expect(app.heading('Налаштування')).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);

    await app.settingsRow('Цілі').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Цілі', exact: true })).toBeVisible();
    await tab.click();
    await expect(app.heading('Налаштування')).toBeVisible();
    await expect(page).toHaveURL(/\/settings$/);

    await app.settingsRow('Цілі').click();
    await expect(page.getByRole('heading', { level: 1, name: 'Цілі', exact: true })).toBeVisible();
    await page.goBack();
    await expect(app.heading('Налаштування')).toBeVisible();
    await expect(app.settingsRow('Цілі')).toBeVisible();
    // The focused sub-page title is gone: the row that opened it has the focus. (Not asserted after the tab taps.)
    await expect(app.settingsRow('Цілі')).toBeFocused();
  });

  test('old /reminders links open the reminders; unknown sections fall back to the list', async ({
    app,
    page,
  }) => {
    await app.goto('/reminders');
    await expect(page).toHaveURL(/\/settings\/reminders$/);
    await expect(app.region('Сповіщення на телефон')).toBeVisible();
    await expect(sectionHeading(page, 'Нагадування')).toBeVisible();

    await app.goto('/settings/foo');
    await expect(page).toHaveURL(/\/settings$/);
    await expect(app.heading('Налаштування')).toBeVisible();
  });

  test('the «Вигляд» row follows the theme she picks', async ({ app, page }, info) => {
    if (info.project.name === 'iphone') {
      await app.goto('/');
      await app.openSettings('Вигляд');
    } else {
      // Desktop: the list and the section are on screen together.
      await app.gotoSettings('Вигляд');
      await expect(app.settingsRow('Вигляд')).toHaveAttribute('aria-current', 'page');
      await expect(app.settingsRow('Вигляд')).toContainText('Авто');
    }
    await expect(sectionHeading(page, 'Вигляд')).toBeVisible();
    // One landmark «Вигляд»: the card on the phone, the pane on desktop (never one inside the other).
    await expect(page.getByRole('region', { name: 'Вигляд', exact: true })).toHaveCount(1);
    await page.getByRole('radiogroup', { name: 'Тема' }).getByRole('radio', { name: 'Темна' }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    if (info.project.name === 'iphone') await app.settingsBack().click();
    await expect(app.settingsRow('Вигляд')).toContainText('Темна');
  });
});

test.describe('settings list for an admin', () => {
  test.use({ account: 'admin' });

  test('the list with «Користувачі» still fits one phone screen; no caption', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout');
    await expectListFits(app, page, SECTIONS);
    await expect(page.getByText(CAPTION, { exact: true })).toHaveCount(0);
  });

  test('«Акаунт» shows the admin’s name and «Користувачі» how many accounts there are', async ({
    app,
    admin,
  }) => {
    await app.goto('/settings');
    await expect(app.settingsRow('Акаунт')).toHaveAccessibleName(`Акаунт ${ADMIN_USERNAME}`);
    const count = (await admin.overview()).users.length;
    await expect(app.settingsRow('Користувачі')).toHaveAccessibleName(
      new RegExp(`^Користувачі ${count} акаунт(и|ів)?$`),
    );
    await expect(app.page.getByText(CAPTION, { exact: true })).toHaveCount(0);
    // The account group is the last one, «Користувачі» right under «Акаунт».
    const [account, users] = [
      await box(app.settingsRow('Акаунт'), 'Акаунт'),
      await box(app.settingsRow('Користувачі'), 'Користувачі'),
    ];
    expect(users.y).toBeGreaterThan(account.y);
    for (const title of USER_SECTIONS.filter((t) => t !== 'Акаунт')) {
      expect((await box(app.settingsRow(title), title)).y, title).toBeLessThan(account.y);
    }
  });
});

test.describe('settings on desktop', () => {
  test('the list and the selected section sit side by side; a row swaps the section and the URL', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');
    await app.goto('/');
    await app.go('Налаштування');
    await expect(page).toHaveURL(/\/settings$/);
    const list = page.getByRole('navigation', { name: 'Розділи налаштувань' });
    const detail = app.region('Нагадування');
    await expect(detail.getByRole('heading', { level: 2, name: 'Нагадування' })).toBeVisible();
    await expect(detail.getByRole('region', { name: 'Сповіщення на телефон' })).toBeVisible();
    await expect(app.settingsRow('Нагадування')).toHaveAttribute('aria-current', 'page');
    await expect(app.settingsBack()).toHaveCount(0);

    // Push is off in this browser: the badge on the selected (tinted) row is still a chip, not loose text.
    const badge = app.settingsRow('Нагадування').getByText(PUSH_BADGE);
    await expect(badge).toBeVisible();
    await page.mouse.move(0, 0);
    const bg = (el: Locator) => el.evaluate((node) => getComputedStyle(node).backgroundColor);
    expect(await bg(badge)).not.toBe(await bg(app.settingsRow('Нагадування')));
    // …and the bell keeps its square: an --accT square on the --accT row would vanish (kit: --card there).
    const bell = app.settingsRow('Нагадування').locator('svg').first().locator('..');
    expect(await bg(bell)).not.toBe(await bg(app.settingsRow('Нагадування')));

    const [l, d] = [await box(list, 'list'), await box(detail, 'detail')];
    expect(l.x + l.width).toBeLessThanOrEqual(d.x);
    expect(Math.abs(l.y - d.y)).toBeLessThanOrEqual(4);
    expect(d.width).toBeLessThanOrEqual(640.5);

    await app.settingsRow('Цілі').click();
    await expect(page).toHaveURL(/\/settings\/goals$/);
    await expect(app.region('Цілі').getByRole('region', { name: 'Мої цілі' })).toBeVisible();
    await expect(app.region('Сповіщення на телефон')).toHaveCount(0);
    await expect(app.settingsRow('Цілі')).toHaveAttribute('aria-current', 'page');
    await expect(app.settingsRow('Нагадування')).not.toHaveAttribute('aria-current');

    // Clicking the selected row again stacks no twin entries (Back would seem to do nothing).
    const historyLength = () => page.evaluate(() => window.history.length);
    const before = await historyLength();
    await app.settingsRow('Цілі').click();
    await app.settingsRow('Цілі').click();
    await expect(page).toHaveURL(/\/settings\/goals$/);
    expect(await historyLength()).toBe(before);

    // The selected row is tinted (not just hovered): compare with an ordinary row, mouse away.
    await page.mouse.move(0, 0);
    const background = (row: Locator) => row.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(await background(app.settingsRow('Цілі'))).not.toBe(
      await background(app.settingsRow('Нагадування')),
    );
  });

  test('«Прийоми їжі» opens in the pane; a change shows in the row next to it at once', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');
    await app.goto('/settings');
    await app.settingsRow('Прийоми їжі').click();
    await expect(page).toHaveURL(/\/settings\/meals$/);
    await expect(app.settingsRow('Прийоми їжі')).toHaveAttribute('aria-current', 'page');
    const pane = app.region('Прийоми їжі');
    await expect(pane.getByRole('heading', { level: 2, name: 'Прийоми їжі' })).toBeVisible();
    await expect(pane.getByRole('region', { name: 'Мої прийоми їжі' })).toBeVisible();
    await expect(mealNote(page)).toHaveText(MEAL_NOTE_DEFAULTS);
    await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);

    const [list, detail] = [
      await box(page.getByRole('navigation', { name: 'Розділи налаштувань' }), 'list'),
      await box(pane, 'pane'),
    ];
    expect(list.x + list.width).toBeLessThanOrEqual(detail.x);

    const t = mealTypesCard(app);
    await t.input.fill('Після тренування');
    await t.input.press('Enter');
    await expect(app.settingsRow('Прийоми їжі')).toContainText('5 типів');
    await t.edit.click();
    // Edit rows fit the pane: ✕ inside the card.
    const card = await box(t.card, 'card');
    const x = await box(t.remove('Після тренування'), '✕');
    expect(x.x + x.width).toBeLessThanOrEqual(card.x + card.width);

    // «Цілі» shows the macro goals under the steppers, titled below the pane's <h2>.
    await app.settingsRow('Цілі').click();
    const macros = app.region('Цілі: білки, жири, вуглеводи');
    await expect(macros.getByRole('heading', { level: 3, name: 'Б · Ж · В на день' })).toBeVisible();
  });

  test('a deep link to a section selects its row next to it', async ({ app }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');
    await app.gotoSettings('Дані і копія');
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    await expect(app.settingsRow('Дані і копія')).toContainText('Синхронізовано');
    await expect(app.settingsRow('Дані і копія')).toHaveAttribute('aria-current', 'page');
    await expect(app.settingsRow('Нагадування')).not.toHaveAttribute('aria-current');
    // «Вийти» lives in the «Акаунт» pane, not under the list.
    await expect(logoutRow(app.page)).toHaveCount(0);
    await app.settingsRow('Акаунт').click();
    await expect(app.region('Акаунт').getByRole('heading', { level: 2, name: 'Акаунт' })).toBeVisible();
    await expect(app.region('Акаунт').getByRole('button', { name: 'Вийти', exact: true })).toBeVisible();
  });
});

test.describe('reminders & settings', () => {
  test('switches, weekdays and times are saved, survive a reload and drive Home', async ({ app, server }) => {
    await app.gotoSettings('Нагадування');

    // Workout: add Tuesday, move the time.
    const workout = app.region('Тренування');
    const workoutDays = workout.getByRole('group', { name: 'Дні тренувань' });
    await expect(workout).toContainText('Пн, Ср, Пт · 18:00');
    await workoutDays.getByRole('button', { name: 'Вівторок' }).click();
    await expect(workoutDays.getByRole('button', { name: 'Вівторок' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await workout.getByLabel('Час').fill('19:30');
    await expect(workout).toContainText('Пн, Вт, Ср, Пт · 19:30');

    // Weigh-in: Thursday 07:45.
    const weigh = app.region('Контрольне зважування');
    await weigh
      .getByRole('radiogroup', { name: 'День зважування' })
      .getByRole('radio', { name: 'Четвер' })
      .click();
    await expect(weigh).toContainText('Раз на тиждень · четвер');
    await weigh.getByLabel('Час').fill('07:45');

    // Measurements: off.
    const measure = app.region('Заміри тіла');
    const measureSwitch = measure.getByRole('switch', { name: 'Заміри тіла' });
    await expect(measureSwitch).toHaveAttribute('aria-checked', 'true');
    await measureSwitch.click();
    await expect(measureSwitch).toHaveAttribute('aria-checked', 'false');

    const expectSaved = async () => {
      await expect(workoutDays.getByRole('button', { name: 'Вівторок' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(workout.getByLabel('Час')).toHaveValue('19:30');
      await expect(weigh.getByRole('radio', { name: 'Четвер' })).toHaveAttribute('aria-checked', 'true');
      await expect(weigh.getByLabel('Час')).toHaveValue('07:45');
      await expect(weigh.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
      await expect(measureSwitch).toHaveAttribute('aria-checked', 'false');
    };
    await expectSaved();
    await expect
      .poll(async () => (await server.getData()).settings.rem)
      .toEqual({
        workout: { on: true, days: [1, 2, 3, 5], time: '19:30' },
        weigh: { on: true, day: 4, time: '07:45' },
        measure: { on: false, day: 1, time: '08:30' },
      });
    await app.reload();
    await expectSaved();

    // The list sums it up: two of three reminders on.
    await app.go('Налаштування');
    await expect(app.settingsRow('Нагадування')).toContainText('2 увімк.');

    // Home: Thursday is tomorrow; measurements are off; today (Wednesday) is a workout day at 19:30.
    await app.go('Головна');
    await expect(app.homeRow('Вага')).toContainText('Завтра');
    await expect(app.homeRow('Заміри')).toContainText('вимкнено');
    await expect(app.homeRow('Тренування')).toContainText('За планом о 19:30');
  });

  test('goal steppers update the Home hero, Progress and the list', async ({ app, page, server }) => {
    await app.goto('/');
    const hero = app.region('Поточна вага');
    await expect(hero).toContainText('35% шляху');
    await expect(hero).toContainText('до цілі 5,4 кг');

    await app.openSettings('Цілі');
    const goals = app.region('Мої цілі');
    const goal = goals.getByRole('group', { name: 'Цільова вага' });
    const kcal = goals.getByRole('group', { name: 'Калорії на день' });
    await expect(goal.locator('output')).toHaveText('60,0 кг');
    for (let i = 0; i < 3; i++) await goal.getByRole('button', { name: 'Збільшити цільову вагу' }).click();
    await expect(goal.locator('output')).toHaveText('61,5 кг');
    await kcal.getByRole('button', { name: 'Збільшити калорії на день' }).click();
    await kcal.getByRole('button', { name: 'Збільшити калорії на день' }).click();
    await kcal.getByRole('button', { name: 'Зменшити калорії на день' }).click();
    await expect(kcal.locator('output')).toHaveText('1 750 ккал');

    await app.go('Налаштування');
    await expect(app.settingsRow('Цілі')).toContainText('61,5 кг · 1 750 ккал');

    await app.go('Головна');
    await expect(hero).toContainText('до цілі 3,9 кг'); // 65,4 − 61,5
    await expect(hero).toContainText('43% шляху');

    await app.go('Прогрес');
    await expect(app.region('Харчування')).toContainText('ціль 1 750 ккал');
    await expect(app.region('Вага')).toContainText('Ціль 61,5');

    await expect
      .poll(async () => {
        const { goal: g, kcalGoal } = (await server.getData()).settings;
        return { g, kcalGoal };
      })
      .toEqual({ g: 61.5, kcalGoal: 1750 });
    await app.reload();
    await expect(page.getByText('ціль 1 750 ккал')).toBeVisible();
  });

  test('theme switch applies at once and is remembered on the device', async ({ app, page }) => {
    await app.gotoSettings('Вигляд');
    // By role, not by region: the region «Вигляд» is the card on the phone and the pane on desktop.
    const theme = page.getByRole('radiogroup', { name: 'Тема' });
    const html = page.locator('html');
    await expect(page.getByText('Тема на цьому пристрої')).toBeVisible();
    await expect(theme.getByRole('radio', { name: 'Авто' })).toHaveAttribute('aria-checked', 'true');
    await expect(html).not.toHaveAttribute('data-theme');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await theme.getByRole('radio', { name: 'Темна' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .not.toBe(lightBg);
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#12151A');

    await app.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(theme.getByRole('radio', { name: 'Темна' })).toHaveAttribute('aria-checked', 'true');

    await theme.getByRole('radio', { name: 'Світла' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await theme.getByRole('radio', { name: 'Авто' }).click();
    await expect(html).not.toHaveAttribute('data-theme');
    expect(await page.evaluate(() => localStorage.getItem('legko.theme'))).toBeNull();
  });

  test('own workout types: add, reject duplicates, use in the workout sheet, remove', async ({
    app,
    page,
    server,
  }) => {
    await app.gotoSettings('Типи тренувань');
    const types = app.region('Мої тренування');
    await expect(types).toContainText('Типи, які можна вибрати в записі дня');
    const input = types.getByRole('textbox', { name: 'Свій тип тренування' });
    const add = types.getByRole('button', { name: 'Додати', exact: true });
    await expect(add).toBeDisabled();

    await input.fill('Пілатес');
    await add.click();
    await expect(types.getByRole('button', { name: 'Видалити «Пілатес»' })).toBeVisible();
    await expect(input).toHaveValue('');

    await input.fill('кардіо');
    await input.press('Enter');
    await expect(types.getByRole('alert')).toHaveText('«Кардіо» вже є у списку');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('');
    await expect(types.getByRole('alert')).toHaveCount(0);

    await expect.poll(async () => (await server.getData()).settings.customTypes).toEqual(['Пілатес']);

    const sheet = await app.record('Тренування');
    await sheet.getByRole('button', { name: 'Було', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Пілатес', exact: true })).toBeVisible();
    // «Було» is an unsaved change: Escape asks (in the app's own dialog) before closing.
    await page.keyboard.press('Escape');
    await page
      .getByRole('alertdialog', { name: 'Є незбережені зміни' })
      .getByRole('button', { name: 'Закрити', exact: true })
      .click();
    await app.expectSheetClosed();

    await types.getByRole('button', { name: 'Видалити «Пілатес»' }).click();
    await expect(types.getByText('Пілатес')).toHaveCount(0);
    await expect.poll(async () => (await server.getData()).settings.customTypes).toEqual([]);
  });

  test('a goal outside the stepper range moves one ordinary step back, without a jump', async ({
    app,
    server,
  }) => {
    // Older data or a restored backup can hold a goal outside the steppers' 800–5000 kcal / 30–200 kg.
    const data = await server.getData();
    await server.importData({ ...data, settings: { ...data.settings, goal: 25, kcalGoal: 6000 } });
    await app.gotoSettings('Цілі');
    const goals = app.region('Мої цілі');
    const kcal = goals.getByRole('group', { name: 'Калорії на день' });
    const goal = goals.getByRole('group', { name: 'Цільова вага' });
    await expect(kcal.locator('output')).toHaveText('6 000 ккал');
    await expect(kcal.getByRole('button', { name: 'Збільшити калорії на день' })).toBeDisabled();
    await kcal.getByRole('button', { name: 'Зменшити калорії на день' }).click();
    await expect(kcal.locator('output')).toHaveText('5 950 ккал');

    await expect(goal.getByRole('button', { name: 'Зменшити цільову вагу' })).toBeDisabled();
    await goal.getByRole('button', { name: 'Збільшити цільову вагу' }).click();
    await expect(goal.locator('output')).toHaveText('25,5 кг');
    await expect
      .poll(async () => {
        const { goal: g, kcalGoal } = (await server.getData()).settings;
        return { g, kcalGoal };
      })
      .toEqual({ g: 25.5, kcalGoal: 5950 });
  });
});

test.describe('meal types («Прийоми їжі»)', () => {
  const storedTypes = (server: ServerApi) => async () => (await server.getData()).settings.mealTypes;

  test('her list: add, rename, move, delete and restore; every change reaches the server', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/');
    await app.openSettings('Прийоми їжі');
    const t = mealTypesCard(app);
    const stored = storedTypes(server);

    // View mode: her names only, calm — no fields, no ✕ / ↑ / ↓, nothing to restore.
    await expect(t.items).toHaveText(DEFAULT_TYPES);
    await expect(t.card.getByRole('textbox', { name: /^Назва/ })).toHaveCount(0);
    await expect(t.card.getByRole('button', { name: /^(Видалити|Вище|Нижче)/ })).toHaveCount(0);
    await expect(t.restore).toHaveCount(0);
    await expect(t.edit).toHaveAttribute('aria-pressed', 'false');

    // Adding works in view mode too.
    await expect(t.add).toBeDisabled();
    await t.input.fill('Після тренування');
    await t.add.click();
    await expect(t.items).toHaveText([...DEFAULT_TYPES, 'Після тренування']);
    await expect(t.input).toHaveValue('');
    await expect.poll(stored).toEqual([...DEFAULT_TYPES, 'Після тренування']);

    // A duplicate in another case is refused inline.
    await t.input.fill('обід');
    await t.input.press('Enter');
    await expect(t.card.getByRole('alert')).toHaveText('Такий тип уже є');
    await expect(t.input).toHaveAttribute('aria-invalid', 'true');
    await t.input.fill('');
    await expect(t.card.getByRole('alert')).toHaveCount(0);

    // «Змінити» → every row is a field with ↑ ↓ ✕.
    await t.edit.click();
    await expect(t.done).toHaveAttribute('aria-pressed', 'true');
    await expect(t.field('Сніданок')).toHaveValue('Сніданок');

    // Rename with Enter: the field keeps the focus, the row follows the new name.
    await t.field('Перекус').fill('Перекуси');
    await t.field('Перекус').press('Enter');
    await expect(t.field('Перекуси')).toBeFocused();
    await expect(t.status).toHaveText('Перекус → Перекуси');
    await expect.poll(stored).toEqual(['Сніданок', 'Обід', 'Вечеря', 'Перекуси', 'Після тренування']);

    // Move up twice: the focus stays on the moved row's ↑. The ends are aria-disabled, never disabled.
    await t.up('Після тренування').click();
    await expect(t.up('Після тренування')).toBeFocused();
    await t.up('Після тренування').click();
    await expect(t.up('Після тренування')).toBeFocused();
    await expect(t.status).toHaveText('Після тренування — вище');
    await expect.poll(stored).toEqual(['Сніданок', 'Обід', 'Після тренування', 'Вечеря', 'Перекуси']);
    await expect(t.up('Сніданок')).toHaveAttribute('aria-disabled', 'true');
    await expect(t.down('Перекуси')).toHaveAttribute('aria-disabled', 'true');
    // Not natively disabled: it keeps the keyboard focus, and a press does nothing. (Playwright's click waits
    // for an aria-disabled button to become enabled, so the keyboard presses it.)
    await expect(t.down('Перекуси')).not.toHaveAttribute('disabled');
    await t.down('Перекуси').focus();
    await page.keyboard.press('Enter');
    await expect(t.down('Перекуси')).toBeFocused();
    await expect.poll(stored).toEqual(['Сніданок', 'Обід', 'Після тренування', 'Вечеря', 'Перекуси']);

    // ✕ asks nothing (past meals keep their label); the focus moves to the next row's ✕.
    await t.remove('Обід').click();
    await expect(t.remove('Після тренування')).toBeFocused();
    await expect(t.status).toHaveText('Обід видалено');
    await expect.poll(stored).toEqual(['Сніданок', 'Після тренування', 'Вечеря', 'Перекуси']);

    // Two defaults are missing now (Перекус was renamed): they come back at the end.
    await t.restore.click();
    await expect
      .poll(stored)
      .toEqual(['Сніданок', 'Після тренування', 'Вечеря', 'Перекуси', 'Обід', 'Перекус']);
    await expect(t.restore).toHaveCount(0);
    await expect(t.input).toBeFocused();

    await t.done.click();
    const final = ['Сніданок', 'Після тренування', 'Вечеря', 'Перекуси', 'Обід', 'Перекус'];
    await expect(t.items).toHaveText(final);
    await app.reload();
    await expect(t.items).toHaveText(final);
    await app.go('Налаштування');
    await expect(app.settingsRow('Прийоми їжі')).toContainText('6 типів');

    // The meal editor offers her own types.
    const sheet = await app.newMeal();
    await expect(app.mealType(sheet, 'Після тренування')).toBeVisible();
    await expect(app.mealType(sheet, 'Перекуси')).toBeVisible();
  });

  test('Escape in a name field puts the stored name back; a blur saves', async ({ app, page, server }) => {
    await app.gotoSettings('Прийоми їжі');
    const t = mealTypesCard(app);
    await t.edit.click();
    await t.field('Обід').fill('Ланч');
    await page.keyboard.press('Escape');
    await expect(t.field('Обід')).toHaveValue('Обід');
    await expect(t.field('Обід')).toBeFocused();

    await t.field('Обід').fill('Ланч');
    await page.keyboard.press('Tab');
    await expect(t.field('Ланч')).toHaveValue('Ланч');
    await expect.poll(storedTypes(server)).toEqual(['Сніданок', 'Ланч', 'Вечеря', 'Перекус']);
    await expect(t.status).toHaveText('Обід → Ланч');
  });

  test('the note says which type a new meal starts with, for her own list', async ({ app, page }) => {
    await app.gotoSettings('Прийоми їжі');
    await expect(mealNote(page)).toHaveText(MEAL_NOTE_DEFAULTS);
    // toHaveText folds NBSPs into spaces; the raw text keeps each «08:00 — Сніданок» together with NBSPs, so on
    // the phone a line wraps only after «·» and never starts with «—».
    const raw = (await mealNote(page).textContent()) ?? '';
    const nb = String.fromCharCode(0xa0); // NBSP
    expect(raw).toContain(`08:00${nb}—${nb}Сніданок${nb}· 13:00${nb}—${nb}Обід${nb}· `);
    expect(raw).not.toMatch(/ —|— | ·/);

    // Without a snack type, 16:30 keeps the lunch: that time is left out.
    const t = mealTypesCard(app);
    await t.edit.click();
    await t.remove('Перекус').click();
    await expect(mealNote(page)).toHaveText(
      'Тип нового прийому підказується за часом: 08:00 — Сніданок · 13:00 — Обід · 19:00 — Вечеря. ' +
        'Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
    );

    // An empty list is allowed: new meals have no type then.
    for (const name of ['Сніданок', 'Обід', 'Вечеря']) await t.remove(name).click();
    await expect(t.card.getByRole('list')).toHaveCount(0);
    await expect(mealNote(page)).toHaveText(
      'Без типів новий прийом буде без назви. Перейменування не змінює вже записані прийоми.',
    );
    await expect(t.input).toBeFocused();
    await app.go('Налаштування');
    await expect(app.settingsRow('Прийоми їжі')).toContainText('Немає типів');
  });

  test.describe('with meals already logged', () => {
    test.use({ seed: 'meals' });

    test('renaming or deleting a type leaves the logged meals with their own label', async ({
      app,
      server,
    }) => {
      const loggedTypes = async () => (await server.getData()).days[TODAY]?.meals?.map((m) => m.type);
      expect(MEALS_TODAY.map((m) => m.type)).toEqual(['Сніданок', 'Перекус']);
      const before = (await server.getData()).days[TODAY];

      await app.gotoSettings('Прийоми їжі');
      const t = mealTypesCard(app);
      await t.edit.click();
      await t.field('Сніданок').fill('Ранок');
      await t.field('Сніданок').press('Enter');
      await expect.poll(storedTypes(server)).toEqual(['Ранок', 'Обід', 'Вечеря', 'Перекус']);
      await t.remove('Перекус').click();
      await expect.poll(storedTypes(server)).toEqual(['Ранок', 'Обід', 'Вечеря']);

      // The day itself is untouched: same meals, same labels, same derived text.
      expect(await loggedTypes()).toEqual(['Сніданок', 'Перекус']);
      expect((await server.getData()).days[TODAY]).toEqual(before);

      // …and the day's list still names them as she logged them.
      await app.go('Головна');
      const day = await app.openFoodDay();
      await expect(app.mealRow(day, 'Сніданок')).toBeVisible();
      await expect(app.mealRow(day, 'Перекус')).toBeVisible();
    });
  });
});

test.describe('macro goals («Б · Ж · В на день»)', () => {
  test('set on Enter and on blur, cleared with an empty field, a wrong number refused', async ({
    app,
    server,
  }) => {
    await app.goto('/');
    await app.openSettings('Цілі');
    const card = app.region('Цілі: білки, жири, вуглеводи');
    await expect(card.getByRole('heading', { name: 'Б · Ж · В на день' })).toBeVisible();
    await expect(card).toContainText('Порожнє поле — без цілі.');
    const goal = (what: string) =>
      card.getByRole('textbox', { name: `Ціль: ${what}, г на день`, exact: true });
    const [protein, fat, carbs] = [goal('білки'), goal('жири'), goal('вуглеводи')];
    for (const f of [protein, fat, carbs]) {
      await expect(f).toHaveValue('');
      await expect(f).toHaveAttribute('placeholder', '—');
      await expect(f).toHaveAttribute('inputmode', 'numeric');
    }
    const stored = async (): Promise<MacroGoals> => (await server.getData()).settings.macroGoals;

    await protein.fill('90');
    await protein.press('Enter');
    await expect(protein).toBeFocused();
    await expect.poll(stored).toEqual({ protein: 90, fat: null, carbs: null });

    // A tap on the next field saves the one she left.
    await fat.fill('60');
    await carbs.click();
    await expect.poll(stored).toEqual({ protein: 90, fat: 60, carbs: null });

    for (const wrong of ['0', '1001', '12,5']) {
      await carbs.fill(wrong);
      await carbs.press('Enter');
      await expect(card.getByRole('alert'), wrong).toHaveText('Від 1 до 1 000 г');
      await expect(carbs).toHaveAttribute('aria-invalid', 'true');
    }
    await carbs.fill('');
    await expect(card.getByRole('alert')).toHaveCount(0);

    await protein.fill('');
    await protein.press('Enter');
    await expect.poll(stored).toEqual({ protein: null, fat: 60, carbs: null });

    await app.reload();
    await expect(fat).toHaveValue('60');
    await expect(protein).toHaveValue('');
    await expect(carbs).toHaveValue('');
    // The «Цілі» row keeps its weight · kcal summary.
    await app.go('Налаштування');
    await expect(app.settingsRow('Цілі')).toContainText('60 кг · 1 700 ккал');
  });

  test.describe('with goals set', () => {
    test.use({ seed: 'meals' });

    test('shows the stored goals', async ({ app }) => {
      await app.gotoSettings('Цілі');
      const card = app.region('Цілі: білки, жири, вуглеводи');
      await expect(card.getByRole('textbox', { name: 'Ціль: білки, г на день' })).toHaveValue('90');
      await expect(card.getByRole('textbox', { name: 'Ціль: жири, г на день' })).toHaveValue('60');
      await expect(card.getByRole('textbox', { name: 'Ціль: вуглеводи, г на день' })).toHaveValue('');
    });
  });
});

test.describe('settings layout', () => {
  /** Right edge of the card's content box (inside the 18px padding and the 1px border). */
  const innerRight = async (card: Locator) => {
    const b = await box(card, 'card');
    return b.x + b.width - 19;
  };

  const expectStepperInside = async (app: App, at: string) => {
    const goals = app.region('Мої цілі');
    const right = await innerRight(goals);
    for (const name of ['Збільшити цільову вагу', 'Збільшити калорії на день']) {
      const b = await box(goals.getByRole('button', { name }), `«${name}» @${at}`);
      expect(b.x + b.width, `«${name}» @${at}`).toBeLessThanOrEqual(right + 0.5);
    }
  };

  const expectNoSideScroll = async (page: Page, at: string) => {
    const overflow = await page.evaluate(
      () => (document.scrollingElement ?? document.documentElement).scrollWidth - window.innerWidth,
    );
    expect(overflow, `horizontal scroll @${at}`).toBeLessThanOrEqual(0);
  };

  test('on a 320px phone the goal steppers stay inside their card and the panel title on one line', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone widths');
    await page.setViewportSize({ width: 320, height: 700 });
    await app.goto('/settings');
    await expectNoSideScroll(page, '320px list');

    await app.gotoSettings('Цілі');
    await expectStepperInside(app, '320px');
    await expectNoSideScroll(page, '320px goals');

    // iPhone Safari tab: the panel explains the home-screen install.
    await app.gotoSettings('Нагадування');
    await expectNoSideScroll(page, '320px reminders');
    const panel = app.region('Сповіщення на телефон');
    const title = panel.getByRole('heading', { name: 'Сповіщення на телефон' });
    expect(await title.evaluate(lines)).toBe(1);
    await panel.getByRole('button', { name: 'Як?' }).click();
    await expect(app.sheet('Встановлення на iPhone')).toBeVisible();
  });

  test('on a 320px phone the meal type rows and the macro goal fields stay inside their cards', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone widths');
    await page.setViewportSize({ width: 320, height: 700 });
    await app.gotoSettings('Прийоми їжі');
    const t = mealTypesCard(app);
    await t.edit.click();
    await expectNoSideScroll(page, '320px meal types');
    const right = await innerRight(t.card);
    for (const name of DEFAULT_TYPES) {
      const x = await box(t.remove(name), `✕ ${name} @320px`);
      expect(x.x + x.width, `✕ ${name} @320px`).toBeLessThanOrEqual(right + 0.5);
      // Every control keeps its 44px target.
      expect(x.height).toBeGreaterThanOrEqual(44);
      expect((await box(t.up(name), `↑ ${name}`)).width).toBeGreaterThanOrEqual(44);
      // The field is narrow there but still a usable field (it scrolls a long name).
      expect((await box(t.field(name), `field ${name}`)).width).toBeGreaterThanOrEqual(80);
    }

    await app.gotoSettings('Цілі');
    await expectNoSideScroll(page, '320px goals');
    const macros = app.region('Цілі: білки, жири, вуглеводи');
    const macrosRight = await innerRight(macros);
    for (const what of ['білки', 'жири', 'вуглеводи']) {
      const f = await box(macros.getByRole('textbox', { name: `Ціль: ${what}, г на день` }), what);
      expect(f.x + f.width, `${what} @320px`).toBeLessThanOrEqual(macrosRight + 0.5);
      expect(f.height).toBeGreaterThanOrEqual(44);
    }
  });

  test('on her iPhone (390px) the panel keeps the prototype row: title on one line, «Як?» beside it', async ({
    app,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone widths');
    await app.gotoSettings('Нагадування');
    const panel = app.region('Сповіщення на телефон');
    const title = panel.getByRole('heading', { name: 'Сповіщення на телефон' });
    const cta = panel.getByRole('button', { name: 'Як?' });
    expect(await title.evaluate(lines)).toBe(1);
    const [titleBox, ctaBox] = [await box(title, 'panel title'), await box(cta, '«Як?»')];
    expect(ctaBox.x).toBeGreaterThan(titleBox.x + titleBox.width);

    await app.gotoSettings('Цілі');
    await expectStepperInside(app, '390px');
  });

  test('in a narrow desktop window the goal steppers stay inside their column', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');
    for (const width of [900, 960, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await app.gotoSettings('Цілі');
      await expect(app.settingsRow('Цілі')).toBeVisible();
      await expectStepperInside(app, `${width}px`);
      await expectNoSideScroll(page, `${width}px`);
    }
  });
});
