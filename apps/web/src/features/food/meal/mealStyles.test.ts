import { describe, expect, it } from 'vitest';
import { cssValue, px, readCss } from '@/ui/internal/cssSource';

/**
 * Style contracts of the meal editor that jsdom cannot render (e2e/a11y.spec.ts measures the real hit
 * areas, e2e/visual.spec.ts the layout): docs/meals-macros.md §7.3, §7.12.
 */
const body = readCss('features/food/meal/MealEditorBody.module.css');
const assist = readCss('features/food/FoodAssist.module.css');
const editor = readCss('features/food/ItemEditor.module.css');
const POINTER = '(hover: hover) and (pointer: fine)';

describe('meal editor styles', () => {
  it('the type chips are ONE row that scrolls sideways on touch, from the sheet edge, room for the focus ring', () => {
    expect(cssValue(body, '.chips', 'flex-wrap')).toBe('nowrap');
    expect(cssValue(body, '.chip', 'flex')).toBe('none');
    expect(cssValue(body, '.chipsScroll', 'overflow-x')).toBe('auto');
    expect(cssValue(body, '.chipsScroll', 'scrollbar-width')).toBe('none');
    expect(cssValue(body, '.chipsScroll::-webkit-scrollbar', 'display')).toBe('none');
    // The sheet body's 18px left padding moves inside the row; 4px keep the 2px ring + 2px offset.
    expect(cssValue(body, '.chipsScroll', 'margin')).toBe('-4px 0 -4px -18px');
    expect(cssValue(body, '.chipsScroll', 'padding')).toBe('4px 20px 4px 18px');
  });

  it('«+ Свій» sits after the scrolling chips, never inside them: on screen at any width (one line kept)', () => {
    expect(cssValue(body, '.typeRow', 'display')).toBe('flex');
    expect(cssValue(body, '.typeRow', 'flex-wrap')).toBeUndefined();
    // The chips take what is left and scroll inside it; the button keeps its size.
    expect(cssValue(body, '.chipsScroll', 'flex')).toBe('1 1 auto');
    expect(cssValue(body, '.chipsScroll', 'min-width')).toBe('0');
    expect(cssValue(body, '.addType', 'flex')).toBe('none');
    expect(cssValue(body, '.addType', 'white-space')).toBe('nowrap');
  });

  it('the row fades at its edges over the paddings only, and a fling stops at a chip’s start', () => {
    const mask = cssValue(body, '.chipsScroll', 'mask-image') ?? '';
    const stops =
      /^linear-gradient\( ?to right, transparent, var\(--ink\) (\d+)px, var\(--ink\) calc\(100% - (\d+)px\), transparent ?\)$/.exec(
        mask,
      );
    expect(stops, mask).not.toBeNull();
    const [, fadeLeft, fadeRight] = stops ?? [];
    // A chip at rest starts after the left padding and ends before the right one, ring (4px) included.
    expect(Number(fadeLeft)).toBeLessThanOrEqual(18 - 4);
    expect(Number(fadeRight)).toBeLessThanOrEqual(20 - 4);
    expect(cssValue(body, '.chipsScroll', 'scroll-snap-type')).toBe('x proximity');
    expect(cssValue(body, '.chipsScroll', 'scroll-padding-inline')).toBe('18px 20px');
    expect(cssValue(body, '.chip', 'scroll-snap-align')).toBe('start');
  });

  it('with a mouse the chips wrap (a hidden scrollbar cannot be scrolled with a wheel), unfaded', () => {
    expect(cssValue(body, '.chips', 'flex-wrap', POINTER)).toBe('wrap');
    expect(cssValue(body, '.chipsScroll', 'overflow-x', POINTER)).toBe('visible');
    expect(cssValue(body, '.chipsScroll', 'mask-image', POINTER)).toBe('none');
    expect(cssValue(body, '.typeRow', 'align-items', POINTER)).toBe('flex-start');
  });

  it('«Видалити прийом» looks like «Видалити позицію»: a divider, an outline button in --accD', () => {
    for (const prop of ['border-top', 'margin-top', 'padding-top']) {
      expect(cssValue(body, '.danger', prop), prop).toBe(cssValue(editor, '.danger', prop));
    }
    expect(cssValue(body, '.danger', 'border-top')).toBe('1px solid var(--line)');
    expect(cssValue(body, '.remove', 'color')).toBe('var(--accD)');
    expect(cssValue(body, '.delete', 'color')).toBeUndefined();
  });

  it('«Видалити фото» on a photo is a 44px tap area (measured from the badge’s padding box)', () => {
    const strip = readCss('features/food/PhotoStrip.module.css');
    const badge = px(cssValue(strip, '.remove', 'width'));
    expect(px(cssValue(strip, '.remove', 'height'))).toBe(badge);
    const border = px((cssValue(strip, '.remove', 'border') ?? '').split(' ')[0]);
    const inset = px(cssValue(strip, '.remove::after', 'inset'));
    expect(badge - 2 * border - 2 * inset).toBeGreaterThanOrEqual(44);
  });

  it('the top block is packed at 12px so «Що я їла» stays above the iPhone keyboard', () => {
    expect(px(cssValue(body, '.top', 'gap'))).toBe(12);
    expect(px(cssValue(assist, '.action', 'min-height'))).toBe(44);
  });

  it('every field is 16px or larger (iOS zooms smaller ones)', () => {
    for (const [css, selector] of [
      [body, '.kcalInput'],
      [body, '.macroInput'],
      [body, '.typeInput'],
      [assist, '.composerInput'],
      [editor, '.macroInput'],
    ] as const) {
      expect(px(cssValue(css, selector, 'font-size')), selector).toBeGreaterThanOrEqual(16);
    }
  });

  it('every target is 44px or more', () => {
    expect(px(cssValue(body, '.addType', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(body, '.typeConfirm', 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(body, '.typeConfirm', 'width'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(body, '.clearTime', 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(body, '.typeInput', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(body, '.macroInput', 'height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(editor, '.macroInput', 'min-height'))).toBeGreaterThanOrEqual(44);
  });

  it('«Ще не пораховано» is one line; locked AI buttons keep the kit’s disabled look', () => {
    expect(cssValue(body, '.tail', 'white-space')).toBe('nowrap');
    expect(cssValue(body, '.tail', 'text-overflow')).toBe('ellipsis');
    expect(cssValue(assist, ".action[aria-disabled='true']", 'opacity')).toBe('0.45');
  });

  it('colours come from the tokens only', () => {
    for (const css of [body, assist, editor, readCss('features/food/meal/MealSheet.module.css')]) {
      expect(css).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|oklch\(/i);
    }
  });
});
