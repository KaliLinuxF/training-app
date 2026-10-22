/** Home «Тренування» row with workouts (§3.13): «Почати», «Продовжити», the static «Було» mark, steps in the sub. */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AppData } from '@legko/shared';
import { session, workout } from '@/lib/stats/workouts.testing';
import { getAppData, resetLocal, useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { fakeIdb, sampleData } from '@/store/test-utils';
import { useUiStore } from '@/store/ui';
import { HomeScreen } from './HomeScreen';

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
}));
vi.mock('idb-keyval', () => mocks.idb);

/** Monday 12 October 2026, 9:30: «Ноги + прес» (Пн, Ср) is scheduled. */
const TODAY = '2026-10-12';
const NOW = new Date(2026, 9, 12, 9, 30).getTime();

function setData(patch: Partial<AppData> = {}): void {
  useDataStore.setState({ data: sampleData(patch), sync: { ...initialSyncState(), loaded: true, online: true } });
}
const todayRegion = () => screen.getByRole('region', { name: 'Сьогодні' });
const workoutItem = () => {
  const li = within(todayRegion()).getByRole('button', { name: /^Тренування/ }).closest('li');
  if (!li) throw new Error('no Тренування row');
  return li;
};
const flat = (text: string | null | undefined) => (text ?? '').replace(/\s/g, ' ');

beforeEach(async () => {
  const idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  mocks.idb.keys.mockReset().mockImplementation(idb.keys);
  await resetLocal();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
  window.history.replaceState(null, '', '/');
});
afterEach(async () => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  await resetLocal();
});

describe('Home «Тренування» with workouts', () => {
  it('a scheduled day: «Сьогодні: Ноги + прес» and «Почати» starts it and opens the session', async () => {
    setData({ workouts: [workout()] });
    render(<HomeScreen />);
    const li = workoutItem();
    expect(flat(li.textContent)).toContain('Сьогодні: Ноги + прес');
    expect(within(li).queryByRole('button', { name: 'Було' })).toBeNull();
    fireEvent.click(within(li).getByRole('button', { name: 'Почати тренування «Ноги + прес»' }));
    await waitFor(() => expect(getAppData().sessions).toHaveLength(1));
    const started = getAppData().sessions[0];
    expect(started).toMatchObject({ status: 'active', workoutId: 'workoutLegs01', date: TODAY });
    expect(window.location.pathname).toBe(`/workouts/session/${started?.id ?? ''}`);
  });

  it('two scheduled: «Почати» opens the «Тренування» sheet to pick one', () => {
    setData({ workouts: [workout(), workout({ id: 'workoutUpper1', name: 'Верх тіла', days: [1] })] });
    render(<HomeScreen />);
    fireEvent.click(within(workoutItem()).getByRole('button', { name: 'Почати тренування: обрати' }));
    expect(useUiStore.getState().sheet).toMatchObject({ date: TODAY, mode: 'workout' });
  });

  it('a live session: «Триває · 12 хв» and «Продовжити» opens it', () => {
    const live = session({ id: 'liveSession01', status: 'active', startedAt: NOW - 12 * 60_000, date: TODAY });
    setData({ workouts: [workout()], sessions: [live] });
    render(<HomeScreen />);
    const li = workoutItem();
    expect(flat(li.textContent)).toContain('Триває · 12 хв');
    fireEvent.click(within(li).getByRole('button', { name: 'Продовжити тренування «Ноги + прес»' }));
    expect(window.location.pathname).toBe('/workouts/session/liveSession01');
  });

  it('a done session: the static «Було» mark (no ✓ / ✕), the steps and the burned kcal in the sub', () => {
    setData({
      sessions: [session({ date: TODAY })],
      steps: [{ date: TODAY, steps: 8400 }],
      days: { [TODAY]: { food: '', kcal: null, trained: true, types: ['Низ тіла'], notes: '' } },
    });
    render(<HomeScreen />);
    const li = workoutItem();
    expect(within(li).queryByRole('button', { name: 'Було' })).toBeNull();
    expect(within(li).queryByRole('button', { name: 'Не було' })).toBeNull();
    expect(within(li).getByText('Тренування записано')).toBeTruthy();
    const rowButton = within(todayRegion()).getByRole('button', { name: /^Тренування/ });
    expect(flat(rowButton.getAttribute('aria-label'))).toMatch(/^Тренування: Ноги \+ прес\. 8 400 кроків\. Спалено \d+ ккал$/);
    expect(flat(rowButton.textContent)).toMatch(/Ноги \+ прес · 8 400 кроків · спалено \d+ ккал/);
    // The row itself still opens the sheet.
    fireEvent.click(rowButton);
    expect(useUiStore.getState().sheet).toMatchObject({ mode: 'workout' });
  });

  it('a day without workouts keeps the inline ✓ / ✕ and only adds the steps', () => {
    setData({ steps: [{ date: TODAY, steps: 5000 }], workouts: [] });
    render(<HomeScreen />);
    const li = workoutItem();
    expect(within(li).getByRole('button', { name: 'Було' })).toBeTruthy();
    expect(flat(li.textContent)).toContain('5 000 кроків');
  });
});
