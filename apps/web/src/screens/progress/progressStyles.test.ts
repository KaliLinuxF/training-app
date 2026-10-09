import { describe, expect, it } from 'vitest';
import {
  contrast,
  cssRules,
  cssValue,
  px,
  readCss,
  themeTokens,
  tokenName,
  type Theme,
} from '@/ui/internal/cssSource';

/**
 * Style contracts of «Мій прогрес» that jsdom cannot render: the sticky period bar, tap targets, tokens only,
 * and text contrast in both themes. (The e2e suite checks the real layout: e2e/progress.spec.ts.)
 */

const DIR = 'screens/progress/';
const css = (file: string) => readCss(DIR + file);
const THEMES: Theme[] = ['light', 'dark'];

/** WCAG ratio of two token references («var(--ink2)») in a theme. */
function tokenContrast(theme: Theme, fg: string | undefined, bg: string): number {
  const t = themeTokens(theme);
  const [a, b] = [t[tokenName(fg)], t[tokenName(bg)]];
  if (a === undefined || b === undefined) throw new Error(`unknown token in ${fg} / ${bg}`);
  return contrast(a, b);
}

describe('PeriodBar', () => {
  const bar = css('PeriodBar.module.css');

  it('sticks under the safe area on an opaque paper band, above the cards', () => {
    expect(cssValue(bar, '.bar', 'position')).toBe('sticky');
    expect(cssValue(bar, '.bar', 'top')).toBe('var(--safe-top)');
    expect(cssValue(bar, '.bar', 'z-index')).toBe('5');
    expect(cssValue(bar, '.bar', 'background')).toBe('var(--paper)');
    expect(cssValue(bar, '.bar', 'grid-column')).toBe('1 / -1');
  });

  it('keeps the 14px grid gaps: the 8px band is taken back by negative margins, plus a 6px fade', () => {
    expect(cssValue(bar, '.bar', 'padding')).toBe('8px 0');
    expect(cssValue(bar, '.bar', 'margin')).toBe('-8px 0');
    expect(px(cssValue(bar, '.bar::after', 'height')) + 8).toBe(14);
  });

  it('covers the notch inset above it and fades the cards in below it', () => {
    expect(cssValue(bar, '.bar::before', 'bottom')).toBe('100%');
    expect(cssValue(bar, '.bar::before', 'height')).toBe('var(--safe-top)');
    expect(cssValue(bar, '.bar::before', 'background')).toBe('var(--paper)');
    expect(cssValue(bar, '.bar::after', 'top')).toBe('100%');
    expect(cssValue(bar, '.bar::after', 'background')).toBe('linear-gradient(var(--paper), transparent)');
    expect(cssValue(bar, '.bar::after', 'pointer-events')).toBe('none');
  });

  it('a card control focused by Tab / Shift+Tab scrolls clear of the stuck band, its fade and its focus ring', () => {
    const screen = css('ProgressScreen.module.css');
    const global = readCss('styles/global.css');
    for (const selector of ['.screen section button', '.screen section a[href]']) {
      const margin = cssValue(screen, selector, 'scroll-margin-top');
      expect(margin).toBe('calc(var(--safe-top) + 76px)');
      const extra = px(/^calc\(var\(--safe-top\) \+ (\d+px)\)$/.exec(margin ?? '')?.[1]);
      // Band (8 + switcher 48 + 8) + fade + focus ring (outline + offset).
      const ring = px(/^(\d+px)/.exec(cssValue(global, ':focus-visible', 'outline') ?? '')?.[1]);
      const offset = px(cssValue(global, ':focus-visible', 'outline-offset'));
      const fade = px(cssValue(bar, '.bar::after', 'height'));
      expect(extra).toBeGreaterThanOrEqual(8 + 48 + 8 + fade + ring + offset);
    }
    // Only the cards' controls: the bar's own radios are sticky and must not move the page.
    const scrollRules = cssRules(screen).filter((r) =>
      Object.keys(r.decls).some((prop) => prop.startsWith('scroll-')),
    );
    expect(scrollRules.length).toBeGreaterThan(0);
    for (const rule of scrollRules) {
      for (const sel of rule.selector.split(',')) expect(sel.trim()).toMatch(/^\.screen section /);
    }
  });

  it('the screen header stays above the band before it sticks', () => {
    const screen = css('ProgressScreen.module.css');
    expect(cssValue(screen, '.header', 'position')).toBe('relative');
    expect(Number(cssValue(screen, '.header', 'z-index'))).toBeGreaterThan(
      Number(cssValue(bar, '.bar', 'z-index')),
    );
  });
});

describe('SummaryCard', () => {
  const summary = css('SummaryCard.module.css');

  it('keeps the side padding of the cards below, and 4px before each dot', () => {
    expect(cssValue(summary, 'section.card', 'padding')).toBe('16px 18px');
    expect(cssValue(summary, '.item', 'white-space')).toBe('nowrap');
    expect(cssValue(summary, '.sep', 'margin')).toBe('0 0 0 4px');
    expect(cssValue(summary, '.num', 'line-height')).toBe('1');
  });

  it('a step smaller on phones, so the sentence takes 3 lines, not 4 (~130px card)', () => {
    expect(cssValue(summary, '.line', 'font-size')).toBe('15px');
    expect(cssValue(summary, '.num', 'font-size')).toBe('17px');
    expect(cssValue(summary, '.line', 'font-size', '(max-width: 430px)')).toBe('14px');
    expect(cssValue(summary, '.num', 'font-size', '(max-width: 430px)')).toBe('16px');
  });
});

describe('tap targets', () => {
  it.each([
    ['NutritionCard.module.css', '.row'],
    ['NutritionCard.module.css', '.more'],
    ['MeasuresCard.module.css', '.row'],
  ])('%s %s is at least 44px tall', (file, selector) => {
    expect(px(cssValue(css(file), selector, 'min-height'))).toBeGreaterThanOrEqual(44);
  });

  it('history rows: date · kcal · chevron grid with a 12px chevron column', () => {
    const n = css('NutritionCard.module.css');
    expect(cssValue(n, '.row', 'grid-template-columns')).toBe('minmax(0, 1fr) auto 12px');
    expect(cssValue(n, '.row', 'gap')).toBe('10px');
    expect(cssValue(n, '.row:active', 'background')).toBe('var(--paper)');
    expect(cssValue(n, '.dot', 'width')).toBe('8px');
  });
});

describe('tokens only', () => {
  it.each([
    'ChartPlaceholder.module.css',
    'MeasuresCard.module.css',
    'NutritionCard.module.css',
    'PeriodBar.module.css',
    'ProgressScreen.module.css',
    'SummaryCard.module.css',
    'WeightCard.module.css',
    'WorkoutsCard.module.css',
    'tones.module.css',
  ])('%s has no hard-coded colours', (file) => {
    for (const rule of cssRules(css(file))) {
      for (const [prop, value] of Object.entries(rule.decls)) {
        expect(`${rule.selector} { ${prop}: ${value} }`).not.toMatch(
          /#[\da-f]{3,8}\b|rgba?\(|hsla?\(|oklch\(/i,
        );
      }
    }
  });
});

describe('text contrast is at least 4.5:1', () => {
  const tones = css('tones.module.css');
  const summary = css('SummaryCard.module.css');
  const measures = css('MeasuresCard.module.css');
  const weight = css('WeightCard.module.css');
  const nutrition = css('NutritionCard.module.css');
  const workouts = css('WorkoutsCard.module.css');
  const placeholder = css('ChartPlaceholder.module.css');

  it.each(THEMES)('summary sentence on the lavender tint (%s)', (theme) => {
    expect(tokenContrast(theme, cssValue(summary, '.line', 'color'), 'var(--accT)')).toBeGreaterThanOrEqual(
      4.5,
    );
    for (const tone of ['.ink', '.acc', '.acc2']) {
      expect(tokenContrast(theme, cssValue(tones, tone, 'color'), 'var(--accT)')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('the selected measurement row on the mint tint (%s)', (theme) => {
    const bg = cssValue(measures, '.selected', 'background') ?? '';
    expect(bg).toBe('var(--acc2T)');
    expect(tokenContrast(theme, cssValue(measures, '.range', 'color'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, cssValue(measures, '.row', 'color'), bg)).toBeGreaterThanOrEqual(4.5);
    for (const tone of ['.ink', '.acc', '.acc2']) {
      expect(tokenContrast(theme, cssValue(tones, tone, 'color'), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('secondary text on the white cards (%s)', (theme) => {
    for (const fg of [
      cssValue(weight, '.way', 'color'),
      cssValue(weight, '.scale', 'color'),
      cssValue(weight, '.unit', 'color'),
      cssValue(nutrition, '.historyTitle', 'color'),
      cssValue(nutrition, '.more', 'color'),
      cssValue(workouts, '.heading', 'color'),
    ]) {
      expect(tokenContrast(theme, fg, 'var(--card)')).toBeGreaterThanOrEqual(4.5);
    }
    // «Показати ще» while pressed.
    expect(
      tokenContrast(theme, cssValue(nutrition, '.more', 'color'), 'var(--paper)'),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('the chart placeholder on paper (%s)', (theme) => {
    const bg = cssValue(placeholder, '.box', 'background') ?? '';
    expect(tokenContrast(theme, cssValue(placeholder, '.title', 'color'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, cssValue(placeholder, '.hint', 'color'), bg)).toBeGreaterThanOrEqual(4.5);
  });
});
