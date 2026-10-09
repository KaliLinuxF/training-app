import type { Locator } from '@playwright/test';
import type { App } from './support/app';
import { TODAY } from './support/env';
import { FOOD_JPEG, mockFood, PHOTO_ESTIMATE, PHOTO_ID } from './support/food';
import { expect, test } from './support/test';

const TODAY_FOOD = 'Вівсянка з бананом, кава';

async function openToday(app: App): Promise<Locator> {
  await app.goto('/');
  await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
  const sheet = app.sheet('Запис дня');
  await expect(sheet).toBeVisible();
  return sheet;
}

const estimateCard = (sheet: Locator) => sheet.getByRole('region', { name: 'Оцінка калорій' });

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

async function estimateText(sheet: Locator, text: string): Promise<void> {
  await sheet.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
  const ask = sheet.getByRole('textbox', { name: 'Що порахувати' });
  await expect(ask).toBeFocused();
  await ask.fill(text);
  await sheet.getByRole('button', { name: 'Порахувати', exact: true }).click();
}

test.describe('AI calorie estimate (mocked)', () => {
  test('from text: edit an item, «Додати N ккал» appends the line and adds the kcal', async ({
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
    await expect(card).toContainText('Борщ300 г');
    await expect(card).toContainText('Хліб житній2 скибки');
    await expect(card).toContainText('Разом320 ккал');
    expect(mocks.estimates).toEqual([{ date: TODAY, text: 'борщ 300 г і дві скибки житнього хліба' }]);

    await card.getByRole('textbox', { name: 'Хліб житній ккал' }).fill('160');
    await expect(card).toContainText('Разом340 ккал');
    await card.getByRole('button', { name: 'Додати 340 ккал' }).click();
    await expect(card).toBeHidden();

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

  test('removing items and «Скасувати» leave the day untouched', async ({ app, page }) => {
    await mockFood(page, { status: { enabled: true, remainingToday: 3 } });
    const sheet = await openToday(app);
    await estimateText(sheet, 'борщ і хліб');
    const card = estimateCard(sheet);
    // One estimate used: 2 left today.
    await expect(card).toContainText('Сьогодні ще 2 підрахунки');
    await card.getByRole('button', { name: 'Прибрати «Борщ»' }).click();
    await expect(card).toContainText('1 позиція · можна виправити');
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
    await expect(card).toContainText('Сирники зі сметаною3 шт');
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

  test('a failed estimate shows the error and keeps the typed text', async ({ app, page }) => {
    await mockFood(page, {
      estimate: { status: 502, body: { error: 'ai_failed', message: 'Не вдалося отримати оцінку' } },
    });
    const sheet = await openToday(app);
    await estimateText(sheet, 'щось дивне');
    await expect(app.toast('Не вдалося розпізнати — спробуй описати текстом')).toBeVisible();
    await expect(estimateCard(sheet)).toHaveCount(0);
    await expect(sheet.getByRole('textbox', { name: 'Що порахувати' })).toHaveValue('щось дивне');
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
    await sheet.getByRole('button', { name: 'Додати Яблуко · 80 ккал' }).click();
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toHaveValue('80');
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
    await expect(sheet.getByText('Ліміт підрахунків на сьогодні вичерпано')).toBeVisible();
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
    await app.save(sheet);
    await expect.poll(async () => (await server.getData()).days[TODAY]?.kcal).toBe(420);
    expect((await server.getData()).days[TODAY]?.photos).toBeUndefined();
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
    await expect(chips.first()).toHaveAccessibleName('Додати Кава з молоком · 60 ккал');

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

  // FIXME(app finding «Discarded drafts still bump «Часті страви»»): `food.use` is committed when the
  // chip / «Додати N ккал» is tapped, not when the day is saved, so a discarded draft still counts.
  test.fixme('a dish added to a draft that is then discarded is not counted', async ({
    app,
    page,
    server,
  }) => {
    await mockFood(page, { status: { enabled: false, remainingToday: 0 } });
    const sheet = await openToday(app);
    await sheet.getByRole('button', { name: 'Додати Кава з молоком · 60 ккал' }).click();
    page.once('dialog', (d) => void d.accept());
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();
    await app.goto('/reminders');
    await expect(app.region('Дані')).toContainText('Усе синхронізовано');
    const data = await server.getData();
    expect(data.days[TODAY]?.kcal).toBeNull();
    expect(data.foods.find((f) => f.name === 'Кава з молоком')?.count).toBe(9);
  });
});
