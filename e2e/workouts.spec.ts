/**
 * «Мої тренування» and the builder (docs/workouts-steps-rebrand.md §3.5–§3.7): a workout composed from the picker,
 * reordered, duplicated and trimmed, given a weekday that joins the plan (and shows in Settings → Нагадування),
 * edited with a draft that survives leaving the page, and deleted. Runs on the phone and the desktop project.
 */
import { pickExercises } from './support/exercises';
import { expect, test } from './support/test';
import {
  builderCards,
  builderNames,
  cardAction,
  confirm,
  openWorkouts,
  pageTitle,
  startButton,
  workoutRow,
} from './support/workouts';

test.describe('a new workout', () => {
  test.use({ seed: 'onboarded' });

  test('«Ноги + прес» from the picker: reorder with the buttons, duplicate, delete one, Чт joins the plan', async ({
    app,
    page,
    server,
  }) => {
    await openWorkouts(page);
    await expect(page.getByText(/^Склади тренування з вправ/)).toBeVisible();
    await page.getByRole('button', { name: '+ Нове тренування', exact: true }).click();
    await expect(page).toHaveURL(/\/workouts\/new$/);
    await expect(pageTitle(page, 'Нове тренування')).toBeVisible();
    // The full-screen builder has no phone tab bar (W15).
    if (test.info().project.name === 'iphone') await expect(app.nav).toHaveCount(0);

    // Saving needs a name and an exercise.
    await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
    await expect(page.getByText('Дай тренуванню назву')).toBeVisible();
    await expect(page.getByRole('alert')).toHaveText('Додай хоча б одну вправу');

    await page.getByRole('textbox', { name: 'Назва' }).fill('Ноги + прес');
    await page.getByRole('button', { name: '+ Додати вправи', exact: true }).click();
    await pickExercises(page, ['Присідання зі штангою', 'Скручування', 'Планка']);
    expect(await builderNames(page)).toEqual(['Присідання зі штангою', 'Скручування', 'Планка']);

    // ↓ on the squat: it moves one down, the position is announced, focus stays on the card's arrows.
    await page.getByRole('button', { name: 'Вниз: Присідання зі штангою', exact: true }).click();
    expect(await builderNames(page)).toEqual(['Скручування', 'Присідання зі штангою', 'Планка']);
    await expect(page.getByText('Присідання зі штангою — 2 з 3', { exact: true })).toBeAttached();
    await expect(
      page.getByRole('button', { name: 'Вниз: Присідання зі штангою', exact: true }),
    ).toBeFocused();
    await page.getByRole('button', { name: 'Вгору: Присідання зі штангою', exact: true }).click();
    expect(await builderNames(page)).toEqual(['Присідання зі штангою', 'Скручування', 'Планка']);

    // Duplicate the crunch, then delete the plank.
    await cardAction(page, builderCards(page).nth(1), 'Скручування', 'Дублювати');
    expect(await builderNames(page)).toEqual([
      'Присідання зі штангою',
      'Скручування',
      'Скручування',
      'Планка',
    ]);
    await cardAction(page, builderCards(page).nth(3), 'Планка', 'Видалити');
    await expect(app.toast('Вправу прибрано')).toBeVisible();
    expect(await builderNames(page)).toEqual(['Присідання зі штангою', 'Скручування', 'Скручування']);

    // The squat's sets: «Змінити» opens one stepper per line.
    const squat = builderCards(page).first();
    await squat.getByRole('button', { name: 'Змінити: Присідання зі штангою' }).click();
    await squat.getByRole('button', { name: 'Вага: більше', exact: true }).click();
    await squat.getByRole('button', { name: 'Відпочинок: більше', exact: true }).click();
    await expect(squat).toContainText(/3 × 10 · 2,5\sкг · відпочинок 1:45/);
    await squat.getByRole('button', { name: 'Готово', exact: true }).click();

    // Чт is not in the plan (Пн, Ср, Пт): saving adds it.
    await expect(page.getByText(/^У ці дні нагадаю о 18:00\./)).toBeVisible();
    await page.getByRole('group', { name: 'Дні тренувань' }).getByRole('button', { name: 'Четвер' }).click();
    await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
    await expect(app.toast('Збережено · Чт додано до плану')).toBeVisible();
    await expect(pageTitle(page, 'Мої тренування')).toBeVisible();
    await expect(workoutRow(page, 'Ноги + прес')).toContainText('Чт · 3 вправи');
    await expect(startButton(page, 'Ноги + прес')).toBeVisible();

    const stored = await server.getData();
    expect(stored.workouts).toHaveLength(1);
    expect(stored.workouts[0]).toMatchObject({ name: 'Ноги + прес', days: [4] });
    expect(stored.workouts[0]!.items.map((i) => i.exerciseId)).toEqual([
      'lib.back-squat',
      'lib.crunch',
      'lib.crunch',
    ]);
    expect(stored.workouts[0]!.items[0]).toMatchObject({
      restSec: 105,
      sets: [{ kg: 2.5, reps: 10 }, { kg: 2.5 }, { kg: 2.5 }],
    });
    expect(stored.settings.rem.workout.days).toEqual([1, 3, 4, 5]);

    // Settings → Нагадування lists the plan day with the workout.
    await app.goto('/');
    await app.openSettings('Нагадування');
    const schedule = page.getByRole('group', { name: 'За розкладом' });
    await expect(schedule).toContainText('Чт — Ноги + прес');
    await expect(schedule).not.toContainText('не в плані');
  });
});

test.describe('an existing workout', () => {
  test.use({ seed: 'training' });

  test('edit: a draft is restored after leaving the page; «Скинути» drops it; then delete the workout', async ({
    app,
    page,
    server,
  }) => {
    await openWorkouts(page);
    await expect(workoutRow(page, 'Ноги + прес')).toContainText('Пн, Ср · 4 вправи');
    await expect(workoutRow(page, 'Ноги + прес').getByText('Сьогодні', { exact: true })).toBeVisible();
    await workoutRow(page, 'Ноги + прес').click();
    await expect(pageTitle(page, 'Ноги + прес')).toBeVisible();

    await page.getByRole('textbox', { name: 'Назва' }).fill('Ноги, прес і спина');
    // Leave without saving: the sidebar on the desktop, the system back gesture on the phone (no in-app blocker).
    if (test.info().project.name === 'desktop') {
      await app.nav.getByRole('link', { name: 'Головна', exact: true }).click();
      await expect(app.heading('Головна')).toBeVisible();
    } else {
      await page.goBack();
      await expect(pageTitle(page, 'Мої тренування')).toBeVisible();
    }

    await openWorkouts(page);
    await workoutRow(page, 'Ноги + прес').click();
    await expect(page.getByText('Є незбережені зміни · Відновлено', { exact: true })).toBeVisible();
    await expect(page.getByRole('textbox', { name: 'Назва' })).toHaveValue('Ноги, прес і спина');
    // The workout itself is unchanged until «Зберегти».
    expect((await server.getData()).workouts.map((w) => w.name)).toEqual(['Ноги + прес', 'Верх тіла']);

    // Only the screen's own «‹» asks.
    await page.getByRole('link', { name: 'Назад: Мої тренування', exact: true }).click();
    await confirm(page, 'Вийти без збереження?', 'Залишитися');
    await page.getByRole('button', { name: 'Скинути', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Назва' })).toHaveValue('Ноги + прес');
    await expect(page.getByText('Є незбережені зміни · Відновлено')).toHaveCount(0);

    await page.getByRole('button', { name: 'Видалити тренування', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Видалити тренування «Ноги + прес»?' });
    await expect(dialog).toContainText('Записані тренування залишаться.');
    await dialog.getByRole('button', { name: 'Видалити', exact: true }).click();
    await expect(app.toast('Тренування видалено')).toBeVisible();
    await expect(pageTitle(page, 'Мої тренування')).toBeVisible();
    await expect(workoutRow(page, 'Ноги + прес')).toHaveCount(0);

    const stored = await server.getData();
    expect(stored.workouts.map((w) => w.name)).toEqual(['Верх тіла']);
    // Past sessions of it stay.
    expect(stored.sessions.some((s) => s.workoutId === 'demoWorkoutLegs')).toBe(true);
  });
});
