import { applyOps, emptyData, type AppData, type FoodUse, type Op } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FoodAdd } from '@/features/food';
import type * as DataModule from '@/store/data';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { fakeIdb } from '@/store/test-utils';
import { ui, useUiStore } from '@/store/ui';
import { ConfirmHost } from '@/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { SAVE_FAILED } from './fields/fields';
import { DISCARD_CONFIRM, DISCARD_ON_NAVIGATE_CONFIRM } from './helpers';
import { resetSetupShownForTests } from './setupGate';
import { SheetHost } from './SheetHost';
import { FIELD_ERRORS } from './validation';

const TODAY = '2026-10-10';

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() },
  /** Every `commit()` call the sheets make, in order. */
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

const BORSCHT: FoodUse = { name: 'Борщ', portion: '300 г', kcal: 420 };
const addOf = (patch: Partial<FoodAdd> = {}): FoodAdd => ({
  line: 'Борщ (300 г) — 420 ккал',
  consumed: '',
  kcal: 420,
  photoId: 'photo_bbbbbbbbbbbbbbbb',
  items: [],
  uses: [BORSCHT],
  ...patch,
});

interface FoodAssistStub {
  foodText: string;
  onAdd: (add: FoodAdd) => void;
  onPendingChange?: (pending: boolean) => void;
}

// The food feature is built separately; stand-ins with the documented props (the text helpers are real).
vi.mock('@/features/food', async () => {
  const tail = await import('@/features/food/tail');
  return {
    ...tail,
    FoodAssist: ({ foodText, onAdd, onPendingChange }: FoodAssistStub) => (
      <div>
        <span data-testid="assist-food-text">{foodText}</span>
        <button type="button" onClick={() => onAdd(addOf())}>
          test-add-food
        </button>
        <button type="button" onClick={() => onAdd(addOf({ consumed: 'борщ', photoId: null }))}>
          test-estimate-typed
        </button>
        <button type="button" onClick={() => onAdd(addOf({ photoId: 'bad id!' }))}>
          test-add-bad-photo
        </button>
        <button type="button" onClick={() => onPendingChange?.(true)}>
          test-estimate-pending
        </button>
      </div>
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
  };
});

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

/** What a server refresh does: the store gets another device's changes. */
function refresh(ops: Op[]) {
  act(() => useDataStore.setState((s) => ({ data: applyOps(s.data, ops) })));
}

const data = (): AppData => useDataStore.getState().data;
const dialog = () => screen.getByRole('dialog');
const saveButton = () => screen.getByRole('button', { name: 'Зберегти' });
const textbox = (name: string | RegExp) => screen.getByRole('textbox', { name }) as HTMLInputElement;
const discardDialog = () => screen.queryByRole('alertdialog', { name: DISCARD_CONFIRM.title });

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

beforeAll(() => installMatchMedia());
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

  it('reacts when the query changes while mounted (notification tap)', () => {
    const memory = renderHost('/');
    expect(screen.queryByRole('dialog')).toBeNull();
    act(() => memory.navigate('/?sheet=day&trained=1'));
    expect(screen.getByRole('dialog', { name: 'Запис дня' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Було' }).getAttribute('aria-pressed')).toBe('true');
    expect(memory.history.at(-1)).toBe('/');
  });

  it('a notification tap over a sheet with unsaved changes asks first', async () => {
    const memory = renderHost('/');
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(textbox('Що я їла'), { target: { value: 'Вівсянка, ще пишу…' } });

    act(() => memory.navigate('/?sheet=day&trained=1'));
    expect(memory.history.at(-1)).toBe('/');
    expect(discardDialog()).toBeTruthy();
    expect(screen.getByText(DISCARD_CONFIRM.body ?? '')).toBeTruthy();
    await answer('Залишитись');
    expect(discardDialog()).toBeNull();
    expect(textbox('Що я їла').value).toBe('Вівсянка, ще пишу…');

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
    expect(screen.queryByRole('dialog', { name: 'Налаштування' })).toBeNull();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(screen.getByRole('dialog', { name: 'Налаштування' })).toBeTruthy();
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
    fireEvent.change(textbox('Новий тип тренування'), { target: { value: 'Пілатес' } });
    fireEvent.click(screen.getByRole('button', { name: 'Додати тип' }));
    expect(screen.getByRole('button', { name: 'Пілатес' }).getAttribute('aria-pressed')).toBe('true');
    expect(data().settings.customTypes).toEqual(['Йога', 'Пілатес']);

    fireEvent.change(textbox('Що я їла'), { target: { value: 'Вівсянка' } });
    expect(screen.getByTestId('assist-food-text').textContent).toBe('Вівсянка');
    fireEvent.click(screen.getByRole('button', { name: 'test-add-food' }));
    expect(textbox('Що я їла').value).toBe('Вівсянка\nБорщ (300 г) — 420 ккал');
    fireEvent.click(screen.getByRole('button', { name: 'Плюс 50 ккал' }));
    expect(textbox('Калорії за день').value).toBe('470');

    fireEvent.change(textbox('Нотатки'), { target: { value: 'Легко' } });
    fireEvent.click(saveButton());

    expect(data().days[TODAY]).toEqual({
      food: 'Вівсянка\nБорщ (300 г) — 420 ккал',
      kcal: 470,
      trained: true,
      types: ['Кардіо', 'Пілатес'],
      notes: 'Легко',
      photos: ['photo_bbbbbbbbbbbbbbbb'],
    });
    expect(useUiStore.getState().sheet).toBeNull();
    expect(useUiStore.getState().toast?.text).toBe('Збережено');
  });

  it('an estimate replaces the meal she typed instead of repeating it', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(textbox('Що я їла'), { target: { value: 'борщ' } });
    fireEvent.click(screen.getByRole('button', { name: 'test-estimate-typed' }));
    expect(textbox('Що я їла').value).toBe('Борщ (300 г) — 420 ккал');
  });

  it('records «Часті страви» usage only together with the saved day', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.click(screen.getByRole('button', { name: 'test-add-food' }));
    expect(data().foods).toEqual([]);
    expect(mocks.commits).toEqual([]);

    fireEvent.click(saveButton());
    expect(mocks.commits).toHaveLength(1);
    expect(mocks.commits[0]?.map((op) => op.kind)).toEqual(['day.put', 'food.use']);
    expect(mocks.commits[0]?.[1]).toEqual({ kind: 'food.use', date: TODAY, value: BORSCHT });
    expect(data().foods).toMatchObject([{ name: 'Борщ', count: 1, lastUsed: TODAY }]);
  });

  it('a discarded draft records no dish usage', async () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.click(screen.getByRole('button', { name: 'test-add-food' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    await answer('Закрити');
    expect(useUiStore.getState().sheet).toBeNull();
    expect(mocks.commits).toEqual([]);
    expect(data().foods).toEqual([]);
    expect(data().days[TODAY]).toBeUndefined();
  });

  it('an estimate waiting in FoodAssist counts as unsaved work', async () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.click(screen.getByRole('button', { name: 'test-estimate-pending' }));
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(discardDialog()).toBeTruthy();
    await answer('Залишитись');
    expect(useUiStore.getState().sheet).not.toBeNull();

    // ‹ asks too; once she agrees, the next day starts clean (the old report does not carry over).
    fireEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
    expect(screen.getByText(DISCARD_ON_NAVIGATE_CONFIRM.body ?? '')).toBeTruthy();
    await answer('Перейти');
    expect(screen.getByText('9 жовтня 2026')).toBeTruthy();
    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    expect(discardDialog()).toBeNull();
    expect(useUiStore.getState().sheet).toBeNull();
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
    fireEvent.change(textbox('Калорії за день'), { target: { value: '25 000' } });
    expect(textbox('Калорії за день').value).toBe('25000');
    expect(screen.getByText(FIELD_ERRORS.kcal)).toBeTruthy();
    fireEvent.change(textbox('Калорії за день'), { target: { value: '1600' } });

    expect((saveButton() as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(saveButton());
    expect(data().weights.at(-1)).toEqual({ date: TODAY, kg: 64.8 });
    expect(data().measures.at(-1)).toEqual({ date: TODAY, chest: null, waist: 71, hips: null });
    expect(data().days[TODAY]?.kcal).toBe(1600);
  });

  it('caps the free text at the server limit and blocks an over-long text that got in anyway', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    expect(textbox('Що я їла').maxLength).toBe(5000);
    expect(textbox('Нотатки').maxLength).toBe(5000);
    // `maxLength` stops typing, not a value set from code (e.g. an appended estimate line).
    fireEvent.change(textbox('Нотатки'), { target: { value: 'а'.repeat(5040) } });
    expect(screen.getByText(FIELD_ERRORS.text)).toBeTruthy();
    expect(textbox('Нотатки').getAttribute('aria-invalid')).toBe('true');
    expect((saveButton() as HTMLButtonElement).disabled).toBe(true);
  });

  it('when the store refuses the save, the sheet stays open with the draft and says so', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    fireEvent.change(textbox('Калорії за день'), { target: { value: '1500' } });
    fireEvent.click(screen.getByRole('button', { name: 'test-add-bad-photo' }));
    fireEvent.click(saveButton());

    expect(useUiStore.getState().sheet).not.toBeNull();
    expect(useUiStore.getState().toast?.text).not.toBe('Збережено');
    expect(screen.getByText(SAVE_FAILED)).toBeTruthy();
    expect(textbox('Калорії за день').value).toBe('1920');
    expect(data().days[TODAY]).toBeUndefined();

    // Editing hides the message; without the bad photo it saves.
    fireEvent.click(screen.getByRole('button', { name: 'remove bad id!' }));
    expect(screen.queryByText(SAVE_FAILED)).toBeNull();
    fireEvent.click(saveButton());
    expect(useUiStore.getState().sheet).toBeNull();
    expect(data().days[TODAY]?.kcal).toBe(1920);
  });

  it('navigates days, re-initialising the draft; › is disabled at today', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    expect((screen.getByRole('button', { name: 'Наступний день' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Попередній день' }));
    expect(screen.getByText('9 жовтня 2026')).toBeTruthy();
    expect(screen.getByText('пʼятниця')).toBeTruthy();
    expect(textbox('Що я їла').value).toBe('Омлет');
    expect(screen.getByRole('button', { name: 'Не було' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'Наступний день' }) as HTMLButtonElement).disabled).toBe(false);
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
    expect(screen.getByText('Перейти до іншого дня без збереження?')).toBeTruthy();
    await answer('Залишитись');
    expect(screen.getByText('10 жовтня 2026')).toBeTruthy();

    fireEvent.click(within(dialog()).getByRole('button', { name: 'Закрити' }));
    await answer('Закрити');
    expect(useUiStore.getState().sheet).toBeNull();
    expect(data().days[TODAY]).toBeUndefined();
    expect(native).not.toHaveBeenCalled();
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

    expect(mocks.commits).toEqual([
      [{ kind: 'day.put', date: TODAY, value: { food: '', kcal: null, trained: null, types: [], notes: 'Легко' } }],
    ]);
    expect(data().weights.at(-1)).toEqual({ date: TODAY, kg: 65.1 });
    expect(data().measures.at(-1)).toEqual({ date: TODAY, chest: 89.5, waist: 69.5, hips: 97.5 });
  });

  it('an untouched sheet follows a server refresh', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    expect(textbox('Вага (за бажанням)').value).toBe('');
    refresh([...PHONE_WEIGH_IN, { kind: 'day.put', date: TODAY, value: { food: 'Омлет', kcal: 400, trained: null, types: [], notes: '' } }]);
    expect(textbox('Вага (за бажанням)').value).toBe('65,1');
    expect(textbox('Що я їла').value).toBe('Омлет');
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
    expect(screen.getByRole('dialog', { name: 'Налаштування' })).toBeTruthy();
    expect(screen.getByText(/Ці дані потрібні, щоб рахувати прогрес/)).toBeTruthy();

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
    expect(steps[4]?.textContent).toContain('«Нагадуваннях»');
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
