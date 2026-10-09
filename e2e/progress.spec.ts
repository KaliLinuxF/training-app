import type { Locator, Page } from '@playwright/test';
import { expect, test } from './support/test';

/**
 * Expected values for the demo data on Wednesday 14 Oct 2026 (worked out by hand from
 * e2e/fixtures/data.ts: week = since Mon 12 Oct, month = since 15 Sep, 3 months / all = since 3 Aug).
 */
const SUMMARY = {
  week: { title: 'Цього тижня', trainings: '2', kcal: '1 795 ккал', weight: '−0,3 кг' },
  month: { title: 'За останні 30 днів', trainings: '18', kcal: '1 692 ккал', weight: '−1,3 кг' },
  q: { title: 'За 3 місяці', trainings: '41', kcal: '1 708 ккал', weight: '−2,9 кг' },
  all: { title: 'За весь період', trainings: '41', kcal: '1 708 ккал', weight: '−2,9 кг' },
} as const;

const LABELS = { week: 'Тиждень', month: 'Місяць', q: '3 міс.', all: 'Весь час' } as const;

const periods = (page: Page) => page.getByRole('radiogroup', { name: 'Період' });

/** textContent with every run of whitespace (incl. the no-break digit-group spaces) as one space. */
const sentence = async (locator: Locator): Promise<string> =>
  ((await locator.textContent()) ?? '').replace(/\s+/g, ' ').trim();

/**
 * WCAG 2.4.11: the focused `control` lies below the stuck period bar's paper band and its 6px fade, and nothing
 * covers its centre.
 */
async function expectClearOfBar(page: Page, control: Locator): Promise<void> {
  const barBottom = await periods(page).evaluate(
    (group) => group.parentElement!.getBoundingClientRect().bottom,
  );
  await expect.poll(async () => (await control.boundingBox())?.y ?? -1).toBeGreaterThanOrEqual(barBottom + 6);
  const uncovered = await control.evaluate((el) => {
    const r = el.getBoundingClientRect();
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return !!hit && el.contains(hit);
  });
  expect(uncovered).toBe(true);
}

test.describe('progress', () => {
  test('period switch: the summary sentence follows the period', async ({ app, page }) => {
    await app.goto('/progress');
    await expect(periods(page).getByRole('radio', { name: 'Тиждень' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    for (const key of ['week', 'month', 'q', 'all'] as const) {
      const expected = SUMMARY[key];
      await periods(page).getByRole('radio', { name: LABELS[key] }).click();
      await expect(periods(page).getByRole('radio', { name: LABELS[key] })).toHaveAttribute(
        'aria-checked',
        'true',
      );
      const summary = app.region(expected.title);
      await expect(summary).toBeVisible();
      const text = await sentence(summary);
      expect(text).toContain(`Тренувань ${expected.trainings}`);
      expect(text).toContain(`калорійність ${expected.kcal}`);
      expect(text).toContain(`вага ${expected.weight}`);
      // One sentence, not a table that repeats the cards below.
      await expect(summary.locator('table, dl')).toHaveCount(0);
    }
    await expect(page.getByText('Найчастіше · за весь період')).toBeVisible();
    // «Весь час» ranks the types over all records: Прес 18 is first.
    await expect(app.region('Тренування').getByText('Прес')).toBeVisible();
  });

  test('the period bar stays pinned on a paper band while the cards scroll under it', async ({
    app,
    page,
  }) => {
    await app.goto('/progress');
    const start = await periods(page).boundingBox();
    if (!start) throw new Error('period switcher is not visible');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    // Far enough that a non-sticky switcher would be off screen (the desktop page is shorter than the phone's).
    await expect
      .poll(() => page.evaluate(() => window.scrollY))
      .toBeGreaterThan(start.y + start.height + 100);

    const box = await periods(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y).toBeLessThanOrEqual(24);
    // Above the switcher (y = 4) the bar's own paper band is on top — no card edge shows through.
    const covered = await periods(page).evaluate((group) => {
      const bar = group.parentElement;
      const hit = document.elementFromPoint(group.getBoundingClientRect().left + 2, 4);
      return !!bar && !!hit && bar.contains(hit);
    });
    expect(covered).toBe(true);

    await periods(page).getByRole('radio', { name: 'Тиждень' }).click();
    expect(await sentence(app.region('Цього тижня'))).toContain('Тренувань 2');
  });

  test('on her iPhone the summary and the whole weight card, chart included, fit the first screen', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout');
    await app.goto('/progress');
    const chart = app.region('Вага').getByRole('img', { name: /^Вага:/ });
    await expect(chart).toBeVisible();
    const [chartBox, barBox] = await Promise.all([chart.boundingBox(), app.nav.boundingBox()]);
    if (!chartBox || !barBox) throw new Error('chart or tab bar is not visible');
    expect(await page.evaluate(() => window.scrollY)).toBe(0);
    expect(chartBox.y + chartBox.height).toBeLessThanOrEqual(barBox.y);
  });

  test('on her iPhone the summary sentence takes 3 lines at most, in a ~130px card', async ({
    app,
    page,
    server,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone layout');
    /** The period's summary: at most 3 lines; no item (dot included) splits; line 1 holds two items. */
    const expectCompact = async (title: string, twoOnFirstLine: boolean) => {
      const summary = app.region(title);
      await expect(summary).toBeVisible();
      const line = await summary.locator('p').evaluate((p) => {
        const items = [...p.children].map((item) => item.getClientRects());
        return {
          height: p.getBoundingClientRect().height,
          lineHeight: parseFloat(getComputedStyle(p).lineHeight),
          rectsPerItem: items.map((rects) => rects.length),
          tops: items.map((rects) => rects[0]?.top ?? NaN),
        };
      });
      expect(line.rectsPerItem).toEqual([1, 1, 1, 1, 1, 1]);
      expect(line.height).toBeLessThanOrEqual(3 * line.lineHeight + 1);
      if (twoOnFirstLine) expect(Math.abs(line.tops[0]! - line.tops[1]!)).toBeLessThan(2);
      const box = await summary.boundingBox();
      expect(box!.height).toBeLessThanOrEqual(135);
    };

    await app.goto('/progress');
    await expectCompact('Цього тижня', true);
    // «Тренувань 41 · сер. калорійність 1 708 ккал ·» is the widest first line of the demo data.
    await periods(page).getByRole('radio', { name: 'Весь час' }).click();
    await expectCompact('За весь період', true);

    const data = await server.getData();
    await server.importData({ ...data, days: {}, weights: [], measures: [], foods: [] });
    await app.goto('/progress');
    await periods(page).getByRole('radio', { name: 'Тиждень' }).click();
    // «Тренувань — · сер. калорійність — · …»: «—» allows a break after itself, yet no line starts with a dot.
    await expectCompact('Цього тижня', false);
  });

  test('a card control focused under the stuck period bar scrolls clear of it', async ({ app, page }) => {
    await app.goto('/progress');
    const hips = app.region('Заміри тіла').getByRole('button', { name: /^Стегна:/ });
    // Put the row at y ≈ 10: under the band, yet in view, so without scroll-margin the browser would not move it.
    await hips.evaluate((el) => window.scrollBy(0, el.getBoundingClientRect().top - 10));
    const before = await hips.evaluate((el) => el.getBoundingClientRect().top);
    expect(before).toBeGreaterThanOrEqual(0);
    expect(before).toBeLessThan(40);
    await hips.focus();
    await expectClearOfBar(page, hips);
  });

  test('desktop: Shift+Tab back from «Історія калорій» shows the measurement row below the bar', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'keyboard navigation');
    await app.goto('/progress');
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
    const history = app.region('Харчування').getByRole('group', { name: 'Історія калорій' });
    await history
      .getByRole('button', { name: /Відкрити в календарі$/ })
      .first()
      .focus();
    await page.keyboard.press('Shift+Tab');
    const hips = app.region('Заміри тіла').getByRole('button', { name: /^Стегна:/ });
    await expect(hips).toBeFocused();
    await expectClearOfBar(page, hips);
  });

  test('desktop: summary across, then Вага | Заміри тіла and Тренування | Харчування', async ({
    app,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop layout');
    await app.goto('/progress');
    const box = async (name: string) => {
      const b = await app.region(name).boundingBox();
      if (!b) throw new Error(`${name} is not visible`);
      return b;
    };
    const [summary, weight, measures, workouts, nutrition] = await Promise.all(
      ['Цього тижня', 'Вага', 'Заміри тіла', 'Тренування', 'Харчування'].map(box),
    );
    expect(summary!.width).toBeGreaterThan(weight!.width + measures!.width);
    expect(Math.abs(weight!.y - measures!.y)).toBeLessThan(2);
    expect(measures!.x).toBeGreaterThan(weight!.x);
    expect(Math.abs(workouts!.y - nutrition!.y)).toBeLessThan(2);
    expect(workouts!.y).toBeGreaterThan(weight!.y);
  });

  test('the period is remembered after a reload; a ?period= link wins and leaves the URL', async ({
    app,
    page,
  }) => {
    await app.goto('/progress');
    await periods(page).getByRole('radio', { name: 'Місяць' }).click();
    await app.reload();
    await expect(periods(page).getByRole('radio', { name: 'Місяць' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(app.region('За останні 30 днів')).toBeVisible();

    await app.goto('/progress?period=all');
    await expect(periods(page).getByRole('radio', { name: 'Весь час' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page).toHaveURL(/\/progress$/);
    await expect(app.region('За весь період')).toBeVisible();
    // The link's period is remembered like a tap.
    await app.reload();
    await expect(periods(page).getByRole('radio', { name: 'Весь час' })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    // An unknown value is only removed.
    await app.goto('/progress?period=year');
    await expect(page).toHaveURL(/\/progress$/);
    await expect(periods(page).getByRole('radio', { name: 'Весь час' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('weight and measurement cards; the selected parameter drives the chart', async ({ app }) => {
    await app.goto('/progress');
    const weight = app.region('Вага');
    for (const part of ['65,4', '−2,9 кг від старту', 'Старт 68,3', 'ще 5,4 кг', 'Ціль 60,0', '35% шляху']) {
      await expect(weight).toContainText(part);
    }
    // «від старту» is on screen, not only in an accessible name.
    await expect(weight.getByText('−2,9 кг від старту')).toBeVisible();
    await expect(weight.getByRole('img', { name: /^Вага:/ })).toBeVisible();

    const measures = app.region('Заміри тіла');
    const params = measures.getByRole('group', { name: 'Параметр для графіка' });
    const waist = params.getByRole('button', { name: /^Талія:/ });
    const chest = params.getByRole('button', { name: /^Груди:/ });
    await expect(waist).toHaveAttribute('aria-pressed', 'true');
    await expect(waist).toContainText('74,5 → 70 см');
    await expect(waist).toContainText('−4,5 см');
    await expect(measures.getByRole('img', { name: /^Талія:/ })).toBeVisible();
    await expect(measures).toContainText('Талія, см');

    await chest.click();
    await expect(chest).toHaveAttribute('aria-pressed', 'true');
    await expect(waist).toHaveAttribute('aria-pressed', 'false');
    await expect(measures.getByRole('img', { name: /^Груди:/ })).toBeVisible();
    await expect(measures).toContainText('Груди, см');
    await expect(chest).toContainText('93 → 90 см');
  });

  test('kcal history: 3 days, «Показати ще» adds 7, a row opens that day in the calendar', async ({
    app,
    page,
  }) => {
    await app.goto('/progress');
    const nutrition = app.region('Харчування');
    await expect(nutrition).toContainText('ціль 1 700 ккал');
    await expect(nutrition).toContainText('Сер. цього тижня');
    await expect(nutrition).toContainText('Сер. цього місяця');
    await expect(nutrition).not.toContainText('Період');
    const history = nutrition.getByRole('group', { name: 'Історія калорій' });
    const rows = history.getByRole('button', { name: /Відкрити в календарі$/ });
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toHaveAccessibleName('13 жовтня: 1 740 ккал. Відкрити в календарі');
    await expect(rows.first()).toContainText('Вт, 13 жовтня');
    await history.getByRole('button', { name: 'Показати ще' }).click();
    await expect(rows).toHaveCount(10);

    await history.getByRole('button', { name: '7 жовтня: 1 880 ккал. Відкрити в календарі' }).click();
    await expect(app.heading('Календар')).toBeVisible();
    await expect(page).toHaveURL(/\/calendar\?date=2026-10-07$/);
    await expect(app.region('7 жовтня 2026')).toContainText('1 880 ккал');
  });

  test('empty account: hints, and the empty charts open the weigh-in and measurement sheets', async ({
    app,
    page,
    server,
  }) => {
    const data = await server.getData();
    await server.importData({ ...data, days: {}, weights: [], measures: [], foods: [] });
    await app.goto('/progress');
    const weight = app.region('Вага');
    const measures = app.region('Заміри тіла');
    await expect(weight).toContainText('Запиши перше зважування, щоб бачити динаміку');
    await expect(measures).toContainText('Запиши заміри, щоб бачити динаміку');
    await expect(app.region('Тренування')).toContainText('За цей період тренувань ще немає');
    await expect(app.region('Харчування')).toContainText('Ще немає днів із калоріями');
    expect(await sentence(app.region('Цього тижня'))).toContain('Тренувань —');
    await expect(page.getByRole('main')).not.toContainText(/NaN|undefined|Infinity/);

    await weight.getByRole('button', { name: '+ Записати вагу' }).click();
    const weighIn = app.sheet('Контрольне зважування');
    await expect(weighIn).toBeVisible();
    await weighIn.getByRole('button', { name: 'Закрити' }).click();
    await app.expectSheetClosed();

    await measures.getByRole('button', { name: '+ Записати заміри' }).click();
    await expect(app.sheet('Заміри тіла')).toBeVisible();
  });
});
