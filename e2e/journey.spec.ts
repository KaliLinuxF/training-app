/**
 * The whole path of workouts and steps (docs/workouts-steps-rebrand.md §3), in one go, from an onboarded account with
 * nothing recorded: her own exercise → «Ноги + прес» built for today's weekday (Wednesday) → Home «Сьогодні: …» +
 * «Почати» → every set confirmed with the footer button (the rest bar shows) → the summary's kcal = shared
 * `sessionKcal` → Home «спалено» → steps through «+» (today and yesterday) → the calendar day (session line, «Разом
 * спалено», «Кроки» row) → Progress (bars, the top exercise) → the exercise page (its one point) → export / import keeps
 * everything → the admin sees her read-only (the «Кроки» column and «Тренування») → another user never sees any of it.
 */
import { readFile } from 'node:fs/promises';
import type { Browser, BrowserContext, Page } from '@playwright/test';
import {
  addDays,
  bodyWeightOn,
  dayBurned,
  f0,
  sessionKcal,
  type AppData,
  type WorkoutSession,
} from '../packages/shared/src/index';
import { App } from './support/app';
import { clientRow, clientTab, columnHeader, openClient, openClients, sessionGroup } from './support/coachUi';
import { BASE_URL, FIXED_NOW, TIMEZONE, TODAY } from './support/env';
import { fillExercise, openLibrary, openNewExercise, pickExercises } from './support/exercises';
import { ADMIN, createUser, loginContext, type Credentials } from './support/server';
import { expect, test } from './support/test';
import { builderNames, footerConfirm, pageTitle, restBar, sessionIdOf, spaced } from './support/workouts';

test.use({ seed: 'onboarded' });

const YESTERDAY = addDays(TODAY, -1);
const OWN = 'Міст на одній нозі';
const SQUAT = 'Присідання зі штангою';
const CRUNCH = 'Скручування';
const WORKOUT = 'Ноги + прес';

/** A number as the app prints it (`f0`: NBSP thousands) → a pattern where any space may be a no-break one. */
const num = (n: number): string => f0(n).replace(/\s/g, '\\s');

/** The parts of a backup that are hers (the order of keys does not matter). */
const training = (data: AppData) => ({
  exercises: data.exercises,
  workouts: data.workouts,
  sessions: data.sessions,
  steps: data.steps,
  deletedSessions: data.deletedSessions,
  stepsGoal: data.settings.stepsGoal,
});

/**
 * Another browser context (another device) with the project's viewport and touch, the suite's locale, zone, reduced
 * motion and blocked service worker, the browser clock fixed at FIXED_NOW, logged in as `creds`.
 */
async function deviceAs(
  browser: Browser,
  creds: Credentials,
): Promise<{ context: BrowserContext; page: Page }> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: BASE_URL,
    locale: 'uk-UA',
    timezoneId: TIMEZONE,
    reducedMotion: 'reduce',
    serviceWorkers: 'block',
    viewport: use.viewport ?? null,
    ...(use.isMobile === undefined ? {} : { isMobile: use.isMobile }),
    ...(use.hasTouch === undefined ? {} : { hasTouch: use.hasTouch }),
    ...(use.userAgent === undefined ? {} : { userAgent: use.userAgent }),
  });
  await context.clock.install({ time: FIXED_NOW });
  await loginContext(context, creds);
  return { context, page: await context.newPage() };
}

test('her own exercise → «Ноги + прес» → a whole session → steps → calendar, progress, backup, the coach; B sees nothing', async ({
  app,
  page,
  server,
  admin,
  browser,
  playwright,
}) => {
  test.setTimeout(240_000);

  // ── 1. Her own exercise (bodyweight, glutes / hamstrings) ──────────────────────────────────────────────────────
  await openLibrary(page);
  const editor = await openNewExercise(page, page);
  await fillExercise(editor, {
    name: OWN,
    kind: 'Власна вага',
    primary: ['Сідниці'],
    secondary: ['Задня поверхня стегна'],
  });
  await editor.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(editor).toBeHidden();
  await expect.poll(async () => (await server.getData()).exercises.map((e) => e.name)).toEqual([OWN]);
  const ownId = (await server.getData()).exercises[0]!.id;

  // ── 2. «Ноги + прес» on Wednesday (today), squat at 10 kg ─────────────────────────────────────────────────────
  await page.goto('/workouts/new');
  await expect(pageTitle(page, 'Нове тренування')).toBeVisible();
  await page.getByRole('textbox', { name: 'Назва' }).fill(WORKOUT);
  await page.getByRole('button', { name: '+ Додати вправи', exact: true }).click();
  await pickExercises(page, [SQUAT, CRUNCH, OWN]);
  expect(await builderNames(page)).toEqual([SQUAT, CRUNCH, OWN]);
  const squatCard = page.locator('li[data-item]').first();
  await squatCard.getByRole('button', { name: `Змінити: ${SQUAT}` }).click();
  for (let i = 0; i < 4; i++)
    await squatCard.getByRole('button', { name: 'Вага: більше', exact: true }).click();
  await expect(squatCard).toContainText(/3 × 10 · 10\sкг/);
  await squatCard.getByRole('button', { name: 'Готово', exact: true }).click();
  await page.getByRole('group', { name: 'Дні тренувань' }).getByRole('button', { name: 'Середа' }).click();
  await page.getByRole('button', { name: 'Зберегти', exact: true }).click();
  await expect(app.toast(/^Збережено/)).toBeVisible();
  await expect(pageTitle(page, 'Мої тренування')).toBeVisible();
  let stored = await server.getData();
  expect(stored.workouts).toHaveLength(1);
  expect(stored.workouts[0]).toMatchObject({ name: WORKOUT, days: [3] });
  expect(stored.workouts[0]!.items.map((i) => i.exerciseId)).toEqual(['lib.back-squat', 'lib.crunch', ownId]);
  expect(stored.settings.rem.workout.days).toContain(3);

  // ── 3. Home: «Сьогодні: Ноги + прес» and «Почати» ─────────────────────────────────────────────────────────────
  await app.goto('/');
  await expect(app.homeRow('Тренування')).toContainText(`Сьогодні: ${WORKOUT}`);
  const start = app
    .region('Сьогодні')
    .getByRole('button', { name: `Почати тренування «${WORKOUT}»`, exact: true });
  await expect(start).toBeVisible();
  await start.click();
  await expect(page).toHaveURL(/\/workouts\/session\//);
  await expect(pageTitle(page, WORKOUT)).toBeVisible();
  const id = sessionIdOf(page);

  // ── 4. Every set by the footer button; the rest bar after the first one; then finish ─────────────────────────
  const progress = page.getByText(/^\d+ з \d+ вправ · \d+ з \d+ підходів$/);
  await expect(progress).toHaveText('0 з 3 вправ · 0 з 9 підходів');
  await expect(footerConfirm(page)).toHaveAccessibleName(spaced('✓ Підхід 1 · 10 × 10 кг'));
  for (let n = 1; n <= 9; n++) {
    await footerConfirm(page).click();
    await expect(progress).toContainText(` · ${n} з 9 підходів`);
    if (n === 1) {
      await expect(restBar(page)).toBeVisible();
      await expect(restBar(page).getByRole('timer')).toHaveText(/^Відпочинок 1:(30|29)$/);
    }
    // A few minutes of real work between the sets, so the duration is plausible.
    await page.clock.fastForward(150_000);
  }
  await expect(progress).toHaveText('3 з 3 вправ · 9 з 9 підходів');
  await expect(footerConfirm(page)).toHaveCount(0);
  // All done: «Завершити тренування» finishes without asking.
  await page.getByRole('button', { name: 'Завершити тренування', exact: true }).last().click();
  await expect(page.getByRole('status').filter({ hasText: '✓ Тренування збережено' })).toBeVisible();

  stored = await server.getData();
  const done = stored.sessions.find((s) => s.id === id) as WorkoutSession;
  expect(done).toMatchObject({
    status: 'done',
    date: TODAY,
    workoutId: stored.workouts[0]!.id,
    name: WORKOUT,
  });
  expect(done.exercises.flatMap((e) => e.sets.map((s) => s.done))).toEqual(Array(9).fill(true));
  expect(done.durationSec).toBeGreaterThanOrEqual(9 * 150);
  const kcal = sessionKcal(done, bodyWeightOn(stored.weights, TODAY));
  expect(kcal).toBeGreaterThan(0);
  await expect(page.getByRole('definition').filter({ hasText: /^≈/ })).toHaveText(
    new RegExp(`^≈\\s${num(kcal)}\\s?ккал$`),
  );
  expect(stored.days[TODAY]).toMatchObject({ trained: true });
  expect(stored.days[TODAY]?.types).toEqual(expect.arrayContaining(['Низ тіла', 'Прес']));

  // ── 5. Home: «спалено»; then steps through «+», today and yesterday (‹) ──────────────────────────────────────
  await app.goto('/');
  await expect(app.homeRow('Тренування')).toContainText(new RegExp(`спалено\\s${num(kcal)}\\sккал`));
  await expect(app.homeRow('Тренування')).toHaveAccessibleName(new RegExp(`Спалено ${num(kcal)} ккал$`));
  let sheet = await app.record('Кроки');
  const steps = sheet.getByRole('textbox', { name: 'Кроки за день' });
  await steps.fill('8400');
  await expect(steps).toHaveValue('8 400');
  await app.save(sheet);
  sheet = await app.record('Кроки');
  await sheet.getByRole('button', { name: 'Попередній день', exact: true }).click();
  await expect(steps).toHaveValue('');
  for (let i = 0; i < 6; i++) await sheet.getByRole('button', { name: 'Плюс 1000 кроків' }).click();
  await expect(steps).toHaveValue('6 000');
  await app.save(sheet);
  await expect
    .poll(async () => (await server.getData()).steps)
    .toEqual([
      { date: YESTERDAY, steps: 6000 },
      { date: TODAY, steps: 8400 },
    ]);
  stored = await server.getData();
  const burned = dayBurned(stored, TODAY);
  expect(burned).not.toBeNull();
  expect(burned!.total).toBe(kcal + burned!.steps);
  await expect(app.homeRow('Тренування')).toHaveAccessibleName(
    new RegExp(
      `^Тренування: ${WORKOUT.replace('+', '\\+')}\\. 8\\s400 кроків\\. Спалено ${num(burned!.total)} ккал$`,
    ),
  );

  // ── 6. The calendar day: the session line, «Разом спалено», the «Кроки» row ─────────────────────────────────
  await app.go('Календар');
  const day = app.region('14 жовтня 2026');
  await expect(day).toContainText(/Ноги \+ прес · \d+\sхв · \d+\sккал/);
  await expect(day).toContainText(new RegExp(`Разом спалено ≈\\s${num(burned!.total)}\\sккал`));
  await expect(day.getByText('Тренування записано')).toBeAttached();
  await expect(day.getByRole('button', { name: /^Кроки/ })).toHaveAccessibleName(
    new RegExp(`^Кроки: 8\\s400, спалено близько ${num(burned!.steps)} ккал$`),
  );

  // ── 7. Progress: the workouts bars and the top exercise, the steps bars; the exercise page's one point ────────
  await app.go('Прогрес');
  const trainingCard = page.getByRole('region', { name: 'Тренування', exact: true });
  await expect(trainingCard.getByRole('img').first()).toBeVisible();
  await expect(trainingCard).toContainText('Найчастіші вправи');
  const stepsCard = page.getByRole('region', { name: 'Кроки', exact: true });
  await expect(stepsCard.getByRole('img', { name: /^Кроки/ })).toBeVisible();
  await expect(stepsCard).toContainText(/7\s200/); // the week's average of 6 000 and 8 400
  const top = trainingCard.getByRole('link', { name: new RegExp(`^${SQUAT}: 1 \\S+\\. Відкрити вправу$`) });
  await expect(top).toBeVisible();
  await top.click();
  await expect(page).toHaveURL(/\/workouts\/library\/lib\.back-squat$/);
  const exerciseProgress = page.getByRole('region', { name: 'Прогрес', exact: true });
  await expect(exerciseProgress).toContainText(/10\sкг/);
  await expect(page.getByRole('region', { name: 'Останні тренування', exact: true })).toContainText(
    `14 жовтня · ${WORKOUT}`,
  );

  // ── 8. Export → import keeps everything ───────────────────────────────────────────────────────────────────────
  await app.gotoSettings('Дані і копія');
  await expect(app.region('Дані')).toContainText('Усе синхронізовано');
  const download = page.waitForEvent('download');
  await page.getByRole('link', { name: 'Завантажити резервну копію' }).click();
  const copy = JSON.parse(await readFile(await (await download).path(), 'utf8')) as AppData;
  const before = await server.getData();
  expect(training(copy)).toEqual(training(before));
  expect(copy.sessions).toHaveLength(1);
  await page
    .locator('input[type="file"][accept="application/json,.json"]')
    .setInputFiles({
      name: 'legko-copy.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(copy)),
    });
  await page
    .getByRole('alertdialog', { name: 'Відновити з резервної копії?' })
    .getByRole('button', { name: 'Відновити', exact: true })
    .click();
  await expect(app.toast('Дані відновлено')).toBeVisible();
  const after = await server.getData();
  expect(after).toEqual(before);
  await app.goto('/');
  await expect(app.homeRow('Тренування')).toHaveAccessibleName(
    new RegExp(`Спалено ${num(burned!.total)} ккал$`),
  );

  // ── 9. The admin: her «Кроки» in the list, her session in «Тренування» — read-only ───────────────────────────
  const coach = await deviceAs(browser, ADMIN);
  try {
    const writes: string[] = [];
    coach.page.on('request', (r) => {
      const { pathname } = new URL(r.url());
      if (r.method() !== 'GET' && (pathname === '/api/ops' || pathname.startsWith('/api/coach')))
        writes.push(`${r.method()} ${pathname}`);
    });
    const cp = coach.page;
    await openClients(cp, '?q=anna');
    await expect(clientRow(cp, 'anna')).toBeVisible();
    if ((cp.viewportSize()?.width ?? 0) >= 900) {
      // The steps average is over the full days before today: yesterday's 6 000 only.
      await expect(columnHeader(cp, 'Кроки')).toBeVisible();
      await expect(clientRow(cp, 'anna')).toContainText(/6\s000/);
    }
    await openClient(cp, 'anna');
    await clientTab(cp, 'Тренування');
    const group = sessionGroup(cp, `14 жовтня · ${WORKOUT}`);
    await expect(group).toContainText(new RegExp(`≈\\s${num(kcal)}\\sккал`));
    await expect(group).toContainText(SQUAT);
    await expect(group).toContainText(/3 × 10 · 10\sкг/);
    await expect(group).toContainText(OWN);
    await expect(cp.getByRole('main')).toContainText(/Розклад: Ср — Ноги \+ прес/);
    await expect(cp.getByRole('main')).toContainText(/6\s000/);
    const main = cp.getByRole('main');
    for (const role of ['checkbox', 'switch', 'textbox', 'spinbutton'] as const)
      await expect(main.getByRole(role)).toHaveCount(0);
    await expect(group.getByRole('button')).toHaveCount(0);
    await expect(group.getByRole('link')).toHaveCount(0);
    await expect(main.locator('a[href^="/workouts"]')).toHaveCount(0);
    expect(writes).toEqual([]);
  } finally {
    await coach.context.close();
  }
  // Nothing of hers changed by looking.
  expect(await server.getData()).toEqual(before);

  // ── 10. Another user (B) never sees any of it, and cannot touch it ────────────────────────────────────────────
  const b = await createUser(playwright, admin);
  try {
    const own = await b.api.getData();
    expect(training(own)).toEqual({
      exercises: [],
      workouts: [],
      sessions: [],
      steps: [],
      deletedSessions: [],
      stepsGoal: null,
    });
    // B's ops naming A's ids and dates change only B's (empty) data.
    const res = await b.api.sendOps([
      { kind: 'session.delete', id },
      { kind: 'workout.delete', id: before.workouts[0]!.id },
      { kind: 'exercise.delete', id: ownId },
      { kind: 'steps.delete', date: TODAY },
    ]);
    expect(res.status()).toBe(200);
    expect(await server.getData()).toEqual(before);
    expect((await b.api.rawGet('/api/coach/clients')).status()).toBe(403);

    const other = await deviceAs(browser, b.creds);
    try {
      const otherApp = new App(other.page);
      await otherApp.goto('/');
      await expect(otherApp.region('Сьогодні')).not.toContainText(WORKOUT);
      await expect(otherApp.homeRow('Тренування')).not.toContainText('кроків');
      await other.page.goto('/workouts');
      await expect(pageTitle(other.page, 'Мої тренування')).toBeVisible();
      await expect(other.page.getByText(/^Склади тренування з вправ/)).toBeVisible();
      await expect(other.page.getByText(WORKOUT)).toHaveCount(0);
      await openLibrary(other.page);
      await expect(other.page.getByText(OWN)).toHaveCount(0);
      await other.page.goto(`/workouts/session/${encodeURIComponent(id)}`);
      await expect(other.page.getByRole('heading', { level: 1, name: WORKOUT })).toHaveCount(0);
    } finally {
      await other.context.close();
    }
  } finally {
    await b.dispose();
  }
});
