import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '@legko/shared';
import { useDataStore } from '@/store/data';
import { NOT_ENOUGH_DATA } from './ChartPlaceholder';
import { NO_KCAL_HISTORY, NO_KCAL_IN_PERIOD, SHOW_MORE } from './NutritionCard';
import { PERIOD_STORAGE_KEY } from './period';
import { freshData, progressData, TODAY } from './progress.fixtures';
import { ProgressScreen, ProgressView } from './ProgressScreen';
import { NO_WORKOUTS } from './WorkoutsCard';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderView(data: AppData = progressData()) {
  const memory = memoryLocation({ path: '/progress', record: true });
  const view = render(
    <Router hook={memory.hook}>
      <ProgressView data={data} today={TODAY} />
    </Router>,
  );
  return { memory, view };
}

const radio = (name: string) => screen.getByRole('radio', { name });
const historySection = () => screen.getByRole('group', { name: 'Історія калорій' });
const historyRows = () =>
  within(historySection())
    .getAllByRole('button')
    .filter((b) => b.textContent !== SHOW_MORE);

describe('ProgressView', () => {
  it('renders the header, the period switcher and every card', () => {
    renderView();
    expect(screen.getByRole('heading', { level: 1, name: 'Мій прогрес' })).toBeTruthy();
    expect(screen.getByText('Автоматична статистика')).toBeTruthy();
    const group = screen.getByRole('radiogroup', { name: 'Період' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'Тиждень',
      'Місяць',
      '3 міс.',
      'Весь час',
    ]);
    expect(radio('Тиждень').getAttribute('aria-checked')).toBe('true');
    for (const name of ['Цього тижня', 'Вага', 'Заміри тіла', 'Тренування', 'Харчування']) {
      expect(screen.getByRole('region', { name })).toBeTruthy();
    }
    expect(screen.getByRole('img', { name: /^Вага: з 14 вересня по 5 жовтня/ })).toBeTruthy();
    expect(screen.getByText('Найчастіше · цього тижня')).toBeTruthy();
  });

  it('switches the period and remembers it for the session', () => {
    renderView();
    fireEvent.click(radio('Місяць'));
    expect(radio('Місяць').getAttribute('aria-checked')).toBe('true');
    expect(screen.getByRole('region', { name: 'За останні 30 днів' })).toBeTruthy();
    expect(screen.getByText('Найчастіше · за останні 30 днів')).toBeTruthy();
    expect(window.sessionStorage.getItem(PERIOD_STORAGE_KEY)).toBe('month');

    cleanup();
    renderView();
    expect(radio('Місяць').getAttribute('aria-checked')).toBe('true');
  });

  it('shows the weekly-average note for long periods', () => {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, 'q');
    renderView();
    expect(screen.getByRole('region', { name: 'За 3 місяці' })).toBeTruthy();
    expect(screen.getByText('· середнє за тиждень')).toBeTruthy();
  });

  it('falls back to the week when storage is unavailable or holds junk', () => {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, 'year');
    renderView();
    expect(radio('Тиждень').getAttribute('aria-checked')).toBe('true');
    cleanup();

    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    renderView();
    expect(radio('Тиждень').getAttribute('aria-checked')).toBe('true');
    fireEvent.click(radio('Весь час'));
    expect(radio('Весь час').getAttribute('aria-checked')).toBe('true');
  });

  it('selects the measurement shown in the chart', () => {
    renderView();
    const waist = screen.getByRole('button', { name: 'Талія: 74 → 70 см, зміна −4 см' });
    const hips = screen.getByRole('button', { name: /^Стегна:/ });
    expect(waist.getAttribute('aria-pressed')).toBe('true');
    expect(hips.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Талія, см')).toBeTruthy();

    fireEvent.click(hips);
    expect(hips.getAttribute('aria-pressed')).toBe('true');
    expect(waist.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Стегна, см')).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Стегна: з 10 серпня/ })).toBeTruthy();
  });

  it('opens a day of the kcal history in the calendar', () => {
    const { memory } = renderView();
    fireEvent.click(screen.getByRole('button', { name: /^7 жовтня:/ }));
    expect(memory.history.at(-1)).toBe('/calendar?date=2026-10-07');
  });

  it('loads 7 more history rows at a time', () => {
    renderView();
    expect(historyRows()).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: SHOW_MORE }));
    expect(historyRows()).toHaveLength(14);
    expect(screen.getByRole('button', { name: SHOW_MORE })).toBeTruthy();
  });

  it('hides «Показати ще» once everything is shown', () => {
    const data = progressData();
    data.days = Object.fromEntries(Object.entries(data.days).filter(([date]) => date >= '2026-10-01'));
    renderView(data);
    // 1–8 October with kcal = 8 days.
    expect(historyRows()).toHaveLength(7);
    fireEvent.click(screen.getByRole('button', { name: SHOW_MORE }));
    expect(historyRows()).toHaveLength(8);
    expect(screen.queryByRole('button', { name: SHOW_MORE })).toBeNull();
  });

  it('looks intentional for a brand-new user', () => {
    const { view } = renderView(freshData());
    expect(screen.getAllByText(NOT_ENOUGH_DATA)).toHaveLength(2);
    expect(screen.getByText('Запиши перше зважування, щоб бачити динаміку')).toBeTruthy();
    expect(screen.getByText('Запиши заміри, щоб бачити динаміку')).toBeTruthy();
    expect(screen.getByText(NO_WORKOUTS)).toBeTruthy();
    expect(screen.getByText(NO_KCAL_IN_PERIOD)).toBeTruthy();
    expect(screen.getByText(NO_KCAL_HISTORY)).toBeTruthy();
    expect(screen.queryByRole('button', { name: SHOW_MORE })).toBeNull();
    expect(view.container.textContent).not.toMatch(/NaN|undefined|Infinity/);
  });
});

describe('ProgressScreen', () => {
  it('reads the data store', () => {
    const before = useDataStore.getState().data;
    act(() => useDataStore.setState({ data: progressData() }));
    const memory = memoryLocation({ path: '/progress' });
    render(
      <Router hook={memory.hook}>
        <ProgressScreen />
      </Router>,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'Мій прогрес' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Вага' }).textContent).toContain('68,4');
    act(() => useDataStore.setState({ data: before }));
  });
});
