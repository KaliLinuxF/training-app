/**
 * Meals (docs/meals-macros.md §7.1–§7.6): «+» → «Їжа» opens a new meal right away (type by the time of day, the
 * keyboard on «Що я їла»), the day's list «Їжа» with its totals, an old block becoming a typed meal, her own types,
 * deleting, ‹ › moving a new meal, the stacked sheets and the «Запис дня» food field.
 * Clock: Wed 14 Oct 2026 10:00 Kyiv. Demo seed: today is a legacy day «Вівсянка з бананом, кава» (no kcal); 13 Oct is
 * a meal day. The AI is off (status mocked), so the editor shows no AI row.
 */
import type { Locator, Page } from '@playwright/test';
import { MEALS_GOALS, MEALS_TODAY } from './fixtures/data';
import type { App } from './support/app';
import { TODAY } from './support/env';
import { mockFood } from './support/food';
import type { ServerApi } from './support/server';
import { expect, test } from './support/test';

const YESTERDAY = '2026-10-13';
const LEGACY_FOOD = 'Вівсянка з бананом, кава';

const mealText = (sheet: Locator) => sheet.getByRole('textbox', { name: 'Що я їла', exact: true });
const kcalInput = (sheet: Locator) => sheet.getByRole('textbox', { name: 'Калорії', exact: true });
const totalsCard = (sheet: Locator) => sheet.getByRole('region', { name: 'Підсумок дня', exact: true });
/** What the totals card shows for a value (VoiceOver reads a hidden «з» variant next to it). */
const shown = (card: Locator, text: RegExp) => card.locator('[aria-hidden="true"]').filter({ hasText: text });
const deleteQuestion = (page: Page) => page.getByRole('alertdialog', { name: 'Видалити прийом їжі?' });

/** No AI: the meal editor works with the text, the numbers and «Часті страви». */
const noAi = (page: Page) => mockFood(page, { status: { enabled: false, remainingToday: 0 } });

const serverDay = async (server: ServerApi, date: string) => (await server.getData()).days[date];

/** «Їжа за день» or a typed meal of the «Їжа» list, opened in the stacked editor. */
async function openMeal(app: App, list: Locator, title: string): Promise<Locator> {
  await app.mealRow(list, title).click();
  const editor = app.sheet('Прийом їжі');
  await expect(editor).toBeVisible();
  return editor;
}

test.describe('a new meal from «+»', () => {
  test('«+» → Їжа: «Прийом їжі» in the same dialog, «Сніданок» at 10:00, the keyboard on «Що я їла»', async ({
    app,
    page,
  }) => {
    await noAi(page);
    await app.goto('/');
    const sheet = await app.newMeal();
    await expect(app.dialogs).toHaveCount(1);
    await expect(sheet).toContainText('середа · сьогодні');
    await expect(app.mealType(sheet, 'Сніданок')).toHaveAttribute('aria-pressed', 'true');
    for (const other of ['Обід', 'Вечеря', 'Перекус'])
      await expect(app.mealType(sheet, other)).toHaveAttribute('aria-pressed', 'false');
    await expect(mealText(sheet)).toBeFocused();
    await expect(mealText(sheet)).toHaveValue('');
    // «Зберегти» waits for something to save and says why.
    const save = sheet.getByRole('button', { name: 'Зберегти', exact: true });
    await expect(save).toBeDisabled();
    await expect(sheet.getByText('Опиши, що їла, або додай калорії чи фото')).toBeVisible();
    // Untouched: Escape closes it without asking.
    await page.keyboard.press('Escape');
    await app.expectSheetClosed();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
  });

  test('text, kcal and «Білки» → «Зберегти»; the old day text becomes its own block; review and type it from Home', async ({
    app,
    page,
    server,
  }) => {
    await noAi(page);
    await app.goto('/');
    const sheet = await app.newMeal();
    await page.keyboard.type('Тост з тунцем');
    await kcalInput(sheet).fill('350');
    await sheet.getByRole('button', { name: /^\+ Б · Ж · В/ }).click();
    const protein = sheet.getByRole('textbox', { name: 'Білки', exact: true });
    await expect(protein).toBeFocused();
    await protein.fill('22,5');
    await app.saveMeal(sheet);
    await app.expectSheetClosed();

    await expect
      .poll(async () => {
        const meals = (await serverDay(server, TODAY))?.meals ?? [];
        return meals.map(({ id, type, text, kcal }) => ({ legacy: id === 'legacy', type, text, kcal }));
      })
      .toEqual([
        { legacy: false, type: 'Сніданок', text: 'Тост з тунцем', kcal: 350 },
        { legacy: true, type: '', text: LEGACY_FOOD, kcal: null },
      ]);
    const saved = (await serverDay(server, TODAY))?.meals?.[0];
    expect(saved).toMatchObject({ protein: 22.5, fat: null, carbs: null });
    expect(saved?.time).toMatch(/^10:0\d$/);

    // Home «Їжа» → the day's list: the new meal and the old block «Їжа за день».
    await expect(app.homeRow('Їжа')).toContainText('350');
    const list = await app.openFoodDay();
    await expect(totalsCard(list)).toContainText('350 / 1 700 ккал');
    await expect(app.mealRow(list, 'Сніданок')).toHaveAccessibleName(
      /^Сніданок о 10:0\d: тост з тунцем\. 350\sккал, білки 23 г$/,
    );
    await expect(app.mealRow(list, 'Їжа за день')).toBeVisible();
    await expect(app.mealList(list)).toContainText(
      'Запис зі старої версії — відкрий його, щоб обрати тип прийому.',
    );

    // The old block opens stacked over the list; a type makes it a meal like any other.
    const legacy = await openMeal(app, list, 'Їжа за день');
    await expect(app.dialogs).toHaveCount(2);
    await expect(mealText(legacy)).toHaveValue(LEGACY_FOOD);
    await expect(mealText(legacy)).not.toBeFocused();
    await expect(legacy).toContainText(
      'Це запис зі старої версії. Обери тип — і він стане окремим прийомом їжі.',
    );
    await app.mealType(legacy, 'Обід').click();
    await expect(app.mealType(legacy, 'Обід')).toHaveAttribute('aria-pressed', 'true');
    await app.saveMeal(legacy);
    await expect(app.sheet('Їжа')).toBeVisible();
    await expect(app.mealRow(list, 'Обід')).toBeVisible();
    await expect(app.mealRow(list, 'Їжа за день')).toHaveCount(0);
    await expect
      .poll(async () => (await serverDay(server, TODAY))?.meals?.find((m) => m.id === 'legacy')?.type)
      .toBe('Обід');
  });

  test('«+ Свій» adds her own type to the list and selects it', async ({ app, page, server }) => {
    await noAi(page);
    await app.goto('/');
    const sheet = await app.newMeal();
    await sheet.getByRole('button', { name: 'Додати свій тип прийому їжі', exact: true }).click();
    const name = sheet.getByRole('textbox', { name: 'Новий тип прийому їжі', exact: true });
    await expect(name).toBeFocused();
    await name.fill('Після тренування');
    await sheet.getByRole('button', { name: 'Додати тип', exact: true }).click();
    await expect(app.mealType(sheet, 'Після тренування')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.mealType(sheet, 'Сніданок')).toHaveAttribute('aria-pressed', 'false');
    await expect
      .poll(async () => (await server.getData()).settings.mealTypes)
      .toEqual(['Сніданок', 'Обід', 'Вечеря', 'Перекус', 'Після тренування']);

    await mealText(sheet).fill('Протеїновий коктейль');
    await app.saveMeal(sheet);
    await expect
      .poll(
        async () =>
          (await serverDay(server, TODAY))?.meals?.find((m) => m.text === 'Протеїновий коктейль')?.type,
      )
      .toBe('Після тренування');
  });

  test('‹ moves the typed draft to yesterday without asking: no time there, the first type not logged yet', async ({
    app,
    page,
    server,
  }) => {
    await noAi(page);
    await app.goto('/');
    const sheet = await app.newMeal();
    await page.keyboard.type('Суп');
    await expect(sheet.getByRole('button', { name: 'Прибрати час', exact: true })).toBeVisible();

    await sheet.getByRole('button', { name: 'Попередній день' }).click();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    await expect(sheet).toContainText('13 жовтня 2026');
    await expect(sheet).toContainText('вівторок');
    await expect(mealText(sheet)).toHaveValue('Суп');
    // 13 Oct already has its breakfast, lunch and dinner.
    await expect(app.mealType(sheet, 'Перекус')).toHaveAttribute('aria-pressed', 'true');
    await expect(sheet.getByRole('button', { name: 'Прибрати час', exact: true })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: '+ Час', exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Наступний день' })).toBeEnabled();

    await app.saveMeal(sheet);
    await expect
      .poll(async () => (await serverDay(server, YESTERDAY))?.meals?.find((m) => m.text === 'Суп'))
      .toMatchObject({ type: 'Перекус', time: null });
    // Today is untouched.
    expect((await serverDay(server, TODAY))?.meals).toBeUndefined();
  });

  test('«Усі прийоми за день →» swaps the editor to the day’s list (asking first when she typed)', async ({
    app,
    page,
  }) => {
    await noAi(page);
    await app.goto('/');
    const sheet = await app.newMeal();
    await page.keyboard.type('Чай');
    await sheet.evaluate((el) => el.setAttribute('data-e2e-swap', 'same'));
    await sheet.getByRole('button', { name: 'Усі прийоми за день →', exact: true }).click();
    const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    await expect(ask).toContainText('Закрити без збереження?');
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
    const list = app.sheet('Їжа');
    await expect(list).toHaveAttribute('data-e2e-swap', 'same');
    await expect(app.dialogs).toHaveCount(1);
    await expect(app.mealRow(list, 'Їжа за день')).toBeVisible();
  });
});

test.describe('the day’s list «Їжа» (seed: meals)', () => {
  test.use({ seed: 'meals' });

  test('the totals card: kcal against the goal, Б · Ж · В against her goals, the partial note', async ({
    app,
    page,
  }) => {
    expect(MEALS_GOALS).toEqual({ protein: 90, fat: 60, carbs: null });
    await noAi(page);
    await app.goto('/');
    const list = await app.openFoodDay();
    const card = totalsCard(list);
    await expect(card).toContainText('460 / 1 700 ккал');
    await expect(card).toContainText('Залишилось 1 240 з 1 700 ккал');
    await expect(shown(card, /^12 \/ 90 г$/)).toHaveCount(1);
    await expect(shown(card, /^9 \/ 60 г$/)).toHaveCount(1);
    await expect(shown(card, /^63 г$/)).toHaveCount(1);
    // VoiceOver reads «з» instead of the slash.
    await expect(card.getByRole('definition').filter({ hasText: '12 з 90 г' })).toHaveCount(1);
    // The apple has energy but no macros: the sums are what is known.
    await expect(card).toContainText('Б · Ж · В пораховано не для всіх прийомів');

    const rows = app.mealList(list).getByRole('button');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toHaveAccessibleName(
      /^Сніданок о 08:15: вівсянка з бананом, кава з молоком\. 380\sккал, білки 12, жири 9, вуглеводи 63 г$/,
    );
    await expect(rows.nth(1)).toHaveAccessibleName(/^Перекус о 09:40: яблуко\. 80\sккал$/);
    await expect(rows.nth(0)).toContainText(/Б\s12\s·\sЖ\s9\s·\sВ\s63\sг/);
    await expect(app.addMealButton(list)).toHaveText('+ Прийом їжі');
    // Every row is at least 44px tall.
    for (const i of [0, 1]) expect((await rows.nth(i).boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
  });

  test('«+ Прийом їжі» stacks a new meal above the list with the keyboard on «Що я їла»', async ({
    app,
    page,
    server,
  }) => {
    await noAi(page);
    await app.goto('/');
    const list = await app.openFoodDay();
    await app.addMealButton(list).click();
    const editor = app.sheet('Прийом їжі');
    await expect(editor).toBeVisible();
    await expect(app.dialogs).toHaveCount(2);
    await expect(mealText(editor)).toBeFocused();
    // Breakfast and the snack are logged; at 10:00 the snack type comes next.
    await expect(app.mealType(editor, 'Перекус')).toHaveAttribute('aria-pressed', 'true');
    await page.keyboard.type('Горіхи');
    await kcalInput(editor).fill('120');
    await app.saveMeal(editor);
    await expect(list).toBeVisible();
    await expect(app.mealList(list).getByRole('button')).toHaveCount(3);
    await expect(totalsCard(list)).toContainText('580 / 1 700 ккал');
    await expect
      .poll(async () => (await serverDay(server, TODAY))?.meals?.map((m) => m.type))
      .toEqual(['Сніданок', 'Перекус', 'Перекус']);
  });

  test('a meal’s type changes; tapping the selected chip again keeps it', async ({ app, page, server }) => {
    await noAi(page);
    await app.goto('/');
    const list = await app.openFoodDay();
    const editor = await openMeal(app, list, 'Перекус');
    await app.mealType(editor, 'Перекус').click();
    await expect(app.mealType(editor, 'Перекус')).toHaveAttribute('aria-pressed', 'true');
    await app.mealType(editor, 'Обід').click();
    await expect(app.mealType(editor, 'Обід')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.mealType(editor, 'Перекус')).toHaveAttribute('aria-pressed', 'false');
    await app.mealType(editor, 'Обід').click();
    await expect(app.mealType(editor, 'Обід')).toHaveAttribute('aria-pressed', 'true');
    await app.saveMeal(editor);
    await expect(app.mealRow(list, 'Обід')).toBeVisible();
    await expect
      .poll(async () => (await serverDay(server, TODAY))?.meals?.find((m) => m.id === 'e2eSnack0001')?.type)
      .toBe('Обід');
  });

  test('«Видалити прийом» asks, then removes the meal from the list and the server', async ({
    app,
    page,
    server,
  }) => {
    await noAi(page);
    await app.goto('/');
    const list = await app.openFoodDay();
    const editor = await openMeal(app, list, 'Перекус');
    await editor.getByRole('button', { name: 'Видалити прийом', exact: true }).click();
    const ask = deleteQuestion(page);
    await expect(ask).toContainText(/Перекус · 80\sккал/);
    // «Залишити» keeps it.
    await ask.getByRole('button', { name: 'Залишити', exact: true }).click();
    await expect(ask).toBeHidden();
    await expect(editor).toBeVisible();

    await editor.getByRole('button', { name: 'Видалити прийом', exact: true }).click();
    await deleteQuestion(page).getByRole('button', { name: 'Видалити', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(app.toast('Прийом видалено')).toBeVisible();
    await expect(app.mealRow(list, 'Перекус')).toHaveCount(0);
    await expect(totalsCard(list)).toContainText('380 / 1 700 ккал');
    await expect
      .poll(async () => (await serverDay(server, TODAY))?.meals?.map((m) => m.id))
      .toEqual([MEALS_TODAY[0]?.id]);
  });

  test('three stacked sheets: «Їжа» → «Прийом їжі» → «Нова позиція»; Escape closes only the top one', async ({
    app,
    page,
  }) => {
    await noAi(page);
    await app.goto('/');
    const list = await app.openFoodDay();
    const editor = await openMeal(app, list, 'Сніданок');
    await editor.getByRole('button', { name: '+ позиція', exact: true }).click();
    const position = app.sheet('Нова позиція');
    await expect(position).toBeVisible();
    await expect(app.dialogs).toHaveCount(3);

    await page.keyboard.press('Escape');
    await expect(position).toBeHidden();
    await expect(editor).toBeVisible();
    await expect(list).toBeVisible();
    await expect(app.dialogs).toHaveCount(2);

    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(list).toBeVisible();
    await expect(page.getByRole('alertdialog')).toHaveCount(0);
    // Focus is back on the row that opened the editor.
    await expect(app.mealRow(list, 'Сніданок')).toBeFocused();

    await page.keyboard.press('Escape');
    await app.expectSheetClosed();
  });

  test('«Запис дня»: the same meal rows (app.mealList), the day total, a stacked editor; its save keeps the meals', async ({
    app,
    page,
    server,
  }) => {
    await noAi(page);
    await app.goto('/');
    await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
    const day = app.sheet('Запис дня');
    await expect(day).toBeVisible();
    await expect(app.mealList(day).getByRole('button')).toHaveCount(2);
    await expect(app.mealRow(day, 'Сніданок')).toBeVisible();
    await expect(app.mealRow(day, 'Перекус')).toBeVisible();
    await expect(day).toContainText(/Разом\s460\s\/\s1\s700\sккал\s·\sБ\s12\s·\sЖ\s9\s·\sВ\s63\sг/);
    await expect(day.getByRole('textbox', { name: 'Що я їла', exact: true })).toHaveCount(0);
    await expect(day.getByRole('textbox', { name: 'Калорії за день', exact: true })).toHaveCount(0);

    await app.mealRow(day, 'Перекус').click();
    const editor = app.sheet('Прийом їжі');
    await expect(editor).toBeVisible();
    await expect(app.dialogs).toHaveCount(2);
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();

    await day.getByRole('button', { name: 'Було', exact: true }).click();
    await day.getByRole('textbox', { name: 'Нотатки', exact: true }).fill('Легко');
    await app.save(day);
    await expect.poll(async () => (await server.getData()).days[TODAY]?.notes).toBe('Легко');
    const stored = (await server.getData()).days[TODAY];
    expect(stored?.meals).toEqual(MEALS_TODAY);
    expect(stored).toMatchObject({ trained: true, kcal: 460 });
  });
});
