import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DESKTOP_QUERY } from '@/lib/platform';
import { ui, useUiStore } from '@/store/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { AppShell } from './AppShell';

const TODAY = '2026-10-14';

// Hoisted above the imports, so the date is spelled out here (same value as TODAY).
vi.mock('@/lib/useToday', () => ({ useToday: () => '2026-10-14' }));
// The sheets themselves belong to other packages; the shell only asks the store for one.
vi.mock('@/sheets/SheetHost', () => ({ SheetHost: () => null }));

let scrollTo: ReturnType<typeof stubScrollTo>;

beforeEach(() => {
  scrollTo = stubScrollTo();
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
});

type Memory = ReturnType<typeof memoryLocation>;

/** A fresh element every call, so `rerender` really renders the shell again. */
const shellTree = (memory: Memory) => (
  <Router hook={memory.hook}>
    <AppShell>
      <h1>Екран</h1>
    </AppShell>
  </Router>
);

function renderShell(path = '/') {
  const memory = memoryLocation({ path, record: true });
  return { memory, ...render(shellTree(memory)) };
}

const sheet = () => useUiStore.getState().sheet;

/** `<html data-shell>`: "phone" gives the page the scroll-padding that keeps focus clear of the tab bar. */
const htmlShell = () => document.documentElement.dataset.shell;

describe('page scroll-padding marker on <html>', () => {
  it('is set only while the phone shell is mounted and follows the desktop query', () => {
    installMatchMedia(() => false);
    const { memory, rerender, unmount } = renderShell();
    expect(htmlShell()).toBe('phone');

    // Window widened past the desktop query (mouse + ≥ 900px): sidebar, no tab bar, no padding.
    installMatchMedia((query) => query === DESKTOP_QUERY);
    rerender(shellTree(memory));
    expect(screen.queryByRole('button', { name: 'Записати день' })).toBeNull();
    expect(htmlShell()).toBeUndefined();

    // And back to the phone shell.
    installMatchMedia(() => false);
    rerender(shellTree(memory));
    expect(screen.getByRole('button', { name: 'Записати день' })).toBeTruthy();
    expect(htmlShell()).toBe('phone');

    unmount();
    expect(htmlShell()).toBeUndefined();
  });

  it('is never set by the desktop shell', () => {
    installMatchMedia((query) => query === DESKTOP_QUERY);
    renderShell();
    expect(htmlShell()).toBeUndefined();
  });
});

describe('AppShell on the phone', () => {
  beforeEach(() => installMatchMedia(() => false));

  it('renders the screen in <main> with the tab bar, no sidebar', () => {
    renderShell();
    expect(screen.getByRole('main').textContent).toBe('Екран');
    expect(screen.getByRole('button', { name: 'Записати день' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: '+ Записати день' })).toBeNull();
    expect(screen.queryByText('Легко')).toBeNull();
    expect(htmlShell()).toBe('phone');
  });

  it('«+» opens «Що записати?» for today and reports it with aria-expanded', () => {
    renderShell();
    const plus = screen.getByRole('button', { name: 'Записати день' });
    expect(plus.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(plus);
    expect(sheet()).toMatchObject({ mode: 'menu', date: TODAY });
    expect(sheet()?.patch).toBeUndefined();
    expect(plus.getAttribute('aria-expanded')).toBe('true');

    act(() => ui.closeSheet());
    expect(plus.getAttribute('aria-expanded')).toBe('false');

    // Only the menu counts: a day sheet opened elsewhere does not expand «+».
    act(() => ui.openSheet(TODAY, 'day'));
    expect(plus.getAttribute('aria-expanded')).toBe('false');
  });

  it('scrolls to the top on every route change', () => {
    renderShell('/');
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
    const calls = scrollTo.mock.calls.length;
    fireEvent.click(screen.getByRole('link', { name: 'Календар' }));
    expect(scrollTo).toHaveBeenCalledTimes(calls + 1);
    expect(scrollTo).toHaveBeenLastCalledWith(0, 0);
  });
});

describe('AppShell on the desktop', () => {
  beforeEach(() => installMatchMedia((query) => query === DESKTOP_QUERY));

  it('renders the sidebar instead of the tab bar', () => {
    renderShell();
    expect(screen.getByText('Легко')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Записати день' })).toBeNull();
    expect(htmlShell()).toBeUndefined();
  });

  it('«+ Записати день» opens «Що записати?» for today and reports it with aria-expanded', () => {
    renderShell('/settings/data');
    const record = screen.getByRole('button', { name: '+ Записати день' });
    expect(record.getAttribute('aria-haspopup')).toBe('dialog');
    expect(record.getAttribute('aria-expanded')).toBe('false');

    fireEvent.click(record);
    expect(sheet()).toMatchObject({ mode: 'menu', date: TODAY });
    expect(record.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByRole('link', { name: 'Налаштування' }).getAttribute('aria-current')).toBe('true');
  });
});
