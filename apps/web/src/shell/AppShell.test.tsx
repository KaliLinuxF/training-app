import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/auth/auth';
import { DESKTOP_QUERY } from '@/lib/platform';
import { ui, useUiStore } from '@/store/ui';
import { cssValue, readCss } from '@/ui/internal/cssSource';
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
    expect(screen.queryByText('Home Fit')).toBeNull();
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
    expect(screen.getByText('Home Fit')).toBeTruthy();
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

describe('AppShell navigation by role', () => {
  const account = (role: 'user' | 'admin') => ({
    id: (role === 'admin' ? 'ad' : 'a1').padEnd(32, '0'),
    username: role === 'admin' ? 'admin' : 'anna',
    role,
    createdAt: 1_760_000_000_000,
    legacyOwner: false,
    passwordChange: null,
  });
  const navLabels = () =>
    Array.from(screen.getByRole('navigation', { name: 'Основна навігація' }).querySelectorAll('a')).map(
      (a) => a.textContent,
    );
  const shellRoot = () => screen.getByRole('main').parentElement;

  afterEach(() => useAuthStore.setState({ status: 'checking', offline: false, user: null }));

  it('keeps a user’s sidebar and tab bar exactly as before', () => {
    useAuthStore.setState({ status: 'authed', offline: false, user: account('user') });
    installMatchMedia((query) => query === DESKTOP_QUERY);
    const { memory, rerender } = renderShell();
    expect(navLabels()).toEqual(['Головна', 'Календар', 'Прогрес', 'Налаштування']);

    installMatchMedia(() => false);
    rerender(shellTree(memory));
    expect(navLabels()).toEqual(['Головна', 'Календар', 'Прогрес', 'Налаштування']);
    expect(screen.queryByRole('link', { name: 'Клієнти' })).toBeNull();
  });

  it('gives an admin five sidebar links and «Клієнти» in place of «Прогрес» on the tab bar', () => {
    useAuthStore.setState({ status: 'authed', offline: false, user: account('admin') });
    installMatchMedia((query) => query === DESKTOP_QUERY);
    const { memory, rerender } = renderShell();
    expect(navLabels()).toEqual(['Головна', 'Календар', 'Прогрес', 'Клієнти', 'Налаштування']);

    installMatchMedia(() => false);
    rerender(shellTree(memory));
    expect(navLabels()).toEqual(['Головна', 'Календар', 'Клієнти', 'Налаштування']);
    expect(screen.queryByRole('link', { name: 'Прогрес' })).toBeNull();
  });

  it('widens the desktop container on /coach and /coach/<id> only', () => {
    useAuthStore.setState({ status: 'authed', offline: false, user: account('admin') });
    installMatchMedia((query) => query === DESKTOP_QUERY);
    renderShell('/coach');
    expect(shellRoot()?.className).toMatch(/wide/);
    expect(shellRoot()?.className).toMatch(/desktop/);
    cleanup();

    renderShell('/coach/abc');
    expect(shellRoot()?.className).toMatch(/wide/);
    cleanup();

    renderShell('/progress');
    expect(shellRoot()?.className).not.toMatch(/wide/);
    cleanup();

    // The phone column never widens.
    installMatchMedia(() => false);
    renderShell('/coach');
    expect(shellRoot()?.className).not.toMatch(/wide/);
  });

  it('offers no «Записати день» on the coach’s read-only pages (it writes into the admin’s own diary)', () => {
    useAuthStore.setState({ status: 'authed', offline: false, user: account('admin') });
    installMatchMedia((query) => query === DESKTOP_QUERY);
    for (const path of ['/coach', '/coach/abc']) {
      renderShell(path);
      expect(screen.queryByRole('button', { name: /Записати день/ })).toBeNull();
      cleanup();
    }
    // Her own pages keep it.
    for (const path of ['/', '/calendar', '/progress', '/settings/users']) {
      renderShell(path);
      expect(screen.getByRole('button', { name: '+ Записати день' })).toBeTruthy();
      cleanup();
    }

    installMatchMedia(() => false);
    for (const path of ['/coach', '/coach/abc']) {
      renderShell(path);
      expect(screen.queryByRole('button', { name: /Записати день/ })).toBeNull();
      // The tab bar keeps its four tabs in their places around an empty, hidden centre slot.
      expect(navLabels()).toEqual(['Головна', 'Календар', 'Клієнти', 'Налаштування']);
      const inner = screen.getByRole('navigation', { name: 'Основна навігація' }).firstElementChild;
      expect(inner?.children).toHaveLength(3);
      expect(inner?.children[1]?.getAttribute('aria-hidden')).toBe('true');
      cleanup();
    }
    renderShell('/');
    expect(screen.getByRole('button', { name: 'Записати день' })).toBeTruthy();
  });

  it('keeps «Записати день» for a user everywhere she can go', () => {
    useAuthStore.setState({ status: 'authed', offline: false, user: account('user') });
    for (const desktop of [true, false]) {
      installMatchMedia(desktop ? (query) => query === DESKTOP_QUERY : () => false);
      for (const path of ['/', '/calendar', '/progress', '/settings']) {
        renderShell(path);
        expect(screen.getByRole('button', { name: desktop ? '+ Записати день' : 'Записати день' })).toBeTruthy();
        cleanup();
      }
    }
  });

  it('declares the wide container as 1440px (the default desktop stays 1280px)', () => {
    const css = readCss('shell/AppShell.module.css');
    expect(cssValue(css, '.desktop', 'max-width')).toBe('1280px');
    expect(cssValue(css, '.wide', 'max-width')).toBe('1440px');
  });
});
