import type { Locator, Page } from '@playwright/test';
import type { App } from './support/app';
import { TODAY } from './support/env';
import { mockFood } from './support/food';
import { expect, test } from './support/test';

/**
 * A one-finger drag through the DevTools protocol: the browser produces real touch *and*
 * pointer events (`pointerType: 'touch'`), like a finger on the phone. (A copy of the helper in
 * gestures.spec.ts, which belongs to another package.)
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

const MENU_ROWS = ['Їжа', 'Тренування', 'Вага', 'Заміри'] as const;

/** «+» (tab bar) / «+ Записати день» (sidebar) → the «Що записати?» menu. */
async function openMenu(app: App): Promise<Locator> {
  await app.recordButton().click();
  const menu = app.sheet('Що записати?');
  await expect(menu).toBeVisible();
  return menu;
}

/** A menu row: its name starts with the title («Їжа Опис або фото 1 240 ккал»). */
const menuRow = (menu: Locator, title: (typeof MENU_ROWS)[number]): Locator =>
  menu.getByRole('button', { name: new RegExp(`^${title}`) });

/** The panel's own animations (slide-up / pop-in) have finished, so its box is final. */
const settled = (sheet: Locator): Promise<unknown> =>
  sheet.evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));

test.describe('«+» → «Що записати?»', () => {
  test('four big rows and «Повний запис дня →»; no date navigator, no «Зберегти»; Escape closes without asking', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    const menu = await openMenu(app);
    const rows = menu.getByRole('list').getByRole('button');
    await expect(rows).toHaveCount(4);
    for (const [i, title] of MENU_ROWS.entries()) {
      await expect(rows.nth(i)).toHaveAccessibleName(new RegExp(`^${title}`));
      const box = await rows.nth(i).boundingBox();
      expect(box?.height ?? 0).toBeGreaterThanOrEqual(64);
    }
    await expect(menuRow(menu, 'Їжа')).toContainText('Опис або фото');
    // The demo seed's today has a meal without kcal: «Записано», like Home's Їжа row.
    await expect(menuRow(menu, 'Їжа')).toContainText('Записано');
    await expect(menuRow(menu, 'Їжа')).not.toContainText('ккал');
    // The demo seed's Wednesday is a planned workout day, not marked yet.
    await expect(menuRow(menu, 'Тренування')).toContainText('За планом');
    await expect(menu.getByRole('button', { name: 'Повний запис дня' })).toHaveText('Повний запис дня →');
    await expect(menu.getByRole('button', { name: 'Зберегти' })).toHaveCount(0);
    await expect(menu.getByRole('button', { name: 'Попередній день' })).toHaveCount(0);

    await page.keyboard.press('Escape');
    await app.expectSheetClosed();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);

    await openMenu(app);
    await app.sheet('Що записати?').getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('dragging the menu down closes it without asking', async ({ app, page, isMobile }) => {
    test.skip(!isMobile, 'touch-only gesture');
    await app.goto('/');
    const menu = await openMenu(app);
    await settled(menu);
    const start = await center(menu.getByRole('heading', { name: 'Що записати?' }));
    await touchDrag(page, start, { x: start.x, y: start.y + 300 });
    await app.expectSheetClosed();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('nothing to tap where the «+» is: a double tap on «+» keeps the short menu', async ({
    app,
    page,
    isMobile,
  }) => {
    test.skip(!isMobile, 'the tab-bar «+» is phone-only');
    await app.goto('/');
    expect(page.viewportSize()).toEqual({ width: 390, height: 844 });
    const plus = await center(app.recordButton());
    const menu = await openMenu(app);
    await settled(menu);

    // The open menu has no control under the «+» centre…
    const control = await page.evaluate(
      ([x, y]) => {
        const el = document.elementFromPoint(x, y);
        const hit = el?.closest('button, a, [role="button"], input, textarea, select');
        return hit ? (hit.getAttribute('aria-label') ?? hit.textContent ?? hit.tagName) : null;
      },
      [plus.x, plus.y] as const,
    );
    expect(control).toBeNull();
    // …and «Повний запис дня →» (right-aligned) keeps its 44px hit area (6px wider each side) clear of it.
    const ghost = await menu.getByRole('button', { name: 'Повний запис дня' }).boundingBox();
    if (!ghost) throw new Error('«Повний запис дня» is not visible');
    expect(ghost.x - 6).toBeGreaterThanOrEqual(plus.x + 24);

    // Two quick taps on «+»: the second lands on the menu's empty body, the menu stays.
    await page.keyboard.press('Escape');
    await app.expectSheetClosed();
    await page.touchscreen.tap(plus.x, plus.y);
    await page.waitForTimeout(200);
    await page.touchscreen.tap(plus.x, plus.y);
    await expect(app.sheet('Що записати?')).toBeVisible();
    await expect(app.sheet('Запис дня')).toHaveCount(0);
    await expect(app.dialogs).toHaveCount(1);
  });

  test('a row swaps the same dialog to its form: one dialog throughout, focus stays in it', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    const menu = await openMenu(app);
    // Mark the dialog element and count dialogs on every DOM change from now on.
    await menu.evaluate((el) => {
      el.setAttribute('data-e2e-swap', 'same');
      const w = window as unknown as { e2eMaxDialogs: number };
      w.e2eMaxDialogs = document.querySelectorAll('[role="dialog"]').length;
      new MutationObserver(() => {
        w.e2eMaxDialogs = Math.max(w.e2eMaxDialogs, document.querySelectorAll('[role="dialog"]').length);
      }).observe(document.body, { childList: true, subtree: true });
    });

    await menuRow(menu, 'Тренування').click();
    const sheet = app.sheet('Тренування');
    await expect(sheet).toBeVisible();
    await expect(sheet).toHaveAttribute('data-e2e-swap', 'same');
    await expect(app.dialogs).toHaveCount(1);
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { e2eMaxDialogs: number }).e2eMaxDialogs))
      .toBe(1);
    await expect(sheet).toContainText('14 жовтня 2026');
    await expect(sheet.getByRole('button', { name: 'Попередній день' })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Зберегти' })).toBeVisible();
    // The tapped row is gone; focus went to the dialog, not to <body>.
    await expect(sheet).toBeFocused();
  });

  test('Їжа: a «Часті страви» chip and «Зберегти»; the workout and notes of the day stay; the menu shows the kcal', async ({
    app,
    page,
    server,
  }) => {
    await mockFood(page, { status: { enabled: false, remainingToday: 0 } });
    const seeded = await server.getData();
    seeded.days[TODAY] = {
      food: 'Вівсянка з бананом, кава',
      kcal: null,
      trained: true,
      types: ['Кардіо'],
      notes: 'Сон 8 годин',
    };
    await server.importData(seeded);

    await app.goto('/');
    const sheet = await app.record('Їжа');
    await expect(app.dialogs).toHaveCount(1);
    await expect(sheet).toContainText('середа · сьогодні');
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveValue('Вівсянка з бананом, кава');
    await expect(sheet.getByRole('group', { name: 'Тренування' })).toHaveCount(0);
    await expect(sheet.getByRole('textbox', { name: 'Нотатки' })).toHaveCount(0);
    await expect(sheet.getByRole('textbox', { name: /Вага/ })).toHaveCount(0);

    await sheet.getByRole('button', { name: 'Додати «Кава з молоком», 60 ккал' }).click();
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('60');
    await app.save(sheet);

    await expect
      .poll(async () => (await server.getData()).days[TODAY])
      .toEqual({
        food: 'Вівсянка з бананом, кава\nКава з молоком (1 чашка) — 60 ккал',
        kcal: 60,
        trained: true,
        types: ['Кардіо'],
        notes: 'Сон 8 годин',
      });

    const menu = await openMenu(app);
    await expect(menuRow(menu, 'Їжа')).toContainText('60 ккал');
    await expect(menuRow(menu, 'Тренування')).toContainText('✓ Було');
  });

  test('Тренування: ✓, a type and a note; the food stays; the menu shows «✓ Було»', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/');
    const sheet = await app.record('Тренування');
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveCount(0);
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: 'Кардіо', exact: true })).toHaveCount(0);

    await sheet.getByRole('button', { name: 'Було', exact: true }).click();
    await sheet.getByRole('button', { name: 'Кардіо', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Кардіо', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The folded note opens and takes focus in the same tap (the iPhone keyboard comes up with it).
    await expect(sheet.getByRole('textbox', { name: 'Нотатки' })).toHaveCount(0);
    await sheet.getByRole('button', { name: '+ Нотатка до дня' }).click();
    const notes = sheet.getByRole('textbox', { name: 'Нотатки' });
    await expect(notes).toBeFocused();
    await page.keyboard.type('Легке кардіо, 2 л води');
    await expect(notes).toHaveValue('Легке кардіо, 2 л води');
    await app.save(sheet);

    await expect
      .poll(async () => (await server.getData()).days[TODAY])
      .toEqual({
        food: 'Вівсянка з бананом, кава',
        kcal: null,
        trained: true,
        types: ['Кардіо'],
        notes: 'Легке кардіо, 2 л води',
      });

    const menu = await openMenu(app);
    await expect(menuRow(menu, 'Тренування')).toContainText('✓ Було');
  });

  test('Вага and Заміри save from the menu and then show in it', async ({ app, server }) => {
    await app.goto('/');
    let sheet = await app.record('Вага');
    await sheet.getByRole('textbox', { name: 'Вага', exact: true }).fill('65,1');
    await app.save(sheet);

    sheet = await app.record('Заміри');
    await sheet.locator('input[name="waist"]').fill('69,5');
    await app.save(sheet);

    const menu = await openMenu(app);
    await expect(menuRow(menu, 'Вага')).toContainText('65,1 кг');
    await expect(menuRow(menu, 'Заміри')).toContainText('✓ записано');

    await expect
      .poll(async () => {
        const d = await server.getData();
        return {
          kg: d.weights.find((w) => w.date === TODAY)?.kg,
          measure: d.measures.find((m) => m.date === TODAY),
          day: d.days[TODAY],
        };
      })
      .toEqual({
        kg: 65.1,
        measure: { date: TODAY, chest: null, waist: 69.5, hips: null },
        day: { food: 'Вівсянка з бананом, кава', kcal: null, trained: null, types: [], notes: '' },
      });
  });

  test('«Повний запис дня» swaps to the whole «Запис дня»', async ({ app }) => {
    await app.goto('/');
    const sheet = await app.record('Повний запис дня');
    await expect(app.dialogs).toHaveCount(1);
    await expect(sheet).toContainText('14 жовтня 2026');
    await expect(sheet.getByRole('group', { name: 'Тренування' }).first()).toBeVisible();
    for (const name of ['Що я їла', 'Калорії за день', 'Вага (за бажанням)', 'Нотатки']) {
      await expect(sheet.getByRole('textbox', { name, exact: true })).toBeVisible();
    }
    for (const field of ['chest', 'waist', 'hips'])
      await expect(sheet.locator(`input[name="${field}"]`)).toBeVisible();
    await expect(sheet.getByRole('button', { name: '+ Нотатка до дня' })).toHaveCount(0);
  });

  test('desktop: «+ Записати день» opens the menu as a centred modal ≤ 560px; Tab order; Enter swaps in place', async ({
    app,
    page,
    isMobile,
  }) => {
    test.skip(isMobile, 'desktop layout');
    await app.goto('/');
    await expect(app.recordButton()).toHaveText(/Записати день/);
    const menu = await openMenu(app);
    await settled(menu);
    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    if (!box || !viewport) throw new Error('no layout');
    expect(box.width).toBeLessThanOrEqual(560);
    expect(Math.abs(box.x + box.width / 2 - viewport.width / 2)).toBeLessThanOrEqual(2);
    expect(Math.abs(box.y + box.height / 2 - viewport.height / 2)).toBeLessThanOrEqual(2);

    // ✕ → Їжа → Тренування → Вага → Заміри → Повний запис дня.
    await expect(menu).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('button', { name: 'Закрити' })).toBeFocused();
    for (const title of MENU_ROWS) {
      await page.keyboard.press('Tab');
      await expect(menuRow(menu, title)).toBeFocused();
    }
    await page.keyboard.press('Tab');
    await expect(menu.getByRole('button', { name: 'Повний запис дня' })).toBeFocused();

    for (let i = 0; i < 4; i++) await page.keyboard.press('Shift+Tab');
    await expect(menuRow(menu, 'Їжа')).toBeFocused();
    await menu.evaluate((el) => el.setAttribute('data-e2e-swap', 'same'));
    await page.keyboard.press('Enter');
    const food = app.sheet('Їжа');
    await expect(food).toHaveAttribute('data-e2e-swap', 'same');
    await expect(app.dialogs).toHaveCount(1);
    await expect(food).toBeFocused();
    const formBox = await food.boundingBox();
    expect(formBox?.width ?? 0).toBeLessThanOrEqual(560);
  });

  test.describe('a brand-new account (setup not done yet)', () => {
    test.use({ seed: 'empty' });

    test('no «За планом» / «Сьогодні» pills from the default plan, like Home', async ({ app }) => {
      await app.goto('/');
      // The first-run setup opens by itself; close it without saving.
      await expect(app.sheet('Перші кроки')).toBeVisible();
      await app.sheet('Перші кроки').getByRole('button', { name: 'Закрити' }).click();
      await app.expectSheetClosed();
      // The demo Wednesday is a default workout day; Home does not nag before the setup.
      await expect(app.homeRow('Тренування')).toContainText('Ще не відмічено');

      const menu = await openMenu(app);
      await expect(menuRow(menu, 'Тренування')).not.toContainText('За планом');
      await expect(menu).not.toContainText('За планом');
      await expect(menu).not.toContainText('Сьогодні');
    });
  });
});
