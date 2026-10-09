import type { Locator, Page } from '@playwright/test';
import { mockFood } from './support/food';
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
});

test.describe('iPhone ergonomics', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-only checks');

  test('every text input is at least 16px (no zoom on focus)', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');

    // «Їжа»: the food text, the composer, the estimate card and the kcal field.
    const food = await app.record('Їжа');
    await food.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await food.getByRole('textbox', { name: 'Що порахувати' }).fill('борщ');
    expect(await inputsBelow16px(page), '«Їжа» composer').toEqual([]);
    await food.getByRole('button', { name: 'Порахувати', exact: true }).click();
    await expect(food.getByRole('region', { name: 'Оцінка калорій' })).toBeVisible();
    expect(await inputsBelow16px(page), '«Їжа» estimate').toEqual([]);

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
    await page.getByRole('button', { name: 'Відкрити день' }).click();
    const sheet = app.sheet('Запис дня');
    sizes['«Часті страви» «Змінити»'] = await hitArea(sheet.getByRole('button', { name: 'Змінити' }));

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
    for (const title of ['Нагадування', 'Цілі', 'Типи тренувань', 'Вигляд', 'Дані і копія'] as const) {
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

  test('the estimate list and the item editor: 44px targets, no zoom on focus', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    await page.getByRole('button', { name: 'Відкрити день' }).click();
    const sheet = app.sheet('Запис дня');
    await sheet.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await sheet.getByRole('textbox', { name: 'Що порахувати' }).fill('борщ 300 г і 2 скибки хліба');
    await sheet.getByRole('button', { name: 'Порахувати', exact: true }).click();
    const card = sheet.getByRole('region', { name: 'Оцінка калорій' });
    const sizes: Record<string, string> = {
      'estimate row': await hitArea(card.getByRole('button', { name: /^Борщ, / })),
      '«+ позиція»': await hitArea(card.getByRole('button', { name: '+ позиція' })),
    };

    await card.getByRole('button', { name: /^Хліб житній, / }).click();
    const editor = page.getByRole('dialog', { name: 'Позиція', exact: true });
    await expect(editor).toBeVisible();
    // Measured with the panel scrolled to its top: the sticky footer covers nothing above it.
    const top = async (name: string, locator: Locator) => {
      await editor.evaluate((el) => el.scrollTo(0, 0));
      sizes[name] = await locator.evaluate((el) => {
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
    };
    await top('editor ✕', editor.getByRole('button', { name: 'Закрити', exact: true }));
    await top('−', editor.getByRole('button', { name: 'Зменшити' }));
    await top('+', editor.getByRole('button', { name: 'Збільшити' }));
    await top('unit chip «мл»', editor.getByRole('button', { name: 'мл', exact: true }));
    await top('multiplier «½»', editor.getByRole('button', { name: /^½/ }));
    await top('«Порція текстом»', editor.getByRole('button', { name: 'Порція текстом' }));
    await top('«Вписати вручну»', editor.getByRole('button', { name: 'Вписати вручну' }));
    sizes['«Видалити позицію»'] = await hitArea(editor.getByRole('button', { name: 'Видалити позицію' }));
    sizes['«Готово»'] = await hitArea(editor.getByRole('button', { name: 'Готово', exact: true }));
    expect(below44(sizes)).toEqual([]);

    // Every field the editor can show: name, amount, free-text portion, kcal by hand.
    expect(await inputsBelow16px(page)).toEqual([]);
    await editor.getByRole('button', { name: 'Вписати вручну' }).click();
    await editor.getByRole('button', { name: 'Порція текстом' }).click();
    expect(await inputsBelow16px(page)).toEqual([]);
  });

  test('the narrowest unit chip «г» in the item editor is 44px wide', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    await page.getByRole('button', { name: 'Відкрити день' }).click();
    const sheet = app.sheet('Запис дня');
    await sheet.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await sheet.getByRole('textbox', { name: 'Що порахувати' }).fill('борщ 300 г');
    await sheet.getByRole('button', { name: 'Порахувати', exact: true }).click();
    await sheet
      .getByRole('region', { name: 'Оцінка калорій' })
      .getByRole('button', { name: /^Борщ, / })
      .click();
    const editor = page.getByRole('dialog', { name: 'Позиція', exact: true });
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
