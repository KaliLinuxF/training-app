import { emptyData, type AppData } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { fakeIdb } from '@/store/test-utils';
import { ui, useUiStore } from '@/store/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { DISCARD_PROMPT } from './helpers';
import { resetSetupShownForTests } from './setupGate';
import { SheetHost } from './SheetHost';
import { FIELD_ERRORS } from './validation';

const TODAY = '2026-10-10';

const mocks = vi.hoisted(() => ({ idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() } }));
vi.mock('idb-keyval', () => mocks.idb);
vi.mock('@/lib/useToday', () => ({ useToday: () => '2026-10-10' }));
// The food feature is built separately; stand-ins with the documented props.
vi.mock('@/features/food', () => ({
  FoodAssist: ({ onAdd }: { onAdd: (add: unknown) => void }) => (
    <button
      type="button"
      onClick={() => onAdd({ line: 'Борщ — 420 ккал', kcal: 420, photoId: 'photo_bbbbbbbbbbbbbbbb', items: [] })}
    >
      test-add-food
    </button>
  ),
  PhotoStrip: ({ ids, onRemove }: { ids: readonly string[]; onRemove?: (id: string) => void }) => (
    <ul aria-label="test-photos">
      {ids.map((id) => (
        <li key={id}>
          <button type="button" onClick={() => onRemove?.(id)}>
            remove {id}
          </button>
        </li>
      ))}
    </ul>
  ),
}));

function seed(): AppData {
  const data = emptyData();
  data.settings = { ...data.settings, onboarded: true, customTypes: ['Йога'] };
  data.days['2026-10-09'] = { food: 'Омлет', kcal: 1500, trained: false, types: [], notes: '' };
  data.weights = [{ date: '2026-10-03', kg: 65.6 }];
  data.measures = [{ date: '2026-10-03', chest: 92, waist: 72, hips: 100 }];
  return data;
}

function setData(data: AppData) {
  useDataStore.setState({ data, sync: { ...initialSyncState(), online: true, loaded: true, lastSyncedAt: 1 } });
}

const data = (): AppData => useDataStore.getState().data;
const dialog = () => screen.getByRole('dialog');
const saveButton = () => screen.getByRole('button', { name: 'Зберегти' });

function renderHost(path = '/') {
  const memory = memoryLocation({ path, record: true });
  render(
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      <SheetHost />
    </Router>,
  );
  return memory;
}

beforeAll(() => installMatchMedia());
beforeEach(() => {
  stubScrollTo();
  const idb = fakeIdb();
  mocks.idb.getMany.mockImplementation(idb.getMany);
  mocks.idb.setMany.mockImplementation(idb.setMany);
  mocks.idb.delMany.mockImplementation(idb.delMany);
  useUiStore.setState({ sheet: null, toast: null });
  setData(seed());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetSetupShownForTests();
});

describe('deep links', () => {
  it('opens the weigh-in sheet for today with the latest weight and cleans the URL', () => {
    const memory = renderHost('/?sheet=weight');
    expect(screen.getByRole('dialog', { name: 'Контрольне зважування' })).toBeTruthy();
    expect(screen.getByText('10 жовтня 2026')).toBeTruthy();
    expect(screen.getByText('субота · сьогодні')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Вага' }) as HTMLInputElement).value).toBe('65,6');
    expect(screen.getByText('Попереднє: 3 жовтня — 65,6 кг')).toBeTruthy();
    expect(memory.history.at(-1)).toBe('/');
  });

  it('reacts when the query changes while mounted (notification tap)', () => {
    const memory = renderHost('/');
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => memory.navigate('/?sheet=day&trained=1'));
    expect(screen.getByRole('dialog', { name: 'Запис дня' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Було' }).getAttribute('aria-pressed')).toBe('true');
    expect(memory.history.at(-1)).toBe('/');
  });
});

describe('day record', () => {
  it('records a workout with a new custom type, food from the assistant and saves', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));

    fireEvent.click(screen.getByRole('button', { name: 'Було' }));
    fireEvent.click(screen.getByRole('button', { name: 'Кардіо' }));
    expect(screen.getByRole('button', { name: 'Кардіо' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '+ Свій тип' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Новий тип тренування' }), { target: { value: 'Пілатес' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати тип' }));
    expect(screen.getByRole('button', { name: 'Пілатес' }).getAttribute('aria-pressed')).toBe('true');
    expect(data().settings.customTypes).toEqual(['Йога', 'Пілатес']);

    fireEvent.change(screen.getByRole('textbox', { name: 'Що я їла' }), { target: { value: 'Вівсянка' } });
    fireEvent.click(screen.getByRole('button', { name: 'test-add-food' }));
    expect((screen.getByRole('textbox', { name: 'Що я їла' }) as HTMLTextAreaElement).value).toBe('Вівсянка\nБорщ — 420 ккал');
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 50 ккал' }));
    expect((screen.getByRole('textbox', { name: 'Калорії за день' }) as HTMLInputElement).value).toBe('470');

    fireEvent.change(screen.getByRole('textbox', { name: 'Нотатки' }), { target: { value: 'Легко' } });
    fireEvent.click(saveButton());

    expect(data().days[TODAY]).toEqual({
      food: 'Вівсянка\nБорщ — 420 ккал',
      kcal: 470,
      trained: true,
      types: ['Кардіо', 'Пілатес'],
      notes: 'Легко',
      photos: ['photo_bbbbbbbbbbbbbbbb'],
    });
    expect(useUiStore.getState().sheet).toBeNull();
    expect(useUiStore.getState().toast?.text).toBe('Збережено');
  });

  it('Escape in the new-type input cancels it without closing the sheet', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day', { trained: true }));
    fireEvent.click(screen.getByRole('button', { name: '+ Свій тип' }));
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Новий тип тренування' }), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Новий тип тренування' })).toBeNull();
    expect(useUiStore.getState().sheet).not.toBeNull();
  });

  it('shows inline errors and blocks saving out-of-range values', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Вага (за бажанням)' }), { target: { value: '500' } });
    expect(screen.getByText(FIELD_ERRORS.kg)).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: 'Вага (за бажанням)' }), { target: { value: '64,8' } });
    fireEvent.change(screen.getByRole('textbox', { name: /^Талія/ }), { target: { value: '5' } });
    expect(screen.getByText(FIELD_ERRORS.cm)).toBeTruthy();
    expect(screen.getByRole('textbox', { name: /^Талія/ }).getAttribute('aria-invalid')).toBe('true');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(screen.getByRole('textbox', { name: /^Талія/ }), { target: { value: '71' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Калорії за день' }), { target: { value: '25 000' } });
    expect((screen.getByRole('textbox', { name: 'Калорії за день' }) as HTMLInputElement).value).toBe('25000');
    expect(screen.getByText(FIELD_ERRORS.kcal)).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox', { name: 'Калорії за день' }), { target: { value: '1600' } });

    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(data().weights.at(-1)).toEqual({ date: TODAY, kg: 64.8 });
    expect(data().measures.at(-1)).toEqual({ date: TODAY, chest: null, waist: 71, hips: null });
    expect(data().days[TODAY]?.kcal).toBe(1600);
  });

  it('navigates days, re-initialising the draft; › is disabled at today', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    expect((screen.getByRole('button', { name: 'Наступний день' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
    expect(screen.getByText('9 жовтня 2026')).toBeTruthy();
    expect(screen.getByText('пʼятниця')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Що я їла' }) as HTMLTextAreaElement).value).toBe('Омлет');
    expect(screen.getByRole('button', { name: 'Не було' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Наступний день' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('asks before throwing away unsaved changes (close and day navigation)', () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));

    // Clean draft: closes without asking.
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(useUiStore.getState().sheet).toBeNull();

    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(screen.getByRole('textbox', { name: 'Нотатки' }), { target: { value: 'Сон 8 год' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(confirm).toHaveBeenCalledWith(DISCARD_PROMPT);
    expect(useUiStore.getState().sheet).not.toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(screen.getByText('10 жовтня 2026')).toBeTruthy();

    confirm.mockReturnValue(true);
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(useUiStore.getState().sheet).toBeNull();
    expect(data().days[TODAY]).toBeUndefined();
  });

  it('removes an attached photo', () => {
    const seeded = seed();
    seeded.days[TODAY] = { food: 'Салат', kcal: 300, trained: null, types: [], notes: '', photos: ['photo_aaaaaaaaaaaaaaaa'] };
    setData(seeded);
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.click(screen.getByRole('button', { name: 'remove photo_aaaaaaaaaaaaaaaa' }));
    fireEvent.click(saveButton());
    expect(data().days[TODAY]).toEqual({ food: 'Салат', kcal: 300, trained: null, types: [], notes: '' });
  });
});

describe('weight and measure sheets', () => {
  it('measure sheet saves only the measurements, with previous values as placeholders', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'measure'));
    expect(screen.getByRole('dialog', { name: 'Заміри тіла' })).toBeTruthy();
    expect(screen.getByText('Груди · талія · стегна')).toBeTruthy();
    const waist = screen.getByRole('textbox', { name: /^Талія/ }) as HTMLInputElement;
    expect(waist.placeholder).toBe('72');
    fireEvent.change(waist, { target: { value: '71,5' } });
    fireEvent.click(saveButton());
    expect(data().measures.at(-1)).toEqual({ date: TODAY, chest: null, waist: 71.5, hips: null });
    expect(data().days[TODAY]).toBeUndefined();
    expect(data().weights).toHaveLength(1);
  });

  it('weight sheet steps from the pre-filled weight', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'weight'));
    fireEvent.click(screen.getByRole('button', { name: 'Мінус 0,1 кг' }));
    fireEvent.click(saveButton());
    expect(data().weights.at(-1)).toEqual({ date: TODAY, kg: 65.5 });
  });
});

describe('setup sheet', () => {
  it('opens once for a new account and «Почати» saves the goals and today’s weight', () => {
    setData(emptyData());
    renderHost();
    expect(screen.getByRole('dialog', { name: 'Налаштування' })).toBeTruthy();
    expect(screen.getByText(/Ці дані потрібні, щоб рахувати прогрес/)).toBeTruthy();

    fireEvent.change(screen.getByRole('textbox', { name: 'Поточна вага' }), { target: { value: '72,4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Мінус 0,5 кг' }));
    expect((screen.getByRole('textbox', { name: 'Цільова вага' }) as HTMLInputElement).value).toBe('59,5');
    fireEvent.change(screen.getByRole('textbox', { name: 'Калорії на день' }), { target: { value: '1600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Почати' }));

    expect(data().weights).toEqual([{ date: TODAY, kg: 72.4 }]);
    expect(data().settings).toMatchObject({ goal: 59.5, kcalGoal: 1600, onboarded: true });
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('is not offered again in the same session after being dismissed', () => {
    setData(emptyData());
    renderHost();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(useUiStore.getState().sheet).toBeNull();
    cleanup();
    renderHost();
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('marks an existing account as onboarded without asking', () => {
    const old = seed();
    old.settings.onboarded = false;
    setData(old);
    renderHost();
    expect(useUiStore.getState().sheet).toBeNull();
    expect(data().settings.onboarded).toBe(true);
  });
});

describe('install sheet', () => {
  it('shows the four steps with the share icon', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'install'));
    const sheet = screen.getByRole('dialog', { name: 'Встановлення на iPhone' });
    const steps = within(sheet).getAllByRole('listitem');
    expect(steps).toHaveLength(4);
    expect(steps[0]?.textContent).toContain('fit.triple-a.dev');
    expect(steps[1]?.querySelector('svg')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Зрозуміло' }));
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('says it is already installed in the standalone app', () => {
    installMatchMedia((q) => q === '(display-mode: standalone)');
    try {
      renderHost();
      act(() => ui.openSheet(TODAY, 'install'));
      expect(screen.getByText('Готово — Легко вже встановлено ✨')).toBeTruthy();
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    } finally {
      installMatchMedia();
    }
  });
});
