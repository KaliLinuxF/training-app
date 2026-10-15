import { describe, expect, it } from 'vitest';
import {
  applyOps,
  dayMacroComplete,
  dayMacros,
  deleteMeal,
  deriveDayFood,
  emptyData,
  hasLegacyFood,
  isEmptyDay,
  isEmptyMeal,
  LEGACY_MEAL_ID,
  legacyMeal,
  LIMITS,
  mealContent,
  mealMacroComplete,
  mealsOf,
  mergeLegacyDayPut,
  normalizeDay,
  normalizeMeal,
  normalizeMealItem,
  putMeal,
  reduceDay,
  roundMacro,
  setDayMeta,
  suggestMealType,
  sumMacros,
  type DayEntry,
  type Meal,
  type MealItem,
} from './index';

const P = (n: number): string => `photo${String(n).padStart(11, '0')}`; // 16 chars, a valid photo id

const meal = (patch: Partial<Meal> = {}): Meal => ({
  id: 'm1',
  type: 'Сніданок',
  time: '08:30',
  text: 'Тост з тунцем',
  kcal: 420,
  protein: null,
  fat: null,
  carbs: null,
  ...patch,
});

const item = (patch: Partial<MealItem> = {}): MealItem => ({
  name: 'Тост з тунцем',
  portion: '2 шт',
  kcal: 310,
  protein: 24,
  fat: 8,
  carbs: 31,
  ...patch,
});

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

describe('roundMacro / sumMacros', () => {
  it('rounds to 0.5 g, clamps and maps non-finite values to null', () => {
    expect(roundMacro(12.26)).toBe(12.5);
    expect(roundMacro(12.24)).toBe(12);
    expect(roundMacro(-3)).toBe(0);
    expect(Object.is(roundMacro(-0.1), 0)).toBe(true);
    expect(roundMacro(5000)).toBe(LIMITS.macro.max);
    expect(roundMacro(5000, 3000)).toBe(3000);
    expect(roundMacro(Number.NaN)).toBeNull();
    expect(roundMacro(Number.POSITIVE_INFINITY)).toBeNull();
    expect(roundMacro(null)).toBeNull();
    expect(roundMacro(undefined)).toBeNull();
  });

  it('sums the known values per key; null when none is known', () => {
    expect(
      sumMacros([
        { protein: 1.5, fat: null, carbs: 2 },
        { protein: 2, fat: null, carbs: null },
      ]),
    ).toEqual({ protein: 3.5, fat: null, carbs: 2 });
    expect(sumMacros([])).toEqual({ protein: null, fat: null, carbs: null });
    expect(sumMacros([{ protein: 2000, fat: 2000, carbs: 0 }], 3000).protein).toBe(2000);
    expect(
      sumMacros(
        [
          { protein: 2000, fat: 0, carbs: 0 },
          { protein: 2000, fat: 0, carbs: 0 },
        ],
        3000,
      ).protein,
    ).toBe(3000);
  });
});

describe('normalizeMealItem / normalizeMeal', () => {
  it('trims a position, clamps kcal, rounds macros, drops a nameless one', () => {
    expect(
      normalizeMealItem(item({ name: '  Кава ', portion: ' 1 чашка ', kcal: 60.4, protein: 2.7 })),
    ).toEqual(item({ name: 'Кава', portion: '1 чашка', kcal: 60, protein: 2.5 }));
    expect(normalizeMealItem(item({ kcal: 99999 }))?.kcal).toBe(LIMITS.kcal.max);
    expect(normalizeMealItem(item({ name: '   ' }))).toBeNull();
  });

  it('trims the type (single spaces, ≤ 30) and the text, checks the time, de-duplicates photos', () => {
    const m = normalizeMeal(
      meal({ type: '  Після   тренування ', text: '  тост \n', time: '25:00', photos: [P(1), P(1), P(2)] }),
    );
    expect(m).toEqual(meal({ type: 'Після тренування', text: 'тост', time: null, photos: [P(1), P(2)] }));
    expect(normalizeMeal(meal({ type: 'x'.repeat(40) }))?.type).toHaveLength(LIMITS.mealTypeName);
    expect(normalizeMeal(meal({ photos: [] }))).not.toHaveProperty('photos');
    expect(normalizeMeal(meal({ items: [] }))).not.toHaveProperty('items');
  });

  it('takes kcal and macros from the positions when there are any', () => {
    const m = normalizeMeal(
      meal({
        kcal: 5,
        protein: 99,
        items: [item(), item({ name: 'Кава з молоком', kcal: 60, protein: 3, fat: 3.5, carbs: null })],
      }),
    );
    expect(m).toMatchObject({ kcal: 370, protein: 27, fat: 11.5, carbs: 31 });
    expect(m?.items).toHaveLength(2);
    const huge = normalizeMeal(
      meal({ items: Array.from({ length: 30 }, () => item({ kcal: 1000, protein: 1000 })) }),
    );
    expect(huge).toMatchObject({ kcal: LIMITS.kcal.max, protein: LIMITS.mealMacro.max });
  });

  it('rounds and clamps hand-typed macros of a meal without positions', () => {
    expect(normalizeMeal(meal({ protein: 12.3, fat: 4000, carbs: -1 }))).toMatchObject({
      protein: 12.5,
      fat: LIMITS.mealMacro.max,
      carbs: 0,
    });
  });

  it('is null for an empty meal (a type alone is empty)', () => {
    const empty = meal({ text: '  ', kcal: null });
    expect(normalizeMeal(empty)).toBeNull();
    expect(isEmptyMeal(empty)).toBe(true);
    expect(normalizeMeal({ ...empty, kcal: 0 })).not.toBeNull();
    expect(normalizeMeal({ ...empty, fat: 2 })).not.toBeNull();
    expect(normalizeMeal({ ...empty, photos: [P(1)] })).not.toBeNull();
    expect(normalizeMeal({ ...empty, items: [item()] })).not.toBeNull();
    // A nameless position does not count.
    expect(normalizeMeal({ ...empty, items: [item({ name: '' })] })).toBeNull();
  });

  it('is idempotent', () => {
    const m = meal({ type: ' Обід ', items: [item({ protein: 1.26 })], photos: [P(3), P(3)] });
    const once = normalizeMeal(m);
    expect(once && normalizeMeal(once)).toEqual(once);
  });
});

describe('legacy days and mealsOf', () => {
  const legacy = day({ food: ' Борщ, хліб ', kcal: 500, photos: [P(1)] });

  it('shows a legacy day as one untyped pseudo-meal', () => {
    expect(hasLegacyFood(legacy)).toBe(true);
    expect(legacyMeal(legacy)).toEqual({
      id: LEGACY_MEAL_ID,
      type: '',
      time: null,
      text: 'Борщ, хліб',
      kcal: 500,
      protein: null,
      fat: null,
      carbs: null,
      photos: [P(1)],
    });
    expect(mealsOf(legacy)).toEqual([legacyMeal(legacy)]);
  });

  it('has nothing to show for an empty or missing day', () => {
    expect(hasLegacyFood(undefined)).toBe(false);
    expect(hasLegacyFood(day({ trained: true }))).toBe(false);
    expect(legacyMeal(day())).toBeNull();
    expect(mealsOf(undefined)).toEqual([]);
    expect(mealsOf(day({ notes: 'x' }))).toEqual([]);
  });

  it('lists the meals of a day with meals; tolerates a broken meals value', () => {
    const d = normalizeDay(day({ meals: [meal()] }));
    expect(hasLegacyFood(d)).toBe(false);
    expect(mealsOf(d)).toEqual(d.meals);
    expect(mealsOf({ ...legacy, meals: 'oops' as unknown as Meal[] })).toEqual([legacyMeal(legacy)]);
  });

  it('a photo-only or kcal-only legacy day still has legacy food', () => {
    expect(hasLegacyFood(day({ photos: [P(1)] }))).toBe(true);
    expect(hasLegacyFood(day({ kcal: 0 }))).toBe(true);
  });
});

describe('mealContent', () => {
  it('puts the text on one line, else the position names', () => {
    expect(mealContent(meal({ text: 'тост,\n  кава\n\n' }))).toBe('тост, кава');
    expect(mealContent(meal({ text: '', items: [item(), item({ name: 'Кава' })] }))).toBe(
      'Тост з тунцем, Кава',
    );
    expect(mealContent(meal({ text: ' ', kcal: 100 }))).toBe('');
  });
});

describe('normalizeDay with meals', () => {
  it('keeps a legacy day exactly as before (meals undefined or [])', () => {
    const legacy = day({
      food: ' Омлет ',
      kcal: 1650,
      trained: false,
      types: ['Кардіо'],
      photos: [P(1), P(1)],
    });
    const expected = { food: 'Омлет', kcal: 1650, trained: false, types: [], notes: '', photos: [P(1)] };
    expect(normalizeDay(legacy)).toEqual(expected);
    expect(normalizeDay({ ...legacy, meals: [] })).toEqual(expected);
    expect(normalizeDay({ ...legacy, meals: [] })).not.toHaveProperty('meals');
  });

  it('derives food, kcal and photos from the meals and ignores the given ones', () => {
    const d = normalizeDay(
      day({
        food: 'stale',
        kcal: 1,
        photos: [P(9)],
        meals: [
          meal({
            id: 'b',
            type: 'Обід',
            time: '13:10',
            text: 'Борщ\nхліб житній',
            kcal: 560,
            photos: [P(2)],
          }),
          meal({ id: 'a', text: 'Тост з тунцем, кава', photos: [P(1), P(2)] }),
          meal({ id: 'c', type: '', time: null, text: 'Яблуко\nгруша', kcal: null }),
        ],
      }),
    );
    expect(d.meals?.map((m) => m.id)).toEqual(['a', 'b', 'c']);
    expect(d.food).toBe('Сніданок: Тост з тунцем, кава\nОбід: Борщ, хліб житній\nЯблуко\nгруша');
    expect(d.kcal).toBe(980);
    expect(d.photos).toEqual([P(1), P(2)]);
  });

  it('derives the content of typed and untyped meals without text', () => {
    const d = normalizeDay(
      day({
        meals: [
          meal({ id: 'a', text: '', items: [item()] }),
          meal({ id: 'b', type: 'Перекус', time: '10:00', text: '', kcal: 80 }),
          meal({ id: 'c', type: '', time: '11:00', text: '', kcal: null, photos: [P(1)] }),
          meal({ id: 'd', type: '', time: '12:00', text: '', kcal: null, protein: 20 }),
          meal({
            id: 'e',
            type: '',
            time: '12:30',
            text: '',
            kcal: null,
            items: [item({ name: 'Кава', kcal: 5 })],
          }),
        ],
      }),
    );
    expect(d.food.split('\n')).toEqual([
      'Сніданок: Тост з тунцем',
      'Перекус',
      'Прийом їжі',
      'Прийом їжі',
      'Кава',
    ]);
    expect(d.kcal).toBe(395);
    expect(d.photos).toEqual([P(1)]);
  });

  it('is null-kcal when no meal has kcal', () => {
    expect(normalizeDay(day({ meals: [meal({ kcal: null })] })).kcal).toBeNull();
    expect(deriveDayFood([]).kcal).toBeNull();
  });

  it('drops empty meals and keeps the first of duplicate ids; no meal left → an empty legacy-shaped day', () => {
    const d = normalizeDay(
      day({
        meals: [meal({ text: 'перший' }), meal({ text: 'другий' }), meal({ id: 'x', text: '', kcal: null })],
      }),
    );
    expect(d.meals).toEqual([meal({ text: 'перший' })]);
    const none = normalizeDay(
      day({ food: 'stale', kcal: 5, photos: [P(1)], notes: 'n', meals: [meal({ text: '', kcal: null })] }),
    );
    expect(none).toEqual(day({ notes: 'n' }));
  });

  it('orders by time with untimed meals last, keeping insertion order among equals', () => {
    const d = normalizeDay(
      day({
        meals: [
          meal({ id: 'n1', time: null }),
          meal({ id: 't2', time: '19:00' }),
          meal({ id: 'n2', time: null }),
          meal({ id: 't1', time: '07:00' }),
          meal({ id: 't3', time: '19:00' }),
        ],
      }),
    );
    expect(d.meals?.map((m) => m.id)).toEqual(['t1', 't2', 't3', 'n1', 'n2']);
  });

  it('keeps at most 20 meals and 12 day photos (meals keep their own photos)', () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      meal({ id: `m${i}`, time: null, photos: [P(i)], text: `страва ${i}`, kcal: 100 }),
    );
    const d = normalizeDay(day({ meals: many }));
    expect(d.meals).toHaveLength(LIMITS.mealsPerDay);
    expect(d.kcal).toBe(2000);
    expect(d.photos).toEqual(Array.from({ length: 12 }, (_, i) => P(i)));
    expect(d.meals?.[19]?.photos).toEqual([P(19)]);
  });

  it('cuts the derived text to 5 000 characters', () => {
    const d = normalizeDay(
      day({ meals: [meal({ id: 'a', text: 'а'.repeat(4000) }), meal({ id: 'b', text: 'б'.repeat(4000) })] }),
    );
    expect(d.food.length).toBeLessThanOrEqual(LIMITS.text);
  });

  it('is idempotent', () => {
    const inputs: DayEntry[] = [
      day({ food: ' a ', kcal: 3, trained: true, types: [' Кардіо ', 'Кардіо'], photos: [P(1)] }),
      day({
        meals: [meal(), meal({ id: 'x', type: ' Обід ', items: [item({ fat: 1.3 })], photos: [P(2), P(2)] })],
      }),
      day({ trained: false, meals: [meal({ text: '', kcal: null })] }),
    ];
    for (const input of inputs) expect(normalizeDay(normalizeDay(input))).toEqual(normalizeDay(input));
  });

  it('isEmptyDay needs no meals either', () => {
    expect(isEmptyDay(day())).toBe(true);
    expect(isEmptyDay(day({ meals: [meal()] }))).toBe(false);
  });
});

describe('macros of a day and completeness (D22)', () => {
  const aiMeal = meal({
    id: 'ai',
    text: '',
    items: [item(), item({ name: 'Кава', kcal: 60, protein: 3, fat: 3, carbs: 5 })],
  });

  it('sums the meals; a legacy day has none', () => {
    const d = normalizeDay(
      day({ meals: [aiMeal, meal({ id: 'h', time: '13:00', protein: 20, fat: null, carbs: 10.5 })] }),
    );
    expect(dayMacros(d)).toEqual({ protein: 47, fat: 11, carbs: 46.5 });
    expect(dayMacros(day({ food: 'борщ', kcal: 500 }))).toEqual({ protein: null, fat: null, carbs: null });
    expect(dayMacros(undefined)).toEqual({ protein: null, fat: null, carbs: null });
  });

  it('a meal is complete when every position with energy (or the meal itself) has the macro', () => {
    expect(mealMacroComplete(aiMeal, 'protein')).toBe(true);
    expect(mealMacroComplete(meal({ items: [item(), item({ protein: null })] }), 'protein')).toBe(false);
    // A position without energy is ignored.
    expect(mealMacroComplete(meal({ items: [item(), item({ kcal: 0, protein: null })] }), 'protein')).toBe(
      true,
    );
    expect(mealMacroComplete(meal({ kcal: 300, protein: null }), 'protein')).toBe(false);
    expect(mealMacroComplete(meal({ kcal: 300, protein: 10 }), 'protein')).toBe(true);
    expect(mealMacroComplete(meal({ kcal: null }), 'fat')).toBe(true);
    expect(mealMacroComplete(meal({ kcal: 0 }), 'fat')).toBe(true);
  });

  it('a day is complete when all its meals are', () => {
    const allAi = normalizeDay(day({ meals: [aiMeal] }));
    expect(dayMacroComplete(allAi, 'protein')).toBe(true);
    const withLegacy = putMeal(day({ food: 'борщ', kcal: 500 }), aiMeal);
    expect(withLegacy?.meals).toHaveLength(2);
    expect(dayMacroComplete(withLegacy, 'protein')).toBe(false);
    expect(dayMacroComplete(undefined, 'carbs')).toBe(true);
    expect(dayMacroComplete(day({ food: 'борщ' }), 'carbs')).toBe(true);
  });

  it("the e2e 'meals' day is incomplete for all three (the apple has no macros)", () => {
    const d = normalizeDay(
      day({
        meals: [
          meal({
            id: 'b',
            time: '08:15',
            text: 'Вівсянка з бананом, кава з молоком',
            kcal: null,
            items: [
              item({
                name: 'Вівсянка з бананом',
                portion: '250 г',
                kcal: 320,
                protein: 9,
                fat: 6,
                carbs: 58,
              }),
              item({ name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 }),
            ],
          }),
          meal({ id: 's', type: 'Перекус', time: '09:40', text: 'Яблуко', kcal: 80 }),
        ],
      }),
    );
    expect(d.kcal).toBe(460);
    expect(dayMacros(d)).toEqual({ protein: 12, fat: 9, carbs: 63 });
    for (const key of ['protein', 'fat', 'carbs'] as const) expect(dayMacroComplete(d, key)).toBe(false);
  });
});

describe('meal.put / meal.delete', () => {
  const legacy = day({
    food: 'Борщ',
    kcal: 500,
    photos: [P(1)],
    trained: true,
    types: ['Кардіо'],
    notes: 'n',
  });

  it('converts a legacy day: its food becomes the untyped meal `legacy`, then the new meal is added', () => {
    const d = putMeal(legacy, meal({ id: 'new', time: '19:00', type: 'Вечеря', text: 'Салат', kcal: 300 }));
    expect(d?.meals).toEqual([
      meal({ id: 'new', time: '19:00', type: 'Вечеря', text: 'Салат', kcal: 300 }),
      {
        id: LEGACY_MEAL_ID,
        type: '',
        time: null,
        text: 'Борщ',
        kcal: 500,
        protein: null,
        fat: null,
        carbs: null,
        photos: [P(1)],
      },
    ]);
    expect(d).toMatchObject({
      food: 'Вечеря: Салат\nБорщ',
      kcal: 800,
      photos: [P(1)],
      trained: true,
      types: ['Кардіо'],
      notes: 'n',
    });
  });

  it('editing the legacy block types it', () => {
    const d = putMeal(legacy, { ...(legacyMeal(legacy) as Meal), type: 'Обід' });
    expect(d?.meals).toHaveLength(1);
    expect(d?.food).toBe('Обід: Борщ');
  });

  it('upserts by id, appends a new id, creates the day when there was none', () => {
    const one = putMeal(undefined, meal());
    expect(one).toEqual(normalizeDay(day({ meals: [meal()] })));
    const replaced = putMeal(one, meal({ text: 'Омлет', kcal: 300 }));
    expect(replaced?.meals).toEqual([meal({ text: 'Омлет', kcal: 300 })]);
    const two = putMeal(replaced, meal({ id: 'm2', time: '13:00', type: 'Обід', text: 'Суп', kcal: 200 }));
    expect(two?.meals?.map((m) => m.id)).toEqual(['m1', 'm2']);
    expect(two?.kcal).toBe(500);
  });

  it('refuses a 21st meal (no change at all)', () => {
    let d: DayEntry | undefined;
    for (let i = 0; i < 20; i++) d = putMeal(d, meal({ id: `m${i}`, time: null, text: `${i}` }));
    expect(d?.meals).toHaveLength(20);
    const full = d;
    expect(putMeal(full, meal({ id: 'm20', text: 'ще' }))).toBe(full);
    // An existing meal can still be edited.
    expect(putMeal(full, meal({ id: 'm3', time: null, text: 'нове' }))?.meals?.[3]?.text).toBe('нове');
  });

  it('an empty meal deletes that meal; an empty new meal changes nothing', () => {
    const two = putMeal(putMeal(undefined, meal()), meal({ id: 'm2', time: '13:00', text: 'Суп' }));
    expect(putMeal(two, meal({ id: 'm2', text: '', kcal: null }))?.meals?.map((m) => m.id)).toEqual(['m1']);
    expect(putMeal(legacy, meal({ id: 'x', text: ' ', kcal: null }))).toBe(legacy);
    expect(putMeal(undefined, meal({ text: '', kcal: null }))).toBeUndefined();
    // Emptying the legacy block clears the legacy food.
    expect(
      putMeal(day({ food: 'Борщ' }), meal({ id: LEGACY_MEAL_ID, text: '', kcal: null })),
    ).toBeUndefined();
  });

  it('meal.delete removes a meal; the last one gone leaves no stale derived text', () => {
    const two = putMeal(
      putMeal(undefined, meal({ photos: [P(1)] })),
      meal({ id: 'm2', time: '13:00', text: 'Суп', kcal: 200 }),
    );
    const one = deleteMeal(two, 'm1');
    expect(one).toEqual(
      normalizeDay(day({ meals: [meal({ id: 'm2', time: '13:00', text: 'Суп', kcal: 200 })] })),
    );
    expect(deleteMeal(one, 'm2')).toBeUndefined();
    const marked = setDayMeta(one, { notes: 'нотатка' });
    expect(deleteMeal(marked, 'm2')).toEqual(day({ notes: 'нотатка' }));
    expect(deleteMeal(marked, 'm2')).not.toHaveProperty('meals');
    expect(deleteMeal(marked, 'unknown')).toBe(marked);
  });

  it('meal.delete of `legacy` on a legacy day clears its food, kcal and photos', () => {
    expect(deleteMeal(legacy, LEGACY_MEAL_ID)).toEqual(day({ trained: true, types: ['Кардіо'], notes: 'n' }));
    expect(deleteMeal(day({ food: 'Борщ' }), LEGACY_MEAL_ID)).toBeUndefined();
    expect(deleteMeal(legacy, 'other')).toBe(legacy);
    expect(deleteMeal(undefined, 'x')).toBeUndefined();
  });
});

describe('day.meta', () => {
  const mealDay = normalizeDay(day({ trained: true, types: ['Прес'], notes: 'n', meals: [meal()] }));

  it('applies only the keys present', () => {
    expect(setDayMeta(mealDay, { trained: false })).toEqual({ ...mealDay, trained: false, types: [] });
    expect(setDayMeta(mealDay, { notes: ' нові ' })).toEqual({ ...mealDay, notes: 'нові' });
    expect(setDayMeta(mealDay, { types: ['Кардіо'] })?.types).toEqual(['Кардіо']);
    const untrained = setDayMeta(mealDay, { trained: false });
    // ✓ keeps the stored types (none after ✕); types alone are kept only while trained.
    expect(setDayMeta(untrained, { types: ['Кардіо'] })?.types).toEqual([]);
    expect(setDayMeta(untrained, { trained: true })?.meals).toEqual(mealDay.meals);
  });

  it('never touches the food; creates no empty day', () => {
    const legacy = day({ food: 'Борщ', kcal: 500 });
    expect(setDayMeta(legacy, { trained: true })).toEqual({ ...legacy, trained: true });
    expect(setDayMeta(undefined, { notes: '  ' })).toBeUndefined();
    expect(setDayMeta(undefined, { trained: null })).toBeUndefined();
    expect(setDayMeta(undefined, { trained: false })).toEqual(day({ trained: false }));
    expect(setDayMeta(day({ notes: 'x' }), { notes: '' })).toBeUndefined();
  });
});

describe('Rule L: old-shape day.put / day.delete on a day with meals', () => {
  const breakfast = meal({ id: 'b', text: 'Тост з тунцем, кава', kcal: 420, photos: [P(1)] });
  const lunch = meal({ id: 'l', type: 'Обід', time: '13:10', text: 'Борщ', kcal: 500 });
  const stored = normalizeDay(day({ meals: [breakfast, lunch] }));
  /** What an old client shows (the derived fields) and sends back. */
  const oldView = (d: DayEntry, patch: Partial<DayEntry> = {}): DayEntry => ({
    food: d.food,
    kcal: d.kcal,
    trained: d.trained,
    types: d.types,
    notes: d.notes,
    ...(d.photos ? { photos: d.photos } : {}),
    ...patch,
  });

  it('(a) a ✓ from an old client keeps the meals', () => {
    const next = mergeLegacyDayPut(stored, oldView(stored, { trained: true, types: ['Кардіо'] }));
    expect(next).toEqual({ ...stored, trained: true, types: ['Кардіо'] });
  });

  it('(b) an appended line and more kcal become one untyped meal; a replay adds nothing', () => {
    const value = oldView(stored, { food: `${stored.food}\nСалат — 200 ккал`, kcal: 1120 });
    const next = mergeLegacyDayPut(stored, value);
    expect(next?.meals).toHaveLength(3);
    const extra = next?.meals?.[2];
    expect(extra).toMatchObject({ type: '', time: null, text: 'Салат — 200 ккал', kcal: 200 });
    expect(extra?.id).toMatch(/^old-[0-9a-z]+$/);
    expect(next?.kcal).toBe(1120);
    expect(mergeLegacyDayPut(next, value)).toEqual(next);
    // The same extra again from another stored state gets the same id (deterministic).
    expect(mergeLegacyDayPut(stored, value)?.meals?.[2]?.id).toBe(extra?.id);
  });

  it('(b) an added photo joins the extra meal within the 12-photo day cap', () => {
    const next = mergeLegacyDayPut(stored, oldView(stored, { photos: [P(1), P(5)] }));
    expect(next?.meals?.[2]).toMatchObject({ text: '', kcal: null, photos: [P(5)] });
    expect(next?.photos).toEqual([P(1), P(5)]);
    expect(next?.food.split('\n')[2]).toBe('Прийом їжі');
    expect(mergeLegacyDayPut(next, oldView(stored, { photos: [P(1), P(5)] }))).toEqual(next);
  });

  it('(c) removals by an old client are ignored', () => {
    const next = mergeLegacyDayPut(
      stored,
      oldView(stored, { food: 'Сніданок: Тост з тунцем, кава', kcal: 100, photos: [] }),
    );
    expect(next).toEqual(stored);
  });

  it('(d) an old outbox op from before the conversion adds nothing', () => {
    const converted = putMeal(day({ food: 'борщ', kcal: 500 }), {
      ...(legacyMeal(day({ food: 'борщ', kcal: 500 })) as Meal),
      type: 'Обід',
    });
    expect(converted?.food).toBe('Обід: борщ');
    expect(mergeLegacyDayPut(converted, day({ food: 'борщ', kcal: 500, trained: true }))).toEqual({
      ...converted,
      trained: true,
    });
  });

  it('(e) known limit: a stale old client brings back a meal deleted elsewhere', () => {
    const dinner = meal({ id: 'd', type: 'Вечеря', time: '19:00', text: 'Салат', kcal: 500 });
    const before = normalizeDay(day({ meals: [breakfast, dinner] }));
    const staleView = oldView(before, { trained: true });
    const after = deleteMeal(before, 'd');
    const next = mergeLegacyDayPut(after, staleView);
    expect(next?.meals).toHaveLength(2);
    expect(next?.meals?.[1]).toMatchObject({ type: '', text: 'Вечеря: Салат', kcal: 500 });
    expect(next?.trained).toBe(true);
  });

  it('(f) known limit: the old client’s own kcal increase is lost when meals were added elsewhere', () => {
    const legacyDay = day({ food: 'борщ', kcal: 500 });
    const phone = putMeal(legacyDay, meal({ id: 'o', type: 'Обід', time: '13:00', text: 'суп', kcal: 300 }));
    expect(phone?.kcal).toBe(800);
    const next = mergeLegacyDayPut(phone, day({ food: 'борщ, хліб', kcal: 650 }));
    expect(next?.meals).toHaveLength(3);
    expect(next?.meals?.[2]).toMatchObject({ type: '', text: 'борщ, хліб', kcal: null });
    expect(next?.kcal).toBe(800);
  });

  it('(g) an old day.delete keeps the meals and clears only the mark, types and notes', () => {
    const marked = setDayMeta(stored, { trained: true, types: ['Кардіо'], notes: 'n' });
    expect(reduceDay(marked, { kind: 'day.delete', date: '2026-10-10' })).toEqual(stored);
    expect(reduceDay(day({ food: 'Борщ' }), { kind: 'day.delete', date: '2026-10-10' })).toBeUndefined();
    expect(reduceDay(undefined, { kind: 'day.delete', date: '2026-10-10' })).toBeUndefined();
  });

  it('(h) at 20 meals the extra merges into the last meal without positions; a replay adds nothing', () => {
    const meals = Array.from({ length: 20 }, (_, i) =>
      meal({
        id: `m${i}`,
        time: null,
        text: `страва ${i}`,
        kcal: 10,
        items: i === 19 ? [item({ kcal: 10 })] : undefined,
      }),
    );
    meals[5] = meal({ id: LEGACY_MEAL_ID, type: '', time: null, text: 'стара їжа', kcal: 10 });
    const full = normalizeDay(day({ meals }));
    const value = oldView(full, {
      food: `${full.food}\nСалат`,
      kcal: (full.kcal ?? 0) + 150,
      photos: [P(7)],
    });
    const next = mergeLegacyDayPut(full, value);
    expect(next?.meals).toHaveLength(20);
    expect(next?.meals?.[5]).toMatchObject({
      id: LEGACY_MEAL_ID,
      text: 'стара їжа\nСалат',
      kcal: 160,
      photos: [P(7)],
    });
    expect(mergeLegacyDayPut(next, value)).toEqual(next);

    // A typed target changes its derived line («Сніданок: страва 4, Салат»); the old line is still known.
    const typed = normalizeDay(
      day({ meals: meals.map((m, i) => (i === 5 ? { ...m, type: 'Сніданок' } : m)) }),
    );
    const typedValue = oldView(typed, { food: `${typed.food}\nСалат`, kcal: (typed.kcal ?? 0) + 150 });
    const typedMerged = mergeLegacyDayPut(typed, typedValue);
    expect(typedMerged?.meals?.[5]).toMatchObject({ type: 'Сніданок', text: 'стара їжа\nСалат', kcal: 160 });
    expect(typedMerged?.food.split('\n')[5]).toBe('Сніданок: стара їжа, Салат');
    expect(mergeLegacyDayPut(typedMerged, typedValue)).toEqual(typedMerged);

    // Without a legacy / old-* meal: the last meal without positions.
    const plain = normalizeDay(day({ meals: meals.map((m, i) => (i === 5 ? { ...m, id: 'm5' } : m)) }));
    const merged = mergeLegacyDayPut(plain, oldView(plain, { food: `${plain.food}\nСалат` }));
    expect(merged?.meals?.[18]?.text).toBe('страва 18\nСалат');

    // Every meal with positions: the extra is dropped.
    const allItems = normalizeDay(
      day({
        meals: meals.map((m) => ({
          ...m,
          id: m.id === LEGACY_MEAL_ID ? 'm5' : m.id,
          items: [item({ name: m.text })],
        })),
      }),
    );
    expect(
      mergeLegacyDayPut(allItems, oldView(allItems, { food: `${allItems.food}\nСалат`, trained: true })),
    ).toEqual({
      ...allItems,
      trained: true,
    });
  });

  it('a legacy stored day keeps the legacy semantics; meals in the value are ignored', () => {
    const legacy = day({ food: 'Борщ', kcal: 500 });
    expect(mergeLegacyDayPut(legacy, day({ food: ' Суп ', kcal: 200 }))).toEqual(
      day({ food: 'Суп', kcal: 200 }),
    );
    expect(mergeLegacyDayPut(legacy, day())).toBeUndefined();
    expect(mergeLegacyDayPut(undefined, day({ food: 'x', meals: [meal()] }))).toEqual(day({ food: 'x' }));
  });
});

describe('applyOps with the new ops', () => {
  it('routes every day op through reduceDay and deletes days that end up empty', () => {
    const d = applyOps(emptyData(), [
      { kind: 'day.put', date: '2026-10-10', value: day({ food: 'Борщ', kcal: 500 }) },
      {
        kind: 'meal.put',
        date: '2026-10-10',
        value: meal({ id: 'x', time: '19:00', type: 'Вечеря', text: 'Салат', kcal: 200 }),
      },
      { kind: 'day.meta', date: '2026-10-10', value: { trained: true } },
      { kind: 'meal.put', date: '2026-10-11', value: meal() },
      { kind: 'meal.delete', date: '2026-10-11', id: 'm1' },
      { kind: 'day.meta', date: '2026-10-12', value: { notes: '' } },
    ]);
    expect(Object.keys(d.days)).toEqual(['2026-10-10']);
    expect(d.days['2026-10-10']).toMatchObject({ food: 'Вечеря: Салат\nБорщ', kcal: 700, trained: true });
  });

  it('returns the same object for an op that changes nothing', () => {
    const data = emptyData();
    expect(applyOps(data, [{ kind: 'meal.delete', date: '2026-10-10', id: 'x' }])).toBe(data);
    expect(applyOps(data, [{ kind: 'day.delete', date: '2026-10-10' }])).toBe(data);
  });
});

describe('suggestMealType (§2.8)', () => {
  const DEFAULTS = ['Сніданок', 'Обід', 'Вечеря', 'Перекус'];
  const THREE = ['Сніданок', 'Обід', 'Вечеря'];
  const s = (time: string | null, logged: string[] = [], types: string[] = DEFAULTS): string =>
    suggestMealType({ types, logged, time });

  it.each([
    ['10:00', [], 'Сніданок'],
    ['10:00', ['Сніданок'], 'Перекус'],
    ['13:00', [], 'Обід'],
    ['16:30', [], 'Перекус'],
    ['22:30', [], 'Вечеря'],
    ['22:30', ['Вечеря'], 'Перекус'],
    ['00:30', [], 'Перекус'],
    ['04:00', [], 'Сніданок'],
    ['03:59', [], 'Перекус'],
    ['11:00', [], 'Обід'],
    ['17:00', [], 'Вечеря'],
  ])('defaults at %s (logged %j) → %s', (time, logged, expected) => {
    expect(s(time, logged)).toBe(expected);
  });

  it('without a snack type falls back to the nearest earlier main slot', () => {
    expect(s('16:30', [], THREE)).toBe('Обід');
    expect(s('23:00', [], THREE)).toBe('Вечеря');
    expect(s('10:00', ['Сніданок'], THREE)).toBe('Сніданок');
    expect(s('01:00', [], THREE)).toBe('Вечеря');
  });

  it('matches renamed types by keyword and compares logged types loosely', () => {
    expect(s('13:00', [], ['Сніданок', 'Ланч', 'Вечеря', 'Перекус'])).toBe('Ланч');
    expect(s('08:00', [], ['Ранковий прийом', 'Обід'])).toBe('Ранковий прийом');
    expect(s('10:00', [' сніданок '])).toBe('Перекус');
    // The exact default name wins over an earlier keyword match.
    expect(s('08:00', [], ['Другий сніданок', 'Сніданок'])).toBe('Сніданок');
  });

  it.each([
    // Natural renames of «Вечеря» (the stem «вечер» alone misses «вечір»).
    [['Сніданок', 'Обід', 'Вечір', 'Перекус'], '19:00', 'Вечір'],
    [['Сніданок', 'Обід', 'Вечір', 'Перекус'], '22:30', 'Вечір'],
    [['Сніданок', 'Обід', 'Вечірній прийом', 'Перекус'], '19:00', 'Вечірній прийом'],
    // Russian names.
    [['Завтрак', 'Обед', 'Ужин', 'Перекус'], '08:00', 'Завтрак'],
    [['Завтрак', 'Обед', 'Ужин', 'Перекус'], '13:00', 'Обед'],
    [['Завтрак', 'Обед', 'Ужин', 'Перекус'], '19:00', 'Ужин'],
    [['Завтрак', 'Обед', 'Полдник', 'Ужин'], '16:30', 'Полдник'],
    [['Утро', 'День', 'Вечер'], '13:00', 'День'],
    // Afternoon snacks by their own names.
    [['Сніданок', 'Другий сніданок', 'Обід', 'Полуденок', 'Вечеря'], '16:30', 'Полуденок'],
    [['Сніданок', 'Другий сніданок', 'Обід', 'Полуденок', 'Вечеря'], '13:00', 'Обід'],
    [['Сніданок', 'Обід', 'Полудник', 'Вечеря'], '16:30', 'Полудник'],
    [['Сніданок', 'Обід', 'Підвечірок', 'Вечір'], '16:30', 'Підвечірок'],
    // «Підвечірок» has «вечір» in it but is a snack, never the dinner.
    [['Сніданок', 'Обід', 'Підвечірок', 'Вечір'], '19:00', 'Вечір'],
    // «Перекус після обіду» is a snack, not the lunch.
    [['Сніданок', 'Перекус після обіду', 'Ланч', 'Вечеря'], '13:00', 'Ланч'],
    [['Сніданок', 'Перекус після обіду', 'Ланч', 'Вечеря'], '16:30', 'Перекус після обіду'],
  ])('her names %j at %s → %s', (types, time, expected) => {
    expect(s(time, [], types)).toBe(expected);
  });

  it('a main meal no name matches takes the type at its position, never another meal’s type', () => {
    const renamed = ['Ранок', 'День', 'Вечір', 'Перекус'];
    expect(s('08:00', [], renamed)).toBe('Ранок');
    expect(s('13:00', [], renamed)).toBe('День');
    expect(s('16:30', [], renamed)).toBe('Перекус');
    expect(s('19:00', [], renamed)).toBe('Вечір');
    // The positional lunch already logged → the snack type, as with a named one.
    expect(s('13:00', ['День'], renamed)).toBe('Перекус');
    // A first type with her own name is the breakfast (it used to give way to «Перекус»).
    expect(s('08:00', [], ['Каша', 'Обід', 'Вечеря', 'Перекус'])).toBe('Каша');
    // «Полудень» (noon) is not a snack: in the 2nd place it is the lunch, also at 16:30 without a snack type.
    expect(s('13:00', [], ['Сніданок', 'Полудень', 'Вечеря'])).toBe('Полудень');
    expect(s('16:30', [], ['Сніданок', 'Полудень', 'Вечеря'])).toBe('Полудень');
    // The 2nd type is the dinner here, so the lunch has no type: the snack type.
    expect(s('13:00', [], ['Ранок', 'Вечір', 'Перекус'])).toBe('Перекус');
    // Not enough types for a 3rd place: the dinner falls back like before.
    expect(s('19:00', [], ['Ранок', 'Перекус'])).toBe('Перекус');
  });

  it('the period’s meal logged → another type of the same meal not logged yet, then the snack type', () => {
    const two = ['Сніданок', 'Другий сніданок', 'Обід', 'Полуденок', 'Вечеря'];
    expect(s('10:00', ['Сніданок'], two)).toBe('Другий сніданок');
    expect(s('10:00', ['Сніданок', 'Другий сніданок'], two)).toBe('Полуденок');
    expect(s('22:30', ['Вечеря'], ['Обід', 'Вечеря', 'Пізня вечеря'])).toBe('Пізня вечеря');
    // Without a snack type, all of them logged → the main type itself.
    expect(s('10:00', ['Сніданок', 'Другий сніданок'], ['Сніданок', 'Другий сніданок', 'Обід'])).toBe('Сніданок');
  });

  it('all-custom names → by position', () => {
    const custom = ['Перший', 'Другий', 'Третій', 'Четвертий'];
    expect(s('08:00', [], custom)).toBe('Перший');
    expect(s('13:00', [], custom)).toBe('Другий');
    expect(s('19:00', [], custom)).toBe('Третій');
    expect(s('23:00', [], custom)).toBe('Третій');
    expect(s('16:30', [], custom)).toBe('Четвертий');
    expect(s('02:00', [], custom)).toBe('Четвертий');
    expect(s('19:00', [], ['Один', 'Два'])).toBe('Два');
  });

  it('no types → ""; no time → the first type not logged, else the snack type, else the last', () => {
    expect(s('10:00', [], [])).toBe('');
    expect(s(null)).toBe('Сніданок');
    expect(s(null, ['Сніданок', 'Обід'])).toBe('Вечеря');
    expect(s(null, DEFAULTS)).toBe('Перекус');
    expect(s(null, THREE, THREE)).toBe('Вечеря');
  });
});
