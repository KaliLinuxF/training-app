import type { Locator, Page } from '@playwright/test';
import { foodEstimateRequestSchema, type FoodEstimateResponse } from '../packages/shared/src/index';
import type { App } from './support/app';
import { TODAY } from './support/env';
import { FOOD_JPEG, mockFood, PHOTO_ESTIMATE, PHOTO_ID } from './support/food';
import { expect, test } from './support/test';

const TODAY_FOOD = 'Вівсянка з бананом, кава';

/** A plate with weighed and counted items: grams and pieces rescale on the device, another dish does not. */
const PLATE_ESTIMATE: FoodEstimateResponse = {
  photoId: PHOTO_ID,
  items: [
    { name: 'Гречка', portion: '200 г', kcal: 220 },
    { name: 'Котлета куряча', portion: '1 шт', kcal: 180 },
    { name: 'Салат з огірків', portion: '100 г', kcal: 45 },
  ],
  totalKcal: 445,
  comment: '',
};

async function openToday(app: App): Promise<Locator> {
  await app.goto('/');
  await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
  const sheet = app.sheet('Запис дня');
  await expect(sheet).toBeVisible();
  return sheet;
}

const estimateCard = (sheet: Locator) => sheet.getByRole('region', { name: 'Оцінка калорій' });

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** A position of the card — one button that opens its editor — by the start of its name. */
const row = (card: Locator, name: string) =>
  card.getByRole('button', { name: new RegExp(`^${escapeRegExp(name)}, `) });

interface RowText {
  name: string;
  portion: string;
  kcal: string;
  /** «змінено» (waits for the model) or «вписано вручну» (her own kcal). */
  tag?: 'змінено' | 'вписано вручну';
}

/** Position `n` (1-based) as VoiceOver reads it: «Борщ, 300 г, 180 ккал. Змінити». */
async function expectRow(card: Locator, n: number, { name, portion, kcal, tag }: RowText) {
  const label = [name, portion, `${kcal} ккал`, tag].filter(Boolean).join(', ');
  await expect(
    card
      .getByRole('listitem')
      .nth(n - 1)
      .getByRole('button'),
  ).toHaveAccessibleName(`${label}. Змінити`);
}

/** The item editor stacked over the day sheet. */
const itemEditor = (page: Page, heading: 'Позиція' | 'Нова позиція' = 'Позиція') =>
  page.getByRole('dialog', { name: heading, exact: true });

const editorField = (editor: Locator, name: 'Що це' | 'Скільки' | 'Калорії') =>
  editor.getByRole('textbox', { name, exact: true });

/** Opens a position, changes it in the editor and taps «Готово»; the editor slides away. */
async function editRow(page: Page, card: Locator, name: string, change: (editor: Locator) => Promise<void>) {
  await row(card, name).click();
  const editor = itemEditor(page);
  await expect(editor).toBeVisible();
  await change(editor);
  await editor.getByRole('button', { name: 'Готово', exact: true }).click();
  await expect(editor).toBeHidden();
}

const renameRow = (page: Page, card: Locator, from: string, to: string) =>
  editRow(page, card, from, (editor) => editorField(editor, 'Що це').fill(to));

/** «Видалити позицію» in the position's editor. */
async function removeRow(page: Page, card: Locator, name: string) {
  await row(card, name).click();
  const editor = itemEditor(page);
  await editor.getByRole('button', { name: 'Видалити позицію' }).click();
  await expect(editor).toBeHidden();
}

const countButton = (sheet: Locator) =>
  sheet.getByRole('button', { name: 'Порахувати калорії', exact: true });

/** Text of the visually hidden status region that announces progress, results and additions. */
const announced = (sheet: Locator, text: string) => sheet.getByRole('status').filter({ hasText: text });

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

/** Opens the composer (pre-filled with the unestimated part of «Що я їла»), types `text`, submits. */
async function estimateText(sheet: Locator, text: string): Promise<void> {
  await countButton(sheet).click();
  const ask = sheet.getByRole('textbox', { name: 'Що порахувати' });
  await expect(ask).toBeFocused();
  await ask.fill(text);
  await sheet.getByRole('button', { name: 'Порахувати', exact: true }).click();
}

test.describe('AI calorie estimate (mocked)', () => {
  test('from text: correct a position in its editor, «Додати N ккал» appends the line and adds the kcal', async ({
    app,
    page,
    server,
  }) => {
    const mocks = await mockFood(page);
    const sheet = await openToday(app);
    const kcal = sheet.getByRole('textbox', { name: 'Калорії за день' });
    await kcal.fill('300');

    await estimateText(sheet, 'борщ 300 г і дві скибки житнього хліба');
    const card = estimateCard(sheet);
    await expect(card).toContainText('2 позиції · можна виправити');
    await expectRow(card, 1, { name: 'Борщ', portion: '300 г', kcal: '180' });
    await expectRow(card, 2, { name: 'Хліб житній', portion: '2 скибки', kcal: '140' });
    await expect(card).toContainText('Разом320 ккал');
    expect(mocks.estimates).toEqual([{ date: TODAY, text: 'борщ 300 г і дві скибки житнього хліба' }]);
    // The result is announced and focus moves onto it (the composer she was in is gone).
    await expect(announced(sheet, 'Знайдено 2 позиції, разом 320 ккал')).toHaveCount(1);
    await expect(
      card.getByRole('heading', { name: 'Оцінка калорій' }).locator('[tabindex="-1"]'),
    ).toBeFocused();

    // A clean list: no fields in the card.
    await expect(card.getByRole('textbox')).toHaveCount(0);
    await editRow(page, card, 'Хліб житній', async (editor) => {
      await editor.getByRole('button', { name: 'Вписати вручну' }).click();
      const kcalField = editorField(editor, 'Калорії');
      await expect(kcalField).toBeFocused();
      await kcalField.fill('160');
    });
    // Back on the row she opened, with her number.
    await expect(row(card, 'Хліб житній')).toBeFocused();
    await expectRow(card, 2, {
      name: 'Хліб житній',
      portion: '2 скибки',
      kcal: '160',
      tag: 'вписано вручну',
    });
    await expect(card).toContainText('Разом340 ккал');
    await card.getByRole('button', { name: 'Додати 340 ккал' }).click();
    await expect(card).toBeHidden();
    await expect(announced(sheet, 'Додано 340 ккал')).toHaveCount(1);
    await expect(countButton(sheet)).toBeFocused();

    // She retyped the meal in the composer, so the line is appended rather than replacing anything.
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveValue(
      `${TODAY_FOOD}\nБорщ (300 г), хліб житній (2 скибки) — 340 ккал`,
    );
    await expect(kcal).toHaveValue('640');
    await app.save(sheet);
    await expect(app.region('Сьогодні')).toContainText('640 ккал');

    await expect
      .poll(async () => {
        const d = await server.getData();
        const dish = (name: string) => d.foods.find((f) => f.name === name);
        return { day: d.days[TODAY], borshch: dish('Борщ'), bread: dish('Хліб житній') };
      })
      .toEqual({
        day: {
          food: `${TODAY_FOOD}\nБорщ (300 г), хліб житній (2 скибки) — 340 ккал`,
          kcal: 640,
          trained: null,
          types: [],
          notes: '',
        },
        borshch: { name: 'Борщ', portion: '300 г', kcal: 180, count: 4, lastUsed: TODAY },
        bread: { name: 'Хліб житній', portion: '2 скибки', kcal: 160, count: 1, lastUsed: TODAY },
      });
  });

  test('«✨ Порахувати» counts what she typed in «Що я їла» and replaces it with the itemised line', async ({
    app,
    page,
    server,
  }) => {
    const mocks = await mockFood(page);
    const sheet = await openToday(app);
    const food = sheet.getByRole('textbox', { name: 'Що я їла' });
    await food.fill('Кава з молоком (1 чашка) — 60 ккал\nборщ 300 г\nдві скибки житнього');

    await countButton(sheet).click();
    const ask = sheet.getByRole('textbox', { name: 'Що порахувати' });
    await expect(ask).toBeFocused();
    // Only the part after the last estimated line, ready to send as is.
    await expect(ask).toHaveValue('борщ 300 г, дві скибки житнього');
    await sheet.getByRole('button', { name: 'Порахувати', exact: true }).click();

    const card = estimateCard(sheet);
    await expect(card).toContainText('Разом320 ккал');
    expect(mocks.estimates).toEqual([{ date: TODAY, text: 'борщ 300 г, дві скибки житнього' }]);
    await card.getByRole('button', { name: 'Додати 320 ккал' }).click();

    // The meal is written once: the itemised line took the place of what she had typed.
    const line = 'Борщ (300 г), хліб житній (2 скибки) — 320 ккал';
    await expect(food).toHaveValue(`Кава з молоком (1 чашка) — 60 ккал\n${line}`);
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('320');

    // The next «Порахувати» has nothing left over to count.
    await countButton(sheet).click();
    await expect(ask).toHaveValue('');
    await countButton(sheet).click();

    await app.save(sheet);
    await expect
      .poll(async () => (await server.getData()).days[TODAY]?.food)
      .toBe(`Кава з молоком (1 чашка) — 60 ккал\n${line}`);
  });

  test('an estimate not added yet is not dropped without asking when the sheet closes', async ({
    app,
    page,
  }) => {
    await mockFood(page);
    const sheet = await openToday(app);
    await estimateText(sheet, 'борщ і хліб');
    const card = estimateCard(sheet);
    await expect(card).toBeVisible();

    await sheet.getByRole('button', { name: 'Закрити', exact: true }).click();
    const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(ask).toBeHidden();
    await expect(card.getByRole('button', { name: 'Додати 320 ккал' })).toBeVisible();

    await sheet.getByRole('button', { name: 'Закрити', exact: true }).click();
    await ask.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
  });

  test('removing items and «Скасувати» leave the day untouched', async ({ app, page }) => {
    await mockFood(page, { status: { enabled: true, remainingToday: 3 } });
    const sheet = await openToday(app);
    await estimateText(sheet, 'борщ і хліб');
    const card = estimateCard(sheet);
    // One estimate used: 2 left today.
    await expect(card).toContainText('Сьогодні ще 2 підрахунки');
    await removeRow(page, card, 'Борщ');
    await expect(card).toContainText('1 позиція · можна виправити');
    // The row is gone with its editor: focus moves on to the next one.
    await expect(row(card, 'Хліб житній')).toBeFocused();
    await expect(card.getByRole('button', { name: 'Додати 140 ккал' })).toBeVisible();
    await card.getByRole('button', { name: 'Скасувати' }).click();
    await expect(card).toBeHidden();
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveValue(TODAY_FOOD);
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('');
  });

  test('from a photo: the thumbnail is shown, saved with the day and visible in the calendar', async ({
    app,
    page,
    server,
  }) => {
    const mocks = await mockFood(page, { estimate: PHOTO_ESTIMATE });
    const sheet = await openToday(app);

    // «📷 Фото» opens the system picker for images.
    const chooser = page.waitForEvent('filechooser');
    await sheet.getByRole('button', { name: 'Порахувати калорії за фото' }).click();
    expect((await chooser).isMultiple()).toBe(false);
    await sheet
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: FOOD_JPEG });

    const card = estimateCard(sheet);
    await expectRow(card, 1, { name: 'Сирники зі сметаною', portion: '3 шт', kcal: '420' });
    await expect(card).toContainText('Сметана — приблизно 2 ложки');
    await loaded(card.getByRole('img', { name: 'Фото їжі' }));

    // The photo was downscaled on the device and sent as JPEG (full + thumbnail).
    expect(mocks.estimates).toHaveLength(1);
    const sent = mocks.estimates[0] as {
      date: string;
      image: { full: string; thumb: string };
      text?: string;
    };
    expect(sent.date).toBe(TODAY);
    expect(sent.text).toBeUndefined();
    expect(isJpegBase64(sent.image.full)).toBe(true);
    expect(isJpegBase64(sent.image.thumb)).toBe(true);
    expect(sent.image.thumb.length).toBeLessThan(sent.image.full.length);

    await card.getByRole('button', { name: 'Додати 420 ккал' }).click();
    await expect(card).toBeHidden();
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('420');
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveValue(
      `${TODAY_FOOD}\nСирники зі сметаною (3 шт) — 420 ккал`,
    );
    const thumb = sheet.locator(`img[src="/api/photos/${PHOTO_ID}/thumb"]`);
    await loaded(thumb);
    await expect(sheet.getByRole('button', { name: 'Видалити фото' })).toBeVisible();

    // Tap → full-screen viewer; Escape closes only the viewer.
    await sheet.getByRole('button', { name: 'Фото їжі' }).click();
    const viewer = page.getByRole('dialog', { name: 'Фото їжі' });
    await expect(viewer).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(viewer).toBeHidden();
    await expect(sheet).toBeVisible();

    await app.save(sheet);
    await expect.poll(async () => (await server.getData()).days[TODAY]?.photos).toEqual([PHOTO_ID]);

    await app.go('Календар');
    const day = app.region('14 жовтня 2026');
    await loaded(day.locator(`img[src="/api/photos/${PHOTO_ID}/thumb"]`));
  });

  test('from a photo: new grams rescale at once, a corrected dish is recalculated, «Додати» keeps her names', async ({
    app,
    page,
    server,
  }) => {
    const mocks = await mockFood(page, { estimate: PLATE_ESTIMATE });
    // Recalculations (`items` in the body) get their own answer; the photo estimate falls through to mockFood.
    const recalcs: unknown[] = [];
    await page.route('**/api/food/estimate', async (route) => {
      const body = route.request().postDataJSON() as {
        items?: { name: string; portion: string }[];
        photoId?: string;
      };
      if (!body.items) return route.fallback();
      recalcs.push(body);
      const kcal = [170, 310, 50];
      const items = body.items.map((it, i) => ({ ...it, kcal: kcal[i] ?? 0 }));
      const answer: FoodEstimateResponse = {
        photoId: body.photoId ?? null,
        items,
        totalKcal: items.reduce((sum, it) => sum + it.kcal, 0),
        comment: '',
      };
      await route.fulfill({ json: answer });
    });

    const sheet = await openToday(app);
    await sheet
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: FOOD_JPEG });
    const card = estimateCard(sheet);
    await expectRow(card, 2, { name: 'Котлета куряча', portion: '1 шт', kcal: '180' });
    await expect(card).toContainText('Разом445 ккал');

    // Same dish, new grams: proportional kcal on the device, live in the editor, no request.
    await editRow(page, card, 'Гречка', async (editor) => {
      await editorField(editor, 'Скільки').fill('150');
      await expect(editor).toContainText('165');
      await expect(editor).toContainText('перераховано за вагою');
    });
    await expectRow(card, 1, { name: 'Гречка', portion: '150 г', kcal: '165' });
    await expect(card).toContainText('Разом390 ккал');
    await expect(card.getByRole('button', { name: 'Перерахувати' })).toHaveCount(0);

    // Another dish and amount: marked «змінено» until the model prices it.
    await editRow(page, card, 'Котлета куряча', async (editor) => {
      await editorField(editor, 'Що це').fill('Котлета свиняча');
      await editor
        .getByRole('group', { name: 'Одиниця' })
        .getByRole('button', { name: 'г', exact: true })
        .click();
      await editorField(editor, 'Скільки').fill('120');
      await expect(editor.getByText('змінено — уточни калорії')).toBeVisible();
    });
    await expect(card.getByText('змінено', { exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Перерахувати' }).click();

    await expectRow(card, 2, { name: 'Котлета свиняча', portion: '120 г', kcal: '310' });
    await expect(card).toContainText('Разом520 ккал');
    await expect(announced(sheet, 'Перераховано: разом 520 ккал')).toHaveCount(1);
    await expect(card.getByText('змінено', { exact: true })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Перерахувати' })).toHaveCount(0);
    // Only the changed row took the model's number.
    await expectRow(card, 1, { name: 'Гречка', portion: '150 г', kcal: '165' });
    await expectRow(card, 3, { name: 'Салат з огірків', portion: '100 г', kcal: '45' });

    // One photo estimate (the grams edit asked nothing), then one recalculation of her rows with the photo.
    expect(mocks.estimates).toHaveLength(1);
    expect(recalcs).toEqual([
      {
        date: TODAY,
        items: [
          { name: 'Гречка', portion: '150 г' },
          { name: 'Котлета свиняча', portion: '120 г' },
          { name: 'Салат з огірків', portion: '100 г' },
        ],
        photoId: PHOTO_ID,
      },
    ]);

    await card.getByRole('button', { name: 'Додати 520 ккал' }).click();
    await expect(card).toBeHidden();
    const line = 'Гречка (150 г), котлета свиняча (120 г), салат з огірків (100 г) — 520 ккал';
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveValue(`${TODAY_FOOD}\n${line}`);
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('520');
    await app.save(sheet);

    // «Часті страви» learn her corrected dish, not the model's first guess.
    await expect
      .poll(async () => {
        const d = await server.getData();
        return {
          food: d.days[TODAY]?.food,
          photos: d.days[TODAY]?.photos,
          corrected: d.foods.find((f) => f.name === 'Котлета свиняча'),
          guessed: d.foods.some((f) => f.name === 'Котлета куряча'),
        };
      })
      .toEqual({
        food: `${TODAY_FOOD}\n${line}`,
        photos: [PHOTO_ID],
        corrected: { name: 'Котлета свиняча', portion: '120 г', kcal: 310, count: 1, lastUsed: TODAY },
        guessed: false,
      });
  });

  test('a failed estimate shows the error and keeps the typed text', async ({ app, page }) => {
    await mockFood(page, {
      estimate: { status: 502, body: { error: 'ai_failed', message: 'Не вдалося отримати оцінку' } },
    });
    const sheet = await openToday(app);
    await estimateText(sheet, 'щось дивне');
    // She described it in words already: the advice is about the description, not «describe it».
    const message = 'Не вдалося порахувати — спробуй ще раз або опиши детальніше (з грамами)';
    await expect(app.toast(message)).toBeVisible();
    // Also inside the sheet (the toast is outside the modal dialog).
    await expect(sheet.getByRole('alert')).toHaveText(message);
    await expect(estimateCard(sheet)).toHaveCount(0);
    const ask = sheet.getByRole('textbox', { name: 'Що порахувати' });
    await expect(ask).toHaveValue('щось дивне');
    await expect(ask).toBeFocused();
  });

  test('a failed photo estimate suggests describing the meal in words', async ({ app, page }) => {
    await mockFood(page, {
      estimate: { status: 502, body: { error: 'ai_failed', message: 'Не вдалося отримати оцінку' } },
    });
    const sheet = await openToday(app);
    await sheet
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: FOOD_JPEG });
    await expect(sheet.getByRole('alert')).toHaveText('Не вдалося розпізнати — спробуй описати текстом');
  });

  test('offline: the AI buttons are disabled with a hint, the frequent dishes still work', async ({
    app,
    page,
    context,
  }) => {
    await mockFood(page);
    const sheet = await openToday(app);
    await expect(sheet.getByRole('button', { name: 'Порахувати калорії', exact: true })).toBeEnabled();
    await context.setOffline(true);
    await expect(sheet.getByText('Потрібен інтернет')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Порахувати калорії', exact: true })).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Порахувати калорії за фото' })).toBeDisabled();
    await sheet.getByRole('button', { name: 'Додати «Яблуко», 80 ккал' }).click();
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('80');
    await expect(announced(sheet, 'Додано «Яблуко», 80 ккал')).toHaveCount(1);
  });

  test('the daily limit: a 429 disables the buttons for the rest of the day', async ({ app, page }) => {
    await mockFood(page, {
      estimate: {
        status: 429,
        body: { error: 'rate_limited', message: 'Ліміт підрахунків на сьогодні вичерпано' },
      },
    });
    const sheet = await openToday(app);
    await estimateText(sheet, 'борщ');
    await expect(app.toast('Ліміт підрахунків на сьогодні вичерпано')).toBeVisible();
    // One line in the sheet: the alert doubles as the hint under the buttons.
    await expect(sheet.getByText('Ліміт підрахунків на сьогодні вичерпано')).toBeVisible();
    await expect(sheet.getByRole('alert')).toHaveText('Ліміт підрахунків на сьогодні вичерпано');
    await expect(sheet.getByRole('button', { name: 'Порахувати калорії за фото' })).toBeDisabled();
  });

  test('an exhausted budget from the status endpoint disables the buttons up front', async ({
    app,
    page,
  }) => {
    await mockFood(page, { status: { enabled: true, remainingToday: 0 } });
    const sheet = await openToday(app);
    await expect(sheet.getByText('Ліміт підрахунків на сьогодні вичерпано')).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Порахувати калорії', exact: true })).toBeDisabled();
    await expect(sheet.getByRole('button', { name: 'Порахувати калорії за фото' })).toBeDisabled();
  });

  test('a file that is not a picture is refused on the device', async ({ app, page }) => {
    const mocks = await mockFood(page, { estimate: PHOTO_ESTIMATE });
    const sheet = await openToday(app);
    await sheet
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('not a photo') });
    await expect(app.toast('Це не схоже на фото')).toBeVisible();
    await expect(sheet.getByRole('alert')).toHaveText('Це не схоже на фото');
    expect(mocks.estimates).toEqual([]);
  });

  test('a photo removed from the strip is not saved with the day', async ({ app, page, server }) => {
    await mockFood(page, { estimate: PHOTO_ESTIMATE });
    const sheet = await openToday(app);
    await sheet
      .locator('input[type="file"][accept="image/*"]')
      .setInputFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: FOOD_JPEG });
    await estimateCard(sheet).getByRole('button', { name: 'Додати 420 ккал' }).click();
    await sheet.getByRole('button', { name: 'Видалити фото' }).click();
    await expect(sheet.locator(`img[src="/api/photos/${PHOTO_ID}/thumb"]`)).toHaveCount(0);
    // The ✕ went with the photo: focus moves on to the next control instead of falling to <body>.
    await expect(countButton(sheet)).toBeFocused();
    await app.save(sheet);
    await expect.poll(async () => (await server.getData()).days[TODAY]?.kcal).toBe(420);
    expect((await server.getData()).days[TODAY]?.photos).toBeUndefined();
  });
});

interface RecalcBody {
  date: string;
  items: { name: string; portion: string }[];
  photoId?: string;
}

/** A recalculation answer for `kcal` that the client receives; `null` = an error response. */
type RecalcAnswer = { kcal: number[] } | { status: number; body: { error: string; message: string } };

/**
 * Recalculate-mode requests (`items` in the body) get `answer`; the photo estimate falls through
 * to `mockFood`. `gate`, when given, holds every recalculation until it resolves.
 */
async function mockRecalc(page: Page, answer: RecalcAnswer, gate?: Promise<void>): Promise<RecalcBody[]> {
  const sent: RecalcBody[] = [];
  await page.route('**/api/food/estimate', async (route) => {
    const body = route.request().postDataJSON() as Partial<RecalcBody>;
    if (!body.items) return route.fallback();
    sent.push(body as RecalcBody);
    if (gate) await gate;
    if ('status' in answer) return route.fulfill({ status: answer.status, json: answer.body });
    const items = body.items.map((it, i) => ({ ...it, kcal: answer.kcal[i] ?? 0 }));
    const res: FoodEstimateResponse = {
      photoId: body.photoId ?? null,
      items,
      totalKcal: items.reduce((sum, it) => sum + it.kcal, 0),
      comment: '',
    };
    await route.fulfill({ json: res });
  });
  return sent;
}

async function estimatePlate(app: App): Promise<{ sheet: Locator; card: Locator }> {
  const sheet = await openToday(app);
  await sheet
    .locator('input[type="file"][accept="image/*"]')
    .setInputFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: FOOD_JPEG });
  const card = estimateCard(sheet);
  await expect(card).toContainText('Разом445 ккал');
  return { sheet, card };
}

const recalcButton = (card: Locator) => card.getByRole('button', { name: /Перерахувати|Рахую…/ });

test.describe('Correcting a photo estimate', () => {
  test('removed, added, text-portion and self-priced rows: the body fits the server schema and kcal land by position', async ({
    app,
    page,
  }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    const sent = await mockRecalc(page, { kcal: [300, 70, 110, 200] });
    const { card } = await estimatePlate(app);

    // She did not eat the buckwheat: no question, focus on the next position.
    await removeRow(page, card, 'Гречка');
    await expect(row(card, 'Котлета куряча')).toBeFocused();
    // Comma decimals in kilograms against grams, written as text: 45 × 150 / 100, on the device.
    await editRow(page, card, 'Салат з огірків', async (editor) => {
      await editor.getByRole('button', { name: 'Порція текстом' }).click();
      await expect(editorField(editor, 'Скільки')).toBeFocused();
      await editorField(editor, 'Скільки').fill('0,15 кг');
      await expect(editor).toContainText('68');
    });
    await expectRow(card, 2, { name: 'Салат з огірків', portion: '0,15 кг', kcal: '68' });
    // Another dish.
    await editRow(page, card, 'Котлета куряча', async (editor) => {
      await editorField(editor, 'Що це').fill('Котлета свиняча');
      await editor.getByRole('button', { name: 'Порція текстом' }).click();
      await editorField(editor, 'Скільки').fill('~120 г');
    });
    // A missing row the model prices, one she prices herself, one she gives up on.
    const added = itemEditor(page, 'Нова позиція');
    await card.getByRole('button', { name: '+ позиція' }).click();
    await expect(editorField(added, 'Що це')).toBeFocused();
    await expect(added.getByRole('button', { name: 'Додати позицію' })).toBeDisabled();
    await editorField(added, 'Що це').fill('Сметана');
    await added.getByRole('button', { name: 'Порція текстом' }).click();
    await editorField(added, 'Скільки').fill('2 ст. л.');
    await added.getByRole('button', { name: 'Додати позицію' }).click();
    await expect(added).toBeHidden();
    await expect(row(card, 'Сметана')).toBeFocused();

    await card.getByRole('button', { name: '+ позиція' }).click();
    await editorField(added, 'Що це').fill('Хліб');
    await added.getByRole('button', { name: 'Вписати вручну' }).click();
    await editorField(added, 'Калорії').fill('90');
    await added.getByRole('button', { name: 'Додати позицію' }).click();
    await expect(added).toBeHidden();

    // Opened and closed untouched: nothing added, nothing asked.
    await card.getByRole('button', { name: '+ позиція' }).click();
    await added.getByRole('button', { name: 'Закрити', exact: true }).click();
    await expect(added).toBeHidden();
    await expect(card.getByRole('listitem')).toHaveCount(4);
    await expect(card.getByText('змінено', { exact: true })).toHaveCount(2);

    await recalcButton(card).click();
    await expectRow(card, 1, { name: 'Котлета свиняча', portion: '~120 г', kcal: '300' });
    expect(sent).toHaveLength(1);
    expect(foodEstimateRequestSchema.safeParse(sent[0]).success).toBe(true);
    expect(sent[0]).toEqual({
      date: TODAY,
      items: [
        { name: 'Котлета свиняча', portion: '~120 г' },
        { name: 'Салат з огірків', portion: '0,15 кг' },
        { name: 'Сметана', portion: '2 ст. л.' },
        { name: 'Хліб', portion: '' },
      ],
      photoId: PHOTO_ID,
    });
    // Rescaled and self-priced rows keep their numbers.
    await expectRow(card, 2, { name: 'Салат з огірків', portion: '0,15 кг', kcal: '68' });
    await expectRow(card, 3, { name: 'Сметана', portion: '2 ст. л.', kcal: '110' });
    await expectRow(card, 4, { name: 'Хліб', portion: '', kcal: '90', tag: 'вписано вручну' });
    await expect(card).toContainText('Разом568 ккал');

    await card.getByRole('button', { name: 'Додати 568 ккал' }).click();
    await expect(app.page.getByRole('textbox', { name: 'Що я їла' })).toHaveValue(
      `${TODAY_FOOD}\nКотлета свиняча (~120 г), салат з огірків (0,15 кг), сметана (2 ст. л.), хліб — 568 ккал`,
    );
  });

  test('the position editor: − / + rescale pieces, its own «✨ Перерахувати», a frequent dish, discard asks', async ({
    app,
    page,
  }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    const sent = await mockRecalc(page, { kcal: [220, 330, 45] });
    const { card } = await estimatePlate(app);

    // One more cutlet: the same count unit rescales on the device.
    await row(card, 'Котлета куряча').click();
    const editor = itemEditor(page);
    await expect(editor).toBeVisible();
    await editor.getByRole('button', { name: 'Збільшити' }).click();
    await expect(editorField(editor, 'Скільки')).toHaveValue('2');
    await expect(editor).toContainText('360');
    await expect(editor).toContainText('перераховано за кількістю');
    // Another dish: asked right here, the rest of the plate as context.
    await editorField(editor, 'Що це').fill('Котлета свиняча');
    await expect(editor.getByText('змінено — уточни калорії')).toBeVisible();
    await editor.getByRole('button', { name: 'Перерахувати' }).click();
    await expect(editor).toContainText('330');
    expect(sent).toEqual([
      {
        date: TODAY,
        items: [
          { name: 'Гречка', portion: '200 г' },
          { name: 'Котлета свиняча', portion: '2 шт' },
          { name: 'Салат з огірків', portion: '100 г' },
        ],
        photoId: PHOTO_ID,
      },
    ]);
    // Nothing in the list until «Готово».
    await expectRow(card, 2, { name: 'Котлета куряча', portion: '1 шт', kcal: '180' });
    await editor.getByRole('button', { name: 'Готово', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect(row(card, 'Котлета свиняча')).toBeFocused();
    await expectRow(card, 2, { name: 'Котлета свиняча', portion: '2 шт', kcal: '330' });

    // A frequent dish: her own numbers, no model.
    await card.getByRole('button', { name: '+ позиція' }).click();
    const added = itemEditor(page, 'Нова позиція');
    await editorField(added, 'Що це').fill('кава');
    await added.getByRole('button', { name: 'Кава з молоком, 1 чашка, 60 ккал' }).click();
    await expect(added).toContainText('як у «Частих стравах»');
    await added.getByRole('button', { name: 'Додати позицію' }).click();
    await expect(added).toBeHidden();
    // Her usual numbers, not typed by hand: no «вручну» tag.
    await expectRow(card, 4, { name: 'Кава з молоком', portion: '1 чашка', kcal: '60' });
    await expect(row(card, 'Кава з молоком').getByText('вручну', { exact: true })).toHaveCount(0);
    await expect(card).toContainText('Разом655 ккал');
    expect(sent).toHaveLength(1);

    // A changed draft is not dropped without asking (✕ or Escape).
    await row(card, 'Гречка').click();
    await editorField(editor, 'Скільки').fill('100');
    await page.keyboard.press('Escape');
    const ask = page.getByRole('alertdialog', { name: 'Скасувати зміни?' });
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(ask).toBeHidden();
    await expect(editorField(editor, 'Скільки')).toHaveValue('100');
    // The day sheet under it stayed open.
    await expect(app.sheet('Запис дня')).toBeVisible();
    await editor.getByRole('button', { name: 'Закрити', exact: true }).click();
    await ask.getByRole('button', { name: 'Скасувати зміни' }).click();
    await expect(editor).toBeHidden();
    await expectRow(card, 1, { name: 'Гречка', portion: '200 г', kcal: '220' });
    await expect(row(card, 'Гречка')).toBeFocused();
  });

  test('a double tap sends one recalculation; a row edited while it runs keeps her edit', async ({
    app,
    page,
  }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    let release = (): void => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const sent = await mockRecalc(page, { kcal: [221, 310, 90] }, gate);
    const { sheet, card } = await estimatePlate(app);

    await renameRow(page, card, 'Котлета куряча', 'Котлета свиняча');
    await renameRow(page, card, 'Салат з огірків', 'Салат з помідорів');
    await recalcButton(card).dblclick();
    await expect(recalcButton(card)).toHaveText('Рахую…');
    await expect(announced(sheet, 'Рахую калорії…')).toHaveCount(1);
    // «Додати» waits for the numbers she asked for (not the old dish's kcal under her new name).
    await expect(card.getByRole('button', { name: 'Додати 445 ккал' })).toBeDisabled();
    // Changed again while the model works on the previous name.
    await renameRow(page, card, 'Салат з помідорів', 'Салат з помідорів і сметаною');
    release();

    await expectRow(card, 2, { name: 'Котлета свиняча', portion: '1 шт', kcal: '310' });
    await expect(card.getByRole('button', { name: 'Додати 575 ккал' })).toBeEnabled();
    await expectRow(card, 1, { name: 'Гречка', portion: '200 г', kcal: '220' });
    await expectRow(card, 3, {
      name: 'Салат з помідорів і сметаною',
      portion: '100 г',
      kcal: '45',
      tag: 'змінено',
    });
    await expect(card.getByText('змінено', { exact: true })).toHaveCount(1);
    await expect(recalcButton(card)).toHaveText('✨ Перерахувати');
    expect(sent).toHaveLength(1);
  });

  test('a failed recalculation explains itself and announces nothing stale', async ({ app, page }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    await mockRecalc(page, { status: 502, body: { error: 'ai_failed', message: 'Не вдалося' } });
    const { sheet, card } = await estimatePlate(app);
    await removeRow(page, card, 'Гречка');
    await renameRow(page, card, 'Котлета куряча', 'Котлета свиняча');
    await recalcButton(card).click();

    const message = 'Не вдалося перерахувати — уточни назву чи вагу або вкажи калорії вручну';
    await expect(card.getByRole('alert')).toHaveText(message);
    await expect(app.toast(message)).toBeVisible();
    await expect(card.getByText('змінено', { exact: true })).toHaveCount(1);
    await expect(recalcButton(card)).toHaveText('✨ Перерахувати');
    // The polite status must not read out the first estimate again («Знайдено 3 позиції, разом 445 ккал»):
    // she has removed a row since, and the alert already says what happened.
    await expect(sheet.getByRole('status').filter({ hasText: 'Знайдено' })).toHaveCount(0);
  });

  test('the daily limit hit on recalculation locks the button without dropping her focus', async ({
    app,
    page,
  }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    await mockRecalc(page, {
      status: 429,
      body: { error: 'rate_limited', message: 'Ліміт підрахунків на сьогодні вичерпано' },
    });
    const { sheet, card } = await estimatePlate(app);
    await renameRow(page, card, 'Котлета куряча', 'Котлета свиняча');
    await recalcButton(card).focus();
    await page.keyboard.press('Enter');

    await expect(card.getByRole('alert')).toHaveText('Ліміт підрахунків на сьогодні вичерпано');
    await expect(recalcButton(card)).toBeDisabled();
    // «Додати» still adds what is on screen.
    await expect(card.getByRole('button', { name: 'Додати 445 ккал' })).toBeEnabled();
    // Focus was on «Перерахувати»: it must not fall to <body> (VoiceOver loses her place).
    await expect.poll(() => page.evaluate(() => document.activeElement === document.body)).toBe(false);
    // One line about the limit in the sheet, like a 429 on the first estimate.
    await expect(sheet.getByText('Ліміт підрахунків на сьогодні вичерпано', { exact: true })).toHaveCount(1);
    // In the position's editor: kcal by hand, the model locked.
    await row(card, 'Котлета свиняча').click();
    const editor = itemEditor(page);
    await expect(editor.getByRole('button', { name: 'Перерахувати' })).toBeDisabled();
    await editor.getByRole('button', { name: 'Вписати вручну' }).click();
    await editorField(editor, 'Калорії').fill('320');
    await editor.getByRole('button', { name: 'Готово', exact: true }).click();
    await expectRow(card, 2, {
      name: 'Котлета свиняча',
      portion: '1 шт',
      kcal: '320',
      tag: 'вписано вручну',
    });
    await expect(card.getByRole('button', { name: 'Додати 585 ккал' })).toBeEnabled();
  });

  test('the position editor over the day sheet: drag, a backdrop tap and Escape close only the editor', async ({
    app,
    page,
  }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    const { sheet, card } = await estimatePlate(app);
    const editor = itemEditor(page);

    // A tap on the dimmed day sheet above the editor is the editor's backdrop.
    await row(card, 'Гречка').click();
    await expect(editor).toBeVisible();
    const box = await editor.boundingBox();
    if (!box) throw new Error('editor not rendered');
    await page.mouse.click(box.x + 20, Math.max(4, box.y - 20));
    await expect(editor).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(row(card, 'Гречка')).toBeFocused();

    // Escape twice: the editor first, then the day sheet asks about the estimate not added yet.
    await row(card, 'Гречка').click();
    await expect(editor).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await page.keyboard.press('Escape');
    const ask = page.getByRole('alertdialog', { name: 'Є незбережені зміни' });
    await ask.getByRole('button', { name: 'Залишитись' }).click();
    await expect(sheet).toBeVisible();
    await expect(card.getByRole('listitem')).toHaveCount(3);
  });

  test('a frequent dish keeps following the amount while she retypes it', async ({ app, page }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    const { card } = await estimatePlate(app);
    await card.getByRole('button', { name: '+ позиція' }).click();
    const added = itemEditor(page, 'Нова позиція');
    await editorField(added, 'Що це').fill('кава');
    await added.getByRole('button', { name: 'Кава з молоком, 1 чашка, 60 ккал' }).click();
    const amount = editorField(added, 'Скільки');
    await amount.fill('');
    await amount.fill('2');
    await expect(added).toContainText('120');
    await expect(added).toContainText('як у «Частих стравах»');
    await expect(added.getByRole('button', { name: /Порахувати/ })).toHaveCount(0);
  });

  test('an answer that arrives while the editor is open on its row is not lost on «Готово»', async ({
    app,
    page,
  }) => {
    let release = () => {};
    const gate = new Promise<void>((resolve) => (release = resolve));
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    const sent = await mockRecalc(page, { kcal: [220, 310, 45] }, gate);
    const { card } = await estimatePlate(app);
    await renameRow(page, card, 'Котлета куряча', 'Котлета свиняча');
    await recalcButton(card).click();
    // While «Рахую…», one more cutlet.
    await row(card, 'Котлета свиняча').click();
    const editor = itemEditor(page);
    await editor.getByRole('button', { name: 'Збільшити' }).click();
    release();
    await expect(row(card, 'Котлета свиняча')).toHaveAccessibleName(
      'Котлета свиняча, 1 шт, 310 ккал. Змінити',
    );
    await editor.getByRole('button', { name: 'Готово', exact: true }).click();
    // 2 × the model's 310, rescaled on the device: no second request.
    await expectRow(card, 2, { name: 'Котлета свиняча', portion: '2 шт', kcal: '620' });
    expect(sent).toHaveLength(1);
  });

  test('the error of a recalculation in a discarded editor does not stay in the card', async ({
    app,
    page,
  }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    await mockRecalc(page, { status: 502, body: { error: 'ai_failed', message: 'Не вдалося' } });
    const { card } = await estimatePlate(app);
    await row(card, 'Котлета куряча').click();
    const editor = itemEditor(page);
    await editorField(editor, 'Що це').fill('Котлета свиняча');
    await editor.getByRole('button', { name: 'Перерахувати' }).click();
    await expect(editor.getByRole('alert')).toBeVisible();
    await editor.getByRole('button', { name: 'Закрити', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Скасувати зміни' }).click();
    await expect(editor).toBeHidden();
    await expect(card.getByText(/Не вдалося перерахувати/)).toHaveCount(0);
  });

  // Regression: the second tap of a double tap on «Готово» must not reach the day sheet's «Зберегти»
  // under it while the editor closes (a closing sheet's backdrop keeps swallowing taps until it is gone).
  test('a double tap on «Готово» closes the editor only', async ({ app, page, server }) => {
    await mockFood(page, { estimate: PLATE_ESTIMATE });
    const { sheet, card } = await estimatePlate(app);
    await row(card, 'Гречка').click();
    const editor = itemEditor(page);
    await editor.getByRole('button', { name: 'Збільшити' }).click();
    await editor.getByRole('button', { name: 'Готово', exact: true }).dblclick();
    await expect(editor).toBeHidden();
    await expect(sheet).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(1);
    await expectRow(card, 1, { name: 'Гречка', portion: '210 г', kcal: '231' });
    expect((await server.getData()).days[TODAY]?.kcal ?? null).toBeNull();
  });
});

test.describe('«Часті страви»', () => {
  test('a chip adds the dish (kcal + line), also without AI; «Змінити» removes one', async ({
    app,
    page,
    server,
  }) => {
    await mockFood(page, { status: { enabled: false, remainingToday: 0 } });
    const sheet = await openToday(app);
    await expect(sheet.getByText('Часті страви', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Порахувати калорії', exact: true })).toHaveCount(0);

    // Ranked by use count: Кава з молоком (9) first.
    const chips = sheet.getByRole('button', { name: /^Додати .+ ккал$/ });
    await expect(chips).toHaveCount(5);
    await expect(chips.first()).toHaveAccessibleName('Додати «Кава з молоком», 60 ккал');

    await chips.first().click();
    await chips.first().click();
    const kcal = sheet.getByRole('textbox', { name: 'Калорії за день' });
    await expect(kcal).toHaveValue('120');
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveValue(
      `${TODAY_FOOD}\nКава з молоком (1 чашка) — 60 ккал\nКава з молоком (1 чашка) — 60 ккал`,
    );
    await app.save(sheet);
    await expect(app.region('Сьогодні')).toContainText('120 ккал');

    await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
    await sheet.getByRole('button', { name: 'Змінити' }).click();
    await sheet.getByRole('button', { name: 'Видалити «Яблуко» з частих страв' }).click();
    await expect(sheet.getByRole('button', { name: /Яблуко/ })).toHaveCount(0);
    // Focus moves to the next chip instead of falling to <body>.
    await expect(sheet.getByRole('button', { name: 'Видалити «Борщ» з частих страв' })).toBeFocused();
    await sheet.getByRole('button', { name: 'Готово' }).click();
    await expect(chips).toHaveCount(4);

    await expect
      .poll(async () => {
        const foods = (await server.getData()).foods;
        return {
          names: foods.map((f) => f.name).sort(),
          coffee: foods.find((f) => f.name === 'Кава з молоком'),
        };
      })
      .toEqual({
        names: ['Борщ', 'Вівсянка з бананом', 'Кава з молоком', 'Курка з рисом'],
        coffee: { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, count: 11, lastUsed: TODAY },
      });
  });

  test('dishes added to a draft that is then discarded are not counted', async ({ app, page, server }) => {
    await mockFood(page);
    const sheet = await openToday(app);
    await sheet.getByRole('button', { name: 'Додати «Кава з молоком», 60 ккал' }).click();
    await estimateText(sheet, 'борщ і хліб');
    await estimateCard(sheet).getByRole('button', { name: 'Додати 320 ккал' }).click();
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('380');

    await sheet.getByRole('button', { name: 'Закрити', exact: true }).click();
    await page
      .getByRole('alertdialog', { name: 'Є незбережені зміни' })
      .getByRole('button', { name: 'Закрити' })
      .click();
    await app.expectSheetClosed();
    await app.goto('/reminders');
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    const data = await server.getData();
    expect(data.days[TODAY]?.kcal).toBeNull();
    expect(data.foods.find((f) => f.name === 'Кава з молоком')?.count).toBe(9);
    expect(data.foods.find((f) => f.name === 'Борщ')?.count).toBe(3);
    expect(data.foods.find((f) => f.name === 'Хліб житній')).toBeUndefined();
  });

  test('with a mouse the chips wrap, so every dish is reachable without a horizontal scroll', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'mouse / trackpad layout only');
    await mockFood(page, { status: { enabled: false, remainingToday: 0 } });
    const sheet = await openToday(app);
    const list = sheet.getByRole('list', { name: 'Часті страви' });
    const chips = list.getByRole('button');
    await expect(chips).toHaveCount(5);

    // A vertical wheel cannot scroll a row with a hidden scrollbar: nothing may overflow sideways.
    expect(await list.evaluate((el) => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(0);
    const box = await list.boundingBox();
    if (!box) throw new Error('chip list not rendered');
    const tops = new Set<number>();
    for (const chip of await chips.all()) {
      const b = await chip.boundingBox();
      if (!b) throw new Error('chip not rendered');
      expect(b.x).toBeGreaterThanOrEqual(box.x - 1);
      expect(b.x + b.width).toBeLessThanOrEqual(box.x + box.width + 1);
      tops.add(Math.round(b.y));
    }
    // Five dishes do not fit the 560px modal in one line.
    expect(tops.size).toBeGreaterThan(1);
  });
});
