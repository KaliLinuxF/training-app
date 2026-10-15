import { describe, expect, it } from 'vitest';
import { cssValue, readCss } from '@/ui/internal/cssSource';

/**
 * Style contract jsdom cannot render: where the day card stops after a cell tap. (The e2e suite checks the real
 * scroll: e2e/calendar.spec.ts «installed iPhone: a tapped day scrolls into view above the tab bar».)
 */

const DESKTOP = '(min-width: 900px) and (hover: hover) and (pointer: fine)';

describe('DayCard reveal', () => {
  const card = readCss('screens/calendar/DayCard.module.css');
  const shell = readCss('shell/AppShell.module.css');

  it('leaves the safe area and the tab bar to the phone shell scroll-padding (margins add to it)', () => {
    const html = ":global(html[data-shell='phone'])";
    expect(cssValue(shell, html, 'scroll-padding-top')).toBe('var(--safe-top)');
    expect(cssValue(shell, html, 'scroll-padding-bottom')).toBe('calc(96px + var(--safe-bottom))');
    // Only the 12px breathing room on top; no second safe-area or tab-bar allowance.
    expect(cssValue(card, '.root', 'scroll-margin-top')).toBe('12px');
    expect(cssValue(card, '.root', 'scroll-margin-bottom')).toBe('0');
  });

  it('keeps a 24px margin in the desktop shell, which has no html scroll-padding', () => {
    expect(cssValue(card, '.root', 'scroll-margin', DESKTOP)).toBe('24px');
  });
});

describe('Їжа lines of a day with meals', () => {
  const card = readCss('screens/calendar/DayCard.module.css');

  it('each meal is one block line that never wraps and ends in «…» (no wrapped line at 390 / 320px)', () => {
    expect(cssValue(card, '.line', 'display')).toBe('block');
    expect(cssValue(card, '.line', 'min-width')).toBe('0');
    expect(cssValue(card, '.line', 'white-space')).toBe('nowrap');
    expect(cssValue(card, '.line', 'overflow')).toBe('hidden');
    expect(cssValue(card, '.line', 'text-overflow')).toBe('ellipsis');
  });
});
