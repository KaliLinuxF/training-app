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
