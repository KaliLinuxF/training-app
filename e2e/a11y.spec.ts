import type { Locator, Page } from '@playwright/test';
import { normalizeDay, type AppData } from '../packages/shared/src/index';
import { meals as mealsSeed } from './fixtures/data';
import type { App } from './support/app';
import { TODAY } from './support/env';
import { FOOD_JPEG, mockFood, PHOTO_ESTIMATE } from './support/food';
import { expect, test } from './support/test';

/** Inputs below 16px make iOS Safari zoom in on focus (SPEC §2: «Inputs ≥ 16px font (no zoom)»). */
async function inputsBelow16px(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('input, textarea, select')]
      .filter((el) => el.getBoundingClientRect().width > 1 && (el as HTMLInputElement).type !== 'file')
      .filter((el) => parseFloat(getComputedStyle(el).fontSize) < 16)
      .map(
        (el) => `${el.getAttribute('name') ?? el.getAttribute('aria-label') ?? el.outerHTML.slice(0, 60)}`,
      ),
  );
}

/**
 * The area a finger can actually hit, «W×H»: probed with `elementFromPoint` from the centre
 * outwards, so `::after` tap-area extensions count and overlapping neighbours do not.
 */
async function hitArea(locator: Locator): Promise<string> {
  await locator.scrollIntoViewIfNeeded();
  // In a sheet, «in view» may still be under its sticky header or footer: measure it in the middle of the panel
  // (and of a sideways-scrolling chip row).
  await locator.evaluate((el) => {
    if (el.closest('[role="dialog"]')) el.scrollIntoView({ block: 'center', inline: 'center' });
  });
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = (x: number, y: number) => {
      const t = document.elementFromPoint(x, y);
      return !!t && (t === el || el.contains(t));
    };
    const reach = (dx: number, dy: number) => {
      let n = 0;
      while (n < 30 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
      return n;
    };
    return `${reach(-1, 0) + reach(1, 0) + 1}×${reach(0, -1) + reach(0, 1) + 1}`;
  });
}

/** `hitArea` measured with the sheet's panel scrolled to its top: the sticky footer covers nothing above it. */
async function hitAreaAtTop(sheet: Locator, locator: Locator): Promise<string> {
  await sheet.evaluate((el) => el.scrollTo(0, 0));
  return locator.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    const hits = (x: number, y: number) => {
      const t = document.elementFromPoint(x, y);
      return !!t && (t === el || el.contains(t));
    };
    const reach = (dx: number, dy: number) => {
      let n = 0;
      while (n < 30 && hits(cx + dx * (n + 1), cy + dy * (n + 1))) n++;
      return n;
    };
    return `${reach(-1, 0) + reach(1, 0) + 1}×${reach(0, -1) + reach(0, 1) + 1}`;
  });
}

const below44 = (sizes: Record<string, string>) =>
  Object.entries(sizes).filter(([, s]) =>
    s
      .split('×')
      .map(Number)
      .some((n) => n < 44),
  );

/** The element's box once it is scrolled into view. */
async function box(
  locator: Locator,
  what: string,
): Promise<{ x: number; y: number; width: number; height: number }> {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  if (!b) throw new Error(`${what} is not rendered`);
  return b;
}

/** A control nested in another control (a button inside a row button, a link inside a button…). */
const NESTED_CONTROL =
  'button :is(button, a[href], input, textarea, select, [role="button"]), a[href] :is(button, a[href], input, textarea, select, [role="button"])';

/** Every open sheet, bottom to top: its dialog name, its z-index and whether it is `inert` (covered). */
async function sheetStack(page: Page): Promise<{ name: string; z: number; inert: boolean }[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>('[role="dialog"][aria-modal="true"]')]
      .map((dialog) => ({
        name:
          document.getElementById(dialog.getAttribute('aria-labelledby') ?? '')?.textContent?.trim() ?? '',
        z: Number(getComputedStyle(dialog.parentElement ?? dialog).zIndex),
        inert: dialog.closest('[inert]') !== null,
      }))
      .sort((a, b) => a.z - b.z),
  );
}

/** Whether a control of a covered sheet can still take focus (it must not: the sheet is inert). */
const takesFocus = (locator: Locator): Promise<boolean> =>
  locator.evaluate((el: HTMLElement) => {
    el.focus();
    return document.activeElement === el;
  });

/** Lower-cased words (letters and digits) of a label: what speech input matches, emoji and «+», «·», «→» aside. */
const words = (text: string): string[] =>
  text
    .toLocaleLowerCase('uk')
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);

/** The visible text of a control: its text without `aria-hidden` parts (emoji) and visually hidden helpers. */
const visibleLabel = (locator: Locator): Promise<string> =>
  locator.evaluate((el) => {
    const copy = el.cloneNode(true) as HTMLElement;
    copy.querySelectorAll('[aria-hidden="true"], .visually-hidden').forEach((n) => n.remove());
    return copy.textContent ?? '';
  });

/**
 * WCAG 2.5.3 Label in Name: the accessible name contains the visible label (as words, in order, case aside),
 * so «Порахувати решту» works by voice although VoiceOver also reads what is left to count.
 */
async function expectLabelInName(locator: Locator, what: string): Promise<void> {
  const label = words(await visibleLabel(locator));
  expect(label.length, `${what}: has a visible label`).toBeGreaterThan(0);
  const pattern = label.map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^\\p{L}\\p{N}]+');
  await expect(locator, what).toHaveAccessibleName(new RegExp(pattern, 'iu'));
}

/**
 * The 'meals' seed with a lunch added, so the day's protein is 68 g against the 90 g goal (12 + 56):
 * 980 ккал, Б 68 · Ж 23 · В 123 — still partial (the apple has no macros).
 */
function mealsWithLunch(): AppData {
  const data = mealsSeed();
  const today = data.days[TODAY];
  if (!today?.meals) throw new Error('the meals seed has meals today');
  data.days[TODAY] = normalizeDay({
    ...today,
    meals: [
      ...today.meals,
      {
        id: 'e2eLunch0001',
        type: 'Обід',
        time: '09:55',
        text: 'Курка з рисом',
        kcal: 520,
        protein: 56,
        fat: 14,
        carbs: 60,
      },
    ],
  });
  return data;
}

const mealText = (sheet: Locator) => sheet.getByRole('textbox', { name: 'Що я їла', exact: true });
const positions = (sheet: Locator) => sheet.getByRole('region', { name: 'Позиції', exact: true });

/** Home «Їжа» → «Їжа» → the meal `title` stacked above it. */
async function openMealFromList(app: App, title: string): Promise<{ list: Locator; editor: Locator }> {
  const list = await app.openFoodDay();
  await app.mealRow(list, title).click();
  const editor = app.sheet('Прийом їжі');
  await expect(editor).toBeVisible();
  return { list, editor };
}

test.describe('structure (both projects)', () => {
  test('rows never nest a control inside another; the calendar food row keeps the food text as its description', async ({
    app,
  }) => {
    await app.goto('/');
    const today = app.region('Сьогодні');
    await expect(today.getByRole('button')).not.toHaveCount(0);
    await expect(today.locator(NESTED_CONTROL)).toHaveCount(0);

    await app.go('Календар');
    const day = app.region('14 жовтня 2026');
    await expect(day.getByRole('button', { name: 'Було', exact: true })).toBeVisible();
    await expect(day.locator(NESTED_CONTROL)).toHaveCount(0);
    // A short name («Їжа: калорії не вказані») must not hide the food text from a screen reader.
    await expect(day.getByRole('button', { name: /^Їжа/ })).toHaveAccessibleDescription(
      'Вівсянка з бананом, кава',
    );
  });

  test.describe('meals', () => {
    test.use({ seed: 'meals' });

    test('«Їжа» → «Прийом їжі» → «Позиція»: dialog names, z-index 60 / 62 / 64, the sheets below are inert, no nested controls', async ({
      app,
      page,
    }) => {
      await mockFood(page);
      await app.goto('/');
      const { list, editor } = await openMealFromList(app, 'Сніданок');
      await expect(list.getByRole('heading', { name: 'Їжа', exact: true })).toBeVisible();
      await expect(editor.getByRole('heading', { name: 'Прийом їжі', exact: true })).toBeVisible();
      await expect
        .poll(() => sheetStack(page))
        .toEqual([
          { name: 'Їжа', z: 60, inert: true },
          { name: 'Прийом їжі', z: 62, inert: false },
        ]);
      expect(await takesFocus(app.mealRow(list, 'Перекус'))).toBe(false);
      await expect(editor.locator(NESTED_CONTROL)).toHaveCount(0);

      // The item editor stacks above the meal: both sheets under it are inert.
      await positions(editor)
        .getByRole('button', { name: /^Вівсянка з бананом, / })
        .click();
      const item = app.sheet('Позиція');
      await expect(item).toBeVisible();
      await expect(item.getByRole('heading', { name: 'Позиція', exact: true })).toBeVisible();
      await expect
        .poll(() => sheetStack(page))
        .toEqual([
          { name: 'Їжа', z: 60, inert: true },
          { name: 'Прийом їжі', z: 62, inert: true },
          { name: 'Позиція', z: 64, inert: false },
        ]);
      expect(await takesFocus(mealText(editor))).toBe(false);
      await expect(item.locator(NESTED_CONTROL)).toHaveCount(0);

      // Closing the top one makes the meal live again; the list under it stays covered.
      await page.keyboard.press('Escape');
      await expect(item).toBeHidden();
      await expect
        .poll(() => sheetStack(page))
        .toEqual([
          { name: 'Їжа', z: 60, inert: true },
          { name: 'Прийом їжі', z: 62, inert: false },
        ]);
      expect(await takesFocus(mealText(editor))).toBe(true);

      // A new position is «Нова позиція».
      await positions(editor).getByRole('button', { name: '+ позиція', exact: true }).click();
      await expect(app.sheet('Нова позиція')).toBeVisible();
      await expect(app.sheet('Нова позиція').locator(NESTED_CONTROL)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await expect(app.sheet('Нова позиція')).toBeHidden();

      await page.keyboard.press('Escape');
      await expect(editor).toBeHidden();
      await expect.poll(() => sheetStack(page)).toEqual([{ name: 'Їжа', z: 60, inert: false }]);
      // The list: rows are one button each (photos and notes outside them), and say they open a dialog.
      await expect(list.locator(NESTED_CONTROL)).toHaveCount(0);
      for (const title of ['Сніданок', 'Перекус'])
        await expect(app.mealRow(list, title)).toHaveAttribute('aria-haspopup', 'dialog');
      // A new meal from the list footer is «Прийом їжі» as well.
      await app.addMealButton(list).click();
      await expect(app.sheet('Прийом їжі')).toBeVisible();
      await expect(mealText(app.sheet('Прийом їжі'))).toBeFocused();
    });

    test('«+» → Їжа swaps the menu to «Прийом їжі» in the same dialog; «Запис дня» lists the meals without nesting', async ({
      app,
      page,
    }) => {
      await mockFood(page);
      await app.goto('/');
      const meal = await app.newMeal();
      await expect(meal.getByRole('heading', { name: 'Прийом їжі', exact: true })).toBeVisible();
      await expect.poll(() => sheetStack(page)).toEqual([{ name: 'Прийом їжі', z: 60, inert: false }]);
      await expect(meal.locator(NESTED_CONTROL)).toHaveCount(0);
      await page.keyboard.press('Escape');
      await app.expectSheetClosed();

      await app.region('Сьогодні').getByRole('button', { name: 'Відкрити день' }).click();
      const day = app.sheet('Запис дня');
      await expect(app.mealList(day).getByRole('button')).toHaveCount(2);
      await expect(day.locator(NESTED_CONTROL)).toHaveCount(0);
      await app.mealRow(day, 'Перекус').click();
      await expect
        .poll(() => sheetStack(page))
        .toEqual([
          { name: 'Запис дня', z: 60, inert: true },
          { name: 'Прийом їжі', z: 62, inert: false },
        ]);
    });
  });

  test.describe('the day’s totals', () => {
    test('the totals card shows «68 / 90 г» and VoiceOver reads «68 з 90 г»; the partial note is text', async ({
      app,
      server,
    }) => {
      // After the `page` fixture imported the default seed.
      await server.importData(mealsWithLunch());
      await app.goto('/');
      const list = await app.openFoodDay();
      const card = list.getByRole('region', { name: 'Підсумок дня', exact: true });
      await expect(card).toContainText('980 / 1 700 ккал');
      // What she sees keeps the slash…
      await expect(card.locator('[aria-hidden="true"]').filter({ hasText: /^68\s\/\s90\sг$/ })).toHaveCount(
        1,
      );
      // …what assistive tech gets has «з» instead, and no slash.
      const tree = await card.ariaSnapshot();
      expect(tree).toMatch(/Білки[\s\S]*68\sз\s90\sг/);
      expect(tree).toMatch(/Жири[\s\S]*23\sз\s60\sг/);
      expect(tree).toMatch(/Вуглеводи[\s\S]*123\sг/);
      expect(tree).not.toMatch(/68\s\/\s90/);
      expect(tree).toContain('Б · Ж · В пораховано не для всіх прийомів');
    });
  });
});

test.describe('iPhone ergonomics', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-only checks');

  test('every text input is at least 16px (no zoom on focus)', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');

    // «Прийом їжі»: the text, «+ Свій», the manual kcal and Б · Ж · В, the time.
    const meal = await app.newMeal();
    await meal.getByRole('button', { name: 'Додати свій тип прийому їжі', exact: true }).click();
    await expect(meal.getByRole('textbox', { name: 'Новий тип прийому їжі', exact: true })).toBeFocused();
    await meal.getByRole('button', { name: /^\+ Б · Ж · В/ }).click();
    await expect(meal.getByRole('textbox', { name: 'Білки', exact: true })).toBeFocused();
    await expect(meal.getByLabel('Час', { exact: true })).toBeVisible();
    expect(await inputsBelow16px(page), '«Прийом їжі» manual numbers, own type, time').toEqual([]);
    // After an estimate: the composer «Що ще порахувати?».
    await mealText(meal).fill('борщ і хліб');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await expect(positions(meal)).toBeVisible();
    await meal.getByRole('button', { name: 'Додати ще: порахувати калорії', exact: true }).click();
    await expect(meal.getByRole('textbox', { name: 'Що ще порахувати?', exact: true })).toBeFocused();
    expect(await inputsBelow16px(page), '«Прийом їжі» composer').toEqual([]);

    // «Тренування»: an own type, then the unfolded notes.
    await app.goto('/');
    const workout = await app.record('Тренування');
    await workout.getByRole('button', { name: 'Було', exact: true }).click();
    await workout.getByRole('button', { name: '+ Свій тип' }).click();
    await expect(workout.getByRole('textbox', { name: 'Новий тип тренування' })).toBeVisible();
    expect(await inputsBelow16px(page), '«Тренування» own type').toEqual([]);
    await workout.getByRole('button', { name: '+ Нотатка до дня' }).click();
    await expect(workout.getByRole('textbox', { name: 'Нотатки' })).toBeFocused();
    expect(await inputsBelow16px(page), '«Тренування» notes').toEqual([]);

    for (const [path, field] of [
      ['/settings/reminders', page.getByLabel('Час').first()],
      ['/settings/workouts', page.getByRole('textbox', { name: 'Свій тип тренування' })],
      ['/settings/meals', page.getByRole('textbox', { name: 'Новий тип прийому їжі' })],
      ['/settings/goals', page.getByRole('textbox', { name: 'Ціль: білки, г на день', exact: true })],
      [
        '/?sheet=weight',
        app.sheet('Контрольне зважування').getByRole('textbox', { name: 'Вага', exact: true }),
      ],
      ['/?sheet=measure', app.sheet('Заміри тіла').locator('input[name="chest"]')],
    ] as const) {
      await app.goto(path);
      await expect(field, path).toBeVisible();
      expect(await inputsBelow16px(page), path).toEqual([]);
    }

    // «Прийоми їжі» in edit mode: every name is a field.
    await app.gotoSettings('Прийоми їжі');
    await page.getByRole('button', { name: 'Змінити', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'Назва: Сніданок', exact: true })).toBeVisible();
    expect(await inputsBelow16px(page), '«Прийоми їжі» edit mode').toEqual([]);
  });

  test.describe('logged out', () => {
    test.use({ authed: false });
    test('the login field is at least 16px', async ({ page }) => {
      await page.goto('/');
      await expect(page.getByLabel('Пароль', { exact: true })).toBeVisible();
      expect(await inputsBelow16px(page)).toEqual([]);
    });
  });

  // Text-sized controls (the kit ghost button is 35px tall, its ::after reaches 45px; the banner ✕ is 32px
  // with a 44px ::after; the back link has min-height 44).
  test('small text buttons extend their tap area to 44px', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const sizes: Record<string, string> = {
      'install hint «Сховати» ✕': await hitArea(page.getByRole('button', { name: 'Сховати' })),
      'install hint CTA «Як?»': await hitArea(page.getByRole('button', { name: 'Як?' })),
      '«Відкрити день →»': await hitArea(page.getByRole('button', { name: 'Відкрити день' })),
    };
    const meal = await app.newMeal();
    sizes['«Часті страви» «Змінити»'] = await hitArea(
      meal.getByRole('button', { name: 'Змінити', exact: true }),
    );
    sizes['«+ Б · Ж · В»'] = await hitArea(meal.getByRole('button', { name: /^\+ Б · Ж · В/ }));

    await app.goto('/');
    await app.recordButton().click();
    sizes['«Повний запис дня →»'] = await hitArea(
      app.sheet('Що записати?').getByRole('button', { name: 'Повний запис дня' }),
    );
    await app.goto('/');
    const workout = await app.record('Тренування');
    sizes['«+ Нотатка до дня»'] = await hitArea(workout.getByRole('button', { name: '+ Нотатка до дня' }));

    await app.gotoSettings('Цілі');
    sizes['«‹ Налаштування» back link'] = await hitArea(app.settingsBack());
    await app.gotoSettings('Нагадування');
    sizes['reminder switch'] = await hitArea(page.getByRole('switch').first());
    expect(below44(sizes)).toEqual([]);
  });

  test('Home «Сьогодні»: the rows span the card, the inline ✓ / ✕ are 44×44 beside the Тренування row', async ({
    app,
  }) => {
    await app.goto('/');
    const card = await box(app.region('Сьогодні'), '«Сьогодні»');
    const cardRight = card.x + card.width;
    const sizes: Record<string, string> = {};

    for (const name of ['Їжа', 'Вага', 'Заміри'] as const) {
      const row = await box(app.homeRow(name), name);
      expect(row.height, `${name}: height`).toBeGreaterThanOrEqual(56);
      expect(Math.abs(row.x - card.x), `${name}: starts at the card edge`).toBeLessThanOrEqual(2);
      expect(Math.abs(row.x + row.width - cardRight), `${name}: ends at the card edge`).toBeLessThanOrEqual(
        2,
      );
      sizes[name] = await hitArea(app.homeRow(name));
    }

    // Тренування: the row button and the toggle are siblings that share the line.
    const training = app.homeRow('Тренування');
    const button = await box(training, 'Тренування');
    const item = await box(training.locator('xpath=ancestor::li[1]'), 'Тренування row');
    const yes = await box(app.trainingToggle('Було'), '«Було»');
    const no = await box(app.trainingToggle('Не було'), '«Не було»');
    expect(Math.abs(button.x - card.x), 'Тренування: starts at the card edge').toBeLessThanOrEqual(2);
    expect(item.height, 'Тренування: row height').toBeGreaterThanOrEqual(56);
    expect(button.x + button.width, 'the row button stops before «Було»').toBeLessThanOrEqual(yes.x + 0.5);
    expect(
      Math.abs(no.x + no.width + 16 - cardRight),
      '«Не було» ends 16px inside the card',
    ).toBeLessThanOrEqual(2);
    for (const [name, b] of [
      ['Було', yes],
      ['Не було', no],
    ] as const) {
      expect(Math.round(b.width), `«${name}» width`).toBe(44);
      expect(Math.round(b.height), `«${name}» height`).toBe(44);
    }
    sizes['Тренування row'] = await hitArea(training);
    sizes['«Було»'] = await hitArea(app.trainingToggle('Було'));
    sizes['«Не було»'] = await hitArea(app.trainingToggle('Не було'));
    sizes['week row'] = await hitArea(app.weekLink());
    expect(below44(sizes)).toEqual([]);
  });

  // 40px controls (small buttons, segments, the sheet ✕) grow their hit area invisibly with ::after,
  // weekday buttons reach into the gaps of their 7-column row; «Історія калорій» rows are 44px tall.
  test('every control meets the 44px tap target', async ({ app, page }) => {
    await app.goto('/');
    await app.recordButton().click();
    const menu = app.sheet('Що записати?');
    const sizes: Record<string, string> = {};
    for (const name of ['Їжа', 'Тренування', 'Вага', 'Заміри']) {
      const row = menu.getByRole('button', { name: new RegExp(`^${name}`) });
      expect((await box(row, name)).height, `menu «${name}» height`).toBeGreaterThanOrEqual(64);
      sizes[`menu «${name}»`] = await hitArea(row);
    }
    sizes['sheet «Закрити» ✕'] = await hitArea(menu.getByRole('button', { name: 'Закрити' }));

    await app.goto('/settings');
    for (const title of [
      'Нагадування',
      'Цілі',
      'Типи тренувань',
      'Прийоми їжі',
      'Вигляд',
      'Дані і копія',
    ] as const) {
      sizes[`settings «${title}»`] = await hitArea(app.settingsRow(title));
    }
    sizes['settings «Вийти»'] = await hitArea(page.getByRole('button', { name: 'Вийти', exact: true }));
    await app.gotoSettings('Вигляд');
    sizes['theme segment «Авто»'] = await hitArea(page.getByRole('radio', { name: 'Авто' }));
    await app.gotoSettings('Нагадування');
    sizes['reminder switch'] = await hitArea(page.getByRole('switch').first());
    sizes['workout weekday «Пн»'] = await hitArea(page.getByRole('button', { name: 'Понеділок' }).first());

    await app.goto('/progress');
    sizes['period segment «Тиждень»'] = await hitArea(page.getByRole('radio', { name: 'Тиждень' }));
    sizes['«Історія калорій» row'] = await hitArea(
      page.getByRole('button', { name: /Відкрити в календарі$/ }).first(),
    );
    sizes['«Показати ще»'] = await hitArea(page.getByRole('button', { name: 'Показати ще' }));

    await app.goto('/calendar?date=2026-10-05');
    const oct5 = app.region('5 жовтня 2026');
    sizes['day cell'] = await hitArea(
      page
        .getByRole('group', { name: /^\S+ 2026$/ })
        .getByRole('button')
        .first(),
    );
    sizes['«Попередній місяць»'] = await hitArea(page.getByRole('button', { name: 'Попередній місяць' }));
    sizes['«Сьогодні» shortcut'] = await hitArea(page.getByRole('button', { name: 'Сьогодні', exact: true }));
    sizes['day row «Вага»'] = await hitArea(oct5.getByRole('button', { name: 'Вага: 65,7 кг', exact: true }));
    sizes['day card «Було»'] = await hitArea(oct5.getByRole('button', { name: 'Було', exact: true }));
    sizes['day card «Не було»'] = await hitArea(oct5.getByRole('button', { name: 'Не було', exact: true }));
    expect(below44(sizes)).toEqual([]);
  });

  test.describe('meals', () => {
    test.use({ seed: 'meals' });

    test('«Їжа» and «Прийом їжі»: every control meets the 44px tap target', async ({ app, page }) => {
      await mockFood(page);
      await app.goto('/');
      const { list, editor } = await openMealFromList(app, 'Сніданок');
      const sizes: Record<string, string> = {};

      // The stacked meal editor (an existing meal with positions).
      sizes['meal ✕'] = await hitAreaAtTop(
        editor,
        editor.getByRole('button', { name: 'Закрити', exact: true }),
      );
      for (const type of ['Сніданок', 'Обід', 'Вечеря', 'Перекус'])
        sizes[`type chip «${type}»`] = await hitArea(app.mealType(editor, type));
      sizes['«+ Свій»'] = await hitArea(
        editor.getByRole('button', { name: 'Додати свій тип прийому їжі', exact: true }),
      );
      sizes['«✨ Додати ще»'] = await hitArea(
        editor.getByRole('button', { name: 'Додати ще: порахувати калорії', exact: true }),
      );
      sizes['«📷 Фото»'] = await hitArea(
        editor.getByRole('button', { name: 'Порахувати калорії за фото', exact: true }),
      );
      const card = positions(editor);
      sizes['position row'] = await hitArea(card.getByRole('button', { name: /^Вівсянка з бананом, / }));
      sizes['«+ позиція»'] = await hitArea(card.getByRole('button', { name: '+ позиція', exact: true }));
      sizes['«Часті страви» chip'] = await hitArea(editor.getByRole('button', { name: /^Додати «Борщ»/ }));
      sizes['«Часті страви» «Змінити»'] = await hitArea(
        editor.getByRole('button', { name: 'Змінити', exact: true }),
      );
      sizes['«Прибрати час» ✕'] = await hitArea(
        editor.getByRole('button', { name: 'Прибрати час', exact: true }),
      );
      sizes['«Видалити прийом»'] = await hitArea(
        editor.getByRole('button', { name: 'Видалити прийом', exact: true }),
      );
      sizes['meal «Зберегти»'] = await hitArea(editor.getByRole('button', { name: 'Зберегти', exact: true }));
      await page.keyboard.press('Escape');
      await expect(editor).toBeHidden();

      // The list under it.
      sizes['list ✕'] = await hitAreaAtTop(list, list.getByRole('button', { name: 'Закрити', exact: true }));
      sizes['list «Попередній день»'] = await hitAreaAtTop(
        list,
        list.getByRole('button', { name: 'Попередній день', exact: true }),
      );
      for (const title of ['Сніданок', 'Перекус']) {
        expect(
          (await box(app.mealRow(list, title), title)).height,
          `row «${title}» height`,
        ).toBeGreaterThanOrEqual(56);
        sizes[`meal row «${title}»`] = await hitArea(app.mealRow(list, title));
      }
      sizes['«+ Прийом їжі»'] = await hitArea(app.addMealButton(list));

      // A new meal from «+» on a day with other meals: «Усі прийоми за день →», the folded Б · Ж · В, «+ Час».
      await page.keyboard.press('Escape');
      await app.expectSheetClosed();
      const meal = await app.newMeal();
      sizes['«Усі прийоми за день →»'] = await hitArea(
        meal.getByRole('button', { name: 'Усі прийоми за день →', exact: true }),
      );
      sizes['«+ Б · Ж · В»'] = await hitArea(meal.getByRole('button', { name: /^\+ Б · Ж · В/ }));
      sizes['date «Попередній день»'] = await hitAreaAtTop(
        meal,
        meal.getByRole('button', { name: 'Попередній день', exact: true }),
      );
      await meal.getByRole('button', { name: 'Прибрати час', exact: true }).click();
      sizes['«+ Час»'] = await hitArea(meal.getByRole('button', { name: '+ Час', exact: true }));

      // A photo estimate attaches the photo to the meal: its «Видалити фото» ✕ (a 26px dot with a tap area).
      await page.route('**/api/food/estimate', (route) => route.fulfill({ json: PHOTO_ESTIMATE }));
      const chooser = page.waitForEvent('filechooser');
      await meal.getByRole('button', { name: 'Порахувати калорії за фото', exact: true }).click();
      await (await chooser).setFiles({ name: 'plate.jpg', mimeType: 'image/jpeg', buffer: FOOD_JPEG });
      const removePhoto = meal.getByRole('button', { name: 'Видалити фото' }).first();
      await expect(removePhoto).toBeVisible();
      sizes['«Видалити фото»'] = await hitArea(removePhoto);
      expect(below44(sizes)).toEqual([]);
    });

    test('Settings «Прийоми їжі» (view and edit mode) and the «Цілі» macro fields: 44px targets', async ({
      app,
      page,
    }) => {
      await app.gotoSettings('Прийоми їжі');
      const sizes: Record<string, string> = {};
      const types = page.getByRole('region', { name: 'Мої прийоми їжі', exact: true });
      // View mode: calm rows, ≥ 44px each, no controls in them.
      for (const name of ['Сніданок', 'Обід', 'Вечеря', 'Перекус']) {
        const row = types.getByRole('listitem').filter({ hasText: new RegExp(`^${name}$`) });
        expect((await box(row, name)).height, `view row «${name}»`).toBeGreaterThanOrEqual(44);
        await expect(row.locator('button, input')).toHaveCount(0);
      }
      sizes['«Змінити»'] = await hitArea(types.getByRole('button', { name: 'Змінити', exact: true }));
      sizes['«Додати»'] = await hitArea(types.getByRole('button', { name: 'Додати', exact: true }));
      const add = types.getByRole('textbox', { name: 'Новий тип прийому їжі', exact: true });
      expect((await box(add, 'add field')).height, 'add field height').toBeGreaterThanOrEqual(44);

      // Edit mode: a field and ↑ / ↓ / ✕ per row.
      await types.getByRole('button', { name: 'Змінити', exact: true }).click();
      await expect(types.getByRole('button', { name: 'Готово', exact: true })).toHaveAttribute(
        'aria-pressed',
        'true',
      );
      sizes['«Готово»'] = await hitArea(types.getByRole('button', { name: 'Готово', exact: true }));
      sizes['«Вище: Обід»'] = await hitArea(types.getByRole('button', { name: 'Вище: Обід', exact: true }));
      sizes['«Нижче: Обід»'] = await hitArea(types.getByRole('button', { name: 'Нижче: Обід', exact: true }));
      sizes['«Видалити «Обід»»'] = await hitArea(
        types.getByRole('button', { name: 'Видалити «Обід»', exact: true }),
      );
      const name = types.getByRole('textbox', { name: 'Назва: Обід', exact: true });
      expect((await box(name, 'name field')).height, 'name field height').toBeGreaterThanOrEqual(44);
      await expect(types.locator(NESTED_CONTROL)).toHaveCount(0);
      // «Повернути стандартні» shows once a default is gone.
      await types.getByRole('button', { name: 'Видалити «Перекус»', exact: true }).click();
      sizes['«Повернути стандартні»'] = await hitArea(
        types.getByRole('button', { name: 'Повернути стандартні', exact: true }),
      );

      await app.gotoSettings('Цілі');
      for (const macro of ['білки', 'жири', 'вуглеводи']) {
        const field = page.getByRole('textbox', { name: `Ціль: ${macro}, г на день`, exact: true });
        expect((await box(field, macro)).height, `goal field «${macro}» height`).toBeGreaterThanOrEqual(44);
      }
      expect(below44(sizes)).toEqual([]);
    });
  });

  test('the positions of a meal and the item editor «Позиція»: 44px targets, no zoom on focus', async ({
    app,
    page,
  }) => {
    await mockFood(page);
    await app.goto('/');
    const meal = await app.newMeal();
    await mealText(meal).fill('борщ 300 г і 2 скибки хліба');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    const card = positions(meal);
    await expect(card).toBeVisible();
    const sizes: Record<string, string> = {
      'position row': await hitArea(card.getByRole('button', { name: /^Борщ, / })),
      '«+ позиція»': await hitArea(card.getByRole('button', { name: '+ позиція', exact: true })),
      '«Прибрати ці позиції»': await hitArea(
        meal.getByRole('button', { name: 'Прибрати ці позиції — останній підрахунок', exact: true }),
      ),
    };

    await card.getByRole('button', { name: /^Хліб житній, / }).click();
    const editor = app.sheet('Позиція');
    await expect(editor).toBeVisible();
    sizes['editor ✕'] = await hitAreaAtTop(
      editor,
      editor.getByRole('button', { name: 'Закрити', exact: true }),
    );
    sizes['−'] = await hitAreaAtTop(editor, editor.getByRole('button', { name: 'Зменшити' }));
    sizes['+'] = await hitAreaAtTop(editor, editor.getByRole('button', { name: 'Збільшити' }));
    sizes['unit chip «мл»'] = await hitAreaAtTop(
      editor,
      editor.getByRole('button', { name: 'мл', exact: true }),
    );
    sizes['multiplier «½»'] = await hitAreaAtTop(editor, editor.getByRole('button', { name: /^½/ }));
    sizes['«Порція текстом»'] = await hitAreaAtTop(
      editor,
      editor.getByRole('button', { name: 'Порція текстом' }),
    );
    sizes['«Вписати вручну»'] = await hitAreaAtTop(
      editor,
      editor.getByRole('button', { name: 'Вписати вручну' }),
    );
    sizes['«Видалити позицію»'] = await hitArea(editor.getByRole('button', { name: 'Видалити позицію' }));
    sizes['«Готово»'] = await hitArea(editor.getByRole('button', { name: 'Готово', exact: true }));
    expect(below44(sizes)).toEqual([]);

    // Every field the editor can show: name, amount, free-text portion, kcal and Б · Ж · В by hand.
    expect(await inputsBelow16px(page)).toEqual([]);
    await editor.getByRole('button', { name: 'Вписати вручну' }).click();
    await editor.getByRole('button', { name: 'Порція текстом' }).click();
    for (const macro of ['Білки', 'Жири', 'Вуглеводи'])
      await expect(editor.getByRole('textbox', { name: macro, exact: true })).toBeVisible();
    expect(await inputsBelow16px(page)).toEqual([]);
  });

  test('the narrowest unit chip «г» in the item editor is 44px wide', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const meal = await app.newMeal();
    await mealText(meal).fill('борщ 300 г');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await positions(meal)
      .getByRole('button', { name: /^Борщ, / })
      .click();
    const editor = app.sheet('Позиція');
    await editor.evaluate((el) => el.scrollTo(0, 0));
    const size = await hitArea(editor.getByRole('button', { name: 'г', exact: true }));
    expect(below44({ 'unit chip «г»': size })).toEqual([]);
  });

  test.describe('landscape', () => {
    // Plus / Pro Max in landscape: wider than the 900px desktop breakpoint, but a touch screen.
    test.use({ viewport: { width: 932, height: 430 }, screen: { width: 932, height: 430 } });

    test('a phone in landscape keeps the phone shell: tab bar and bottom sheets', async ({ app, page }) => {
      await app.goto('/');
      expect(await page.evaluate(() => window.innerWidth)).toBeGreaterThanOrEqual(900);
      // Tab bar «+» («Записати день»), not the sidebar's «+ Записати день».
      await expect(page.getByRole('button', { name: 'Записати день', exact: true })).toBeVisible();
      await expect(page.getByRole('button', { name: '+ Записати день', exact: true })).toHaveCount(0);

      await app.recordButton().click();
      const sheet = app.sheet('Що записати?');
      await expect(sheet).toBeVisible();
      // Bottom sheet (≤ 440px wide, docked to the bottom), not the centred 560px desktop modal.
      await expect
        .poll(async () => {
          const b = await sheet.boundingBox();
          return b && { narrow: b.width <= 440, bottom: Math.round(b.y + b.height) };
        })
        .toEqual({ narrow: true, bottom: 430 });
    });
  });
});

test.describe('accessible names contain the visible label (WCAG 2.5.3)', () => {
  test.use({ seed: 'meals' });

  test('the meal editor, the day’s list and Settings «Прийоми їжі»', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');

    // «+» → Їжа on a day with meals: the AI row, the chips, «+ Свій», the folded Б · Ж · В, the day link.
    const meal = await app.newMeal();
    await expectLabelInName(
      meal.getByRole('button', { name: 'Порахувати калорії', exact: true }),
      '«✨ Порахувати»',
    );
    await expectLabelInName(
      meal.getByRole('button', { name: 'Порахувати калорії за фото', exact: true }),
      '«📷 Фото»',
    );
    await expectLabelInName(
      meal.getByRole('button', { name: 'Додати свій тип прийому їжі', exact: true }),
      '«+ Свій»',
    );
    await expectLabelInName(meal.getByRole('button', { name: /^\+ Б · Ж · В/ }), '«+ Б · Ж · В»');
    await expectLabelInName(app.mealType(meal, 'Перекус'), 'type chip');
    await expectLabelInName(meal.getByRole('button', { name: /^Додати «Борщ»/ }), '«Часті страви» chip');
    // «Усі прийоми за день →» is named by its text alone.
    const showDay = meal.getByRole('button', { name: 'Усі прийоми за день →', exact: true });
    await expect(showDay).not.toHaveAttribute('aria-label');
    await expectLabelInName(showDay, '«Усі прийоми за день →»');
    // After an estimate the first button is «✨ Додати ще».
    await mealText(meal).fill('борщ і хліб');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await expect(positions(meal)).toBeVisible();
    await expectLabelInName(
      meal.getByRole('button', { name: 'Додати ще: порахувати калорії', exact: true }),
      '«✨ Додати ще»',
    );
    await page.keyboard.press('Escape');
    await page
      .getByRole('alertdialog', { name: 'Є незбережені зміни' })
      .getByRole('button', { name: 'Закрити', exact: true })
      .click();
    await app.expectSheetClosed();

    // A saved meal with more text than was counted: «✨ Порахувати решту» also reads the rest.
    const { list, editor } = await openMealFromList(app, 'Сніданок');
    await mealText(editor).fill('Вівсянка з бананом, кава з молоком, яблуко');
    const rest = editor.getByRole('button', { name: 'Порахувати решту: яблуко', exact: true });
    await expect(rest).toBeVisible();
    await expectLabelInName(rest, '«✨ Порахувати решту»');
    await expectLabelInName(app.addMealButton(list), '«+ Прийом їжі»');

    await app.gotoSettings('Прийоми їжі');
    await expectLabelInName(page.getByRole('button', { name: 'Змінити', exact: true }), '«Змінити»');
    await page.getByRole('button', { name: 'Змінити', exact: true }).click();
    await expectLabelInName(page.getByRole('button', { name: 'Готово', exact: true }), '«Готово»');
    // The «Цілі» fields are named «Ціль: білки, г на день» around their visible «Білки».
    await app.gotoSettings('Цілі');
    for (const macro of ['Білки', 'Жири', 'Вуглеводи']) {
      const field = page.getByRole('textbox', {
        name: `Ціль: ${macro.toLowerCase()}, г на день`,
        exact: true,
      });
      const label = await field.evaluate((el) => (el as HTMLInputElement).labels?.[0]?.textContent ?? '');
      expect(label.trim(), `«${macro}» field label`).toBe(macro);
      await expect(field).toHaveAccessibleName(new RegExp(macro, 'i'));
    }
  });

  // The visible «Прибрати ці позиції» is named «Прибрати ці позиції — останній підрахунок» (EstimateCard
  // `UNDO_LABEL`): the name starts with what it shows, so a voice command «Прибрати ці позиції» finds it.
  test('«Прибрати ці позиції» contains its visible label', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const meal = await app.newMeal();
    await mealText(meal).fill('борщ і хліб');
    await meal.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    const undo = meal.getByRole('button', { name: /^Прибрати/ }).filter({ hasText: 'Прибрати ці позиції' });
    await expect(undo).toHaveAccessibleName('Прибрати ці позиції — останній підрахунок');
    await expectLabelInName(undo, '«Прибрати ці позиції»');
  });
});
