import { describe, expect, it } from 'vitest';
import { contrast, cssValue, px, readCss, themeTokens, tokenName, type Theme } from './internal/cssSource';

/**
 * Style contracts jsdom cannot render: focus rings, text contrast and tap-target sizes of the kit.
 * (The e2e suite measures the real hit areas in the browser: e2e/a11y.spec.ts.)
 */

const THEMES: Theme[] = ['light', 'dark'];

/** WCAG ratio of two token references («var(--ink2)») in a theme. */
function tokenContrast(theme: Theme, fg: string | undefined, bg: string | undefined): number {
  const t = themeTokens(theme);
  const [a, b] = [t[tokenName(fg)], t[tokenName(bg)]];
  if (a === undefined || b === undefined) throw new Error(`unknown token in ${fg} / ${bg}`);
  return contrast(a, b);
}

describe('focus rings', () => {
  it.each([
    ['ui/controls/TextArea.module.css', '.textarea:focus'],
    ['ui/controls/NumberStepperField.module.css', '.input:focus'],
    ['ui/controls/TimeInput.module.css', '.input:focus'],
    ['ui/controls/MeasureInputTile.module.css', '.tile:focus-within'],
  ])('%s: a 2px --focus ring, not only a border colour', (file, selector) => {
    const css = readCss(file);
    expect(cssValue(css, selector, 'border-color')).toBe('var(--focus)');
    expect(cssValue(css, selector, 'box-shadow')).toBe('0 0 0 1px var(--focus)');
  });

  it('dark --solid cards switch to the ring colour made for them', () => {
    const css = readCss('ui/surfaces/Card.module.css');
    expect(cssValue(css, '.hero', '--focus')).toBe('var(--focusOnSolid)');
    expect(cssValue(css, '.solid', '--focus')).toBe('var(--focusOnSolid)');
  });
});

describe('secondary text is at least 4.5:1', () => {
  it.each(THEMES)('inactive Segmented labels on the track (%s)', (theme) => {
    const css = readCss('ui/controls/Segmented.module.css');
    expect(
      tokenContrast(theme, cssValue(css, '.item', 'color'), cssValue(css, '.track', 'background')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('the previous measurement shown as the MeasureInputTile placeholder (%s)', (theme) => {
    const css = readCss('ui/controls/MeasureInputTile.module.css');
    const placeholder = cssValue(css, '.previous::placeholder', 'color');
    expect(tokenContrast(theme, placeholder, cssValue(css, '.tile', 'background'))).toBeGreaterThanOrEqual(
      4.5,
    );
  });
});

/**
 * Height a finger can hit: the box plus the vertical reach of a transparent `::after` extension
 * (which needs a positioned host and must not change the layout).
 */
function hitHeight(file: string, selector: string, sizeProp: 'min-height' | 'height'): number {
  const css = readCss(file);
  const box = px(cssValue(css, selector, sizeProp));
  const inset = cssValue(css, `${selector}::after`, 'inset');
  if (inset === undefined) return box;
  expect(cssValue(css, selector, 'position')).toBe('relative');
  expect(cssValue(css, `${selector}::after`, 'position')).toBe('absolute');
  expect(cssValue(css, `${selector}::after`, 'content')).toBe("''");
  const top = px(inset.split(' ')[0]);
  return box - 2 * Math.min(0, top);
}

describe('tap targets are at least 44px (SPEC §2)', () => {
  it.each([
    ['ui/controls/Button.module.css', '.sm', 'min-height'],
    ['ui/controls/Segmented.module.css', '.item', 'min-height'],
    ['ui/sheet/Sheet.module.css', '.close', 'height'],
    ['ui/tiles/BarRow.module.css', '.history', 'min-height'],
  ] as const)('%s %s', (file, selector, sizeProp) => {
    expect(hitHeight(file, selector, sizeProp)).toBeGreaterThanOrEqual(44);
  });

  it('the sheet ✕ is wide enough too', () => {
    const css = readCss('ui/sheet/Sheet.module.css');
    const inset = px(cssValue(css, '.close::after', 'inset'));
    expect(px(cssValue(css, '.close', 'width')) - 2 * inset).toBeGreaterThanOrEqual(44);
  });

  it('weekday buttons (~41px wide in 7 columns) reach into half of each column gap, not into their neighbours', () => {
    const css = readCss('ui/controls/WeekdayPicker.module.css');
    const gap = px(cssValue(css, '.picker', 'gap'));
    const border = px(cssValue(css, '.day', 'border')?.split(' ')[0]);
    const side = px(cssValue(css, '.day::after', 'inset')?.split(' ')[1]);
    // The inset counts from the padding box, i.e. inside the border.
    expect(-side - border).toBe(gap / 2);
    expect(cssValue(css, '.day', 'position')).toBe('relative');
  });
});

describe('Stepper on narrow phones', () => {
  const css = readCss('ui/controls/Stepper.module.css');
  const NARROW = '(max-width: 359px)';
  /** − / value / + : two 44px buttons, two gaps and the value's minimum width. */
  const width = (media: string | null) => {
    const pick = (selector: string, prop: string) =>
      cssValue(css, selector, prop, media) ?? cssValue(css, selector, prop);
    const gap = px(pick('.stepper', 'gap'));
    return 44 + gap + px(pick('.value', 'min-width')) + gap + 44;
  };

  it('keeps the prototype size from 360px', () => {
    expect(width(null)).toBe(196);
    expect(cssValue(css, '.value', 'font-size')).toBe('17px');
  });

  it('fits a «Мої цілі» row at 320px: 246px inside the card − 12px gap − «Цільова» (56px)', () => {
    expect(width(NARROW)).toBeLessThanOrEqual(177);
    // «1 700 ккал» is ~87px at 17px; a smaller value keeps the kcal stepper inside the card too.
    expect(px(cssValue(css, '.value', 'font-size', NARROW))).toBeLessThan(17);
  });
});
