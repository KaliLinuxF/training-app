import { emptyData, normalizeDay, type AppData, type DayEntry, type Meal } from '@legko/shared';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AddMealButton, FoodDayPanel } from './FoodDayPanel';
import { foodDayModel, LEGACY_NOTE, MEALS_CAP_NOTE } from './foodDayModel';

const DATE = '2026-10-14';
const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s/g, ' ');

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: null,
  text: '',
  kcal,
  protein: null,
  fat: null,
  carbs: null,
  ...extra,
});

const BREAKFAST = meal('m1', 'Сніданок', 420, {
  time: '08:30',
  text: 'Тост з тунцем, кава',
  protein: 27,
  fat: 11,
  carbs: 36,
  photos: ['photo_aaaaaaaaaaaaaaaa'],
});
const SNACK = meal('m2', 'Перекус', null, { text: 'Яблуко' });

function data(day: Partial<DayEntry> | null, patch: (d: AppData) => void = () => undefined): AppData {
  const d = emptyData();
  if (day) d.days[DATE] = normalizeDay({ food: '', kcal: null, trained: null, types: [], notes: '', ...day });
  patch(d);
  return d;
}

function renderPanel(variant: 'sheet' | 'field', appData: AppData) {
  const onOpenMeal = vi.fn();
  render(<FoodDayPanel model={foodDayModel(appData, DATE)} variant={variant} onOpenMeal={onOpenMeal} />);
  return onOpenMeal;
}

const list = () => screen.getByRole('region', { name: 'Прийоми їжі' });

/** No interactive element inside another one (WCAG: nested controls). */
function expectNoNestedControls(root: HTMLElement) {
  for (const control of root.querySelectorAll('button, a, input, textarea, select')) {
    expect(control.parentElement?.closest('button, a')).toBeNull();
  }
}

afterEach(cleanup);

describe('FoodDayPanel — «Їжа» sheet', () => {
  it('the totals card, then the region «Прийоми їжі»: one row per meal, named in full, opening a dialog', () => {
    const onOpen = renderPanel('sheet', data({ meals: [SNACK, BREAKFAST] }));
    expect(screen.getByRole('region', { name: 'Підсумок дня' })).toBeTruthy();
    const rows = within(list()).getAllByRole('button', { name: /^(Сніданок|Перекус)/ });
    // Timed meals first.
    expect(rows.map((r) => flat(r.getAttribute('aria-label')))).toEqual([
      'Сніданок о 08:30: тост з тунцем, кава. 420 ккал, білки 27, жири 11, вуглеводи 36 г',
      'Перекус: яблуко',
    ]);
    for (const row of rows) expect(row.getAttribute('aria-haspopup')).toBe('dialog');
    // What the row shows: type · time, the text on one line, the macros, the kcal (or «—»).
    const [first, second] = rows;
    expect(flat(first?.textContent)).toContain('Сніданок · 08:30');
    expect(flat(first?.textContent)).toContain('Тост з тунцем, кава');
    expect(flat(first?.textContent)).toContain('Б 27 · Ж 11 · В 36 г');
    expect(flat(first?.textContent)).toContain('420 ккал');
    expect(flat(second?.textContent)).toContain('—');
    expect(flat(second?.textContent)).not.toContain('Б ');

    fireEvent.click(rows[0] as HTMLElement);
    expect(onOpen).toHaveBeenLastCalledWith('m1');
    fireEvent.click(rows[1] as HTMLElement);
    expect(onOpen).toHaveBeenLastCalledWith('m2');
  });

  it('photos sit under their row, outside its button (no nested controls)', () => {
    renderPanel('sheet', data({ meals: [BREAKFAST, SNACK] }));
    const row = within(list()).getByRole('button', { name: /^Сніданок/ });
    const thumbs = list().querySelectorAll('img');
    expect(thumbs).toHaveLength(1);
    expect(row.contains(thumbs[0] ?? null)).toBe(false);
    expectNoNestedControls(document.body);
  });

  it('an empty day: no list, the muted line; the macro block only with a goal', () => {
    renderPanel('sheet', data(null));
    expect(screen.queryByRole('region', { name: 'Прийоми їжі' })).toBeNull();
    expect(screen.getByText('Ще нічого не записано за цей день')).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Підсумок дня' }).querySelector('dl')).toBeNull();
    cleanup();
    renderPanel(
      'sheet',
      data(null, (d) => (d.settings.macroGoals = { protein: 90, fat: null, carbs: null })),
    );
    expect(screen.getByRole('region', { name: 'Підсумок дня' }).querySelector('dl')).not.toBeNull();
  });

  it('a legacy day: one entry «Їжа за день» and the note under the list', () => {
    const onOpen = renderPanel('sheet', data({ food: 'Вівсянка з бананом, кава', kcal: 1880 }));
    const row = within(list()).getByRole('button', { name: /^Їжа за день/ });
    expect(flat(row.getAttribute('aria-label'))).toBe('Їжа за день: вівсянка з бананом, кава. 1 880 ккал');
    expect(within(list()).getByText(LEGACY_NOTE)).toBeTruthy();
    fireEvent.click(row);
    expect(onOpen).toHaveBeenCalledWith('legacy');
    // 1 880 is over the 1 700 goal.
    expect(flat(screen.getByText(/^Перевищено/).textContent)).toBe('Перевищено на 180 ккал · ціль 1 700');
  });

  it('a day exactly on its goal says so', () => {
    renderPanel('sheet', data({ meals: [meal('a', 'Обід', 1700, { text: 'Суп' })] }));
    expect(flat(screen.getByText(/^Ціль досягнута/).textContent)).toBe('Ціль досягнута — 1 700 ккал');
  });
});

describe('FoodDayPanel — «Запис дня» field', () => {
  it('label «Їжа», the same region «Прийоми їжі» (no photos), the one-line total and «+ Прийом їжі»', () => {
    const onOpen = renderPanel(
      'field',
      data({
        meals: [
          BREAKFAST,
          meal('m3', 'Обід', 560, { time: '13:10', text: 'Борщ', protein: 21, fat: 19, carbs: 64 }),
        ],
      }),
    );
    expect(screen.getByText('Їжа')).toBeTruthy();
    const region = list();
    expect(
      within(region)
        .getAllByRole('button')
        .map((b) => b.getAttribute('aria-label')?.split(' ')[0]),
    ).toEqual(['Сніданок', 'Обід']);
    expect(region.querySelectorAll('img')).toHaveLength(0);
    expect(flat(screen.getByText(/^Разом/).textContent)).toBe(
      'Разом 980 / 1 700 ккал · Б 48 · Ж 30 · В 100 г',
    );
    const add = screen.getByRole('button', { name: 'Додати прийом їжі' });
    expect(add.textContent).toBe('+ Прийом їжі');
    expect(add.hasAttribute('aria-disabled')).toBe(false);
    fireEvent.click(add);
    expect(onOpen).toHaveBeenLastCalledWith(null);
    fireEvent.click(within(region).getByRole('button', { name: /^Обід/ }));
    expect(onOpen).toHaveBeenLastCalledWith('m3');
    expectNoNestedControls(document.body);
  });

  it('empty: «Ще нічого не записано» and the button, no total line', () => {
    renderPanel('field', data(null));
    expect(screen.getByText('Ще нічого не записано')).toBeTruthy();
    expect(screen.queryByText(/^Разом/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Додати прийом їжі' })).toBeTruthy();
  });

  it('20 meals: the button stays focusable but does nothing, the reason is read with it', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => meal(`m${i}`, 'Перекус', 10, { text: `${i}` }));
    const onOpen = renderPanel('field', data({ meals: twenty }));
    const add = screen.getByRole('button', { name: 'Додати прийом їжі' }) as HTMLButtonElement;
    expect(add.getAttribute('aria-disabled')).toBe('true');
    expect(add.disabled).toBe(false);
    const note = screen.getByText(MEALS_CAP_NOTE);
    expect(add.getAttribute('aria-describedby')).toBe(note.id);
    fireEvent.click(add);
    expect(onOpen).not.toHaveBeenCalled();
  });
});

describe('AddMealButton', () => {
  it('solid in the «Їжа» footer, outline in the field', () => {
    const onAdd = vi.fn();
    render(<AddMealButton canAdd variant="solid" onAdd={onAdd} />);
    fireEvent.click(screen.getByRole('button', { name: 'Додати прийом їжі' }));
    expect(onAdd).toHaveBeenCalledOnce();
    expect(screen.queryByText(MEALS_CAP_NOTE)).toBeNull();
  });
});
