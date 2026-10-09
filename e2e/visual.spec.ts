/**
 * Visual review pass (not pixel assertions): every screen and sheet mode, light and dark, saved to
 * e2e/__screenshots__/<project>/<scheme>/ for a human to look through.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Page, TestInfo } from '@playwright/test';
import { FOOD_JPEG, mockFood, PHOTO_ESTIMATE, PHOTO_ID } from './support/food';
import { expect, test } from './support/test';

const OUT = fileURLToPath(new URL('./__screenshots__/', import.meta.url));

/**
 * Saves a screenshot. `fullPage` on desktop captures the whole page at once; on the phone the
 * floating tab bar is `position: fixed`, which a stitched full-page capture would paint in the
 * middle of the page, so long screens are saved as viewport-sized pages instead (`name-1`, `name-2`…).
 */
async function shot(page: Page, info: TestInfo, name: string, fullPage = false): Promise<void> {
  const dir = join(OUT, info.project.name, scheme(info));
  mkdirSync(dir, { recursive: true });
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      [...document.images].map((img) =>
        img.complete ? null : new Promise((r) => img.addEventListener('load', r, { once: true })),
      ),
    );
  });
  if (!fullPage || info.project.name !== 'iphone') {
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage, animations: 'disabled' });
    return;
  }
  const { total, view } = await page.evaluate(() => ({
    total: document.documentElement.scrollHeight,
    view: window.innerHeight,
  }));
  const step = view - 160; // overlap so nothing hides behind the tab bar between pages
  for (let i = 0, y = 0; y < total - 160 && i < 8; i++, y += step) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await expect.poll(() => page.evaluate(() => Math.round(window.scrollY))).toBe(Math.min(y, total - view));
    await page.screenshot({ path: join(dir, `${name}-${i + 1}.png`), animations: 'disabled' });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** The scheme set by `test.use` in the enclosing describe (recorded in the title path). */
const scheme = (info: TestInfo): string => (info.titlePath.includes('dark') ? 'dark' : 'light');

async function scrollTop(page: Page): Promise<void> {
  await page.evaluate(() => window.scrollTo(0, 0));
}

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(colorScheme, () => {
    test.use({ colorScheme });

    test.describe('logged out', () => {
      test.use({ authed: false });

      test('login', async ({ page }, info) => {
        await page.goto('/');
        await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
        await shot(page, info, '01-login');
        await page.route('**/api/auth/login', (r) =>
          r.fulfill({ status: 401, json: { error: 'bad_password', message: 'Неправильний пароль' } }),
        );
        await page.getByLabel('Пароль', { exact: true }).fill('wrong');
        await page.getByRole('button', { name: 'Увійти' }).click();
        await expect(page.getByRole('alert')).toBeVisible();
        await shot(page, info, '02-login-error');
      });
    });

    test('screens', async ({ app, page }, info) => {
      await app.goto('/');
      await shot(page, info, '10-home', true);
      await app.go('Календар');
      await shot(page, info, '20-calendar', true);
      await app.goto('/calendar?date=2026-10-07');
      await shot(page, info, '21-calendar-day');
      await app.go('Прогрес');
      await shot(page, info, '30-progress-week', true);
      await page.getByRole('radio', { name: 'Весь час' }).click();
      await scrollTop(page);
      await shot(page, info, '31-progress-all', true);
      await page.evaluate(() => window.scrollTo(0, 900));
      await shot(page, info, '32-progress-scrolled-sticky');
      await app.go('Нагадування');
      await shot(page, info, '40-reminders', true);
    });

    test('offline home', async ({ app, page, context }, info) => {
      await app.goto('/');
      await context.setOffline(true);
      await expect(page.getByText('Офлайн · зміни збережено на телефоні')).toBeVisible();
      await app.region('Сьогодні').getByRole('button', { name: 'Не було', exact: true }).click();
      await shot(page, info, '11-home-offline');
      await app.go('Нагадування');
      await page.getByRole('heading', { name: 'Дані' }).scrollIntoViewIfNeeded();
      await shot(page, info, '41-reminders-offline-data');
    });

    test('sheets', async ({ app, page }, info) => {
      const food = await mockFood(page);
      await app.goto('/');

      await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
      const day = app.sheet('Запис дня');
      await shot(page, info, '50-sheet-day');
      await day.getByRole('button', { name: 'Було', exact: true }).click();
      await day.getByRole('button', { name: 'Кардіо', exact: true }).click();
      await day.getByRole('button', { name: '+ Свій тип' }).click();
      await shot(page, info, '51-sheet-day-trained');
      await day.getByRole('textbox', { name: 'Новий тип тренування' }).press('Escape');

      await day.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
      await day.getByRole('textbox', { name: 'Що порахувати' }).fill('борщ 300 г і 2 скибки хліба');
      await shot(page, info, '52-sheet-day-composer');
      await day.getByRole('button', { name: 'Порахувати', exact: true }).click();
      await day.getByRole('region', { name: 'Оцінка калорій' }).scrollIntoViewIfNeeded();
      await shot(page, info, '53-sheet-day-estimate');
      await day.getByRole('button', { name: /^Додати \d+ ккал$/ }).click();

      // Photo estimate → thumbnail strip.
      await page.unroute('**/api/food/estimate');
      await page.route('**/api/food/estimate', (r) => r.fulfill({ json: PHOTO_ESTIMATE }));
      await day.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: 'plate.jpg',
        mimeType: 'image/jpeg',
        buffer: FOOD_JPEG,
      });
      await day.getByRole('region', { name: 'Оцінка калорій' }).scrollIntoViewIfNeeded();
      await shot(page, info, '54-sheet-day-photo-estimate');
      await day.getByRole('button', { name: 'Додати 420 ккал' }).click();
      await expect(day.locator(`img[src="/api/photos/${PHOTO_ID}/thumb"]`)).toBeVisible();
      await day.getByRole('textbox', { name: 'Що я їла' }).scrollIntoViewIfNeeded();
      await shot(page, info, '55-sheet-day-photos');
      await day.getByRole('button', { name: 'Фото їжі' }).click();
      await expect(page.getByRole('dialog', { name: 'Фото їжі' })).toBeVisible();
      await shot(page, info, '56-photo-viewer');
      await page.keyboard.press('Escape');
      await day.getByRole('button', { name: 'Змінити' }).scrollIntoViewIfNeeded();
      await day.getByRole('button', { name: 'Змінити' }).click();
      await shot(page, info, '57-sheet-day-frequent-edit');
      await day.getByRole('button', { name: 'Готово' }).click();
      await day.getByRole('textbox', { name: 'Калорії за день' }).fill('25000');
      await shot(page, info, '58-sheet-day-kcal-error');
      await day.getByRole('textbox', { name: 'Калорії за день' }).fill('1650');
      await app.save(day);
      await shot(page, info, '59-home-after-save-toast');
      expect(food.estimates).toHaveLength(1); // the photo estimate went to the replacement route

      await app.goto('/calendar');
      await shot(page, info, '22-calendar-day-with-photos');

      await app.goto('/?sheet=weight');
      const weight = app.sheet('Контрольне зважування');
      await shot(page, info, '60-sheet-weight');
      await weight.getByRole('textbox', { name: 'Вага', exact: true }).fill('500');
      await shot(page, info, '61-sheet-weight-error');

      await app.goto('/?sheet=measure');
      const measure = app.sheet('Заміри тіла');
      await shot(page, info, '70-sheet-measure');
      await measure.locator('input[name="chest"]').fill('5');
      await shot(page, info, '71-sheet-measure-error');

      if (info.project.name === 'iphone') {
        await app.goto('/');
        await page.getByRole('button', { name: 'Як?' }).click();
        await expect(app.sheet('Встановлення на iPhone')).toBeVisible();
        await shot(page, info, '80-sheet-install');
      }
    });

    test.describe('brand-new account', () => {
      test.use({ seed: 'empty' });

      test('setup and empty states', async ({ app, page }, info) => {
        await app.goto('/');
        const setup = app.sheet('Налаштування');
        await expect(setup).toBeVisible();
        await shot(page, info, '90-sheet-setup');
        await setup.getByRole('textbox', { name: 'Цільова вага' }).fill('');
        await shot(page, info, '91-sheet-setup-error');
        await setup.getByRole('textbox', { name: 'Цільова вага' }).fill('60');
        await setup.getByRole('button', { name: 'Закрити' }).click();
        await app.expectSheetClosed();
        await shot(page, info, '92-home-empty', true);
        await app.go('Календар');
        await shot(page, info, '93-calendar-empty', true);
        await app.go('Прогрес');
        await shot(page, info, '94-progress-empty', true);
      });
    });
  });
}
