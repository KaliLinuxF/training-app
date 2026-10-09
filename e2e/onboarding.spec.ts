import { TODAY } from './support/env';
import { expect, test } from './support/test';

test.describe('first-run setup', () => {
  test.use({ seed: 'empty' });

  test('opens by itself, validates, and «Почати» onboards with the start weight on Home', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/');
    const setup = app.sheet('Налаштування');
    await expect(setup).toBeVisible();
    await expect(page.getByText('Почнімо', { exact: true })).toBeVisible();

    const weight = setup.getByRole('textbox', { name: 'Поточна вага' });
    const goal = setup.getByRole('textbox', { name: 'Цільова вага' });
    const kcal = setup.getByRole('textbox', { name: 'Калорії на день' });
    const start = setup.getByRole('button', { name: 'Почати', exact: true });

    // Defaults come from the settings.
    await expect(goal).toHaveValue('60');
    await expect(kcal).toHaveValue('1700');

    // Validation: required goal, kcal range, weight range — each blocks «Почати».
    await goal.fill('');
    await expect(setup.getByRole('alert')).toHaveText('Вкажи цільову вагу');
    await expect(start).toBeDisabled();
    await goal.fill('64');
    await kcal.fill('100');
    await expect(setup.getByRole('alert')).toHaveText('Від 500 до 10 000 ккал на день');
    await expect(start).toBeDisabled();
    await kcal.fill('1800');
    await weight.fill('10');
    await expect(setup.getByRole('alert')).toHaveText('Вага — від 20 до 400 кг');
    await expect(weight).toHaveAttribute('aria-invalid', 'true');
    await weight.fill('72,5');
    await expect(setup.getByRole('alert')).toHaveCount(0);

    // ± on the goal moves by 0,5 kg.
    await setup.getByRole('button', { name: 'Плюс 0,5 кг' }).click();
    await expect(goal).toHaveValue('64,5');
    await setup.locator('input[name="waist"]').fill('76');

    await app.save(setup, 'Почати');

    const hero = app.region('Поточна вага');
    await expect(hero).toContainText('72,5');
    await expect(hero).toContainText('Старт 72,5');
    await expect(hero).toContainText('Ціль 64,5');
    await expect(hero).toContainText('8,0 кг'); // «До цілі»
    await expect(page.getByText('Почнімо', { exact: true })).toBeHidden();
    await expect(app.region('Поточні заміри')).toContainText('76');

    await expect
      .poll(async () => {
        const d = await server.getData();
        return {
          settings: { onboarded: d.settings.onboarded, goal: d.settings.goal, kcal: d.settings.kcalGoal },
          weights: d.weights,
          waist: d.measures[0]?.waist,
        };
      })
      .toEqual({
        settings: { onboarded: true, goal: 64.5, kcal: 1800 },
        weights: [{ date: TODAY, kg: 72.5 }],
        waist: 76,
      });

    // Onboarded: nothing pops up again after a reload.
    await app.reload();
    await expect(app.dialogs).toHaveCount(0);
    await expect(app.region('Поточна вага')).toContainText('Старт 72,5');
  });

  test('closed without saving, it is offered again from the «Почнімо» banner, not re-opened in the session', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    const setup = app.sheet('Налаштування');
    await expect(setup).toBeVisible();
    // A clean draft closes without asking.
    await setup.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    // Once per session: a reload does not force it on her again…
    await app.reload();
    await expect(page.getByText('Почнімо', { exact: true })).toBeVisible();
    await expect(app.dialogs).toHaveCount(0);

    // …but the banner opens it.
    await page.getByRole('button', { name: 'Налаштувати' }).click();
    await expect(setup).toBeVisible();
  });
});
