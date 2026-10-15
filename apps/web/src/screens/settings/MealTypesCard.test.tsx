import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { NBSP } from '@/lib/nutrition';
import { dataActions, useDataStore, useSettings } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { sampleData } from '@/store/test-utils';
import { MealTypesCard } from './MealTypesCard';

const mocks = vi.hoisted(() => ({
  api: { sendOps: vi.fn(), getData: vi.fn(), importData: vi.fn(), logout: vi.fn() },
}));

vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { ...mocks.api, exportUrl: '/api/export' },
}));
vi.mock('idb-keyval', async () => (await import('@/store/test-utils')).fakeIdb());

const DEFAULTS = ['Сніданок', 'Обід', 'Вечеря', 'Перекус'];
const INTRO = 'Типи, які можна вибрати для прийому їжі';

const stored = () => useDataStore.getState().data.settings.mealTypes;

/** The card over the app store, as the settings page renders it. */
function Harness() {
  return <MealTypesCard mealTypes={useSettings().mealTypes} />;
}

function setup(mealTypes: string[] = DEFAULTS) {
  useDataStore.setState({
    data: sampleData({ settings: { ...sampleData().settings, mealTypes } }),
    sync: { ...initialSyncState(), loaded: true, online: true },
  });
  render(<Harness />);
  return within(screen.getByRole('region', { name: 'Мої прийоми їжі' }));
}

const names = () =>
  [...screen.getByRole('list', { name: INTRO }).querySelectorAll('li')].map((li) => li.textContent);
const toggle = (card: ReturnType<typeof setup>) => card.getByRole('button', { name: /^(Змінити|Готово)$/ });
const status = () => screen.getByRole('status').textContent;
const nameField = (card: ReturnType<typeof setup>, name: string) =>
  card.getByRole<HTMLInputElement>('textbox', { name: `Назва: ${name}` });

function editMode() {
  const card = setup();
  fireEvent.click(toggle(card));
  return card;
}

beforeEach(() => {
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.sendOps.mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MealTypesCard — view mode', () => {
  it('lists her types in her order, with no per-row controls', () => {
    const card = setup();
    expect(card.getByText(INTRO)).toBeTruthy();
    expect(names()).toEqual(DEFAULTS);
    expect(card.queryByRole('button', { name: /^Видалити/ })).toBeNull();
    expect(card.queryByRole('button', { name: /^Вище/ })).toBeNull();
    expect(card.queryByRole('button', { name: /^Нижче/ })).toBeNull();
    expect(card.queryByRole('textbox', { name: /^Назва/ })).toBeNull();
    expect(toggle(card).textContent).toBe('Змінити');
    expect(toggle(card).getAttribute('aria-pressed')).toBe('false');
    // Every default is there: nothing to restore.
    expect(card.queryByRole('button', { name: 'Повернути стандартні' })).toBeNull();
  });

  it('shows the generated note under the card', () => {
    const card = setup(['Сніданок', 'Обід', 'Вечеря']);
    const note = screen.getByText(/^Тип нового прийому підказується за часом/);
    // NBSP shown as «_»: each «08:00 — Сніданок» stays on one line; the line wraps only after «·».
    expect(note.textContent?.replaceAll(NBSP, '_')).toBe(
      'Тип нового прийому підказується за часом: 08:00_—_Сніданок_· 13:00_—_Обід_· 19:00_—_Вечеря. ' +
        'Його завжди можна змінити. Перейменування не змінює вже записані прийоми.',
    );
    expect(screen.getByRole('region', { name: 'Мої прийоми їжі' }).contains(note)).toBe(false);
    // «Перекус» is missing: it can come back.
    expect(card.getByRole('button', { name: 'Повернути стандартні' })).toBeTruthy();
  });

  it('adds a type in view mode too, and refuses duplicates and a 13th type', () => {
    const card = setup();
    const input = card.getByRole<HTMLInputElement>('textbox', { name: 'Новий тип прийому їжі' });
    expect(input.placeholder).toBe('Новий тип прийому їжі');
    expect(input.maxLength).toBe(30);
    const add = card.getByRole<HTMLButtonElement>('button', { name: 'Додати' });
    expect(add.disabled).toBe(true);

    fireEvent.change(input, { target: { value: '  Після тренування ' } });
    fireEvent.click(add);
    expect(stored()).toEqual([...DEFAULTS, 'Після тренування']);
    expect(names()).toEqual([...DEFAULTS, 'Після тренування']);
    expect(input.value).toBe('');
    expect(status()).toBe('Після тренування додано');

    fireEvent.change(input, { target: { value: 'обід' } });
    fireEvent.submit(input.closest('form') as HTMLFormElement);
    expect(card.getByRole('alert').textContent).toBe('Такий тип уже є');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toBe(card.getByRole('alert').id);
    expect(stored()).toHaveLength(5);
    // Typing again clears the error.
    fireEvent.change(input, { target: { value: 'Друга вечеря' } });
    expect(card.queryByRole('alert')).toBeNull();

    cleanup();
    const full = setup(Array.from({ length: 12 }, (_, i) => `Прийом ${i + 1}`));
    const fullInput = full.getByRole('textbox', { name: 'Новий тип прийому їжі' });
    fireEvent.change(fullInput, { target: { value: 'Ще один' } });
    fireEvent.click(full.getByRole('button', { name: 'Додати' }));
    expect(full.getByRole('alert').textContent).toBe('Не більше 12 типів');
    expect(stored()).toHaveLength(12);
  });

  it('applies an add on top of the latest stored list (changed since render, e.g. by a sync)', () => {
    useDataStore.setState({
      data: sampleData({ settings: { ...sampleData().settings, mealTypes: ['Обід'] } }),
      sync: { ...initialSyncState(), loaded: true, online: true },
    });
    // Stale props: what she saw before the sync landed.
    render(<MealTypesCard mealTypes={DEFAULTS} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Новий тип прийому їжі' }), {
      target: { value: 'Ланч' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Додати' }));
    expect(stored()).toEqual(['Обід', 'Ланч']);
  });

  it('works with an empty list: no list, no toggle, the restore button and the no-type note', () => {
    const card = setup([]);
    expect(card.queryByRole('list')).toBeNull();
    expect(card.queryByRole('button', { name: /^(Змінити|Готово)$/ })).toBeNull();
    expect(
      screen.getByText(
        'Без типів новий прийом буде без назви. Перейменування не змінює вже записані прийоми.',
      ),
    ).toBeTruthy();
    fireEvent.click(card.getByRole('button', { name: 'Повернути стандартні' }));
    expect(stored()).toEqual(DEFAULTS);
    expect(names()).toEqual(DEFAULTS);
    expect(status()).toBe('Повернуто: Сніданок, Обід, Вечеря, Перекус');
    // The button went away: the add field takes the focus.
    expect(card.queryByRole('button', { name: 'Повернути стандартні' })).toBeNull();
    expect(document.activeElement).toBe(card.getByRole('textbox', { name: 'Новий тип прийому їжі' }));
  });
});

describe('MealTypesCard — edit mode', () => {
  it('«Змінити» turns every row into a field with ↑ ↓ ✕; «Готово» turns them back', () => {
    const card = editMode();
    expect(toggle(card).textContent).toBe('Готово');
    expect(toggle(card).getAttribute('aria-pressed')).toBe('true');
    for (const name of DEFAULTS) {
      const field = nameField(card, name);
      expect(field.value).toBe(name);
      expect(field.maxLength).toBe(30);
      expect(card.getByRole('button', { name: `Вище: ${name}` })).toBeTruthy();
      expect(card.getByRole('button', { name: `Нижче: ${name}` })).toBeTruthy();
      expect(card.getByRole('button', { name: `Видалити «${name}»` })).toBeTruthy();
    }
    // The add form stays.
    expect(card.getByRole('textbox', { name: 'Новий тип прийому їжі' })).toBeTruthy();

    fireEvent.click(toggle(card));
    expect(toggle(card).textContent).toBe('Змінити');
    expect(card.queryByRole('textbox', { name: /^Назва/ })).toBeNull();
    expect(names()).toEqual(DEFAULTS);
  });

  it('marks ↑ of the first row and ↓ of the last aria-disabled, never natively disabled', () => {
    const card = editMode();
    const up = card.getByRole<HTMLButtonElement>('button', { name: 'Вище: Сніданок' });
    const down = card.getByRole<HTMLButtonElement>('button', { name: 'Нижче: Перекус' });
    for (const end of [up, down]) {
      expect(end.getAttribute('aria-disabled')).toBe('true');
      expect(end.disabled).toBe(false);
      fireEvent.click(end);
    }
    expect(stored()).toEqual(DEFAULTS);
    expect(card.getByRole('button', { name: 'Нижче: Сніданок' }).getAttribute('aria-disabled')).toBeNull();
    expect(card.getByRole('button', { name: 'Вище: Перекус' }).getAttribute('aria-disabled')).toBeNull();
  });

  it('moves a row and keeps the focus on the same button of the moved row', () => {
    const card = editMode();
    const down = card.getByRole('button', { name: 'Нижче: Обід' });
    down.focus();
    fireEvent.click(down);
    expect(stored()).toEqual(['Сніданок', 'Вечеря', 'Обід', 'Перекус']);
    expect(document.activeElement).toBe(card.getByRole('button', { name: 'Нижче: Обід' }));
    expect(status()).toBe('Обід — нижче');

    fireEvent.click(card.getByRole('button', { name: 'Нижче: Обід' }));
    expect(stored()).toEqual(['Сніданок', 'Вечеря', 'Перекус', 'Обід']);
    // Now the last row: its ↓ keeps the focus, aria-disabled.
    const last = card.getByRole('button', { name: 'Нижче: Обід' });
    expect(document.activeElement).toBe(last);
    expect(last.getAttribute('aria-disabled')).toBe('true');
    expect(status()).toBe('Обід — нижче');

    fireEvent.click(card.getByRole('button', { name: 'Вище: Обід' }));
    expect(stored()).toEqual(['Сніданок', 'Вечеря', 'Обід', 'Перекус']);
    expect(document.activeElement).toBe(card.getByRole('button', { name: 'Вище: Обід' }));
    expect(status()).toBe('Обід — вище');
  });

  it('announces the same move twice as two messages', () => {
    const card = editMode();
    fireEvent.click(card.getByRole('button', { name: 'Вище: Перекус' }));
    const first = screen.getByRole('status').firstElementChild;
    fireEvent.click(card.getByRole('button', { name: 'Вище: Перекус' }));
    const second = screen.getByRole('status').firstElementChild;
    expect(second?.textContent).toBe('Перекус — вище');
    // A new node inside the same live region: screen readers read it again.
    expect(second).not.toBe(first);
  });

  it('renames on Enter, keeping the row and the focus in its field', () => {
    const card = editMode();
    const field = nameField(card, 'Перекус');
    field.focus();
    fireEvent.change(field, { target: { value: ' Перекуси ' } });
    // Nothing is saved while she types.
    expect(stored()).toEqual(DEFAULTS);
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(stored()).toEqual(['Сніданок', 'Обід', 'Вечеря', 'Перекуси']);
    expect(nameField(card, 'Перекуси')).toBe(field);
    expect(field.value).toBe('Перекуси');
    expect(document.activeElement).toBe(field);
    expect(status()).toBe('Перекус → Перекуси');
    // The buttons of the row follow the new name.
    expect(card.getByRole('button', { name: 'Видалити «Перекуси»' })).toBeTruthy();
  });

  it('renames on blur', () => {
    const card = editMode();
    const field = nameField(card, 'Обід');
    fireEvent.change(field, { target: { value: 'Ланч' } });
    fireEvent.blur(field);
    expect(stored()).toEqual(['Сніданок', 'Ланч', 'Вечеря', 'Перекус']);
    expect(status()).toBe('Обід → Ланч');
  });

  it('a blur rename does not swallow the tap on the row’s own ↑ that caused it', () => {
    const card = editMode();
    const field = nameField(card, 'Вечеря');
    field.focus();
    fireEvent.change(field, { target: { value: 'Вечір' } });
    const up = card.getByRole('button', { name: 'Вище: Вечеря' });
    // Pressing ↑ moves the focus first: the field's blur saves the rename before the click lands.
    act(() => up.focus());
    expect(stored()).toEqual(['Сніданок', 'Обід', 'Вечір', 'Перекус']);
    // The row kept its elements: the same button, now named after the new type, takes the click.
    expect(card.getByRole('button', { name: 'Вище: Вечір' })).toBe(up);
    fireEvent.click(up);
    expect(stored()).toEqual(['Сніданок', 'Вечір', 'Обід', 'Перекус']);
  });

  it('Escape puts the stored name back and goes no further', () => {
    const card = editMode();
    const onWindow = vi.fn();
    window.addEventListener('keydown', onWindow);
    const field = nameField(card, 'Обід');
    fireEvent.change(field, { target: { value: 'Ланч' } });
    fireEvent.keyDown(field, { key: 'Escape' });
    window.removeEventListener('keydown', onWindow);
    expect(field.value).toBe('Обід');
    expect(onWindow).not.toHaveBeenCalled();
    fireEvent.blur(field);
    expect(stored()).toEqual(DEFAULTS);
  });

  it('does nothing for an empty or unchanged name', () => {
    const card = editMode();
    const field = nameField(card, 'Обід');
    fireEvent.change(field, { target: { value: '   ' } });
    fireEvent.blur(field);
    expect(field.value).toBe('Обід');
    fireEvent.change(field, { target: { value: 'Обід ' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(stored()).toEqual(DEFAULTS);
    expect(status()).toBe('');
  });

  it('refuses the name of another type: kept to fix on Enter, the stored name back on blur', () => {
    const card = editMode();
    const field = nameField(card, 'Перекус');
    fireEvent.change(field, { target: { value: 'вечеря' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    const alert = card.getByRole('alert');
    expect(alert.textContent).toBe('Такий тип уже є');
    expect(field.value).toBe('вечеря');
    expect(field.getAttribute('aria-invalid')).toBe('true');
    expect(field.getAttribute('aria-describedby')).toBe(alert.id);
    // The error sits in the row it belongs to.
    expect(alert.closest('li')).toBe(field.closest('li'));

    fireEvent.blur(field);
    expect(field.value).toBe('Перекус');
    expect(field.getAttribute('aria-invalid')).toBeNull();
    expect(card.getByRole('alert').textContent).toBe('Такий тип уже є');
    expect(stored()).toEqual(DEFAULTS);
  });

  it('removes a row without asking; the focus moves to the next row’s ✕, then back to the add field', () => {
    const card = editMode();
    fireEvent.click(card.getByRole('button', { name: 'Видалити «Обід»' }));
    expect(stored()).toEqual(['Сніданок', 'Вечеря', 'Перекус']);
    expect(document.activeElement).toBe(card.getByRole('button', { name: 'Видалити «Вечеря»' }));
    expect(status()).toBe('Обід видалено');
    // A default is missing now: it can come back (at the end).
    fireEvent.click(card.getByRole('button', { name: 'Видалити «Перекус»' }));
    expect(document.activeElement).toBe(card.getByRole('button', { name: 'Видалити «Вечеря»' }));
    fireEvent.click(card.getByRole('button', { name: 'Повернути стандартні' }));
    expect(stored()).toEqual(['Сніданок', 'Вечеря', 'Обід', 'Перекус']);
    expect(status()).toBe('Повернуто: Обід, Перекус');
  });

  it('leaves edit mode when the last type is removed', () => {
    const card = setup(['Обід']);
    fireEvent.click(toggle(card));
    fireEvent.click(card.getByRole('button', { name: 'Видалити «Обід»' }));
    expect(stored()).toEqual([]);
    expect(card.queryByRole('button', { name: /^(Змінити|Готово)$/ })).toBeNull();
    expect(document.activeElement).toBe(card.getByRole('textbox', { name: 'Новий тип прийому їжі' }));

    fireEvent.change(card.getByRole('textbox', { name: 'Новий тип прийому їжі' }), {
      target: { value: 'Вечеря' },
    });
    fireEvent.click(card.getByRole('button', { name: 'Додати' }));
    // Back in the calm view.
    expect(toggle(card).textContent).toBe('Змінити');
    expect(names()).toEqual(['Вечеря']);
  });

  it('follows a change from elsewhere (sync) without losing the name she is typing', () => {
    const card = editMode();
    const field = nameField(card, 'Обід');
    fireEvent.change(field, { target: { value: 'Ланч' } });
    act(() => {
      dataActions.updateSettings((st) => ({ ...st, mealTypes: ['Сніданок', 'Обід', 'Вечеря', 'Полуденок'] }));
    });
    expect(nameField(card, 'Полуденок').value).toBe('Полуденок');
    expect(field.value).toBe('Ланч');
  });
});
