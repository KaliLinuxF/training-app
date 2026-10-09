import { emptyData, type AppData, type DayEntry } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { getAppData, resetLocal, useDataStore } from '@/store/data';
import { fakeIdb } from '@/store/test-utils';
import { useUiStore } from '@/store/ui';
import { installMatchMedia } from '@/ui/internal/testing';
import { CalendarScreen } from './CalendarScreen';

vi.mock('@/lib/useToday', () => ({ useToday: () => '2026-10-10' }));
// The photo strip belongs to the food feature; only check what the calendar hands it.
vi.mock('@/features/food', () => ({
  PhotoStrip: ({ ids, size }: { ids: readonly string[]; size?: string }) => (
    <span data-testid="photos">{`${ids.join(',')}:${size ?? ''}`}</span>
  ),
}));
// The real data store saves the inline ✓ / ✕; its device cache lives in this in-memory IndexedDB stand-in.
const mocks = vi.hoisted(() => ({ idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() } }));
vi.mock('idb-keyval', () => mocks.idb);

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
    notes: 'Гарне самопочуття',
  });
  data.weights = [{ date: '2026-10-05', kg: 65.4 }];
  return data;
}

function renderAt(path: string) {
  const memory = memoryLocation({ path, record: true });
  const view = render(
    <Router hook={memory.hook}>
      <CalendarScreen />
    </Router>,
  );
  return { ...memory, container: view.container };
}

/** «Жовтень 2026» (the day card title starts with a digit instead). */
const monthTitle = () => screen.getByRole('heading', { level: 2, name: /^\D+ \d{4}$/ }).textContent;
const grid = () => screen.getByRole('group', { name: /^\D+ \d{4}$/ });
const dayCard = () => screen.getByRole('region', { name: /^\d+ \S+ \d{4}$/ });
const cell = (name: RegExp) => within(grid()).getByRole('button', { name });
/** A day-card row button; its name starts with the row title («Вага: 65,4 кг»). */
const dayRow = (title: string) => within(dayCard()).getByRole('button', { name: new RegExp(`^${title}`) });
const todayButton = () => screen.queryByRole('button', { name: 'Сьогодні' });
const sheet = () => useUiStore.getState().sheet;

let scrollIntoView: MockInstance<Element['scrollIntoView']>;

beforeAll(() => {
  // jsdom has no scrollIntoView.
  Element.prototype.scrollIntoView ??= () => undefined;
});

beforeEach(async () => {
  const idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  await resetLocal();
  installMatchMedia();
  scrollIntoView = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(() => undefined);
  useDataStore.setState({ data: seed() });
  useUiStore.setState({ sheet: null, toast: null });
});

afterEach(async () => {
  cleanup();
  vi.restoreAllMocks();
  useUiStore.setState({ sheet: null, toast: null });
  await resetLocal();
});

describe('CalendarScreen', () => {
  it('selects today when the URL has no date: no shortcut, no history list, no dashes', () => {
    renderAt('/calendar');
    expect(screen.getByRole('heading', { level: 1, name: 'Календар' })).toBeTruthy();
    expect(screen.queryByText('Історія по днях')).toBeNull();
    expect(monthTitle()).toBe('Жовтень 2026');
    const card = dayCard();
    expect(within(card).getByRole('heading', { name: '10 жовтня 2026' })).toBeTruthy();
    expect(within(card).getByText('субота · сьогодні')).toBeTruthy();
    expect(card.textContent).not.toContain('—');
    const today = screen.getByRole('button', { name: /^10 жовтня, сьогодні/ });
    expect(today.getAttribute('aria-pressed')).toBe('true');
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(todayButton()).toBeNull();
    expect(screen.queryByText('Останні записи')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Показати ще' })).toBeNull();
    // Cells and the legend say «їжа» / «Їжа» (not «харчування»).
    expect(cell(/^9 жовтня/).getAttribute('aria-label')).toBe('9 жовтня, їжа');
    expect(screen.queryByText(/харчування/i)).toBeNull();
    expect(screen.getAllByText('Їжа')).toHaveLength(2); // legend + the day's row title
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
    expect(todayButton()).toBeTruthy();
    cleanup();
    renderAt('/calendar?date=2027-01-01');
    expect(within(dayCard()).getByRole('heading', { name: '10 жовтня 2026' })).toBeTruthy();
    expect(todayButton()).toBeNull();
  });

  it('selects a day with a replaced URL', () => {
    const memory = renderAt('/calendar');
    fireEvent.click(cell(/^5 жовтня/));
    expect(memory.history).toEqual(['/calendar?date=2026-10-05']);
    const card = dayCard();
    expect(within(card).getByRole('heading', { name: '5 жовтня 2026' })).toBeTruthy();
    expect(within(card).getByText('65,4 кг')).toBeTruthy();
    expect(cell(/^5 жовтня/).getAttribute('aria-pressed')).toBe('true');
  });

  it('«Сьогодні» comes back to today after selecting another day', () => {
    const memory = renderAt('/calendar');
    fireEvent.click(cell(/^5 жовтня/));
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    expect(monthTitle()).toBe('Вересень 2026');

    fireEvent.click(screen.getByRole('button', { name: 'Сьогодні' }));
    expect(memory.history).toEqual(['/calendar']);
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(within(dayCard()).getByRole('heading', { name: '10 жовтня 2026' })).toBeTruthy();
    expect(cell(/^10 жовтня/).getAttribute('aria-pressed')).toBe('true');
    expect(todayButton()).toBeNull();
  });

  it('«Сьогодні» also shows up after only browsing to another month', () => {
    const memory = renderAt('/calendar');
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    expect(monthTitle()).toBe('Вересень 2026');
    expect(memory.history).toEqual(['/calendar']);

    fireEvent.click(screen.getByRole('button', { name: 'Сьогодні' }));
    expect(memory.history).toEqual(['/calendar']);
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(within(dayCard()).getByRole('heading', { name: '10 жовтня 2026' })).toBeTruthy();
    expect(todayButton()).toBeNull();
  });

  it('a focused «Сьогодні» hands its focus to today’s cell as it hides itself', () => {
    const memory = renderAt('/calendar');
    fireEvent.click(cell(/^5 жовтня/));
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    expect(monthTitle()).toBe('Вересень 2026');

    // Keyboard Enter / a desktop click: the button holds focus when it is pressed.
    const shortcut = screen.getByRole('button', { name: 'Сьогодні' });
    shortcut.focus();
    fireEvent.click(shortcut);

    expect(todayButton()).toBeNull();
    expect(memory.history).toEqual(['/calendar']);
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(document.activeElement).toBe(cell(/^10 жовтня/));
    // Focusing it brings no scroll: the reveal belongs to a cell tap only.
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Again, with today's month already shown (only the selection differed).
    fireEvent.click(cell(/^5 жовтня/));
    const again = screen.getByRole('button', { name: 'Сьогодні' });
    again.focus();
    fireEvent.click(again);
    expect(todayButton()).toBeNull();
    expect(document.activeElement).toBe(cell(/^10 жовтня/));
  });

  it('a tap on «Сьогодні» that never focused it moves no focus', () => {
    renderAt('/calendar');
    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    // A touch tap on the iPhone: the button is pressed without taking DOM focus.
    fireEvent.click(screen.getByRole('button', { name: 'Сьогодні' }));
    expect(todayButton()).toBeNull();
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(focusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
  });

  it('a focused › that brings back the current month hands its focus to ‹', () => {
    renderAt('/calendar?date=2026-10-08');
    const prev = screen.getByRole('button', { name: 'Попередній місяць' });
    const next = screen.getByRole('button', { name: 'Наступний місяць' }) as HTMLButtonElement;
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(monthTitle()).toBe('Серпень 2026');

    // Into September: › stays enabled and keeps its focus.
    next.focus();
    fireEvent.click(next);
    expect(monthTitle()).toBe('Вересень 2026');
    expect(next.disabled).toBe(false);
    expect(document.activeElement).toBe(next);

    // Into October (the current month): › turns disabled, ‹ takes the focus.
    fireEvent.click(next);
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(next.disabled).toBe(true);
    expect(document.activeElement).toBe(prev);
  });

  it('a swipe back to the current month moves the focus off a focused ›; otherwise focus stays put', () => {
    renderAt('/calendar');
    const prev = screen.getByRole('button', { name: 'Попередній місяць' });
    const next = screen.getByRole('button', { name: 'Наступний місяць' }) as HTMLButtonElement;
    fireEvent.click(prev);
    expect(monthTitle()).toBe('Вересень 2026');
    next.focus();
    const sep = screen.getByRole('group', { name: 'Вересень 2026' });
    fireEvent.touchStart(sep, { touches: [{ clientX: 200, clientY: 100 }] });
    fireEvent.touchEnd(sep, { changedTouches: [{ clientX: 100, clientY: 100 }] });
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(next.disabled).toBe(true);
    expect(document.activeElement).toBe(prev);

    // A plain click on › (no focus on it) into the current month moves no focus.
    prev.blur();
    fireEvent.click(prev);
    const focusSpy = vi.spyOn(HTMLElement.prototype, 'focus');
    fireEvent.click(next);
    expect(monthTitle()).toBe('Жовтень 2026');
    expect(focusSpy).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(document.body);
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
    expect(cell(/^8 жовтня/).getAttribute('aria-pressed')).toBe('true');

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
    fireEvent.click(cell(/^29 вересня/));
    expect(memory.history).toEqual(['/calendar?date=2026-09-29']);
    expect(monthTitle()).toBe('Вересень 2026');
    expect(within(dayCard()).getByRole('heading', { name: '29 вересня 2026' })).toBeTruthy();
    expect(cell(/^29 вересня/).getAttribute('aria-pressed')).toBe('true');
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

  it('rows open their sheets for the selected day', () => {
    renderAt('/calendar?date=2026-10-05');
    const open = (title: string) => {
      fireEvent.click(dayRow(title));
      const opened = sheet();
      useUiStore.setState({ sheet: null });
      return opened;
    };
    expect(open('Вага')).toMatchObject({ date: '2026-10-05', mode: 'weight' });
    expect(open('Заміри')).toMatchObject({ date: '2026-10-05', mode: 'measure' });
    expect(open('Їжа')).toMatchObject({ date: '2026-10-05', mode: 'food' });
    expect(open('Тренування')).toMatchObject({ date: '2026-10-05', mode: 'workout' });
    expect(open('Редагувати день')).toMatchObject({ date: '2026-10-05', mode: 'day' });

    // Each of them announces the dialog it opens (like Home's rows); the inline ✓ / ✕ save at once and do not.
    const card = dayCard();
    for (const name of ['Їжа', 'Тренування', 'Вага', 'Заміри']) {
      expect(dayRow(name).getAttribute('aria-haspopup')).toBe('dialog');
    }
    expect(within(card).getByRole('button', { name: 'Редагувати день' }).getAttribute('aria-haspopup')).toBe(
      'dialog',
    );
    const toggle = within(card).getByRole('group', { name: 'Тренування за день' });
    for (const name of ['Було', 'Не було']) {
      expect(within(toggle).getByRole('button', { name }).hasAttribute('aria-haspopup')).toBe(false);
    }

    cleanup();
    renderAt('/calendar?date=2026-10-04');
    const fill = screen.getByRole('button', { name: 'Заповнити день' });
    expect(fill.getAttribute('aria-haspopup')).toBe('dialog');
    fireEvent.click(fill);
    expect(sheet()).toMatchObject({ date: '2026-10-04', mode: 'day' });
  });

  it('names the rows briefly, with «Додати» on empty ones and the workout toggle beside its row', () => {
    renderAt('/calendar?date=2026-10-05');
    const card = dayCard();
    expect(within(card).getByRole('button', { name: /^Їжа: 1\s550 ккал$/ })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Тренування: не було' })).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Вага: 65,4 кг' })).toBeTruthy();
    const measures = within(card).getByRole('button', { name: 'Заміри: додати' });
    expect(measures.textContent).toContain('Додати');
    expect(dayRow('Тренування').textContent).toContain('Не було');
    const toggle = within(card).getByRole('group', { name: 'Тренування за день' });
    expect(within(toggle).getByRole('button', { name: 'Не було' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(toggle).getByRole('button', { name: 'Було' }).getAttribute('aria-pressed')).toBe('false');
    expect(card.textContent).not.toContain('—');

    // Tab order: «Сьогодні», ‹ ›, the cells, then the rows (Тренування → Було → Не було) and the footer.
    const order = [
      screen.getByRole('button', { name: 'Сьогодні' }),
      screen.getByRole('button', { name: 'Попередній місяць' }),
      screen.getByRole('button', { name: 'Наступний місяць' }),
      cell(/^1 жовтня/),
      cell(/^10 жовтня/),
      dayRow('Їжа'),
      dayRow('Тренування'),
      within(toggle).getByRole('button', { name: 'Було' }),
      within(toggle).getByRole('button', { name: 'Не було' }),
      dayRow('Вага'),
      dayRow('Заміри'),
      within(card).getByRole('button', { name: 'Редагувати день' }),
    ];
    for (let i = 1; i < order.length; i++) {
      const [a, b] = [order[i - 1], order[i]];
      expect(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
  });

  it('an empty day offers «Додати» on Їжа, Вага and Заміри', () => {
    renderAt('/calendar?date=2026-10-04');
    const card = dayCard();
    expect(within(card).getByText('Порожньо')).toBeTruthy();
    for (const name of ['Їжа: додати', 'Вага: додати', 'Заміри: додати', 'Тренування: не відмічено']) {
      expect(within(card).getByRole('button', { name })).toBeTruthy();
    }
    expect(within(card).getAllByText('Додати')).toHaveLength(3);
    expect(within(card).getByText('Ще не відмічено')).toBeTruthy();
    expect(within(card).queryByRole('button', { name: /^Нотатки/ })).toBeNull();
    expect(card.textContent).not.toContain('—');
  });

  it('«Не було» on a past day saves the mark at once, without a sheet', () => {
    const { container } = renderAt('/calendar?date=2026-10-08');
    const before = getAppData().days['2026-10-08'];
    const toggle = within(dayCard()).getByRole('group', { name: 'Тренування за день' });
    const no = within(toggle).getByRole('button', { name: 'Не було' });
    expect(no.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(no);

    expect(getAppData().days['2026-10-08']).toEqual({ ...before, trained: false, types: [] });
    expect(useUiStore.getState().toast?.text).toBe('Відмічено: без тренування');
    expect(sheet()).toBeNull();
    expect(no.getAttribute('aria-pressed')).toBe('true');
    expect(dayRow('Тренування').getAttribute('aria-label')).toBe('Тренування: не було');
    // The toggle is a sibling of the row button, never inside it.
    expect(container.querySelectorAll('button button')).toHaveLength(0);
    expect(dayRow('Тренування').contains(no)).toBe(false);
  });

  it('«Було» on a day without a record creates it', () => {
    renderAt('/calendar?date=2026-10-04');
    fireEvent.click(within(dayCard()).getByRole('button', { name: 'Було' }));
    expect(getAppData().days['2026-10-04']).toEqual(day({ trained: true }));
    expect(useUiStore.getState().toast?.text).toBe('Відмічено: тренування було');
    expect(sheet()).toBeNull();
    expect(within(dayCard()).getByText('Частково')).toBeTruthy();
  });

  it('pressing the mark the day already has saves nothing', () => {
    renderAt('/calendar?date=2026-10-07');
    const before = getAppData();
    fireEvent.click(within(dayCard()).getByRole('button', { name: 'Не було' }));
    expect(getAppData()).toBe(before);
    expect(useUiStore.getState().toast).toBeNull();
  });

  it('the food text and the notes are the rows’ accessible descriptions; photos sit outside the row', () => {
    renderAt('/calendar?date=2026-09-30');
    const card = dayCard();
    const food = within(card).getByRole('button', {
      name: /^Їжа: 1\s720 ккал, більше цілі$/,
      description: 'Сирники',
    });
    expect(food.getAttribute('aria-describedby')).toBeTruthy();
    const photos = within(card).getByTestId('photos');
    expect(photos.textContent).toBe('ph1:sm');
    expect(food.contains(photos)).toBe(false);
    expect(
      within(card).getByRole('button', { name: 'Нотатки', description: 'Гарне самопочуття' }),
    ).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Тренування: було, Кардіо' })).toBeTruthy();

    cleanup();
    renderAt('/calendar?date=2026-09-29');
    expect(within(dayCard()).queryByRole('button', { name: 'Нотатки' })).toBeNull();
    expect(within(dayCard()).queryByTestId('photos')).toBeNull();
  });

  it('a cell tap reveals the day card; loading ?date=, ‹ › and «Сьогодні» do not', () => {
    renderAt('/calendar?date=2026-10-08');
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Попередній місяць' }));
    fireEvent.click(screen.getByRole('button', { name: 'Наступний місяць' }));
    expect(scrollIntoView).not.toHaveBeenCalled();

    fireEvent.click(cell(/^5 жовтня/));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', behavior: 'smooth' });
    // On the card's own box (the grid item that wraps the region).
    expect(scrollIntoView.mock.contexts[0]).toBe(dayCard().parentElement);

    fireEvent.click(screen.getByRole('button', { name: 'Сьогодні' }));
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    // Tapping the selected day again still brings its card into view.
    fireEvent.click(cell(/^10 жовтня/));
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('reveals without smooth scrolling under reduced motion', () => {
    installMatchMedia((q) => q === '(prefers-reduced-motion: reduce)');
    renderAt('/calendar');
    fireEvent.click(cell(/^5 жовтня/));
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: 'nearest', behavior: 'auto' });
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
