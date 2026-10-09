/**
 * Visual review pass (not pixel assertions): every screen and sheet mode, light and dark, saved to
 * e2e/__screenshots__/<project>/<scheme>/ for a human to look through (redesign A «Чек-лист дня»).
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Locator, Page, TestInfo } from '@playwright/test';
import type { FoodEstimateResponse } from '../packages/shared/src/index';
import { TODAY } from './support/env';
import { FOOD_JPEG, mockFood, PHOTO_ESTIMATE, PHOTO_ID } from './support/food';
import { expect, test } from './support/test';

const OUT = fileURLToPath(new URL('./__screenshots__/', import.meta.url));

/** A plate with weighed and counted positions (the item editor's shots). */
const EDITOR_ESTIMATE: FoodEstimateResponse = {
  photoId: PHOTO_ID,
  items: [
    { name: 'Гречка', portion: '200 г', kcal: 220 },
    { name: 'Котлета куряча', portion: '1 шт', kcal: 180 },
    { name: 'Салат з огірків', portion: '100 г', kcal: 45 },
  ],
  totalKcal: 445,
  comment: 'Олія в салаті — приблизно 1 ложка',
};

/**
 * Saves a screenshot. `fullPage` on desktop captures the whole page at once; on the phone the
 * floating tab bar is `position: fixed`, which a stitched full-page capture would paint in the
 * middle of the page, so long screens are saved as viewport-sized pages instead (`name-1`, `name-2`…).
 * A phone screen that fits the viewport (Home) is saved as one `name.png`.
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
  const { total, view } = await page.evaluate(() => ({
    total: document.documentElement.scrollHeight,
    view: window.innerHeight,
  }));
  if (!fullPage || info.project.name !== 'iphone' || total <= view + 1) {
    await page.screenshot({ path: join(dir, `${name}.png`), fullPage, animations: 'disabled' });
    return;
  }
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

/** Scrolls the page so `locator` sits near the top of the viewport (below the sticky bar / notch). */
async function scrollToTop(page: Page, locator: Locator, offset = 80): Promise<void> {
  const top = await locator.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  await page.evaluate((y) => window.scrollTo(0, y), Math.max(0, top - offset));
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
      await expect(app.homeRow('Їжа')).toContainText('Записано');
      await shot(page, info, '10-home', true);

      await app.go('Календар');
      await shot(page, info, '20-calendar', true);
      // A tapped day scrolls its card into view above the tab bar.
      await page
        .getByRole('group', { name: /^\S+ 2026$/ })
        .getByRole('button', { name: /^7 жовтня/ })
        .click();
      await expect(app.region('7 жовтня 2026')).toBeVisible();
      await shot(page, info, '21-calendar-day');

      await app.go('Прогрес');
      await shot(page, info, '30-progress-week', true);
      await page.getByRole('radio', { name: 'Весь час' }).click();
      await scrollTop(page);
      await shot(page, info, '31-progress-all', true);
      await page.evaluate(() => window.scrollTo(0, 900));
      await shot(page, info, '32-progress-scrolled-sticky');
      const history = page.getByRole('group', { name: 'Історія калорій' });
      await history.getByRole('button', { name: 'Показати ще' }).click();
      await expect(history.getByRole('button', { name: /Відкрити в календарі$/ })).toHaveCount(10);
      await scrollToTop(page, history.getByRole('heading', { name: 'Історія калорій' }), 120);
      await shot(page, info, '33-progress-history-more');

      await app.go('Налаштування');
      await shot(page, info, '40-settings', true);
      await app.gotoSettings('Нагадування');
      await shot(page, info, '42-settings-reminders', true);
      await app.gotoSettings('Цілі');
      await shot(page, info, '43-settings-goals', true);
      await app.gotoSettings('Типи тренувань');
      await shot(page, info, '44-settings-workouts', true);
      await app.gotoSettings('Вигляд');
      await shot(page, info, '45-settings-appearance', true);
      await app.gotoSettings('Дані і копія');
      await shot(page, info, '46-settings-data', true);
    });

    test('home states', async ({ app, page, server }, info) => {
      // Weigh-in and measurement day = today (Wednesday), a planned workout, today's kcal over the goal.
      const due = await server.getData();
      due.settings.rem.weigh.day = 3;
      due.settings.rem.measure.day = 3;
      due.days[TODAY] = { food: '', trained: null, types: [], notes: '', ...due.days[TODAY], kcal: 1820 };
      await server.importData(due);
      await app.goto('/');
      await expect(app.homeRow('Вага')).toContainText('Сьогодні');
      await expect(app.homeRow('Тренування')).toContainText('За планом о 18:00');
      await expect(app.homeRow('Їжа')).toContainText('1 820 / 1 700 ккал');
      await shot(page, info, '12-home-due', true);

      // The latest weigh-in is the goal weight.
      const reached = await server.getData();
      const latest = [...reached.weights].sort((a, b) => a.date.localeCompare(b.date)).at(-1);
      if (!latest) throw new Error('the demo data has weigh-ins');
      reached.settings.goal = latest.kg;
      await server.importData(reached);
      await app.reload();
      const hero = app.region('Поточна вага');
      await expect(hero).toContainText('✓ Ціль досягнута');
      // Readable on the hero in both themes (light text on the dark hero, dark text on the light-grey dark hero).
      const contrast = await hero.getByText('✓ Ціль досягнута').evaluate((el) => {
        const rgb = (c: string) => (c.match(/[\d.]+/g) ?? []).slice(0, 3).map(Number);
        const lum = (c: string) => {
          const [r = 0, g = 0, b = 0] = rgb(c).map((v) => {
            const s = v / 255;
            return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
          return 0.2126 * r + 0.7152 * g + 0.0722 * b;
        };
        let bg = 'rgba(0, 0, 0, 0)';
        for (let n: Element | null = el; n && /rgba\(.*, 0\)|transparent/.test(bg); n = n.parentElement)
          bg = getComputedStyle(n).backgroundColor;
        const [a, b] = [lum(getComputedStyle(el).color), lum(bg)].sort((x, y) => y - x) as [number, number];
        return (a + 0.05) / (b + 0.05);
      });
      expect(contrast, '«✓ Ціль досягнута» contrast on the hero').toBeGreaterThanOrEqual(4.5);
      await shot(page, info, '13-home-goal-reached');
    });

    test('offline home', async ({ app, page, context }, info) => {
      await app.goto('/');
      await context.setOffline(true);
      await expect(page.getByText('Офлайн · зміни збережено на телефоні')).toBeVisible();
      await app.trainingToggle('Не було').click();
      await expect(app.toast('Відмічено: без тренування')).toBeVisible();
      await shot(page, info, '11-home-offline');
      // In-app navigation: a page load needs the network (the e2e run blocks the service worker).
      await app.openSettings('Дані і копія');
      await expect(app.region('Дані')).toContainText('Офлайн');
      // The toast would cover the back link.
      await expect(app.toast('Відмічено: без тренування')).toBeHidden({ timeout: 10_000 });
      await shot(page, info, '41-settings-offline-data');
    });

    test('sheets', async ({ app, page }, info) => {
      const food = await mockFood(page);
      await app.goto('/');

      await app.recordButton().click();
      await expect(app.sheet('Що записати?')).toBeVisible();
      await shot(page, info, '50-sheet-menu');
      await app.sheet('Що записати?').getByRole('button', { name: /^Їжа/ }).click();
      const sheet = app.sheet('Їжа');
      await expect(sheet).toBeVisible();
      await shot(page, info, '51-sheet-food');

      await sheet.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
      await sheet.getByRole('textbox', { name: 'Що порахувати' }).fill('борщ 300 г і 2 скибки хліба');
      await shot(page, info, '52-sheet-food-composer');
      await sheet.getByRole('button', { name: 'Порахувати', exact: true }).click();
      await sheet.getByRole('region', { name: 'Оцінка калорій' }).scrollIntoViewIfNeeded();
      await shot(page, info, '53-sheet-food-estimate');
      await sheet.getByRole('button', { name: /^Додати \d+ ккал$/ }).click();

      // Photo estimate → thumbnail strip.
      await page.unroute('**/api/food/estimate');
      await page.route('**/api/food/estimate', (r) => r.fulfill({ json: PHOTO_ESTIMATE }));
      await sheet.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: 'plate.jpg',
        mimeType: 'image/jpeg',
        buffer: FOOD_JPEG,
      });
      await sheet.getByRole('region', { name: 'Оцінка калорій' }).scrollIntoViewIfNeeded();
      await shot(page, info, '54-sheet-food-photo-estimate');
      await sheet.getByRole('button', { name: 'Додати 420 ккал' }).click();
      await expect(sheet.locator(`img[src="/api/photos/${PHOTO_ID}/thumb"]`)).toBeVisible();
      await sheet.getByRole('textbox', { name: 'Що я їла' }).scrollIntoViewIfNeeded();
      await shot(page, info, '55-sheet-food-photos');
      await sheet.getByRole('button', { name: 'Фото їжі' }).click();
      await expect(page.getByRole('dialog', { name: 'Фото їжі' })).toBeVisible();
      await shot(page, info, '56-photo-viewer');
      await page.keyboard.press('Escape');
      await sheet.getByRole('button', { name: 'Змінити' }).scrollIntoViewIfNeeded();
      await sheet.getByRole('button', { name: 'Змінити' }).click();
      await shot(page, info, '57-sheet-food-frequent-edit');
      await sheet.getByRole('button', { name: 'Готово' }).click();
      await sheet.getByRole('textbox', { name: 'Калорії за день' }).fill('25000');
      await shot(page, info, '58-sheet-food-kcal-error');
      await sheet.getByRole('textbox', { name: 'Калорії за день' }).fill('1650');
      await app.save(sheet);
      await shot(page, info, '59-home-after-save-toast');
      expect(food.estimates).toHaveLength(1); // the photo estimate went to the replacement route

      await app.goto('/calendar');
      // Tapping today's cell brings its tall day card (food lines + the photo) into view.
      await page
        .getByRole('group', { name: /^\S+ 2026$/ })
        .getByRole('button', { name: /^14 жовтня/ })
        .click();
      if (info.project.name === 'iphone')
        await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(0);
      await expect(
        app.region('14 жовтня 2026').getByRole('heading', { name: '14 жовтня 2026' }),
      ).toBeInViewport();
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

      await app.goto('/');
      const workout = await app.record('Тренування');
      await shot(page, info, '75-sheet-workout');
      await workout.getByRole('button', { name: 'Було', exact: true }).click();
      await workout.getByRole('button', { name: 'Кардіо', exact: true }).click();
      await workout.getByRole('button', { name: '+ Нотатка до дня' }).click();
      await expect(workout.getByRole('textbox', { name: 'Нотатки' })).toBeFocused();
      await workout.getByRole('button', { name: '+ Свій тип' }).click();
      await expect(workout.getByRole('textbox', { name: 'Новий тип тренування' })).toBeFocused();
      await shot(page, info, '76-sheet-workout-trained');

      await app.goto('/calendar?date=2026-10-13');
      await app.region('13 жовтня 2026').getByRole('button', { name: 'Редагувати день' }).click();
      await expect(app.sheet('Запис дня')).toContainText('13 жовтня 2026');
      await shot(page, info, '77-sheet-day-full');

      if (info.project.name === 'iphone') {
        await app.goto('/');
        await page.getByRole('button', { name: 'Як?' }).click();
        await expect(app.sheet('Встановлення на iPhone')).toBeVisible();
        await shot(page, info, '80-sheet-install');
      }
    });

    test('estimate list and item editor', async ({ app, page }, info) => {
      await mockFood(page, { estimate: EDITOR_ESTIMATE });
      await app.goto('/');
      await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
      const day = app.sheet('Запис дня');
      await day.locator('input[type="file"][accept="image/*"]').setInputFiles({
        name: 'plate.jpg',
        mimeType: 'image/jpeg',
        buffer: FOOD_JPEG,
      });
      const card = day.getByRole('region', { name: 'Оцінка калорій' });
      await expect(card).toContainText('Разом445 ккал');
      await card.scrollIntoViewIfNeeded();
      // The clean list: one tappable row per position.
      await shot(page, info, '531-estimate-list');

      // A position the model priced.
      await card.getByRole('button', { name: /^Котлета куряча, / }).click();
      const editor = page.getByRole('dialog', { name: 'Позиція', exact: true });
      await expect(editor).toBeVisible();
      await shot(page, info, '532-editor-row');
      if (info.project.name === 'iphone') {
        await editor.evaluate((el) => el.scrollTo(0, el.scrollHeight));
        await shot(page, info, '532-editor-row-bottom');
        await editor.evaluate((el) => el.scrollTo(0, 0));
      }

      // Another dish: the model has to price it.
      await editor.getByRole('textbox', { name: 'Що це', exact: true }).fill('Котлета свиняча');
      await expect(editor.getByText('змінено — уточни калорії')).toBeVisible();
      await shot(page, info, '533-editor-changed-name');
      // What changed is in view, not under the sticky footer: «✨ Перерахувати» is in the footer next
      // to «Готово», and the stale number above it (on the phone its note and «Вписати вручну» too).
      const footer = editor.getByRole('button', { name: 'Готово', exact: true }).locator('xpath=../..');
      await expect(footer.getByRole('button', { name: 'Перерахувати' })).toBeInViewport();
      const footerTop = await footer.evaluate((el) => el.getBoundingClientRect().top);
      const bottomOf = (l: Locator) => l.evaluate((el) => el.getBoundingClientRect().bottom);
      expect(await bottomOf(editor.getByText(/^180\s*ккал$/))).toBeLessThanOrEqual(footerTop);
      if (info.project.name === 'iphone') {
        expect(await bottomOf(editor.getByText('змінено — уточни калорії'))).toBeLessThanOrEqual(footerTop);
        expect(await bottomOf(editor.getByRole('button', { name: 'Вписати вручну' }))).toBeLessThanOrEqual(
          footerTop,
        );
      }
      await editor.getByRole('button', { name: 'Закрити', exact: true }).click();
      await page.getByRole('alertdialog').getByRole('button', { name: 'Скасувати зміни' }).click();
      await expect(editor).toBeHidden();

      // A new position: «Часті страви» under the name, then one of them picked.
      await card.getByRole('button', { name: '+ позиція' }).click();
      const added = page.getByRole('dialog', { name: 'Нова позиція', exact: true });
      await expect(added).toBeVisible();
      await shot(page, info, '535-editor-new');
      await added.getByRole('textbox', { name: 'Що це', exact: true }).fill('ка');
      await shot(page, info, '534-editor-suggestion');
      await added.getByRole('button', { name: /^Кава з молоком, / }).click();
      await expect(added).toContainText('як у «Частих стравах»');
      await shot(page, info, '536-editor-dish-picked');
      await added.getByRole('button', { name: 'Додати позицію' }).click();
      await expect(added).toBeHidden();
      await card.scrollIntoViewIfNeeded();
      await shot(page, info, '537-estimate-list-after');
    });

    test.describe('brand-new account', () => {
      test.use({ seed: 'empty' });

      test('setup and empty states', async ({ app, page }, info) => {
        await app.goto('/');
        const setup = app.sheet('Перші кроки');
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
