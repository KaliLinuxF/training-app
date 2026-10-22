import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData, Op, WorkoutSession } from '@legko/shared';
import { committed, lastBatch, seedStore } from '@/features/exercises/storeMock';
import { getAppData } from '@/store/data';
import { useUiStore } from '@/store/ui';
import { installMatchMedia, stubScrollTo } from '@/ui/internal/testing';
import { workoutDraftKey } from './drafts';
import { DEVICE, LEGS, NOW, TODAY, doneLegs, session, trainingData } from './testing';
import { WorkoutsRoutes } from './WorkoutsRoutes';

vi.mock('@/store/sync', async (original) =>
  (await import('@/features/exercises/storeMock')).syncModule(original),
);
vi.mock('@/lib/useToday', () => ({ useToday: () => '2026-10-14' }));

beforeEach(() => {
  installMatchMedia();
  stubScrollTo();
  localStorage.clear();
  localStorage.setItem('legko.deviceId', DEVICE);
  window.history.replaceState(null, '');
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
  vi.spyOn(Date, 'now').mockReturnValue(NOW + 60_000);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function renderAt(path: string, data: AppData = trainingData()) {
  await seedStore(data);
  const memory = memoryLocation({ path, record: true });
  const view = render(
    <Router hook={memory.hook}>
      <WorkoutsRoutes />
    </Router>,
  );
  return { memory, view };
}

const h1 = () => screen.getByRole('heading', { level: 1 }).textContent;
const button = (name: string | RegExp) => screen.getByRole('button', { name });
const plain = (t: string | null | undefined) => (t ?? '').replace(/\s+/g, ' ').trim();
/** An exact accessible name in which any space may be a no-break space. */
const nm = (t: string) => new RegExp(`^${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s')}$`);
const kinds = (ops: Op[]) => ops.map((o) => o.kind);
const putValue = (ops: Op[]): WorkoutSession => {
  const op = ops.find((o) => o.kind === 'session.put');
  if (!op || op.kind !== 'session.put') throw new Error('no session.put');
  return op.value;
};
const answer = async (ok: boolean) => {
  const req = useUiStore.getState().confirm;
  if (!req) throw new Error('no confirm open');
  await act(async () => req.resolve(ok));
};
const flushed = () => act(async () => undefined);

describe('routing (flat absolute routes, no nest)', () => {
  it('renders each page at its absolute URL; anything else under /workouts goes to the list', async () => {
    const live = session();
    const data = trainingData();
    data.sessions.push(live);
    const cases: [string, string][] = [
      ['/workouts', 'Мої тренування'],
      ['/workouts/new', 'Нове тренування'],
      [`/workouts/edit/${LEGS.id}`, 'Ноги + прес'],
      ['/workouts/library', 'Вправи'],
      ['/workouts/library/lib.back-squat', 'Присідання зі штангою'],
      [`/workouts/session/${live.id}`, 'Ноги + прес'],
      ['/workouts/history', 'Історія тренувань'],
      ['/workouts/log?date=2026-10-12', 'Вільне тренування'],
    ];
    for (const [path, title] of cases) {
      await renderAt(path, structuredClone(data));
      expect(h1(), path).toBe(title);
      cleanup();
    }
    const { memory } = await renderAt('/workouts/nope');
    expect(memory.history.at(-1)).toBe('/workouts');
    expect(h1()).toBe('Мої тренування');
  });

  it('a ListRow href={exercisePath(...)} inside WorkoutsRoutes navigates to exactly /workouts/library/lib.back-squat', async () => {
    const { memory } = await renderAt('/workouts/session/sessionDone0001');
    const row = within(screen.getByRole('region', { name: 'Вправи' })).getByRole('link', {
      name: /^Присідання зі штангою/,
    });
    expect(row.getAttribute('href')).toBe('/workouts/library/lib.back-squat');
    fireEvent.click(row);
    expect(memory.history.at(-1)).toBe('/workouts/library/lib.back-squat');
    expect(h1()).toBe('Присідання зі штангою');
  });

  it('a log date in the future or invalid goes back to the list', async () => {
    const { memory } = await renderAt('/workouts/log?date=2026-10-20');
    expect(memory.history.at(-1)).toBe('/workouts');
    cleanup();
    const second = await renderAt('/workouts/log?date=bad');
    expect(second.memory.history.at(-1)).toBe('/workouts');
  });
});

describe('«Мої тренування»', () => {
  it('lists her workouts with days and today’s pill; «Почати» starts a live session and opens it', async () => {
    const { memory } = await renderAt('/workouts');
    const list = screen.getByRole('region', { name: 'Мої тренування' });
    const legs = within(list).getByRole('link', { name: /^Ноги \+ прес/ });
    expect(plain(legs.textContent)).toContain('Пн, Ср · 2 вправи');
    expect(within(legs).getByText('Сьогодні')).toBeTruthy();
    expect(legs.getAttribute('href')).toBe(`/workouts/edit/${LEGS.id}`);
    expect(screen.getByRole('link', { name: /^Історія тренувань/ }).textContent).toContain('1 запис');

    fireEvent.click(button('Почати тренування «Ноги + прес»'));
    await flushed();
    const put = putValue(lastBatch());
    expect(put).toMatchObject({ status: 'active', workoutId: LEGS.id, rev: 0, deviceId: DEVICE });
    expect(memory.history.at(-1)).toBe(`/workouts/session/${put.id}`);
  });

  it('with a live session: the banner, «Продовжити» on its row, and «Почати» on another asks to finish it first', async () => {
    const data = trainingData();
    data.sessions.push(session({ startedAt: NOW - 11 * 60_000 }));
    const { memory } = await renderAt('/workouts', data);
    expect(plain(screen.getByText(/^Тренування триває/).textContent)).toBe(
      'Тренування триває · Ноги + прес · 12 хв',
    );
    fireEvent.click(button('Продовжити тренування «Ноги + прес»'));
    expect(memory.history.at(-1)).toBe('/workouts/session/session00000001');
    act(() => memory.navigate('/workouts'));

    fireEvent.click(button('Почати тренування «Верх тіла»'));
    await flushed();
    expect(useUiStore.getState().confirm?.title).toBe(
      'Тренування «Ноги + прес» ще триває. Завершити його й почати нове?',
    );
    const before = committed.batches.length;
    await answer(true);
    const [finish, start] = committed.batches.slice(before);
    expect(kinds(finish!)).toEqual(['session.put', 'day.meta']);
    expect(putValue(finish!)).toMatchObject({ id: 'session00000001', status: 'done' });
    expect(putValue(start!)).toMatchObject({ status: 'active', workoutId: 'workoutUpper001' });
  });

  it('shows unfinished old sessions and the empty state', async () => {
    const data = trainingData();
    data.sessions.push(
      session({ id: 'sessionStale001', date: '2026-10-12', startedAt: NOW - 2 * 86_400_000 }),
    );
    await renderAt('/workouts', data);
    const stale = screen.getByRole('region', { name: 'Незавершені' });
    expect(
      within(stale)
        .getByRole('link', { name: /^12 жовтня · Ноги \+ прес/ })
        .getAttribute('href'),
    ).toBe('/workouts/session/sessionStale001');
    cleanup();
    const empty = trainingData();
    empty.workouts = [];
    await renderAt('/workouts', empty);
    expect(screen.getByText(/^Склади тренування з вправ/)).toBeTruthy();
    expect(button('+ Нове тренування')).toBeTruthy();
  });
});

describe('builder', () => {
  it('validates the name and the exercises on save', async () => {
    await renderAt('/workouts/new');
    fireEvent.click(button('Зберегти'));
    expect(screen.getByText('Дай тренуванню назву')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe('Додай хоча б одну вправу');
    expect(committed.batches).toHaveLength(0);
  });

  it('reorders with ↑ / ↓ (focus stays, the position is announced), duplicates, deletes, then saves with the new plan day', async () => {
    await renderAt(`/workouts/edit/${LEGS.id}`);
    const names = () =>
      Array.from(document.querySelectorAll('[data-item] h3')).map((el) =>
        plain(el.textContent).replace(/^\d+\. /, ''),
      );
    expect(names()).toEqual(['Присідання зі штангою', 'Скручування']);

    const down = button('Вниз: Присідання зі штангою');
    down.focus();
    fireEvent.click(down);
    await flushed();
    expect(names()).toEqual(['Скручування', 'Присідання зі штангою']);
    expect(screen.getByText('Присідання зі штангою — 2 з 2')).toBeTruthy();
    // At the end «Вниз» is disabled: focus moves to «Вгору» of the same card.
    expect(document.activeElement).toBe(button('Вгору: Присідання зі штангою'));

    fireEvent.click(button('Дії: Скручування'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Дублювати' }));
    expect(names()).toEqual(['Скручування', 'Скручування', 'Присідання зі штангою']);
    fireEvent.click(screen.getAllByRole('button', { name: 'Дії: Скручування' })[1]!);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Видалити' }));
    expect(names()).toEqual(['Скручування', 'Присідання зі штангою']);
    expect(useUiStore.getState().toast?.text).toBe('Вправу прибрано');

    fireEvent.click(screen.getByRole('button', { name: 'Четвер' }));
    fireEvent.click(button('Зберегти'));
    const ops = lastBatch();
    expect(kinds(ops)).toEqual(['workout.put', 'settings.put']);
    const put = ops[0]!;
    if (put.kind !== 'workout.put') throw new Error('workout.put');
    expect(put.value.items.map((i) => i.exerciseId)).toEqual(['lib.crunch', 'lib.back-squat']);
    expect(put.value.days).toEqual([1, 3, 4]);
    expect(getAppData().settings.rem.workout.days).toEqual([1, 3, 4]);
    expect(useUiStore.getState().toast?.text).toBe('Збережено · Чт додано до плану');
    expect(localStorage.getItem(workoutDraftKey(LEGS.id))).toBeNull();
  });

  it('the expanded card: one stepper per line, the per-set fold, rest in m:ss by 15 s', async () => {
    await renderAt(`/workouts/edit/${LEGS.id}`);
    fireEvent.click(button('Змінити: Присідання зі штангою'));
    fireEvent.click(button('Підходи: більше'));
    fireEvent.click(button('Вага: більше'));
    fireEvent.click(button('Відпочинок: менше'));
    expect(plain(document.querySelector('[data-item="item0001"] p')?.textContent)).toBe(
      '12 · 12 × 42,5 кг · відпочинок 1:15',
    );
    const fold = button(/^Різні значення для підходів/);
    expect(fold.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(fold);
    fireEvent.click(button('Повторення, підхід 2: менше'));
    expect(plain(document.querySelector('[data-item="item0001"] p')?.textContent)).toBe(
      '12 · 11 × 42,5 кг · відпочинок 1:15',
    );
    fireEvent.click(button('Видалити підхід 2'));
    expect(plain(document.querySelector('[data-item="item0001"] p')?.textContent)).toBe(
      '12 × 42,5 кг · відпочинок 1:15',
    );
  });

  it('autosaves a draft and restores it on the next visit («Скинути» drops it); only its own «‹» asks', async () => {
    const first = await renderAt(`/workouts/edit/${LEGS.id}`);
    fireEvent.change(screen.getByRole('textbox', { name: 'Назва' }), { target: { value: 'Ноги і прес' } });
    expect(localStorage.getItem(workoutDraftKey(LEGS.id))).toContain('Ноги і прес');
    first.view.unmount();

    await renderAt(`/workouts/edit/${LEGS.id}`);
    expect(screen.getByText('Є незбережені зміни · Відновлено')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Назва' }) as HTMLInputElement).value).toBe('Ноги і прес');

    fireEvent.click(screen.getByRole('link', { name: 'Назад: Мої тренування' }));
    await flushed();
    expect(useUiStore.getState().confirm?.title).toBe('Вийти без збереження?');
    await answer(false);

    fireEvent.click(button('Скинути'));
    expect((screen.getByRole('textbox', { name: 'Назва' }) as HTMLInputElement).value).toBe('Ноги + прес');
    expect(localStorage.getItem(workoutDraftKey(LEGS.id))).toBeNull();
    expect(screen.queryByText('Є незбережені зміни · Відновлено')).toBeNull();
  });

  it('deletes after a destructive confirm (sessions stay)', async () => {
    await renderAt(`/workouts/edit/${LEGS.id}`);
    fireEvent.click(button('Видалити тренування'));
    await flushed();
    expect(useUiStore.getState().confirm).toMatchObject({
      title: 'Видалити тренування «Ноги + прес»?',
      body: 'Записані тренування залишаться.',
      destructive: true,
    });
    await answer(true);
    expect(lastBatch()).toEqual([{ kind: 'workout.delete', id: LEGS.id }]);
    expect(getAppData().sessions).toHaveLength(1);
  });
});

describe('live session', () => {
  const liveData = (patch: Partial<WorkoutSession> = {}) => {
    const data = trainingData();
    data.sessions.push(session(patch));
    return data;
  };
  const path = '/workouts/session/session00000001';
  const stored = () => getAppData().sessions.find((x) => x.id === 'session00000001')!;

  it('the footer confirms the current set (= its ✓), starts the rest, every change is a saveSession with rev + 1', async () => {
    await renderAt(path, liveData());
    expect(screen.getByRole('timer', { name: /^Тривалість/ }).textContent).toBe('1:00');
    expect(plain(screen.getByText(/вправ ·/).textContent)).toBe('0 з 2 вправ · 0 з 5 підходів');
    const current = document.querySelector('[aria-current="step"]');
    expect(current?.getAttribute('data-entry')).toBe('back-squat-key');

    fireEvent.click(button(nm('✓ Підхід 1 · 12 × 40 кг')));
    expect(putValue(lastBatch()).exercises[0]!.sets[0]!.done).toBe(true);
    expect(stored().rev).toBe(1);
    expect(screen.getByText(/^Відпочинок 1:30$/)).toBeTruthy();
    expect(localStorage.getItem('legko.rest.session00000001')).toBe(String(NOW + 60_000 + 90_000));

    const second = screen.getByRole('button', { name: 'Підхід 2 виконано' });
    expect(second.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(second);
    expect(stored().exercises[0]!.sets[1]!.done).toBe(true);
    expect(stored().rev).toBe(2);
    // Undo with the ✓ again.
    fireEvent.click(screen.getByRole('button', { name: 'Підхід 2 виконано' }));
    expect(stored().exercises[0]!.sets[1]!.done).toBe(false);

    fireEvent.click(button('Пропустити'));
    expect(screen.queryByText(/^Відпочинок/)).toBeNull();
    expect(localStorage.getItem('legko.rest.session00000001')).toBeNull();
  });

  it('the hint is one-shot: «Спробувати +2,5 кг» adds once (a double tap too), «Скасувати» takes it back', async () => {
    await renderAt(path, liveData());
    expect(plain(screen.getByText(/^Минулого разу/).textContent)).toBe('Минулого разу: 3 × 12 · 40 кг');
    const hint = button('Спробувати +2,5 кг');
    fireEvent.click(hint);
    fireEvent.click(hint);
    expect(stored().exercises[0]!.sets.map((x) => x.kg)).toEqual([42.5, 42.5, 42.5]);
    expect(plain(screen.getByText(/додано/).textContent)).toContain('+2,5 кг додано');
    expect(screen.queryByRole('button', { name: 'Спробувати +2,5 кг' })).toBeNull();
    fireEvent.click(button('Скасувати'));
    expect(stored().exercises[0]!.sets.map((x) => x.kg)).toEqual([40, 40, 40]);
  });

  it('steppers of the current set, «+ Підхід», skip and remove from the «⋯» menu', async () => {
    await renderAt(path, liveData());
    fireEvent.click(button('Вага, підхід 1: більше'));
    expect(stored().exercises[0]!.sets[0]!.kg).toBe(42.5);
    fireEvent.click(button('Повторення, підхід 1: менше'));
    expect(stored().exercises[0]!.sets[0]!.reps).toBe(11);
    fireEvent.click(button('+ Підхід'));
    expect(stored().exercises[0]!.sets).toHaveLength(4);
    fireEvent.click(button('Дії: Присідання зі штангою'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Пропустити вправу' }));
    expect(stored().exercises[0]!.skipped).toBe(true);
    expect(document.querySelector('[aria-current="step"]')?.getAttribute('data-entry')).toBe('crunch-key');
    fireEvent.click(button('Повернути'));
    expect(stored().exercises[0]!.skipped).toBe(false);
    fireEvent.click(button('Дії: Скручування'));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Прибрати з тренування' }));
    expect(stored().exercises.map((e) => e.exerciseId)).toEqual(['lib.back-squat']);
  });

  it('finishing with undone sets asks, then commits done + the trained day, and shows the summary', async () => {
    const data = liveData();
    data.sessions[1]!.exercises[0]!.sets = data.sessions[1]!.exercises[0]!.sets.map((x) => ({
      ...x,
      kg: 42.5,
      done: true,
    }));
    await renderAt(path, data);
    fireEvent.click(button('Завершити'));
    await flushed();
    expect(useUiStore.getState().confirm).toMatchObject({
      title: 'Завершити тренування?',
      body: 'Ще 2 підходи не відмічено — вони не зарахуються.',
    });
    await answer(true);
    const ops = lastBatch();
    expect(kinds(ops)).toEqual(['session.put', 'day.meta']);
    expect(putValue(ops)).toMatchObject({ status: 'done', durationSec: 60, deviceId: null });
    expect(ops[1]).toEqual({ kind: 'day.meta', date: TODAY, value: { trained: true, types: ['Низ тіла'] } });
    expect(screen.getByRole('status').textContent).toBe('✓ Тренування збережено');
    expect(plain(screen.getByRole('region', { name: 'Нові рекорди' }).textContent)).toContain(
      '42,5 кг (було 40)',
    );
  });

  it('nothing done: «Завершити» offers to delete it instead', async () => {
    await renderAt(path, liveData());
    fireEvent.click(screen.getAllByRole('button', { name: 'Завершити тренування' })[0]!);
    await flushed();
    expect(useUiStore.getState().confirm?.title).toBe('Нічого не відмічено. Видалити це тренування?');
    await answer(true);
    expect(lastBatch()).toEqual([{ kind: 'session.delete', id: 'session00000001' }]);
  });

  it('another device’s session is read-only until «Продовжити тут»', async () => {
    await renderAt(path, liveData({ deviceId: 'otherDevice0001' }));
    expect(screen.getByText('Тренування триває на іншому пристрої')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /виконано$/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /^✓ Підхід/ })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Завершити' })).toBeNull();
    fireEvent.click(button('Продовжити тут'));
    expect(putValue(lastBatch())).toMatchObject({ deviceId: DEVICE, rev: 1 });
    expect(screen.getByRole('button', { name: nm('✓ Підхід 1 · 12 × 40 кг') })).toBeTruthy();
  });

  it('keeps the screen on while live (wake lock), releases it on leaving', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const { view } = await renderAt(path, liveData());
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    view.unmount();
    await vi.waitFor(() => expect(release).toHaveBeenCalled());
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('stays live past midnight (time-based), and a session older than 6 h is stale: no timer, «Завершити» / «Видалити»', async () => {
    await renderAt(path, liveData({ date: '2026-10-13', startedAt: NOW - 30 * 60_000 }));
    expect(screen.getByRole('timer', { name: /^Тривалість/ })).toBeTruthy();
    cleanup();
    await renderAt(path, liveData({ startedAt: NOW - 7 * 3_600_000 }));
    expect(screen.queryByRole('timer')).toBeNull();
    expect(screen.getByText('Це тренування не завершено')).toBeTruthy();
    fireEvent.click(button('Видалити'));
    await flushed();
    expect(useUiStore.getState().confirm?.title).toBe('Видалити тренування за 14 жовтня?');
  });
});

describe('summary, edit and the past-day log', () => {
  it('summary: duration, volume, sets, kcal; «Змінити» edits it and «Зберегти» saves the done session + the day', async () => {
    await renderAt('/workouts/session/sessionDone0001');
    const text = plain(document.querySelector('dl')?.textContent);
    expect(text).toContain('48 хв');
    expect(text).toContain('1 440кг');
    expect(text).toContain('Підходів5');
    expect(text).toMatch(/Спалено≈ \d+ккал/);
    expect(screen.getByText('Оцінка: MET × вага × час')).toBeTruthy();

    fireEvent.click(button('Змінити'));
    expect(h1()).toBe('Ноги + прес');
    const duration = screen.getByRole('textbox', { name: 'Тривалість, хв' }) as HTMLInputElement;
    expect(duration.value).toBe('48');
    fireEvent.click(button('Тривалість, хв: більше'));
    fireEvent.click(button('Зберегти'));
    const ops = lastBatch();
    expect(kinds(ops)).toEqual(['session.put', 'day.meta']);
    expect(putValue(ops)).toMatchObject({
      id: 'sessionDone0001',
      durationSec: 53 * 60,
      rev: 3,
      status: 'done',
    });
    expect(useUiStore.getState().toast?.text).toBe('Збережено');
  });

  it('edit → «Видалити тренування» says the ✓ stays, then deletes', async () => {
    await renderAt('/workouts/session/sessionDone0001');
    fireEvent.click(button('Змінити'));
    fireEvent.click(button('Видалити тренування'));
    await flushed();
    expect(useUiStore.getState().confirm).toMatchObject({
      title: 'Видалити тренування за 12 жовтня?',
      body: 'Відмітка «Було» за цей день залишиться.',
    });
    await answer(true);
    expect(lastBatch()).toEqual([{ kind: 'session.delete', id: 'sessionDone0001' }]);
  });

  it('past day: a draft with every set done, nothing stored until «Зберегти», then the summary replaces it', async () => {
    const { memory } = await renderAt(`/workouts/log?date=2026-10-07&workout=${LEGS.id}`);
    expect(h1()).toBe('Ноги + прес');
    expect(committed.batches).toHaveLength(0);
    expect(
      screen
        .getAllByRole('button', { name: /виконано$/ })
        .every((b) => b.getAttribute('aria-pressed') === 'true'),
    ).toBe(true);
    fireEvent.click(button('Зберегти'));
    const put = putValue(lastBatch());
    expect(put).toMatchObject({ date: '2026-10-07', status: 'done', startedAt: null, workoutId: LEGS.id });
    expect(memory.history.at(-1)).toBe(`/workouts/session/${put.id}`);
    // The summary (the «✓ Тренування збережено» flag travels in history.state, which the memory router has not).
    expect(button('Готово')).toBeTruthy();
    expect(button('Змінити')).toBeTruthy();
  });

  it('past day draft is autosaved and restored with the banner', async () => {
    const first = await renderAt('/workouts/log?date=2026-10-07');
    fireEvent.click(button('Тривалість, хв: більше'));
    expect(localStorage.getItem('legko.draft.log.2026-10-07.free')).toBeTruthy();
    first.view.unmount();
    await renderAt('/workouts/log?date=2026-10-07');
    expect(screen.getByText('Є незбережені зміни · Відновлено')).toBeTruthy();
    expect((screen.getByRole('textbox', { name: 'Тривалість, хв' }) as HTMLInputElement).value).toBe('5');
  });

  it('a session with nothing done cannot be saved', async () => {
    await renderAt('/workouts/log?date=2026-10-07');
    fireEvent.click(button('Зберегти'));
    expect(screen.getByRole('alert').textContent).toBe('Відміть хоча б один підхід');
    expect(committed.batches).toHaveLength(0);
  });
});

describe('history', () => {
  it('done sessions by month, each a link to its summary', async () => {
    await renderAt('/workouts/history', { ...trainingData(), sessions: [doneLegs()] });
    const october = screen.getByRole('region', { name: 'Жовтень 2026' });
    const row = within(october).getByRole('link');
    expect(row.getAttribute('href')).toBe('/workouts/session/sessionDone0001');
    expect(row.getAttribute('aria-label')).toMatch(
      /^12 жовтня · Ноги \+ прес\. 48 хв · 5 підходів · близько \d+ ккал$/,
    );
  });
});
