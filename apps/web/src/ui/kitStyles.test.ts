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

// ---- Redesign A kit: lists, back link, compact banner, inline toggle, stat strip --------------------------------

const NARROW = '(max-width: 359px)';
const ROW = 'ui/lists/ListRow.module.css';

describe('ListRow', () => {
  const css = readCss(ROW);

  it('rows are at least 56px (md 60) and the lg menu rows at least 72px', () => {
    expect(px(cssValue(css, '.action', 'min-height'))).toBeGreaterThanOrEqual(56);
    expect(px(cssValue(css, '.action', 'min-height'))).toBe(60);
    expect(px(cssValue(css, '.lg .action', 'min-height'))).toBeGreaterThanOrEqual(72);
  });

  it('has no column gap: spacing comes from margins on the parts that exist (no gaps next to empty tracks)', () => {
    expect(cssValue(css, '.action', 'column-gap')).toBe('0');
    expect(cssValue(css, '.icon', 'margin-right')).toBe('14px');
    expect(cssValue(css, '.value', 'margin-left')).toBe('12px');
    expect(cssValue(css, '.chevron', 'margin-left')).toBe('8px');
    expect(cssValue(css, '.action', 'grid-template-columns')).toMatch(/^auto minmax\(0, 1fr\) /);
  });

  it('starts the divider where the title starts', () => {
    const padLeft = (media: string | null, selector = '.action') =>
      px(cssValue(css, selector, 'padding-left', media) ?? cssValue(css, selector, 'padding')?.split(' ')[1]);
    const iconBox = (selector: string, media: string | null = null) =>
      px(cssValue(css, selector, 'width', media)) +
      px(cssValue(css, selector, 'margin-right', media) ?? '14px');
    const inset = (selector: string, media: string | null = null) =>
      px(cssValue(css, selector, '--inset', media));

    expect(inset('.item')).toBe(padLeft(null));
    expect(inset('.withIcon')).toBe(padLeft(null) + iconBox('.icon'));
    expect(inset('.lg.withIcon')).toBe(padLeft(null, '.lg .action') + iconBox('.lg .icon'));
    // 320px Display Zoom: padding 12, 36px icon, margin 12.
    expect(inset('.item', NARROW)).toBe(padLeft(NARROW));
    expect(inset('.md.withIcon', NARROW)).toBe(60);
    expect(inset('.md.withIcon', NARROW)).toBe(padLeft(NARROW) + iconBox('.md .icon', NARROW));
    expect(inset('.lg.withIcon', NARROW)).toBe(padLeft(NARROW, '.lg .action') + iconBox('.lg .icon'));
  });

  it('draws an inset focus ring that the group clip never cuts', () => {
    expect(cssValue(css, '.action:focus-visible', 'outline')).toBe('2px solid var(--focus)');
    expect(px(cssValue(css, '.action:focus-visible', 'outline-offset'))).toBeLessThan(0);
  });

  it.each(THEMES)('sub, soft value and the selected row stay at least 4.5:1 (%s)', (theme) => {
    const card = 'var(--card)';
    expect(tokenContrast(theme, cssValue(css, '.sub', 'color'), card)).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, cssValue(css, '.soft', 'color'), card)).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, cssValue(css, '.strong', 'color'), card)).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, cssValue(css, '.accent', 'color'), card)).toBeGreaterThanOrEqual(4.5);
    expect(
      tokenContrast(
        theme,
        cssValue(css, '.action[aria-current] .title', 'color'),
        cssValue(css, '.action[aria-current]', 'background'),
      ),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it('a wrapping sub top-aligns the icon beside the title; value and chevron keep the centred alignment', () => {
    expect(cssValue(css, '.top .icon', 'align-self')).toBe('start');
    expect(cssValue(css, '.action', 'align-items')).toBe('center');
    expect(cssValue(css, '.icon', 'align-self')).toBeUndefined();
    expect(cssValue(css, '.chevron', 'align-self')).toBeUndefined();
    expect(cssValue(css, '.value', 'align-self')).toBeUndefined();
    expect(cssValue(css, '.top .chevron', 'align-self')).toBeUndefined();
    // A class, not `:has()` (iOS < 15.4 and jsdom).
    expect(css).not.toContain(':has(');
  });

  it.each(THEMES)('the icon square stays visible on the selected row (%s)', (theme) => {
    const rowBg = cssValue(css, '.action[aria-current]', 'background');
    const squareBg = cssValue(css, '.action[aria-current] .icon', 'background');
    expect(squareBg).toBe('var(--card)');
    expect(tokenContrast(theme, squareBg, rowBg)).toBeGreaterThan(1.1);
    for (const tone of ['.acc', '.acc2', '.neutral']) {
      expect(tokenContrast(theme, cssValue(css, tone, 'color'), squareBg), tone).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(THEMES)('icon glyphs stand out from their tinted squares, at least 3:1 (%s)', (theme) => {
    for (const tone of ['.acc', '.acc2', '.neutral']) {
      expect(
        tokenContrast(theme, cssValue(css, tone, 'color'), cssValue(css, tone, 'background')),
        tone,
      ).toBeGreaterThanOrEqual(3);
    }
  });
});

describe('Redesign A tap targets are at least 44px', () => {
  it('ScreenHeader back link', () => {
    expect(
      px(cssValue(readCss('ui/layout/ScreenHeader.module.css'), '.back', 'min-height')),
    ).toBeGreaterThanOrEqual(44);
  });

  it('Banner ✕: a 32px glyph grown by 6px on every side', () => {
    const file = 'ui/feedback/Banner.module.css';
    const css = readCss(file);
    expect(cssValue(css, '.close::after', 'inset')).toBe('-6px');
    expect(hitHeight(file, '.close', 'height')).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(css, '.close', 'width')) + 2 * 6).toBeGreaterThanOrEqual(44);
  });

  it('ghost Button: the 35px text button reaches 44 (35 + 2 × 5)', () => {
    const css = readCss('ui/controls/Button.module.css');
    // padding 8px 0 around one 14px line (Manrope «normal» line-height ≈ 1.37 → 19px).
    const box = 2 * px(cssValue(css, '.ghost', 'padding')?.split(' ')[0]) + 19;
    expect(box).toBe(35);
    expect(cssValue(css, '.ghost', 'position')).toBe('relative');
    expect(cssValue(css, '.ghost::after', 'position')).toBe('absolute');
    const top = px(cssValue(css, '.ghost::after', 'inset')?.split(' ')[0]);
    expect(box - 2 * top).toBeGreaterThanOrEqual(44);
  });

  it('TrainingToggle sm: each option is 44×44, gap 6', () => {
    const css = readCss('ui/controls/TrainingToggle.module.css');
    expect(cssValue(css, '.sm .option', 'width')).toBe('44px');
    expect(cssValue(css, '.sm .option', 'height')).toBe('44px');
    expect(cssValue(css, '.sm', 'grid-template-columns')).toBe('44px 44px');
    expect(cssValue(css, '.sm', 'gap')).toBe('6px');
  });
});

describe('Redesign A text contrast is at least 4.5:1', () => {
  it.each(THEMES)('ScreenHeader back link on the page (%s)', (theme) => {
    const css = readCss('ui/layout/ScreenHeader.module.css');
    expect(tokenContrast(theme, cssValue(css, '.back', 'color'), 'var(--paper)')).toBeGreaterThanOrEqual(4.5);
    // Pressed state.
    expect(
      tokenContrast(theme, cssValue(css, '.back', 'color'), cssValue(css, '.back:active', 'background')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('StatStrip labels and units on cards and on the tint summary (%s)', (theme) => {
    const css = readCss('ui/tiles/StatStrip.module.css');
    for (const bg of ['var(--card)', 'var(--accT)']) {
      expect(tokenContrast(theme, cssValue(css, '.label', 'color'), bg)).toBeGreaterThanOrEqual(4.5);
      expect(tokenContrast(theme, cssValue(css, '.unit', 'color'), bg)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(THEMES)('TrainingToggle sm: the pressed ✓ glyph on its tint (%s)', (theme) => {
    const css = readCss('ui/controls/TrainingToggle.module.css');
    expect(
      tokenContrast(theme, cssValue(css, '.sm .yes', 'color'), cssValue(css, '.yes', 'background')),
    ).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('compact Banner sub and ✕ on the tint (%s)', (theme) => {
    const css = readCss('ui/feedback/Banner.module.css');
    const bg = cssValue(css, '.banner', 'background');
    expect(tokenContrast(theme, cssValue(css, '.sub', 'color'), bg)).toBeGreaterThanOrEqual(4.5);
    expect(tokenContrast(theme, cssValue(css, '.close', 'color'), bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)('ListGroup caption, subtitle and note on the page / card (%s)', (theme) => {
    const css = readCss('ui/lists/ListGroup.module.css');
    expect(tokenContrast(theme, cssValue(css, '.caption', 'color'), 'var(--paper)')).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(tokenContrast(theme, cssValue(css, '.note', 'color'), 'var(--paper)')).toBeGreaterThanOrEqual(4.5);
    expect(
      tokenContrast(theme, cssValue(css, '.subtitle', 'color'), cssValue(css, '.card', 'background')),
    ).toBeGreaterThanOrEqual(4.5);
  });
});

describe('compact Banner never cuts the setup sub', () => {
  const css = readCss('ui/feedback/Banner.module.css');

  it('clamps the title to 2 lines and the sub to 3 (the setup sub needs 3 lines beside «Налаштувати» at 390px)', () => {
    expect(cssValue(css, '.compact .title', '-webkit-line-clamp')).toBe('2');
    expect(cssValue(css, '.compact .title', 'line-clamp')).toBe('2');
    expect(cssValue(css, '.compact .sub', '-webkit-line-clamp')).toBe('3');
    expect(cssValue(css, '.compact .sub', 'line-clamp')).toBe('3');
    expect(cssValue(css, '.compact .sub', 'display')).toBe('-webkit-box');
    expect(cssValue(css, '.compact .sub', '-webkit-box-orient')).toBe('vertical');
    expect(cssValue(css, '.compact .sub', 'line-height')).toBe('1.35');
    expect(cssValue(css, '.compact .sub', 'text-overflow')).toBeUndefined();
    expect(cssValue(css, '.compact .sub', 'white-space')).toBeUndefined();
  });

  it('drops the sub clamp below 360px (Display Zoom: a ~120px column needs 4–5 lines)', () => {
    expect(cssValue(css, '.compact .sub', '-webkit-line-clamp', NARROW)).toBe('none');
    expect(cssValue(css, '.compact .sub', 'line-clamp', NARROW)).toBe('none');
    expect(cssValue(css, '.compact .sub', 'display', NARROW)).toBe('block');
    expect(cssValue(css, '.compact .sub', 'overflow', NARROW)).toBe('visible');
  });
});

describe('ProgressBar', () => {
  it('lays its spans out as blocks (phrasing content that still takes a height)', () => {
    const css = readCss('ui/feedback/ProgressBar.module.css');
    expect(cssValue(css, '.track', 'display')).toBe('block');
    expect(cssValue(css, '.fill', 'display')).toBe('block');
    expect(cssValue(css, '.fill', 'height')).toBe('100%');
    expect(cssValue(css, '.sm', 'height')).toBe('6px');
  });
});

describe('StatStrip desktop columns', () => {
  it('use the literal DESKTOP_QUERY', () => {
    const css = readCss('ui/tiles/StatStrip.module.css');
    const desktop = '(min-width: 900px) and (hover: hover) and (pointer: fine)';
    expect(cssValue(css, '.d4', 'grid-template-columns', desktop)).toBe('repeat(4, minmax(0, 1fr))');
    expect(cssValue(css, '.c2', 'grid-template-columns')).toBe('repeat(2, minmax(0, 1fr))');
  });
});
