/**
 * The meal editor «Прийом їжі» with the AI estimate (mocked) and «Часті страви»: positions with Б · Ж · В,
 * «Прибрати ці позиції», the item editor «Позиція» (rescale on the device, typed kcal, «✨ Перерахувати»),
 * photos, what reaches the server, hints, a saved meal reopened from the «Їжа» list, an old «Їжа за день» block
 * with kcal estimated (no double count), and the type chip row on a 390 / 320px phone («+ Свій» always on screen).
 * Clock: Wed 14 Oct 2026 10:00 (a new meal is «Сніданок»). Demo seed: today is a legacy day.
 */
import type { Locator, Page } from '@playwright/test';
import {
  foodEstimateRequestSchema,
  type FoodEstimateRequest,
  type FoodEstimateResponse,
  type FoodItem,
  type Meal,
} from '../packages/shared/src/index';
import type { App } from './support/app';
import { TODAY } from './support/env';
import { FOOD_JPEG, mockFood, PHOTO_ESTIMATE, PHOTO_ID, recalcAnswer, TEXT_ESTIMATE } from './support/food';
import { expect, test } from './support/test';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The meal's positions card. */
const positions = (sheet: Locator) => sheet.getByRole('region', { name: 'Позиції', exact: true });

/** A position — one button that opens its editor — by the start of its accessible name. */
const row = (card: Locator, name: string) =>
  card.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}, `) });

/** Position `n` (1-based) as VoiceOver reads it. */
const rowAt = (card: Locator, n: number) =>
  card
    .getByRole('listitem')
    .nth(n - 1)
    .getByRole('button');

const mealText = (sheet: Locator) => sheet.getByRole('textbox', { name: 'Що я їла', exact: true });
const countButton = (sheet: Locator) =>
  sheet.getByRole('button', { name: 'Порахувати калорії', exact: true });
const photoButton = (sheet: Locator) =>
  sheet.getByRole('button', { name: 'Порахувати калорії за фото', exact: true });
/** «Прибрати ці позиції»: its accessible name starts with what it shows (WCAG 2.5.3). */
const undoButton = (sheet: Locator) =>
  sheet.getByRole('button', { name: 'Прибрати ці позиції — останній підрахунок', exact: true });
const kcalInput = (sheet: Locator) => sheet.getByRole('textbox', { name: 'Калорії', exact: true });
const addTypeButton = (sheet: Locator) =>
  sheet.getByRole('button', { name: 'Додати свій тип прийому їжі', exact: true });

/** `locator` lies whole inside the page's viewport (read before anything scrolls it into view). */
async function expectInViewport(page: Page, locator: Locator, what: string): Promise<void> {
  const box = await locator.boundingBox();
  const view = page.viewportSize();
  expect(box, what).not.toBeNull();
  expect(view).not.toBeNull();
  if (!box || !view) return;
  expect(box.x, `${what}: left`).toBeGreaterThanOrEqual(0);
  expect(box.y, `${what}: top`).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width, `${what}: right`).toBeLessThanOrEqual(view.width);
  expect(box.y + box.height, `${what}: bottom`).toBeLessThanOrEqual(view.height);
}

/** The item editor stacked over the meal editor. */
const itemEditor = (page: Page, heading: 'Позиція' | 'Нова позиція' = 'Позиція') =>
  page.getByRole('dialog', { name: heading, exact: true });

/** Text of the visually hidden status region that announces progress, results and undo. */
const announced = (sheet: Locator, text: string) => sheet.getByRole('status').filter({ hasText: text });

/** «Б 11 · Ж 10 · В 47 г» with any spaces (the app keeps no-break spaces inside the parts). */
const macroLine = (p: number, f: number, c: number) =>
  new RegExp(`Б\\s${p}\\s·\\sЖ\\s${f}\\s·\\sВ\\s${c}\\sг`);

async function loaded(img: Locator): Promise<void> {
  await expect
    .poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth > 0))
    .toBe(true);
}

const isJpegBase64 = (b64: unknown): boolean =>
  typeof b64 === 'string' &&
  Buffer.from(b64, 'base64')
    .subarray(0, 3)
    .equals(Buffer.from([0xff, 0xd8, 0xff]));

/**
 * The estimate endpoint answering by mode: `estimate` for a text / photo estimate, the recalculation
 * (`recalcAnswer` of what was sent, priced by `price`) for «✨ Перерахувати». Registered after `mockFood`,
 * so it wins for that URL. Returns every request body.
 */
async function answerByMode(
  page: Page,
  estimate: (n: number) => FoodEstimateResponse,
  price: (req: FoodEstimateRequest) => FoodEstimateResponse = (req) =>
    recalcAnswer((req.items ?? []).map((it) => ({ ...it, kcal: 100, protein: 1, fat: 1, carbs: 1 }))),
): Promise<FoodEstimateRequest[]> {
  const bodies: FoodEstimateRequest[] = [];
  await page.route('**/api/food/estimate', async (route) => {
    const body = route.request().postDataJSON() as FoodEstimateRequest;
    bodies.push(body);
    const n = bodies.filter((b) => !b.items).length;
    await route.fulfill({ json: body.items ? price(body) : estimate(n) });
  });
  return bodies;
}

/** «+» → «Їжа» → the new-meal editor, «Що я їла» = `text`, «✨ Порахувати», the positions on screen. */
async function estimateMeal(app: App, text: string): Promise<Locator> {
  const sheet = await app.newMeal();
  await mealText(sheet).fill(text);
  await countButton(sheet).click();
  await expect(positions(sheet)).toBeVisible();
  return sheet;
}

/** «📷 Фото» → the system picker → the plate photo. */
async function pickPhoto(page: Page, sheet: Locator): Promise<void> {
  const chooser = page.waitForEvent('filechooser');
  await photoButton(sheet).click();
  const picker = await chooser;
  expect(picker.isMultiple()).toBe(false);
  await picker.setFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: FOOD_JPEG });
}

/** Opens a position, changes it in the editor and taps «Готово»; the editor slides away. */
async function editRow(page: Page, card: Locator, name: string, change: (editor: Locator) => Promise<void>) {
  await row(card, name).click();
  const editor = itemEditor(page);
  await expect(editor).toBeVisible();
  await change(editor);
  await editor.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(editor).toBeHidden();
}

const BORSHCH = 'Борщ, 300 г, 180 ккал, білки 6, жири 9, вуглеводи 19 г. Змінити';
const BREAD = 'Хліб житній, 2 скибки, 140 ккал, білки 5, жири 1, вуглеводи 28 г. Змінити';

test.describe('AI estimate in the meal editor (mocked)', () => {
  test('a text estimate: positions with Б · Ж · В and «Разом … · Б · Ж · В»', async ({ app, page }) => {
    const mocks = await mockFood(page);
    await app.goto('/');
    const sheet = await estimateMeal(app, 'борщ, хліб');
    expect(mocks.estimates).toEqual([{ date: TODAY, text: 'борщ, хліб' }]);
    await expect(app.mealType(sheet, 'Сніданок')).toHaveAttribute('aria-pressed', 'true');

    const card = positions(sheet);
    await expect(card.getByText('2 позиції · можна виправити')).toBeVisible();
    await expect(rowAt(card, 1)).toHaveAccessibleName(BORSHCH);
    await expect(rowAt(card, 2)).toHaveAccessibleName(BREAD);
    await expect(card).toContainText(/Разом\s*320\s*ккал/);
    await expect(card).toContainText(macroLine(11, 10, 47));
    await expect(announced(sheet, 'Знайдено 2 позиції, разом 320 ккал')).toHaveCount(1);
    // The positions are the meal's numbers: no manual «Калорії», and no «Додати N ккал» step.
    await expect(sheet.getByRole('textbox', { name: 'Калорії', exact: true })).toHaveCount(0);
    await expect(sheet.getByRole('button', { name: /^Додати \d+ ккал$/ })).toHaveCount(0);
    await expect(sheet.getByText(/За день:\s*320\s*\/\s*1\s700\s*ккал/)).toBeVisible();
  });

  test('«Прибрати ці позиції» takes the last estimate back', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const sheet = await estimateMeal(app, 'борщ, хліб');
    await expect(undoButton(sheet)).toHaveText('Прибрати ці позиції');
    await undoButton(sheet).click();
    await expect(positions(sheet)).toBeHidden();
    await expect(announced(sheet, 'Позиції прибрано')).toHaveCount(1);
    await expect(sheet.getByRole('textbox', { name: 'Калорії', exact: true })).toBeVisible();
    await expect(countButton(sheet)).toBeFocused();
    // Her text stays as she wrote it.
    await expect(mealText(sheet)).toHaveValue('борщ, хліб');
  });

  test('an old «Їжа за день» block with kcal: the estimate replaces her number, the day is not counted twice', async ({
    app,
    page,
    server,
  }) => {
    await mockFood(page);
    // Today as the old version left it: what she ate and its kcal, no meals.
    const put = await server.sendOps([
      {
        kind: 'day.put',
        date: TODAY,
        value: { food: 'борщ, хліб', kcal: 900, trained: null, types: [], notes: '' },
      },
    ]);
    expect(put.status()).toBe(200);
    await app.goto('/');
    const day = await app.openFoodDay();
    await app.mealRow(day, 'Їжа за день').click();
    const editor = app.sheet('Прийом їжі');
    await expect(editor).toBeVisible();
    await expect(kcalInput(editor)).toHaveValue('900');

    // Counted for Б · Ж · В: the positions are the meal's numbers, her 900 is not kept on top as «Інше».
    await countButton(editor).click();
    const card = positions(editor);
    await expect(card.getByRole('listitem')).toHaveCount(2);
    await expect(row(card, 'Інше')).toHaveCount(0);
    await expect(kcalInput(editor)).toHaveCount(0);
    await expect(editor.getByText(/За день:\s*320\s*\/\s*1\s700\s*ккал/)).toBeVisible();
    // Taken back: her number again.
    await undoButton(editor).click();
    await expect(kcalInput(editor)).toHaveValue('900');
    await expect(editor.getByText(/За день:\s*900\s*\/\s*1\s700\s*ккал/)).toBeVisible();

    // Counted again, typed «Обід» and saved: the day is the estimate's 320, not 900 + 320.
    await countButton(editor).click();
    await expect(positions(editor)).toBeVisible();
    await app.mealType(editor, 'Обід').click();
    await app.saveMeal(editor);
    await expect.poll(async () => (await server.getData()).days[TODAY]?.kcal).toBe(320);
    const meals = (await server.getData()).days[TODAY]?.meals;
    expect(meals).toHaveLength(1);
    expect(meals?.[0]).toMatchObject({
      id: 'legacy',
      type: 'Обід',
      text: 'борщ, хліб',
      kcal: 320,
      protein: 10.5,
      items: TEXT_ESTIMATE.items,
    });
  });

  test('a photo estimate attaches the photo and appends its positions', async ({ app, page, server }) => {
    await mockFood(page);
    const bodies = await answerByMode(page, (n) => (n === 1 ? TEXT_ESTIMATE : PHOTO_ESTIMATE));
    await app.goto('/');
    const sheet = await estimateMeal(app, 'борщ, хліб');
    await pickPhoto(page, sheet);

    const card = positions(sheet);
    await expect(card.getByRole('listitem')).toHaveCount(3);
    await expect(rowAt(card, 3)).toHaveAccessibleName(
      'Сирники зі сметаною, 3 шт, 420 ккал, білки 22, жири 22, вуглеводи 33 г. Змінити',
    );
    await expect(card).toContainText('Сметана — приблизно 2 ложки');
    await expect(card).toContainText(/Разом\s*740\s*ккал/);
    // Downscaled on the device and sent as JPEG; the counted text is not sent again.
    const sent = bodies[1] as FoodEstimateRequest & { image: { full: string; thumb: string } };
    expect(sent.date).toBe(TODAY);
    expect(sent.text).toBeUndefined();
    expect(isJpegBase64(sent.image.full)).toBe(true);
    expect(isJpegBase64(sent.image.thumb)).toBe(true);
    // The photo joins the meal.
    await loaded(sheet.locator(`img[src="/api/photos/${PHOTO_ID}/thumb"]`));
    await expect(sheet.getByRole('button', { name: 'Видалити фото' })).toBeVisible();

    await app.saveMeal(sheet);
    await expect
      .poll(
        async () => (await server.getData()).days[TODAY]?.meals?.find((m) => m.type === 'Сніданок')?.photos,
      )
      .toEqual([PHOTO_ID]);
  });

  test('the photo button sits above «Що я їла» with the count button (the keyboard never covers them)', async ({
    app,
    page,
  }) => {
    await mockFood(page);
    await app.goto('/');
    const sheet = await app.newMeal();
    await expect(mealText(sheet)).toBeFocused();
    const text = await mealText(sheet).boundingBox();
    for (const button of [countButton(sheet), photoButton(sheet)]) {
      const box = await button.boundingBox();
      expect(box && text && box.y + box.height <= text.y).toBe(true);
    }
  });
});

test.describe('Correcting positions', () => {
  test('an amount change in «Позиція» rescales kcal and macros on the device, without a request', async ({
    app,
    page,
  }) => {
    const mocks = await mockFood(page);
    await app.goto('/');
    const sheet = await estimateMeal(app, 'борщ, хліб');
    const card = positions(sheet);
    await editRow(page, card, 'Борщ', async (editor) => {
      await editor.getByRole('textbox', { name: 'Скільки', exact: true }).fill('450');
      await expect(editor).toContainText(/270\s*ккал/);
      await expect(editor).toContainText(/Б\s9\s·\sЖ\s13,5\s·\sВ\s28,5\sг/);
      await expect(editor.getByText('перераховано за вагою')).toBeVisible();
    });
    await expect(rowAt(card, 1)).toHaveAccessibleName(
      'Борщ, 450 г, 270 ккал, білки 9, жири 14, вуглеводи 29 г. Змінити',
    );
    await expect(card.getByRole('button', { name: 'Перерахувати' })).toHaveCount(0);
    expect(mocks.estimates).toHaveLength(1);
    // Edited: no more taking that estimate back.
    await expect(undoButton(sheet)).toHaveCount(0);
  });

  test('typed kcal rescale the macros she did not type', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const sheet = await estimateMeal(app, 'борщ, хліб');
    await editRow(page, positions(sheet), 'Хліб житній', async (editor) => {
      await editor.getByRole('button', { name: 'Вписати вручну', exact: true }).click();
      const kcal = editor.getByRole('textbox', { name: 'Калорії', exact: true });
      await expect(kcal).toBeFocused();
      await kcal.fill('280');
      await expect(editor.getByRole('textbox', { name: 'Білки', exact: true })).toHaveValue('9');
      await expect(editor.getByRole('textbox', { name: 'Жири', exact: true })).toHaveValue('2');
      await expect(editor.getByRole('textbox', { name: 'Вуглеводи', exact: true })).toHaveValue('56');
      await expect(editor.getByText('Б · Ж · В перераховано за калоріями')).toBeVisible();
    });
    await expect(rowAt(positions(sheet), 2)).toHaveAccessibleName(
      'Хліб житній, 2 скибки, 280 ккал, білки 9, жири 2, вуглеводи 56 г, вписано вручну. Змінити',
    );
  });

  test('a new name is «змінено»; «✨ Перерахувати» sends every row and takes kcal and macros', async ({
    app,
    page,
  }) => {
    await mockFood(page);
    const bodies = await answerByMode(
      page,
      () => TEXT_ESTIMATE,
      (req) =>
        recalcAnswer(
          (req.items ?? []).map((it) =>
            it.name === 'Хліб білий'
              ? { ...it, kcal: 160, protein: 5, fat: 1.5, carbs: 30 }
              : { ...it, kcal: 999, protein: 99, fat: 99, carbs: 99 },
          ),
          'Білий хліб калорійніший',
        ),
    );
    await app.goto('/');
    const sheet = await estimateMeal(app, 'борщ, хліб');
    const card = positions(sheet);
    await editRow(page, card, 'Хліб житній', (editor) =>
      editor.getByRole('textbox', { name: 'Що це', exact: true }).fill('Хліб білий'),
    );
    await expect(rowAt(card, 2)).toHaveAccessibleName(
      'Хліб білий, 2 скибки, 140 ккал, білки 5, жири 1, вуглеводи 28 г, змінено. Змінити',
    );
    await card.getByRole('button', { name: 'Перерахувати', exact: true }).click();
    await expect(rowAt(card, 2)).toHaveAccessibleName(
      'Хліб білий, 2 скибки, 160 ккал, білки 5, жири 2, вуглеводи 30 г. Змінити',
    );
    // Every named row went as context, her names and portions, valid for the server.
    const sent = bodies.at(-1);
    expect(sent).toEqual({
      date: TODAY,
      items: [
        { name: 'Борщ', portion: '300 г' },
        { name: 'Хліб білий', portion: '2 скибки' },
      ],
    });
    expect(foodEstimateRequestSchema.safeParse(sent).success).toBe(true);
    // Only the row that waited took the answer.
    await expect(rowAt(card, 1)).toHaveAccessibleName(BORSHCH);
    await expect(card).toContainText('Білий хліб калорійніший');
    await expect(announced(sheet, 'Перераховано: разом 340 ккал')).toHaveCount(1);
  });

  test('macros she typed survive a recalculation; the kcal come from the model', async ({ app, page }) => {
    await mockFood(page);
    await answerByMode(
      page,
      () => TEXT_ESTIMATE,
      (req) =>
        recalcAnswer((req.items ?? []).map((it) => ({ ...it, kcal: 160, protein: 5, fat: 1.5, carbs: 30 }))),
    );
    await app.goto('/');
    const sheet = await estimateMeal(app, 'борщ, хліб');
    const card = positions(sheet);
    await editRow(page, card, 'Хліб житній', async (editor) => {
      await editor.getByRole('textbox', { name: 'Що це', exact: true }).fill('Хліб білий');
      await editor.getByRole('button', { name: 'Вписати вручну', exact: true }).click();
      await editor.getByRole('textbox', { name: 'Білки', exact: true }).fill('7');
    });
    await expect(rowAt(card, 2)).toHaveAccessibleName(/, змінено\. Змінити$/);
    await card.getByRole('button', { name: 'Перерахувати', exact: true }).click();
    await expect(rowAt(card, 2)).toHaveAccessibleName(
      'Хліб білий, 2 скибки, 160 ккал, білки 7, жири 1, вуглеводи 28 г. Змінити',
    );
  });
});

test.describe('«Часті страви» and saving', () => {
  test('a chip adds a position with the dish’s macros — no request, offline too', async ({
    app,
    page,
    context,
  }) => {
    const mocks = await mockFood(page);
    await app.goto('/');
    const sheet = await app.newMeal();
    await context.setOffline(true);
    await expect(sheet.getByText('Потрібен інтернет')).toBeVisible();
    await expect(countButton(sheet)).toHaveAttribute('aria-disabled', 'true');
    await expect(photoButton(sheet)).toHaveAttribute('aria-disabled', 'true');
    await sheet.getByRole('button', { name: 'Додати «Вівсянка з бананом», 320 ккал', exact: true }).click();
    const card = positions(sheet);
    await expect(rowAt(card, 1)).toHaveAccessibleName(
      'Вівсянка з бананом, 250 г, 320 ккал, білки 9, жири 6, вуглеводи 58 г. Змінити',
    );
    await expect(announced(sheet, 'Додано «Вівсянка з бананом», 320 ккал')).toHaveCount(1);
    // A dish remembered without macros: none on its row.
    await sheet.getByRole('button', { name: 'Додати «Яблуко», 80 ккал', exact: true }).click();
    await expect(rowAt(card, 2)).toHaveAccessibleName('Яблуко, 1 шт, 80 ккал. Змінити');
    expect(mocks.estimates).toEqual([]);
  });

  test('saving: the meal reaches the server with its items and macros, «Часті страви» learn the macros', async ({
    app,
    page,
    server,
  }) => {
    await mockFood(page);
    await app.goto('/');
    const sheet = await estimateMeal(app, 'борщ, хліб');
    await app.saveMeal(sheet);

    await expect
      .poll(async () => (await server.getData()).days[TODAY]?.meals?.find((m) => m.type === 'Сніданок'))
      .toMatchObject({
        type: 'Сніданок',
        time: '10:00',
        text: 'борщ, хліб',
        kcal: 320,
        protein: 10.5,
        fat: 10,
        carbs: 47,
        items: TEXT_ESTIMATE.items,
      });
    const data = await server.getData();
    // Today was a legacy day: its food became a meal of its own, nothing lost.
    expect(data.days[TODAY]?.meals?.map((m) => m.text)).toContain('Вівсянка з бананом, кава');
    expect(data.days[TODAY]?.kcal).toBe(320);
    const bread = data.foods.find((f: FoodItem) => f.name === 'Хліб житній');
    expect(bread).toMatchObject({
      portion: '2 скибки',
      kcal: 140,
      protein: 4.5,
      fat: 1,
      carbs: 28,
      count: 1,
    });
    expect(data.foods.find((f: FoodItem) => f.name === 'Борщ')).toMatchObject({
      protein: 6,
      fat: 9,
      carbs: 19,
    });
  });
});

test.describe('Hints', () => {
  test('the daily limit: a 429 locks both buttons; one line says why', async ({ app, page }) => {
    await mockFood(page, {
      estimate: {
        status: 429,
        body: { error: 'rate_limited', message: 'Ліміт підрахунків на сьогодні вичерпано' },
      },
    });
    await app.goto('/');
    const sheet = await app.newMeal();
    await mealText(sheet).fill('борщ');
    await countButton(sheet).click();
    await expect(app.toast('Ліміт підрахунків на сьогодні вичерпано')).toBeVisible();
    await expect(sheet.getByRole('alert')).toHaveText('Ліміт підрахунків на сьогодні вичерпано');
    await expect(sheet.getByText('Ліміт підрахунків на сьогодні вичерпано')).toHaveCount(1);
    await expect(photoButton(sheet)).toHaveAttribute('aria-disabled', 'true');
    // The text stays hers.
    await expect(mealText(sheet)).toHaveValue('борщ');
  });

  test('an exhausted budget from the status endpoint locks the buttons up front', async ({ app, page }) => {
    await mockFood(page, { status: { enabled: true, remainingToday: 0 } });
    await app.goto('/');
    const sheet = await app.newMeal();
    await expect(sheet.getByText('Ліміт підрахунків на сьогодні вичерпано')).toBeVisible();
    await expect(countButton(sheet)).toHaveAttribute('aria-disabled', 'true');
    await expect(photoButton(sheet)).toHaveAttribute('aria-disabled', 'true');
  });

  test('with nothing written, «✨ Порахувати» leads to the text instead of asking the model', async ({
    app,
    page,
  }) => {
    const mocks = await mockFood(page);
    await app.goto('/');
    const sheet = await app.newMeal();
    // Dimmed but never natively disabled (Playwright's click would wait for it, so the keyboard presses it).
    await expect(countButton(sheet)).toHaveAttribute('aria-disabled', 'true');
    await expect(countButton(sheet)).not.toHaveAttribute('disabled');
    await countButton(sheet).focus();
    await page.keyboard.press('Enter');
    await expect(mealText(sheet)).toBeFocused();
    expect(mocks.estimates).toEqual([]);
  });
});

test.describe('A saved meal', () => {
  test.use({ seed: 'meals' });

  test('reopened from the «Їжа» list, it shows its positions (and opens without the keyboard)', async ({
    app,
    page,
  }) => {
    await mockFood(page);
    await app.goto('/');
    const day = await app.openFoodDay();
    await app.mealRow(day, 'Сніданок').click();
    const editor = app.sheet('Прийом їжі');
    await expect(editor).toBeVisible();
    await expect(mealText(editor)).not.toBeFocused();
    await expect(mealText(editor)).toHaveValue('Вівсянка з бананом, кава з молоком');
    const card = positions(editor);
    await expect(rowAt(card, 1)).toHaveAccessibleName(
      'Вівсянка з бананом, 250 г, 320 ккал, білки 9, жири 6, вуглеводи 58 г. Змінити',
    );
    await expect(rowAt(card, 2)).toHaveAccessibleName(
      'Кава з молоком, 1 чашка, 60 ккал, білки 3, жири 3, вуглеводи 5 г. Змінити',
    );
    await expect(card).toContainText(/Разом\s*380\s*ккал/);
    await expect(app.mealType(editor, 'Сніданок')).toHaveAttribute('aria-pressed', 'true');
    // Something she adds to the text is «not counted yet», and the first button counts just that.
    await mealText(editor).fill('Вівсянка з бананом, кава з молоком, яблуко');
    await expect(editor.getByText('Ще не пораховано: яблуко')).toBeVisible();
    await expect(editor.getByRole('button', { name: 'Порахувати решту: яблуко', exact: true })).toBeVisible();
    // Positions she did not add in this editor cannot be «taken back».
    await expect(undoButton(editor)).toHaveCount(0);
  });
});

/** A «Перекус» logged today (the last of the default types: its chip is past the edge of a phone row). */
const SNACK: Meal = {
  id: 'snackE2e0001',
  type: 'Перекус',
  time: '09:30',
  text: 'Яблуко',
  kcal: 80,
  protein: 0.5,
  fat: 0,
  carbs: 19,
};

for (const width of [390, 320]) {
  test.describe(`Meal type chips on a ${width}px phone`, () => {
    test.use({ viewport: { width, height: 760 }, screen: { width, height: 760 } });

    test('«+ Свій» is whole on screen before anything scrolls; an opened «Перекус» chip shows whole', async ({
      app,
      page,
      server,
    }, info) => {
      test.skip(info.project.name !== 'iphone', 'the touch row (with a mouse the chips wrap)');
      await mockFood(page);
      expect((await server.sendOps([{ kind: 'meal.put', date: TODAY, value: SNACK }])).status()).toBe(200);
      await app.goto('/');

      // A new meal: the four default chips scroll, «+ Свій» stays at the end of the line.
      const sheet = await app.newMeal();
      await expect(addTypeButton(sheet)).toBeVisible();
      await expectInViewport(page, addTypeButton(sheet), '«+ Свій» of a new meal');
      await page.keyboard.press('Escape');
      await app.expectSheetClosed();

      // The saved «Перекус», reopened: its chip is scrolled into view whole, and «+ Свій» is still there.
      const day = await app.openFoodDay();
      await app.mealRow(day, 'Перекус').click();
      const editor = app.sheet('Прийом їжі');
      await expect(editor).toBeVisible();
      const chip = app.mealType(editor, 'Перекус');
      await expect(chip).toHaveAttribute('aria-pressed', 'true');
      await expectInViewport(page, addTypeButton(editor), '«+ Свій» of a saved meal');
      // The scrolling row (the group's parent) shows chips whole between its 18px / 20px paddings.
      const scroller = editor.getByRole('group', { name: 'Тип прийому їжі' }).locator('xpath=..');
      await expect
        .poll(async () => {
          const [c, r] = await Promise.all([chip.boundingBox(), scroller.boundingBox()]);
          return (
            c !== null &&
            r !== null &&
            c.x >= r.x + 18 - 0.5 &&
            c.x + c.width <= r.x + r.width - 20 + 0.5 &&
            c.x + c.width <= (page.viewportSize()?.width ?? 0)
          );
        })
        .toBe(true);
    });
  });
}
