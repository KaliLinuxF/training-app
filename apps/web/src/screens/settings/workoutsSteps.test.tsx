/** Settings for workouts and steps (§3.7, §3.17): the steps goal stepper, the schedule under the reminder, the row. */
import { emptyData, type AppData, type Settings } from '@legko/shared';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { workout } from '@/lib/stats/workouts.testing';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { fakeIdb } from '@/store/test-utils';
import { GoalsCard } from './GoalsCard';
import { workoutsRowSummary } from './listModel';
import {
  NO_STEPS_GOAL,
  NOT_IN_PLAN,
  SCHEDULE_SENTENCE,
  stepsGoalRow,
  stepStepsGoal,
  workoutSchedule,
} from './model';
import { ReminderCard } from './ReminderCard';

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
}));
vi.mock('idb-keyval', () => mocks.idb);

const flat = (text: string | null | undefined): string => (text ?? '').replace(/\s+/g, ' ').trim();
const withGoal = (stepsGoal: number | null): Settings => ({ ...emptyData().settings, stepsGoal });

function setData(patch: Partial<AppData> = {}) {
  const data = { ...emptyData(), ...patch };
  useDataStore.setState({ data, sync: { ...initialSyncState(), online: true, loaded: true, lastSyncedAt: 1 } });
}
const settings = () => useDataStore.getState().data.settings;

beforeEach(() => {
  const idb = fakeIdb();
  mocks.idb.getMany.mockImplementation(idb.getMany);
  mocks.idb.setMany.mockImplementation(idb.setMany);
  mocks.idb.delMany.mockImplementation(idb.delMany);
  mocks.idb.keys.mockImplementation(idb.keys);
  setData();
});
afterEach(() => cleanup());

describe('steps goal model', () => {
  it('«Без цілі» when none; «+» from none gives 8 000; ±500; «−» at 1 000 removes it; 50 000 at most', () => {
    expect(stepsGoalRow(withGoal(null))).toMatchObject({
      value: NO_STEPS_GOAL,
      canDecrement: false,
      canIncrement: true,
      incrementLabel: 'Поставити ціль кроків',
    });
    expect(stepStepsGoal(withGoal(null), 1).stepsGoal).toBe(8000);
    expect(stepStepsGoal(withGoal(null), -1).stepsGoal).toBeNull();
    expect(stepStepsGoal(withGoal(8000), 1).stepsGoal).toBe(8500);
    expect(stepStepsGoal(withGoal(8000), -1).stepsGoal).toBe(7500);
    expect(stepStepsGoal(withGoal(1500), -1).stepsGoal).toBe(1000);
    expect(stepStepsGoal(withGoal(1000), -1).stepsGoal).toBeNull();
    expect(stepsGoalRow(withGoal(1000)).decrementLabel).toBe('Прибрати ціль кроків');
    expect(stepStepsGoal(withGoal(50000), 1).stepsGoal).toBe(50000);
    expect(stepsGoalRow(withGoal(50000)).canIncrement).toBe(false);
    expect(flat(stepsGoalRow(withGoal(8000)).value)).toBe('8 000 кроків');
  });
});

describe('GoalsCard: «Кроки за день»', () => {
  it('steps the goal in the store', () => {
    setData();
    render(<GoalsCard settings={settings()} />);
    const group = screen.getByRole('group', { name: 'Кроки за день' });
    expect(within(group).getByText(NO_STEPS_GOAL)).toBeTruthy();
    act(() => fireEvent.click(within(group).getByRole('button', { name: 'Поставити ціль кроків' })));
    expect(settings().stepsGoal).toBe(8000);
  });
});

describe('the schedule under the workout reminder', () => {
  const legs = workout();
  const upper = workout({ id: 'workoutUpper1', name: 'Верх тіла', days: [5] });

  it('model: her workouts with days, each day against the plan', () => {
    const items = workoutSchedule([legs, upper, workout({ id: 'noDays000001', name: 'Без днів', days: [] })], [1, 5]);
    expect(items.map((i) => i.text)).toEqual([`Пн, Ср (${NOT_IN_PLAN}) — Ноги + прес`, 'Пт — Верх тіла']);
    expect(items[0]?.days).toEqual([
      { label: 'Пн', inPlan: true },
      { label: 'Ср', inPlan: false },
    ]);
  });

  it('renders «За розкладом», a struck day outside the plan, the rule and «Мої тренування →»', () => {
    setData({ workouts: [legs, upper] });
    const rem = { ...emptyData().settings.rem, workout: { on: true, days: [1, 5] as Settings['rem']['workout']['days'], time: '18:00' } };
    const memory = memoryLocation({ path: '/settings/reminders', record: true });
    render(
      <Router hook={memory.hook}>
        <ReminderCard kind="workout" rem={rem} />
      </Router>,
    );
    const group = within(screen.getByRole('group', { name: 'За розкладом' }));
    const items = group.getAllByRole('listitem').map((li) => flat(li.textContent));
    expect(items).toEqual([`Пн, Ср (${NOT_IN_PLAN}) — Ноги + прес`, 'Пт — Верх тіла']);
    expect(group.getByText('Ср').tagName).toBe('S');
    expect(group.getByText(SCHEDULE_SENTENCE)).toBeTruthy();
    fireEvent.click(group.getByRole('link', { name: 'Мої тренування →' }));
    expect(memory.history.at(-1)).toBe('/workouts');
  });

  it('nothing without workout days; the weigh-in card never shows it', () => {
    setData({ workouts: [workout({ days: [] })] });
    render(
      <Router hook={memoryLocation({ path: '/' }).hook}>
        <ReminderCard kind="workout" rem={emptyData().settings.rem} />
        <ReminderCard kind="weigh" rem={emptyData().settings.rem} />
      </Router>,
    );
    expect(screen.queryByRole('group', { name: 'За розкладом' })).toBeNull();
  });
});

describe('the «Тренування» row of the list', () => {
  it('counts her workouts once she has any, else the types as before', () => {
    expect(workoutsRowSummary(0, '7 типів')).toBe('7 типів');
    expect(workoutsRowSummary(1, '7 типів')).toBe('1 тренування');
    expect(workoutsRowSummary(2, '7 типів')).toBe('2 тренування');
    expect(workoutsRowSummary(5, '7 типів')).toBe('5 тренувань');
  });
});
