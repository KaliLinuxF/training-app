/**
 * Home «Головна» (redesign A «Чек-лист дня»): one phone screen — header, at most one compact banner, the compact
 * hero, the «Сьогодні» list (Їжа · Тренування with the inline ✓ / ✕ · Вага · Заміри) and the week row.
 * Demo seed: Wednesday 14 October 2026, 10:00 Kyiv; today has food text only (a legacy day: no kcal, no workout
 * mark). 'meals' seed: today is two meals (460 ккал, Б 12 · Ж 9 · В 63, the apple without macros) with macro goals
 * Б 90 · Ж 60 (docs/meals-macros.md §7.7).
 */
import type { Locator, Page } from '@playwright/test';
import type { AppData } from '../packages/shared/src/index';
import { demo, e2eSession, meals, MEALS_GOALS, MEALS_TODAY, training } from './fixtures/data';
import type { App, HomeRow } from './support/app';
import { FIXED_NOW, TODAY } from './support/env';
import type { ServerApi } from './support/server';
import { expect, test } from './support/test';

const ROWS: readonly HomeRow[] = ['Їжа', 'Тренування', 'Вага', 'Заміри'];
const SETUP_SUB = 'Запиши стартову вагу й ціль';
const INSTALL_TITLE = 'Встанови Home Fit на iPhone';

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

async function boxOf(locator: Locator, what: string): Promise<Box> {
  const box = await locator.boundingBox();
  if (!box) throw new Error(`${what} is not visible`);
  return box;
}

/** Imports `base()` changed by `change` (replaces everything on the server). */
async function seedWith(
  server: ServerApi,
  base: () => AppData,
  change: (data: AppData) => void,
): Promise<void> {
  const data = base();
  change(data);
  await server.importData(data);
}

/** Imports the demo data changed by `change`. */
const seedDemo = (server: ServerApi, change: (data: AppData) => void): Promise<void> =>
  seedWith(server, demo, change);

/** No-break space (U+00A0): the macro line glues each part, «г» and «прийоми» to their number with it. */
const NB = String.fromCharCode(0xa0);

/** The «Їжа» row's macro line «Б 12/90 · Ж 9/60 · В 63 г» (the element that holds the whole line). */
const foodMacros = (app: App): Locator => app.homeRow('Їжа').getByText(/^Б\s\S/);

/**
 * On how many lines each phrase of `locator`'s text is laid out (0 = not found). The phrase may span several text
 * nodes (the macro line keeps over-goal numbers in their own spans).
 */
async function phraseLines(locator: Locator, phrases: readonly string[]): Promise<Record<string, number>> {
  return locator.evaluate((el, list) => {
    const nodes: Text[] = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node instanceof Text) nodes.push(node);
    }
    const full = nodes.map((n) => n.data).join('');
    /** The text node and offset of a character offset into `full` (a range end may sit at a node's end). */
    const pointAt = (offset: number, isEnd: boolean): [Text, number] | null => {
      let rest = offset;
      for (const node of nodes) {
        if (isEnd ? rest <= node.data.length : rest < node.data.length) return [node, rest];
        rest -= node.data.length;
      }
      return null;
    };
    const out: Record<string, number> = {};
    for (const phrase of list) {
      const at = full.indexOf(phrase);
      const start = at < 0 ? null : pointAt(at, false);
      const end = at < 0 ? null : pointAt(at + phrase.length, true);
      if (!start || !end) {
        out[phrase] = 0;
        continue;
      }
      const range = document.createRange();
      range.setStart(start[0], start[1]);
      range.setEnd(end[0], end[1]);
      const tops: number[] = [];
      for (const rect of range.getClientRects()) {
        if (rect.width >= 1 && !tops.some((top) => Math.abs(top - rect.top) < 4)) tops.push(rect.top);
      }
      out[phrase] = tops.length;
    }
    return out;
  }, phrases);
}

/** `meals()` with the macro goals cleared: the line gets the meal count «· 2 прийоми». */
function mealsWithoutGoals(): AppData {
  const data = meals();
  data.settings.macroGoals = { protein: null, fat: null, carbs: null };
  return data;
}

/** Today's demo day record (food text only), for tests that change it. */
function todayEntry(data: AppData) {
  const entry = data.days[TODAY];
  if (!entry) throw new Error('the demo seed has no record for today');
  return entry;
}

/** Measure with Manrope, not the fallback font. */
async function fontsReady(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await document.fonts.ready;
  });
}

/** The visible title of a «Сьогодні» row (inside the row button). */
const rowTitle = (app: App, name: HomeRow): Locator => app.homeRow(name).getByText(name, { exact: true });

/**
 * The rounded top (CSS px) of the line box each word sits on, inside the first text node of `el` that holds all
 * of them — tells which words share a line after wrapping. A missing word maps to `null`.
 */
async function wordTops(locator: Locator, words: readonly string[]): Promise<Record<string, number | null>> {
  return locator.evaluate((el, list) => {
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const text = node.textContent ?? '';
      if (!list.every((w) => text.includes(w))) continue;
      const tops: Record<string, number | null> = {};
      for (const w of list) {
        const range = document.createRange();
        const at = text.indexOf(w);
        range.setStart(node, at);
        range.setEnd(node, at + w.length);
        tops[w] = Math.round(range.getBoundingClientRect().top);
      }
      return tops;
    }
    return Object.fromEntries(list.map((w) => [w, null]));
  }, words);
}

/** Text wrapped onto a second line, or cut off sideways. */
const titleBroken = (el: Element): boolean => {
  const style = getComputedStyle(el);
  const lineHeight = parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.3;
  return el.getBoundingClientRect().height > lineHeight * 1.5 || el.scrollWidth > el.clientWidth;
};

test.describe('home checklist', () => {
  test('shows the hero, the four «Сьогодні» rows and the week — no reminder banners', async ({
    app,
    page,
  }) => {
    await app.goto('/');
    await expect(page.getByText('Середа, 14 жовтня', { exact: true })).toBeVisible();
    await expect(app.heading('Головна')).toHaveText('Доброго ранку');

    const hero = app.region('Поточна вага');
    await expect(hero).toContainText('65,4');
    await expect(hero).toContainText('−2,9 кг');
    await expect(hero).toContainText('35% шляху');
    await expect(hero).toContainText('до цілі 5,4 кг');
    await expect(hero).not.toContainText('Старт');

    // Today's demo record has food text only: «Записано», no goal span and no meter.
    await expect(app.homeRow('Їжа')).toContainText('Записано');
    await expect(app.homeRow('Їжа')).toContainText('Калорії не вказані');
    await expect(app.homeRow('Їжа')).not.toContainText('/ 1 700');
    await expect(app.homeRow('Їжа')).toHaveAccessibleName(
      'Їжа: записано, калорії не вказані. Ціль 1 700 ккал на день',
    );

    // Wednesday is a planned workout day and today is not marked yet.
    await expect(app.homeRow('Тренування')).toContainText('За планом о 18:00');
    await expect(app.trainingToggle('Було')).toHaveAttribute('aria-pressed', 'false');
    await expect(app.trainingToggle('Не було')).toHaveAttribute('aria-pressed', 'false');

    await expect(app.homeRow('Вага')).toContainText('12 жовтня — 65,4 кг');
    await expect(app.homeRow('Вага')).toContainText('Пн, 19 жовтня');
    await expect(app.homeRow('Вага')).not.toContainText('08:00');
    await expect(app.homeRow('Вага')).toHaveAccessibleName(
      'Вага: останнє зважування 12 жовтня — 65,4 кг. Наступне: Пн, 19 жовтня · 08:00',
    );
    await expect(app.homeRow('Заміри')).toContainText('Груди 90 · Талія 70 · Стегна 98');
    await expect(app.homeRow('Заміри')).toContainText('Пн, 19 жовтня');

    await expect(app.weekLink()).toContainText('2 з 3 трен. · сер. 1 795 ккал');
    await expect(app.weekLink()).toHaveAttribute('href', '/progress?period=week');

    // Reminders are row states now: no banners, no «Записати» / «Відмітити».
    await expect(page.getByText('Тренування за планом', { exact: true })).toHaveCount(0);
    await expect(page.getByText('Сьогодні о 08:00')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Записати', exact: true })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Відмітити', exact: true })).toHaveCount(0);
    await expect(page.getByText('Почнімо', { exact: true })).toHaveCount(0);
  });

  test('each row opens its short sheet; «Відкрити день» the full day', async ({ app }) => {
    await app.goto('/');
    for (const [row, sheet] of [
      ['Їжа', 'Їжа'],
      ['Тренування', 'Тренування'],
      ['Вага', 'Контрольне зважування'],
      ['Заміри', 'Заміри тіла'],
    ] as const) {
      await app.homeRow(row).click();
      const dialog = app.sheet(sheet);
      await expect(dialog, `«${row}» row`).toBeVisible();
      await dialog.getByRole('button', { name: 'Закрити' }).click();
      await app.expectSheetClosed();
    }

    await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
    await expect(app.sheet('Запис дня')).toContainText('середа · сьогодні');
  });

  test('with nothing logged today the «Їжа» row opens a new meal: «Сніданок» at 10:00, «Що я їла» focused', async ({
    app,
    server,
  }) => {
    await seedDemo(server, (data) => {
      delete data.days[TODAY];
    });
    await app.goto('/');
    await expect(app.homeRow('Їжа')).toHaveAccessibleName(
      'Їжа: ще нічого не записано. Ціль 1 700 ккал на день',
    );
    await expect(app.homeRow('Їжа')).toContainText('— / 1 700 ккал');

    await app.homeRow('Їжа').click();
    const editor = app.sheet('Прийом їжі');
    await expect(editor).toBeVisible();
    await expect(app.sheet('Їжа')).toHaveCount(0);
    await expect(app.mealType(editor, 'Сніданок')).toHaveAttribute('aria-pressed', 'true');
    await expect(editor.getByRole('textbox', { name: 'Що я їла' })).toBeFocused();
  });

  test('the inline ✓ / ✕ save at once with a toast; a repeat press does nothing; it survives a reload', async ({
    app,
    page,
    server,
  }) => {
    await app.goto('/');
    const workout = app.homeRow('Тренування');

    await app.trainingToggle('Не було').click();
    await expect(app.toast('Відмічено: без тренування')).toBeVisible();
    await expect(app.dialogs).toHaveCount(0);
    await expect(app.trainingToggle('Не було')).toHaveAttribute('aria-pressed', 'true');
    await expect(workout).toContainText('Не було');
    await expect(workout).not.toContainText('За планом');

    // Pressing the pressed option again: no save, no new toast.
    await expect(app.toast('Відмічено: без тренування')).toBeHidden();
    await app.trainingToggle('Не було').click();
    await page.waitForTimeout(400);
    await expect(app.toast('Відмічено: без тренування')).toHaveCount(0);
    await expect(app.dialogs).toHaveCount(0);

    await app.trainingToggle('Було').click();
    await expect(app.toast('Відмічено: тренування було')).toBeVisible();
    await expect(app.dialogs).toHaveCount(0);
    await expect(app.trainingToggle('Було')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.trainingToggle('Не було')).toHaveAttribute('aria-pressed', 'false');
    await expect(workout).toContainText('Було · додай тип');

    // Food and the rest of the day are kept; the mark reached the server.
    await expect
      .poll(async () => (await server.getData()).days[TODAY])
      .toMatchObject({ food: 'Вівсянка з бананом, кава', trained: true, types: [] });

    await app.reload();
    await expect(app.trainingToggle('Було')).toHaveAttribute('aria-pressed', 'true');
    await expect(app.homeRow('Тренування')).toContainText('Було · додай тип');
  });

  test('a weigh-in day shows a «Сьогодні» pill until the weight is recorded', async ({ app, server }) => {
    // Make today (Wednesday) the weigh-in day.
    await seedDemo(server, (data) => {
      data.settings.rem.weigh = { on: true, day: 3, time: '09:00' };
    });
    await app.goto('/');
    const weight = app.homeRow('Вага');
    await expect(weight.getByText('Сьогодні', { exact: true })).toBeVisible();
    await expect(weight).toHaveAccessibleName(
      'Вага: зважування сьогодні о 09:00. Останнє зважування 12 жовтня — 65,4 кг',
    );

    await weight.click();
    const sheet = app.sheet('Контрольне зважування');
    await sheet.getByRole('textbox', { name: 'Вага', exact: true }).fill('65,0');
    await app.save(sheet);

    await expect(weight).toContainText('✓ Сьогодні — 65,0 кг');
    await expect(weight).toContainText('Ср, 21 жовтня');
    await expect(weight.getByText('Сьогодні', { exact: true })).toHaveCount(0);
    await expect(app.region('Поточна вага')).toContainText('65,0');
  });

  test('a missed weigh-in is marked «Пропущено ·» until the next one', async ({ app, server }) => {
    // Tuesday 13 October was the weigh-in day; the last weigh-in is Monday 12th.
    await seedDemo(server, (data) => {
      data.settings.rem.weigh = { on: true, day: 2, time: '08:00' };
    });
    await app.goto('/');
    await expect(app.homeRow('Вага')).toContainText('Пропущено · 12 жовтня — 65,4 кг');
    await expect(app.homeRow('Вага')).toContainText('Вт, 20 жовтня');
    await expect(app.homeRow('Вага')).toHaveAccessibleName(/^Вага: пропущено зважування 13 жовтня\./);
  });

  test('over the daily kcal goal the row shows the number and says so', async ({ app, server }) => {
    await seedDemo(server, (data) => {
      todayEntry(data).kcal = 1820;
    });
    await app.goto('/');
    await expect(app.homeRow('Їжа')).toContainText('1 820 / 1 700 ккал');
    await expect(app.homeRow('Їжа')).toHaveAccessibleName(/^Їжа: Перевищено ціль на 120 ккал/);
    await expect(app.homeRow('Їжа')).not.toContainText('Калорії не вказані');
  });

  test('the week row opens «Мій прогрес» on «Тиждень»', async ({ app, page }) => {
    // Another period first, so the link has to switch it back.
    await app.goto('/');
    await app.go('Прогрес');
    const periods = page.getByRole('radiogroup', { name: 'Період' });
    await periods.getByRole('radio', { name: 'Місяць' }).click();
    await expect(periods.getByRole('radio', { name: 'Місяць' })).toHaveAttribute('aria-checked', 'true');

    await app.go('Головна');
    await app.weekLink().click();
    await expect(app.heading('Прогрес')).toBeVisible();
    await expect(periods.getByRole('radio', { name: 'Тиждень' })).toHaveAttribute('aria-checked', 'true');
  });

  test('rolls over to the next day at midnight while the app stays open', async ({ app, page }) => {
    await app.goto('/');
    await expect(page.getByText('Середа, 14 жовтня', { exact: true })).toBeVisible();
    await page.clock.setSystemTime(new Date('2026-10-14T23:59:30+03:00'));
    // `useToday` re-checks the date every minute.
    await page.clock.fastForward(61_000);
    await expect(page.getByText('Четвер, 15 жовтня', { exact: true })).toBeVisible();
    await expect(app.homeRow('Їжа')).toContainText('—');
    await expect(app.homeRow('Їжа')).toContainText('/ 1 700 ккал');
    await expect(app.homeRow('Тренування')).toContainText('Ще не відмічено');

    // «+» → «Що записати?» works on Thursday now.
    const day = await app.record('Повний запис дня');
    await expect(day).toContainText('четвер · сьогодні');
  });
});

test.describe('home «Їжа» row on a day logged as meals', () => {
  test.use({ seed: 'meals' });

  const NAME_WITH_GOALS =
    'Їжа: 460 з 1 700 ккал, залишилось 1 240. Білки 12 з 90 г, жири 9 з 60 г, вуглеводи 63 г ' +
    '(не для всіх прийомів). 2 прийоми їжі';

  test('shows the day kcal and «Б · Ж · В» against her goals; the row opens the day’s list', async ({
    app,
  }) => {
    expect(MEALS_GOALS).toEqual({ protein: 90, fat: 60, carbs: null });
    await app.goto('/');
    const row = app.homeRow('Їжа');
    await expect(row).toContainText('460 / 1 700 ккал');
    await expect(foodMacros(app)).toHaveText('Б 12/90 · Ж 9/60 · В 63 г');
    // With a goal the count makes room for «/90»; the name still says it (and that the apple has no macros).
    await expect(row).not.toContainText('прийоми');
    await expect(row).not.toContainText('Калорії не вказані');
    await expect(row).toHaveAccessibleName(NAME_WITH_GOALS);

    const list = await app.openFoodDay();
    await expect(list).toBeVisible();
  });

  test('without macro goals the meal count joins the line', async ({ app, server }) => {
    await server.importData(mealsWithoutGoals());
    await app.goto('/');
    await expect(foodMacros(app)).toHaveText('Б 12 · Ж 9 · В 63 г · 2 прийоми');
    await expect(app.homeRow('Їжа')).toHaveAccessibleName(
      'Їжа: 460 з 1 700 ккал, залишилось 1 240. Білки 12 г, жири 9 г, вуглеводи 63 г (не для всіх прийомів). ' +
        '2 прийоми їжі',
    );
  });

  test('✓ «Було» marks the workout and keeps every meal of today', async ({ app, server }) => {
    await app.goto('/');
    await app.trainingToggle('Було').click();
    await expect(app.toast('Відмічено: тренування було')).toBeVisible();
    await expect.poll(async () => (await server.getData()).days[TODAY]?.trained).toBe(true);
    const stored = (await server.getData()).days[TODAY];
    expect(stored?.meals).toEqual(MEALS_TODAY);
    expect(stored?.kcal).toBe(460);
    await expect(foodMacros(app)).toHaveText('Б 12/90 · Ж 9/60 · В 63 г');
    await expect(app.homeRow('Тренування')).toContainText('Було · додай тип');
  });

  for (const [width, height] of [
    [375, 667],
    [320, 640],
  ] as const) {
    test(`at ${width}×${height} the macro line wraps only after «·» and no row title wraps`, async ({
      app,
      page,
      server,
    }, info) => {
      test.skip(info.project.name !== 'iphone', 'phone layout only');
      await page.setViewportSize({ width, height });
      for (const [what, data, phrases] of [
        [
          'no goals',
          mealsWithoutGoals(),
          [`Б${NB}12${NB}·`, `Ж${NB}9${NB}·`, `В${NB}63${NB}г${NB}·`, `2${NB}прийоми`],
        ],
        ['goals', meals(), [`Б${NB}12/90${NB}·`, `Ж${NB}9/60${NB}·`, `В${NB}63${NB}г`]],
      ] as const) {
        await server.importData(data);
        await app.goto('/');
        await fontsReady(page);
        const line = foodMacros(app);
        await expect(line).toBeVisible();
        // A part never splits: no line starts with «г», «прийоми», a number or «·».
        const lines = await phraseLines(line, phrases);
        for (const phrase of phrases) {
          expect(lines[phrase], `«${phrase}» on one line (${what} @${width})`).toBe(1);
        }
        // The kit clamps the sub to 2 lines: nothing is cut off.
        expect(
          await line.evaluate((el) => el.scrollHeight - el.clientHeight),
          `macro line cut off (${what} @${width})`,
        ).toBeLessThanOrEqual(1);
        for (const name of ROWS) {
          expect(await rowTitle(app, name).evaluate(titleBroken), `«${name}» title (${what} @${width})`).toBe(
            false,
          );
        }
      }
    });
  }
});

test.describe('home fits one iPhone screen', () => {
  /** The floating tab bar's top edge (phone shell). */
  const tabBarTop = async (app: App): Promise<number> => (await boxOf(app.nav, 'tab bar')).y;

  async function expectWeekAboveTabBar(app: App, what: string): Promise<void> {
    await fontsReady(app.page);
    const week = await boxOf(app.weekLink(), 'week row');
    expect(week.y + week.height, `week row bottom ≤ tab bar top (${what})`).toBeLessThanOrEqual(
      await tabBarTop(app),
    );
  }

  /** iPhone 14 installed app: 797px web view − 34px safe area. */
  const INSTALLED = { width: 390, height: 763 };

  test('demo data at 390×763 with the install hint hidden', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout only');
    await page.setViewportSize(INSTALLED);
    await app.goto('/');
    await page.getByRole('button', { name: 'Сховати' }).click();
    await expect(page.getByText(INSTALL_TITLE)).toHaveCount(0);
    await expectWeekAboveTabBar(app, 'demo @390×763');
  });

  test('worst case at 390×763: today’s meals with the macro line, decimal measurements, two workout types', async ({
    app,
    page,
    server,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout only');
    // One combination of every row at its tallest: Їжа with value + macro sub + meter, the 2-line «Заміри» sub, a
    // workout with two types (docs/meals-macros.md §7.7 one-screen budget).
    await seedWith(server, meals, (data) => {
      data.measures.push({ date: TODAY, chest: 92.5, waist: 74.5, hips: 100.5 });
      Object.assign(todayEntry(data), { trained: true, types: ['Верх тіла', 'Низ тіла'] });
    });
    await page.setViewportSize(INSTALLED);
    await app.goto('/');
    await page.getByRole('button', { name: 'Сховати' }).click();
    await expect(page.getByText(INSTALL_TITLE)).toHaveCount(0);
    await expect(app.homeRow('Їжа')).toContainText('460 / 1 700 ккал');
    await expect(foodMacros(app)).toHaveText('Б 12/90 · Ж 9/60 · В 63 г');
    await expect(app.homeRow('Заміри')).toContainText('✓ Сьогодні — Груди 92,5 · Талія 74,5 · Стегна 100,5');
    await expect(app.homeRow('Тренування')).toContainText('Верх тіла, Низ тіла');
    await expectWeekAboveTabBar(app, 'worst case @390×763');
  });

  test('training seed at 390×763: «Сьогодні: Ноги + прес» with «Почати» beside it', async ({
    app,
    page,
    server,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout only');
    await server.importData(training());
    await page.setViewportSize(INSTALLED);
    await app.goto('/');
    await page.getByRole('button', { name: 'Сховати' }).click();
    await expect(page.getByText(INSTALL_TITLE)).toHaveCount(0);
    await expect(app.homeRow('Тренування')).toContainText('Сьогодні: Ноги + прес');
    await expect(
      app.region('Сьогодні').getByRole('button', { name: 'Почати тренування «Ноги + прес»' }),
    ).toBeVisible();
    await expectWeekAboveTabBar(app, 'training @390×763');
  });

  test('worst case with workouts at 390×763: a done session with a 40-character name, steps and kcal', async ({
    app,
    page,
    server,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout only');
    const name = 'Ноги, сідниці, прес і трохи кардіо разом';
    expect(name).toHaveLength(40);
    await seedWith(server, training, (data) => {
      data.sessions.push(
        e2eSession({
          id: 'e2eDoneToday',
          name,
          status: 'done',
          finishedAt: FIXED_NOW.getTime(),
          durationSec: 48 * 60,
          exercises: (e2eSession().exercises ?? []).map((ex) => ({
            ...ex,
            sets: ex.sets.map((s) => ({ ...s, done: true })),
          })),
        }),
      );
      data.steps.push({ date: TODAY, steps: 12345 });
      Object.assign(todayEntry(data), { trained: true, types: ['Низ тіла'] });
    });
    await page.setViewportSize(INSTALLED);
    await app.goto('/');
    await page.getByRole('button', { name: 'Сховати' }).click();
    await expect(page.getByText(INSTALL_TITLE)).toHaveCount(0);
    const row = app.homeRow('Тренування');
    await expect(row).toHaveAccessibleName(
      new RegExp(`^Тренування: ${name}\\. 12 345 кроків\\. Спалено \\d+ ккал$`),
    );
    await expect(app.region('Сьогодні').getByText('Тренування записано')).toHaveCount(1);
    await expect(app.trainingToggle('Було')).toHaveCount(0);
    // The sub clamps at two lines: the row grows by one line at most.
    const box = await boxOf(row, 'Тренування row');
    expect(box.height).toBeLessThanOrEqual(84);
    await expectWeekAboveTabBar(app, 'workouts worst case @390×763');
  });

  test('demo data at 390×844 with the install hint visible', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout only');
    await page.setViewportSize({ width: 390, height: 844 });
    await app.goto('/');
    await expect(page.getByText(INSTALL_TITLE)).toBeVisible();
    await expectWeekAboveTabBar(app, 'hint @390×844');
  });

  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [320, 640],
  ] as const) {
    test(`at ${width}×${height} the week value wraps only after « · », never leaving «ккал» alone`, async ({
      app,
      page,
    }, info) => {
      test.skip(info.project.name !== 'iphone', 'phone layout only');
      await page.setViewportSize({ width, height });
      await app.goto('/');
      await fontsReady(page);
      const week = app.weekLink();
      await expect(week).toContainText('2 з 3 трен. · сер. 1 795 ккал');
      const tops = await wordTops(week, ['з', 'трен.', 'сер.', 'ккал']);
      for (const [word, top] of Object.entries(tops)) expect(top, `«${word}» found @${width}`).not.toBeNull();
      const gap = (a: string, b: string): number => Math.abs((tops[a] ?? 0) - (tops[b] ?? 0));
      expect(gap('з', 'трен.'), `«трен.» on the line of «2 з 3» @${width}`).toBeLessThanOrEqual(2);
      expect(gap('сер.', 'ккал'), `«ккал» on the line of «сер.» @${width}`).toBeLessThanOrEqual(2);
      // Her iPhone (390): the kit's 66% value cap keeps the whole value on one line.
      if (width === 390) expect(gap('трен.', 'сер.'), 'one line @390').toBeLessThanOrEqual(2);
    });
  }

  for (const [width, height] of [
    [375, 667],
    [320, 640],
  ] as const) {
    test(`at ${width}×${height} no row title is cut or wrapped and the toggle stays beside the row`, async ({
      app,
      page,
    }, info) => {
      test.skip(info.project.name !== 'iphone', 'phone layout only');
      await page.setViewportSize({ width, height });
      await app.goto('/');
      await fontsReady(page);
      for (const name of ROWS) {
        const title = rowTitle(app, name);
        expect(
          await title.evaluate((el) => el.scrollWidth - el.clientWidth),
          `«${name}» title overflow @${width}`,
        ).toBeLessThanOrEqual(0);
        expect(await title.evaluate(titleBroken), `«${name}» title wraps @${width}`).toBe(false);
      }
      const row = await boxOf(app.homeRow('Тренування'), 'Тренування row');
      for (const name of ['Було', 'Не було'] as const) {
        const box = await boxOf(app.trainingToggle(name), name);
        expect(box.x, `«${name}» starts after the row button @${width}`).toBeGreaterThanOrEqual(
          row.x + row.width - 1,
        );
        expect(box.width, `«${name}» width @${width}`).toBeGreaterThanOrEqual(44);
        expect(box.height, `«${name}» height @${width}`).toBeGreaterThanOrEqual(44);
      }
    });
  }
});

test.describe('new account in iPhone Safari', () => {
  test.use({ seed: 'empty' });

  test('only «Почнімо» shows, and its sub is not clipped', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'iphone', 'iPhone Safari only');
    await app.goto('/');
    // The first-run setup opens by itself; close it to look at Home.
    await expect(app.dialogs).toHaveCount(1);
    await app.dialogs.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    await expect(page.getByText('Почнімо', { exact: true })).toBeVisible();
    await expect(page.getByText(INSTALL_TITLE)).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Сховати' })).toHaveCount(0);
    await fontsReady(page);
    const sub = page.getByText(SETUP_SUB, { exact: true });
    await expect(sub).toBeVisible();
    // The compact banner clamps the sub to 2 lines; next to «Налаштувати» it must fit at 390 and at 320.
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      const clip = await sub.evaluate((el) => ({
        overflow: el.scrollHeight - el.clientHeight,
        ellipsis: getComputedStyle(el).textOverflow === 'ellipsis',
      }));
      expect(clip.overflow, `banner sub cut off @${width}`).toBeLessThanOrEqual(1);
      expect(clip.ellipsis, `banner sub ellipsis @${width}`).toBe(false);
    }
    await page.setViewportSize({ width: 390, height: 844 });

    // Before the first weigh-in the hero «—» stands alone: no «кг» hanging below it.
    const hero = app.region('Поточна вага');
    await expect(hero.getByText('—', { exact: true })).toBeVisible();
    await expect(hero.getByText('кг', { exact: true })).toHaveCount(0);
    await expect(hero).not.toContainText('шляху');

    // Nothing is due before the setup is done.
    await expect(app.homeRow('Вага')).not.toContainText('Пропущено');
    await expect(app.homeRow('Тренування')).toContainText('Ще не відмічено');

    await page.getByRole('button', { name: 'Налаштувати' }).click();
    await expect(app.dialogs).toHaveCount(1);
  });
});

test.describe('home layout on desktop', () => {
  test('at 1280 hero and week sit in column 1 and «Сьогодні» in column 2; at 960 they stack', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');

    await page.setViewportSize({ width: 1280, height: 900 });
    await app.goto('/');
    await fontsReady(page);
    let hero = await boxOf(app.region('Поточна вага'), 'hero');
    let today = await boxOf(app.region('Сьогодні'), '«Сьогодні»');
    let week = await boxOf(app.weekLink(), 'week row');
    expect(Math.abs(week.x - hero.x), 'week under the hero @1280').toBeLessThanOrEqual(2);
    expect(today.x, '«Сьогодні» right of the hero @1280').toBeGreaterThan(hero.x + hero.width);
    expect(Math.abs(today.y - hero.y), '«Сьогодні» level with the hero @1280').toBeLessThanOrEqual(1);
    expect(week.y, 'week below the hero @1280').toBeGreaterThan(hero.y + hero.height);
    // Right under it: the grid gap (14) plus the group's 1px border, no hole from the taller «Сьогодні».
    expect(week.y - (hero.y + hero.height), 'week 14px under the hero @1280').toBeLessThanOrEqual(16);
    expect(week.y, 'week beside «Сьогодні» @1280').toBeLessThan(today.y + today.height);

    await page.setViewportSize({ width: 960, height: 900 });
    await app.goto('/');
    await fontsReady(page);
    hero = await boxOf(app.region('Поточна вага'), 'hero');
    today = await boxOf(app.region('Сьогодні'), '«Сьогодні»');
    week = await boxOf(app.weekLink(), 'week row');
    expect(Math.abs(today.x - hero.x), 'one column @960').toBeLessThanOrEqual(1);
    expect(Math.abs(today.width - hero.width), 'full width @960').toBeLessThanOrEqual(1);
    expect(Math.abs(week.x - hero.x), 'week in the column @960').toBeLessThanOrEqual(2);
    expect(today.y, '«Сьогодні» under the hero @960').toBeGreaterThanOrEqual(hero.y + hero.height);
    expect(week.y, 'week under «Сьогодні» @960').toBeGreaterThanOrEqual(today.y + today.height);
  });

  test('no row title wraps next to the sidebar', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop shell only');
    for (const width of [960, 1060, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      await app.goto('/');
      await fontsReady(page);
      for (const name of ROWS) {
        expect(await rowTitle(app, name).evaluate(titleBroken), `«${name}» @${width}`).toBe(false);
      }
      expect(
        await app.weekLink().getByText('Тиждень', { exact: true }).evaluate(titleBroken),
        `«Тиждень» @${width}`,
      ).toBe(false);
    }
  });
});

test.describe('iPhone install hint', () => {
  test('«Як?» explains the install; «Сховати» hides it for good on this device', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'shown only in iPhone Safari');
    await app.goto('/');
    await expect(page.getByText(INSTALL_TITLE)).toBeVisible();
    await page.getByRole('button', { name: 'Як?' }).click();
    const sheet = app.sheet('Встановлення на iPhone');
    await expect(sheet).toContainText('fit.triple-a.dev');
    await expect(sheet.getByRole('listitem')).toHaveCount(5);
    await sheet.getByRole('button', { name: 'Зрозуміло' }).click();
    await app.expectSheetClosed();

    await page.getByRole('button', { name: 'Сховати' }).click();
    await expect(page.getByText(INSTALL_TITLE)).toBeHidden();
    await app.reload();
    await expect(page.getByText(INSTALL_TITLE)).toBeHidden();
  });

  test('is not shown on desktop', async ({ app, page }, info) => {
    test.skip(info.project.name !== 'desktop');
    await app.goto('/');
    await expect(app.homeRow('Тренування')).toContainText('За планом о 18:00');
    await expect(page.getByText(INSTALL_TITLE)).toHaveCount(0);
  });
});
