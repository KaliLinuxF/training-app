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

  // FIXME(app finding «Tap targets below 44 px on iPhone»): SPEC §2 asks for tap targets ≥ 44px;
  // these controls are 38–40px tall with no tap-area extension.
  test.fixme('every control meets the 44px tap target', async ({ app, page }) => {
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
    expect(below44(sizes)).toEqual([]);
  });
});
