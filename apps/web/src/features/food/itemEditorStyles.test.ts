import { describe, expect, it } from 'vitest';
import { cssValue, px, readCss } from '@/ui/internal/cssSource';

/**
 * Style contracts of the item editor that jsdom cannot render (e2e/a11y.spec.ts measures the real
 * hit areas, e2e/visual.spec.ts the layout).
 */
const css = readCss('features/food/ItemEditor.module.css');

/** `inset: top right bottom left` shorthand (1–4 values) as numbers. */
function insets(value: string | undefined): [number, number, number, number] {
  const v = (value ?? '').split(' ').map((p) => px(p));
  const [top = 0, right = top, bottom = top, left = right] = v;
  return [top, right, bottom, left];
}

describe('item editor styles', () => {
  it('every chip is at least 44px wide, the one-letter «г» too', () => {
    expect(px(cssValue(css, '.chip', 'min-width'))).toBeGreaterThanOrEqual(44);
    expect(cssValue(css, '.chip', 'justify-content')).toBe('center');
  });

  it('unit chips are one row that scrolls sideways (with room for the focus ring)', () => {
    expect(cssValue(css, '.units', 'flex-wrap')).toBe('nowrap');
    expect(cssValue(css, '.unitsScroll', 'overflow-x')).toBe('auto');
    // 2px ring + 2px offset must not be clipped by the scrolling row.
    expect(cssValue(css, '.unitsScroll', 'padding')).toBe('4px 18px');
    expect(cssValue(css, '.unitsScroll', 'margin')).toBe('-4px -18px');
  });

  it('«Порція текстом» on the label line: a 44px tap area that stays out of the − / + row', () => {
    const line = px(cssValue(css, '.modeLink', 'line-height'));
    expect(px(cssValue(css, '.label', 'line-height'))).toBe(line);
    const [top, right, bottom, left] = insets(cssValue(css, '.modeLink::after', 'inset'));
    expect(line - top - bottom).toBeGreaterThanOrEqual(44);
    expect(-left - right).toBeGreaterThanOrEqual(20);
    // Down no further than the block's gap; up no further than the 18px between blocks.
    expect(-bottom).toBeLessThanOrEqual(px(cssValue(css, '.howMuch', 'gap')));
    expect(-top).toBeLessThan(px(cssValue(css, '.fields', 'gap')));
  });

  it('a suggestion chip spaces «name · kcal» with a gap (a leading space would be trimmed)', () => {
    expect(cssValue(css, '.suggestion', 'gap')).toBe('0.3em');
    expect(cssValue(css, '.suggestionName', 'text-overflow')).toBe('ellipsis');
    expect(cssValue(css, '.suggestionKcal', 'flex')).toBe('none');
  });

  it('«Видалити позицію» stands apart: a divider and 24px+ from «Вписати вручну»', () => {
    expect(cssValue(css, '.danger', 'border-top')).toBe('1px solid var(--line)');
    const apart =
      px(cssValue(css, '.fields', 'gap')) +
      px(cssValue(css, '.danger', 'margin-top')) +
      px(cssValue(css, '.danger', 'padding-top'));
    expect(apart).toBeGreaterThanOrEqual(24);
    expect(cssValue(css, '.remove', 'color')).toBe('var(--accD)');
  });

  it('the footer pairs «✨ Перерахувати» with «Готово» at the same 56px height', () => {
    expect(cssValue(css, '.footer', 'display')).toBe('flex');
    expect(cssValue(css, '.pair > *', 'flex')).toBe('1 1 0');
    expect(px(cssValue(css, '.recalc', 'min-height'))).toBe(56);
  });
});
