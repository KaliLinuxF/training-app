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

test.describe('iPhone ergonomics', () => {
  test.skip(({ isMobile }) => !isMobile, 'phone-only checks');

  test('every text input is at least 16px (no zoom on focus)', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    await app.recordButton().click();
    const sheet = app.sheet('Запис дня');
    await sheet.getByRole('button', { name: 'Було', exact: true }).click();
    await sheet.getByRole('button', { name: '+ Свій тип' }).click();
    await sheet.getByRole('button', { name: 'Порахувати калорії', exact: true }).click();
    await sheet.getByRole('textbox', { name: 'Що порахувати' }).fill('борщ');
    await sheet.getByRole('button', { name: 'Порахувати', exact: true }).click();
    await expect(sheet.getByRole('region', { name: 'Оцінка калорій' })).toBeVisible();
    expect(await inputsBelow16px(page)).toEqual([]);

    for (const path of ['/reminders', '/?sheet=weight', '/?sheet=measure']) {
      await app.goto(path);
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

  test('small text buttons extend their tap area to 44px', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const sizes: Record<string, string> = {
      'install hint «Сховати» ✕': await hitArea(page.getByRole('button', { name: 'Сховати' })),
      '«Відкрити день →»': await hitArea(page.getByRole('button', { name: 'Відкрити день' })),
    };
    await page.getByRole('button', { name: 'Відкрити день' }).click();
    const sheet = app.sheet('Запис дня');
    sizes['«Часті страви» «Змінити»'] = await hitArea(sheet.getByRole('button', { name: 'Змінити' }));
    await app.goto('/reminders');
    sizes['reminder switch'] = await hitArea(page.getByRole('switch').first());
    expect(below44(sizes)).toEqual([]);
  });

  // 40px controls (small buttons, segments, the sheet ✕) grow their hit area invisibly with ::after,
  // weekday buttons reach into the gaps of their 7-column row; «Історія калорій» rows are 44px tall.
  test('every control meets the 44px tap target', async ({ app, page }) => {
    await mockFood(page);
    await app.goto('/');
    const sizes: Record<string, string> = {
      'banner CTA «Відмітити»': await hitArea(page.getByRole('button', { name: 'Відмітити' })),
      'banner CTA «Як?»': await hitArea(page.getByRole('button', { name: 'Як?' })),
    };
    await page.getByRole('button', { name: 'Відкрити день' }).click();
    sizes['sheet «Закрити» ✕'] = await hitArea(
      app.sheet('Запис дня').getByRole('button', { name: 'Закрити' }),
    );
    await app.goto('/progress');
    sizes['period segment «Тиждень»'] = await hitArea(page.getByRole('radio', { name: 'Тиждень' }));
    sizes['«Історія калорій» row'] = await hitArea(
      page.getByRole('button', { name: /Відкрити в календарі$/ }).first(),
    );
    await app.goto('/reminders');
    sizes['theme segment «Авто»'] = await hitArea(page.getByRole('radio', { name: 'Авто' }));
    sizes['workout weekday «Пн»'] = await hitArea(page.getByRole('button', { name: 'Понеділок' }).first());
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
      const sheet = app.sheet('Запис дня');
      await expect(sheet).toBeVisible();
      // Bottom sheet (≤ 440px wide, docked to the bottom), not the centred 560px desktop modal.
      await expect
        .poll(async () => {
          const box = await sheet.boundingBox();
          return box && { narrow: box.width <= 440, bottom: Math.round(box.y + box.height) };
        })
        .toEqual({ narrow: true, bottom: 430 });
    });
  });
});
