import type { Locator, Page } from '@playwright/test';
import { SETTINGS_SLUGS, type App, type SettingsSection } from './support/app';
import { expect, test } from './support/test';

const SECTIONS = Object.keys(SETTINGS_SLUGS) as SettingsSection[];

/** The «Вийти» row (only touched while no dialog is open: the logout dialog has its own «Вийти»). */
const logoutRow = (page: Page) => page.getByRole('button', { name: 'Вийти', exact: true });

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
  test('on the phone the whole list fits one screen, right under the header', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout');
    // 844: the Playwright iPhone; 763: the installed app's web view on an iPhone 14 (status bar, no URL bar).
    for (const height of [844, 763]) {
      await page.setViewportSize({ width: 390, height });
      await app.goto('/settings');
      const at = `390×${height}`;
      // The worst case: an iPhone Safari tab shows the install badge, the tallest row.
      await expect(app.settingsRow('Нагадування')).toContainText('Потрібне встановлення');

      const bar = await box(app.nav, `tab bar @${at}`);
      for (const [name, row] of [
        ...SECTIONS.map((title) => [title, app.settingsRow(title)] as const),
        ['Вийти', logoutRow(page)] as const,
      ]) {
        const b = await box(row, `«${name}» @${at}`);
        expect(b.y, `«${name}» top @${at}`).toBeGreaterThanOrEqual(0);
        expect(b.y + b.height, `«${name}» above the tab bar @${at}`).toBeLessThanOrEqual(bar.y);
      }
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
  });

  test('each row sums up its section', async ({ app }) => {
    await app.goto('/');
    await app.go('Налаштування');
    await expect(app.settingsRow('Нагадування')).toContainText('3 увімк.');
    await expect(app.settingsRow('Цілі')).toContainText('60 кг · 1 700 ккал');
    await expect(app.settingsRow('Типи тренувань')).toContainText('7 типів');
    await expect(app.settingsRow('Вигляд')).toContainText('Авто');
    await expect(app.settingsRow('Дані і копія')).toContainText('Синхронізовано');
    await expect(logoutRow(app.page)).toBeVisible();
    await expect(app.page.getByText('Легко · трекер схуднення')).toBeVisible();
  });

  test('cancelling the logout dialog gives the focus back to «Вийти»', async ({ app, page }) => {
    await app.goto('/settings');
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
    await expect(app.heading('Налаштування')).toBeVisible();
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

  test('a deep link to a section selects its row next to it', async ({ app }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');
    await app.gotoSettings('Дані і копія');
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    await expect(app.settingsRow('Дані і копія')).toContainText('Синхронізовано');
    await expect(app.settingsRow('Дані і копія')).toHaveAttribute('aria-current', 'page');
    await expect(app.settingsRow('Нагадування')).not.toHaveAttribute('aria-current');
    await expect(logoutRow(app.page)).toBeVisible();
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
