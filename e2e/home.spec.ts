import type { Page } from '@playwright/test';
import { expect, test } from './support/test';

const controlRow = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..');
const weekTile = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..');

test.describe('home', () => {
  test('shows weight progress, today, this week, measurements and the next control dates', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    await expect(page.getByText('Середа, 14 жовтня', { exact: true })).toBeVisible();
    await expect(app.heading('Головна')).toHaveText('Доброго ранку');

    const hero = app.region('Поточна вага');
    await expect(hero).toContainText('65,4кг');
    await expect(hero).toContainText('−2,9 кг');
    await expect(hero).toContainText('Старт 68,3');
    await expect(hero).toContainText('35% шляху');
    await expect(hero).toContainText('Ціль 60,0');
    await expect(hero).toContainText('Втрачено2,9 кг');
    await expect(hero).toContainText('До цілі5,4 кг');

    const today = app.region('Сьогодні');
    await expect(today).toContainText('ХарчуванняЗаписано');
    await expect(today).toContainText('Калорії—');

    await expect(weekTile(page, 'Тренувань')).toContainText('2 з 3');
    await expect(weekTile(page, 'Сер. калорії')).toContainText('1 795 ккал');
    await expect(weekTile(page, 'Зміна ваги')).toContainText('−0,3 кг');
    await expect(weekTile(page, 'Талія').first()).toContainText('−0,5 см');

    const measures = app.region('Поточні заміри');
    await expect(measures).toContainText('12 жовтня');
    await expect(measures).toContainText('Груди90−3 см');
    await expect(measures).toContainText('Талія70−4,5 см');
    await expect(measures).toContainText('Стегна98−3 см');

    await expect(controlRow(page, 'Останнє зважування')).toContainText('12 жовтня — 65,4 кг');
    await expect(controlRow(page, 'Наступне зважування')).toContainText('Пн, 19 жовтня · 08:00');
    await expect(controlRow(page, 'Наступні заміри')).toContainText('Пн, 19 жовтня · 08:30');

    // Wednesday is a planned workout day and today is not marked yet.
    await expect(page.getByText('Тренування за планом')).toBeVisible();
    await page.getByRole('button', { name: 'Відмітити' }).click();
    await expect(app.sheet('Запис дня').getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  test('the «Харчування» / «Калорії» tiles open today', async ({ app }) => {
    await app.goto('/');
    await app
      .region('Сьогодні')
      .getByRole('button', { name: /^Калорії/ })
      .click();
    await expect(app.sheet('Запис дня')).toContainText('середа · сьогодні');
    await app.sheet('Запис дня').getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await app
      .region('Сьогодні')
      .getByRole('button', { name: /^Харчування/ })
      .click();
    await expect(app.sheet('Запис дня')).toBeVisible();
  });

  test('a weigh-in day shows the reminder banner until the weight is recorded', async ({
    app,
    page,
    server,
  }) => {
    const data = await server.getData();
    // Make today (Wednesday) the weigh-in day.
    data.settings.rem.weigh = { on: true, day: 3, time: '09:00' };
    await server.importData(data);
    await app.goto('/');
    await expect(page.getByText('Контрольне зважування', { exact: true })).toBeVisible();
    await expect(page.getByText('Сьогодні о 09:00')).toBeVisible();
    await expect(controlRow(page, 'Наступне зважування')).toContainText('Сьогодні · 09:00');

    await page.getByRole('button', { name: 'Записати', exact: true }).click();
    const sheet = app.sheet('Контрольне зважування');
    await sheet.getByRole('textbox', { name: 'Вага', exact: true }).fill('65,0');
    await app.save(sheet);
    await expect(page.getByText('Сьогодні о 09:00')).toBeHidden();
    await expect(controlRow(page, 'Наступне зважування')).toContainText('Ср, 21 жовтня · 09:00');
    await expect(controlRow(page, 'Останнє зважування')).toContainText('14 жовтня — 65,0 кг');
  });

  test('rolls over to the next day at midnight while the app stays open', async ({ app, page }) => {
    await app.goto('/');
    await expect(page.getByText('Середа, 14 жовтня', { exact: true })).toBeVisible();
    await page.clock.setSystemTime(new Date('2026-10-14T23:59:30+03:00'));
    // `useToday` re-checks the date every minute.
    await page.clock.fastForward(61_000);
    await expect(page.getByText('Четвер, 15 жовтня', { exact: true })).toBeVisible();
    await expect(app.region('Сьогодні')).toContainText('ХарчуванняНе записано');

    await app.recordButton().click();
    await expect(app.sheet('Запис дня')).toContainText('четвер · сьогодні');
  });
});

test.describe('iPhone install hint', () => {
  test('«Як?» explains the install; «Сховати» hides it for good on this device', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'shown only in iPhone Safari');
    await app.goto('/');
    await expect(page.getByText('Встанови Легко на iPhone')).toBeVisible();
    await page.getByRole('button', { name: 'Як?' }).click();
    const sheet = app.sheet('Встановлення на iPhone');
    await expect(sheet).toContainText('fit.triple-a.dev');
    await expect(sheet.getByRole('listitem')).toHaveCount(4);
    await sheet.getByRole('button', { name: 'Зрозуміло' }).click();
    await app.expectSheetClosed();

    await page.getByRole('button', { name: 'Сховати' }).click();
    await expect(page.getByText('Встанови Легко на iPhone')).toBeHidden();
    await app.reload();
    await expect(page.getByText('Встанови Легко на iPhone')).toBeHidden();
  });

  test('is not shown on desktop', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await app.goto('/');
    await expect(page.getByText('Тренування за планом')).toBeVisible();
    await expect(page.getByText('Встанови Легко на iPhone')).toHaveCount(0);
  });
});
