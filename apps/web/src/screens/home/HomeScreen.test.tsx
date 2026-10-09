import { type AppData, type DayEntry } from '@legko/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PlatformModule from '@/lib/platform';
import { dataActions, getAppData, resetLocal, useDataStore } from '@/store/data';
import { NO_TRAINING_TOAST, TRAINED_TOAST } from '@/store/dayMarks';
import { initialSyncState } from '@/store/state';
import { fakeIdb, sampleData } from '@/store/test-utils';
import { useUiStore } from '@/store/ui';
import { cssRules, cssValue, readCss } from '@/ui/internal/cssSource';
import { HomeScreen } from './HomeScreen';
import { INSTALL_HINT_KEY } from './installHint';

const mocks = vi.hoisted(() => ({
  isIOS: vi.fn(() => false),
  isStandalone: vi.fn(() => false),
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() },
}));

vi.mock('idb-keyval', () => mocks.idb);
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  isIOS: mocks.isIOS,
  isStandalone: mocks.isStandalone,
}));

/** Monday 12 October 2026, 9:30 — weigh-in, measurements and a workout are scheduled today. */
const TODAY = '2026-10-12';

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

/** Two weigh-ins (68,3 → 65,4, none today) and one measurement — the Monday rows are due. */
const WEIGHTS = [
  { date: '2026-09-28', kg: 68.3 },
  { date: '2026-10-05', kg: 65.4 },
];

function setData(patch: Partial<AppData> = {}, online = true): void {
  useDataStore.setState({
    data: sampleData(patch),
    sync: { ...initialSyncState(), loaded: true, online },
  });
}

function setNewUser(): void {
  const data = sampleData();
  useDataStore.setState({
    data: { ...data, settings: { ...data.settings, onboarded: false } },
    sync: { ...initialSyncState(), loaded: true, online: true },
  });
}

const sheet = () => useUiStore.getState().sheet;
const toast = () => useUiStore.getState().toast?.text ?? null;
const todayRegion = () => screen.getByRole('region', { name: 'Сьогодні' });
const row = (title: string) => within(todayRegion()).getByRole('button', { name: new RegExp(`^${title}`) });
const toggle = (name: 'Було' | 'Не було') => within(todayRegion()).getByRole('button', { name });
/** The row's list item (the row button plus its trailing toggle). */
const item = (title: string) => {
  const li = row(title).closest('li');
  if (!li) throw new Error(`no list item for «${title}»`);
  return li;
};
const nb = (text: string | null | undefined) => text?.replace(/\s/g, ' ');

beforeEach(async () => {
  const idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  await resetLocal();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 12, 9, 30));
  useUiStore.setState({ sheet: null, toast: null });
  mocks.isIOS.mockReturnValue(false);
  mocks.isStandalone.mockReturnValue(false);
  localStorage.clear();
});

afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await resetLocal();
});

describe('HomeScreen — rendering', () => {
  it('shows the header, the hero, the four «Сьогодні» rows and the week link', () => {
    setData({ weights: WEIGHTS, days: { '2026-10-12': day({ food: 'Борщ', kcal: 1240 }) } });
    render(<HomeScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'Доброго ранку' })).toBeTruthy();
    expect(screen.getByText('Понеділок, 12 жовтня')).toBeTruthy();

    const hero = screen.getByRole('region', { name: 'Поточна вага' });
    expect(within(hero).getByText('65,4')).toBeTruthy();
    expect(within(hero).getByText('−2,9 кг')).toBeTruthy();
    expect(hero.textContent).toContain('35% шляху');
    expect(nb(hero.textContent)).toContain('до цілі 5,4 кг');

    const today = todayRegion();
    expect(within(today).getByRole('heading', { level: 2, name: 'Сьогодні' })).toBeTruthy();
    for (const title of ['Їжа', 'Тренування', 'Вага', 'Заміри']) expect(row(title)).toBeTruthy();
    expect(nb(row('Їжа').getAttribute('aria-label'))).toBe('Їжа: 1 240 з 1 700 ккал, залишилось 460');
    expect(nb(item('Їжа').textContent)).toContain('1 240 / 1 700 ккал');

    const week = screen.getByRole('link', { name: /^Тиждень/ });
    expect(week.getAttribute('href')).toBe('/progress?period=week');
    expect(nb(week.textContent)).toContain('0 з 3 трен. · сер. 1 240 ккал');
    expect(nb(week.getAttribute('aria-label'))).toBe(
      'Тиждень: 0 з 3 тренувань, середня калорійність 1 240 ккал. Відкрити прогрес',
    );

    // The old blocks are gone.
    expect(screen.queryByRole('heading', { name: 'Цей тиждень' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Поточні заміри' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Додати/ })).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps the focus order: Відкрити день → Їжа → Тренування → Було → Не було → Вага → Заміри → Тиждень', () => {
    setData({ weights: WEIGHTS });
    const { container } = render(<HomeScreen />);
    // Name = aria-label, else the visually hidden name of the ✓ / ✕ glyph buttons, else the text.
    const names = [...container.querySelectorAll('button, a[href]')].map(
      (el) =>
        el.getAttribute('aria-label') ??
        el.querySelector('.visually-hidden')?.textContent ??
        el.textContent ??
        '',
    );
    const order = ['Відкрити день', 'Їжа', 'Тренування', 'Було', 'Не було', 'Вага', 'Заміри', 'Тиждень'];
    const positions = order.map((name) => names.findIndex((n) => n.startsWith(name)));
    expect(positions.every((p) => p >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it('shows the recorded-without-kcal state and the over-goal state', () => {
    setData({ days: { [TODAY]: day({ food: 'Вівсянка з бананом, кава' }) } });
    const { unmount } = render(<HomeScreen />);
    expect(item('Їжа').textContent).toContain('Записано');
    expect(item('Їжа').textContent).toContain('Калорії не вказані');
    expect(item('Їжа').textContent).not.toContain('/');
    expect(row('Їжа').getAttribute('aria-label')?.replace(/\s/g, ' ')).toBe(
      'Їжа: записано, калорії не вказані. Ціль 1 700 ккал на день',
    );
    unmount();

    setData({ days: { [TODAY]: day({ food: 'Піца', kcal: 1820 }) } });
    render(<HomeScreen />);
    expect(nb(item('Їжа').textContent)).toContain('1 820 / 1 700 ккал');
    expect(nb(row('Їжа').getAttribute('aria-label'))).toMatch(/^Їжа: Перевищено ціль на 120 ккал/);
  });

  it('shows the weekly rows: «Сьогодні» pill when due, the next date otherwise', () => {
    setData({ weights: WEIGHTS, measures: [{ date: '2026-10-05', chest: 90, waist: 70, hips: 98 }] });
    render(<HomeScreen />);
    expect(item('Вага').textContent).toContain('5 жовтня — 65,4 кг');
    expect(item('Вага').textContent).toContain('Сьогодні');
    expect(item('Заміри').textContent).toContain('Груди 90 · Талія 70 · Стегна 98');
    expect(row('Вага').getAttribute('aria-label')).toBe(
      'Вага: зважування сьогодні о 08:00. Останнє зважування 5 жовтня — 65,4 кг',
    );
  });
});

describe('HomeScreen — opening sheets', () => {
  it.each([
    ['Їжа', 'food'],
    ['Тренування', 'workout'],
    ['Вага', 'weight'],
    ['Заміри', 'measure'],
  ])('the «%s» row opens the %s sheet for today, without a patch', (title, mode) => {
    setData();
    render(<HomeScreen />);
    fireEvent.click(row(title));
    expect(sheet()).toEqual({ date: TODAY, mode, patch: undefined, key: expect.any(Number) });
  });

  it('«Відкрити день →» opens the full day', () => {
    setData();
    render(<HomeScreen />);
    fireEvent.click(within(todayRegion()).getByRole('button', { name: 'Відкрити день' }));
    expect(sheet()).toEqual({ date: TODAY, mode: 'day', patch: undefined, key: expect.any(Number) });
  });
});

describe('HomeScreen — inline ✓ / ✕', () => {
  it('«Було» saves a workout at once, keeping types and food, and toasts — no sheet', () => {
    const entry = day({
      food: 'Борщ',
      kcal: 1200,
      notes: 'Ок',
      types: ['Кардіо'],
      photos: ['photo0000000000001'],
    });
    setData({ days: { [TODAY]: entry } });
    render(<HomeScreen />);

    fireEvent.click(toggle('Було'));

    expect(getAppData().days[TODAY]).toEqual({ ...entry, trained: true });
    expect(toast()).toBe(TRAINED_TOAST);
    expect(toast()).toBe('Відмічено: тренування було');
    expect(sheet()).toBeNull();
    expect(toggle('Було').getAttribute('aria-pressed')).toBe('true');
    expect(toggle('Не було').getAttribute('aria-pressed')).toBe('false');
    expect(item('Тренування').textContent).toContain('Кардіо');
  });

  it('«Було» without types nudges to add one', () => {
    setData();
    render(<HomeScreen />);
    fireEvent.click(toggle('Було'));
    expect(getAppData().days[TODAY]).toEqual(day({ trained: true }));
    expect(item('Тренування').textContent).toContain('Було · додай тип');
  });

  it('«Не було» saves no workout, clears the types and toasts', () => {
    const entry = day({ food: 'Борщ', kcal: 1200, trained: true, types: ['Кардіо', 'Прес'] });
    setData({ days: { [TODAY]: entry } });
    render(<HomeScreen />);

    fireEvent.click(toggle('Не було'));

    expect(getAppData().days[TODAY]).toEqual({ ...entry, trained: false, types: [] });
    expect(toast()).toBe(NO_TRAINING_TOAST);
    expect(toast()).toBe('Відмічено: без тренування');
    expect(sheet()).toBeNull();
    expect(toggle('Не було').getAttribute('aria-pressed')).toBe('true');
    expect(item('Тренування').textContent).toContain('Не було');
  });

  it('pressing the already pressed option saves nothing and stays quiet', () => {
    setData({ days: { [TODAY]: day({ trained: false }) } });
    const save = vi.spyOn(dataActions, 'saveDay');
    render(<HomeScreen />);
    fireEvent.click(toggle('Не було'));
    expect(save).not.toHaveBeenCalled();
    expect(toast()).toBeNull();
    expect(sheet()).toBeNull();
  });

  it('a refused save does not claim success', () => {
    setData();
    const save = vi.spyOn(dataActions, 'saveDay').mockReturnValue(false);
    render(<HomeScreen />);
    fireEvent.click(toggle('Було'));
    expect(save).toHaveBeenCalledExactlyOnceWith(TODAY, day({ trained: true }));
    expect(toast()).toBeNull();
    expect(sheet()).toBeNull();
  });

  it('the toggle is a sibling of the row button (no button inside a button)', () => {
    setData();
    render(<HomeScreen />);
    const region = todayRegion();
    expect(region.querySelectorAll('button button, button a, a button, a a')).toHaveLength(0);
    const group = within(region).getByRole('group', { name: 'Тренування сьогодні' });
    expect(row('Тренування').contains(group)).toBe(false);
    expect(item('Тренування').contains(group)).toBe(true);
    for (const name of ['Було', 'Не було'] as const) {
      expect(within(group).getByRole('button', { name }).getAttribute('aria-pressed')).toBe('false');
    }
  });
});

describe('HomeScreen — banners', () => {
  it('reminders live in the rows: no «Записати» / «Відмітити» banners on a Monday', () => {
    setData({ weights: WEIGHTS });
    render(<HomeScreen />);
    expect(item('Вага').textContent).toContain('Сьогодні');
    expect(item('Заміри').textContent).toContain('Сьогодні');
    expect(item('Тренування').textContent).toContain('За планом о 18:00');
    expect(screen.queryByRole('button', { name: 'Записати' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Відмітити' })).toBeNull();
    expect(screen.queryByText('Контрольне зважування')).toBeNull();
  });

  it('before the first weigh-in the hero shows a lone «—» without «кг»', () => {
    setData({ weights: [] });
    render(<HomeScreen />);
    const hero = screen.getByRole('region', { name: 'Поточна вага' });
    expect(within(hero).getByText('—')).toBeTruthy();
    expect(within(hero).queryByText('кг')).toBeNull();
    expect(within(hero).getByText(/^Ціль /)).toBeTruthy();
    expect(hero.textContent).not.toContain('шляху');
  });

  it('a new user in iPhone Safari sees only «Почнімо»', () => {
    mocks.isIOS.mockReturnValue(true);
    setNewUser();
    render(<HomeScreen />);
    expect(screen.getByText('Почнімо')).toBeTruthy();
    expect(screen.getByText('Запиши стартову вагу й ціль')).toBeTruthy();
    expect(screen.queryByText(/прогрес рахуватиметься/)).toBeNull();
    expect(screen.queryByText('Встанови Легко на iPhone')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Сховати' })).toBeNull();
    // Not due before the setup: no «Сьогодні» pill, no «За планом».
    expect(item('Тренування').textContent).toContain('Ще не відмічено');

    fireEvent.click(screen.getByRole('button', { name: 'Налаштувати' }));
    expect(sheet()).toMatchObject({ date: TODAY, mode: 'setup', patch: undefined });
  });

  describe('install hint', () => {
    it('is not shown outside iPhone Safari', () => {
      mocks.isIOS.mockReturnValue(true);
      mocks.isStandalone.mockReturnValue(true);
      setData();
      render(<HomeScreen />);
      expect(screen.queryByText('Встанови Легко на iPhone')).toBeNull();
    });

    it('«Як?» opens the install guide; «Сховати» hides it for good', () => {
      mocks.isIOS.mockReturnValue(true);
      setData();
      render(<HomeScreen />);
      expect(screen.getByText('Так працюватимуть нагадування')).toBeTruthy();

      fireEvent.click(screen.getByRole('button', { name: 'Як?' }));
      expect(sheet()).toMatchObject({ date: TODAY, mode: 'install' });

      fireEvent.click(screen.getByRole('button', { name: 'Сховати' }));
      expect(screen.queryByText('Встанови Легко на iPhone')).toBeNull();
      expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe('1');

      cleanup();
      render(<HomeScreen />);
      expect(screen.queryByText('Встанови Легко на iPhone')).toBeNull();
    });

    it('still shows (and hides) when storage is blocked', () => {
      mocks.isIOS.mockReturnValue(true);
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
        throw new Error('SecurityError');
      });
      setData();
      render(<HomeScreen />);
      expect(screen.getByText('Встанови Легко на iPhone')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Сховати' }));
      expect(screen.queryByText('Встанови Легко на iPhone')).toBeNull();
    });
  });

  it('keeps the offline note', () => {
    setData({}, false);
    render(<HomeScreen />);
    expect(screen.getByRole('status').textContent).toBe('Офлайн · зміни збережено на телефоні');
  });
});

describe('HomeScreen styles', () => {
  const DESKTOP = '(min-width: 900px) and (hover: hover) and (pointer: fine)';
  const WIDE = '(min-width: 1060px) and (hover: hover) and (pointer: fine)';
  const css = readCss('screens/home/HomeScreen.module.css');

  it('stacks hero, «Сьогодні» and week across the desktop grid below 1060px', () => {
    for (const sel of ['.hero', '.today', '.week'])
      expect(cssValue(css, sel, 'grid-column', DESKTOP)).toBe('1 / -1');
  });

  it('puts hero and week in column 1 and «Сьогодні» in column 2 from 1060px', () => {
    expect(cssValue(css, '.hero', 'grid-column', WIDE)).toBe('1');
    expect(cssValue(css, '.today', 'grid-column', WIDE)).toBe('2');
    expect(cssValue(css, '.today', 'grid-row', WIDE)).toBe('span 2');
    expect(cssValue(css, '.week', 'grid-column', WIDE)).toBe('1');
    // The week's own row plus an empty one take the taller «Сьогодні»'s extra height, not the hero row.
    expect(cssValue(css, '.week', 'grid-row', WIDE)).toBe('span 2');
    expect(cssValue(css, '.hero', 'grid-row', WIDE)).toBeUndefined();
  });

  it('gives the blocks no fixed heights and leaves the ghost button hit area to the kit', () => {
    const BLOCKS = ['.hero', '.hero.hero', '.today', '.week', '.top', '.line'];
    for (const file of ['HomeScreen', 'TodayCard', 'HeroCard']) {
      for (const rule of cssRules(readCss(`screens/home/${file}.module.css`))) {
        expect(rule.selector, `${file}: no ::after tap-area patches`).not.toContain('::after');
        if (!rule.selector.split(',').some((sel) => BLOCKS.includes(sel.trim()))) continue;
        expect(rule.decls.height, `${file} ${rule.selector}`).toBeUndefined();
        expect(rule.decls['max-height'], `${file} ${rule.selector}`).toBeUndefined();
      }
    }
  });
});
