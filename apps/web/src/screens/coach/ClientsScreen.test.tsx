import { coachWindow } from '@legko/shared';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api } from '@/lib/api';
import { cssValue, readCss } from '@/ui/internal/cssSource';
import { clientsPayload, NOW } from './coach.fixtures';
import { at, desktop, freezeClock, location, mockClients, renderPage, settle, signIn } from './coach.testing';
import { ClientsScreen } from './ClientsScreen';

beforeEach(() => {
  freezeClock();
  signIn('admin');
  desktop(true);
  at('/coach', { legkoFrom: '/settings/users' });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

async function open() {
  const view = renderPage(<ClientsScreen />);
  await settle();
  return view;
}

const bodyRowNames = () =>
  within(screen.getByRole('table'))
    .getAllByRole('row')
    .slice(1)
    .map((r) => within(r).getByRole('link').textContent);

describe('ClientsScreen', () => {
  it('asks for the window of the device’s today and shows the count line and the title', async () => {
    const spy = mockClients(clientsPayload());
    await open();
    expect(spy).toHaveBeenCalledExactlyOnceWith(coachWindow(NOW));
    expect(screen.getByRole('heading', { level: 1, name: 'Клієнти' })).toBeTruthy();
    expect(screen.getByText('6 клієнтів · 4 потребують уваги')).toBeTruthy();
    expect(bodyRowNames()).toEqual(['marta', 'petro', 'ivan', 'olya', 'sofia', 'taras']);
    expect(
      screen.getByText(
        'Калорії, Б · Ж · В і записи — за повні дні до сьогодні; тренування — з понеділка; сигнали — за останні 7 днів.',
      ),
    ).toBeTruthy();
  });

  it('has a 16px search field, the «Показати» chips with counts and the period switch', async () => {
    mockClients(clientsPayload());
    await open();
    const search = screen.getByRole('searchbox', { name: 'Пошук за імʼям' });
    expect(search.getAttribute('placeholder')).toBe('Імʼя');
    const chips = screen.getByRole('group', { name: 'Показати' });
    expect(within(chips).getAllByRole('button').map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([
      ['Потребують уваги · 4', 'false'],
      ['Усі · 6', 'true'],
    ]);
    expect(within(screen.getByRole('radiogroup', { name: 'Період' })).getAllByRole('radio').map((r) => r.textContent)).toEqual(
      ['7 днів', '30 днів'],
    );
    const css = readCss('screens/coach/ClientsScreen.module.css');
    expect(cssValue(css, '.input', 'font-size')).toBe('16px');
    expect(cssValue(css, '.input', 'min-height')).toBe('48px');
  });

  it('keeps every list parameter in the URL by replacing the entry and keeping its state', async () => {
    mockClients(clientsPayload());
    await open();
    const length = window.history.length;

    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'ar' } });
    expect(location()).toBe('/coach?q=ar');
    expect(bodyRowNames()).toEqual(['marta', 'taras']);
    expect(screen.getByText('Показано 2 з 6')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Потребують уваги · 4' }));
    expect(location()).toBe('/coach?show=attention&q=ar');
    expect(bodyRowNames()).toEqual(['marta']);

    fireEvent.click(screen.getByRole('radio', { name: '30 днів' }));
    expect(location()).toBe('/coach?days=30&show=attention&q=ar');
    expect(screen.getByRole('columnheader', { name: /Ккал · 30 дн\./ })).toBeTruthy();

    fireEvent.click(within(screen.getByRole('columnheader', { name: /Ккал/ })).getByRole('button'));
    expect(location()).toBe('/coach?days=30&show=attention&sort=kcal&dir=desc&q=ar');

    expect(window.history.length).toBe(length);
    expect(window.history.state).toEqual({ legkoFrom: '/settings/users' });
  });

  it('reads the parameters from the URL it was opened with', async () => {
    at('/coach?sort=name&dir=desc&days=30');
    mockClients(clientsPayload());
    await open();
    expect(bodyRowNames()).toEqual(['taras', 'sofia', 'petro', 'olya', 'marta', 'ivan']);
    expect(screen.getByRole('columnheader', { name: /Клієнт/ }).getAttribute('aria-sort')).toBe('descending');
    expect(screen.getByRole('radio', { name: '30 днів' }).getAttribute('aria-checked')).toBe('true');
  });

  it('says when nobody matches the search or nobody needs attention', async () => {
    const payload = clientsPayload();
    mockClients(payload);
    at('/coach?q=zz');
    const view = await open();
    expect(screen.getByText('Нікого не знайдено за «zz»')).toBeTruthy();
    expect(screen.queryByRole('table')).toBeNull();
    view.unmount();

    at('/coach?show=attention');
    mockClients({ ...payload, clients: payload.clients.filter((c) => c.client.username === 'sofia') });
    await open();
    expect(screen.getByText('Зараз ніхто не потребує уваги')).toBeTruthy();
  });

  it('shows the phone list (with the sort select) instead of the table on the phone', async () => {
    desktop(false);
    mockClients(clientsPayload());
    await open();
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('combobox', { name: 'Сортування' })).toBeTruthy();
    // One row with the 7 / 30 switch (the toolbar is three rows on the phone, not four).
    const period = screen.getByRole('radiogroup', { name: 'Період' });
    const sortRow = screen.getByRole('combobox', { name: 'Сортування' }).closest('[class*="sort"]')?.parentElement;
    expect(sortRow).toBe(period.parentElement);
    const css = readCss('screens/coach/ClientsScreen.module.css');
    expect(cssValue(css, '.controls', 'display')).toBe('flex');
    expect(cssValue(css, '.sort select', 'min-height')).toBe('48px');
    fireEvent.change(screen.getByRole('combobox', { name: 'Сортування' }), { target: { value: 'kcal' } });
    expect(location()).toBe('/coach?sort=kcal&dir=desc');
    const first = within(screen.getByRole('region', { name: 'Клієнти' })).getAllByRole('link')[0];
    expect(first?.textContent?.startsWith('olya')).toBe(true);
  });

  it('invites to «Користувачі» when there are no clients yet', async () => {
    mockClients({ ...coachWindow(NOW), clients: [] });
    await open();
    expect(screen.getByRole('heading', { name: 'Клієнтів ще немає' })).toBeTruthy();
    expect(screen.getByText('Запроси людину в розділі «Користувачі».')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Відкрити «Користувачі»' }).getAttribute('href')).toBe('/settings/users');
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('shows «Завантажую…», then a retry after a failure, and «Потрібен інтернет» offline', async () => {
    const spy = vi
      .spyOn(api.coach, 'clients')
      .mockRejectedValueOnce(new ApiError(500, 'internal', 'boom'))
      .mockRejectedValueOnce(new ApiError(0, 'network', 'offline'))
      .mockResolvedValueOnce(clientsPayload());
    renderPage(<ClientsScreen />);
    expect(screen.getByRole('status').textContent).toBe('Завантажую…');
    await settle();
    expect(screen.getByRole('alert').textContent).toBe('Не вдалося завантажити');
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    await settle();
    expect(screen.getByText('Потрібен інтернет')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Спробувати ще раз' }));
    await settle();
    expect(screen.getByRole('table')).toBeTruthy();
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('asks again when the page comes back after more than 2 minutes, keeping the copy on a failure', async () => {
    const spy = mockClients(clientsPayload());
    await open();
    vi.setSystemTime(NOW.getTime() + 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(spy).toHaveBeenCalledTimes(1);

    spy.mockRejectedValueOnce(new ApiError(0, 'network', 'offline'));
    vi.setSystemTime(NOW.getTime() + 3 * 60_000);
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(spy).toHaveBeenCalledTimes(2);
    expect(screen.getByRole('table')).toBeTruthy();
  });
});
