import { expect, test } from './support/test';

test.describe('weigh-in sheet', () => {
  test('pre-fills the weigh-in before the day, validates, navigates days (asking before dropping a draft) and saves a past day', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/');
    await app.quickAction('Вага').click();
    const sheet = app.sheet('Контрольне зважування');
    const kg = sheet.getByRole('textbox', { name: 'Вага', exact: true });
    const save = sheet.getByRole('button', { name: 'Зберегти' });
    const prev = sheet.getByRole('button', { name: 'Попередній день' });
    const next = sheet.getByRole('button', { name: 'Наступний день' });

    await expect(sheet).toContainText('14 жовтня 2026');
    await expect(kg).toHaveValue('65,4');
    await expect(sheet).toContainText('Попереднє: 12 жовтня — 65,4 кг');
    await expect(next).toBeDisabled();

    await sheet.getByRole('button', { name: 'Мінус 0,1 кг' }).click();
    await sheet.getByRole('button', { name: 'Мінус 0,1 кг' }).click();
    await expect(kg).toHaveValue('65,2');

    for (const bad of ['500', '19,9', 'abc']) {
      await kg.fill(bad);
      await expect(sheet.getByRole('alert')).toHaveText('Вага — від 20 до 400 кг');
      await expect(kg).toHaveAttribute('aria-invalid', 'true');
      await expect(save).toBeDisabled();
    }
    await kg.fill('65,2');
    await expect(sheet.getByRole('alert')).toHaveCount(0);
    await expect(save).toBeEnabled();

    // Dirty draft: leaving the day asks in the app's own dialog; «Залишитись» keeps her on it.
    const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    await prev.click();
    await expect(ask).toContainText('Перейти до іншого дня без збереження?');
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(ask).toBeHidden();
    await expect(sheet).toContainText('14 жовтня 2026');
    await expect(kg).toHaveValue('65,2');

    await prev.click();
    await ask.getByRole('button', { name: 'Перейти' }).click();
    await expect(ask).toBeHidden();
    await expect(sheet).toContainText('13 жовтня 2026');
    await expect(sheet).toContainText('вівторок');
    await expect(sheet).not.toContainText('сьогодні');
    await expect(next).toBeEnabled();
    // No weigh-in that day: the one before it (12 Oct) is offered.
    await expect(kg).toHaveValue('65,4');

    // A clean draft moves without asking.
    await prev.click();
    await expect(sheet).toContainText('12 жовтня 2026');
    await expect(kg).toHaveValue('65,4');
    await expect(sheet).toContainText('Попереднє: 5 жовтня — 65,7 кг');
    // Further back the offer follows the day: 11 Oct gets 5 Oct's weight, not the latest one.
    await prev.click();
    await expect(sheet).toContainText('11 жовтня 2026');
    await expect(kg).toHaveValue('65,7');
    await next.click();
    await next.click();
    await expect(sheet).toContainText('13 жовтня 2026');
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    await kg.fill('65,3');
    await app.save(sheet);

    await expect(app.region('Поточна вага')).toContainText('65,3');
    await expect(page.getByText('13 жовтня — 65,3 кг')).toBeVisible(); // «Останнє зважування»

    await app.goto('/calendar?date=2026-10-13');
    await expect(app.region('13 жовтня 2026')).toContainText('65,3 кг');

    await expect
      .poll(async () => (await server.getData()).weights.filter((w) => w.date >= '2026-10-12'))
      .toEqual([
        { date: '2026-10-12', kg: 65.4 },
        { date: '2026-10-13', kg: 65.3 },
      ]);
  });

  test('clearing the weight of a day deletes that weigh-in', async ({ app, server }) => {
    await app.goto('/');
    await app.quickAction('Вага').click();
    const sheet = app.sheet('Контрольне зважування');
    await sheet.getByRole('button', { name: 'Попередній день' }).click();
    await sheet.getByRole('button', { name: 'Попередній день' }).click();
    await expect(sheet).toContainText('12 жовтня 2026');
    await sheet.getByRole('textbox', { name: 'Вага', exact: true }).fill('');
    await app.save(sheet);

    await expect(app.region('Поточна вага')).toContainText('65,7');
    await expect
      .poll(async () => (await server.getData()).weights.at(-1))
      .toEqual({ date: '2026-10-05', kg: 65.7 });
  });
});

test.describe('measurements sheet', () => {
  test('shows the previous values as hints, validates the range and saves', async ({ app, server }) => {
    await app.goto('/');
    await app.quickAction('Заміри').click();
    const sheet = app.sheet('Заміри тіла');
    const chest = sheet.locator('input[name="chest"]');
    const waist = sheet.locator('input[name="waist"]');
    const hips = sheet.locator('input[name="hips"]');
    const save = sheet.getByRole('button', { name: 'Зберегти' });

    await expect(sheet).toContainText('Груди · талія · стегна');
    await expect(chest).toHaveValue('');
    await expect(chest).toHaveAttribute('placeholder', '90');
    await expect(waist).toHaveAttribute('placeholder', '70');
    await expect(hips).toHaveAttribute('placeholder', '98');

    await chest.fill('5');
    await expect(sheet.getByRole('alert')).toHaveText('Заміри — від 10 до 300 см');
    await expect(chest).toHaveAttribute('aria-invalid', 'true');
    await expect(waist).not.toHaveAttribute('aria-invalid', 'true');
    await expect(save).toBeDisabled();
    await hips.fill('301');
    await expect(hips).toHaveAttribute('aria-invalid', 'true');
    await hips.fill('');
    await chest.fill('89,5');
    await waist.fill('69');
    await expect(sheet.getByRole('alert')).toHaveCount(0);
    await app.save(sheet);

    const measures = app.region('Поточні заміри');
    await expect(measures).toContainText('14 жовтня');
    await expect(measures).toContainText('89,5');
    await expect(measures).toContainText('−3,5 см'); // chest 93 → 89,5
    await expect(measures).toContainText('−5,5 см'); // waist 74,5 → 69

    await expect
      .poll(async () => (await server.getData()).measures.at(-1))
      .toEqual({ date: '2026-10-14', chest: 89.5, waist: 69, hips: null });
  });

  test('day navigation loads that day; clearing all three removes the entry', async ({ app, server }) => {
    await app.goto('/');
    await app.quickAction('Заміри').click();
    const sheet = app.sheet('Заміри тіла');
    await sheet.getByRole('button', { name: 'Попередній день' }).click();
    await sheet.getByRole('button', { name: 'Попередній день' }).click();
    await expect(sheet).toContainText('12 жовтня 2026');
    const inputs = ['chest', 'waist', 'hips'].map((n) => sheet.locator(`input[name="${n}"]`));
    await expect(inputs[0]!).toHaveValue('90');
    await expect(inputs[1]!).toHaveValue('70');
    await expect(inputs[2]!).toHaveValue('98');
    // Hints show the values before that day.
    await expect(inputs[1]!).toHaveAttribute('placeholder', '70,5');
    for (const input of inputs) await input.fill('');
    await app.save(sheet);

    await expect.poll(async () => (await server.getData()).measures.at(-1)?.date).toBe('2026-10-05');
    await app.goto('/calendar?date=2026-10-12');
    await expect(app.region('12 жовтня 2026')).not.toContainText('Груди');
  });
});
