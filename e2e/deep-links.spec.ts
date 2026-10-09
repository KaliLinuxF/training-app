import { PASSWORD } from './support/env';
import { expect, test } from './support/test';

/** Push notification deep links (DEEP_LINKS in @legko/shared) open a sheet for today and clean the URL. */
test.describe('deep links', () => {
  test('/?sheet=weight opens the weigh-in for today', async ({ app, page }) => {
    await app.goto('/?sheet=weight');
    const sheet = app.sheet('Контрольне зважування');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('14 жовтня 2026');
    await expect(page).toHaveURL(/\/$/);
    await expect(app.heading('Головна')).toBeVisible();
  });

  test('/?sheet=measure opens the measurements for today', async ({ app, page }) => {
    await app.goto('/?sheet=measure');
    await expect(app.sheet('Заміри тіла')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('/?sheet=day&trained=1 opens the day record with «Було» pre-selected', async ({ app, page }) => {
    await app.goto('/?sheet=day&trained=1');
    const sheet = app.sheet('Запис дня');
    await expect(sheet.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(sheet.getByRole('button', { name: 'Верх тіла', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await app.goto('/?sheet=day');
    await expect(app.sheet('Запис дня').getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
  });

  test('unknown sheets are ignored and other query params are kept', async ({ app, page }) => {
    await app.goto('/?sheet=bogus');
    await expect(page).toHaveURL(/\/$/);
    await expect(app.dialogs).toHaveCount(0);

    await app.goto('/calendar?date=2026-10-07&sheet=weight');
    const sheet = app.sheet('Контрольне зважування');
    await expect(sheet).toContainText('14 жовтня 2026');
    await expect(page).toHaveURL(/\/calendar\?date=2026-10-07$/);
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    await expect(app.region('7 жовтня 2026')).toBeVisible();
  });

  test('a notification tap while the app is open (SW «navigate» message) opens the linked sheet', async ({
    app,
    page,
  }) => {
    await app.goto('/calendar');
    // What pwa/register.ts does with the service worker's message: wouter `navigate()` → pushState.
    await page.evaluate(() => history.pushState(null, '', '/?sheet=measure'));
    await expect(app.sheet('Заміри тіла')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);
  });

  test('a notification tap while a draft is open asks before dropping it', async ({ app, page }) => {
    await app.goto('/');
    await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
    const day = app.sheet('Запис дня');
    const food = day.getByRole('textbox', { name: 'Що я їла' });
    await food.fill('Вівсянка з бананом, кава, борщ — ще пишу…');

    // The in-app question (not a native confirm); «Залишитись» keeps the draft.
    const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    await page.evaluate(() => history.pushState(null, '', '/?sheet=day&trained=1'));
    await expect(page).toHaveURL(/\/$/);
    await expect(ask).toContainText('Закрити без збереження?');
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(ask).toBeHidden();
    await expect(food).toHaveValue('Вівсянка з бананом, кава, борщ — ще пишу…');

    // Agreeing opens the linked sheet; the draft is gone.
    await page.evaluate(() => history.pushState(null, '', '/?sheet=weight'));
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
    await expect(app.sheet('Контрольне зважування')).toBeVisible();
    await expect(app.sheet('Запис дня')).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test('a notification tap over an untouched sheet just opens the linked one', async ({ app, page }) => {
    await app.goto('/');
    await app.quickAction('Заміри').click();
    await expect(app.sheet('Заміри тіла')).toBeVisible();
    await page.evaluate(() => history.pushState(null, '', '/?sheet=weight'));
    await expect(app.sheet('Контрольне зважування')).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test.describe('brand-new account', () => {
    test.use({ seed: 'empty' });

    test('the linked sheet goes first, the first-run setup follows when it closes', async ({ app }) => {
      await app.goto('/?sheet=weight');
      const weigh = app.sheet('Контрольне зважування');
      await expect(weigh).toBeVisible();
      await expect(app.sheet('Налаштування')).toHaveCount(0);
      await weigh.getByRole('button', { name: 'Закрити' }).click();
      await expect(app.sheet('Налаштування')).toBeVisible();
    });
  });

  test.describe('after the session expired', () => {
    test.use({ authed: false });

    test('the link survives the login screen and opens once she is in', async ({ app, page }) => {
      await page.goto('/?sheet=measure');
      await page.getByLabel('Пароль', { exact: true }).fill(PASSWORD);
      await page.getByRole('button', { name: 'Увійти' }).click();
      await app.ready();
      await expect(app.sheet('Заміри тіла')).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
    });
  });
});
