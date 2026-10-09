import { describe, expect, it } from 'vitest';
import { contrast, cssValue, readCss, themeBlocks, themeTokens, type Theme } from '@/ui/internal/cssSource';

const THEMES: Theme[] = ['light', 'dark'];

/** Resolved colour of a token in a theme (fails loudly when the token is missing). */
function color(theme: Theme, name: string): string {
  const value = themeTokens(theme)[name];
  if (value === undefined) throw new Error(`--${name} is not defined in the ${theme} theme`);
  return value;
}

describe('design tokens', () => {
  it('the system dark theme and the forced dark theme define the same values', () => {
    const { darkAuto, dark } = themeBlocks();
    expect(Object.keys(dark).length).toBeGreaterThan(20);
    expect(darkAuto).toEqual(dark);
  });

  it('has left/right safe areas next to top/bottom (notched iPhone in landscape)', () => {
    const { light } = themeBlocks();
    expect(light['safe-left']).toBe('env(safe-area-inset-left, 0px)');
    expect(light['safe-right']).toBe('env(safe-area-inset-right, 0px)');
  });
});

describe('focus ring', () => {
  it.each(THEMES)('--focus is at least 3:1 on every surface it is drawn on (%s)', (theme) => {
    for (const surface of ['paper', 'card', 'line', 'accT']) {
      expect(contrast(color(theme, 'focus'), color(theme, surface)), surface).toBeGreaterThanOrEqual(3);
    }
    expect(contrast(color(theme, 'focusOnSolid'), color(theme, 'solid'))).toBeGreaterThanOrEqual(3);
  });

  it('replaces the light --acc ring, which is too pale on paper and card', () => {
    expect(contrast(color('light', 'acc'), color('light', 'paper'))).toBeLessThan(3);
    expect(color('light', 'focus')).toBe(color('light', 'accD'));
    expect(color('dark', 'focus')).toBe(color('dark', 'acc'));
  });

  it('is what the global :focus-visible outline uses', () => {
    const css = readCss('styles/global.css');
    expect(cssValue(css, ':focus-visible', 'outline')).toBe('2px solid var(--focus)');
  });
});
