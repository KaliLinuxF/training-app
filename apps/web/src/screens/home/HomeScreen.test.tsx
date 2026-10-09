import { emptyData, type AppData, type DayEntry } from '@legko/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as PlatformModule from '@/lib/platform';
import { dataActions, useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { useUiStore } from '@/store/ui';
import { HomeScreen } from './HomeScreen';
import { INSTALL_HINT_KEY } from './installHint';

const mocks = vi.hoisted(() => ({ isIOS: vi.fn(() => false), isStandalone: vi.fn(() => false) }));

vi.mock('idb-keyval', () => ({ getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() }));
vi.mock('@/lib/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof PlatformModule>()),
  isIOS: mocks.isIOS,
  isStandalone: mocks.isStandalone,
}));

/** Monday 12 October 2026, 9:30 — weigh-in, measurements and a workout are due. */
const TODAY = '2026-10-12';

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

function setData(patch: Partial<AppData> = {}, online = true): void {
  const base = emptyData();
  useDataStore.setState({
    data: { ...base, settings: { ...base.settings, onboarded: true }, ...patch },
    sync: { ...initialSyncState(), loaded: true, online },
  });
}

const sheet = () => useUiStore.getState().sheet;
const banner = (title: string) => {
  const el = screen.getByText(title).parentElement?.parentElement;
  if (!el) throw new Error(`No banner «${title}»`);
  return el;
};

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 12, 9, 30));
  useUiStore.setState({ sheet: null, toast: null });
  mocks.isIOS.mockReturnValue(false);
  mocks.isStandalone.mockReturnValue(false);
  localStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('HomeScreen', () => {
  it('renders the header, hero and sections', () => {
    setData({
      weights: [
        { date: '2026-10-05', kg: 68.4 },
        { date: TODAY, kg: 65.4 },
      ],
    });
    render(<HomeScreen />);

    expect(screen.getByRole('heading', { level: 1, name: 'Доброго ранку' })).toBeTruthy();
    expect(screen.getByText('Понеділок, 12 жовтня')).toBeTruthy();
    const hero = screen.getByRole('region', { name: 'Поточна вага' });
    expect(within(hero).getByText('65,4')).toBeTruthy();
    expect(within(hero).getByText('−3,0 кг')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Цей тиждень' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Поточні заміри' })).toBeTruthy();
    expect(screen.getByText('12 жовтня — 65,4 кг')).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('«✓ Було» opens today with a workout pre-selected', () => {
    setData();
    render(<HomeScreen />);
    const today = screen.getByRole('region', { name: 'Сьогодні' });
    fireEvent.click(within(today).getByRole('button', { name: 'Було' }));
    expect(sheet()).toMatchObject({ date: TODAY, mode: 'day', patch: { trained: true } });
  });

  it('«✕ Не було» saves the day without a workout, keeping the rest, and confirms', () => {
    const saveDay = vi.spyOn(dataActions, 'saveDay').mockImplementation(() => undefined);
    const entry = day({ food: 'Борщ', kcal: 1200, notes: 'Ок', photos: ['p1'] });
    setData({ days: { [TODAY]: entry } });
    render(<HomeScreen />);

    fireEvent.click(screen.getByRole('button', { name: 'Не було' }));

    expect(saveDay).toHaveBeenCalledWith(TODAY, { ...entry, trained: false, types: [] });
    expect(useUiStore.getState().toast?.text).toBe('Відмічено: без тренування');
    expect(sheet()).toBeNull();
  });

  it('shows the workout state and marks the pressed option', () => {
    setData({ days: { [TODAY]: day({ trained: false }) } });
    render(<HomeScreen />);
    expect(screen.getByRole('group', { name: 'Тренування · Не було' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Не було' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Було' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('opens today from «Відкрити день →» and the tiles', () => {
    setData();
    render(<HomeScreen />);
    fireEvent.click(screen.getByRole('button', { name: 'Відкрити день' }));
    expect(sheet()).toMatchObject({ date: TODAY, mode: 'day', patch: undefined });

    useUiStore.setState({ sheet: null });
    fireEvent.click(screen.getByRole('button', { name: /Калорії/ }));
    expect(sheet()).toMatchObject({ mode: 'day' });
  });

  it.each([
    ['Харчування', 'day', undefined],
    ['Тренування', 'day', { trained: true }],
    ['Вага', 'weight', undefined],
    ['Заміри', 'measure', undefined],
  ])('«+ %s» opens the %s sheet', (label, mode, patch) => {
    setData();
    render(<HomeScreen />);
    // jsdom joins the caption and the label without a space («ДодатиВага»); browsers add one.
    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^Додати\\s*${label}$`) }));
    expect(sheet()).toEqual({ date: TODAY, mode, patch, key: expect.any(Number) });
  });

  it('shows due reminder banners that open their sheets', () => {
    setData();
    render(<HomeScreen />);
    fireEvent.click(within(banner('Контрольне зважування')).getByRole('button', { name: 'Записати' }));
    expect(sheet()).toMatchObject({ mode: 'weight' });
    fireEvent.click(within(banner('Заміри тіла')).getByRole('button', { name: 'Записати' }));
    expect(sheet()).toMatchObject({ mode: 'measure' });
    fireEvent.click(screen.getByRole('button', { name: 'Відмітити' }));
    expect(sheet()).toMatchObject({ mode: 'day', patch: { trained: true } });
  });

  it('asks a new user to set up first', () => {
    const base = emptyData();
    useDataStore.setState({ data: base, sync: { ...initialSyncState(), loaded: true, online: true } });
    render(<HomeScreen />);
    expect(screen.getByText('Почнімо')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Налаштувати' }));
    expect(sheet()).toMatchObject({ date: TODAY, mode: 'setup' });
  });

  it('shows the offline note', () => {
    setData({}, false);
    render(<HomeScreen />);
    expect(screen.getByRole('status').textContent).toBe('Офлайн · зміни збережено на телефоні');
  });

  describe('install hint', () => {
    it('is not shown outside iPhone Safari', () => {
      mocks.isIOS.mockReturnValue(true);
      mocks.isStandalone.mockReturnValue(true);
      setData();
      render(<HomeScreen />);
      expect(screen.queryByText('Встанови Легко на iPhone')).toBeNull();
    });

    it('opens the install guide and can be hidden for good', () => {
      mocks.isIOS.mockReturnValue(true);
      setData();
      render(<HomeScreen />);

      fireEvent.click(screen.getByRole('button', { name: 'Як?' }));
      expect(sheet()).toMatchObject({ mode: 'install' });

      fireEvent.click(screen.getByRole('button', { name: 'Сховати' }));
      expect(screen.queryByText('Встанови Легко на iPhone')).toBeNull();
      expect(localStorage.getItem(INSTALL_HINT_KEY)).toBe('1');

      cleanup();
      render(<HomeScreen />);
      expect(screen.queryByText('Встанови Легко на iPhone')).toBeNull();
    });

    it('still shows when storage is blocked', () => {
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
});
