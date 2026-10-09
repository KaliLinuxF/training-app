import type { Locator, Page } from '@playwright/test';
import type { App } from './support/app';
import { expect, test } from './support/test';

/** A «label — value» row of the Home control card (the label span and its row). */
const controlRow = (page: Page, label: string) => page.getByText(label, { exact: true }).locator('..');

test.describe('reminders & settings', () => {
  test('switches, weekdays and times are saved, survive a reload and drive Home', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/reminders');

    // Workout: add Tuesday, move the time.
    const workout = app.region('Тренування');
    const workoutDays = workout.getByRole('group', { name: 'Дні тренувань' });
    await expect(workout).toContainText('Пн, Ср, Пт · 18:00');
    await workoutDays.getByRole('button', { name: 'Вівторок' }).click();
    await expect(workoutDays.getByRole('button', { name: 'Вівторок' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await workout.getByLabel('Час').fill('19:30');
    await expect(workout).toContainText('Пн, Вт, Ср, Пт · 19:30');

    // Weigh-in: Thursday 07:45.
    const weigh = app.region('Контрольне зважування');
    await weigh
      .getByRole('radiogroup', { name: 'День зважування' })
      .getByRole('radio', { name: 'Четвер' })
      .click();
    await expect(weigh).toContainText('Раз на тиждень · четвер');
    await weigh.getByLabel('Час').fill('07:45');

    // Measurements: off.
    const measure = app.region('Заміри тіла');
    const measureSwitch = measure.getByRole('switch', { name: 'Заміри тіла' });
    await expect(measureSwitch).toHaveAttribute('aria-checked', 'true');
    await measureSwitch.click();
    await expect(measureSwitch).toHaveAttribute('aria-checked', 'false');

    const expectSaved = async () => {
      await expect(workoutDays.getByRole('button', { name: 'Вівторок' })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(workout.getByLabel('Час')).toHaveValue('19:30');
      await expect(weigh.getByRole('radio', { name: 'Четвер' })).toHaveAttribute('aria-checked', 'true');
      await expect(weigh.getByLabel('Час')).toHaveValue('07:45');
      await expect(weigh.getByRole('switch')).toHaveAttribute('aria-checked', 'true');
      await expect(measureSwitch).toHaveAttribute('aria-checked', 'false');
    };
    await expectSaved();
    await expect
      .poll(async () => (await server.getData()).settings.rem)
      .toEqual({
        workout: { on: true, days: [1, 2, 3, 5], time: '19:30' },
        weigh: { on: true, day: 4, time: '07:45' },
        measure: { on: false, day: 1, time: '08:30' },
      });
    await app.reload();
    await expectSaved();

    // Home: Thursday is tomorrow; measurements are off.
    await app.go('Головна');
    await expect(controlRow(page, 'Наступне зважування')).toContainText('Завтра · 07:45');
    await expect(controlRow(page, 'Наступні заміри')).toContainText('вимкнено');
    await expect(page.getByText('Сьогодні о 19:30 — відміть, як пройде')).toBeVisible();
  });

  test('goal steppers update the Home hero and the kcal goal', async ({ app, page, server }) => {
    await app.goto('/');
    const hero = app.region('Поточна вага');
    await expect(hero).toContainText('Ціль 60,0');
    await expect(hero).toContainText('35% шляху');

    await app.go('Нагадування');
    const goals = app.region('Мої цілі');
    const goal = goals.getByRole('group', { name: 'Цільова вага' });
    const kcal = goals.getByRole('group', { name: 'Калорії на день' });
    await expect(goal.locator('output')).toHaveText('60,0 кг');
    for (let i = 0; i < 3; i++) await goal.getByRole('button', { name: 'Збільшити цільову вагу' }).click();
    await expect(goal.locator('output')).toHaveText('61,5 кг');
    await kcal.getByRole('button', { name: 'Збільшити калорії на день' }).click();
    await kcal.getByRole('button', { name: 'Збільшити калорії на день' }).click();
    await kcal.getByRole('button', { name: 'Зменшити калорії на день' }).click();
    await expect(kcal.locator('output')).toHaveText('1 750 ккал');

    await app.go('Головна');
    await expect(hero).toContainText('Ціль 61,5');
    await expect(hero).toContainText('3,9 кг'); // «До цілі» 65,4 − 61,5
    await expect(hero).toContainText('43% шляху');

    await app.go('Прогрес');
    await expect(app.region('Харчування')).toContainText('ціль 1 750 ккал');
    await expect(app.region('Вага')).toContainText('Цільова61,5');

    await expect
      .poll(async () => {
        const { goal: g, kcalGoal } = (await server.getData()).settings;
        return { g, kcalGoal };
      })
      .toEqual({ g: 61.5, kcalGoal: 1750 });
    await app.reload();
    await expect(page.getByText('ціль 1 750 ккал')).toBeVisible();
  });

  test('theme switch applies at once and is remembered on the device', async ({ app, page }) => {
    await app.goto('/reminders');
    const theme = app.region('Вигляд').getByRole('radiogroup', { name: 'Тема' });
    const html = page.locator('html');
    await expect(theme.getByRole('radio', { name: 'Авто' })).toHaveAttribute('aria-checked', 'true');
    await expect(html).not.toHaveAttribute('data-theme');
    const lightBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);

    await theme.getByRole('radio', { name: 'Темна' }).click();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect
      .poll(() => page.evaluate(() => getComputedStyle(document.body).backgroundColor))
      .not.toBe(lightBg);
    await expect(page.locator('meta[name="theme-color"]').first()).toHaveAttribute('content', '#12151A');

    await app.reload();
    await expect(html).toHaveAttribute('data-theme', 'dark');
    await expect(theme.getByRole('radio', { name: 'Темна' })).toHaveAttribute('aria-checked', 'true');

    await theme.getByRole('radio', { name: 'Світла' }).click();
    await expect(html).toHaveAttribute('data-theme', 'light');
    await theme.getByRole('radio', { name: 'Авто' }).click();
    await expect(html).not.toHaveAttribute('data-theme');
    expect(await page.evaluate(() => localStorage.getItem('legko.theme'))).toBeNull();
  });

  test('own workout types: add, reject duplicates, use in the day sheet, remove', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/reminders');
    const types = app.region('Мої тренування');
    const input = types.getByRole('textbox', { name: 'Свій тип тренування' });
    const add = types.getByRole('button', { name: 'Додати', exact: true });
    await expect(add).toBeDisabled();

    await input.fill('Пілатес');
    await add.click();
    await expect(types.getByRole('button', { name: 'Видалити «Пілатес»' })).toBeVisible();
    await expect(input).toHaveValue('');

    await input.fill('кардіо');
    await input.press('Enter');
    await expect(types.getByRole('alert')).toHaveText('«Кардіо» вже є у списку');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await input.fill('');
    await expect(types.getByRole('alert')).toHaveCount(0);

    await expect.poll(async () => (await server.getData()).settings.customTypes).toEqual(['Пілатес']);

    await app.recordButton().click();
    const sheet = app.sheet('Запис дня');
    await sheet.getByRole('button', { name: 'Було', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Пілатес', exact: true })).toBeVisible();
    // «Було» is an unsaved change: Escape asks (in the app's own dialog) before closing.
    await page.keyboard.press('Escape');
    await page
      .getByRole('alertdialog', { name: 'Є незбережені зміни' })
      .getByRole('button', { name: 'Закрити', exact: true })
      .click();
    await app.expectSheetClosed();

    await types.getByRole('button', { name: 'Видалити «Пілатес»' }).click();
    await expect(types.getByText('Пілатес')).toHaveCount(0);
    await expect.poll(async () => (await server.getData()).settings.customTypes).toEqual([]);
  });

  test('a goal outside the stepper range moves one ordinary step back, without a jump', async ({
    app,
    server,
  }) => {
    // Older data or a restored backup can hold a goal outside the steppers' 800–5000 kcal / 30–200 kg.
    const data = await server.getData();
    await server.importData({ ...data, settings: { ...data.settings, goal: 25, kcalGoal: 6000 } });
    await app.goto('/reminders');
    const goals = app.region('Мої цілі');
    const kcal = goals.getByRole('group', { name: 'Калорії на день' });
    const goal = goals.getByRole('group', { name: 'Цільова вага' });
    await expect(kcal.locator('output')).toHaveText('6 000 ккал');
    await expect(kcal.getByRole('button', { name: 'Збільшити калорії на день' })).toBeDisabled();
    await kcal.getByRole('button', { name: 'Зменшити калорії на день' }).click();
    await expect(kcal.locator('output')).toHaveText('5 950 ккал');

    await expect(goal.getByRole('button', { name: 'Зменшити цільову вагу' })).toBeDisabled();
    await goal.getByRole('button', { name: 'Збільшити цільову вагу' }).click();
    await expect(goal.locator('output')).toHaveText('25,5 кг');
    await expect
      .poll(async () => {
        const { goal: g, kcalGoal } = (await server.getData()).settings;
        return { g, kcalGoal };
      })
      .toEqual({ g: 25.5, kcalGoal: 5950 });
  });
});

test.describe('reminders layout', () => {
  /** Right edge of the card's content box (inside the 18px padding and the 1px border). */
  const innerRight = async (card: Locator) => {
    const box = await card.boundingBox();
    if (!box) throw new Error('card is not visible');
    return box.x + box.width - 19;
  };

  const expectStepperInside = async (app: App, at: string) => {
    const goals = app.region('Мої цілі');
    const right = await innerRight(goals);
    for (const name of ['Збільшити цільову вагу', 'Збільшити калорії на день']) {
      const box = await goals.getByRole('button', { name }).boundingBox();
      if (!box) throw new Error(`«${name}» is not visible @${at}`);
      expect(box.x + box.width, `«${name}» @${at}`).toBeLessThanOrEqual(right + 0.5);
    }
  };

  /** Text taller than ~1.5 font sizes has wrapped onto a second line. */
  const lines = (el: Element) => {
    const fontSize = parseFloat(getComputedStyle(el).fontSize);
    return Math.round(el.getBoundingClientRect().height / (fontSize * 1.25));
  };

  test('on a 320px phone the goal steppers stay inside their card and the panel title on one line', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone widths');
    await page.setViewportSize({ width: 320, height: 700 });
    await app.goto('/reminders');
    await expectStepperInside(app, '320px');

    // iPhone Safari tab: the panel explains the home-screen install.
    const panel = app.region('Сповіщення на телефон');
    const title = panel.getByRole('heading', { name: 'Сповіщення на телефон' });
    expect(await title.evaluate(lines)).toBe(1);
    await panel.getByRole('button', { name: 'Як?' }).click();
    await expect(app.sheet('Встановлення на iPhone')).toBeVisible();
  });

  test('on her iPhone (390px) the panel keeps the prototype row: title on one line, «Як?» beside it', async ({
    app,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone widths');
    await app.goto('/reminders');
    const panel = app.region('Сповіщення на телефон');
    const title = panel.getByRole('heading', { name: 'Сповіщення на телефон' });
    const cta = panel.getByRole('button', { name: 'Як?' });
    expect(await title.evaluate(lines)).toBe(1);
    const [titleBox, ctaBox] = await Promise.all([title.boundingBox(), cta.boundingBox()]);
    if (!titleBox || !ctaBox) throw new Error('panel is not visible');
    expect(ctaBox.x).toBeGreaterThan(titleBox.x + titleBox.width);
    await expectStepperInside(app, '390px');
  });

  test('in a narrow desktop window the goal steppers stay inside their column', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');
    for (const width of [900, 960, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await app.goto('/reminders');
      await expectStepperInside(app, `${width}px`);
    }
  });
});
