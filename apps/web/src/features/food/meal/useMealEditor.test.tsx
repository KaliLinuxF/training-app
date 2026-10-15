import { emptyData, normalizeDay, type AppData, type FoodEstimateResponse, type Meal } from '@legko/shared';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { ui } from '@/store/ui';
import { dishAction, type MealTarget } from './mealModel';
import { dataActions, fakeStore } from './testStore';
import { useMealEditor, type MealEditorDeps } from './useMealEditor';

vi.mock('@/store/data', async () => (await import('./testStore')).storeModule);
vi.mock('@/lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: { foodStatus: vi.fn(() => new Promise(() => undefined)), foodEstimate: vi.fn() },
}));

const TODAY = '2026-10-14';
const PAST = '2026-10-12';
const NO_MACROS = { protein: null, fat: null, carbs: null };

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: null,
  text: type,
  kcal,
  ...NO_MACROS,
  ...extra,
});

function dataWith(meals: Meal[], date = TODAY): AppData {
  const data = emptyData();
  if (meals.length)
    data.days[date] = normalizeDay({ food: '', kcal: null, trained: null, types: [], notes: '', meals });
  return data;
}

const estimate = vi.fn<(...args: unknown[]) => Promise<FoodEstimateResponse>>();
const DEPS: MealEditorDeps = {
  estimate: { estimate, notify: vi.fn() },
  now: () => new Date(2026, 9, 14, 10, 0),
};

function mount(initial: MealTarget | null, data: AppData = emptyData()) {
  fakeStore.reset(data);
  return renderHook(({ target }: { target: MealTarget | null }) => useMealEditor(target, DEPS), {
    initialProps: { target: initial },
  });
}

const target = (over: Partial<MealTarget> = {}): MealTarget => ({
  date: TODAY,
  mealId: null,
  key: 1,
  ...over,
});

beforeEach(() => {
  estimate.mockReset();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('useMealEditor', () => {
  it('idle without a target: no session, never dirty, nothing to save or delete', async () => {
    const { result } = mount(null);
    expect(result.current.session).toBeNull();
    expect(result.current).toMatchObject({ target: null, dirty: false, canSave: false, isNew: true });
    expect(result.current.saveHint).toBeUndefined();
    expect(result.current.save()).toBe(false);
    await expect(result.current.remove()).resolves.toBe(false);
  });

  it('a new meal: «Зберегти» waits for content; then saves meal.put with its uses', () => {
    const { result } = mount(target());
    expect(result.current.isNew).toBe(true);
    expect(result.current.session?.draft).toMatchObject({ type: 'Сніданок', time: '10:00' });
    expect(result.current).toMatchObject({
      canSave: false,
      dirty: false,
      saveHint: 'Опиши, що їла, або додай калорії чи фото',
    });

    act(() => result.current.session?.dispatch({ type: 'text', value: 'Тост з тунцем' }));
    act(() =>
      result.current.session?.dispatch(
        dishAction('d1', {
          name: 'Кава з молоком',
          portion: '1 чашка',
          kcal: 60,
          protein: 3,
          fat: 3,
          carbs: 5,
        }),
      ),
    );
    expect(result.current).toMatchObject({ canSave: true, dirty: true });
    expect(result.current.saveHint).toBeUndefined();

    let ok = false;
    act(() => {
      ok = result.current.save();
    });
    expect(ok).toBe(true);
    const id = result.current.session?.draft.id;
    expect(dataActions.saveMeal).toHaveBeenCalledWith(
      TODAY,
      expect.objectContaining({ id, type: 'Сніданок', time: '10:00', text: 'Тост з тунцем', kcal: 60 }),
      [{ name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 }],
    );
    expect(fakeStore.data.days[TODAY]?.meals?.map((m) => m.id)).toEqual([id]);
    expect(fakeStore.data.days[TODAY]?.food).toBe('Сніданок: Тост з тунцем');
  });

  it('a refused save keeps the draft and says so until the next edit', () => {
    const { result } = mount(target());
    act(() => result.current.session?.dispatch({ type: 'text', value: 'борщ' }));
    dataActions.saveMeal.mockReturnValueOnce(false);
    let ok = true;
    act(() => {
      ok = result.current.save();
    });
    expect(ok).toBe(false);
    expect(result.current.saveError).toBe('Не вдалося зберегти — перевір дані й спробуй ще раз');
    expect(result.current.session?.draft.text).toBe('борщ');
    expect(result.current.canSave).toBe(true);
    act(() => result.current.session?.dispatch({ type: 'text', value: 'борщ, хліб' }));
    expect(result.current.saveError).toBeUndefined();
  });

  it('a new meal on a day with 20: not saved, with the reason', () => {
    const twenty = dataWith(Array.from({ length: 20 }, (_, i) => meal(`m${i}`, 'Перекус', 10)));
    const { result } = mount(target(), twenty);
    act(() => result.current.session?.dispatch({ type: 'text', value: 'яблуко' }));
    expect(result.current).toMatchObject({ canSave: false, saveHint: 'Не більше 20 прийомів на день' });
    expect(result.current.save()).toBe(false);
    expect(dataActions.saveMeal).not.toHaveBeenCalled();
  });

  it('«Видалити прийом»: asks with the meal’s title and kcal, deletes only when she agrees', async () => {
    const data = dataWith([meal('lunch', 'Обід', 560), meal('snack', 'Перекус', null)]);
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValueOnce(false);
    const { result, rerender } = mount(target({ mealId: 'lunch' }), data);
    expect(result.current.isNew).toBe(false);
    await expect(result.current.remove()).resolves.toBe(false);
    expect(confirm).toHaveBeenLastCalledWith({
      title: 'Видалити прийом їжі?',
      body: 'Обід · 560 ккал',
      confirmLabel: 'Видалити',
      cancelLabel: 'Залишити',
      destructive: true,
    });
    expect(dataActions.deleteMeal).not.toHaveBeenCalled();

    confirm.mockResolvedValueOnce(true);
    let ok = false;
    await act(async () => {
      ok = await result.current.remove();
    });
    expect(ok).toBe(true);
    expect(dataActions.deleteMeal).toHaveBeenCalledWith(TODAY, 'lunch');

    // Without kcal the body is just the title.
    rerender({ target: target({ mealId: 'snack', key: 2 }) });
    confirm.mockResolvedValueOnce(false);
    await act(async () => {
      await result.current.remove();
    });
    expect(confirm).toHaveBeenLastCalledWith(expect.objectContaining({ body: 'Перекус' }));
  });

  it('a new key (or another meal) starts afresh', () => {
    const data = dataWith([meal('lunch', 'Обід', 500)]);
    const { result, rerender } = mount(target(), data);
    act(() => result.current.session?.dispatch({ type: 'text', value: 'борщ' }));
    const first = result.current.session?.draft.id;
    rerender({ target: target({ key: 2 }) });
    expect(result.current.session?.draft.text).toBe('');
    expect(result.current.session?.draft.id).not.toBe(first);
    rerender({ target: target({ key: 2, mealId: 'lunch' }) });
    expect(result.current.session?.draft).toMatchObject({ id: 'lunch', text: 'Обід', isNew: false });
  });

  it('a date-only change moves a new meal’s draft: content kept, type and time suggested for that day', () => {
    const data = dataWith([meal('b', 'Сніданок', 300)], PAST);
    const { result, rerender } = mount(target(), data);
    act(() => result.current.session?.dispatch({ type: 'text', value: 'борщ' }));
    act(() => result.current.session?.dispatch({ type: 'kcal', value: '250' }));
    const id = result.current.session?.draft.id;
    rerender({ target: target({ date: PAST }) });
    expect(result.current.session?.date).toBe(PAST);
    expect(result.current.session?.draft).toMatchObject({
      id,
      text: 'борщ',
      kcalText: '250',
      type: 'Обід',
      time: null,
    });
    expect(result.current.dirty).toBe(true);
    // A type she picked herself stays.
    act(() => result.current.session?.dispatch({ type: 'type', value: 'Вечеря' }));
    rerender({ target: target() });
    expect(result.current.session?.draft).toMatchObject({ type: 'Вечеря', time: '10:00', text: 'борщ' });
  });

  it('closed (target null): idle for the host, the draft kept for the exit animation, its request dropped', async () => {
    let signal: AbortSignal | undefined;
    estimate.mockImplementation((_req, s) => {
      signal = s as AbortSignal;
      return new Promise(() => undefined);
    });
    const { result, rerender } = mount(target());
    act(() => result.current.session?.dispatch({ type: 'text', value: 'борщ' }));
    act(() => result.current.session?.estimateText('борщ', 'борщ'));
    expect(estimate).toHaveBeenCalledOnce();
    expect(result.current.dirty).toBe(true);
    rerender({ target: null });
    expect(signal?.aborted).toBe(true);
    expect(result.current).toMatchObject({ target: null, dirty: false, canSave: false });
    expect(result.current.session?.draft.text).toBe('борщ');
  });
});
