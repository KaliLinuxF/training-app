import { normalizeDay, type DayEntry, type Meal, type MealItem } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  dayNutrition,
  gramsText,
  MACRO_LABELS,
  macroGoalView,
  macroLine,
  macroParts,
  macroSpeech,
  mealCountText,
  mealTitle,
  mealTypeChoices,
  NBSP,
} from './nutrition';

/** Spaces as the test reads them (`_` = NO-BREAK SPACE). */
const show = (s: string | null): string | null => (s === null ? null : s.replaceAll(NBSP, '_'));

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

const meal = (patch: Partial<Meal> = {}): Meal => ({
  id: 'breakfast001',
  type: 'Сніданок',
  time: '08:30',
  text: 'Тост з тунцем',
  kcal: 420,
  protein: 27,
  fat: 11,
  carbs: 36,
  ...patch,
});

const item = (patch: Partial<MealItem> = {}): MealItem => ({
  name: 'Вівсянка з бананом',
  portion: '250 г',
  kcal: 320,
  protein: 9,
  fat: 6,
  carbs: 58,
  ...patch,
});

describe('labels and grams', () => {
  it('names the macronutrients in Ukrainian', () => {
    expect(MACRO_LABELS).toEqual({
      protein: { name: 'Білки', abbr: 'Б', lower: 'білки' },
      fat: { name: 'Жири', abbr: 'Ж', lower: 'жири' },
      carbs: { name: 'Вуглеводи', abbr: 'В', lower: 'вуглеводи' },
    });
  });

  it('shows whole grams (grouped), 0.5 g when precise, «—» when unknown', () => {
    expect(gramsText(68)).toBe('68');
    expect(gramsText(12.5)).toBe('13');
    expect(gramsText(12.5, true)).toBe('12,5');
    expect(gramsText(12, true)).toBe('12');
    expect(show(gramsText(1240))).toBe('1_240');
    expect(gramsText(null)).toBe('—');
    expect(gramsText(undefined)).toBe('—');
    expect(gramsText(Number.NaN)).toBe('—');
  });
});

describe('dayNutrition', () => {
  it('lists the meals with their sums and completeness', () => {
    const d = normalizeDay(
      day({
        meals: [
          meal({
            id: 'a',
            text: '',
            kcal: null,
            items: [item(), item({ name: 'Кава', kcal: 60, protein: 3, fat: 3, carbs: 5 })],
          }),
          meal({
            id: 'b',
            type: 'Перекус',
            time: '09:40',
            text: 'Яблуко',
            kcal: 80,
            protein: null,
            fat: null,
            carbs: null,
          }),
        ],
      }),
    );
    expect(dayNutrition(d)).toEqual({
      meals: d.meals,
      legacy: false,
      count: 2,
      kcal: 460,
      macros: { protein: 12, fat: 9, carbs: 63 },
      hasMacros: true,
      complete: { protein: false, fat: false, carbs: false },
    });
  });

  it('a legacy day is one block without macros', () => {
    const n = dayNutrition(day({ food: 'Борщ', kcal: 500 }));
    expect(n).toMatchObject({ legacy: true, count: 1, kcal: 500, hasMacros: false });
    expect(n.meals[0]).toMatchObject({ id: 'legacy', text: 'Борщ' });
    expect(n.complete.protein).toBe(false);
  });

  it('an empty or missing day has nothing', () => {
    expect(dayNutrition(undefined)).toEqual({
      meals: [],
      legacy: false,
      count: 0,
      kcal: null,
      macros: { protein: null, fat: null, carbs: null },
      hasMacros: false,
      complete: { protein: true, fat: true, carbs: true },
    });
  });
});

describe('macroParts', () => {
  it('always three, Б Ж В, with goals, over and partial flags', () => {
    const parts = macroParts(
      { protein: 95.5, fat: 41, carbs: null },
      { protein: 90, fat: 60, carbs: 200 },
      { protein: false, fat: true, carbs: false },
    );
    expect(parts).toEqual([
      {
        key: 'protein',
        abbr: 'Б',
        name: 'Білки',
        value: '96',
        goal: '90',
        known: true,
        over: true,
        partial: true,
      },
      {
        key: 'fat',
        abbr: 'Ж',
        name: 'Жири',
        value: '41',
        goal: '60',
        known: true,
        over: false,
        partial: false,
      },
      {
        key: 'carbs',
        abbr: 'В',
        name: 'Вуглеводи',
        value: '—',
        goal: '200',
        known: false,
        over: false,
        partial: false,
      },
    ]);
    // Equal after rounding is not over.
    expect(
      macroParts({ protein: 90.4, fat: null, carbs: null }, { protein: 90, fat: null, carbs: null })[0]?.over,
    ).toBe(false);
    expect(macroParts({ protein: 1, fat: 1, carbs: 1 }).every((p) => p.goal === null && !p.partial)).toBe(
      true,
    );
  });
});

describe('macroLine', () => {
  it('«Б 68 · Ж 41 · В 132 г» with no-break spaces: it can only wrap after a «·»', () => {
    const line = macroLine({ protein: 68, fat: 41, carbs: 132 });
    expect(show(line)).toBe('Б_68_· Ж_41_· В_132_г');
    expect(line?.replace(/\s/g, ' ')).toBe('Б 68 · Ж 41 · В 132 г');
    // The only breakable spaces are the ones right after a «·».
    expect(line?.match(/ /g)).toHaveLength(2);
    expect(line).toMatch(/^[^ ]+· [^ ]+· [^ ]+$/);
  });

  it('adds goals only where a goal is set', () => {
    expect(show(macroLine({ protein: 68, fat: 41, carbs: 132 }, { protein: 90, fat: 60, carbs: null }))).toBe(
      'Б_68/90_· Ж_41/60_· В_132_г',
    );
  });

  it('shows an unknown part as «—», the unit after the last known part; null when none is known', () => {
    expect(show(macroLine({ protein: null, fat: 41, carbs: 132 }))).toBe('Б_—_· Ж_41_· В_132_г');
    expect(
      show(macroLine({ protein: 68, fat: 41, carbs: null }, { protein: 90, fat: null, carbs: 200 })),
    ).toBe('Б_68/90_· Ж_41_г_· В_—');
    expect(macroLine({ protein: null, fat: null, carbs: null })).toBeNull();
    expect(
      macroLine({ protein: null, fat: null, carbs: null }, { protein: 90, fat: 60, carbs: 200 }),
    ).toBeNull();
  });

  it('rounds to whole grams', () => {
    expect(show(macroLine({ protein: 12.5, fat: 0.5, carbs: 1000.5 }))).toBe('Б_13_· Ж_1_· В_1_001_г');
  });
});

describe('macroSpeech', () => {
  it('reads the known parts with goals', () => {
    expect(macroSpeech({ protein: 68, fat: 41, carbs: 132 }, { protein: 90, fat: 60, carbs: null })).toBe(
      'білки 68 з 90 г, жири 41 з 60 г, вуглеводи 132 г',
    );
    expect(macroSpeech({ protein: null, fat: 41, carbs: null })).toBe('жири 41 г');
    expect(macroSpeech({ protein: null, fat: null, carbs: null })).toBeNull();
  });

  it('says when a part is over its goal (not by colour only)', () => {
    expect(macroSpeech({ protein: 95, fat: 10, carbs: null }, { protein: 90, fat: 60, carbs: null })).toBe(
      'білки 95 з 90 г (більше цілі), жири 10 з 60 г',
    );
  });
});

describe('macroGoalView', () => {
  it.each([
    [68, 90, 'ok', (68 / 90) * 100, 'Білки: 68 з 90 г'],
    [90, 90, 'reached', 100, 'Білки: 90 з 90 г'],
    [90.4, 90, 'reached', 100, 'Білки: 90 з 90 г'],
    [95.5, 90, 'over', 100, 'Білки: 96 з 90 г, більше цілі'],
    [68, null, 'none', 0, 'Білки: 68 г'],
    [null, 90, 'empty', 0, 'Білки: ще не пораховано, ціль 90 г'],
    [null, null, 'none', 0, 'Білки: ще не пораховано'],
    [0, 90, 'ok', 0, 'Білки: 0 з 90 г'],
  ] as const)('%s g with goal %s → %s', (grams, goal, state, pct, label) => {
    const v = macroGoalView('protein', grams, goal);
    expect(v.state).toBe(state);
    expect(v.pct).toBeCloseTo(pct, 5);
    expect(v.label).toBe(label);
    expect(v.goal).toBe(goal === null ? null : String(goal));
  });

  it('uses the right name per key', () => {
    expect(macroGoalView('carbs', 132, null).label).toBe('Вуглеводи: 132 г');
    expect(macroGoalView('fat', 41, 60)).toMatchObject({ value: '41', goal: '60', label: 'Жири: 41 з 60 г' });
  });
});

describe('meal titles, counts and type choices', () => {
  it('titles a meal by its type, else as a legacy block or a plain meal', () => {
    expect(mealTitle(meal())).toBe('Сніданок');
    expect(mealTitle(meal({ id: 'legacy', type: '' }))).toBe('Їжа за день');
    expect(mealTitle(meal({ id: 'old-1x2y3z', type: '' }))).toBe('Їжа за день');
    expect(mealTitle(meal({ id: 'Ab3_-x12CdEf', type: '' }))).toBe('Прийом їжі');
  });

  it.each([
    [1, '1_прийом'],
    [2, '2_прийоми'],
    [3, '3_прийоми'],
    [4, '4_прийоми'],
    [5, '5_прийомів'],
    [11, '11_прийомів'],
    [12, '12_прийомів'],
    [14, '14_прийомів'],
    [20, '20_прийомів'],
    [21, '21_прийом'],
    [22, '22_прийоми'],
    [0, '0_прийомів'],
  ])('%i → %s', (n, text) => {
    expect(show(mealCountText(n))).toBe(text);
  });

  it('offers her types plus the meal’s own label when it is not in the list', () => {
    const types = ['Сніданок', 'Обід'];
    expect(mealTypeChoices(types, 'Обід')).toEqual(types);
    expect(mealTypeChoices(types, ' обід ')).toEqual(types);
    expect(mealTypeChoices(types, 'Ланч')).toEqual(['Сніданок', 'Обід', 'Ланч']);
    expect(mealTypeChoices(types, '')).toEqual(types);
    expect(mealTypeChoices([], 'Перекус')).toEqual(['Перекус']);
    expect(mealTypeChoices(types, 'Ланч')).not.toBe(types);
  });
});
