import { emptyData, type AppData, type DayEntry } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDataStore } from '@/store/data';
import { useUiStore } from '@/store/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { CalendarScreen } from './CalendarScreen';

vi.mock('@/lib/useToday', () => ({ useToday: () => '2026-10-10' }));
// The photo strip belongs to the food feature; only check what the calendar hands it.
vi.mock('@/features/food', () => ({
  PhotoStrip: ({ ids, size }: { ids: readonly string[]; size?: string }) => (
    <span data-testid="photos">{`${ids.join(',')}:${size ?? ''}`}</span>
  ),
}));

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

function seed(): AppData {
  const data = emptyData();
  // Twelve records: 10 Oct back to 28 Sep, skipping 4 Oct.
  for (let d = 28; d <= 30; d++) data.days[`2026-09-${d}`] = day({ food: `Вересень ${d}`, kcal: 1600 });
  for (let d = 1; d <= 10; d++) {
    if (d === 4) continue;
    data.days[`2026-10-${String(d).padStart(2, '0')}`] = day({
      food: `Жовтень ${d}`,
      kcal: 1500 + d * 10,
      trained: d % 2 === 0,
    });
  }
  data.days['2026-09-30'] = day({
    food: 'Сирники',
    kcal: 1720,
    trained: true,
    types: ['Кардіо'],
    photos: ['ph1'],
  });
  data.weights = [{ date: '2026-10-05', kg: 65.4 }];
  return data;
}

function renderAt(path: string) {
  const memory = memoryLocation({ path, record: true });
  render(
    <Router hook={memory.hook}>
      <CalendarScreen />
    </Router>,
  );
  return memory;
}

/** «Жовтень 2026» (the day card title starts with a digit instead). */
const monthTitle = () => screen.getByRole('heading', { level: 2, name: /^\D+ \d{4}$/ }).textContent;
const grid = () => screen.getByRole('group', { name: /^\D+ \d{4}$/ });
const dayCard = () => screen.getByRole('region', { name: /^\d+ \S+ \d{4}$/ });

beforeEach(() => {
  installMatchMedia();
  useDataStore.setState({ data: seed() });
  useUiStore.setState({ sheet: null });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('CalendarScreen', () => {
  it('selects today when the URL has no date', () => {
    renderAt('/calendar');
    expect(screen.getByRole('heading', { level: 1, name: 'Календар' })).toBeTruthy();
    expect(monthTitle()).toBe('Жовтень 2026');
    const card = dayCard();
    expect(within(card).getByRole('heading', { name: '10 жовтня 2026' })).toBeTruthy();
    expect(within(card).getByText('субота · сьогодні')).toBeTruthy();
    const today = screen.getByRole('button', { name: /^10 жовтня, сьогодні/ });
    expect(today.getAttribute('aria-pressed')).toBe('true');
    expect(today.getAttribute('aria-current')).toBe('date');
    // Future days are not buttons; the next month is out of reach.
    expect(screen.queryByRole('button', { name: /^11 жовтня/ })).toBeNull();
    expect((screen.getByRole('button', { name: 'Наступний місяць' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
  });

  it('reads ?date= and falls back to today for a future date', () => {
    renderAt('/calendar?date=2026-09-30');
    expect(monthTitle()).toBe('Вересень 2026');
    expect(within(dayCard()).getByText('Сирники')).toBeTruthy();
    expect(within(dayCard()).getByTestId('photos').textContent).toBe('ph1:sm');
    cleanup();
    renderAt('/calendar?date=2027-01-01');
    expect(within(dayCard()).getByRole('heading', { name: '10 жовтня 2026' })).toBeTruthy();
  });

  it('selects a day with a replaced URL', () => {
    const memory = renderAt('/calendar');
    fireEvent.click(within(grid()).getByRole('button', { name: /^5 жовтня/ }));
    expect(memory.history).toEqual(['/calendar?date=2026-10-05']);
    const card = dayCard();
    expect(within(card).getByRole('heading', { name: '5 жовтня 2026' })).toBeTruthy();
    expect(within(card).getByText('65,4 кг')).toBeTruthy();
    expect(
      within(grid())
        .getByRole('button', { name: /^5 жовтня/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('moves between months with the arrows and by swiping, keeping the selected day', () => {
    const memory = renderAt('/calendar?date=2026-10-08');
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    expect(monthTitle()).toBe('Вересень 2026');
    // Only the view moved: same URL, same day card, nothing highlighted in September.
    expect(memory.history).toEqual(['/calendar?date=2026-10-08']);
    expect(within(dayCard()).getByRole('heading', { name: '8 жовтня 2026' })).toBeTruthy();
    expect(within(grid()).queryAllByRole('button', { pressed: true })).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    expect(monthTitle()).toBe('Серпень 2026');
    fireEvent.click(screen.getByRole('button', { name: 'Наступний місяць' }));
    expect(monthTitle()).toBe('Вересень 2026');

    const sep = screen.getByRole('group', { name: 'Вересень 2026' });
    fireEvent.touchStart(sep, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(sep, { changedTouches: [{ clientX: 100, clientY: 110 }] });
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(
      within(grid())
        .getByRole('button', { name: /^8 жовтня/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');

    // Swiping left again would go to the future: ignored.
    const oct = screen.getByRole('group', { name: 'Жовтень 2026' });
    fireEvent.touchStart(oct, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(oct, { changedTouches: [{ clientX: 100, clientY: 100 }] });
    expect(monthTitle()).toBe('Жовтень 2026');

    // A mostly vertical drag (page scroll) does nothing.
    fireEvent.touchStart(oct, { touches: [{ clientX: 100, clientY: 100 }] });
    fireEvent.touchEnd(oct, { changedTouches: [{ clientX: 160, clientY: 300 }] });
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(memory.history).toEqual(['/calendar?date=2026-10-08']);
  });

  it('tapping a day in a browsed month selects it there', () => {
    const memory = renderAt('/calendar');
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    fireEvent.click(within(grid()).getByRole('button', { name: /^29 вересня/ }));
    expect(memory.history).toEqual(['/calendar?date=2026-09-29']);
    expect(monthTitle()).toBe('Вересень 2026');
    expect(within(dayCard()).getByRole('heading', { name: '29 вересня 2026' })).toBeTruthy();
    expect(
      within(grid())
        .getByRole('button', { name: /^29 вересня/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it("a new ?date= shows that day's month", () => {
    const memory = renderAt('/calendar?date=2026-10-08');
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    expect(monthTitle()).toBe('Серпень 2026');
    act(() => memory.navigate('/calendar?date=2026-09-30'));
    expect(monthTitle()).toBe('Вересень 2026');
    expect(within(dayCard()).getByText('Сирники')).toBeTruthy();
  });

  it('opens the day sheet for the selected day', () => {
    renderAt('/calendar?date=2026-10-04');
    fireEvent.click(screen.getByRole('button', { name: 'Заповнити день' }));
    expect(useUiStore.getState().sheet).toMatchObject({ date: '2026-10-04', mode: 'day' });
    cleanup();
    renderAt('/calendar?date=2026-10-03');
    fireEvent.click(screen.getByRole('button', { name: 'Редагувати день' }));
    expect(useUiStore.getState().sheet).toMatchObject({ date: '2026-10-03', mode: 'day' });
  });

  it('lists the latest records, pages them and opens one', () => {
    const scrollTo = stubScrollTo();
    const memory = renderAt('/calendar');
    const list = screen.getByRole('list');
    expect(within(list).getAllByRole('button')).toHaveLength(8);
    fireEvent.click(screen.getByRole('button', { name: 'Показати ще' }));
    expect(within(list).getAllByRole('button')).toHaveLength(12);
    expect(screen.queryByRole('button', { name: 'Показати ще' })).toBeNull();

    fireEvent.click(within(list).getByRole('button', { name: /^30 вересня/ }));
    expect(memory.history.at(-1)).toBe('/calendar?date=2026-09-30');
    expect(monthTitle()).toBe('Вересень 2026');
    expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: 'smooth' });

    // Browsed away, then the already selected day again: its month comes back.
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    expect(monthTitle()).toBe('Серпень 2026');
    fireEvent.click(within(list).getByRole('button', { name: /^30 вересня/ }));
    expect(monthTitle()).toBe('Вересень 2026');
    expect(
      within(grid())
        .getByRole('button', { name: /^30 вересня/ })
        .getAttribute('aria-pressed'),
    ).toBe('true');
  });

  it('names history rows in one lower-case sentence', () => {
    renderAt('/calendar');
    const list = screen.getByRole('list');
    expect(
      within(list).getByRole('button', { name: /^8 жовтня, 1\s580 ккал, Жовтень 8, тренування$/ }),
    ).toBeTruthy();
    expect(within(list).getByRole('button', { name: /^9 жовтня, .*, відпочинок$/ })).toBeTruthy();
  });

  it('follows data changes', () => {
    renderAt('/calendar?date=2026-10-09');
    expect(within(dayCard()).getByText('Жовтень 9')).toBeTruthy();
    act(() => {
      const data = seed();
      data.days['2026-10-09'] = day({ food: 'Нове', kcal: 1400, trained: false });
      useDataStore.setState({ data });
    });
    expect(within(dayCard()).getByText('Нове')).toBeTruthy();
    expect(within(dayCard()).getByText('Заповнено')).toBeTruthy();
  });
});
