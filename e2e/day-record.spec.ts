import type { Page } from '@playwright/test';
import { TODAY } from './support/env';
import { expect, test } from './support/test';

/** The in-app «Є незбережені зміни» question (`ui.confirm`, an alertdialog — never a native confirm). */
const discardQuestion = (page: Page) => page.getByRole('alertdialog', { name: 'Є незбережені зміни' });

test.describe('day record', () => {
  test('training + types (incl. a new own type), food, kcal ±50, notes, weight and measurements', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/');
    const todayCard = app.region('Сьогодні');
    await expect(todayCard).toContainText('Записано');
    await expect(todayCard).toContainText('Тренування · ще не відмічено');

    await todayCard.getByRole('button', { name: 'Відкрити день' }).click();
    const sheet = app.sheet('Запис дня');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('14 жовтня 2026');
    await expect(sheet).toContainText('середа · сьогодні');
    await expect(sheet.getByRole('button', { name: 'Наступний день' })).toBeDisabled();

    // Training: «Було» reveals the type chips; «+ Свій тип» adds and selects her own type.
    const training = sheet.getByRole('group', { name: 'Тренування' }).first();
    await training.getByRole('button', { name: 'Було', exact: true }).click();
    await expect(training.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await sheet.getByRole('button', { name: 'Кардіо', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Кардіо', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await sheet.getByRole('button', { name: '+ Свій тип' }).click();
    const newType = sheet.getByRole('textbox', { name: 'Новий тип тренування' });
    await expect(newType).toBeFocused();
    await newType.fill('  Йога ');
    await newType.press('Enter');
    await expect(sheet.getByRole('button', { name: 'Йога', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // Food text.
    const food = sheet.getByRole('textbox', { name: 'Що я їла' });
    await expect(food).toHaveValue('Вівсянка з бананом, кава');
    await food.fill('Вівсянка з бананом, кава\nБорщ, салат');

    // Kcal: digits only, ±50, validation.
    const kcal = sheet.getByRole('textbox', { name: 'Калорії за день' });
    await kcal.fill('15x00');
    await expect(kcal).toHaveValue('1500');
    await sheet.getByRole('button', { name: 'Плюс 50 ккал' }).click();
    await sheet.getByRole('button', { name: 'Плюс 50 ккал' }).click();
    await sheet.getByRole('button', { name: 'Мінус 50 ккал' }).click();
    await expect(kcal).toHaveValue('1550');
    await kcal.fill('25000');
    await expect(sheet.getByRole('alert')).toHaveText('Калорії — не більше 20 000 ккал');
    await expect(sheet.getByRole('button', { name: 'Зберегти' })).toBeDisabled();
    await kcal.fill('1550');
    await expect(sheet.getByRole('alert')).toHaveCount(0);

    // Optional weight and measurements.
    await sheet.getByRole('textbox', { name: 'Вага (за бажанням)' }).fill('65,1');
    await sheet.locator('input[name="chest"]').fill('89,5');
    await sheet.locator('input[name="waist"]').fill('69,5');
    await sheet.locator('input[name="hips"]').fill('97');

    await sheet.getByRole('textbox', { name: 'Нотатки' }).fill('Легке тренування, 2 л води');

    await app.save(sheet);

    const expectHome = async () => {
      await expect(todayCard).toContainText('Записано');
      await expect(todayCard).toContainText('1 550 ккал');
      await expect(todayCard).toContainText('Тренування · Кардіо, Йога');
      await expect(todayCard.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      await expect(app.region('Поточна вага')).toContainText('65,1');
      await expect(app.region('Поточні заміри')).toContainText('69,5');
      // The workout reminder for today is done now.
      await expect(page.getByText('Тренування за планом')).toBeHidden();
    };
    await expectHome();
    await app.reload();
    await expectHome();

    await app.go('Календар');
    const day = app.region('14 жовтня 2026');
    await expect(day).toContainText('Заповнено');
    await expect(day).toContainText('Вівсянка з бананом, кава');
    await expect(day).toContainText('Борщ, салат');
    await expect(day).toContainText('1 550 ккал');
    await expect(day).toContainText('✓ Кардіо, Йога');
    await expect(day).toContainText('65,1 кг');
    await expect(day).toContainText('Груди 89,5 · Талія 69,5 · Стегна 97');
    await expect(day).toContainText('Легке тренування, 2 л води');
    await expect(day.getByRole('button', { name: 'Редагувати день' })).toBeVisible();

    // The calendar detail survives a reload too.
    await app.reload();
    await expect(app.region('14 жовтня 2026')).toContainText('✓ Кардіо, Йога');

    await expect
      .poll(async () => {
        const d = await server.getData();
        return {
          day: d.days[TODAY],
          weight: d.weights.find((w) => w.date === TODAY)?.kg,
          measure: d.measures.find((m) => m.date === TODAY),
          customTypes: d.settings.customTypes,
        };
      })
      .toEqual({
        day: {
          food: 'Вівсянка з бананом, кава\nБорщ, салат',
          kcal: 1550,
          trained: true,
          types: ['Кардіо', 'Йога'],
          notes: 'Легке тренування, 2 л води',
        },
        weight: 65.1,
        measure: { date: TODAY, chest: 89.5, waist: 69.5, hips: 97 },
        customTypes: ['Йога'],
      });
  });

  test('«✕ Не було» on Home marks the day at once and keeps the food', async ({ app, page, server }) => {
    await app.goto('/');
    const todayCard = app.region('Сьогодні');
    await expect(page.getByText('Тренування за планом')).toBeVisible();

    await todayCard.getByRole('button', { name: 'Не було', exact: true }).click();
    await expect(app.toast('Відмічено: без тренування')).toBeVisible();
    await expect(todayCard).toContainText('Тренування · Не було');
    await expect(todayCard.getByRole('button', { name: 'Не було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(todayCard).toContainText('Записано');
    await expect(page.getByText('Тренування за планом')).toBeHidden();
    await expect(app.dialogs).toHaveCount(0);

    await expect
      .poll(async () => (await server.getData()).days[TODAY])
      .toEqual({ food: 'Вівсянка з бананом, кава', kcal: null, trained: false, types: [], notes: '' });

    await app.reload();
    await expect(todayCard.getByRole('button', { name: 'Не було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    // «✓ Було» opens the sheet pre-set to «Було»; dropping that draft asks first.
    await todayCard.getByRole('button', { name: 'Було', exact: true }).click();
    const sheet = app.sheet('Запис дня');
    await expect(
      sheet
        .getByRole('group', { name: 'Тренування' })
        .first()
        .getByRole('button', { name: 'Було', exact: true }),
    ).toHaveAttribute('aria-pressed', 'true');
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    const ask = discardQuestion(page);
    await expect(ask).toContainText('Закрити без збереження?');
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
    await expect(ask).toBeHidden();
    await app.expectSheetClosed();
    await expect(todayCard).toContainText('Тренування · Не було');
  });

  test('saving the day on a device that missed another device’s weigh-in keeps it', async ({ app, server }) => {
    await app.goto('/');
    // Meanwhile the phone records today's weigh-in and measurements (this tab has not re-read the server).
    const phone = await server.getData();
    phone.weights.push({ date: TODAY, kg: 65.1 });
    phone.measures.push({ date: TODAY, chest: 89.5, waist: 69.5, hips: 97.5 });
    await server.importData(phone);

    await app.recordButton().click();
    const sheet = app.sheet('Запис дня');
    await sheet.getByRole('textbox', { name: 'Нотатки' }).fill('Сон 8 годин');
    await app.save(sheet);

    await expect
      .poll(async () => {
        const d = await server.getData();
        return {
          notes: d.days[TODAY]?.notes,
          food: d.days[TODAY]?.food,
          weight: d.weights.find((w) => w.date === TODAY)?.kg,
          measure: d.measures.find((m) => m.date === TODAY),
        };
      })
      .toEqual({
        notes: 'Сон 8 годин',
        food: 'Вівсянка з бананом, кава',
        weight: 65.1,
        measure: { date: TODAY, chest: 89.5, waist: 69.5, hips: 97.5 },
      });
  });

  test('quick buttons, the «+» / «Записати день» button and Escape', async ({ app, page }) => {
    await app.goto('/');

    await app.quickAction('Харчування').click();
    let sheet = app.sheet('Запис дня');
    await expect(sheet.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await page.keyboard.press('Escape');
    await app.expectSheetClosed();

    await app.quickAction('Тренування').click();
    await expect(sheet.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    // Pre-set «Було» is a change: Escape asks; Escape again answers «stay» and keeps the sheet open.
    await page.keyboard.press('Escape');
    const ask = discardQuestion(page);
    await expect(ask).toBeVisible();
    await expect(ask.getByRole('button', { name: 'Залишитись' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(ask).toBeHidden();
    await expect(sheet).toBeVisible();
    await sheet.getByRole('button', { name: 'Не було', exact: true }).click();
    await expect(sheet.getByRole('button', { name: 'Прес', exact: true })).toBeHidden();
    await app.save(sheet);
    await expect(app.region('Сьогодні')).toContainText('Тренування · Не було');

    await app.quickAction('Вага').click();
    sheet = app.sheet('Контрольне зважування');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    await app.quickAction('Заміри').click();
    sheet = app.sheet('Заміри тіла');
    await expect(sheet.locator('input[name="waist"]')).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: /Вага/ })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    await app.recordButton().click();
    await expect(app.sheet('Запис дня')).toBeVisible();
  });
});
