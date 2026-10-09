import type { Page } from '@playwright/test';
import { expect, test } from './support/test';

const monthTitle = (page: Page) => page.getByRole('heading', { level: 2, name: /^\S+ 2026$/ });
/** The month grid (`role=group` named by the month title). */
const grid = (page: Page) => page.getByRole('group', { name: /^\S+ 2026$/ });
const history = (page: Page) =>
  page.locator('section').filter({ has: page.getByRole('heading', { name: 'Останні записи' }) });

test.describe('calendar', () => {
  test('month navigation: back and forth, no future months, picking a day', async ({ app, page }) => {
    await app.goto('/calendar');
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    const prevMonth = page.getByRole('button', { name: 'Попередній місяць' });
    const nextMonth = page.getByRole('button', { name: 'Наступний місяць' });
    await expect(nextMonth).toBeDisabled();

    const today = grid(page).getByRole('button', { name: /^14 жовтня, сьогодні/ });
    await expect(today).toHaveAttribute('aria-current', 'date');
    await expect(today).toHaveAttribute('aria-pressed', 'true');
    // Marks: fill for food / workout, a dot for weigh-in or measurements.
    await expect(
      grid(page).getByRole('button', { name: '5 жовтня, вага або заміри', exact: true }),
    ).toBeVisible();
    await expect(
      grid(page).getByRole('button', {
        name: '12 жовтня, тренування, харчування, вага або заміри',
        exact: true,
      }),
    ).toBeVisible();
    await expect(grid(page).getByRole('button', { name: '8 жовтня', exact: true })).toBeVisible();
    // Future days are not buttons.
    await expect(grid(page).getByRole('button', { name: /^15 жовтня/ })).toHaveCount(0);
    await expect(app.region('14 жовтня 2026')).toContainText('середа · сьогодні');

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
    await expect(app.region('14 вересня 2026')).toContainText('✓ Верх тіла, Прес');

    await prevMonth.click();
    await expect(monthTitle(page)).toHaveText('Серпень 2026');
    await expect(app.region('14 вересня 2026')).toBeVisible();
    await grid(page)
      .getByRole('button', { name: /^3 серпня/ })
      .click();
    await expect(page).toHaveURL(/date=2026-08-03$/);
    const aug3 = app.region('3 серпня 2026');
    await expect(aug3).toContainText('понеділок');
    await expect(aug3).toContainText('68,3 кг');
    await expect(aug3).toContainText('Груди 93 · Талія 74,5 · Стегна 101');
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
    await expect(day).toContainText('✓ Низ тіла, Прес');
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

    // A day without a record, but with a weigh-in.
    await app.goto('/calendar?date=2026-10-05');
    const oct5 = app.region('5 жовтня 2026');
    await expect(oct5).toContainText('Порожньо');
    await expect(oct5).toContainText('65,7 кг');
    await expect(oct5.getByRole('button', { name: 'Заповнити день' })).toBeVisible();

    for (const bad of ['2026-12-01', '2026-02-30', 'yesterday']) {
      await app.goto(`/calendar?date=${bad}`);
      await expect(app.region('14 жовтня 2026')).toBeVisible();
      await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    }
  });

  test('«Останні записи» pages with «Показати ще» and opens a day', async ({ app, page }) => {
    await app.goto('/calendar');
    const list = history(page);
    const rows = list.getByRole('listitem');
    await expect(rows).toHaveCount(8);
    await expect(rows.first()).toContainText('14');
    await expect(rows.first()).toContainText('Калорії не вказані');
    await expect(rows.nth(1)).toContainText('1 740 ккал');
    await expect(rows.nth(1)).toContainText('Кардіо');

    await list.getByRole('button', { name: 'Показати ще' }).click();
    await expect(rows).toHaveCount(16);
    await list.getByRole('button', { name: 'Показати ще' }).click();
    await expect(rows).toHaveCount(24);

    // Screen-reader names are one lower-case sentence (her own words stay as typed).
    await expect(rows.first().getByRole('button')).toHaveAccessibleName(
      '14 жовтня, калорії не вказані, Вівсянка з бананом, кава, тренування не відмічене',
    );
    await expect(rows.nth(1).getByRole('button')).toHaveAccessibleName(
      /^13 жовтня, 1\s740 ккал, .+, тренування: Кардіо/,
    );

    // A history row selects that day and shows its month, even after browsing elsewhere.
    await page.getByRole('button', { name: 'Попередній місяць' }).click();
    await expect(monthTitle(page)).toHaveText('Вересень 2026');
    await rows.nth(1).getByRole('button').click();
    await expect(page).toHaveURL(/date=2026-10-13$/);
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(grid(page).getByRole('button', { name: /^13 жовтня/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(app.region('13 жовтня 2026')).toContainText('Гарне самопочуття, випила 2 л води');
  });

  test('a brand-new account shows the empty history hint', async ({ app, page, server }) => {
    await server.importData({ ...(await server.getData()), days: {}, weights: [], measures: [], foods: [] });
    await app.goto('/calendar');
    await expect(history(page)).toContainText('Записів поки немає');
    await expect(app.region('14 жовтня 2026')).toContainText('Порожньо');
  });
});
