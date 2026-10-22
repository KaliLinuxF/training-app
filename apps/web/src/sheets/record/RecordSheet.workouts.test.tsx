/**
 * RecordSheet for workouts and steps (docs/workouts-steps-rebrand.md §3.8, §3.16): the «Кроки» short sheet (big input,
 * ±500 / ±1000, the goal / kcal hint, empty deletes), the field in «Запис дня», and the «Тренування» sheet's start /
 * log / continue / recorded groups. Real store and sheets; the device cache is faked.
 */
import { emptyData, type AppData, type Op } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '@/lib/api';
import { session, workout } from '@/lib/stats/workouts.testing';
import type * as DataModule from '@/store/data';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { fakeIdb } from '@/store/test-utils';
import { ui, useUiStore } from '@/store/ui';
import { ConfirmHost } from '@/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { resetSetupShownForTests } from '../setupGate';
import { SheetHost } from '../SheetHost';

const TODAY = '2026-10-10'; // Saturday
const YESTERDAY = '2026-10-09';
const NOW = new Date(2026, 9, 10, 10, 0).getTime();

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
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
vi.mock('@/lib/api', async (importOriginal) => {
  const actual = await importOriginal<typeof ApiModule>();
  return { ...actual, api: { ...actual.api, foodStatus: vi.fn(() => new Promise(() => undefined)) } };
});

function seed(patch: Partial<AppData> = {}): AppData {
  const data = emptyData();
  data.settings = { ...data.settings, onboarded: true };
  data.weights = [{ date: '2026-10-01', kg: 70 }];
  return { ...data, ...patch };
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
const button = (root: HTMLElement, name: string | RegExp) =>
  within(root).getByRole('button', { name }) as HTMLButtonElement;
const allOps = (): Op[] => mocks.commits.flat();

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
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
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
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
  setData(seed());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  sessionStorage.clear();
  resetSetupShownForTests();
});

describe('«Кроки» short sheet', () => {
  it('«+» → «Кроки»: the big input, ±1000 / ±500, the kcal hint, and «Зберегти» stores the count', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'menu'));
    fireEvent.click(button(sheet('Що записати?'), /^Кроки/));
    const steps = sheet('Кроки');
    const input = within(steps).getByRole('textbox', { name: 'Кроки за день' }) as HTMLInputElement;
    expect(input.getAttribute('inputmode')).toBe('numeric');
    expect(input.value).toBe('');
    for (const name of ['Мінус 1000 кроків', 'Мінус 500 кроків', 'Плюс 500 кроків', 'Плюс 1000 кроків']) {
      expect(button(steps, name)).toBeTruthy();
    }
    // From empty the steppers start at 0 and never go below it.
    fireEvent.click(button(steps, 'Мінус 500 кроків'));
    expect(input.value).toBe('');
    fireEvent.click(button(steps, 'Плюс 1000 кроків'));
    fireEvent.click(button(steps, 'Плюс 1000 кроків'));
    fireEvent.click(button(steps, 'Плюс 500 кроків'));
    expect(input.value).toBe('2 500');
    // 2 500 × 0,0005 × 70 kg ≈ 88 ккал.
    expect(within(steps).getByText('≈ 88 ккал')).toBeTruthy();
    fireEvent.click(button(steps, 'Зберегти'));
    expect(allOps()).toEqual([{ kind: 'steps.put', date: TODAY, steps: 2500 }]);
    expect(data().steps).toEqual([{ date: TODAY, steps: 2500 }]);
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('typed digits are grouped; with a goal the hint says what is left, then «Ціль виконано ✓»', () => {
    setData(seed({ settings: { ...seed().settings, stepsGoal: 10000 } }));
    renderHost();
    act(() => ui.openSheet(TODAY, 'steps'));
    const steps = sheet('Кроки');
    const input = within(steps).getByRole('textbox', { name: 'Кроки за день' }) as HTMLInputElement;
    expect(flat(within(steps).getByText(/^Ціль/).textContent)).toBe('Ціль 10 000 — ще 10 000');
    fireEvent.change(input, { target: { value: '8 4a00' } });
    expect(input.value).toBe('8 400');
    expect(flat(within(steps).getByText(/^Ціль/).textContent)).toBe('Ціль 10 000 — ще 1 600');
    fireEvent.change(input, { target: { value: '10000' } });
    expect(within(steps).getByText('Ціль виконано ✓')).toBeTruthy();
  });

  it('pre-fills the stored count; emptying it and saving deletes the entry', () => {
    setData(seed({ steps: [{ date: TODAY, steps: 5000 }] }));
    renderHost();
    act(() => ui.openSheet(TODAY, 'steps'));
    const steps = sheet('Кроки');
    const input = within(steps).getByRole('textbox', { name: 'Кроки за день' }) as HTMLInputElement;
    expect(input.value).toBe('5 000');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(button(steps, 'Зберегти'));
    expect(allOps()).toEqual([{ kind: 'steps.delete', date: TODAY }]);
    expect(data().steps).toEqual([]);
  });

  it('caps at 100 000 and ‹ › moves to the day before', () => {
    renderHost();
    act(() => ui.openSheet(TODAY, 'steps'));
    const steps = sheet('Кроки');
    const input = within(steps).getByRole('textbox', { name: 'Кроки за день' }) as HTMLInputElement;
    fireEvent.change(input, { target: { value: '99800' } });
    fireEvent.click(button(steps, 'Плюс 1000 кроків'));
    expect(input.value).toBe('100 000');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.click(button(steps, 'Попередній день'));
    expect(useUiStore.getState().sheet).toMatchObject({ date: YESTERDAY, mode: 'steps' });
  });

  it('«Запис дня» has «Кроки (за бажанням)» and sends steps ops only when they changed', () => {
    setData(seed({ steps: [{ date: TODAY, steps: 3000 }] }));
    renderHost();
    act(() => ui.openSheet(TODAY, 'day'));
    const day = sheet('Запис дня');
    const input = within(day).getByRole('textbox', { name: 'Кроки (за бажанням)' }) as HTMLInputElement;
    expect(input.value).toBe('3 000');
    // No steppers in the full day.
    expect(within(day).queryByRole('button', { name: 'Плюс 500 кроків' })).toBeNull();
    fireEvent.change(day.querySelector('textarea[name="notes"]') as HTMLTextAreaElement, {
      target: { value: 'Добре' },
    });
    fireEvent.click(button(day, 'Зберегти'));
    expect(allOps().some((op) => op.kind.startsWith('steps.'))).toBe(false);

    act(() => ui.openSheet(TODAY, 'day'));
    const again = sheet('Запис дня');
    fireEvent.change(within(again).getByRole('textbox', { name: 'Кроки (за бажанням)' }), {
      target: { value: '6200' },
    });
    fireEvent.click(button(again, 'Зберегти'));
    expect(allOps()).toContainEqual({ kind: 'steps.put', date: TODAY, steps: 6200 });
  });
});

describe('«Тренування» sheet with workouts', () => {
  it('without any workout it stays as it was, with «Скласти своє тренування →»', () => {
    const memory = renderHost();
    act(() => ui.openSheet(TODAY, 'workout'));
    const s = sheet('Тренування');
    expect(within(s).queryByText('Почати тренування')).toBeNull();
    expect(button(s, 'Було')).toBeTruthy();
    expect(within(s).queryByText('Або просто відміть')).toBeNull();
    fireEvent.click(button(s, 'Скласти своє тренування →'));
    expect(memory.history.at(-1)).toBe('/workouts/new');
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('today: scheduled first with «За планом», then the others and «Вільне тренування»; a tap starts it', async () => {
    setData(
      seed({
        workouts: [
          workout({ id: 'workoutUpper1', name: 'Верх тіла', days: [5] }),
          workout({ id: 'workoutLegs01', name: 'Ноги + прес', days: [6] }),
        ],
      }),
    );
    const memory = renderHost();
    act(() => ui.openSheet(TODAY, 'workout'));
    const s = sheet('Тренування');
    const group = screen.getByRole('region', { name: 'Почати тренування' });
    const rows = within(group).getAllByRole('button');
    expect(rows.map((b) => flat(b.textContent).split(' ')[0])).toEqual(['Ноги', 'Верх', 'Вільне']);
    expect(flat(rows[0]?.textContent)).toContain('За планом');
    expect(flat(rows[0]?.textContent)).toContain('2 вправи');
    expect(within(s).getByText('Або просто відміть')).toBeTruthy();
    expect(button(s, 'Мої тренування →')).toBeTruthy();

    await act(async () => {
      fireEvent.click(rows[0] as HTMLElement);
    });
    // dataActions.startSession commits it (prefilled from the plan, live from now).
    await waitFor(() => expect(data().sessions).toHaveLength(1));
    const started = data().sessions[0];
    expect(started).toMatchObject({ workoutId: 'workoutLegs01', status: 'active', date: TODAY, startedAt: NOW });
    expect(memory.history.at(-1)).toBe(`/workouts/session/${started?.id ?? ''}`);
    expect(useUiStore.getState().sheet).toBeNull();
  });

  it('a past day logs instead: «Записати тренування» → the log screen for that date', () => {
    setData(seed({ workouts: [workout()] }));
    const memory = renderHost();
    act(() => ui.openSheet(YESTERDAY, 'workout'));
    const group = screen.getByRole('region', { name: 'Записати тренування' });
    fireEvent.click(within(group).getByRole('button', { name: /^Записати «Ноги \+ прес»/ }));
    expect(memory.history.at(-1)).toBe(`/workouts/log?date=${YESTERDAY}&workout=workoutLegs01`);
    expect(allOps()).toEqual([]);
  });

  it('a live session replaces the start group with «Тренування триває — Продовжити»', () => {
    const live = session({ id: 'liveSession01', status: 'active', startedAt: NOW - 12 * 60_000, date: TODAY });
    setData(seed({ workouts: [workout()], sessions: [live] }));
    const memory = renderHost();
    act(() => ui.openSheet(TODAY, 'workout'));
    const s = sheet('Тренування');
    expect(screen.queryByRole('region', { name: 'Почати тренування' })).toBeNull();
    const row = button(s, /^Продовжити тренування «Ноги \+ прес»/);
    expect(flat(row.textContent)).toContain('Ноги + прес · 12 хв');
    fireEvent.click(row);
    expect(memory.history.at(-1)).toBe('/workouts/session/liveSession01');
  });

  it('a done session: «Записано» with its summary, no ✓ / ✕, the types under «Типи і нотатки»', () => {
    const done = session({ id: 'doneSession1', date: TODAY });
    setData(
      seed({
        workouts: [workout()],
        sessions: [done],
        days: { [TODAY]: { food: '', kcal: null, trained: true, types: ['Низ тіла'], notes: '' } },
      }),
    );
    const memory = renderHost();
    act(() => ui.openSheet(TODAY, 'workout'));
    const s = sheet('Тренування');
    const recorded = screen.getByRole('region', { name: 'Записано' });
    const row = within(recorded).getByRole('button');
    expect(flat(row.textContent)).toMatch(/^Ноги \+ прес 48 хв · \d+ ккал/);
    expect(within(s).queryByRole('button', { name: 'Було' })).toBeNull();
    expect(within(s).queryByRole('button', { name: 'Не було' })).toBeNull();
    expect(within(s).queryByText('Або просто відміть')).toBeNull();
    expect(within(s).getByText('Типи і нотатки')).toBeTruthy();
    fireEvent.click(row);
    expect(memory.history.at(-1)).toBe('/workouts/session/doneSession1');
  });

  it('starting another workout while one is live asks first; «Завершити й почати» finishes it, then starts', async () => {
    const live = session({ id: 'liveSession01', status: 'active', startedAt: NOW - 30 * 60_000, date: TODAY, rev: 3 });
    setData(seed({ workouts: [workout()], sessions: [live] }));
    renderHost();
    // The live group hides the start rows, so start from the shared flow the way Home does.
    const { startWorkout } = await import('../startWorkout');
    let started: Promise<string | null> = Promise.resolve(null);
    act(() => {
      started = startWorkout(TODAY, 'workoutLegs01-other');
    });
    const question = await screen.findByRole('alertdialog', {
      name: 'Тренування «Ноги + прес» ще триває. Завершити його й почати нове?',
    });
    await act(async () => {
      fireEvent.click(within(question).getByRole('button', { name: 'Завершити й почати' }));
    });
    await started;
    await waitFor(() => expect(data().sessions.find((x) => x.id === 'liveSession01')?.status).toBe('done'));
    const finished = data().sessions.find((x) => x.id === 'liveSession01');
    expect(finished?.durationSec).toBe(30 * 60);
    expect(data().days[TODAY]?.trained).toBe(true);
  });
});
