import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cssValue, readCss } from '@/ui/internal/cssSource';
import { stubScrollTo } from '@/ui/internal/testing';
import { isNavActive } from './nav';
import { Sidebar } from './Sidebar';
import { TabBar } from './TabBar';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('isNavActive', () => {
  it('matches sections by pathname', () => {
    expect(isNavActive('/', '/')).toBe(true);
    expect(isNavActive('/', '/calendar')).toBe(false);
    expect(isNavActive('/calendar', '/calendar')).toBe(true);
    expect(isNavActive('/calendar', '/calendar/x')).toBe(true);
    expect(isNavActive('/calendar', '/calendarx')).toBe(false);
    expect(isNavActive('/progress', '/')).toBe(false);
  });
});

function inRouter(path: string, ui: ReactNode) {
  const memory = memoryLocation({ path, record: true });
  render(<Router hook={memory.hook}>{ui}</Router>);
  return memory;
}

describe('TabBar', () => {
  it('renders four section links around the «+» button and marks the current one', () => {
    const onRecord = vi.fn();
    inRouter('/progress', <TabBar location="/progress" onRecord={onRecord} />);
    const nav = screen.getByRole('navigation', { name: 'Основна навігація' });
    const items = Array.from(nav.querySelectorAll('a, button')).map(
      (el) => el.getAttribute('aria-label') ?? el.textContent,
    );
    expect(items).toEqual(['Головна', 'Календар', 'Записати день', 'Прогрес', 'Нагадування']);
    expect(screen.getByRole('link', { name: 'Прогрес' }).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link', { name: 'Головна' }).getAttribute('aria-current')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Записати день' }));
    expect(onRecord).toHaveBeenCalledOnce();
  });

  it('navigates to another section, and scrolls up instead when the current one is tapped', () => {
    const scrollTo = stubScrollTo();
    const memory = inRouter('/', <TabBar location="/" onRecord={() => undefined} />);
    fireEvent.click(screen.getByRole('link', { name: 'Головна' }));
    expect(memory.history).toEqual(['/']);
    expect(scrollTo).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByRole('link', { name: 'Календар' }));
    expect(memory.history).toEqual(['/', '/calendar']);
  });
});

describe('Sidebar', () => {
  it('shows the logo, the links and «+ Записати день»', () => {
    const onRecord = vi.fn();
    inRouter('/reminders', <Sidebar location="/reminders" onRecord={onRecord} />);
    expect(screen.getByText('Легко')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Нагадування' }).getAttribute('aria-current')).toBe('page');
    fireEvent.click(screen.getByRole('button', { name: '+ Записати день' }));
    expect(onRecord).toHaveBeenCalledOnce();
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
