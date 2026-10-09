import type { Page } from '@playwright/test';
import { TODAY } from './support/env';
import { expect, test } from './support/test';

/** The in-app «Є незбережені зміни» question (`ui.confirm`, an alertdialog — never a native confirm). */
const discardQuestion = (page: Page) => page.getByRole('alertdialog', { name: 'Є незбережені зміни' });

test.describe('day record', () => {
  test('training + types (incl. a new own type), food, kcal ±50, notes, weight and measurements', async ({
    app,
    server,
  }) => {
    await app.goto('/');
    const todayCard = app.region('Сьогодні');
    await expect(app.homeRow('Їжа')).toContainText('Записано');
    // The demo seed's Wednesday is a planned workout day, not marked yet.
    await expect(app.homeRow('Тренування')).toContainText('За планом о 18:00');

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

    // The full day shows the notes open (no «+ Нотатка до дня» fold).
    await expect(sheet.getByRole('button', { name: '+ Нотатка до дня' })).toHaveCount(0);
    await sheet.getByRole('textbox', { name: 'Нотатки' }).fill('Легке тренування, 2 л води');

    await app.save(sheet);

    const expectHome = async () => {
      await expect(app.homeRow('Їжа')).toContainText('1 550');
      await expect(app.homeRow('Тренування')).toContainText('Кардіо, Йога');
      await expect(app.trainingToggle('Було')).toHaveAttribute('aria-pressed', 'true');
      await expect(app.region('Поточна вага')).toContainText('65,1');
      await expect(app.homeRow('Заміри')).toContainText('69,5');
      // The workout planned for today is done now.
      await expect(app.homeRow('Тренування')).not.toContainText('За планом');
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
    await expect(day).toContainText('Кардіо, Йога');
    await expect(day).toContainText('65,1 кг');
    await expect(day).toContainText('Груди 89,5 · Талія 69,5 · Стегна 97');
    await expect(day).toContainText('Легке тренування, 2 л води');
    await expect(day.getByRole('button', { name: 'Редагувати день' })).toBeVisible();

    // The calendar detail survives a reload too.
    await app.reload();
    await expect(app.region('14 жовтня 2026')).toContainText('Кардіо, Йога');

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

  test('«✕» and «✓» on Home mark the day at once and keep the food; types are added through the row', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/');
    const workout = app.homeRow('Тренування');
    await expect(workout).toContainText('За планом о 18:00');

    await app.trainingToggle('Не було').click();
    await expect(app.toast('Відмічено: без тренування')).toBeVisible();
    await expect(workout).toContainText('Не було');
    await expect(workout).not.toContainText('За планом');
    await expect(app.trainingToggle('Не було')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.homeRow('Їжа')).toContainText('Записано');
    await expect(app.dialogs).toHaveCount(0);

    await expect
      .poll(async () => (await server.getData()).days[TODAY])
      .toEqual({ food: 'Вівсянка з бананом, кава', kcal: null, trained: false, types: [], notes: '' });

    await app.reload();
    await expect(app.trainingToggle('Не було')).toHaveAttribute('aria-pressed', 'true');

    // «✓ Було» saves at once too; the row then asks for a type.
    await app.trainingToggle('Було').click();
    await expect(app.toast('Відмічено: тренування було')).toBeVisible();
    await expect(app.trainingToggle('Було')).toHaveAttribute('aria-pressed', 'true');
    await expect(workout).toContainText('Було · додай тип');
    await expect(app.dialogs).toHaveCount(0);
    await expect
      .poll(async () => (await server.getData()).days[TODAY])
      .toEqual({ food: 'Вівсянка з бананом, кава', kcal: null, trained: true, types: [], notes: '' });

    // The row opens «Тренування» with ✓; a type left unsaved is a change, so closing asks first.
    await workout.click();
    const sheet = app.sheet('Тренування');
    await expect(sheet.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await sheet.getByRole('button', { name: 'Низ тіла', exact: true }).click();
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    const ask = discardQuestion(page);
    await expect(ask).toContainText('Закрити без збереження?');
    await ask.getByRole('button', { name: 'Закрити', exact: true }).click();
    await expect(ask).toBeHidden();
    await app.expectSheetClosed();
    await expect(workout).toContainText('Було · додай тип');

    // Saved, the type shows in the row.
    await workout.click();
    await sheet.getByRole('button', { name: 'Низ тіла', exact: true }).click();
    await app.save(sheet);
    await expect(workout).toContainText('Низ тіла');
    await expect.poll(async () => (await server.getData()).days[TODAY]?.types).toEqual(['Низ тіла']);
  });

  test('saving the workout on a device that missed another device’s weigh-in keeps it', async ({
    app,
    server,
  }) => {
    await app.goto('/');
    // Meanwhile the phone records today's weigh-in and measurements (this tab has not re-read the server).
    const phone = await server.getData();
    phone.weights.push({ date: TODAY, kg: 65.1 });
    phone.measures.push({ date: TODAY, chest: 89.5, waist: 69.5, hips: 97.5 });
    await server.importData(phone);

    const sheet = await app.record('Тренування');
    await sheet.getByRole('button', { name: '+ Нотатка до дня' }).click();
    await sheet.getByRole('textbox', { name: 'Нотатки' }).fill('Сон 8 годин');
    await app.save(sheet);

    await expect
      .poll(async () => {
        const d = await server.getData();
        return {
          notes: d.days[TODAY]?.notes,
          food: d.days[TODAY]?.food,
          trained: d.days[TODAY]?.trained,
          weight: d.weights.find((w) => w.date === TODAY)?.kg,
          measure: d.measures.find((m) => m.date === TODAY),
        };
      })
      .toEqual({
        notes: 'Сон 8 годин',
        food: 'Вівсянка з бананом, кава',
        trained: null,
        weight: 65.1,
        measure: { date: TODAY, chest: 89.5, waist: 69.5, hips: 97.5 },
      });
  });

  test('the «Що записати?» menu: each item swaps to its sheet; Escape and unsaved changes', async ({
    app,
    page,
  }) => {
    await app.goto('/');

    let sheet = await app.record('Повний запис дня');
    await expect(sheet.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toBeVisible();
    await page.keyboard.press('Escape');
    await app.expectSheetClosed();

    sheet = await app.record('Їжа');
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveValue('Вівсянка з бананом, кава');
    await expect(sheet.getByRole('textbox', { name: 'Калорії за день' })).toBeVisible();
    await expect(sheet.getByRole('group', { name: 'Тренування' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await app.expectSheetClosed();

    sheet = await app.record('Тренування');
    await expect(sheet.getByRole('button', { name: 'Було', exact: true })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Було', exact: true }).click();
    // A change: Escape asks; Escape again answers «stay» and keeps the sheet open.
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
    await expect(app.homeRow('Тренування')).toContainText('Не було');

    sheet = await app.record('Вага');
    await expect(sheet.getByRole('textbox', { name: 'Що я їла' })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    sheet = await app.record('Заміри');
    await expect(sheet.locator('input[name="waist"]')).toBeVisible();
    await expect(sheet.getByRole('textbox', { name: /Вага/ })).toHaveCount(0);
    await sheet.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    await app.recordButton().click();
    await expect(app.sheet('Що записати?')).toBeVisible();
  });
});
