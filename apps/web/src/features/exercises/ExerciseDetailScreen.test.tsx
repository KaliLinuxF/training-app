import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getAppData } from '@/store/data';
import { useUiStore } from '@/store/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { ExerciseDetailScreen, NO_HISTORY, NOT_FOUND } from './ExerciseDetailScreen';
import { committed, lastBatch, seedStore } from './storeMock';
import { entry, session, set, STEP, trainingData } from './testData';

vi.mock('@/store/sync', async (original) => (await import('./storeMock')).syncModule(original));

beforeEach(async () => {
  installMatchMedia();
  stubScrollTo();
  window.history.replaceState(null, '');
  await seedStore(trainingData());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  useUiStore.setState({ confirm: null, toast: null });
});

function renderDetail(id: string) {
  const memory = memoryLocation({ path: `/workouts/library/${id}`, record: true });
  render(
    <Router hook={memory.hook}>
      <ExerciseDetailScreen id={id} />
    </Router>,
  );
  return memory;
}

/** textContent with every run of whitespace (incl. no-break spaces) as one space. */
const text = (el: Element | null): string => (el?.textContent ?? '').replace(/\s+/g, ' ').trim();

describe('ExerciseDetailScreen', () => {
  it('an unknown id: «Вправу не знайдено» and a way back', () => {
    renderDetail('lib.nope');
    expect(screen.getByRole('heading', { level: 1, name: NOT_FOUND })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Назад: Вправи' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'До бібліотеки' })).toBeTruthy();
  });

  it('with history: map, facts, the kg chart, the record, the hint and the last sessions', () => {
    renderDetail('lib.back-squat');
    expect(screen.getByRole('heading', { level: 1, name: 'Присідання зі штангою' })).toBeTruthy();
    expect(
      screen.getByRole('img', {
        name: 'Основні мʼязи: квадрицепс, сідниці. Допоміжні: задня поверхня стегна, привідні, поперек.',
      }),
    ).toBeTruthy();
    const facts = [...document.querySelectorAll('dl div')].map((row) => text(row));
    expect(facts).toEqual([
      'ТипЗ вагою',
      'ОбладнанняШтанга',
      'ОсновніКвадрицепс, сідниці',
      'ДопоміжніЗадня поверхня стегна, привідні, поперек',
      'ІнтенсивністьПомірна · MET 5,0',
    ]);
    const progress = screen.getByRole('region', { name: 'Прогрес' });
    expect(within(progress).getByText('Найкращий підхід, кг')).toBeTruthy();
    expect(within(progress).getByRole('img', { name: 'Найкращий підхід, кг: з 35 кг до 40 кг' })).toBeTruthy();
    expect(within(progress).getByText('Минулого разу всі підходи виконано — спробуй +2,5 кг')).toBeTruthy();
    expect(text(screen.getByRole('region', { name: 'Рекорди' }))).toBe('Рекорди 40 кг · 12 жовтня');
    const recent = within(screen.getByRole('region', { name: 'Останні тренування' })).getAllByRole('link');
    expect(recent).toHaveLength(4);
    expect(text(recent[0]!)).toBe('12 жовтня · Ноги + прес 3 × 12 · 40 кг');
    expect(recent[0]!.getAttribute('href')).toMatch(/^\/workouts\/session\/session\d+$/);
    // A library exercise cannot be changed or deleted.
    expect(screen.queryByRole('button', { name: 'Змінити' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Видалити' })).toBeNull();
  });

  it('no history: the invitation instead of the chart, no records', () => {
    renderDetail('lib.plank');
    expect(within(screen.getByRole('region', { name: 'Прогрес' })).getByText(NO_HISTORY)).toBeTruthy();
    expect(screen.queryByRole('region', { name: 'Рекорди' })).toBeNull();
    expect(screen.queryByRole('region', { name: 'Останні тренування' })).toBeNull();
  });

  it('one point: the value as text, no chart', async () => {
    const data = trainingData();
    data.sessions.push(session('2026-10-10', [entry('lib.plank', [set({ sec: 90 }), set({ sec: 60, done: false })])]));
    await seedStore(data);
    renderDetail('lib.plank');
    const progress = screen.getByRole('region', { name: 'Прогрес' });
    expect(within(progress).getByText('Найдовше, с')).toBeTruthy();
    expect(within(progress).getByText('1:30')).toBeTruthy();
    expect(within(progress).queryByRole('img')).toBeNull();
    expect(within(progress).queryByText(/Минулого разу/)).toBeNull();
  });

  it('opened from Progress: «‹ Прогрес»', () => {
    window.history.replaceState({ legkoFrom: '/progress' }, '');
    renderDetail('lib.back-squat');
    expect(screen.getByRole('link', { name: 'Назад: Прогрес' }).getAttribute('href')).toBe('/progress');
  });

  it('her exercise: «Змінити» opens the editor; «Видалити» confirms with the workouts count, deletes, goes back', async () => {
    const memory = renderDetail(STEP.id);
    expect(screen.getByRole('heading', { level: 1, name: 'Степ-аеробіка' })).toBeTruthy();
    expect(within(screen.getByRole('region', { name: 'Прогрес' })).getByText('Найдовше, хв')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Змінити' }));
    const editor = screen.getByRole('dialog', { name: 'Вправа' });
    fireEvent.change(within(editor).getByRole('textbox', { name: 'Назва' }), { target: { value: 'Степ' } });
    fireEvent.click(within(editor).getByRole('button', { name: 'Зберегти' }));
    expect(screen.getByRole('heading', { level: 1, name: 'Степ' })).toBeTruthy();

    // Cancel first: nothing happens.
    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));
    let confirm = useUiStore.getState().confirm;
    expect(confirm).toMatchObject({
      title: 'Видалити вправу «Степ»?',
      body: 'Її буде прибрано з 2 тренувань. Записані тренування залишаться.',
      confirmLabel: 'Видалити',
      destructive: true,
    });
    const before = committed.batches.length;
    await act(async () => confirm!.resolve(false));
    expect(committed.batches).toHaveLength(before);

    fireEvent.click(screen.getByRole('button', { name: 'Видалити' }));
    confirm = useUiStore.getState().confirm;
    await act(async () => confirm!.resolve(true));
    const ops = lastBatch();
    expect(ops[0]).toEqual({ kind: 'exercise.delete', id: STEP.id });
    expect(ops.slice(1).map((op) => op.kind)).toEqual(['workout.put', 'workout.put']);
    expect(getAppData().exercises).toEqual([]);
    expect(getAppData().workouts.every((w) => w.items.every((i) => i.exerciseId !== STEP.id))).toBe(true);
    // Recorded sessions keep their snapshot.
    expect(getAppData().sessions.some((s) => s.exercises.some((e) => e.exerciseId === STEP.id))).toBe(true);
    expect(useUiStore.getState().toast?.text).toBe('Вправу видалено');
    expect(memory.history?.at(-1)).toBe('/workouts/library');
  });
});
