import { describe, expect, it } from 'vitest';
import { contrast, cssValue, readCss, themeTokens, tokenName, type Theme } from '@/ui/internal/cssSource';

/**
 * Style contracts of «Налаштування» that jsdom cannot render. (The e2e suite checks the real layout:
 * e2e/settings.spec.ts; the screenshots: e2e/visual.spec.ts 40–46.)
 */

const THEMES: Theme[] = ['light', 'dark'];
const list = readCss('screens/settings/SettingsList.module.css');
const pill = readCss('ui/feedback/Pill.module.css');
const listRow = readCss('ui/lists/ListRow.module.css');

/** WCAG ratio of two token references («var(--accD)») in a theme. */
function tokenContrast(theme: Theme, fg: string | undefined, bg: string | undefined): number {
  const t = themeTokens(theme);
  const [a, b] = [t[tokenName(fg)], t[tokenName(bg)]];
  if (a === undefined || b === undefined) throw new Error(`unknown token in ${fg} / ${bg}`);
  return contrast(a, b);
}

describe('the push badge on the selected «Нагадування» row (desktop)', () => {
  const selectedRow = cssValue(listRow, '.action[aria-current]', 'background');
  const lifted = cssValue(list, '.nav [aria-current] .badge', 'background');

  it('the selected row and the acc pill share --accT, so the pill needs lifting there', () => {
    expect(selectedRow).toBe('var(--accT)');
    expect(cssValue(pill, '.acc', 'background')).toBe('var(--accT)');
  });

  it('is lifted onto the card colour, with a selector that outranks the pill’s one-class tone', () => {
    expect(lifted).toBe('var(--card)');
  });

  it.each(THEMES)('stands out as a chip on the tinted row (%s)', (theme) => {
    expect(tokenContrast(theme, lifted, selectedRow)).toBeGreaterThan(1.1);
  });

  it.each(THEMES)('keeps its text readable on the card colour: acc and neutral tones (%s)', (theme) => {
    for (const tone of ['.acc', '.neutral']) {
      expect(tokenContrast(theme, cssValue(pill, tone, 'color'), lifted), tone).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe('«Прийоми їжі» and «Б · Ж · В на день»', () => {
  const meals = readCss('screens/settings/MealTypesCard.module.css');
  const macros = readCss('screens/settings/MacroGoalsCard.module.css');
  const px = (value: string | undefined) => parseFloat(value ?? 'NaN');

  it('keeps every text field at 16px (iOS zooms into anything smaller) and at least 44px tall', () => {
    expect(px(cssValue(meals, '.name', 'font-size'))).toBe(16);
    expect(px(cssValue(meals, '.name', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(meals, '.input', 'font-size'))).toBe(16);
    expect(px(cssValue(meals, '.input', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(macros, '.input', 'font-size'))).toBe(16);
    expect(px(cssValue(macros, '.input', 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(macros, '.input', 'width'))).toBe(96);
  });

  it('gives the view rows 44px and the edit row three 44px buttons next to a field that may shrink', () => {
    expect(px(cssValue(meals, '.row', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(cssValue(meals, '.editRow', 'grid-template-columns')).toBe('minmax(0, 1fr) repeat(3, 44px)');
    expect(cssValue(meals, '.name', 'min-width')).toBe('0');
  });

  it('dims an aria-disabled ↑ / ↓ like a disabled glyph button', () => {
    expect(cssValue(meals, ".control[aria-disabled='true']", 'color')).toBe('var(--faint)');
    expect(cssValue(meals, ".list .control[aria-disabled='true']:active", 'transform')).toBe('none');
  });

  it.each(THEMES)('keeps the notes and errors readable on their surfaces (%s)', (theme) => {
    expect(tokenContrast(theme, cssValue(meals, '.note', 'color'), 'var(--paper)')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(tokenContrast(theme, cssValue(macros, '.note', 'color'), 'var(--card)')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(tokenContrast(theme, cssValue(meals, '.error', 'color'), 'var(--card)')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(tokenContrast(theme, cssValue(macros, '.error', 'color'), 'var(--card)')).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});
