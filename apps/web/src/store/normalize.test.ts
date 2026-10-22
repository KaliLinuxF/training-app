import {
  applyOps,
  DEFAULT_MEAL_TYPES,
  defaultSettings,
  emptyMacroGoals,
  normalizeDay,
  type Meal,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { normalizeAppData, parseCachedData, parseOutbox } from './normalize';

const MEAL: Meal = {
  id: 'breakfast001',
  type: 'Сніданок',
  time: '08:30',
  text: 'Тост з тунцем',
  kcal: 420,
  protein: 27,
  fat: 11,
  carbs: 36,
};

/** Settings as a build before meal types wrote them. */
function oldSettings() {
  const { mealTypes: _m, macroGoals: _g, ...old } = { ...defaultSettings(), goal: 58, onboarded: true };
  return old;
}

describe('an old device cache (before meals and macros)', () => {
  it('gets the default meal types and no macro goals; its days stay legacy days', () => {
    const data = parseCachedData({
      days: { '2026-10-01': { food: 'Борщ', kcal: 500, trained: true, types: ['Кардіо'], notes: '' } },
      weights: [],
      measures: [],
      foods: [{ name: 'Борщ', portion: '300 г', kcal: 180, count: 2, lastUsed: '2026-10-01' }],
      settings: oldSettings(),
    });
    expect(data?.settings).toMatchObject({
      goal: 58,
      mealTypes: [...DEFAULT_MEAL_TYPES],
      macroGoals: emptyMacroGoals(),
    });
    expect(data?.days['2026-10-01']).not.toHaveProperty('meals');
    expect(data?.foods[0]).not.toHaveProperty('protein');
  });

  it('keeps an explicit empty meal-type list', () => {
    expect(
      normalizeAppData({ settings: { ...defaultSettings(), mealTypes: [] } }).settings.mealTypes,
    ).toEqual([]);
  });
});

describe('an old outbox replayed by this build', () => {
  const D = '2026-10-10';
  const mealDay = normalizeDay({ food: '', kcal: null, trained: null, types: [], notes: '', meals: [MEAL] });

  it('parses old day.put / day.delete / settings.put / food.use ops', () => {
    const items = parseOutbox([
      {
        id: 'a',
        op: {
          kind: 'day.put',
          date: D,
          value: { food: 'Борщ', kcal: 500, trained: true, types: [], notes: '' },
        },
      },
      { id: 'b', op: { kind: 'day.delete', date: D } },
      { id: 'c', op: { kind: 'settings.put', value: oldSettings() } },
      { id: 'd', op: { kind: 'food.use', date: D, value: { name: 'Борщ', portion: '', kcal: 180 } } },
    ]);
    expect(items.map((i) => i.id)).toEqual(['a', 'b', 'c', 'd']);
    // No defaults are invented for an old settings.put: absent = keep.
    expect(items[2]?.op).not.toHaveProperty('value.mealTypes');
  });

  it('applies an old day.put with Rule L (meals kept) and an old settings.put keeping the new settings', () => {
    const [put, settings] = parseOutbox([
      {
        id: 'a',
        op: {
          kind: 'day.put',
          date: D,
          value: { food: mealDay.food, kcal: mealDay.kcal, trained: true, types: [], notes: '' },
        },
      },
      { id: 'b', op: { kind: 'settings.put', value: oldSettings() } },
    ]);
    const cached = normalizeAppData({
      days: { [D]: mealDay },
      settings: {
        ...defaultSettings(),
        mealTypes: ['Сніданок', 'Після тренування'],
        macroGoals: { protein: 90, fat: null, carbs: null },
      },
    });
    const next = applyOps(
      cached,
      [put, settings].flatMap((i) => (i ? [i.op] : [])),
    );
    expect(next.days[D]).toEqual({ ...mealDay, trained: true });
    expect(next.settings).toMatchObject({
      goal: 58,
      mealTypes: ['Сніданок', 'Після тренування'],
      macroGoals: { protein: 90, fat: null, carbs: null },
    });
  });

  it('applies an old day.delete on a meal day as «clear the mark», keeping the meals', () => {
    const [del] = parseOutbox([{ id: 'a', op: { kind: 'day.delete', date: D } }]);
    const cached = normalizeAppData({ days: { [D]: { ...mealDay, trained: true, notes: 'n' } } });
    expect(applyOps(cached, del ? [del.op] : []).days[D]).toEqual(mealDay);
  });

  it('drops ops the current schema refuses (the server would reject them too)', () => {
    expect(parseOutbox([{ id: 'a', op: { kind: 'day.meta', date: D, value: {} } }])).toEqual([]);
  });
});

describe('workouts and steps keys (schema v5) survive the whitelist', () => {
  const session = {
    id: 'session00001',
    date: '2026-10-12',
    workoutId: null,
    name: 'Вільне тренування',
    createdAt: 5,
    startedAt: null,
    finishedAt: null,
    durationSec: 1800,
    status: 'done' as const,
    exercises: [],
    notes: '',
    rev: 2,
    deviceId: null,
  };
  const exercise = {
    id: 'ownExercise01',
    name: 'Степ',
    kind: 'cardio' as const,
    primary: ['quads' as const],
    secondary: [],
    equipment: 'other' as const,
    met: 7,
  };

  it('a payload WITH the new keys keeps them: valid elements only, sessions and steps sorted', () => {
    const data = normalizeAppData({
      settings: { ...defaultSettings(), stepsGoal: 8000 },
      exercises: [exercise, { ...exercise, id: 'lib.plank' }, { ...exercise }],
      workouts: [{ id: 'workout00001', name: 'Ноги', days: [1], items: [] }, { id: 'bad' }] as never,
      sessions: [
        { ...session, id: 'session00002', date: '2026-10-13' },
        session,
        { ...session, id: 'session00003', durationSec: -1 },
      ],
      steps: [
        { date: '2026-10-13', steps: 9000 },
        { date: '2026-10-12', steps: 5000 },
        { date: '2026-10-11', steps: 0 },
      ],
      deletedSessions: ['sessionGone01', 'sessionGone01', 42, 'x'] as never,
    });
    expect(data.exercises.map((e) => e.id)).toEqual(['ownExercise01']);
    expect(data.workouts.map((w) => w.id)).toEqual(['workout00001']);
    expect(data.sessions.map((s) => s.id)).toEqual(['session00001', 'session00002']);
    expect(data.steps).toEqual([
      { date: '2026-10-12', steps: 5000 },
      { date: '2026-10-13', steps: 9000 },
    ]);
    expect(data.deletedSessions).toEqual(['sessionGone01']);
    expect(data.settings.stepsGoal).toBe(8000);
  });

  it('a payload WITHOUT them (an old server, an old cache) gets [] and no steps goal', () => {
    const data = parseCachedData({ days: {}, weights: [], measures: [], foods: [], settings: oldSettings() });
    expect(data).toMatchObject({ exercises: [], workouts: [], sessions: [], steps: [], deletedSessions: [] });
    expect(data?.settings.stepsGoal).toBeNull();
    // Ops on the normalised copy work.
    const after = applyOps(data!, [
      { kind: 'steps.put', date: '2026-10-12', steps: 4000 },
      { kind: 'session.put', value: session },
    ]);
    expect(after.steps).toHaveLength(1);
    expect(after.sessions).toHaveLength(1);
  });
});
