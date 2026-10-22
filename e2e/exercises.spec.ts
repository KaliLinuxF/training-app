/**
 * The exercise library (docs/workouts-steps-rebrand.md §3.2–§3.4) on the 'training' seed: today is Wednesday
 * 14 October 2026; the latest «Ноги + прес» was on 12 October with squats 3 × 12 · 40 kg, every set done (37,5 kg
 * the time before), and her own exercise «Степ-аеробіка».
 * Phone: the list, then the exercise page. Desktop: the list with the exercise in a pane next to it.
 */
import type { AppData } from '../packages/shared/src/index';
import {
  exerciseDetail,
  exerciseLink,
  exerciseList,
  fillExercise,
  groupChip,
  isDesktopLayout,
  listedExercises,
  openExercise,
  openLibrary,
  openNewExercise,
  searchExercise,
} from './support/exercises';
import { expect, test } from './support/test';

test.use({ seed: 'training' });

const ownNames = (data: AppData): string[] => data.exercises.map((e) => e.name);

test.describe('exercise library', () => {
  test('browse by group, search «прис»', async ({ page }) => {
    await openLibrary(page);
    await expect(groupChip(page, 'Усі')).toHaveAttribute('aria-pressed', 'true');
    await expect(exerciseLink(page, 'Присідання зі штангою')).toBeVisible();

    await groupChip(page, 'Груди').click();
    await expect(groupChip(page, 'Груди')).toHaveAttribute('aria-pressed', 'true');
    await expect(exerciseLink(page, 'Жим лежачи')).toBeVisible();
    await expect(exerciseLink(page, 'Присідання зі штангою')).toHaveCount(0);

    await groupChip(page, 'Кардіо').click();
    await expect(exerciseLink(page, 'Біг')).toBeVisible();
    await expect(exerciseLink(page, 'Степ-аеробіка')).toBeVisible();
    await expect(exerciseLink(page, 'Жим лежачи')).toHaveCount(0);

    await groupChip(page, 'Мої').click();
    await expect(exerciseList(page).getByRole('link')).toHaveCount(1);
    await expect(exerciseLink(page, 'Степ-аеробіка')).toContainText('моя');

    await groupChip(page, 'Усі').click();
    await searchExercise(page, 'прис');
    await expect(exerciseLink(page, 'Гоблет-присідання')).toBeVisible();
    const names = await listedExercises(page);
    expect(names.length).toBeGreaterThanOrEqual(5);
    for (const name of names) expect(name.toLocaleLowerCase('uk')).toContain('прис');
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'uk')));

    await searchExercise(page, 'щосьнеіснуюче');
    await expect(page.getByRole('status').filter({ hasText: 'Нічого не знайшлося' })).toBeVisible();
  });

  test('the squat: chart, record «40 кг · 12 жовтня» and the +2,5 кг hint', async ({ page }) => {
    await openLibrary(page);
    await searchExercise(page, 'прис');
    const detail = await openExercise(page, 'Присідання зі штангою');
    if (isDesktopLayout(page)) await expect(page).toHaveURL(/\/workouts\/library\/lib\.back-squat$/);
    else await expect(page.getByRole('link', { name: 'Назад: Вправи' })).toBeVisible();

    await expect(detail.getByRole('img', { name: /^Основні мʼязи: квадрицепс, сідниці\./ })).toBeVisible();
    const progress = detail.getByRole('region', { name: 'Прогрес', exact: true });
    await expect(progress.getByText('Найкращий підхід, кг')).toBeVisible();
    await expect(progress.getByRole('img', { name: /^Найкращий підхід, кг: з .+ до 40\s?кг$/ })).toBeVisible();
    await expect(progress.getByText('Минулого разу всі підходи виконано — спробуй +2,5 кг')).toBeVisible();
    await expect(detail.getByRole('region', { name: 'Рекорди', exact: true })).toHaveText(/^Рекорди\s*40\s?кг · 12 жовтня$/);
    const recent = detail.getByRole('region', { name: 'Останні тренування', exact: true }).getByRole('link');
    await expect(recent.first()).toContainText('12 жовтня · Ноги + прес');
    await expect(recent.first()).toHaveAttribute('href', /^\/workouts\/session\//);
    // A library exercise has no «Змінити» / «Видалити».
    await expect(detail.getByRole('button', { name: 'Видалити', exact: true })).toHaveCount(0);

    // A deep link reaches the same detail.
    await openLibrary(page, '/workouts/library/lib.back-squat');
    await expect(
      exerciseDetail(page, 'Присідання зі штангою').getByRole('region', { name: 'Рекорди', exact: true }),
    ).toHaveText(/40\s?кг · 12 жовтня/);
  });

  test('create «Тест-вправа» with the chips, find it under «Мої», delete it', async ({ page, server }) => {
    await openLibrary(page);
    const editor = await openNewExercise(page, page);
    // Validation first: nothing chosen yet.
    await editor.getByRole('button', { name: 'Зберегти', exact: true }).click();
    await expect(editor.getByText('Дай вправі назву')).toBeVisible();
    await expect(editor.getByText('Обери хоча б один основний мʼяз')).toBeVisible();

    await fillExercise(editor, { name: 'Тест-вправа', primary: ['Литки'], secondary: ['Сідниці'] });
    await expect(editor.getByRole('button', { name: 'Литки · основний', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.getByRole('button', { name: 'Сідниці · допоміжний', exact: true })).toBeVisible();
    await editor.getByRole('button', { name: 'Зберегти', exact: true }).click();
    await expect(editor).toBeHidden();
    await expect.poll(async () => ownNames(await server.getData())).toContain('Тест-вправа');

    await groupChip(page, 'Мої').click();
    await expect(exerciseList(page).getByRole('link')).toHaveCount(2);
    await expect(exerciseLink(page, 'Тест-вправа')).toContainText('Гантелі · Литки');
    await expect(exerciseLink(page, 'Тест-вправа')).toContainText('моя');

    const detail = await openExercise(page, 'Тест-вправа');
    await expect(detail.getByText('Ще немає записів цієї вправи.', { exact: false })).toBeVisible();
    await detail.getByRole('button', { name: 'Видалити', exact: true }).click();
    const confirm = page.getByRole('alertdialog');
    await expect(confirm).toContainText('Видалити вправу «Тест-вправа»?');
    await expect(confirm).toContainText('Записані тренування залишаться.');
    await confirm.getByRole('button', { name: 'Видалити', exact: true }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Вправи', exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/workouts\/library$/);
    await expect(exerciseLink(page, 'Тест-вправа')).toHaveCount(0);
    await expect.poll(async () => ownNames(await server.getData())).toEqual(['Степ-аеробіка']);
  });
});
