import type { Locator, Page } from '@playwright/test';
import { mockFood } from './support/food';
import { expect, test } from './support/test';

/**
 * A one-finger drag through the DevTools protocol: the browser produces real touch *and*
 * pointer events (`pointerType: 'touch'`), like a finger on the phone.
 */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 8,
) {
  const cdp = await page.context().newCDPSession(page);
  const point = (x: number, y: number) => [{ x, y, id: 1, radiusX: 4, radiusY: 4, force: 1 }];
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: point(from.x, from.y) });
  for (let i = 1; i <= steps; i++) {
    const x = from.x + ((to.x - from.x) * i) / steps;
    const y = from.y + ((to.y - from.y) * i) / steps;
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: point(x, y) });
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/**
 * The sheet has stopped moving: even with reduced motion a sheet that just opened (or snapped back) keeps its panel
 * translated for a frame or two after it is «visible» (a stacked one starts ~650px down), so a drag that starts from
 * a point measured earlier lands below the header instead of on it.
 */
async function settled(sheet: Locator): Promise<void> {
  await expect.poll(() => sheet.evaluate((el) => getComputedStyle(el).transform)).toBe('none');
}

async function center(locator: Locator): Promise<{ x: number; y: number }> {
  const box = await locator.boundingBox();
  if (!box) throw new Error('element is not visible');
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

test.describe('touch gestures (iPhone)', () => {
  test.skip(({ isMobile }) => !isMobile, 'touch-only gestures');

  test('swiping the month grid flips months (never into the future)', async ({ app, page }) => {
    await app.goto('/calendar');
    const title = page.getByRole('heading', { level: 2, name: /^\S+ 2026$/ });
    const grid = page.getByRole('group', { name: /^\S+ 2026$/ });
    await expect(title).toHaveText('Жовтень 2026');

    const c = await center(grid);
    await touchDrag(page, { x: c.x - 120, y: c.y }, { x: c.x + 120, y: c.y + 10 }); // →
    await expect(title).toHaveText('Вересень 2026');
    await touchDrag(page, { x: c.x + 120, y: c.y }, { x: c.x - 120, y: c.y }); // ←
    await expect(title).toHaveText('Жовтень 2026');
    await touchDrag(page, { x: c.x + 120, y: c.y }, { x: c.x - 120, y: c.y }); // ← past today
    await expect(title).toHaveText('Жовтень 2026');
    // Mostly vertical movement is a scroll, not a swipe.
    await touchDrag(page, { x: c.x - 30, y: c.y - 60 }, { x: c.x + 30, y: c.y + 60 });
    await expect(title).toHaveText('Жовтень 2026');
  });

  test('dragging the sheet header down dismisses it; with unsaved changes it asks and snaps back', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    // «+» → «Що записати?» → «Вага» swaps the menu to «Контрольне зважування».
    const sheet = await app.record('Вага');
    const heading = sheet.getByRole('heading', { name: 'Контрольне зважування' });

    await settled(sheet);
    let start = await center(heading);
    await touchDrag(page, start, { x: start.x, y: start.y + 300 });
    await app.expectSheetClosed();

    await app.record('Вага');
    await sheet.getByRole('button', { name: 'Плюс 0,1 кг' }).click();
    await settled(sheet);
    start = await center(heading);
    // The in-app question shows while the panel waits off-screen; «Залишитись» slides it back.
    const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    await touchDrag(page, start, { x: start.x, y: start.y + 300 });
    await expect(ask).toContainText('Закрити без збереження?');
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(ask).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect.poll(() => sheet.evaluate((el) => el.style.transform)).toBe('');
    await expect(sheet.getByRole('textbox', { name: 'Вага', exact: true })).toHaveValue('65,5');

    // Dragged again and confirmed: the draft goes with the sheet.
    await settled(sheet);
    start = await center(heading);
    await touchDrag(page, start, { x: start.x, y: start.y + 300 });
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
    await app.expectSheetClosed();
  });

  test.describe('stacked sheets (seed: meals)', () => {
    test.use({ seed: 'meals' });

    test('dragging a stacked «Прийом їжі» down closes only it; with changes it asks first; «Їжа» stays', async ({
      app,
      page,
    }) => {
      await app.goto('/');
      const list = await app.openFoodDay();
      const row = app.mealRow(list, 'Перекус');
      await row.click();
      const editor = app.sheet('Прийом їжі');
      await expect(editor).toBeVisible();
      const heading = editor.getByRole('heading', { name: 'Прийом їжі' });

      // Untouched: it slides away without a question; the list under it is live again, focus on the row.
      await settled(editor);
      let start = await center(heading);
      await touchDrag(page, start, { x: start.x, y: start.y + 300 });
      await expect(editor).toBeHidden();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(list).toBeVisible();
      await expect(row).toBeFocused();

      // Changed: the question while the panel waits off-screen; «Залишитись» slides it back with her text.
      await row.click();
      const text = editor.getByRole('textbox', { name: 'Що я їла', exact: true });
      await text.fill('Яблуко і груша');
      await settled(editor);
      start = await center(heading);
      await touchDrag(page, start, { x: start.x, y: start.y + 300 });
      const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
      await expect(ask).toContainText('Закрити без збереження?');
      await ask.getByRole('button', { name: 'Залишитись' }).click();
      await expect(ask).toBeHidden();
      await expect(editor).toBeVisible();
      await expect.poll(() => editor.evaluate((el) => el.style.transform)).toBe('');
      await expect(text).toHaveValue('Яблуко і груша');

      // Dragged again and confirmed: only the meal editor goes, with its draft; the list stays as it was.
      await settled(editor);
      start = await center(heading);
      await touchDrag(page, start, { x: start.x, y: start.y + 300 });
      await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
      await expect(editor).toBeHidden();
      await expect(list).toBeVisible();
      await expect(app.dialogs).toHaveCount(1);
      await expect(app.mealRow(list, 'Перекус')).toHaveAccessibleName(/^Перекус о 09:40: яблуко\. 80\sккал$/);
    });

    test('dragging the item editor (a position of a meal) down closes only it; with changes it asks and snaps back', async ({
      app,
      page,
    }) => {
      await mockFood(page);
      await app.goto('/');
      const list = await app.openFoodDay();
      await app.mealRow(list, 'Сніданок').click();
      const meal = app.sheet('Прийом їжі');
      await expect(meal).toBeVisible();
      const card = meal.getByRole('region', { name: 'Позиції', exact: true });
      const oats = card.getByRole('button', { name: /^Вівсянка з бананом, / });

      await oats.click();
      const editor = app.sheet('Позиція');
      const heading = editor.getByRole('heading', { name: 'Позиція' });
      await settled(editor);
      let start = await center(heading);
      await touchDrag(page, start, { x: start.x, y: start.y + 300 });
      await expect(editor).toBeHidden();
      // The meal under it stays, live again, with focus back on the row; the list under that stays too.
      await expect(meal).toBeVisible();
      await expect(list).toBeVisible();
      await expect(oats).toBeFocused();

      // A changed draft: the question, «Залишитись» slides the editor back with her change.
      await oats.click();
      await editor.getByRole('textbox', { name: 'Скільки', exact: true }).fill('150');
      await settled(editor);
      start = await center(heading);
      await touchDrag(page, start, { x: start.x, y: start.y + 300 });
      const ask = page.getByRole('alertdialog', { name: 'Скасувати зміни?' });
      await ask.getByRole('button', { name: 'Залишитись' }).click();
      await expect(ask).toBeHidden();
      await expect.poll(() => editor.evaluate((el) => el.style.transform)).toBe('');
      await expect(editor.getByRole('textbox', { name: 'Скільки', exact: true })).toHaveValue('150');

      // Dragging the dimmed sheets above the editor does nothing to any of them.
      await touchDrag(page, { x: 40, y: 90 }, { x: 40, y: 420 });
      await expect(editor).toBeVisible();
      await expect(meal).toBeVisible();
      await expect(page.getByRole('alertdialog')).toHaveCount(0);
      await expect(app.dialogs).toHaveCount(3);
    });
  });
});
