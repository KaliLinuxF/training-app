import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test';

const monthTitle = (page: Page) => page.getByRole('heading', { level: 2, name: /^\S+ 2026$/ });
/** The month grid (`role=group` named by the month title). */
const grid = (page: Page) => page.getByRole('group', { name: /^\S+ 2026$/ });
/** The header shortcut back to today (exact: day cells contain «сьогодні» too). */
const todayShortcut = (page: Page) => page.getByRole('button', { name: 'Сьогодні', exact: true });
/** A row of the day card; its short name starts with the row title («Вага: 65,7 кг»). */
const row = (day: Locator, title: 'Їжа' | 'Тренування' | 'Кроки' | 'Вага' | 'Заміри' | 'Нотатки') =>
  day.getByRole('button', { name: new RegExp(`^${title}`) });

/** 7 October is a legacy day (logged before meals existed): one food text, 1 880 ккал (over the 1 700 goal). */
const OCT7_FOOD = 'Омлет, борщ, курка з рисом, кефір';
/** 13 October is logged as three typed meals (demo seed, meals doc §6.5 / §7.8): 1 740 ккал in all. */
const OCT13_MEALS = [
  { type: 'Сніданок', time: '08:30', text: 'Тост з авокадо', kcal: 520, protein: 23, fat: 17, carbs: 68 },
  { type: 'Обід', time: '13:00', text: 'Салат з куркою', kcal: 700, protein: 49, fat: 25, carbs: 70 },
  { type: 'Вечеря', time: '19:30', text: 'Індичка з броколі', kcal: 520, protein: 42, fat: 20, carbs: 43 },
];
/** Its Їжа row: one line per meal, then the day's «Б · Ж · В» (text matching treats NO-BREAK SPACEs as spaces). */
const OCT13_LINES = [
  'Сніданок · 520 ккал · Тост з авокадо',
  'Обід · 700 ккал · Салат з куркою',
  'Вечеря · 520 ккал · Індичка з броколі',
  'Б 114 · Ж 62 · В 181 г',
];
/** 1 740 is over the default 1 700 goal: the short name says so after the meal count. */
const OCT13_FOOD_NAME = 'Їжа: 1 740 ккал, 3 прийоми, більше цілі';
const NOTES = 'Гарне самопочуття, випила 2 л води';

test.describe('calendar', () => {
  test('month navigation: back and forth, no future months, picking a day', async ({ app, page }) => {
    await app.goto('/calendar');
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    const prevMonth = page.getByRole('button', { name: 'Попередній місяць' });
    const nextMonth = page.getByRole('button', { name: 'Наступний місяць' });
    await expect(nextMonth).toBeDisabled();
    await expect(todayShortcut(page)).toBeHidden();
    await expect(page.getByText('Останні записи')).toHaveCount(0);

    const today = grid(page).getByRole('button', { name: /^14 жовтня, сьогодні/ });
    await expect(today).toHaveAttribute('aria-current', 'date');
    await expect(today).toHaveAttribute('aria-pressed', 'true');
    // Marks: fill for food / workout, a dot for weigh-in or measurements.
    await expect(
      grid(page).getByRole('button', { name: '5 жовтня, вага або заміри', exact: true }),
    ).toBeVisible();
    await expect(
      grid(page).getByRole('button', {
        name: '12 жовтня, тренування, їжа, вага або заміри',
        exact: true,
      }),
    ).toBeVisible();
    await expect(grid(page).getByRole('button', { name: '8 жовтня', exact: true })).toBeVisible();
    // Future days are not buttons.
    await expect(grid(page).getByRole('button', { name: /^15 жовтня/ })).toHaveCount(0);
    await expect(app.region('14 жовтня 2026')).toContainText('середа · сьогодні');
    // Legend wording: «Їжа».
    const monthCard = app.region('Жовтень 2026');
    await expect(monthCard).toContainText('Їжа');
    await expect(monthCard).not.toContainText('Харчування');

    // ‹ › only move the shown month (prototype `prevMonth` / `nextMonth`): the selected day,
    // its card and the URL stay; no cell is highlighted in a month without the selection.
    await prevMonth.click();
    await expect(monthTitle(page)).toHaveText('Вересень 2026');
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(app.region('14 жовтня 2026')).toContainText('середа · сьогодні');
    await expect(grid(page).locator('button[aria-pressed="true"]')).toHaveCount(0);
    await expect(nextMonth).toBeEnabled();

    await grid(page)
      .getByRole('button', { name: /^14 вересня/ })
      .click();
    await expect(page).toHaveURL(/\/calendar\?date=2026-09-14$/);
    await expect(app.region('14 вересня 2026')).toContainText('Верх тіла, Прес');

    await prevMonth.click();
    await expect(monthTitle(page)).toHaveText('Серпень 2026');
    await expect(app.region('14 вересня 2026')).toBeVisible();
    await grid(page)
      .getByRole('button', { name: /^3 серпня/ })
      .click();
    await expect(page).toHaveURL(/date=2026-08-03$/);
    const aug3 = app.region('3 серпня 2026');
    await expect(aug3).toContainText('понеділок');
    await expect(row(aug3, 'Вага')).toHaveAccessibleName('Вага: 68,3 кг');
    await expect(aug3).toContainText('Груди 93 · Талія 74,5 · Стегна 101');
    await expect(row(aug3, 'Заміри')).toHaveAccessibleName('Заміри: груди 93, талія 74,5, стегна 101');
    await expect(aug3).toContainText('1 700 ккал');

    await nextMonth.click();
    await nextMonth.click();
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(nextMonth).toBeDisabled();
    // Still 3 August: browsing never re-selects a day.
    await expect(page).toHaveURL(/date=2026-08-03$/);
    await expect(aug3).toBeVisible();
    await expect(grid(page).locator('button[aria-pressed="true"]')).toHaveCount(0);
  });

  test('?date= deep link selects the day; invalid or future dates fall back to today', async ({
    app,
    page,
  }) => {
    await app.goto('/calendar?date=2026-10-07');
    const day = app.region('7 жовтня 2026');
    await expect(day).toContainText('середа');
    await expect(day).toContainText('Заповнено');
    await expect(day).toContainText(OCT7_FOOD);
    await expect(day).toContainText('1 880 ккал');
    await expect(day).toContainText('Низ тіла, Прес');
    await expect(day).not.toContainText('—');
    // Short spoken names; the food text is the row's description. A legacy day keeps its one text (no meal count).
    await expect(row(day, 'Їжа')).toHaveAccessibleName('Їжа: 1 880 ккал, більше цілі');
    await expect(row(day, 'Їжа')).toHaveAccessibleDescription(OCT7_FOOD);
    await expect(row(day, 'Тренування')).toHaveAccessibleName('Тренування: було, Низ тіла, Прес');
    await expect(grid(page).getByRole('button', { name: /^7 жовтня/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // The Їжа row opens that day's «Їжа»: the day's total against the goal, the legacy block as one entry.
    await row(day, 'Їжа').click();
    const food = app.sheet('Їжа');
    await expect(food).toContainText('7 жовтня 2026');
    await expect(food).toContainText('1 880 / 1 700 ккал');
    await expect(app.mealRow(food, 'Їжа за день')).toHaveCount(1);
    await food.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await expect(row(day, 'Їжа')).toBeFocused();

    // «Редагувати день» opens that day (not today); its food block lists the same entry and the day's total.
    await day.getByRole('button', { name: 'Редагувати день' }).click();
    const sheet = app.sheet('Запис дня');
    await expect(sheet).toContainText('7 жовтня 2026');
    await expect(sheet).toContainText('1 880 / 1 700 ккал');
    await expect(app.mealRow(sheet, 'Їжа за день')).toHaveCount(1);
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    // A day without a record, but with a weigh-in and measurements.
    await app.goto('/calendar?date=2026-10-05');
    const oct5 = app.region('5 жовтня 2026');
    await expect(oct5).toContainText('Порожньо');
    await expect(row(oct5, 'Вага')).toHaveAccessibleName('Вага: 65,7 кг');
    await expect(row(oct5, 'Їжа')).toHaveAccessibleName('Їжа: додати');
    await expect(oct5.getByRole('button', { name: 'Заповнити день' })).toBeVisible();

    for (const bad of ['2026-12-01', '2026-02-30', 'yesterday']) {
      await app.goto(`/calendar?date=${bad}`);
      await expect(app.region('14 жовтня 2026')).toBeVisible();
      await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    }
  });

  test('«Сьогодні» comes back to today from another day or another month', async ({ app, page }) => {
    await app.goto('/calendar');
    await expect(todayShortcut(page)).toBeHidden();

    await grid(page)
      .getByRole('button', { name: /^5 жовтня/ })
      .click();
    await expect(page).toHaveURL(/date=2026-10-05$/);
    await page.getByRole('button', { name: 'Попередній місяць' }).click();
    await expect(monthTitle(page)).toHaveText('Вересень 2026');
    await todayShortcut(page).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(app.region('14 жовтня 2026')).toBeVisible();
    await expect(grid(page).getByRole('button', { name: /^14 жовтня/ })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(todayShortcut(page)).toBeHidden();

    // Browsing alone (today still selected) shows it too.
    await page.getByRole('button', { name: 'Попередній місяць' }).click();
    await expect(todayShortcut(page)).toBeVisible();
    await todayShortcut(page).click();
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(todayShortcut(page)).toBeHidden();
  });

  test('keyboard: focus never falls to <body> when «Сьогодні» hides or › turns disabled', async ({
    app,
    page,
  }) => {
    await app.goto('/calendar?date=2026-10-05');
    // «Сьогодні» hides itself once pressed: today's cell takes its focus.
    await todayShortcut(page).focus();
    await page.keyboard.press('Enter');
    await expect(todayShortcut(page)).toBeHidden();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(grid(page).getByRole('button', { name: /^14 жовтня/ })).toBeFocused();

    // › into the current month turns disabled: ‹ takes its focus.
    const prevMonth = page.getByRole('button', { name: 'Попередній місяць' });
    const nextMonth = page.getByRole('button', { name: 'Наступний місяць' });
    await prevMonth.click();
    await expect(monthTitle(page)).toHaveText('Вересень 2026');
    await nextMonth.focus();
    await page.keyboard.press('Enter');
    await expect(monthTitle(page)).toHaveText('Жовтень 2026');
    await expect(nextMonth).toBeDisabled();
    await expect(prevMonth).toBeFocused();
  });

  test('day rows open their short sheets for that date; closing returns focus to the row', async ({
    app,
    page,
  }) => {
    await app.goto('/calendar?date=2026-10-05');
    const oct5 = app.region('5 жовтня 2026');
    // Every row (and the footer) announces the dialog it opens, like Home's rows; the inline ✓ / ✕ do not.
    for (const title of ['Їжа', 'Тренування', 'Кроки', 'Вага', 'Заміри'] as const) {
      await expect(row(oct5, title)).toHaveAttribute('aria-haspopup', 'dialog');
    }
    await expect(oct5.getByRole('button', { name: 'Заповнити день' })).toHaveAttribute(
      'aria-haspopup',
      'dialog',
    );
    for (const name of ['Було', 'Не було']) {
      await expect(oct5.getByRole('button', { name, exact: true })).not.toHaveAttribute('aria-haspopup');
    }
    await row(oct5, 'Вага').click();
    const weight = app.sheet('Контрольне зважування');
    await expect(weight).toContainText('5 жовтня 2026');
    await expect(weight.getByRole('textbox', { name: 'Вага', exact: true })).toHaveValue('65,7');
    await weight.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await expect(row(oct5, 'Вага')).toBeFocused();

    await app.goto('/calendar?date=2026-10-13');
    const oct13 = app.region('13 жовтня 2026');
    await expect(row(oct13, 'Заміри')).toHaveAccessibleName('Заміри: додати');
    await expect(row(oct13, 'Заміри')).toContainText('Додати');
    await row(oct13, 'Заміри').click();
    const measure = app.sheet('Заміри тіла');
    await expect(measure).toContainText('13 жовтня 2026');
    await measure.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    // The meal lines and the notes stay audible as the rows' descriptions.
    await expect(row(oct13, 'Їжа')).toHaveAccessibleName(OCT13_FOOD_NAME);
    await expect(row(oct13, 'Їжа')).toHaveAccessibleDescription(OCT13_LINES.join(' '));
    await expect(row(oct13, 'Нотатки')).toHaveAccessibleName('Нотатки');
    await expect(row(oct13, 'Нотатки')).toHaveAccessibleDescription(NOTES);

    // Їжа opens that day's list of meals.
    await row(oct13, 'Їжа').click();
    const food = app.sheet('Їжа');
    await expect(food).toContainText('13 жовтня 2026');
    await expect(food).toContainText('1 740 / 1 700 ккал');
    for (const type of ['Сніданок', 'Обід', 'Вечеря']) {
      await expect(app.mealRow(food, type)).toHaveCount(1);
    }
    await expect(app.mealRow(food, 'Сніданок')).toContainText('Тост з авокадо');
    await expect(app.mealRow(food, 'Обід')).toContainText('Салат з куркою');
    await expect(app.mealRow(food, 'Вечеря')).toContainText('Індичка з броколі');
    await food.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await expect(row(oct13, 'Їжа')).toBeFocused();

    await row(oct13, 'Тренування').click();
    const workout = app.sheet('Тренування');
    await expect(workout).toContainText('13 жовтня 2026');
    await workout.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await expect(row(oct13, 'Тренування')).toBeFocused();
    await expect(page).toHaveURL(/date=2026-10-13$/);
  });

  test('a day with meals: one line per meal and the day’s Б · Ж · В, never wrapped at 390 or 320', async ({
    app,
    page,
  }) => {
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 800 });
      await app.goto('/calendar?date=2026-10-13');
      const oct13 = app.region('13 жовтня 2026');
      const food = row(oct13, 'Їжа');
      await expect(food).toHaveAccessibleName(OCT13_FOOD_NAME);
      await expect(food).toContainText('1 740 ккал');
      for (const text of OCT13_LINES) {
        const line = food.getByText(text, { exact: true });
        await expect(line).toBeVisible();
        // One line tall: a wrapped line would be about twice its line height (an ellipsis cuts it instead).
        const box = await line.boundingBox();
        const lineHeight = await line.evaluate((el) => parseFloat(getComputedStyle(el).lineHeight));
        expect(box, `${text} at ${width}px`).not.toBeNull();
        expect(box?.height ?? Infinity, `${text} at ${width}px`).toBeLessThan(lineHeight * 1.5);
      }
      // The lines sit in their order under the title, inside the row.
      const tops = await Promise.all(
        OCT13_LINES.map(async (text) => (await food.getByText(text, { exact: true }).boundingBox())?.y ?? 0),
      );
      expect(tops).toEqual([...tops].sort((a, b) => a - b));
      const [rowBox, lastBox] = await Promise.all([
        food.boundingBox(),
        food.getByText(OCT13_LINES.at(-1) ?? '', { exact: true }).boundingBox(),
      ]);
      expect(rowBox && lastBox && lastBox.x + lastBox.width <= rowBox.x + rowBox.width).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
  });

  test('an empty past day: «Додати» on Їжа opens a new meal for that date', async ({ app }) => {
    await app.goto('/calendar?date=2026-10-05');
    const oct5 = app.region('5 жовтня 2026');
    await expect(row(oct5, 'Їжа')).toHaveAccessibleName('Їжа: додати');
    await expect(row(oct5, 'Їжа')).toContainText('Додати');
    await row(oct5, 'Їжа').click();

    const meal = app.sheet('Прийом їжі');
    await expect(meal).toContainText('5 жовтня 2026');
    // Nothing logged that day yet: the first type is preselected, the text takes focus (keyboard up on the phone).
    await expect(app.mealType(meal, 'Сніданок')).toHaveAttribute('aria-pressed', 'true');
    await expect(meal.getByRole('textbox', { name: 'Що я їла' })).toBeFocused();
    await meal.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await expect(row(oct5, 'Їжа')).toBeFocused();
    await expect(row(oct5, 'Їжа')).toHaveAccessibleName('Їжа: додати');
  });

  test('the inline ✕ marks a past day without a sheet and survives a reload', async ({ app, server }) => {
    await app.goto('/calendar?date=2026-10-13');
    const oct13 = app.region('13 жовтня 2026');
    const toggle = oct13.getByRole('group', { name: 'Тренування за день' });
    const yes = toggle.getByRole('button', { name: 'Було', exact: true });
    const no = toggle.getByRole('button', { name: 'Не було', exact: true });
    await expect(yes).toHaveAttribute('aria-pressed', 'true');
    await expect(row(oct13, 'Тренування')).toHaveAccessibleName('Тренування: було, Кардіо');

    await no.click();
    await expect(app.toast('Відмічено: без тренування')).toBeVisible();
    await expect(no).toHaveAttribute('aria-pressed', 'true');
    await expect(yes).toHaveAttribute('aria-pressed', 'false');
    await expect(app.dialogs).toHaveCount(0);
    await expect(row(oct13, 'Тренування')).toHaveAccessibleName('Тренування: не було');
    // Only the mark changed on the server: the meals, their day total and the notes are as they were.
    await expect
      .poll(async () => (await server.getData()).days['2026-10-13'])
      .toMatchObject({ trained: false, types: [], meals: OCT13_MEALS, kcal: 1740, notes: NOTES });

    await app.reload();
    await expect(no).toHaveAttribute('aria-pressed', 'true');
    await expect(row(oct13, 'Тренування')).toHaveAccessibleName('Тренування: не було');
  });

  test('installed iPhone: a tapped day scrolls into view above the tab bar', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone viewport with the floating tab bar');
    // The installed app's viewport: 844 minus the status bar and home indicator.
    await page.setViewportSize({ width: 390, height: 763 });
    await app.goto('/calendar');

    for (const { cell, title, notes } of [
      { cell: /^12 жовтня/, title: '12 жовтня 2026', notes: null },
      { cell: /^13 жовтня/, title: '13 жовтня 2026', notes: NOTES },
    ]) {
      await grid(page).getByRole('button', { name: cell }).click();
      const day = app.region(title);
      const edit = day.getByRole('button', { name: 'Редагувати день' });
      // After the (smooth, unless reduced) scroll settles, the whole card sits above the tab bar.
      await expect
        .poll(async () => {
          const [button, bar] = await Promise.all([edit.boundingBox(), app.nav.boundingBox()]);
          return button && bar ? bar.y - (button.y + button.height) : -1;
        })
        .toBeGreaterThanOrEqual(0);
      await expect(day.getByRole('heading', { name: title })).toBeInViewport();
      if (notes) await expect(day).toContainText(notes);
      await expect(day).not.toContainText('—');
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
        ),
      ).toBeLessThanOrEqual(0);
    }
  });

  test('a brand-new account: the empty day offers «Додати» and the inline mark', async ({
    app,
    page,
    server,
  }) => {
    await server.importData({ ...(await server.getData()), days: {}, weights: [], measures: [], foods: [] });
    await app.goto('/calendar');
    const day = app.region('14 жовтня 2026');
    await expect(day).toContainText('Порожньо');
    for (const name of ['Їжа: додати', 'Вага: додати', 'Заміри: додати', 'Тренування: не відмічено']) {
      await expect(day.getByRole('button', { name, exact: true })).toBeVisible();
    }
    await expect(day).toContainText('Ще не відмічено');
    await expect(day.getByRole('button', { name: 'Було', exact: true })).toBeVisible();
    await expect(day.getByRole('button', { name: 'Не було', exact: true })).toBeVisible();
    await expect(day.getByRole('button', { name: /^Нотатки/ })).toHaveCount(0);
    await expect(day).not.toContainText('—');
    await expect(grid(page).getByRole('button', { name: '12 жовтня', exact: true })).toBeVisible();

    await day.getByRole('button', { name: 'Заповнити день' }).click();
    await expect(app.sheet('Запис дня')).toContainText('14 жовтня 2026');
  });
});
