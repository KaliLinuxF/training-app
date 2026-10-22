/**
 * A workout session (docs/workouts-steps-rebrand.md §3.9–§3.12) on the 'training' seed: today is Wednesday 14 October
 * 2026 and «Ноги + прес» is scheduled; the latest one (12 October) had squats 3 × 12 · 40 kg with every set done, so the
 * squat is prefilled with 40 kg × 12 and the hint offers +2,5 кг. The browser clock runs from 10:00 (support/test.ts).
 */
import type { Page } from '@playwright/test';
import { bodyWeightOn, f0, sessionKcal, type AppData } from '../packages/shared/src/index';
import type { App } from './support/app';
import { pickExercises } from './support/exercises';
import { TODAY } from './support/env';
import { sessionOf } from './support/server';
import { expect, test } from './support/test';
import {
  cardAction,
  confirm,
  elapsedTimer,
  footerConfirm,
  pageTitle,
  restBar,
  sessionCard,
  sessionIdOf,
  setCheck,
  spaced,
} from './support/workouts';

test.use({ seed: 'training' });

const SQUAT = 'Присідання зі штангою';

/** Home «Почати» on the Тренування row → the live session of «Ноги + прес». */
async function startFromHome(app: App, page: Page): Promise<string> {
  await app.goto('/');
  await app
    .region('Сьогодні')
    .getByRole('button', { name: 'Почати тренування «Ноги + прес»', exact: true })
    .click();
  await expect(page).toHaveURL(/\/workouts\/session\//);
  await expect(pageTitle(page, 'Ноги + прес')).toBeVisible();
  return sessionIdOf(page);
}

const elapsedSec = async (page: Page): Promise<number> => {
  const text = (await elapsedTimer(page).textContent()) ?? '';
  const parts = text.split(':').map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
};

test.describe('live session', () => {
  test('start from Home, prefill + one-shot hint, footer confirms, rest timer, reload, finish with a record', async ({
    app,
    page,
    server,
  }) => {
    const id = await startFromHome(app, page);
    // No phone tab bar on the session (W15); the desktop keeps its sidebar.
    if (test.info().project.name === 'iphone') await expect(app.nav).toHaveCount(0);
    else
      await expect(app.nav.getByRole('link', { name: 'Тренування', exact: true })).toHaveAttribute(
        'aria-current',
        'true',
      );

    const squat = sessionCard(page, SQUAT);
    await expect(squat).toHaveAttribute('aria-current', 'step');
    await expect(squat).toContainText(/Минулого разу: 3 × 12 · 40\sкг/);
    await expect(footerConfirm(page)).toHaveAccessibleName(spaced('✓ Підхід 1 · 12 × 40 кг'));

    // The hint is one-shot: after the tap it reads «+2,5 кг додано · Скасувати».
    await squat.getByRole('button', { name: 'Спробувати +2,5 кг', exact: true }).click();
    await expect(squat.getByText(/\+2,5 кг додано/)).toBeVisible();
    await expect(squat.getByRole('button', { name: 'Спробувати +2,5 кг' })).toHaveCount(0);
    await expect(footerConfirm(page)).toHaveAccessibleName(spaced('✓ Підхід 1 · 12 × 42,5 кг'));

    // Set 1 by the footer: the rest bar counts down; «Пропустити» hides it.
    await footerConfirm(page).click();
    await expect(setCheck(squat, 1)).toHaveAttribute('aria-pressed', 'true');
    await expect(restBar(page).getByRole('timer')).toHaveText(/^Відпочинок 1:(30|29)$/);
    await restBar(page).getByRole('button', { name: 'Пропустити', exact: true }).click();
    await expect(restBar(page)).toHaveCount(0);

    // Set 2: after the rest ends the bar stays, mint, counting up.
    await footerConfirm(page).click();
    await expect(setCheck(squat, 2)).toHaveAttribute('aria-pressed', 'true');
    await expect(restBar(page)).toBeVisible();
    await page.clock.fastForward(95_000);
    await expect(restBar(page).getByRole('timer')).toHaveText(/^Відпочинок завершено · \+0:0\d$/);
    await expect(page.getByText('Час! Наступний підхід', { exact: true })).toBeAttached();
    await page.clock.fastForward(20_000);
    await expect(restBar(page).getByRole('timer')).toHaveText(/^Відпочинок завершено · \+0:[12]\d$/);
    await restBar(page).getByRole('button', { name: 'Сховати', exact: true }).click();
    await expect(restBar(page)).toHaveCount(0);

    // Reload mid-session: the sets are kept and the elapsed time goes on from the start.
    const before = await elapsedSec(page);
    expect(before).toBeGreaterThanOrEqual(115);
    await page.reload();
    await expect(pageTitle(page, 'Ноги + прес')).toBeVisible();
    await expect(setCheck(sessionCard(page, SQUAT), 1)).toHaveAttribute('aria-pressed', 'true');
    await expect(setCheck(sessionCard(page, SQUAT), 2)).toHaveAttribute('aria-pressed', 'true');
    await expect(setCheck(sessionCard(page, SQUAT), 3)).toHaveAttribute('aria-pressed', 'false');
    await expect.poll(() => elapsedSec(page)).toBeGreaterThanOrEqual(before);
    await expect(footerConfirm(page)).toHaveAccessibleName(spaced('✓ Підхід 3 · 12 × 42,5 кг'));
    await footerConfirm(page).click();
    await expect(sessionCard(page, SQUAT)).toContainText('✓ 3/3');

    // Finish: the other exercises are not done — it asks first.
    await page.getByRole('button', { name: 'Завершити', exact: true }).click();
    await confirm(page, 'Завершити тренування?', 'Завершити');
    await expect(page.getByRole('status').filter({ hasText: '✓ Тренування збережено' })).toBeVisible();
    const records = page.getByRole('region', { name: 'Нові рекорди' });
    await expect(records).toContainText(SQUAT);
    await expect(records).toContainText(/42,5\sкг \(було 40\)/);

    const stored = await server.getData();
    const done = sessionOf(stored, id);
    expect(done).toMatchObject({ status: 'done', deviceId: null });
    expect(done?.exercises[0]?.sets.map((s) => [s.kg, s.done])).toEqual([
      [42.5, true],
      [42.5, true],
      [42.5, true],
    ]);
    const kcal = sessionKcal(done!, bodyWeightOn(stored.weights, TODAY));
    expect(kcal).toBeGreaterThan(0);
    const strip = page.getByRole('definition').filter({ hasText: /^≈/ });
    await expect(strip).toHaveText(new RegExp(`^≈\\s${f0(kcal).replace(/\s/g, '\\s')}\\s?ккал$`));
    expect(stored.days[TODAY]).toMatchObject({ trained: true });
    expect(stored.days[TODAY]?.types).toContain('Низ тіла');

    // The calendar: today trained with the derived type and the static «Було» mark.
    await app.goto('/calendar');
    const day = app.region('14 жовтня 2026');
    await expect(day).toContainText('Низ тіла');
    await expect(day.getByText('Тренування записано')).toBeAttached();
    await expect(day).toContainText(/Ноги \+ прес · \d+\sхв · \d+\sккал/);
    await expect(day.getByRole('button', { name: 'Не було', exact: true })).toHaveCount(0);

    // Home: «спалено» in the Тренування row.
    await app.goto('/');
    await expect(app.homeRow('Тренування')).toHaveAccessibleName(/Спалено \d+ ккал/);
  });

  test('a set confirmed offline is kept on the phone and reaches the server once online', async ({
    app,
    page,
    context,
    server,
  }) => {
    const id = await startFromHome(app, page);
    await expect.poll(async () => sessionOf(await server.getData(), id)?.status).toBe('active');

    await context.setOffline(true);
    await footerConfirm(page).click();
    await expect(setCheck(sessionCard(page, SQUAT), 1)).toHaveAttribute('aria-pressed', 'true');
    await expect.poll(async () => ((await app.deviceCache()).outbox as unknown[]).length).toBeGreaterThan(0);
    expect(sessionOf(await server.getData(), id)?.exercises[0]?.sets[0]?.done).toBe(false);

    await context.setOffline(false);
    await expect
      .poll(async () => sessionOf(await server.getData(), id)?.exercises[0]?.sets[0]?.done, {
        timeout: 20_000,
      })
      .toBe(true);
    await expect.poll(async () => (await app.deviceCache()).outbox, { timeout: 20_000 }).toEqual([]);
  });

  test('skip an exercise and add another one from the picker', async ({ app, page, server }) => {
    const id = await startFromHome(app, page);
    const rdl = sessionCard(page, 'Румунська тяга');
    await cardAction(page, rdl, 'Румунська тяга', 'Пропустити вправу');
    await expect(rdl).toContainText('Пропущено');
    await expect(rdl.getByRole('button', { name: 'Повернути', exact: true })).toBeVisible();

    await page.getByRole('button', { name: '+ Додати вправу', exact: true }).click();
    await pickExercises(page, ['Випади']);
    await expect(sessionCard(page, 'Випади')).toBeVisible();

    await expect
      .poll(async () => {
        const s = sessionOf(await server.getData(), id);
        return s?.exercises.map((e) => [e.exerciseId, e.skipped]);
      })
      .toEqual([
        ['lib.back-squat', false],
        ['lib.romanian-deadlift', true],
        ['lib.crunch', false],
        ['lib.plank', false],
        ['lib.lunge', false],
      ]);
  });
});

test.describe('past day', () => {
  test('log a past day from the calendar sheet, edit it, delete it (the ✓ stays)', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/calendar');
    await page
      .getByRole('group', { name: /^\S+ 2026$/ })
      .getByRole('button', { name: /^13 жовтня/ })
      .click();
    const day = app.region('13 жовтня 2026');
    await day.getByRole('button', { name: /^Тренування/ }).click();
    const sheet = app.sheet('Тренування');
    await sheet
      .getByRole('region', { name: 'Записати тренування' })
      .getByRole('button', { name: /^Записати «Ноги \+ прес»/ })
      .click();

    await expect(page).toHaveURL(/\/workouts\/log\?date=2026-10-13&workout=demoWorkoutLegs$/);
    // The sheet slides away (its exit animation) before the page's own «Зберегти» is the only one.
    await app.expectSheetClosed();
    await expect(pageTitle(page, 'Ноги + прес')).toBeVisible();
    await expect(page.getByText('Запис за вівторок, 13 жовтня', { exact: true })).toBeVisible();
    // Every prefilled set is done; nothing is stored until «Зберегти».
    await expect(setCheck(sessionCard(page, SQUAT), 1)).toHaveAttribute('aria-pressed', 'true');
    const duration = page.getByRole('textbox', { name: 'Тривалість, хв' });
    await duration.fill('50');
    expect((await server.getData()).sessions.filter((s) => s.date === '2026-10-13')).toEqual([]);

    await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
    await expect(page).toHaveURL(/\/workouts\/session\//);
    await expect(page.getByRole('status').filter({ hasText: '✓ Тренування збережено' })).toBeVisible();
    const id = sessionIdOf(page);
    let stored = await server.getData();
    expect(sessionOf(stored, id)).toMatchObject({
      date: '2026-10-13',
      status: 'done',
      durationSec: 3000,
      startedAt: null,
    });
    expect(stored.days['2026-10-13']).toMatchObject({ trained: true });

    // Edit: one squat set fewer, a longer duration.
    await page.getByRole('button', { name: 'Змінити', exact: true }).click();
    await setCheck(sessionCard(page, SQUAT), 3).click();
    await page.getByRole('button', { name: 'Тривалість, хв: більше', exact: true }).click();
    await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
    await expect(app.toast('Збережено')).toBeVisible();
    await expect.poll(async () => sessionOf(await server.getData(), id)?.durationSec).toBe(55 * 60);
    stored = await server.getData();
    expect(sessionOf(stored, id)?.exercises[0]?.sets.map((s) => s.done)).toEqual([true, true, false]);

    // Delete: the dialog says the ✓ of the day stays.
    await page.getByRole('button', { name: 'Змінити', exact: true }).click();
    await page.getByRole('button', { name: 'Видалити тренування', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: 'Видалити тренування за 13 жовтня?' });
    await expect(dialog).toContainText('Відмітка «Було» за цей день залишиться.');
    await dialog.getByRole('button', { name: 'Видалити', exact: true }).click();
    await expect(page).not.toHaveURL(/\/workouts\/session\//);
    await expect.poll(async () => sessionOf(await server.getData(), id)).toBeUndefined();
    const after: AppData = await server.getData();
    expect(after.days['2026-10-13']).toMatchObject({ trained: true });
    expect(after.deletedSessions).toContain(id);
  });
});
