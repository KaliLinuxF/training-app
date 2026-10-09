import type { Page } from '@playwright/test';
import { expect, test } from './support/test';

/**
 * Expected values for the demo data on Wednesday 14 Oct 2026 (worked out by hand from
 * e2e/fixtures/data.ts: week = since Mon 12 Oct, month = since 15 Sep, 3 months / all = since 3 Aug).
 */
const SUMMARY = {
  week: { title: 'Цього тижня', trainings: '2', kcal: '1 795 ккал', weight: '−0,3 кг' },
  month: { title: 'За останні 30 днів', trainings: '18', kcal: '1 692 ккал', weight: '−1,3 кг' },
  q: { title: 'За 3 місяці', trainings: '41', kcal: '1 708 ккал', weight: '−2,9 кг' },
  all: { title: 'За весь період', trainings: '41', kcal: '1 708 ккал', weight: '−2,9 кг' },
} as const;

const LABELS = { week: 'Тиждень', month: 'Місяць', q: '3 міс.', all: 'Весь час' } as const;

const periods = (page: Page) => page.getByRole('radiogroup', { name: 'Період' });

test.describe('progress', () => {
  test('period switch updates the summary; the switcher stays on screen while scrolling', async ({
    app,
    page,
  }) => {
    await app.goto('/progress');
    await expect(periods(page).getByRole('radio', { name: 'Тиждень' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    for (const key of ['week', 'month', 'q', 'all'] as const) {
      const expected = SUMMARY[key];
      await periods(page).getByRole('radio', { name: LABELS[key] }).click();
      await expect(periods(page).getByRole('radio', { name: LABELS[key] })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      const summary = app.region(expected.title);
      await expect(summary).toContainText(`Тренувань${expected.trainings}`);
      await expect(summary).toContainText(`Середня калорійність${expected.kcal}`);
      await expect(summary).toContainText(`Зміна ваги${expected.weight}`);
    }
    await expect(page.getByText('Найчастіше · за весь період')).toBeVisible();
    // «Весь час» ranks the types over all records: Прес 18 is first.
    await expect(app.region('Тренування').getByText('Прес')).toBeVisible();

    // Sticky: after scrolling to the very bottom the switcher is still pinned near the top.
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(500);
    const box = await periods(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThanOrEqual(24);
    await periods(page).getByRole('radio', { name: 'Тиждень' }).click();
    await expect(app.region('Цього тижня')).toContainText('Тренувань2');

    // The choice is remembered for the session.
    await periods(page).getByRole('radio', { name: 'Місяць' }).click();
    await app.reload();
    await expect(periods(page).getByRole('radio', { name: 'Місяць' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(app.region('За останні 30 днів')).toBeVisible();
  });

  test('weight and measurement cards; the selected parameter drives the chart', async ({ app }) => {
    await app.goto('/progress');
    const weight = app.region('Вага');
    await expect(weight).toContainText('Початкова68,3');
    await expect(weight).toContainText('Поточна65,4');
    await expect(weight).toContainText('Цільова60,0');
    await expect(weight).toContainText('Втрачено2,9 кг');
    await expect(weight).toContainText('Залишилось5,4 кг');
    await expect(weight).toContainText('Шлях35%');

    const measures = app.region('Заміри тіла');
    const params = measures.getByRole('group', { name: 'Параметр для графіка' });
    const waist = params.getByRole('button', { name: /^Талія:/ });
    const chest = params.getByRole('button', { name: /^Груди:/ });
    await expect(waist).toHaveAttribute('aria-pressed', 'true');
    await expect(waist).toContainText('74,5 → 70 см');
    await expect(waist).toContainText('−4,5 см');
    await expect(measures.getByRole('img', { name: /^Талія:/ })).toBeVisible();
    await expect(measures).toContainText('Талія, см');

    await chest.click();
    await expect(chest).toHaveAttribute('aria-pressed', 'true');
    await expect(waist).toHaveAttribute('aria-pressed', 'false');
    await expect(measures.getByRole('img', { name: /^Груди:/ })).toBeVisible();
    await expect(measures).toContainText('Груди, см');
    await expect(chest).toContainText('93 → 90 см');
  });

  test('kcal history: «Показати ще» and a row opens that day in the calendar', async ({ app, page }) => {
    await app.goto('/progress');
    const nutrition = app.region('Харчування');
    await expect(nutrition).toContainText('ціль 1 700 ккал');
    const history = nutrition.getByRole('group', { name: 'Історія калорій' });
    const rows = history.getByRole('button', { name: /Відкрити в календарі$/ });
    await expect(rows).toHaveCount(7);
    await expect(rows.first()).toHaveAccessibleName('13 жовтня: 1 740 ккал. Відкрити в календарі');
    await history.getByRole('button', { name: 'Показати ще' }).click();
    await expect(rows).toHaveCount(14);

    await history.getByRole('button', { name: '7 жовтня: 1 880 ккал. Відкрити в календарі' }).click();
    await expect(app.heading('Календар')).toBeVisible();
    await expect(page).toHaveURL(/\/calendar\?date=2026-10-07$/);
    await expect(app.region('7 жовтня 2026')).toContainText('1 880 ккал');
  });

  test('empty account: placeholders instead of charts', async ({ app, server }) => {
    const data = await server.getData();
    await server.importData({ ...data, days: {}, weights: [], measures: [], foods: [] });
    await app.goto('/progress');
    await expect(app.region('Вага')).toContainText('Запиши перше зважування, щоб бачити динаміку');
    await expect(app.region('Заміри тіла')).toContainText('Запиши заміри, щоб бачити динаміку');
    await expect(app.region('Тренування')).toContainText('За цей період тренувань ще немає');
    await expect(app.region('Харчування')).toContainText('Ще немає днів із калоріями');
  });
});
