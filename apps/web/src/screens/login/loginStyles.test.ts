import { describe, expect, it } from 'vitest';
import { contrast, cssRules, cssValue, readCss, themeTokens, tokenName } from '@/ui/internal/cssSource';

/**
 * Style contracts of the login, invite and reset screens (one CSS module) that jsdom cannot render;
 * e2e/visual.spec.ts records the screens themselves.
 */
const css = readCss('screens/login/LoginScreen.module.css');
const globalCss = readCss('styles/global.css');

describe('login screen styles', () => {
  it('a focused field has one ring: its border, not the global :focus-visible outline as well', () => {
    // The global rule that would add the second ring…
    expect(cssValue(globalCss, ':focus-visible', 'outline')).toBe('2px solid var(--focus)');
    // …is switched off for the fields (0,2,0 beats the global 0,1,0 whatever order the sheets load in).
    expect(cssValue(css, '.input:focus-visible', 'outline')).toBe('none');
    // What stays: the 2px focus border (1px border + 1px spread).
    expect(cssValue(css, '.input:focus', 'border-color')).toBe('var(--focus)');
    expect(cssValue(css, '.input:focus', 'box-shadow')).toBe('0 0 0 1px var(--focus)');
  });

  it('the unsent-changes notice is neutral, not the mint of «done» states', () => {
    const pending = cssRules(css).filter((r) => r.selector.startsWith('.pending'));
    expect(pending.length).toBeGreaterThan(0);
    for (const rule of pending) {
      for (const value of Object.values(rule.decls)) expect(value).not.toMatch(/--acc2/);
    }
    expect(cssValue(css, '.pending', 'background')).toBe('var(--card)');
    expect(cssValue(css, '.pending', 'border')).toBe('1px solid var(--line)');
    expect(cssValue(css, '.pending', 'color')).toBe('var(--ink2)');
  });

  it.each(['light', 'dark'] as const)('the unsent-changes notice reads well in %s (WCAG AA)', (theme) => {
    const tokens = themeTokens(theme);
    const fg = tokens[tokenName(cssValue(css, '.pending', 'color'))];
    const bg = tokens[tokenName(cssValue(css, '.pending', 'background'))];
    expect(fg && bg).toBeTruthy();
    expect(contrast(fg ?? '', bg ?? '')).toBeGreaterThanOrEqual(4.5);
  });
});
