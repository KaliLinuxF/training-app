import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cssValue, px, readCss } from '@/ui/internal/cssSource';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { NAV_ITEMS, NAV_SPLIT, isNavActive, isNavRoot } from './nav';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';

const TAB_NAMES = ['Головна', 'Календар', 'Записати день', 'Прогрес', 'Налаштування'];
const SMALL = '(max-width: 359px)';

beforeEach(() => {
  installMatchMedia(() => false);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

describe('nav', () => {
  it('lists the four sections with their icons; «+» sits after the first two', () => {
    expect(NAV_ITEMS).toEqual([
      { href: '/', label: 'Головна', icon: 'home' },
      { href: '/calendar', label: 'Календар', icon: 'calendar' },
      { href: '/progress', label: 'Прогрес', icon: 'chart' },
      { href: '/settings', label: 'Налаштування', icon: 'gear' },
    ]);
    expect(NAV_SPLIT).toBe(2);
  });

  it('isNavActive matches a section and its sub-pages by pathname', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/', '')).toBe(true);
    expect(isNavActive('/', '/calendar')).toBe(false);
    expect(isNavActive('/calendar', '/calendar')).toBe(true);
    expect(isNavActive('/calendar', '/calendar/x')).toBe(true);
    expect(isNavActive('/calendar', '/calendarx')).toBe(false);
    expect(isNavActive('/progress', '/')).toBe(false);
    expect(isNavActive('/settings', '/settings')).toBe(true);
    expect(isNavActive('/settings', '/settings/goals')).toBe(true);
    expect(isNavActive('/settings', '/settingsx')).toBe(false);
  });

  it('isNavRoot is an exact match («/» also matches the empty location)', () => {
    expect(isNavRoot('/', '/')).toBe(true);
    expect(isNavRoot('/', '')).toBe(true);
    expect(isNavRoot('/', '/calendar')).toBe(false);
    expect(isNavRoot('/settings', '/settings')).toBe(true);
    expect(isNavRoot('/settings', '/settings/goals')).toBe(false);
    expect(isNavRoot('/settings', '/settingsx')).toBe(false);
    expect(isNavRoot('/progress', '/settings')).toBe(false);
  });
});

function inRouter(path: string, ui: ReactNode) {
  const memory = memoryLocation({ path, record: true });
  const view = render(<Router hook={memory.hook}>{ui}</Router>);
  return { memory, view };
}

const link = (name: string) => screen.getByRole('link', { name });

describe('TabBar', () => {
  it('renders Головна, Календар, «+», Прогрес, Налаштування in that order, each tab with its icon', () => {
    inRouter('/progress', <TabBar location="/progress" onRecord={() => undefined} />);
    const nav = screen.getByRole('navigation', { name: 'Основна навігація' });
    const items = Array.from(nav.querySelectorAll('a, button')).map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    );
    expect(items).toEqual(TAB_NAMES);
    for (const tab of within(nav).getAllByRole('link')) {
      const icon = tab.querySelector('svg');
      expect(icon?.closest('[aria-hidden="true"]')).toBeTruthy();
    }
    expect(link('Налаштування').getAttribute('href')).toBe('/settings');
  });

  it('marks the current section: «page» at its root, «true» on a sub-page', () => {
    inRouter('/progress', <TabBar location="/progress" onRecord={() => undefined} />);
    expect(link('Прогрес').getAttribute('aria-current')).toBe('page');
    expect(link('Головна').getAttribute('aria-current')).toBeNull();
    cleanup();

    inRouter('/settings', <TabBar location="/settings" onRecord={() => undefined} />);
    expect(link('Налаштування').getAttribute('aria-current')).toBe('page');
    cleanup();

    inRouter('/settings/goals', <TabBar location="/settings/goals" onRecord={() => undefined} />);
    expect(link('Налаштування').getAttribute('aria-current')).toBe('true');
    for (const name of ['Головна', 'Календар', 'Прогрес'])
      expect(link(name).getAttribute('aria-current')).toBeNull();
  });

  it('«+» opens the record menu and says so with aria-haspopup / aria-expanded', () => {
    const onRecord = vi.fn();
    const { view } = inRouter('/', <TabBar location="/" onRecord={onRecord} />);
    const plus = screen.getByRole('button', { name: 'Записати день' });
    expect(plus.getAttribute('aria-haspopup')).toBe('dialog');
    expect(plus.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(plus);
    expect(onRecord).toHaveBeenCalledOnce();

    view.rerender(<TabBar location="/" onRecord={onRecord} recordOpen />);
    expect(screen.getByRole('button', { name: 'Записати день' }).getAttribute('aria-expanded')).toBe('true');
    view.rerender(<TabBar location="/" onRecord={onRecord} recordOpen={false} />);
    expect(screen.getByRole('button', { name: 'Записати день' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('navigates to another section, and scrolls up instead when the current root is tapped', () => {
    const scrollTo = stubScrollTo();
    const { memory } = inRouter('/', <TabBar location="/" onRecord={() => undefined} />);
    fireEvent.click(link('Головна'));
    expect(memory.history).toEqual(['/']);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'smooth' });
    fireEvent.click(link('Календар'));
    expect(memory.history).toEqual(['/', '/calendar']);
    expect(scrollTo).toHaveBeenCalledOnce();
  });

  it('at /settings the active tab scrolls to the top without navigating', () => {
    const scrollTo = stubScrollTo();
    const { memory } = inRouter('/settings', <TabBar location="/settings" onRecord={() => undefined} />);
    fireEvent.click(link('Налаштування'));
    expect(memory.history).toEqual(['/settings']);
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'smooth' });
  });

  it('scrolls without the smooth animation when reduced motion is on', () => {
    installMatchMedia((query) => query === '(prefers-reduced-motion: reduce)');
    const scrollTo = stubScrollTo();
    inRouter('/progress', <TabBar location="/progress" onRecord={() => undefined} />);
    fireEvent.click(link('Прогрес'));
    expect(scrollTo).toHaveBeenCalledExactlyOnceWith({ top: 0, behavior: 'auto' });
  });

  it('on /settings/goals (deep link) the active tab replace-navigates to /settings', () => {
    const scrollTo = stubScrollTo();
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { memory } = inRouter(
      '/settings/goals',
      <TabBar location="/settings/goals" onRecord={() => undefined} />,
    );
    fireEvent.click(link('Налаштування'));
    expect(memory.history).toEqual(['/settings']);
    expect(back).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('on a sub-page opened from the list the active tab pops back (history.back, no new entry)', () => {
    window.history.replaceState({ legkoFrom: '/settings' }, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { memory } = inRouter(
      '/settings/goals',
      <TabBar location="/settings/goals" onRecord={() => undefined} />,
    );
    fireEvent.click(link('Налаштування'));
    expect(back).toHaveBeenCalledOnce();
    expect(memory.history).toEqual(['/settings/goals']);
  });
});

describe('Sidebar', () => {
  it('shows the logo, the links and «+ Записати день» (a menu opener)', () => {
    const onRecord = vi.fn();
    const { view } = inRouter('/', <Sidebar location="/" onRecord={onRecord} />);
    expect(screen.getByText('Легко')).toBeTruthy();
    const nav = screen.getByRole('navigation', { name: 'Основна навігація' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((a) => a.textContent),
    ).toEqual(NAV_ITEMS.map((item) => item.label));
    expect(link('Головна').getAttribute('aria-current')).toBe('page');

    const record = screen.getByRole('button', { name: '+ Записати день' });
    expect(record.getAttribute('aria-haspopup')).toBe('dialog');
    expect(record.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(record);
    expect(onRecord).toHaveBeenCalledOnce();
    view.rerender(<Sidebar location="/" onRecord={onRecord} recordOpen />);
    expect(screen.getByRole('button', { name: '+ Записати день' }).getAttribute('aria-expanded')).toBe(
      'true',
    );
  });

  it('marks «Налаштування» on /settings/data, and tapping it goes back to the list', () => {
    const { memory } = inRouter(
      '/settings/data',
      <Sidebar location="/settings/data" onRecord={() => undefined} />,
    );
    expect(link('Налаштування').getAttribute('aria-current')).toBe('true');
    for (const name of ['Головна', 'Календар', 'Прогрес'])
      expect(link(name).getAttribute('aria-current')).toBeNull();
    fireEvent.click(link('Налаштування'));
    expect(memory.history).toEqual(['/settings']);
  });
});

describe('tab bar layout (CSS contract)', () => {
  const bar = readCss('shell/TabBar.module.css');

  it('is a three-part grid: two flexible groups around a fixed centre for «+»', () => {
    expect(cssValue(bar, '.inner', 'display')).toBe('grid');
    expect(cssValue(bar, '.inner', 'grid-template-columns')).toBe('minmax(0, 1fr) 64px minmax(0, 1fr)');
    expect(cssValue(bar, '.inner', 'padding')).toBe('8px 6px');
    expect(cssValue(bar, '.group', 'display')).toBe('flex');
    expect(cssValue(bar, '.group', 'min-width')).toBe('0');
    expect(cssValue(bar, '.group > .item', 'flex')).toBe('1 1 0');
    expect(cssValue(bar, '.group > .item', 'min-width')).toBe('max-content');
    expect(cssValue(bar, '.record', 'justify-self')).toBe('center');
    expect(cssValue(bar, '.record', 'width')).toBe('64px');
  });

  it('keeps tap targets ≥ 44px, 11/600 one-line labels and no iOS link preview', () => {
    expect(px(cssValue(bar, '.item', 'min-height'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(bar, '.plus', 'width'))).toBeGreaterThanOrEqual(44);
    expect(px(cssValue(bar, '.plus', 'height'))).toBeGreaterThanOrEqual(44);
    expect(cssValue(bar, '.item', '-webkit-touch-callout')).toBe('none');
    expect(cssValue(bar, '.label', 'font-size')).toBe('11px');
    expect(cssValue(bar, '.label', 'font-weight')).toBe('600');
    expect(cssValue(bar, '.label', 'white-space')).toBe('nowrap');
    expect(cssValue(bar, '.icon', 'width')).toBe('46px');
  });

  it('compacts below 360px: bar padding 8, centre 60, labels 10px −0.01em, icon pill 40', () => {
    expect(cssValue(bar, '.bar', 'padding-inline', SMALL)).toBe('8px');
    expect(cssValue(bar, '.inner', 'grid-template-columns', SMALL)).toBe(
      'minmax(0, 1fr) 60px minmax(0, 1fr)',
    );
    expect(cssValue(bar, '.record', 'width', SMALL)).toBe('60px');
    expect(cssValue(bar, '.label', 'font-size', SMALL)).toBe('10px');
    expect(cssValue(bar, '.label', 'letter-spacing', SMALL)).toBe('-0.01em');
    expect(cssValue(bar, '.icon', 'width', SMALL)).toBe('40px');
  });

  it('leaves each group room for an icon pill plus «Налаштування» at 390 and 320px', () => {
    // «Налаштування» at 11/600 Manrope is 79.4px (plan §4.1), so ≈ 72.2px at 10px before the negative tracking.
    // The real glyph metrics are checked in the browser by e2e/shell.spec.ts.
    const second = (value: string | undefined) => px(value?.split(' ')[1]);
    const border = px(cssValue(bar, '.inner', 'border')?.split(' ')[0]);
    const innerPad = second(cssValue(bar, '.inner', 'padding'));
    const centre = (media: string | null) =>
      px(/\) (\d+px) minmax/.exec(cssValue(bar, '.inner', 'grid-template-columns', media) ?? '')?.[1]);
    const group = (viewport: number, barPad: number, media: string | null) =>
      (viewport - 2 * barPad - 2 * border - 2 * innerPad - centre(media)) / 2;

    const at390 = group(390, second(cssValue(bar, '.bar', 'padding')), null);
    expect(at390).toBe(144);
    expect(at390).toBeGreaterThanOrEqual(px(cssValue(bar, '.icon', 'width')) + 79.4);

    const at320 = group(320, px(cssValue(bar, '.bar', 'padding-inline', SMALL)), SMALL);
    expect(at320).toBe(115);
    expect(at320).toBeGreaterThanOrEqual(px(cssValue(bar, '.icon', 'width', SMALL)) + 72.2);
  });

  it('gives <main> 12px + safe-top on the phone (desktop padding unchanged)', () => {
    const shell = readCss('shell/AppShell.module.css');
    const padding = cssValue(shell, '.main', 'padding');
    expect(padding?.startsWith('calc(12px + var(--safe-top)) ')).toBe(true);
    expect(padding).toBe('calc(12px + var(--safe-top)) 18px calc(120px + var(--safe-bottom))');
    expect(cssValue(shell, '.desktop .main', 'padding')).toBe('32px 36px 48px');
  });
});

describe('side safe areas (notched iPhone in landscape)', () => {
  it('keeps the app, the tab bar and the sheets clear of the Dynamic Island and the rounded corners', () => {
    const global = readCss('styles/global.css');
    expect(cssValue(global, '#root', 'padding-left')).toBe('var(--safe-left)');
    expect(cssValue(global, '#root', 'padding-right')).toBe('var(--safe-right)');

    // The fixed tab bar is centred between the insets (at most 440px wide), not on the whole screen.
    const bar = readCss('shell/TabBar.module.css');
    expect(cssValue(bar, '.bar', 'left')).toBe('var(--safe-left)');
    expect(cssValue(bar, '.bar', 'right')).toBe('var(--safe-right)');
    expect(cssValue(bar, '.bar', 'margin')).toBe('0 auto');
    expect(cssValue(bar, '.bar', 'transform')).toBeUndefined();

    const sheet = readCss('ui/sheet/Sheet.module.css');
    expect(cssValue(sheet, '.backdrop', 'padding-left')).toBe('var(--safe-left)');
    expect(cssValue(sheet, '.backdrop', 'padding-right')).toBe('var(--safe-right)');
  });
});
