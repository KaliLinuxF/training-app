import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test';

const monthTitle = (page: Page) => page.getByRole('heading', { level: 2, name: /^\S+ 2026$/ });
/** The month grid (`role=group` named by the month title). */
const grid = (page: Page) => page.getByRole('group', { name: /^\S+ 2026$/ });
/** The header shortcut back to today (exact: day cells contain «сьогодні» too). */
const todayShortcut = (page: Page) => page.getByRole('button', { name: 'Сьогодні', exact: true });
/** A row of the day card; its short name starts with the row title («Вага: 65,7 кг»). */
const row = (day: Locator, title: 'Їжа' | 'Тренування' | 'Вага' | 'Заміри' | 'Нотатки') =>
  day.getByRole('button', { name: new RegExp(`^${title}`) });

const OCT13_FOOD = 'Тост з авокадо, салат з куркою, індичка з броколі';
const NOTES = 'Гарне самопочуття, випила 2 л води';

test.describe('calendar', () => {
  test('month navigation: back and forth, no future months, picking a day', async ({ app, page }) => {
    await app.goto('/calendar');
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    const prevMonth = page.getByRole('button', { name: 'Попередній місяць' });
    const nextMonth = page.getByRole('button', { name: 'Наступний місяць' });
    await expect(nextMonth).toBeDisabled();
    await expect(todayShortcut(page)).toBeHidden();
    await expect(page.getByText('Останні записи')).toHaveCount(0);

    const today = grid(page).getByRole('button', { name: /^14 жовтня, сьогодні/ });
    await expect(today).toHaveAttribute('aria-current', 'date');
    await expect(today).toHaveAttribute('aria-pressed', 'true');
    // Marks: fill for food / workout, a dot for weigh-in or measurements.
    await expect(
      grid(page).getByRole('button', { name: '5 жовтня, вага або заміри', exact: true }),
    ).toBeVisible();
    await expect(
      grid(page).getByRole('button', {
        name: '12 жовтня, тренування, їжа, вага або заміри',
        exact: true,
      }),
    ).toBeVisible();
    await expect(grid(page).getByRole('button', { name: '8 жовтня', exact: true })).toBeVisible();
    // Future days are not buttons.
    await expect(grid(page).getByRole('button', { name: /^15 жовтня/ })).toHaveCount(0);
    await expect(app.region('14 жовтня 2026')).toContainText('середа · сьогодні');
    // Legend wording: «Їжа».
    const monthCard = app.region('Жовтень 2026');
    await expect(monthCard).toContainText('Їжа');
    await expect(monthCard).not.toContainText('Харчування');

    // ‹ › only move the shown month (prototype `prevMonth` / `nextMonth`): the selected day,
    // its card and the URL stay; no cell is highlighted in a month without the selection.
    await prevMonth.click();
    await expect(monthTitle(page)).toHaveText('Вересень 2026');
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(app.region('14 жовтня 2026')).toContainText('середа · сьогодні');
    await expect(grid(page).locator('button[aria-pressed="true"]')).toHaveCount(0);
    await expect(nextMonth).toBeEnabled();

    await grid(page)
      .getByRole('button', { name: /^14 вересня/ })
      .click();
    await expect(page).toHaveURL(/\/calendar\?date=2026-09-14$/);
    await expect(app.region('14 вересня 2026')).toContainText('Верх тіла, Прес');

    await prevMonth.click();
    await expect(monthTitle(page)).toHaveText('Серпень 2026');
    await expect(app.region('14 вересня 2026')).toBeVisible();
    await grid(page)
      .getByRole('button', { name: /^3 серпня/ })
      .click();
    await expect(page).toHaveURL(/date=2026-08-03$/);
    const aug3 = app.region('3 серпня 2026');
    await expect(aug3).toContainText('понеділок');
    await expect(row(aug3, 'Вага')).toHaveAccessibleName('Вага: 68,3 кг');
    await expect(aug3).toContainText('Груди 93 · Талія 74,5 · Стегна 101');
    await expect(row(aug3, 'Заміри')).toHaveAccessibleName('Заміри: груди 93, талія 74,5, стегна 101');
    await expect(aug3).toContainText('1 700 ккал');

    await nextMonth.click();
    await nextMonth.click();
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(nextMonth).toBeDisabled();
    // Still 3 August: browsing never re-selects a day.
    await expect(page).toHaveURL(/date=2026-08-03$/);
    await expect(aug3).toBeVisible();
    await expect(grid(page).locator('button[aria-pressed="true"]')).toHaveCount(0);
  });

  test('?date= deep link selects the day; invalid or future dates fall back to today', async ({
    app,
    page,
  }) => {
    await app.goto('/calendar?date=2026-10-07');
    const day = app.region('7 жовтня 2026');
    await expect(day).toContainText('середа');
    await expect(day).toContainText('Заповнено');
    await expect(day).toContainText('Омлет, борщ, курка з рисом, кефір');
    await expect(day).toContainText('1 880 ккал');
    await expect(day).toContainText('Низ тіла, Прес');
    await expect(day).not.toContainText('—');
    // Short spoken names; the food text is the row's description.
    await expect(row(day, 'Їжа')).toHaveAccessibleName('Їжа: 1 880 ккал, більше цілі');
    await expect(row(day, 'Їжа')).toHaveAccessibleDescription('Омлет, борщ, курка з рисом, кефір');
    await expect(row(day, 'Тренування')).toHaveAccessibleName('Тренування: було, Низ тіла, Прес');
    await expect(grid(page).getByRole('button', { name: /^7 жовтня/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // «Редагувати день» opens that day (not today).
    await day.getByRole('button', { name: 'Редагувати день' }).click();
    const sheet = app.sheet('Запис дня');
    await expect(sheet).toContainText('7 жовтня 2026');
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('1880');
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    // A day without a record, but with a weigh-in and measurements.
    await app.goto('/calendar?date=2026-10-05');
    const oct5 = app.region('5 жовтня 2026');
    await expect(oct5).toContainText('Порожньо');
    await expect(row(oct5, 'Вага')).toHaveAccessibleName('Вага: 65,7 кг');
    await expect(row(oct5, 'Їжа')).toHaveAccessibleName('Їжа: додати');
    await expect(oct5.getByRole('button', { name: 'Заповнити день' })).toBeVisible();

    for (const bad of ['2026-12-01', '2026-02-30', 'yesterday']) {
      await app.goto(`/calendar?date=${bad}`);
      await expect(app.region('14 жовтня 2026')).toBeVisible();
      await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    }
  });

  test('«Сьогодні» comes back to today from another day or another month', async ({ app, page }) => {
    await app.goto('/calendar');
    await expect(todayShortcut(page)).toBeHidden();

    await grid(page)
      .getByRole('button', { name: /^5 жовтня/ })
      .click();
    await expect(page).toHaveURL(/date=2026-10-05$/);
    await page.getByRole('button', { name: 'Попередній місяць' }).click();
    await expect(monthTitle(page)).toHaveText('Вересень 2026');
    await todayShortcut(page).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(app.region('14 жовтня 2026')).toBeVisible();
    await expect(grid(page).getByRole('button', { name: /^14 жовтня/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(todayShortcut(page)).toBeHidden();

    // Browsing alone (today still selected) shows it too.
    await page.getByRole('button', { name: 'Попередній місяць' }).click();
    await expect(todayShortcut(page)).toBeVisible();
    await todayShortcut(page).click();
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(todayShortcut(page)).toBeHidden();
  });

  test('keyboard: focus never falls to <body> when «Сьогодні» hides or › turns disabled', async ({
    app,
    page,
  }) => {
    await app.goto('/calendar?date=2026-10-05');
    // «Сьогодні» hides itself once pressed: today's cell takes its focus.
    await todayShortcut(page).focus();
    await page.keyboard.press('Enter');
    await expect(todayShortcut(page)).toBeHidden();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(grid(page).getByRole('button', { name: /^14 жовтня/ })).toBeFocused();

    // › into the current month turns disabled: ‹ takes its focus.
    const prevMonth = page.getByRole('button', { name: 'Попередній місяць' });
    const nextMonth = page.getByRole('button', { name: 'Наступний місяць' });
    await prevMonth.click();
    await expect(monthTitle(page)).toHaveText('Вересень 2026');
    await nextMonth.focus();
    await page.keyboard.press('Enter');
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(nextMonth).toBeDisabled();
    await expect(prevMonth).toBeFocused();
  });

  test('day rows open their short sheets for that date; closing returns focus to the row', async ({
    app,
    page,
  }) => {
    await app.goto('/calendar?date=2026-10-05');
    const oct5 = app.region('5 жовтня 2026');
    // Every row (and the footer) announces the dialog it opens, like Home's rows; the inline ✓ / ✕ do not.
    for (const title of ['Їжа', 'Тренування', 'Вага', 'Заміри'] as const) {
      await expect(row(oct5, title)).toHaveAttribute('aria-haspopup', 'dialog');
    }
    await expect(oct5.getByRole('button', { name: 'Заповнити день' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
    for (const name of ['Було', 'Не було']) {
      await expect(oct5.getByRole('button', { name, exact: true })).not.toHaveAttribute('aria-haspopup');
    }
    await row(oct5, 'Вага').click();
    const weight = app.sheet('Контрольне зважування');
    await expect(weight).toContainText('5 жовтня 2026');
    await expect(weight.getByRole('textbox', { name: 'Вага', exact: true })).toHaveValue('65,7');
    await weight.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await expect(row(oct5, 'Вага')).toBeFocused();

    await app.goto('/calendar?date=2026-10-13');
    const oct13 = app.region('13 жовтня 2026');
    await expect(row(oct13, 'Заміри')).toHaveAccessibleName('Заміри: додати');
    await expect(row(oct13, 'Заміри')).toContainText('Додати');
    await row(oct13, 'Заміри').click();
    const measure = app.sheet('Заміри тіла');
    await expect(measure).toContainText('13 жовтня 2026');
    await measure.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    // The food text and the notes stay audible as the rows' descriptions.
    await expect(row(oct13, 'Їжа')).toHaveAccessibleDescription(OCT13_FOOD);
    await expect(row(oct13, 'Нотатки')).toHaveAccessibleName('Нотатки');
    await expect(row(oct13, 'Нотатки')).toHaveAccessibleDescription(NOTES);

    for (const [title, name] of [
      ['Їжа', 'Їжа'],
      ['Тренування', 'Тренування'],
    ] as const) {
      await row(oct13, title).click();
      const sheet = app.sheet(name);
      await expect(sheet).toContainText('13 жовтня 2026');
      await sheet.getByRole('button', { name: 'Закрити' }).click();
      await app.expectSheetClosed();
      await expect(row(oct13, title)).toBeFocused();
    }
    await expect(page).toHaveURL(/date=2026-10-13$/);
  });

  test('the inline ✕ marks a past day without a sheet and survives a reload', async ({ app, server }) => {
    await app.goto('/calendar?date=2026-10-13');
    const oct13 = app.region('13 жовтня 2026');
    const toggle = oct13.getByRole('group', { name: 'Тренування за день' });
    const yes = toggle.getByRole('button', { name: 'Було', exact: true });
    const no = toggle.getByRole('button', { name: 'Не було', exact: true });
    await expect(yes).toHaveAttribute('aria-pressed', 'true');
    await expect(row(oct13, 'Тренування')).toHaveAccessibleName('Тренування: було, Кардіо');

    await no.click();
    await expect(app.toast('Відмічено: без тренування')).toBeVisible();
    await expect(no).toHaveAttribute('aria-pressed', 'true');
    await expect(yes).toHaveAttribute('aria-pressed', 'false');
    await expect(app.dialogs).toHaveCount(0);
    await expect(row(oct13, 'Тренування')).toHaveAccessibleName('Тренування: не було');
    await expect
      .poll(async () => (await server.getData()).days['2026-10-13'])
      .toMatchObject({ trained: false, types: [], food: OCT13_FOOD, kcal: 1740, notes: NOTES });

    await app.reload();
    await expect(no).toHaveAttribute('aria-pressed', 'true');
    await expect(row(oct13, 'Тренування')).toHaveAccessibleName('Тренування: не було');
  });

  test('installed iPhone: a tapped day scrolls into view above the tab bar', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone viewport with the floating tab bar');
    // The installed app's viewport: 844 minus the status bar and home indicator.
    await page.setViewportSize({ width: 390, height: 763 });
    await app.goto('/calendar');

    for (const { cell, title, notes } of [
      { cell: /^12 жовтня/, title: '12 жовтня 2026', notes: null },
      { cell: /^13 жовтня/, title: '13 жовтня 2026', notes: NOTES },
    ]) {
      await grid(page).getByRole('button', { name: cell }).click();
      const day = app.region(title);
      const edit = day.getByRole('button', { name: 'Редагувати день' });
      // After the (smooth, unless reduced) scroll settles, the whole card sits above the tab bar.
      await expect
        .poll(async () => {
          const [button, bar] = await Promise.all([edit.boundingBox(), app.nav.boundingBox()]);
          return button && bar ? bar.y - (button.y + button.height) : -1;
        })
        .toBeGreaterThanOrEqual(0);
      await expect(day.getByRole('heading', { name: title })).toBeInViewport();
      if (notes) await expect(day).toContainText(notes);
      await expect(day).not.toContainText('—');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
  });

  test('a brand-new account: the empty day offers «Додати» and the inline mark', async ({
    app,
    page,
    server,
  }) => {
    await server.importData({ ...(await server.getData()), days: {}, weights: [], measures: [], foods: [] });
    await app.goto('/calendar');
    const day = app.region('14 жовтня 2026');
    await expect(day).toContainText('Порожньо');
    for (const name of ['Їжа: додати', 'Вага: додати', 'Заміри: додати', 'Тренування: не відмічено']) {
      await expect(day.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(day).toContainText('Ще не відмічено');
    await expect(day.getByRole('button', { name: 'Було', exact: true })).toBeVisible();
    await expect(day.getByRole('button', { name: 'Не було', exact: true })).toBeVisible();
    await expect(day.getByRole('button', { name: /^Нотатки/ })).toHaveCount(0);
    await expect(day).not.toContainText('—');
    await expect(grid(page).getByRole('button', { name: '12 жовтня', exact: true })).toBeVisible();

    await day.getByRole('button', { name: 'Заповнити день' }).click();
    await expect(app.sheet('Запис дня')).toContainText('14 жовтня 2026');
  });
});
