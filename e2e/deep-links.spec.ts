import { USERNAME_LABEL } from './support/app';
import { USERNAME } from './support/env';
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

  test('/?sheet=day&trained=1 (the workout push) opens «Тренування» with «Було» pre-selected', async ({
    app,
    page,
  }) => {
    await app.goto('/?sheet=day&trained=1');
    const sheet = app.sheet('Тренування');
    await expect(sheet.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(sheet.getByRole('button', { name: 'Верх тіла', exact: true })).toBeVisible();
    await expect(sheet).toContainText('14 жовтня 2026');
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });

  test('/?sheet=day opens the full day, /?sheet=food the day’s meals «Їжа», /?sheet=workout «Тренування»', async ({
    app,
    page,
  }) => {
    await app.goto('/?sheet=day');
    const day = app.sheet('Запис дня');
    await expect(day.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(app.mealRow(day, 'Їжа за день')).toBeVisible();
    await expect(page).toHaveURL(/\/$/);

    await app.goto('/?sheet=food');
    const food = app.sheet('Їжа');
    await expect(food.getByRole('region', { name: 'Підсумок дня', exact: true })).toBeVisible();
    await expect(app.mealRow(food, 'Їжа за день')).toHaveAccessibleName(
      /^Їжа за день: вівсянка з бананом, кава$/,
    );
    await expect(food.getByRole('textbox')).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);

    await app.goto('/?sheet=workout');
    await expect(app.sheet('Тренування').getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(page).toHaveURL(/\/$/);
  });

  test('the menu is not linkable', async ({ app, page }) => {
    await app.goto('/?sheet=menu');
    await expect(page).toHaveURL(/\/$/);
    await expect(app.dialogs).toHaveCount(0);
  });

  test('a new meal is not linkable (it opens from a tap, with the keyboard)', async ({ app, page }) => {
    await app.goto('/?sheet=meal');
    await expect(page).toHaveURL(/\/$/);
    await expect(app.dialogs).toHaveCount(0);
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

  test('a notification tap while a new meal is being typed asks before dropping it', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    const sheet = await app.record('Їжа');
    const food = sheet.getByRole('textbox', { name: 'Що я їла' });
    await food.fill('Борщ, салат — ще пишу…');

    // The in-app question (not a native confirm); «Залишитись» keeps the draft.
    const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    await page.evaluate(() => history.pushState(null, '', '/?sheet=day&trained=1'));
    await expect(page).toHaveURL(/\/$/);
    await expect(ask).toContainText('Закрити без збереження?');
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(ask).toBeHidden();
    await expect(food).toHaveValue('Борщ, салат — ще пишу…');

    // Agreeing opens the linked sheet; the draft is gone.
    await page.evaluate(() => history.pushState(null, '', '/?sheet=weight'));
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
    await expect(app.sheet('Контрольне зважування')).toBeVisible();
    await expect(app.sheet('Прийом їжі')).toHaveCount(0);
    await expect(app.dialogs).toHaveCount(1);
    await expect(page).toHaveURL(/\/$/);
  });

  test('a notification tap over «Їжа» with a meal being typed on top of it asks first', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    const list = await app.openFoodDay();
    await app.addMealButton(list).click();
    const meal = app.sheet('Прийом їжі');
    await expect(meal).toBeVisible();
    await meal.getByRole('textbox', { name: 'Що я їла', exact: true }).fill('Горіхи');

    const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    await page.evaluate(() => history.pushState(null, '', '/?sheet=weight'));
    await expect(ask).toContainText('Закрити без збереження?');
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(ask).toBeHidden();
    await expect(meal.getByRole('textbox', { name: 'Що я їла', exact: true })).toHaveValue('Горіхи');
    await expect(app.dialogs).toHaveCount(2);

    await page.evaluate(() => history.pushState(null, '', '/?sheet=weight'));
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
    await expect(app.sheet('Контрольне зважування')).toBeVisible();
    await expect(app.sheet('Прийом їжі')).toHaveCount(0);
    await expect(app.sheet('Їжа')).toHaveCount(0);
    await expect(app.dialogs).toHaveCount(1);
  });

  test('a notification tap over an untouched sheet just opens the linked one', async ({ app, page }) => {
    await app.goto('/');
    await app.record('Заміри');
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
      await expect(app.sheet('Перші кроки')).toHaveCount(0);
      await weigh.getByRole('button', { name: 'Закрити' }).click();
      await expect(app.sheet('Перші кроки')).toBeVisible();
    });
  });

  test.describe('after the session expired', () => {
    test.use({ authed: false });

    test('the link survives the login screen and opens once she is in', async ({ app, page }) => {
      await page.goto('/?sheet=measure');
      await expect(page.getByLabel(USERNAME_LABEL, { exact: true })).toBeVisible();
      // The login fills the name and the password (anna).
      await app.loginUi();
      await app.ready();
      expect((await app.deviceCache()).user?.username).toBe(USERNAME);
      await expect(app.sheet('Заміри тіла')).toBeVisible();
      await expect(page).toHaveURL(/\/$/);
    });
  });
});
