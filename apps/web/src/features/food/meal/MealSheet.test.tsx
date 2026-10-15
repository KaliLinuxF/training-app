import { emptyData, normalizeDay, type AppData, type Meal } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { ui } from '@/store/ui';
import { ConfirmHost, Sheet } from '@/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { resetFoodStatus } from '../foodStatus';
import type { MealTarget } from './mealModel';
import { DISCARD_MEAL_CONFIRM, MealSheet } from './MealSheet';
import { dataActions, fakeStore } from './testStore';

vi.mock('@/store/data', async () => (await import('./testStore')).storeModule);
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { foodStatus: vi.fn(() => new Promise(() => undefined)), foodEstimate: vi.fn() },
}));

const TODAY = '2026-10-14';

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: '13:00',
  text: type,
  kcal,
  protein: null,
  fat: null,
  carbs: null,
  ...extra,
});

function dataWith(meals: Meal[]): AppData {
  const data = emptyData();
  data.days[TODAY] = normalizeDay({ food: '', kcal: null, trained: null, types: [], notes: '', meals });
  return data;
}

/** «Їжа» with a row that opens the stacked editor, as the capture host does. */
function Host({ initial, onClose }: { initial: MealTarget | null; onClose?: () => void }) {
  const [target, setTarget] = useState<MealTarget | null>(initial);
  return (
    <>
      <Sheet open onClose={() => undefined} heading="Їжа">
        <button type="button" onClick={() => setTarget({ date: TODAY, mealId: null, key: 7 })}>
          Додати прийом їжі
        </button>
        <MealSheet
          target={target}
          onClose={() => {
            onClose?.();
            setTarget(null);
          }}
        />
      </Sheet>
      <ConfirmHost />
    </>
  );
}

const mealSheet = () => screen.getByRole('dialog', { name: 'Прийом їжі' });
const save = () => within(mealSheet()).getByRole('button', { name: 'Зберегти' }) as HTMLButtonElement;
const text = () => within(mealSheet()).getByRole('textbox', { name: 'Що я їла' });
const gone = () => waitFor(() => expect(screen.queryByRole('dialog', { name: 'Прийом їжі' })).toBeNull());

beforeAll(() => {
  installMatchMedia();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 14, 10, 0));
});

afterAll(() => {
  vi.useRealTimers();
});

beforeEach(() => {
  stubScrollTo();
  resetFoodStatus({ enabled: true, remainingToday: 42 });
  fakeStore.reset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('MealSheet', () => {
  it('stacks over the sheet it is rendered in: that one sleeps (inert) until it closes', async () => {
    render(<Host initial={null} />);
    const day = screen.getByRole('dialog', { name: 'Їжа' });
    fireEvent.click(screen.getByRole('button', { name: 'Додати прийом їжі' }));
    expect(mealSheet().getAttribute('aria-modal')).toBe('true');
    expect(day.parentElement?.hasAttribute('inert')).toBe(true);
    expect(Number(mealSheet().parentElement?.style.zIndex)).toBeGreaterThan(
      Number(day.parentElement?.style.zIndex),
    );
    // A new meal: the keyboard opens on the text.
    expect(document.activeElement).toBe(text());
    fireEvent.click(within(mealSheet()).getByRole('button', { name: 'Закрити' }));
    expect(day.parentElement?.hasAttribute('inert')).toBe(false);
    await gone();
  });

  it('«Зберегти» waits for content (and says why); saving closes it with «Збережено»', async () => {
    const flash = vi.spyOn(ui, 'flash');
    const onClose = vi.fn();
    render(<Host initial={{ date: TODAY, mealId: null, key: 1 }} onClose={onClose} />);
    expect(save().disabled).toBe(true);
    const why = within(mealSheet()).getByText('Опиши, що їла, або додай калорії чи фото');
    expect(save().getAttribute('aria-describedby')).toBe(why.id);
    fireEvent.change(text(), { target: { value: 'Тост з тунцем' } });
    expect(save().disabled).toBe(false);
    expect(save().hasAttribute('aria-describedby')).toBe(false);
    fireEvent.click(save());
    expect(onClose).toHaveBeenCalledOnce();
    expect(flash).toHaveBeenCalledWith('Збережено');
    expect(fakeStore.data.days[TODAY]?.meals?.[0]).toMatchObject({ type: 'Сніданок', text: 'Тост з тунцем' });
    await gone();
  });

  it('a refused save stays open and says so (an alert above «Зберегти»)', () => {
    const onClose = vi.fn();
    render(<Host initial={{ date: TODAY, mealId: null, key: 1 }} onClose={onClose} />);
    fireEvent.change(text(), { target: { value: 'борщ' } });
    dataActions.saveMeal.mockReturnValueOnce(false);
    fireEvent.click(save());
    expect(onClose).not.toHaveBeenCalled();
    const alert = within(mealSheet()).getByRole('alert');
    expect(alert.textContent).toBe('Не вдалося зберегти — перевір дані й спробуй ще раз');
    expect(save().getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('closing with changes asks «Є незбережені зміни»; staying keeps everything, «Закрити» drops it', async () => {
    const confirm = vi.spyOn(ui, 'confirm');
    const onClose = vi.fn();
    render(<Host initial={{ date: TODAY, mealId: null, key: 1 }} onClose={onClose} />);
    // Untouched: closes at once.
    fireEvent.change(text(), { target: { value: 'борщ' } });
    fireEvent.click(within(mealSheet()).getByRole('button', { name: 'Закрити' }));
    expect(confirm).toHaveBeenCalledWith({ ...DISCARD_MEAL_CONFIRM });
    expect(DISCARD_MEAL_CONFIRM).toEqual({
      title: 'Є незбережені зміни',
      body: 'Закрити без збереження?',
      confirmLabel: 'Закрити',
      cancelLabel: 'Залишитись',
      destructive: true,
    });
    const ask = await screen.findByRole('alertdialog', { name: 'Є незбережені зміни' });
    fireEvent.click(within(ask).getByRole('button', { name: 'Залишитись' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(onClose).not.toHaveBeenCalled();
    expect((text() as HTMLTextAreaElement).value).toBe('борщ');

    // Escape asks the same (only the top sheet answers it).
    act(() => {
      fireEvent.keyDown(document, { key: 'Escape' });
    });
    const again = await screen.findByRole('alertdialog', { name: 'Є незбережені зміни' });
    fireEvent.click(within(again).getByRole('button', { name: 'Закрити' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(screen.getByRole('dialog', { name: 'Їжа' })).toBeTruthy();
    expect(fakeStore.data.days[TODAY]).toBeUndefined();
  });

  it('nothing changed: ✕ closes without asking', () => {
    const confirm = vi.spyOn(ui, 'confirm');
    const onClose = vi.fn();
    render(<Host initial={{ date: TODAY, mealId: null, key: 1 }} onClose={onClose} />);
    fireEvent.click(within(mealSheet()).getByRole('button', { name: 'Закрити' }));
    expect(confirm).not.toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledOnce();
  });

  it('«Видалити прийом» closes it with «Прийом видалено»', async () => {
    fakeStore.reset(dataWith([meal('lunch', 'Обід', 560)]));
    const flash = vi.spyOn(ui, 'flash');
    const onClose = vi.fn();
    render(<Host initial={{ date: TODAY, mealId: 'lunch', key: 1 }} onClose={onClose} />);
    expect(document.activeElement).not.toBe(text());
    fireEvent.click(within(mealSheet()).getByRole('button', { name: 'Видалити прийом' }));
    const ask = await screen.findByRole('alertdialog', { name: 'Видалити прийом їжі?' });
    expect(within(ask).getByText('Обід · 560 ккал')).toBeTruthy();
    fireEvent.click(within(ask).getByRole('button', { name: 'Видалити' }));
    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
    expect(flash).toHaveBeenCalledWith('Прийом видалено');
    expect(fakeStore.data.days[TODAY]).toBeUndefined();
  });

  it('the item editor stacks above it in turn (three levels: day, meal, position)', async () => {
    fakeStore.reset(
      dataWith([
        meal('b', 'Сніданок', null, {
          items: [{ name: 'Тост', portion: '2 шт', kcal: 300, protein: 20, fat: 10, carbs: 30 }],
        }),
      ]),
    );
    render(<Host initial={{ date: TODAY, mealId: 'b', key: 1 }} />);
    const day = screen.getByRole('dialog', { name: 'Їжа' });
    fireEvent.click(within(mealSheet()).getByRole('button', { name: /^Тост, / }));
    const position = screen.getByRole('dialog', { name: 'Позиція' });
    expect(mealSheet().parentElement?.hasAttribute('inert')).toBe(true);
    expect(day.parentElement?.hasAttribute('inert')).toBe(true);
    const z = [day, mealSheet(), position].map((d) => Number(d.parentElement?.style.zIndex));
    expect(z).toEqual([60, 62, 64]);
    fireEvent.click(within(position).getByRole('button', { name: 'Закрити' }));
    expect(mealSheet().parentElement?.hasAttribute('inert')).toBe(false);
    expect(day.parentElement?.hasAttribute('inert')).toBe(true);
  });
});
