/**
 * App shell (redesign A): the three-part tab bar fits every phone width with 11px labels (10px below 360),
 * «+» opens the «Що записати?» menu and says so with aria-expanded, the active «Налаштування» tab on a
 * sub-page goes back to the list (desktop: the sidebar does the same), and keyboard focus never ends up under
 * the floating tab bar (the phone shell's page scroll-padding, WCAG 2.2 SC 2.4.11).
 */
import type { Locator, Page } from '@playwright/test';
import type { App } from './support/app';
import { expect, test } from './support/test';

const TABS = ['Головна', 'Календар', 'Прогрес', 'Налаштування'] as const;

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

/** `inner` lies inside `outer`, give or take 1px (sub-pixel text metrics). */
function expectInside(inner: Box, outer: Box, what: string): void {
  expect(inner.x, `${what}: left edge`).toBeGreaterThanOrEqual(outer.x - 1);
  expect(inner.y, `${what}: top edge`).toBeGreaterThanOrEqual(outer.y - 1);
  expect(inner.x + inner.width, `${what}: right edge`).toBeLessThanOrEqual(outer.x + outer.width + 1);
  expect(inner.y + inner.height, `${what}: bottom edge`).toBeLessThanOrEqual(outer.y + outer.height + 1);
}

const tab = (app: App, name: (typeof TABS)[number]): Locator =>
  app.nav.getByRole('link', { name, exact: true });

/** «+» / «+ Записати день», also while the sheet it opened covers the page. */
const recordButton = (app: App): Locator =>
  app.page.getByRole('button', { name: /Записати день$/, includeHidden: true });

test.describe('tab bar fit', () => {
  for (const [width, height] of [
    [390, 844],
    [375, 667],
    [320, 640],
  ] as const) {
    test(`at ${width}×${height} every label fits its tab and «+» is centred`, async ({ app, page }, info) => {
      test.skip(info.project.name !== 'iphone', 'phone tab bar only');
      await page.setViewportSize({ width, height });
      await app.goto('/');
      // Measure with Manrope, not the fallback font.
      await page.evaluate(async () => {
        await document.fonts.ready;
      });

      const bar = await boxOf(app.nav, 'tab bar');
      const inner = await app.nav.evaluate((nav) => {
        const r = (nav.firstElementChild ?? nav).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      });
      expectInside(inner, bar, `inner bar @${width}`);

      for (const name of TABS) {
        const link = tab(app, name);
        const label = link.getByText(name, { exact: true });
        const [linkBox, labelBox] = await Promise.all([
          boxOf(link, `«${name}» @${width}`),
          boxOf(label, `«${name}» label @${width}`),
        ]);
        expectInside(labelBox, linkBox, `«${name}» label in its tab @${width}`);
        expectInside(labelBox, inner, `«${name}» label in the bar @${width}`);
        expect(linkBox.height, `«${name}» tap height @${width}`).toBeGreaterThanOrEqual(44);
        expect(linkBox.width, `«${name}» tap width @${width}`).toBeGreaterThanOrEqual(44);
        expect(await label.evaluate((el) => getComputedStyle(el).fontSize), `«${name}» @${width}`).toBe(
          width < 360 ? '10px' : '11px',
        );
      }

      // The longest label is drawn whole (its tab box is checked above).
      const settingsLabel = tab(app, 'Налаштування').getByText('Налаштування', { exact: true });
      expect(
        await settingsLabel.evaluate((el) => el.scrollWidth - el.clientWidth),
        `«Налаштування» truncated @${width}`,
      ).toBeLessThanOrEqual(0);

      const plus = await boxOf(app.nav.getByRole('button', { name: 'Записати день', exact: true }), '«+»');
      expect(
        Math.abs(plus.x + plus.width / 2 - (bar.x + bar.width / 2)),
        `«+» centre @${width}`,
      ).toBeLessThanOrEqual(1);
      expectInside(plus, inner, `«+» in the bar @${width}`);
    });
  }
});

test.describe('record menu opener', () => {
  test('«+» opens «Що записати?» with aria-expanded; Escape closes it and gives focus back', async ({
    app,
  }) => {
    await app.goto('/');
    const plus = recordButton(app);
    await expect(plus).toHaveAttribute('aria-haspopup', 'dialog');
    await expect(plus).toHaveAttribute('aria-expanded', 'false');

    await plus.click();
    await expect(app.sheet('Що записати?')).toBeVisible();
    await expect(plus).toHaveAttribute('aria-expanded', 'true');

    await app.page.keyboard.press('Escape');
    await app.expectSheetClosed();
    await expect(plus).toHaveAttribute('aria-expanded', 'false');
    await expect(plus).toBeFocused();
  });
});

test.describe('active tab on a settings sub-page', () => {
  test('a deep-linked sub-page: the tab says aria-current="true" and goes to the list; again only scrolls', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone tab bar only');
    await app.gotoSettings('Цілі');
    const settings = tab(app, 'Налаштування');
    await expect(settings).toHaveAttribute('aria-current', 'true');

    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(app.heading('Налаштування')).toBeVisible();
    await expect(settings).toHaveAttribute('aria-current', 'page');

    const entries = await page.evaluate(() => history.length);
    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(app.heading('Налаштування')).toBeVisible();
    await expect(app.settingsRow('Цілі')).toBeVisible();
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test('a sub-page opened from the list: the tab pops back to it (history.back, the sub-page stays ahead)', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone tab bar only');
    await app.goto('/');
    await app.openSettings('Цілі');
    await expect(page).toHaveURL(/\/settings\/goals$/);

    await tab(app, 'Налаштування').click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(app.settingsRow('Цілі')).toBeVisible();

    await page.goForward();
    await expect(page).toHaveURL(/\/settings\/goals$/);
  });
});

/** Computed scroll-padding of the page (<html>): what focus scrolling and scrollIntoView keep clear. */
const pageScrollPadding = (page: Page): Promise<{ top: string; bottom: string }> =>
  page.evaluate(() => {
    const style = getComputedStyle(document.documentElement);
    return { top: style.scrollPaddingTop, bottom: style.scrollPaddingBottom };
  });

test.describe('keyboard focus clear of the tab bar', () => {
  test('Tab through /progress: every focused control is drawn above the floating tab bar', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'iphone', 'phone tab bar only');
    await app.goto('/progress');
    await expect(app.heading('Прогрес')).toBeVisible();
    // 84px bar (70 + its 14px offset) + 12 breathing room; the safe areas are 0 in Chrome.
    expect(await pageScrollPadding(page)).toEqual({ top: '0px', bottom: '96px' });

    const barTop = await app.nav.evaluate(
      (nav) => (nav.firstElementChild ?? nav).getBoundingClientRect().top,
    );
    let checked = 0;
    let maxScrollY = 0;
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press('Tab');
      const focus = await app.nav.evaluate((nav) => {
        const el = document.activeElement;
        if (!el || el === document.body || el === document.documentElement) return { where: 'none' as const };
        if (nav.contains(el)) return { where: 'nav' as const };
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return { where: 'none' as const };
        const y = Math.min(Math.max(r.top + r.height / 2, 0), window.innerHeight - 1);
        const hit = document.elementFromPoint(r.left + r.width / 2, y);
        return {
          where: 'page' as const,
          name: (el.getAttribute('aria-label') ?? el.textContent ?? '')
            .replace(/\s+/g, ' ')
            .trim()
            .slice(0, 60),
          top: r.top,
          bottom: r.bottom,
          underBar: hit !== null && nav.contains(hit),
          scrollY: window.scrollY,
        };
      });
      // The page's controls come first in the tab order, then the tab bar: once focus reaches it, all were seen.
      if (focus.where === 'nav') {
        if (checked > 0) break;
        continue;
      }
      if (focus.where === 'none') continue;
      checked += 1;
      maxScrollY = Math.max(maxScrollY, focus.scrollY);
      expect.soft(focus.underBar, `«${focus.name}»: its centre is under the tab bar`).toBe(false);
      expect
        .soft(focus.bottom, `«${focus.name}»: bottom edge vs the tab bar top ${barTop}`)
        .toBeLessThanOrEqual(barTop);
      expect.soft(focus.top, `«${focus.name}»: top edge`).toBeGreaterThanOrEqual(-1);
    }
    // The walk really covered a long screen: several controls, and focus had to scroll the page.
    expect(checked, 'focused controls on /progress').toBeGreaterThanOrEqual(8);
    expect(maxScrollY, 'focus scrolled the page').toBeGreaterThan(0);
  });

  test('the padding belongs to the phone shell: a narrow desktop window has it, the desktop shell does not', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop browser only');
    await app.goto('/progress');
    expect(await pageScrollPadding(page)).toEqual({ top: 'auto', bottom: 'auto' });

    // Below 900px a desktop browser gets the phone shell (tab bar), and with it the padding.
    await page.setViewportSize({ width: 800, height: 700 });
    await expect(app.nav.getByRole('button', { name: 'Записати день', exact: true })).toBeVisible();
    await expect.poll(() => pageScrollPadding(page)).toEqual({ top: '0px', bottom: '96px' });

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole('button', { name: '+ Записати день', exact: true })).toBeVisible();
    await expect.poll(() => pageScrollPadding(page)).toEqual({ top: 'auto', bottom: 'auto' });
  });
});

test.describe('desktop sidebar', () => {
  test('marks «Налаштування» on /settings/data, goes back to /settings, and «+ Записати день» opens the menu', async ({
    app,
    page,
  }, info) => {
    test.skip(info.project.name !== 'desktop', 'desktop sidebar only');
    await app.gotoSettings('Дані і копія');
    const settings = tab(app, 'Налаштування');
    await expect(settings).toHaveAttribute('aria-current', 'true');
    for (const name of ['Головна', 'Календар', 'Прогрес'] as const) {
      await expect(tab(app, name)).not.toHaveAttribute('aria-current');
    }

    await settings.click();
    await expect(page).toHaveURL(/\/settings$/);
    await expect(settings).toHaveAttribute('aria-current', 'page');

    await app.recordButton().click();
    await expect(app.sheet('Що записати?')).toBeVisible();
    await expect(recordButton(app)).toHaveAttribute('aria-expanded', 'true');
  });
});
