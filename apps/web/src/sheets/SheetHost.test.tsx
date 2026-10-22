import { applyOps, emptyData, normalizeDay, type AppData, type Meal, type Op } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import type * as DataModule from '@/store/data';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { fakeIdb } from '@/store/test-utils';
import { ui, useUiStore } from '@/store/ui';
import { ConfirmHost, SHEET_EXIT_MS } from '@/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { SAVE_FAILED } from './fields/fields';
import { DISCARD_CONFIRM, DISCARD_ON_NAVIGATE_CONFIRM } from './helpers';
import { resetSetupShownForTests } from './setupGate';
import { SheetHost } from './SheetHost';
import { FIELD_ERRORS } from './validation';

const TODAY = '2026-10-10';

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
  /** Every `commit()` call the sheets make, in order. */
  commits: [] as Op[][],
  /** The next `commit()` is refused (nothing applied), as the store does with an op it cannot accept. */
  refuseNext: false,
}));
vi.mock('idb-keyval', () => mocks.idb);
vi.mock('@/lib/useToday', () => ({ useToday: () => '2026-10-10' }));
vi.mock('@/store/data', async (importOriginal) => {
  const actual = await importOriginal<typeof DataModule>();
  return {
    ...actual,
    commit: (...ops: Op[]) => {
      mocks.commits.push(ops);
      if (mocks.refuseNext) {
        mocks.refuseNext = false;
        return false;
      }
      return actual.commit(...ops);
    },
  };
});
// The real meal editor renders in these sheets; its AI status request never answers (no AI row).
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, foodStatus: vi.fn(() => new Promise(() => undefined)) } };
});

function seed(): AppData {
  const data = emptyData();
  data.settings = { ...data.settings, onboarded: true, customTypes: ['Йога'] };
  data.days['2026-10-09'] = { food: 'Омлет', kcal: 1500, trained: false, types: [], notes: '' };
  data.weights = [{ date: '2026-10-03', kg: 65.6 }];
  data.measures = [{ date: '2026-10-03', chest: 92, waist: 72, hips: 100 }];
  return data;
}

const LUNCH: Meal = {
  id: 'lunch0000001',
  type: 'Обід',
  time: '13:10',
  text: 'Борщ',
  kcal: 560,
  protein: 21,
  fat: 19,
  carbs: 64,
};

function setData(data: AppData) {
  useDataStore.setState({
    data,
    sync: { ...initialSyncState(), online: true, loaded: true, lastSyncedAt: 1 },
  });
}

/** What a server refresh does: the store gets another device's changes. */
function refresh(ops: Op[]) {
  act(() => useDataStore.setState((s) => ({ data: applyOps(s.data, ops) })));
}

const data = (): AppData => useDataStore.getState().data;
const dialog = () => screen.getByRole('dialog');
const saveButton = () => screen.getByRole('button', { name: 'Зберегти' });
const textbox = (name: string | RegExp) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const discardDialog = () => screen.queryByRole('alertdialog', { name: DISCARD_CONFIRM.title });
/** The day's meal list (the «Їжа» sheet and the «Запис дня» food field). */
const mealList = () => screen.getByRole('region', { name: 'Прийоми їжі' });

/** Answers the open «Є незбережені зміни» dialog (the answer resolves a promise: flush it). */
async function answer(label: string) {
  const alert = discardDialog();
  if (!alert) throw new Error('no discard question is open');
  await act(async () => {
    fireEvent.click(within(alert).getByRole('button', { name: label }));
  });
}

function renderHost(path = '/') {
  const memory = memoryLocation({ path, record: true });
  render(
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      <SheetHost />
      <ConfirmHost />
    </Router>,
  );
  return memory;
}

beforeAll(() => {
  installMatchMedia();
  // The meal editor reads the clock: 10:00 on the day the app thinks is today.
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 10, 10, 0));
});
afterAll(() => {
  vi.useRealTimers();
});
beforeEach(() => {
  stubScrollTo();
  const idb = fakeIdb();
  mocks.idb.getMany.mockImplementation(idb.getMany);
  mocks.idb.setMany.mockImplementation(idb.setMany);
  mocks.idb.delMany.mockImplementation(idb.delMany);
  mocks.idb.keys.mockImplementation(idb.keys);
  mocks.commits.length = 0;
  mocks.refuseNext = false;
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
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
    expect(textbox('Вага').value).toBe('65,6');
    expect(screen.getByText('Попереднє: 3 жовтня — 65,6 кг')).toBeTruthy();
    expect(memory.history.at(-1)).toBe('/');
  });

  it('reacts when the query changes while mounted (notification tap): the workout push opens «Тренування» with ✓', () => {
    const memory = renderHost('/');
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => memory.navigate('/?sheet=day&trained=1'));
    expect(screen.getByRole('dialog', { name: 'Тренування' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Було' }).getAttribute('aria-pressed')).toBe('true');
    // ✓ is pre-selected, so the types are offered right away.
    expect(screen.getByRole('button', { name: 'Кардіо' })).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Прийоми їжі' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Додати прийом їжі' })).toBeNull();
    expect(memory.history.at(-1)).toBe('/');
  });

  it('/?sheet=day opens the full day, /?sheet=food the day’s meals, /?sheet=workout the short sheet', () => {
    const memory = renderHost('/?sheet=day');
    expect(screen.getByRole('dialog', { name: 'Запис дня' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Було' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Додати прийом їжі' })).toBeTruthy();
    expect(memory.history.at(-1)).toBe('/');

    act(() => memory.navigate('/?sheet=food'));
    expect(screen.getByRole('dialog', { name: 'Їжа' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Підсумок дня' })).toBeTruthy();
    act(() => memory.navigate('/?sheet=workout'));
    expect(screen.getByRole('dialog', { name: 'Тренування' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Було' }).getAttribute('aria-pressed')).toBe('false');
    act(() => memory.navigate('/?sheet=menu'));
    expect(memory.history.at(-1)).toBe('/');
    expect(screen.getByRole('dialog', { name: 'Тренування' })).toBeTruthy();
  });

  it('a new meal is not linkable: /?sheet=meal is ignored and cleaned', () => {
    const memory = renderHost('/?sheet=meal');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(memory.history.at(-1)).toBe('/');
  });

  it('a notification tap over a new meal she is typing asks first', async () => {
    const memory = renderHost('/');
    act(() => ui.openSheet(TODAY, 'meal'));
    fireEvent.change(textbox('Що я їла'), { target: { value: 'Борщ' } });
    act(() => memory.navigate('/?sheet=day&trained=1'));
    expect(discardDialog()).toBeTruthy();
    await answer('Залишитись');
    expect(screen.getByRole('dialog', { name: 'Прийом їжі' })).toBeTruthy();
    expect(textbox('Що я їла').value).toBe('Борщ');

    act(() => memory.navigate('/?sheet=day&trained=1'));
    await answer('Закрити');
    expect(screen.getByRole('dialog', { name: 'Тренування' })).toBeTruthy();
    expect(data().days[TODAY]).toBeUndefined();
  });

  it('a notification tap over a sheet with unsaved changes asks first', async () => {
    const memory = renderHost('/');
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(textbox('Нотатки'), { target: { value: 'Сон 8 год, ще пишу…' } });

    act(() => memory.navigate('/?sheet=day&trained=1'));
    expect(memory.history.at(-1)).toBe('/');
    expect(discardDialog()).toBeTruthy();
    expect(screen.getByText(DISCARD_CONFIRM.body ?? '')).toBeTruthy();
    await answer('Залишитись');
    expect(discardDialog()).toBeNull();
    expect(textbox('Нотатки').value).toBe('Сон 8 год, ще пишу…');

    act(() => memory.navigate('/?sheet=weight'));
    await answer('Закрити');
    expect(screen.getByRole('dialog', { name: 'Контрольне зважування' })).toBeTruthy();
    expect(data().days[TODAY]).toBeUndefined();
  });

  it('replaces a clean sheet without asking', () => {
    const memory = renderHost('/');
    act(() => ui.openSheet(TODAY, 'measure'));
    act(() => memory.navigate('/?sheet=weight'));
    expect(discardDialog()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Контрольне зважування' })).toBeTruthy();
  });

  it('on a brand-new account the linked sheet goes first and the setup follows when it closes', () => {
    setData(emptyData());
    renderHost('/?sheet=weight');
    expect(screen.getByRole('dialog', { name: 'Контрольне зважування' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Перші кроки' })).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(screen.getByRole('dialog', { name: 'Перші кроки' })).toBeTruthy();
  });
});

/** The «Що записати?» row whose name starts with `title` («Їжа Новий прийом їжі 1 500 ккал»). */
const menuRow = (title: string) => within(dialog()).getByRole('button', { name: new RegExp(`^${title}`) });

/** Taps a row like a finger or Enter would: the row has focus, and it is gone after the swap. */
function pick(title: string) {
  const row = menuRow(title);
  act(() => row.focus());
  fireEvent.click(row);
}

describe('«Що записати?» menu', () => {
  it('lists the four actions and «Повний запис дня» — no date navigator, no «Зберегти»', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    const menu = screen.getByRole('dialog', { name: 'Що записати?' });
    for (const title of ['Їжа', 'Тренування', 'Вага', 'Заміри']) expect(menuRow(title)).toBeTruthy();
    expect(within(menu).getByRole('button', { name: 'Повний запис дня' }).textContent).toBe(
      'Повний запис дня →',
    );
    expect(within(menu).getByRole('button', { name: /^Їжа/ }).textContent).toContain('Новий прийом їжі');
    expect(within(menu).queryByRole('button', { name: 'Зберегти' })).toBeNull();
    expect(within(menu).queryByRole('button', { name: 'Попередній день' })).toBeNull();
    expect(within(menu).queryByRole('textbox')).toBeNull();
    // Tab order: ✕, the four rows, «Повний запис дня».
    expect(
      within(menu)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label') ?? b.textContent?.split(' ')[0]),
    ).toEqual(['Закрити', 'Їжа', 'Тренування', 'Вага', 'Заміри', 'Повний запис дня']);
    // Today: no date line.
    expect(within(menu).queryByText(/жовтня ·/)).toBeNull();
  });

  it('shows what the day already has, and a «За планом» pill on a planned workout day', () => {
    const seeded = seed();
    seeded.settings.rem.workout = { on: true, days: [6], time: '18:00' };
    seeded.days[TODAY] = { food: 'Салат', kcal: 1240, trained: null, types: [], notes: '' };
    seeded.weights.push({ date: TODAY, kg: 65.4 });
    setData(seeded);
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    expect(menuRow('Їжа').textContent?.replace(/\s/g, ' ')).toContain('1 240 ккал');
    expect(menuRow('Тренування').textContent).toContain('За планом');
    expect(menuRow('Вага').textContent).toContain('65,4 кг');
    expect(menuRow('Заміри').textContent).not.toContain('Сьогодні');
  });

  it('a meal without kcal reads «Записано» on the Їжа row, like Home', () => {
    const seeded = seed();
    seeded.days[TODAY] = {
      food: 'Вівсянка з бананом, кава',
      kcal: null,
      trained: null,
      types: [],
      notes: '',
    };
    setData(seeded);
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    expect(menuRow('Їжа').textContent).toContain('Записано');
    expect(menuRow('Їжа').textContent).not.toContain('ккал');
  });

  it('a menu for a past day shows its date and passes that date on', () => {
    renderHost();
    act(() => ui.openSheet('2026-10-09', 'menu'));
    expect(within(dialog()).getByText('9 жовтня · пʼятниця')).toBeTruthy();
    expect(menuRow('Їжа').textContent?.replace(/\s/g, ' ')).toContain('1 500 ккал');
    expect(menuRow('Тренування').textContent).toContain('✕ Не було');

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Повний запис дня' }));
    expect(screen.getByRole('dialog', { name: 'Запис дня' })).toBeTruthy();
    expect(screen.getByText('9 жовтня 2026')).toBeTruthy();
    expect(within(mealList()).getByRole('button', { name: /^Їжа за день: омлет/ })).toBeTruthy();
    expect(useUiStore.getState().sheet).toMatchObject({ date: '2026-10-09', mode: 'day' });
  });

  it('«Повний запис дня» swaps to every block of «Запис дня» for today', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    const menu = dialog();
    fireEvent.click(within(menu).getByRole('button', { name: 'Повний запис дня' }));
    expect(dialog()).toBe(menu);
    expect(screen.getByRole('dialog', { name: 'Запис дня' })).toBeTruthy();
    expect(screen.getByText('10 жовтня 2026')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Тренування' })).toBeTruthy();
    // The food is the day's meal list (nothing yet) with «+ Прийом їжі»; no food text or day kcal any more.
    expect(screen.getByText('Ще нічого не записано')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Додати прийом їжі' })).toBeTruthy();
    expect(screen.queryByRole('textbox', { name: 'Що я їла' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Калорії за день' })).toBeNull();
    for (const name of ['Вага (за бажанням)', 'Нотатки']) expect(textbox(name)).toBeTruthy();
    expect(textbox(/^Талія/)).toBeTruthy();
  });

  it('closes on «Закрити» and on Escape without asking (nothing to lose)', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(discardDialog()).toBeNull();
    expect(useUiStore.getState().sheet).toBeNull();

    act(() => ui.openSheet(TODAY, 'menu'));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(discardDialog()).toBeNull();
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('a notification tap over the open menu just opens the linked sheet', () => {
    const memory = renderHost('/');
    act(() => ui.openSheet(TODAY, 'menu'));
    const menu = dialog();
    act(() => memory.navigate('/?sheet=weight'));
    expect(discardDialog()).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Контрольне зважування' })).toBe(menu);
  });

  it('a row swaps in place: the same dialog, scrolled to the top, focus on the dialog', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    const menu = screen.getByRole('dialog', { name: 'Що записати?' });
    Object.defineProperty(menu, 'scrollTop', { value: 120, writable: true, configurable: true });

    pick('Вага');

    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByRole('dialog', { name: 'Контрольне зважування' })).toBe(menu);
    expect(menu.scrollTop).toBe(0);
    // The tapped row is gone: focus went to the dialog, not to <body>.
    expect(document.activeElement).toBe(menu);
  });

  it('Їжа swaps in place to a new meal, with «Що я їла» focused (not the dialog)', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    const menu = dialog();
    pick('Їжа');
    expect(screen.getByRole('dialog', { name: 'Прийом їжі' })).toBe(menu);
    expect(document.activeElement).toBe(textbox('Що я їла'));
    expect(useUiStore.getState().sheet).toMatchObject({ date: TODAY, mode: 'meal' });
  });

  it('leaves focus alone when it did not fall to <body>', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    const outside = document.createElement('button');
    document.body.append(outside);
    try {
      outside.focus();
      fireEvent.click(menuRow('Вага'));
      expect(document.activeElement).toBe(outside);
    } finally {
      outside.remove();
    }
  });
});

describe('«Їжа» — the day’s meals', () => {
  it('the list follows a server refresh (another device’s meal)', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'food'));
    expect(screen.getByText('Ще нічого не записано за цей день')).toBeTruthy();
    refresh([{ kind: 'meal.put', date: TODAY, value: LUNCH }]);
    expect(within(mealList()).getByRole('button', { name: /^Обід о 13:10: борщ/ })).toBeTruthy();
    // Nothing of hers to lose: closes without asking.
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(discardDialog()).toBeNull();
    expect(useUiStore.getState().sheet).toBeNull();
  });
});

describe('short «Тренування» sheet', () => {
  it('«Було» shows the types, «+ Нотатка до дня» opens and focuses the notes, the save keeps the food', () => {
    const seeded = seed();
    seeded.days[TODAY] = {
      food: 'Омлет',
      kcal: 400,
      trained: null,
      types: [],
      notes: '',
      photos: ['photo_aaaaaaaaaaaaaaaa'],
    };
    setData(seeded);
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    const menu = dialog();
    pick('Тренування');
    expect(screen.getByRole('dialog', { name: 'Тренування' })).toBe(menu);
    expect(screen.getByRole('group', { name: 'Тренування' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Кардіо' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: 'Що я їла' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Прийоми їжі' })).toBeNull();
    expect(screen.queryByRole('textbox', { name: /Вага/ })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Було' }));
    expect(screen.getByText('Тип')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Кардіо' }));
    expect(screen.getByRole('button', { name: 'Кардіо' }).getAttribute('aria-pressed')).toBe('true');

    expect(screen.queryByRole('textbox', { name: 'Нотатки' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Нотатка до дня' }));
    const notes = textbox('Нотатки');
    expect(document.activeElement).toBe(notes);
    expect(notes.placeholder).toBe('Самопочуття, вода, сон…');
    expect(notes.getAttribute('rows')).toBe('2');
    expect(screen.queryByRole('button', { name: '+ Нотатка до дня' })).toBeNull();
    fireEvent.change(notes, { target: { value: 'Легко' } });
    // Clearing the text keeps the field open while she is in it.
    fireEvent.change(notes, { target: { value: '' } });
    expect(textbox('Нотатки')).toBe(notes);
    fireEvent.change(notes, { target: { value: 'Легко' } });
    fireEvent.click(saveButton());

    // Only what she changed, never the food.
    expect(mocks.commits).toEqual([
      [{ kind: 'day.meta', date: TODAY, value: { trained: true, types: ['Кардіо'], notes: 'Легко' } }],
    ]);
    expect(data().days[TODAY]).toEqual({
      food: 'Омлет',
      kcal: 400,
      trained: true,
      types: ['Кардіо'],
      notes: 'Легко',
      photos: ['photo_aaaaaaaaaaaaaaaa'],
    });
  });

  it('a day with notes shows them open; an opened fold folds again on another day', () => {
    const seeded = seed();
    seeded.days['2026-10-08'] = { food: '', kcal: null, trained: true, types: [], notes: 'Болять ноги' };
    setData(seeded);
    renderHost();
    act(() => ui.openSheet('2026-10-08', 'workout'));
    expect(textbox('Нотатки').value).toBe('Болять ноги');
    // Cleared, it stays open.
    fireEvent.change(textbox('Нотатки'), { target: { value: '' } });
    expect(textbox('Нотатки').value).toBe('');

    act(() => ui.openSheet(TODAY, 'workout'));
    expect(screen.queryByRole('textbox', { name: 'Нотатки' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '+ Нотатка до дня' }));
    expect(textbox('Нотатки')).toBeTruthy();
    // Untouched, ‹ moves without asking, and 9 Oct has no notes: folded again.
    fireEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
    expect(discardDialog()).toBeNull();
    expect(screen.getByText('9 жовтня 2026')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Не було' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.queryByRole('textbox', { name: 'Нотатки' })).toBeNull();
    expect(screen.getByRole('button', { name: '+ Нотатка до дня' })).toBeTruthy();
  });

  it('«✕» drops the stored types and keeps the food (on the wire: { trained } only)', () => {
    const seeded = seed();
    seeded.days[TODAY] = { food: 'Омлет', kcal: 400, trained: true, types: ['Кардіо', 'Прес'], notes: '' };
    setData(seeded);
    renderHost();
    act(() => ui.openSheet(TODAY, 'workout'));
    expect(screen.getByRole('button', { name: 'Прес' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Не було' }));
    expect(screen.queryByRole('button', { name: 'Прес' })).toBeNull();
    fireEvent.click(saveButton());
    expect(mocks.commits).toEqual([[{ kind: 'day.meta', date: TODAY, value: { trained: false } }]]);
    expect(data().days[TODAY]).toEqual({ food: 'Омлет', kcal: 400, trained: false, types: [], notes: '' });
  });

  it('a workout saved on a meal day keeps every meal', () => {
    const seeded = seed();
    seeded.days[TODAY] = normalizeDay({
      food: '',
      kcal: null,
      trained: null,
      types: [],
      notes: '',
      meals: [LUNCH],
    });
    setData(seeded);
    renderHost();
    act(() => ui.openSheet(TODAY, 'workout'));
    fireEvent.click(screen.getByRole('button', { name: 'Було' }));
    fireEvent.click(saveButton());
    expect(mocks.commits).toEqual([[{ kind: 'day.meta', date: TODAY, value: { trained: true } }]]);
    expect(data().days[TODAY]).toMatchObject({ trained: true, meals: [LUNCH], kcal: 560 });
  });

  it('only validates its own blocks', () => {
    const seeded = seed();
    seeded.days[TODAY] = { food: 'а'.repeat(5040), kcal: null, trained: null, types: [], notes: '' };
    setData(seeded);
    renderHost();
    act(() => ui.openSheet(TODAY, 'workout'));
    fireEvent.click(screen.getByRole('button', { name: 'Було' }));
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: '+ Нотатка до дня' }));
    fireEvent.change(textbox('Нотатки'), { target: { value: 'а'.repeat(5040) } });
    expect(screen.getByText(FIELD_ERRORS.text)).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('the pre-set ✓ of the workout push is a change: closing asks', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'workout', { trained: true }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(discardDialog()).toBeTruthy();
  });

  it('gives focus back to the opener after the swap and the close', async () => {
    const plus = document.createElement('button');
    plus.textContent = '+';
    document.body.append(plus);
    try {
      renderHost();
      plus.focus();
      act(() => ui.openSheet(TODAY, 'menu'));
      pick('Тренування');
      fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, SHEET_EXIT_MS + 60));
      });
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(document.activeElement).toBe(plus);
    } finally {
      plus.remove();
    }
  });
});

describe('day record', () => {
  it('records a workout with a new custom type, notes and a weigh-in; the save is day.meta + weight.put', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));

    fireEvent.click(screen.getByRole('button', { name: 'Було' }));
    fireEvent.click(screen.getByRole('button', { name: 'Кардіо' }));
    expect(screen.getByRole('button', { name: 'Кардіо' }).getAttribute('aria-pressed')).toBe('true');

    fireEvent.click(screen.getByRole('button', { name: '+ Свій тип' }));
    fireEvent.change(textbox('Новий тип тренування'), { target: { value: 'Пілатес' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати тип' }));
    expect(screen.getByRole('button', { name: 'Пілатес' }).getAttribute('aria-pressed')).toBe('true');
    expect(data().settings.customTypes).toEqual(['Йога', 'Пілатес']);

    fireEvent.change(textbox('Вага (за бажанням)'), { target: { value: '65,1' } });
    fireEvent.change(textbox('Нотатки'), { target: { value: 'Легко' } });
    mocks.commits.length = 0;
    fireEvent.click(saveButton());

    expect(mocks.commits).toEqual([
      [
        {
          kind: 'day.meta',
          date: TODAY,
          value: { trained: true, types: ['Кардіо', 'Пілатес'], notes: 'Легко' },
        },
        { kind: 'weight.put', date: TODAY, kg: 65.1 },
      ],
    ]);
    expect(data().days[TODAY]).toEqual({
      food: '',
      kcal: null,
      trained: true,
      types: ['Кардіо', 'Пілатес'],
      notes: 'Легко',
    });
    expect(useUiStore.getState().sheet).toBeNull();
    expect(useUiStore.getState().toast?.text).toBe('Збережено');
  });

  it('nothing changed: «Зберегти» writes nothing and still closes', () => {
    renderHost();
    act(() => ui.openSheet('2026-10-09', 'day'));
    fireEvent.click(saveButton());
    expect(mocks.commits).toEqual([[]]);
    expect(useUiStore.getState().sheet).toBeNull();
    expect(data().days['2026-10-09']).toEqual({
      food: 'Омлет',
      kcal: 1500,
      trained: false,
      types: [],
      notes: '',
    });
  });

  it('Escape in the new-type input cancels it without closing the sheet', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day', { trained: true }));
    fireEvent.click(screen.getByRole('button', { name: '+ Свій тип' }));
    fireEvent.keyDown(textbox('Новий тип тренування'), { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Новий тип тренування' })).toBeNull();
    expect(useUiStore.getState().sheet).not.toBeNull();
  });

  it('shows inline errors and blocks saving out-of-range values', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(textbox('Вага (за бажанням)'), { target: { value: '500' } });
    expect(screen.getByText(FIELD_ERRORS.kg)).toBeTruthy();
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textbox('Вага (за бажанням)'), { target: { value: '64,8' } });
    fireEvent.change(textbox(/^Талія/), { target: { value: '5' } });
    expect(screen.getByText(FIELD_ERRORS.cm)).toBeTruthy();
    expect(textbox(/^Талія/).getAttribute('aria-invalid')).toBe('true');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);

    fireEvent.change(textbox(/^Талія/), { target: { value: '71' } });
    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(data().weights.at(-1)).toEqual({ date: TODAY, kg: 64.8 });
    expect(data().measures.at(-1)).toEqual({ date: TODAY, chest: null, waist: 71, hips: null });
    expect(data().days[TODAY]).toBeUndefined();
  });

  it('caps the notes at the server limit and blocks an over-long text that got in anyway', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    expect(textbox('Нотатки').maxLength).toBe(5000);
    // `maxLength` stops typing, not a value set from code.
    fireEvent.change(textbox('Нотатки'), { target: { value: 'а'.repeat(5040) } });
    expect(screen.getByText(FIELD_ERRORS.text)).toBeTruthy();
    expect(textbox('Нотатки').getAttribute('aria-invalid')).toBe('true');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('when the store refuses the save, the sheet stays open with the draft and says so', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(textbox('Нотатки'), { target: { value: 'Легко' } });
    mocks.refuseNext = true;
    fireEvent.click(saveButton());

    expect(useUiStore.getState().sheet).not.toBeNull();
    expect(useUiStore.getState().toast?.text).not.toBe('Збережено');
    expect(screen.getByText(SAVE_FAILED)).toBeTruthy();
    expect(saveButton().getAttribute('aria-describedby')).toBe(screen.getByText(SAVE_FAILED).id);
    expect(textbox('Нотатки').value).toBe('Легко');
    expect(data().days[TODAY]).toBeUndefined();

    // Editing hides the message; then it saves.
    fireEvent.change(textbox('Нотатки'), { target: { value: 'Легко!' } });
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    fireEvent.click(saveButton());
    expect(useUiStore.getState().sheet).toBeNull();
    expect(data().days[TODAY]?.notes).toBe('Легко!');
  });

  it('navigates days, re-initialising the draft; › is disabled at today', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    expect((screen.getByRole('button', { name: 'Наступний день' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
    expect(screen.getByText('9 жовтня 2026')).toBeTruthy();
    expect(screen.getByText('пʼятниця')).toBeTruthy();
    expect(within(mealList()).getByRole('button', { name: /^Їжа за день: омлет/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Не було' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Наступний день' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('asks in the app’s own dialog before throwing away unsaved changes (close and day navigation)', async () => {
    const native = vi.spyOn(window, 'confirm');
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));

    // Clean draft: closes without asking.
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(discardDialog()).toBeNull();
    expect(useUiStore.getState().sheet).toBeNull();

    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(textbox('Нотатки'), { target: { value: 'Сон 8 год' } });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(discardDialog()).toBeTruthy();
    expect(screen.getByText('Закрити без збереження?')).toBeTruthy();
    await answer('Залишитись');
    expect(useUiStore.getState().sheet).not.toBeNull();
    expect(textbox('Нотатки').value).toBe('Сон 8 год');

    fireEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
    expect(screen.getByText(DISCARD_ON_NAVIGATE_CONFIRM.body ?? '')).toBeTruthy();
    await answer('Залишитись');
    expect(screen.getByText('10 жовтня 2026')).toBeTruthy();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    await answer('Закрити');
    expect(useUiStore.getState().sheet).toBeNull();
    expect(data().days[TODAY]).toBeUndefined();
    expect(native).not.toHaveBeenCalled();
  });
});

describe('two devices', () => {
  const PHONE_WEIGH_IN: Op[] = [
    { kind: 'weight.put', date: TODAY, kg: 65.1 },
    { kind: 'measure.put', date: TODAY, value: { chest: 89.5, waist: 69.5, hips: 97.5 } },
  ];

  it('a day saved on a stale device keeps the weigh-in and measurements recorded elsewhere', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(textbox('Нотатки'), { target: { value: 'Легко' } });
    // The phone's weigh-in reaches this device while the edited sheet is open.
    refresh(PHONE_WEIGH_IN);
    expect(textbox('Нотатки').value).toBe('Легко');
    fireEvent.click(saveButton());

    expect(mocks.commits).toEqual([[{ kind: 'day.meta', date: TODAY, value: { notes: 'Легко' } }]]);
    expect(data().weights.at(-1)).toEqual({ date: TODAY, kg: 65.1 });
    expect(data().measures.at(-1)).toEqual({ date: TODAY, chest: 89.5, waist: 69.5, hips: 97.5 });
  });

  it('an untouched sheet follows a server refresh', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    expect(textbox('Вага (за бажанням)').value).toBe('');
    refresh([
      ...PHONE_WEIGH_IN,
      { kind: 'day.meta', date: TODAY, value: { trained: true } },
      { kind: 'meal.put', date: TODAY, value: LUNCH },
    ]);
    expect(textbox('Вага (за бажанням)').value).toBe('65,1');
    expect(screen.getByRole('button', { name: 'Було' }).getAttribute('aria-pressed')).toBe('true');
    expect(within(mealList()).getByRole('button', { name: /^Обід/ })).toBeTruthy();
    // Still clean: closes without asking.
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(discardDialog()).toBeNull();
    expect(useUiStore.getState().sheet).toBeNull();
  });
});

describe('weight and measure sheets', () => {
  it('measure sheet saves only the measurements, with previous values as placeholders', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'measure'));
    expect(screen.getByRole('dialog', { name: 'Заміри тіла' })).toBeTruthy();
    expect(screen.getByText('Груди · талія · стегна')).toBeTruthy();
    const waist = textbox(/^Талія/);
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

  it('on a past day without a weigh-in it offers the one before that day', () => {
    const seeded = seed();
    seeded.weights = [
      { date: '2026-09-26', kg: 66.2 },
      { date: '2026-10-03', kg: 65.6 },
    ];
    setData(seeded);
    renderHost();
    act(() => ui.openSheet('2026-10-01', 'weight'));
    expect(textbox('Вага').value).toBe('66,2');
    expect(screen.getByText('Попереднє: 26 вересня — 66,2 кг')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Наступний день' }));
    expect(textbox('Вага').value).toBe('66,2');
    act(() => ui.openSheet('2026-10-05', 'weight'));
    expect(textbox('Вага').value).toBe('65,6');
  });
});

describe('setup sheet', () => {
  it('opens once for a new account and «Почати» saves the goals and today’s weight', () => {
    setData(emptyData());
    renderHost();
    expect(screen.getByRole('dialog', { name: 'Перші кроки' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Налаштування' })).toBeNull();
    expect(screen.getByText(/Ці дані потрібні, щоб рахувати прогрес/)).toBeTruthy();
    expect(
      screen.getByText(/Ціль і калорії можна змінити будь-коли в «Налаштуваннях» → «Цілі»/),
    ).toBeTruthy();
    expect(screen.getByText(/вагу й заміри — на головній або в календарі/)).toBeTruthy();

    fireEvent.change(textbox('Поточна вага'), { target: { value: '72,4' } });
    fireEvent.click(screen.getByRole('button', { name: 'Мінус 0,5 кг' }));
    expect(textbox('Цільова вага').value).toBe('59,5');
    fireEvent.change(textbox('Калорії на день'), { target: { value: '1600' } });
    fireEvent.click(screen.getByRole('button', { name: 'Почати' }));

    expect(data().weights).toEqual([{ date: TODAY, kg: 72.4 }]);
    expect(data().settings).toMatchObject({ goal: 59.5, kcalGoal: 1600, onboarded: true });
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('keeps the goals within the «Мої цілі» bounds', () => {
    setData(emptyData());
    renderHost();
    fireEvent.change(textbox('Цільова вага'), { target: { value: '25' } });
    expect(screen.getByText(FIELD_ERRORS.goal)).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Почати' }) as HTMLButtonElement).disabled).toBe(true);
    // ± brings it back into range.
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 0,5 кг' }));
    expect(textbox('Цільова вага').value).toBe('30,0');
    fireEvent.change(textbox('Калорії на день'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 50 ккал' }));
    expect(textbox('Калорії на день').value).toBe('800');
    fireEvent.change(textbox('Калорії на день'), { target: { value: '6000' } });
    expect(screen.getByText(FIELD_ERRORS.kcalGoal)).toBeTruthy();
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
  it('walks through the current iOS Safari: share (maybe under «•••»), web app switch, sign in once', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'install'));
    const sheet = screen.getByRole('dialog', { name: 'Встановлення на iPhone' });
    const steps = within(sheet).getAllByRole('listitem');
    expect(steps).toHaveLength(5);
    expect(steps[0]?.textContent).toContain('fit.triple-a.dev');
    expect(steps[1]?.querySelector('svg')).toBeTruthy();
    expect(steps[1]?.textContent).toContain('«•••»');
    expect(steps[2]?.textContent).toContain('«Відкривати як вебпрограму»');
    expect(steps[3]?.textContent).toContain('увійди');
    expect(steps[4]?.textContent).toContain('в «Налаштуваннях» → «Нагадування»');
    fireEvent.click(screen.getByRole('button', { name: 'Зрозуміло' }));
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('says it is already installed in the standalone app', () => {
    installMatchMedia((q) => q === '(display-mode: standalone)');
    try {
      renderHost();
      act(() => ui.openSheet(TODAY, 'install'));
      expect(screen.getByText('Готово — Home Fit вже встановлено ✨')).toBeTruthy();
      expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    } finally {
      installMatchMedia();
    }
  });
});
