/**
 * RecordSheet with the meals (docs/meals-macros.md §7.1–§7.6): «+» → «Їжа» swaps the menu to the new-meal editor
 * «Прийом їжі» (focus inside the tap), its ‹ › moving the draft, the day's list «Їжа» and the «Запис дня» food field
 * hosting the stacked editor, and day saves that send a partial `day.meta` only. Real food feature and store; the
 * AI status request never answers (no AI row), the device cache is faked.
 */
import { applyOps, emptyData, normalizeDay, type AppData, type Meal, type Op } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import type * as DataModule from '@/store/data';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { fakeIdb } from '@/store/test-utils';
import { ui, useUiStore } from '@/store/ui';
import { ConfirmHost } from '@/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { DISCARD_CONFIRM } from '../helpers';
import { resetSetupShownForTests } from '../setupGate';
import { SheetHost } from '../SheetHost';

const TODAY = '2026-10-10';
const YESTERDAY = '2026-10-09';

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() },
  /** Every `commit()` call the record sheet makes, in order (the meal editor saves through `dataActions`). */
  commits: [] as Op[][],
}));
vi.mock('idb-keyval', () => mocks.idb);
vi.mock('@/lib/useToday', () => ({ useToday: () => '2026-10-10' }));
vi.mock('@/store/data', async (importOriginal) => {
  const actual = await importOriginal<typeof DataModule>();
  return {
    ...actual,
    commit: (...ops: Op[]) => {
      mocks.commits.push(ops);
      return actual.commit(...ops);
    },
  };
});
// The AI status never arrives: the editor shows no AI row (the food package tests it).
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, foodStatus: vi.fn(() => new Promise(() => undefined)) } };
});

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: null,
  text: type,
  kcal,
  protein: null,
  fat: null,
  carbs: null,
  ...extra,
});

const BREAKFAST = meal('breakfast001', 'Сніданок', 420, {
  time: '08:30',
  text: 'Тост з тунцем, кава',
  protein: 27,
  fat: 11,
  carbs: 36,
});
const LUNCH = meal('lunch0000001', 'Обід', 560, {
  time: '13:10',
  text: 'Борщ',
  protein: 21,
  fat: 19,
  carbs: 64,
});

function seed(): AppData {
  const data = emptyData();
  data.settings = { ...data.settings, onboarded: true };
  data.days[YESTERDAY] = { food: 'Омлет', kcal: 1500, trained: false, types: [], notes: '' };
  return data;
}

function withMeals(data: AppData, date: string, meals: Meal[], patch: Partial<AppData['days'][string]> = {}) {
  data.days[date] = normalizeDay({
    food: '',
    kcal: null,
    trained: null,
    types: [],
    notes: '',
    ...patch,
    meals,
  });
  return data;
}

function setData(data: AppData) {
  useDataStore.setState({
    data,
    sync: { ...initialSyncState(), online: true, loaded: true, lastSyncedAt: 1 },
  });
}

const data = (): AppData => useDataStore.getState().data;
const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s/g, ' ');
const sheet = (name: string) => screen.getByRole('dialog', { name });
const textbox = (root: HTMLElement, name: string) =>
  within(root).getByRole('textbox', { name }) as HTMLTextAreaElement;
const button = (root: HTMLElement, name: string | RegExp) =>
  within(root).getByRole('button', { name }) as HTMLButtonElement;
const discardDialog = () => screen.queryByRole('alertdialog', { name: DISCARD_CONFIRM.title });
/** The stacked meal editor slid away (it stays mounted during its exit animation). */
const stackedGone = () => waitFor(() => expect(screen.getAllByRole('dialog')).toHaveLength(1));

async function answer(label: string) {
  const alert = discardDialog();
  if (!alert) throw new Error('no discard question is open');
  await act(async () => {
    fireEvent.click(within(alert).getByRole('button', { name: label }));
  });
}

/**
 * Taps `target` like a finger: `focus` is where focus is while the tap's click event is still being dispatched
 * (what iOS needs to open the keyboard), read by a listener on the document, after React's own.
 */
function tap(target: HTMLElement): { focus: Element | null } {
  const seen = { focus: null as Element | null };
  const probe = () => {
    seen.focus = document.activeElement;
  };
  document.addEventListener('click', probe);
  try {
    act(() => target.focus());
    fireEvent.click(target);
  } finally {
    document.removeEventListener('click', probe);
  }
  return seen;
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
  // 10:00 on the day the app thinks is today: a new meal is «Сніданок».
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
  mocks.commits.length = 0;
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
  setData(seed());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetSetupShownForTests();
});

describe('«+» → «Їжа»: the new-meal editor in the same dialog', () => {
  it('swaps the SAME dialog to «Прийом їжі» and «Що я їла» has focus inside the tap', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    const menu = sheet('Що записати?');
    const row = button(menu, /^Їжа/);
    expect(flat(row.textContent)).toContain('Новий прийом їжі');

    const seen = tap(row);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(sheet('Прийом їжі')).toBe(menu);
    const text = textbox(menu, 'Що я їла');
    // Focused while the tap was still being handled, so the iPhone keyboard opens.
    expect(seen.focus).toBe(text);
    expect(document.activeElement).toBe(text);
    expect(useUiStore.getState().sheet).toMatchObject({ date: TODAY, mode: 'meal' });
    // Preselected by the time of day; the date navigator and «Зберегти» (waiting for content, and saying why).
    const chips = within(menu).getByRole('group', { name: 'Тип прийому їжі' });
    expect(within(chips).getByRole('button', { name: 'Сніданок' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('10 жовтня 2026')).toBeTruthy();
    const save = button(menu, 'Зберегти');
    expect(save.disabled).toBe(true);
    const why = within(menu).getByText('Опиши, що їла, або додай калорії чи фото');
    expect(save.getAttribute('aria-describedby')).toBe(why.id);
    // The day's other blocks are not here.
    expect(within(menu).queryByRole('group', { name: 'Тренування' })).toBeNull();
    expect(within(menu).queryByRole('textbox', { name: 'Нотатки' })).toBeNull();
    expect(within(menu).queryByRole('textbox', { name: 'Калорії за день' })).toBeNull();
  });

  it('«Зберегти» saves the meal, closes the sheet and says «Збережено»', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    tap(button(sheet('Що записати?'), /^Їжа/));
    const editor = sheet('Прийом їжі');
    fireEvent.change(textbox(editor, 'Що я їла'), { target: { value: 'Тост з тунцем' } });
    const save = button(editor, 'Зберегти');
    expect(save.disabled).toBe(false);
    expect(save.hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(save);

    expect(useUiStore.getState().sheet).toBeNull();
    expect(useUiStore.getState().toast?.text).toBe('Збережено');
    expect(data().days[TODAY]?.meals).toEqual([
      expect.objectContaining({ type: 'Сніданок', time: '10:00', text: 'Тост з тунцем', kcal: null }),
    ]);
    // The derived day text, as every other screen reads it.
    expect(data().days[TODAY]?.food).toBe('Сніданок: Тост з тунцем');
    // The record sheet itself wrote nothing (the meal editor saved through `saveMeal`).
    expect(mocks.commits).toEqual([]);
  });

  it('‹ › move the typed draft to that day without asking; › stops at today', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    tap(button(sheet('Що записати?'), /^Їжа/));
    const editor = sheet('Прийом їжі');
    const { key } = useUiStore.getState().sheet ?? { key: -1 };
    expect(button(editor, 'Наступний день').disabled).toBe(true);
    fireEvent.change(textbox(editor, 'Що я їла'), { target: { value: 'Тост' } });

    fireEvent.click(button(editor, 'Попередній день'));
    expect(discardDialog()).toBeNull();
    expect(screen.getByText('9 жовтня 2026')).toBeTruthy();
    expect(useUiStore.getState().sheet).toMatchObject({ date: YESTERDAY, mode: 'meal', key });
    expect(sheet('Прийом їжі')).toBe(editor);
    expect(textbox(editor, 'Що я їла').value).toBe('Тост');
    expect(button(editor, 'Наступний день').disabled).toBe(false);

    fireEvent.click(button(editor, 'Зберегти'));
    // Saved to 9 Oct: its old block «Омлет» became a meal of its own, the new one next to it.
    const meals = data().days[YESTERDAY]?.meals ?? [];
    expect(meals.map((m) => [m.id === 'legacy', m.text])).toEqual([
      [true, 'Омлет'],
      [false, 'Тост'],
    ]);
    expect(data().days[TODAY]).toBeUndefined();
  });

  it('closing with something typed asks first; staying keeps it', async () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    tap(button(sheet('Що записати?'), /^Їжа/));
    const editor = sheet('Прийом їжі');
    fireEvent.change(textbox(editor, 'Що я їла'), { target: { value: 'Вівсянка' } });
    fireEvent.click(button(editor, 'Закрити'));
    expect(discardDialog()).toBeTruthy();
    await answer('Залишитись');
    expect(textbox(editor, 'Що я їла').value).toBe('Вівсянка');
    fireEvent.keyDown(document, { key: 'Escape' });
    await answer('Закрити');
    expect(useUiStore.getState().sheet).toBeNull();
    expect(data().days[TODAY]).toBeUndefined();
  });

  it('untouched, it closes without asking', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'meal'));
    fireEvent.click(button(sheet('Прийом їжі'), 'Закрити'));
    expect(discardDialog()).toBeNull();
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('«Усі прийоми за день →» swaps the same dialog to «Їжа» (asking first when she typed)', async () => {
    renderHost();
    act(() => ui.openSheet(YESTERDAY, 'meal'));
    const editor = sheet('Прийом їжі');
    fireEvent.change(textbox(editor, 'Що я їла'), { target: { value: 'Борщ' } });
    fireEvent.click(button(editor, 'Усі прийоми за день →'));
    expect(screen.getByText(DISCARD_CONFIRM.body ?? '')).toBeTruthy();
    await answer('Закрити');
    expect(sheet('Їжа')).toBe(editor);
    expect(useUiStore.getState().sheet).toMatchObject({ date: YESTERDAY, mode: 'food' });
    expect(data().days[YESTERDAY]?.meals).toBeUndefined();
  });
});

describe('«Їжа»: the day’s list', () => {
  it('the totals, one row per meal and the legacy note; «+ Прийом їжі» in the footer', () => {
    renderHost();
    act(() => ui.openSheet(YESTERDAY, 'food'));
    const list = sheet('Їжа');
    const totals = within(list).getByRole('region', { name: 'Підсумок дня' });
    expect(flat(totals.textContent)).toContain('1 500 / 1 700 ккал');
    const meals = within(list).getByRole('region', { name: 'Прийоми їжі' });
    expect(flat(button(meals, /^Їжа за день/).getAttribute('aria-label'))).toBe(
      'Їжа за день: омлет. 1 500 ккал',
    );
    expect(
      within(meals).getByText('Запис зі старої версії — відкрий його, щоб обрати тип прийому.'),
    ).toBeTruthy();
    expect(button(list, 'Додати прийом їжі').textContent).toBe('+ Прийом їжі');
    // No food form of its own any more.
    expect(within(list).queryByRole('textbox')).toBeNull();
    expect(within(list).queryByRole('button', { name: 'Зберегти' })).toBeNull();
  });

  it('«+ Прийом їжі» stacks «Прийом їжі» above «Їжа» (inert below), «Що я їла» focused inside the tap', async () => {
    renderHost();
    act(() => ui.openSheet(YESTERDAY, 'food'));
    const list = sheet('Їжа');
    const seen = tap(button(list, 'Додати прийом їжі'));

    expect(screen.getAllByRole('dialog')).toHaveLength(2);
    const editor = sheet('Прийом їжі');
    expect(editor).not.toBe(list);
    expect(list.parentElement?.hasAttribute('inert')).toBe(true);
    expect(Number(editor.parentElement?.style.zIndex)).toBeGreaterThan(
      Number(list.parentElement?.style.zIndex),
    );
    const text = textbox(editor, 'Що я їла');
    expect(seen.focus).toBe(text);
    expect(document.activeElement).toBe(text);
    // Stacked over a past day: the date is said in the editor.
    expect(within(editor).getByText('9 жовтня · пʼятниця')).toBeTruthy();

    fireEvent.change(text, { target: { value: 'Борщ' } });
    fireEvent.click(button(editor, 'Зберегти'));
    await stackedGone();
    expect(useUiStore.getState().toast?.text).toBe('Збережено');
    expect(useUiStore.getState().sheet).toMatchObject({ date: YESTERDAY, mode: 'food' });
    expect(list.parentElement?.hasAttribute('inert')).toBe(false);
    const rows = within(within(list).getByRole('region', { name: 'Прийоми їжі' })).getAllByRole('button', {
      name: /:/,
    });
    expect(rows.map((r) => r.getAttribute('aria-label')?.split(':')[0])).toEqual(['Їжа за день', 'Сніданок']);
  });

  it('a meal row opens that meal stacked (no keyboard); a type turns the old block into a meal', async () => {
    renderHost();
    act(() => ui.openSheet(YESTERDAY, 'food'));
    const list = sheet('Їжа');
    fireEvent.click(button(list, /^Їжа за день/));
    const editor = sheet('Прийом їжі');
    expect(textbox(editor, 'Що я їла').value).toBe('Омлет');
    expect(document.activeElement).not.toBe(textbox(editor, 'Що я їла'));
    expect(
      within(editor).getByText('Це запис зі старої версії. Обери тип — і він стане окремим прийомом їжі.'),
    ).toBeTruthy();
    const chips = within(editor).getByRole('group', { name: 'Тип прийому їжі' });
    fireEvent.click(within(chips).getByRole('button', { name: 'Обід' }));
    fireEvent.click(button(editor, 'Зберегти'));
    await stackedGone();
    expect(data().days[YESTERDAY]?.meals).toEqual([
      expect.objectContaining({ id: 'legacy', type: 'Обід', text: 'Омлет' }),
    ]);
    expect(button(list, /^Обід/)).toBeTruthy();
  });

  it('20 meals: «+ Прийом їжі» is aria-disabled with the reason and opens nothing', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => meal(`m${i}`, 'Перекус', 10, { text: `${i}` }));
    setData(withMeals(seed(), TODAY, twenty));
    renderHost();
    act(() => ui.openSheet(TODAY, 'food'));
    const add = button(sheet('Їжа'), 'Додати прийом їжі');
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText('Не більше 20 прийомів на день').id).toBe(add.getAttribute('aria-describedby'));
    fireEvent.click(add);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
  });

  it('‹ › keep the list and show that day', () => {
    setData(withMeals(seed(), TODAY, [BREAKFAST, LUNCH]));
    renderHost();
    act(() => ui.openSheet(TODAY, 'food'));
    const list = sheet('Їжа');
    expect(flat(within(list).getByRole('region', { name: 'Підсумок дня' }).textContent)).toContain(
      '980 / 1 700 ккал',
    );
    fireEvent.click(button(list, 'Попередній день'));
    expect(sheet('Їжа')).toBe(list);
    expect(useUiStore.getState().sheet).toMatchObject({ date: YESTERDAY, mode: 'food' });
    expect(button(list, /^Їжа за день/)).toBeTruthy();
    expect(within(list).queryByRole('button', { name: /^Сніданок/ })).toBeNull();
  });

  it('a notification tap while the stacked editor is open asks before replacing the sheet', async () => {
    const memory = renderHost('/');
    act(() => ui.openSheet(YESTERDAY, 'food'));
    tap(button(sheet('Їжа'), 'Додати прийом їжі'));
    fireEvent.change(textbox(sheet('Прийом їжі'), 'Що я їла'), { target: { value: 'Суп' } });

    act(() => memory.navigate('/?sheet=weight'));
    expect(discardDialog()).toBeTruthy();
    await answer('Залишитись');
    expect(textbox(sheet('Прийом їжі'), 'Що я їла').value).toBe('Суп');

    act(() => memory.navigate('/?sheet=weight'));
    await answer('Закрити');
    expect(useUiStore.getState().sheet).toMatchObject({ date: TODAY, mode: 'weight' });
    await stackedGone();
    expect(sheet('Контрольне зважування')).toBeTruthy();
    expect(data().days[YESTERDAY]?.meals).toBeUndefined();
  });
});

describe('«Запис дня»: the food field', () => {
  it('lists the meals in the region «Прийоми їжі» with the day total; no food text, kcal or photos field', () => {
    setData(withMeals(seed(), TODAY, [BREAKFAST, LUNCH]));
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    const day = sheet('Запис дня');
    const meals = within(day).getByRole('region', { name: 'Прийоми їжі' });
    expect(
      within(meals)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')?.split(' ')[0]),
    ).toEqual(['Сніданок', 'Обід']);
    expect(flat(within(day).getByText(/^Разом/).textContent)).toBe(
      'Разом 980 / 1 700 ккал · Б 48 · Ж 30 · В 100 г',
    );
    expect(button(day, 'Додати прийом їжі').textContent).toBe('+ Прийом їжі');
    expect(within(day).queryByRole('textbox', { name: 'Що я їла' })).toBeNull();
    expect(within(day).queryByRole('textbox', { name: 'Калорії за день' })).toBeNull();
    expect(within(day).queryByRole('button', { name: /Порахувати/ })).toBeNull();
  });

  it('the day’s «Зберегти» sends day.meta only (the changed fields) and leaves the meals untouched', () => {
    setData(withMeals(seed(), TODAY, [BREAKFAST, LUNCH]));
    const before = data().days[TODAY]?.meals;
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    const day = sheet('Запис дня');
    fireEvent.click(button(day, 'Було'));
    fireEvent.change(textbox(day, 'Нотатки'), { target: { value: ' Легко ' } });
    fireEvent.click(button(day, 'Зберегти'));
    expect(mocks.commits).toEqual([
      [{ kind: 'day.meta', date: TODAY, value: { trained: true, notes: 'Легко' } }],
    ]);
    expect(data().days[TODAY]?.meals).toEqual(before);
    expect(data().days[TODAY]).toMatchObject({ trained: true, notes: 'Легко', kcal: 980 });
  });

  it('a meal saved in the stacked editor keeps the day draft she was typing', async () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    const day = sheet('Запис дня');
    fireEvent.change(textbox(day, 'Нотатки'), { target: { value: 'Сон 8 год' } });
    expect(within(day).getByText('Ще нічого не записано')).toBeTruthy();
    const seen = tap(button(day, 'Додати прийом їжі'));
    const editor = sheet('Прийом їжі');
    expect(seen.focus).toBe(textbox(editor, 'Що я їла'));
    fireEvent.change(textbox(editor, 'Що я їла'), { target: { value: 'Вівсянка' } });
    fireEvent.click(button(editor, 'Зберегти'));
    await stackedGone();

    expect(button(within(day).getByRole('region', { name: 'Прийоми їжі' }), /^Сніданок/)).toBeTruthy();
    expect(textbox(day, 'Нотатки').value).toBe('Сон 8 год');
    fireEvent.click(button(day, 'Зберегти'));
    expect(mocks.commits).toEqual([[{ kind: 'day.meta', date: TODAY, value: { notes: 'Сон 8 год' } }]]);
    expect(data().days[TODAY]).toMatchObject({ notes: 'Сон 8 год', food: 'Сніданок: Вівсянка' });
  });

  it('a day save on a device that missed a meal added elsewhere keeps that meal', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    const day = sheet('Запис дня');
    fireEvent.click(button(day, 'Не було'));
    // The phone's meal reaches this device while the sheet is open.
    act(() =>
      useDataStore.setState((s) => ({
        data: applyOps(s.data, [{ kind: 'meal.put', date: TODAY, value: LUNCH }]),
      })),
    );
    expect(button(within(day).getByRole('region', { name: 'Прийоми їжі' }), /^Обід/)).toBeTruthy();
    fireEvent.click(button(day, 'Зберегти'));
    expect(mocks.commits).toEqual([[{ kind: 'day.meta', date: TODAY, value: { trained: false } }]]);
    expect(data().days[TODAY]?.meals).toEqual([LUNCH]);
  });
});
