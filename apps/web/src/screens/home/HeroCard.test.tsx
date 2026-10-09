import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { contrast, cssValue, readCss, themeTokens, tokenName, type Theme } from '@/ui/internal/cssSource';
import { HeroCard } from './HeroCard';
import type { HomeHero } from './homeModel';
import s from './HeroCard.module.css';

const HERO: HomeHero = {
  current: '65,4',
  badge: '−2,9 кг',
  badgeSr: 'Втрачено від старту',
  pct: 35,
  progress: '35%',
  left: '5,4 кг',
  goal: 'Ціль 60,0 кг',
  reached: false,
};

const cls = (name: string | undefined): string => {
  if (!name) throw new Error('missing CSS module class');
  return name;
};

afterEach(cleanup);

describe('HeroCard', () => {
  it('is a region named «Поточна вага» by a visually hidden <h2>', () => {
    render(<HeroCard hero={HERO} />);
    const region = screen.getByRole('region', { name: 'Поточна вага' });
    const heading = within(region).getByRole('heading', { level: 2, name: 'Поточна вага' });
    expect(heading.className).toBe('visually-hidden');
    expect(region.getAttribute('aria-labelledby')).toBe(heading.id);
    // Not interactive.
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
    expect(within(region).queryAllByRole('link')).toHaveLength(0);
  });

  it('shows the weight, the badge with its spoken meaning and one progress line', () => {
    render(<HeroCard hero={HERO} />);
    const region = screen.getByRole('region', { name: 'Поточна вага' });
    const value = within(region).getByText('65,4');
    expect(value.className).toBe(cls(s.value));
    expect(within(region).getByText('кг').className).toBe(cls(s.unit));
    const badge = within(region).getByText('−2,9 кг');
    expect(badge.textContent).toBe('Втрачено від старту: −2,9 кг');
    expect(within(badge).getByText('Втрачено від старту:').className).toBe('visually-hidden');
    expect(region.textContent).toContain('35% шляху');
    expect(region.textContent).toContain('до цілі 5,4 кг');
    expect(within(region).getByText('35%').className).toBe(cls(s.num));
    expect(within(region).getByText('5,4 кг').className).toBe(cls(s.num));
    // The Старт / Ціль scale and the tiles are gone.
    expect(region.textContent).not.toMatch(/Старт|Втрачено2|До цілі/);
  });

  it('the reached goal reads «✓ Ціль досягнута» in --onSolid, never the lavender tone', () => {
    render(<HeroCard hero={{ ...HERO, pct: 100, progress: '100%', left: '0,0 кг', reached: true }} />);
    const reached = screen.getByText('✓ Ціль досягнута');
    expect(reached.className).toBe(cls(s.reached));
    expect(screen.queryByText(/до цілі/)).toBeNull();
    expect(screen.getByRole('region', { name: 'Поточна вага' }).textContent).toContain('100% шляху');
    const css = readCss('screens/home/HeroCard.module.css');
    expect(cssValue(css, '.reached', 'color')).toBe('var(--onSolid)');
    expect(cssValue(css, '.reached', 'font-size')).toBe('15px');
    expect(cssValue(css, '.reached', 'font-weight')).toBe('700');
  });

  it('before the first weigh-in shows the goal instead of the progress line, and no badge', () => {
    render(<HeroCard hero={{ ...HERO, current: '—', badge: null, pct: 0, progress: '', left: '— кг' }} />);
    const region = screen.getByRole('region', { name: 'Поточна вага' });
    const dash = within(region).getByText('—');
    // The lone dash: muted, and no «кг» hanging below it.
    expect(dash.classList.contains(cls(s.value))).toBe(true);
    expect(dash.classList.contains(cls(s.none))).toBe(true);
    expect(within(region).queryByText('кг')).toBeNull();
    expect(region.querySelector(`.${cls(s.unit)}`)).toBeNull();
    expect(within(region).getByText('Ціль 60,0 кг')).toBeTruthy();
    expect(region.textContent).not.toContain('шляху');
    expect(region.textContent).not.toContain('до цілі');
    expect(region.textContent).not.toContain('від старту');
  });

  it('merges the class name', () => {
    render(<HeroCard hero={HERO} className="extra" />);
    const region = screen.getByRole('region', { name: 'Поточна вага' });
    expect(region.classList.contains('extra')).toBe(true);
    expect(region.classList.contains(cls(s.hero))).toBe(true);
  });
});

describe('HeroCard styles', () => {
  const css = readCss('screens/home/HeroCard.module.css');
  const THEMES: Theme[] = ['light', 'dark'];

  const onHero = (theme: Theme, selector: string): number => {
    const t = themeTokens(theme);
    const fg = t[tokenName(cssValue(css, selector, 'color'))];
    const bg = t.solid;
    if (fg === undefined || bg === undefined) throw new Error(`unknown token for ${selector}`);
    return contrast(fg, bg);
  };

  it('is compact: padding 16px 20px, gap 14, the 58px value', () => {
    expect(cssValue(css, '.hero.hero', 'padding')).toBe('16px 20px');
    expect(cssValue(css, '.hero.hero', 'gap')).toBe('14px');
    expect(cssValue(css, '.value', 'font-size')).toBe('58px');
    expect(cssValue(css, '.num', 'font-size')).toBe('15px');
    expect(cssValue(css, '.line', 'font-size')).toBe('13px');
  });

  it('mutes the lone «—» with --onSolidMuted (the hero is --solid in both themes)', () => {
    expect(cssValue(css, '.none', 'color')).toBe('var(--onSolidMuted)');
  });

  it.each(THEMES)('numbers, words and «Ціль досягнута» are ≥ 4.5:1 on the hero (%s)', (theme) => {
    for (const selector of ['.num', '.reached', '.line', '.unit', '.none']) {
      expect(onHero(theme, selector), selector).toBeGreaterThanOrEqual(4.5);
    }
  });
});
