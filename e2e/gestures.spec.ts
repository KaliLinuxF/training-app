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
    await app.quickAction('Вага').click();
    const sheet = app.sheet('Контрольне зважування');
    const heading = sheet.getByRole('heading', { name: 'Контрольне зважування' });

    let start = await center(heading);
    await touchDrag(page, start, { x: start.x, y: start.y + 300 });
    await app.expectSheetClosed();

    await app.quickAction('Вага').click();
    await sheet.getByRole('button', { name: 'Плюс 0,1 кг' }).click();
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
    start = await center(heading);
    await touchDrag(page, start, { x: start.x, y: start.y + 300 });
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
    await app.expectSheetClosed();
  });

  test('dragging the item editor down closes only it; with changes it asks and snaps back', async ({
    app,
    page,
  }) => {
    await mockFood(page);
    await app.goto('/');
    await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
    const day = app.sheet('Запис дня');
    await day.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await day.getByRole('textbox', { name: 'Що порахувати' }).fill('борщ і хліб');
    await day.getByRole('button', { name: 'Порахувати', exact: true }).click();
    const card = day.getByRole('region', { name: 'Оцінка калорій' });
    const borshch = card.getByRole('button', { name: /^Борщ, / });

    await borshch.click();
    const editor = page.getByRole('dialog', { name: 'Позиція', exact: true });
    const heading = editor.getByRole('heading', { name: 'Позиція' });
    let start = await center(heading);
    await touchDrag(page, start, { x: start.x, y: start.y + 300 });
    await expect(editor).toBeHidden();
    // The day sheet under it stays, live again, with focus back on the row.
    await expect(day).toBeVisible();
    await expect(borshch).toBeFocused();

    // A changed draft: the question, «Залишитись» slides the editor back with her change.
    await borshch.click();
    await editor.getByRole('textbox', { name: 'Скільки', exact: true }).fill('150');
    start = await center(heading);
    await touchDrag(page, start, { x: start.x, y: start.y + 300 });
    const ask = page.getByRole('alertdialog', { name: 'Скасувати зміни?' });
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(ask).toBeHidden();
    await expect.poll(() => editor.evaluate((el) => el.style.transform)).toBe('');
    await expect(editor.getByRole('textbox', { name: 'Скільки', exact: true })).toHaveValue('150');

    // Dragging the dimmed day sheet above the editor does nothing to either.
    await touchDrag(page, { x: 40, y: 90 }, { x: 40, y: 420 });
    await expect(editor).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });
});
