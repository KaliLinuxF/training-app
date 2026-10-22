/**
 * Steps (docs/workouts-steps-rebrand.md §3.16, §3.17): one number per day typed by hand — the «+» → «Кроки» sheet
 * with ±500 / ±1000, the calendar row and the Home sub, the optional goal in Settings and its hint, the field in
 * «Запис дня», deleting by emptying, and an offline save that syncs later. Demo seed: Wednesday 14 October 2026,
 * no steps and no steps goal.
 */
import { demo } from './fixtures/data';
import { TODAY } from './support/env';
import { expect, test } from './support/test';

const stepsOf = (data: { steps: { date: string; steps: number }[] }, date = TODAY) =>
  data.steps.find((s) => s.date === date)?.steps ?? null;

test.describe('steps', () => {
  test('«+» → «Кроки»: the steppers, «Зберегти», then the calendar row and the Home sub', async ({
    app,
    server,
  }) => {
    await app.goto('/');
    const sheet = await app.record('Кроки');
    const input = sheet.getByRole('textbox', { name: 'Кроки за день' });
    await expect(input).toHaveValue('');
    await expect(input).toHaveAttribute('inputmode', 'numeric');
    const more = sheet.getByRole('button', { name: 'Плюс 1000 кроків' });
    for (let i = 0; i < 8; i++) await more.click();
    await sheet.getByRole('button', { name: 'Плюс 500 кроків' }).click();
    await sheet.getByRole('button', { name: 'Мінус 1000 кроків' }).click();
    await expect(input).toHaveValue('7 500');
    // No goal yet: the estimate of the burned kcal.
    await expect(sheet.getByText(/^≈ \d+ ккал$/)).toBeVisible();
    // Each stepper is a real 44px target.
    const box = await more.boundingBox();
    expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
    await app.save(sheet);
    await expect.poll(async () => stepsOf(await server.getData())).toBe(7500);

    await expect(app.homeRow('Тренування')).toContainText('7 500 кроків');
    await expect(app.homeRow('Тренування')).toHaveAccessibleName(/7 500 кроків/);

    await app.go('Календар');
    const day = app.region('14 жовтня 2026');
    const row = day.getByRole('button', { name: /^Кроки/ });
    await expect(row).toContainText('7 500');
    await expect(row).toHaveAccessibleName(/^Кроки: 7 500, спалено близько \d+ ккал$/);
    // The row opens the same sheet for that day, pre-filled.
    await row.click();
    await expect(app.sheet('Кроки').getByRole('textbox', { name: 'Кроки за день' })).toHaveValue('7 500');
  });

  test('a goal set in Settings → Цілі shows in the sheet’s hint', async ({ app, server }) => {
    await app.gotoSettings('Цілі');
    const goal = app.region('Мої цілі').getByRole('group', { name: 'Кроки за день' });
    await expect(goal.locator('output')).toHaveText('Без цілі');
    await expect(goal.getByRole('button', { name: 'Прибрати ціль кроків' })).toHaveCount(0);
    await goal.getByRole('button', { name: 'Поставити ціль кроків' }).click();
    await expect(goal.locator('output')).toHaveText('8 000 кроків');
    await goal.getByRole('button', { name: 'Збільшити ціль кроків' }).click();
    await expect(goal.locator('output')).toHaveText('8 500 кроків');
    await expect.poll(async () => (await server.getData()).settings.stepsGoal).toBe(8500);

    await app.go('Головна');
    const sheet = await app.record('Кроки');
    await sheet.getByRole('textbox', { name: 'Кроки за день' }).fill('5000');
    await expect(sheet.getByText('Ціль 8 500 — ще 3 500')).toBeVisible();
    await sheet.getByRole('textbox', { name: 'Кроки за день' }).fill('9000');
    await expect(sheet.getByText('Ціль виконано ✓')).toBeVisible();
  });

  test('«Запис дня» has the field «Кроки (за бажанням)»', async ({ app, server }) => {
    await app.goto('/');
    const day = await app.record('Повний запис дня');
    const input = day.getByRole('textbox', { name: 'Кроки (за бажанням)' });
    await input.fill('6200');
    await expect(input).toHaveValue('6 200');
    await app.save(day);
    await expect.poll(async () => stepsOf(await server.getData())).toBe(6200);
  });

  test('emptying the count and saving deletes the day’s steps', async ({ app, server }) => {
    const data = demo();
    data.steps = [{ date: TODAY, steps: 4000 }];
    await server.importData(data);
    await app.goto('/');
    const sheet = await app.record('Кроки');
    const input = sheet.getByRole('textbox', { name: 'Кроки за день' });
    await expect(input).toHaveValue('4 000');
    await input.fill('');
    await app.save(sheet);
    await expect.poll(async () => stepsOf(await server.getData())).toBeNull();
    await expect(app.homeRow('Тренування')).not.toContainText('кроків');
  });

  test('saved offline, the steps reach the server once online', async ({ app, context, server }) => {
    await app.goto('/');
    await context.setOffline(true);
    const sheet = await app.record('Кроки');
    await sheet.getByRole('textbox', { name: 'Кроки за день' }).fill('7000');
    await app.save(sheet);
    await expect(app.homeRow('Тренування')).toContainText('7 000 кроків');
    expect(stepsOf(await server.getData())).toBeNull();

    await context.setOffline(false);
    await expect.poll(async () => stepsOf(await server.getData()), { timeout: 15_000 }).toBe(7000);
  });
});
