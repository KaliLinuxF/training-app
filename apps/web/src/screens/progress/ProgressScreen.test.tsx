import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { todayISO, type AppData } from '@legko/shared';
import { useDataStore } from '@/store/data';
import { useUiStore } from '@/store/ui';
import { NOT_ENOUGH_DATA, RECORD_MEASURE, RECORD_WEIGHT } from './ChartPlaceholder';
import { NO_KCAL_HISTORY, NO_KCAL_IN_PERIOD, SHOW_MORE } from './NutritionCard';
import barStyles from './PeriodBar.module.css';
import { PERIOD_STORAGE_KEY } from './period';
import { freshData, progressData, TODAY } from './progress.fixtures';
import { ProgressScreen, ProgressView, type ProgressViewProps } from './ProgressScreen';
import summaryStyles from './SummaryCard.module.css';
import { NO_WORKOUTS } from './WorkoutsCard';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderView(
  data: AppData = progressData(),
  props: Partial<ProgressViewProps> = {},
  path = '/progress',
) {
  const memory = memoryLocation({ path, record: true });
  const view = render(
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      <ProgressView data={data} today={TODAY} {...props} />
    </Router>,
  );
  return { memory, view };
}

/** textContent with every run of whitespace (incl. the no-break digit-group spaces) as one space. */
const text = (el: Element): string => (el.textContent ?? '').replace(/\s+/g, ' ').trim();

const radio = (name: string) => screen.getByRole('radio', { name });
const region = (name: string) => screen.getByRole('region', { name });
const historySection = () => screen.getByRole('group', { name: 'Історія калорій' });
const historyRows = () =>
  within(historySection()).queryAllByRole('button', { name: /Відкрити в календарі$/ });

const summaryDots = (root: Element) =>
  [...root.querySelectorAll('[aria-hidden="true"]')].filter((el) => el.textContent === '·');

/**
 * Every « · » sits at the end of the nowrap item it follows (so it ends a line even after «—», which allows a
 * break after itself, and never starts one); the last item has none; only spaces lie between the items.
 */
function expectDotsInsideItems(line: Element) {
  const items = [...line.children];
  expect(items).toHaveLength(6);
  items.forEach((item, i) => {
    expect(item.tagName).toBe('SPAN');
    expect(item.classList.contains(summaryStyles.item ?? 'missing')).toBe(true);
    expect(item.querySelector('b')).toBeTruthy();
    const dots = summaryDots(item);
    if (i < items.length - 1) {
      expect(dots).toHaveLength(1);
      expect(item.lastElementChild).toBe(dots[0]);
    } else {
      expect(dots).toHaveLength(0);
    }
  });
  for (const dot of summaryDots(line)) {
    expect(dot.parentElement?.querySelector('b')).toBeTruthy();
  }
  // Nothing but the breaking spaces between the items.
  for (const node of line.childNodes) {
    if (node.nodeType === Node.TEXT_NODE) expect(node.textContent).toBe(' ');
  }
}

describe('ProgressView — layout', () => {
  it('renders the title without a subtitle, the period bar and every card', () => {
    renderView();
    const title = screen.getByRole('heading', { level: 1, name: 'Мій прогрес' });
    expect(screen.queryByText('Автоматична статистика')).toBeNull();
    expect(title.closest('header')?.querySelector('p')).toBeNull();

    const group = screen.getByRole('radiogroup', { name: 'Період' });
    // The switcher sits inside the sticky paper bar (not the kit's own `sticky` band).
    expect(group.parentElement?.classList.contains(barStyles.bar ?? 'missing')).toBe(true);
    expect(
      within(group)
        .getAllByRole('radio')
        .map((r) => r.textContent),
    ).toEqual(['Тиждень', 'Місяць', '3 міс.', 'Весь час']);
    expect(radio('Тиждень').getAttribute('aria-checked')).toBe('true');
    for (const name of ['Цього тижня', 'Вага', 'Заміри тіла', 'Тренування', 'Харчування']) {
      expect(region(name)).toBeTruthy();
    }
    expect(screen.getByRole('img', { name: /^Вага: з 14 вересня по 5 жовтня/ })).toBeTruthy();
    expect(screen.getByText('Найчастіше · цього тижня')).toBeTruthy();
  });

  it('keeps the screen order: header, period bar, summary, Вага, Заміри, Тренування, Харчування', () => {
    const { view } = renderView();
    const grid = view.container.firstElementChild;
    const children = [...(grid?.children ?? [])];
    expect(children[0]?.tagName).toBe('HEADER');
    expect(children[1]?.querySelector('[role="radiogroup"]')).toBeTruthy();
    const names = children.slice(2).map((c) => text(c.querySelector('h2') ?? c));
    expect(names).toEqual(['Цього тижня', 'Вага', 'Заміри тіла', 'Тренування', 'Харчування']);
  });

  it('never shows NaN, undefined or Infinity', () => {
    for (const data of [progressData(), freshData()]) {
      const { view } = renderView(data);
      expect(view.container.textContent).not.toMatch(/NaN|undefined|Infinity/);
      cleanup();
    }
  });
});

describe('ProgressView — summary sentence', () => {
  it('summarises the period in one line of text, not a table', () => {
    renderView();
    const summary = region('Цього тижня');
    const line = text(summary);
    for (const part of [
      'Тренувань 2',
      'сер. калорійність 1 650 ккал',
      'вага −0,4 кг',
      'талія −2 см',
      'стегна −0,5 см',
      'груди −0,5 см',
    ]) {
      expect(line).toContain(part);
    }
    expect(summary.querySelector('table, dl, [role="table"]')).toBeNull();
    expect(summary.querySelectorAll('p')).toHaveLength(1);
    // Each dot sticks to the item before it; the space after it is where the line may wrap.
    expect(text(summary.querySelector('p')!)).toBe(
      'Тренувань 2· сер. калорійність 1 650 ккал· вага −0,4 кг· талія −2 см· стегна −0,5 см· груди −0,5 см',
    );
    // «label number unit» never splits.
    expect(summary.querySelectorAll('b')).toHaveLength(6);
    // Five « · » separators, hidden from screen readers.
    expect(summaryDots(summary)).toHaveLength(5);
    expectDotsInsideItems(summary.querySelector('p')!);
  });

  it('switches the period and remembers it for the session', () => {
    renderView();
    fireEvent.click(radio('Місяць'));
    expect(radio('Місяць').getAttribute('aria-checked')).toBe('true');
    expect(text(region('За останні 30 днів'))).toContain('Тренувань 9');
    expect(screen.getByText('Найчастіше · за останні 30 днів')).toBeTruthy();
    expect(window.sessionStorage.getItem(PERIOD_STORAGE_KEY)).toBe('month');

    cleanup();
    renderView();
    expect(radio('Місяць').getAttribute('aria-checked')).toBe('true');
  });

  it('opens on the period of a ?period= link and drops the parameter', () => {
    const { memory } = renderView(progressData(), {}, '/progress?period=all');
    expect(radio('Весь час').getAttribute('aria-checked')).toBe('true');
    expect(region('За весь період')).toBeTruthy();
    expect(memory.history).toEqual(['/progress']);
    expect(window.sessionStorage.getItem(PERIOD_STORAGE_KEY)).toBe('all');
  });

  it('shows the weekly-average note for long periods', () => {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, 'q');
    renderView();
    expect(region('За 3 місяці')).toBeTruthy();
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
});

describe('ProgressView — cards', () => {
  it('weight: current value, the change «від старту», the scale and the way, without tiles', () => {
    renderView();
    const weight = region('Вага');
    const t = text(weight);
    for (const part of [
      'Поточна вага: 65,4 кг',
      '−3,0 кг від старту',
      'Старт 68,4',
      'ще 5,4 кг',
      'Ціль 60,0',
      '36% шляху',
    ]) {
      expect(t).toContain(part);
    }
    // «від старту» is visible text, not only an accessible name.
    expect(within(weight).getByText('−3,0 кг від старту')).toBeTruthy();
    for (const old of ['Початкова', 'Втрачено', 'Залишилось', 'Шлях']) expect(t).not.toContain(old);
    expect(within(weight).getByRole('img', { name: /^Вага:/ })).toBeTruthy();
  });

  it('selects the measurement shown in the chart', () => {
    renderView();
    const waist = screen.getByRole('button', { name: 'Талія: 74 → 70 см, зміна −4 см' });
    const hips = screen.getByRole('button', { name: /^Стегна:/ });
    expect(
      within(screen.getByRole('group', { name: 'Параметр для графіка' })).getAllByRole('button'),
    ).toHaveLength(3);
    expect(waist.getAttribute('aria-pressed')).toBe('true');
    expect(hips.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Талія, см')).toBeTruthy();

    fireEvent.click(hips);
    expect(hips.getAttribute('aria-pressed')).toBe('true');
    expect(waist.getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByText('Стегна, см')).toBeTruthy();
    expect(screen.getByRole('img', { name: /^Стегна: з 10 серпня/ })).toBeTruthy();
  });

  it('workouts: four counters in a strip, then the top types', () => {
    renderView();
    const workouts = region('Тренування');
    const terms = [...workouts.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(terms).toEqual(['Всього', 'Цього тижня', 'Цього місяця', 'В сер. / тиж.']);
    expect([...workouts.querySelectorAll('dd')].map((dd) => dd.textContent)).toEqual(['10', '2', '3', '1,2']);
    expect(
      within(workouts).getByRole('heading', { level: 3, name: 'Найчастіше · цього тижня' }),
    ).toBeTruthy();
    expect(text(workouts)).toContain('Верх тіла');
  });

  it('nutrition: the goal, two averages in a strip and no «Період» cell', () => {
    renderView();
    const nutrition = region('Харчування');
    expect(text(nutrition)).toContain('ціль 1 700 ккал');
    const terms = [...nutrition.querySelectorAll('dt')].map((dt) => dt.textContent);
    expect(terms).toEqual(['Сер. цього тижня', 'Сер. цього місяця']);
    expect([...nutrition.querySelectorAll('dd')].map((dd) => text(dd))).toEqual(['1 650ккал', '1 625ккал']);
  });
});

describe('ProgressView — «Історія калорій»', () => {
  it('shows 3 days with the weekday, then 7 more per «Показати ще»', () => {
    renderView();
    expect(historyRows()).toHaveLength(3);
    expect(historyRows().map((r) => r.getAttribute('aria-label')?.replace(/\s+/g, ' '))).toEqual([
      '8 жовтня: 1 700 ккал. Відкрити в календарі',
      '7 жовтня: 1 500 ккал. Відкрити в календарі',
      '6 жовтня: 1 800 ккал. Відкрити в календарі',
    ]);
    expect(text(historyRows()[0]!)).toBe('Чт, 8 жовтня 1 700 ккал');
    const more = screen.getByRole('button', { name: SHOW_MORE });
    more.focus();
    fireEvent.click(more);
    expect(historyRows()).toHaveLength(10);
    // More days remain: the button stays and keeps the keyboard focus.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: SHOW_MORE }));
    fireEvent.click(screen.getByRole('button', { name: SHOW_MORE }));
    expect(historyRows()).toHaveLength(17);
    expect(screen.getByRole('button', { name: SHOW_MORE })).toBeTruthy();
  });

  it('hides «Показати ще» once every day is shown', () => {
    const data = progressData();
    // 29 September … 8 October with kcal = 10 days.
    data.days = Object.fromEntries(Object.entries(data.days).filter(([date]) => date >= '2026-09-29'));
    renderView(data);
    expect(historyRows()).toHaveLength(3);
    const more = screen.getByRole('button', { name: SHOW_MORE });
    more.focus();
    fireEvent.click(more);
    expect(historyRows()).toHaveLength(10);
    expect(screen.queryByRole('button', { name: SHOW_MORE })).toBeNull();
    // The focused button is gone: focus moves to the first newly shown day, not to <body>.
    expect(document.activeElement).toBe(historyRows()[3]);
    expect(document.activeElement?.getAttribute('aria-label')).toMatch(/^5 жовтня:/);
  });

  it('a tap that did not focus «Показати ще» leaves the focus where it was', () => {
    const data = progressData();
    data.days = Object.fromEntries(Object.entries(data.days).filter(([date]) => date >= '2026-09-29'));
    renderView(data);
    // Safari does not focus a tapped button: nothing gets focused on the last page.
    fireEvent.click(screen.getByRole('button', { name: SHOW_MORE }));
    expect(historyRows()).toHaveLength(10);
    expect(document.activeElement).toBe(document.body);
  });

  it('opens a day in the calendar', () => {
    const { memory } = renderView();
    const row = screen.getByRole('button', { name: /^7 жовтня:/ });
    expect(within(row).getByText('Ср, 7 жовтня')).toBeTruthy();
    fireEvent.click(row);
    expect(memory.history?.at(-1)).toBe('/calendar?date=2026-10-07');
  });
});

describe('ProgressView — a brand-new account', () => {
  it('looks intentional and offers to record a weight and measurements', () => {
    const onRecord = vi.fn();
    const { view } = renderView(freshData(), { onRecord });
    expect(screen.getAllByText(NOT_ENOUGH_DATA)).toHaveLength(2);
    expect(screen.getByText('Запиши перше зважування, щоб бачити динаміку')).toBeTruthy();
    expect(screen.getByText('Запиши заміри, щоб бачити динаміку')).toBeTruthy();
    expect(screen.getByText(NO_WORKOUTS)).toBeTruthy();
    expect(screen.getByText(NO_KCAL_IN_PERIOD)).toBeTruthy();
    expect(screen.getByText(NO_KCAL_HISTORY)).toBeTruthy();
    expect(screen.queryByRole('button', { name: SHOW_MORE })).toBeNull();
    const emptyLine = region('Цього тижня').querySelector('p')!;
    expect(text(emptyLine)).toBe('Тренувань —· сер. калорійність —· вага —· талія —· стегна —· груди —');
    expect(summaryDots(emptyLine)).toHaveLength(5);
    // «—» allows a line break after itself: the dot must still be inside the item, not start the next line.
    expectDotsInsideItems(emptyLine);
    expect(text(region('Вага'))).not.toContain('шляху');
    expect(view.container.textContent).not.toMatch(/NaN|undefined|Infinity/);

    fireEvent.click(within(region('Вага')).getByRole('button', { name: RECORD_WEIGHT }));
    expect(onRecord).toHaveBeenLastCalledWith('weight');
    fireEvent.click(within(region('Заміри тіла')).getByRole('button', { name: RECORD_MEASURE }));
    expect(onRecord).toHaveBeenLastCalledWith('measure');
    expect(onRecord).toHaveBeenCalledTimes(2);
  });

  it('has no record buttons without a handler', () => {
    renderView(freshData());
    expect(screen.queryByRole('button', { name: RECORD_WEIGHT })).toBeNull();
    expect(screen.queryByRole('button', { name: RECORD_MEASURE })).toBeNull();
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
    expect(text(region('Вага'))).toContain('Старт 68,4');
    act(() => useDataStore.setState({ data: before }));
  });

  it('opens «Контрольне зважування» / «Заміри тіла» for today from the empty charts', () => {
    const before = useDataStore.getState().data;
    act(() => useDataStore.setState({ data: freshData() }));
    const memory = memoryLocation({ path: '/progress' });
    render(
      <Router hook={memory.hook}>
        <ProgressScreen />
      </Router>,
    );
    fireEvent.click(screen.getByRole('button', { name: RECORD_WEIGHT }));
    expect(useUiStore.getState().sheet).toMatchObject({ mode: 'weight', date: todayISO() });
    fireEvent.click(screen.getByRole('button', { name: RECORD_MEASURE }));
    expect(useUiStore.getState().sheet).toMatchObject({ mode: 'measure', date: todayISO() });
    act(() => {
      useUiStore.setState({ sheet: null });
      useDataStore.setState({ data: before });
    });
  });
});
