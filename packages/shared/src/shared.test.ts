import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyOps,
  appDataSchema,
  diffDays,
  emptyData,
  f0,
  f1,
  fN,
  mondayOf,
  normalizeSettings,
  num,
  opSchema,
  sgn,
  zonedNow,
  defaultSettings,
  foodEstimateRequestSchema,
  rankFoods,
  settingsSchema,
  DEFAULT_MEAL_TYPES,
  dayEntrySchema,
  emptyMacroGoals,
  foodEstimateResultSchema,
  settingsPutSchema,
  useFood,
} from './index';

describe('dates', () => {
  it('adds days across month and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // Sunday
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // Monday
    expect(mondayOf('2026-10-09')).toBe('2026-10-05'); // Friday
  });

  it('counts whole days', () => {
    expect(diffDays('2026-10-01', '2026-10-09')).toBe(8);
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('reads wall-clock time in a zone', () => {
    const z = zonedNow('Europe/Kyiv', new Date('2026-10-09T05:30:00Z'));
    expect(z).toEqual({ date: '2026-10-09', hm: '08:30', weekday: 5, minutes: 510 });
    const w = zonedNow('Europe/Kyiv', new Date('2026-12-31T22:30:00Z'));
    expect(w.date).toBe('2027-01-01');
    expect(w.hm).toBe('00:30');
  });
});

describe('format', () => {
  it('formats numbers the Ukrainian way', () => {
    expect(f1(65.44)).toBe('65,4');
    expect(f1(null)).toBe('—');
    expect(fN(70)).toBe('70');
    expect(fN(70.25)).toBe('70,3');
    expect(f0(1650).replace(/\s/g, ' ')).toBe('1 650');
    expect(sgn(-0.4, f1)).toBe('−0,4');
    expect(sgn(2)).toBe('+2');
    expect(sgn(0.01)).toBe('0');
  });

  it('parses comma decimals', () => {
    expect(num('65,4')).toBe(65.4);
    expect(num('')).toBeNull();
    expect(num('abc')).toBeNull();
  });
});

describe('ops', () => {
  it('applies puts and deletes like the design prototype', () => {
    const d = applyOps(emptyData(), [
      { kind: 'day.put', date: '2026-10-10', value: { food: ' Омлет ', kcal: 1650, trained: true, types: ['Верх тіла'], notes: '' } },
      { kind: 'weight.put', date: '2026-10-10', kg: 65.4 },
      { kind: 'weight.put', date: '2026-10-03', kg: 66 },
      { kind: 'weight.put', date: '2026-10-10', kg: 65.3 },
      { kind: 'measure.put', date: '2026-10-10', value: { chest: 90, waist: 70, hips: null } },
    ]);
    expect(d.days['2026-10-10']).toEqual({ food: 'Омлет', kcal: 1650, trained: true, types: ['Верх тіла'], notes: '' });
    expect(d.weights).toEqual([
      { date: '2026-10-03', kg: 66 },
      { date: '2026-10-10', kg: 65.3 },
    ]);
    expect(d.measures).toEqual([{ date: '2026-10-10', chest: 90, waist: 70, hips: null }]);

    const cleared = applyOps(d, [
      { kind: 'day.put', date: '2026-10-10', value: { food: '', kcal: null, trained: null, types: [], notes: ' ' } },
      { kind: 'measure.put', date: '2026-10-10', value: { chest: null, waist: null, hips: null } },
    ]);
    expect(cleared.days).toEqual({});
    expect(cleared.measures).toEqual([]);
  });

  it('drops workout types when there was no workout', () => {
    const d = applyOps(emptyData(), [
      { kind: 'day.put', date: '2026-10-10', value: { food: '', kcal: null, trained: false, types: ['Кардіо'], notes: '' } },
    ]);
    expect(d.days['2026-10-10']?.types).toEqual([]);
  });

  it('validates ops', () => {
    expect(opSchema.safeParse({ kind: 'weight.put', date: '2026-02-30', kg: 60 }).success).toBe(false);
    expect(opSchema.safeParse({ kind: 'weight.put', date: '2026-02-28', kg: 5 }).success).toBe(false);
    expect(opSchema.safeParse({ kind: 'weight.put', date: '2026-02-28', kg: 60.5 }).success).toBe(true);
    expect(
      opSchema.safeParse({ kind: 'measure.put', date: '2026-02-28', value: { chest: null, waist: null, hips: null } })
        .success,
    ).toBe(false);
  });

  it('validates a full data export', () => {
    const data = { ...emptyData(), weights: [{ date: '2026-10-10', kg: 65.4 }] };
    expect(appDataSchema.safeParse(data).success).toBe(true);
    const dup = { ...data, weights: [...data.weights, { date: '2026-10-10', kg: 65 }] };
    expect(appDataSchema.safeParse(dup).success).toBe(false);
  });
});

describe('settings', () => {
  it('fills in missing fields', () => {
    const s = normalizeSettings({ goal: 58, rem: { weigh: { on: false } } as never });
    expect(s.goal).toBe(58);
    expect(s.rem.weigh).toEqual({ on: false, day: 1, time: '08:00' });
    expect(s.rem.workout.days).toEqual([1, 3, 5]);
    expect(s.customTypes).toEqual([]);
  });
});

describe('food ops & photos', () => {
  it('keeps photos on a day and treats a photo-only day as non-empty', () => {
    const d = applyOps(emptyData(), [
      {
        kind: 'day.put',
        date: '2026-10-10',
        value: { food: '', kcal: null, trained: null, types: [], notes: '', photos: ['abcdefghijklmnop', 'abcdefghijklmnop'] },
      },
    ]);
    expect(d.days['2026-10-10']).toEqual({ food: '', kcal: null, trained: null, types: [], notes: '', photos: ['abcdefghijklmnop'] });
    const e = applyOps(d, [{ kind: 'day.put', date: '2026-10-10', value: { food: '', kcal: null, trained: null, types: [], notes: '', photos: [] } }]);
    expect(e.days).toEqual({});
  });

  it('upserts frequent dishes case-insensitively', () => {
    const d = applyOps(emptyData(), [
      { kind: 'food.use', date: '2026-10-09', value: { name: 'Вівсянка з бананом', portion: '250 г', kcal: 350 } },
      { kind: 'food.use', date: '2026-10-10', value: { name: 'вівсянка з бананом ', portion: '300 г', kcal: 400 } },
      { kind: 'food.use', date: '2026-10-10', value: { name: 'Кава з молоком', portion: '1 чашка', kcal: 60 } },
    ]);
    expect(d.foods).toHaveLength(2);
    expect(d.foods.find((f) => f.kcal === 400)).toEqual({ name: 'вівсянка з бананом', portion: '300 г', kcal: 400, count: 2, lastUsed: '2026-10-10' });
    expect(rankFoods(d.foods).map((f) => f.count)).toEqual([2, 1]);
    const e = applyOps(d, [{ kind: 'food.delete', name: 'КАВА З МОЛОКОМ' }]);
    expect(e.foods.map((f) => f.name)).toEqual(['вівсянка з бананом']);
  });

  it('normalises custom workout types identically to the server schema', () => {
    const value = { ...defaultSettings(), customTypes: [' Йога ', 'йога', 'Пілатес'] };
    const parsed = settingsSchema.parse(value);
    const reduced = applyOps(emptyData(), [{ kind: 'settings.put', value }]).settings;
    expect(parsed.customTypes).toEqual(['Йога', 'Пілатес']);
    expect(reduced.customTypes).toEqual(parsed.customTypes);
  });

  it('accepts backups without foods and validates estimate requests', () => {
    const { foods: _foods, ...old } = emptyData();
    expect(appDataSchema.parse(old).foods).toEqual([]);
    expect(foodEstimateRequestSchema.safeParse({ date: '2026-10-10' }).success).toBe(false);
    expect(foodEstimateRequestSchema.safeParse({ date: '2026-10-10', text: 'борщ' }).success).toBe(true);
    expect(opSchema.safeParse({ kind: 'day.put', date: '2026-10-10', value: { food: '', kcal: null, trained: null, types: [], notes: '', photos: ['bad id'] } }).success).toBe(false);
  });
});

describe('food recalculation requests', () => {
  it('accepts corrected items (optionally with a stored photo) and rejects mixed modes', () => {
    const items = [{ name: 'Борщ зі сметаною', portion: '350 г' }];
    expect(foodEstimateRequestSchema.safeParse({ date: '2026-10-10', items }).success).toBe(true);
    expect(
      foodEstimateRequestSchema.safeParse({ date: '2026-10-10', items, photoId: 'abcdefghijklmnopqrstuv' }).success,
    ).toBe(true);
    expect(foodEstimateRequestSchema.safeParse({ date: '2026-10-10', items: [] }).success).toBe(false);
    expect(
      foodEstimateRequestSchema.safeParse({ date: '2026-10-10', photoId: 'abcdefghijklmnopqrstuv', text: 'борщ' })
        .success,
    ).toBe(false);
    expect(
      foodEstimateRequestSchema.safeParse({
        date: '2026-10-10',
        items,
        image: { full: 'A'.repeat(20), thumb: 'A'.repeat(20) },
      }).success,
    ).toBe(false);
  });
});

describe('meals and macros: schemas and compatibility', () => {
  const P1 = 'photo00000000001';
  const meal = {
    id: 'Ab3_-x12CdEf',
    type: ' Сніданок ',
    time: '08:30',
    text: 'Тост з тунцем',
    kcal: 420,
    protein: 27,
    fat: 11.5,
    carbs: 36,
  };
  const legacyDay = { food: 'Борщ', kcal: 500, trained: null, types: [], notes: '' };
  const put = (value: unknown) => ({ kind: 'meal.put', date: '2026-10-10', value });
  const settingsWith = (patch: Record<string, unknown>) => ({ kind: 'settings.put', value: { ...defaultSettings(), ...patch } });

  it('accepts meal ops and trims the type; positions default missing macros to null', () => {
    const parsed = opSchema.parse(put({ ...meal, photos: [P1], items: [{ name: 'Тост', portion: '2 шт', kcal: 310 }] }));
    expect(parsed).toMatchObject({ value: { type: 'Сніданок', items: [{ protein: null, fat: null, carbs: null }] } });
    expect(opSchema.safeParse({ kind: 'meal.delete', date: '2026-10-10', id: 'legacy' }).success).toBe(true);
    expect(opSchema.safeParse({ kind: 'meal.delete', date: '2026-10-10', id: 'old-1k2j3h' }).success).toBe(true);
  });

  it.each([
    ['a bad meal id', { kind: 'meal.delete', date: '2026-10-10', id: 'не так' }],
    ['an empty meal id', put({ ...meal, id: '' })],
    ['a meal id over 40 chars', put({ ...meal, id: 'a'.repeat(41) })],
    ['a macro not in 0.5 g steps', put({ ...meal, protein: 12.3 })],
    ['a meal macro over 3 000 g', put({ ...meal, fat: 3000.5 })],
    ['a negative macro', put({ ...meal, carbs: -0.5 })],
    ['a missing meal macro', put({ ...meal, carbs: undefined })],
    ['a position macro over 1 000 g', put({ ...meal, items: [{ name: 'x', portion: '', kcal: 1, protein: 1000.5 }] })],
    ['31 positions', put({ ...meal, items: Array.from({ length: 31 }, () => ({ name: 'x', portion: '', kcal: 1 })) })],
    ['a meal type over 30 chars', put({ ...meal, type: 'x'.repeat(31) })],
    ['a bad meal time', put({ ...meal, time: '8:30' })],
    ['fractional meal kcal', put({ ...meal, kcal: 1.5 })],
    ['13 photos on a meal', put({ ...meal, photos: Array.from({ length: 13 }, (_, i) => `photo${String(i).padStart(11, '0')}`) })],
    ['an empty day.meta', { kind: 'day.meta', date: '2026-10-10', value: {} }],
    ['day.meta with bad notes', { kind: 'day.meta', date: '2026-10-10', value: { notes: 5 } }],
    ['a null food.use macro', { kind: 'food.use', date: '2026-10-10', value: { name: 'Борщ', portion: '', kcal: 180, protein: null } }],
    ['a food.use macro not in 0.5 g steps', { kind: 'food.use', date: '2026-10-10', value: { name: 'Борщ', portion: '', kcal: 180, fat: 0.2 } }],
    ['macro goal 0', settingsWith({ macroGoals: { protein: 0, fat: null, carbs: null } })],
    ['macro goal 1001', settingsWith({ macroGoals: { protein: null, fat: 1001, carbs: null } })],
    ['a fractional macro goal', settingsWith({ macroGoals: { protein: null, fat: null, carbs: 90.5 } })],
    ['13 meal types', settingsWith({ mealTypes: Array.from({ length: 13 }, (_, i) => `Тип ${i}`) })],
    ['an empty meal type', settingsWith({ mealTypes: ['  '] })],
    ['a meal type over 30 chars in settings', settingsWith({ mealTypes: ['x'.repeat(31)] })],
  ])('opSchema rejects %s', (_name, op) => {
    expect(opSchema.safeParse(op).success).toBe(false);
  });

  it('accepts partial day.meta values', () => {
    for (const value of [{ trained: true }, { trained: null }, { notes: '' }, { types: ['Кардіо'] }]) {
      expect(opSchema.safeParse({ kind: 'day.meta', date: '2026-10-10', value }).success).toBe(true);
    }
  });

  it('strips a meals key from day.put: every day.put is legacy-shaped', () => {
    const parsed = opSchema.parse({ kind: 'day.put', date: '2026-10-10', value: { ...legacyDay, meals: [meal] } });
    expect(parsed.kind === 'day.put' && parsed.value).toEqual(legacyDay);
    expect(applyOps(emptyData(), [parsed]).days['2026-10-10']).toEqual(legacyDay);
  });

  it('rejects duplicate meal ids and more than 20 meals in stored days; [] is a legacy day', () => {
    const day = (meals: unknown[]) => ({ ...legacyDay, meals });
    expect(dayEntrySchema.safeParse(day([meal])).success).toBe(true);
    expect(dayEntrySchema.safeParse(day([meal, meal])).success).toBe(false);
    expect(dayEntrySchema.safeParse(day(Array.from({ length: 21 }, (_, i) => ({ ...meal, id: `m${i}` })))).success).toBe(false);
    expect(dayEntrySchema.safeParse(day([])).success).toBe(true);
  });

  it('settings.put without the new fields keeps them; with them it replaces them', () => {
    const custom = applyOps(emptyData(), [
      {
        kind: 'settings.put',
        value: { ...defaultSettings(), mealTypes: ['Сніданок', 'Після тренування'], macroGoals: { protein: 90, fat: 60, carbs: null } },
      },
    ]);
    const { mealTypes: _m, macroGoals: _g, ...oldClient } = { ...defaultSettings(), goal: 58 };
    const parsedOld = opSchema.parse({ kind: 'settings.put', value: oldClient });
    expect(parsedOld.kind === 'settings.put' && parsedOld.value).not.toHaveProperty('mealTypes');
    expect(applyOps(custom, [parsedOld]).settings).toMatchObject({
      goal: 58,
      mealTypes: ['Сніданок', 'Після тренування'],
      macroGoals: { protein: 90, fat: 60, carbs: null },
    });

    const replaced = applyOps(custom, [
      opSchema.parse(settingsWith({ mealTypes: [' Обід ', 'обід', 'Перекус'], macroGoals: { protein: null, fat: null, carbs: 200 } })),
    ]).settings;
    expect(replaced.mealTypes).toEqual(['Обід', 'Перекус']);
    expect(replaced.macroGoals).toEqual({ protein: null, fat: null, carbs: 200 });
    // The reducer normalises an unparsed value the same way, and an explicit empty list is allowed.
    expect(applyOps(custom, [{ kind: 'settings.put', value: { ...defaultSettings(), mealTypes: [' Ланч ', 'ланч'] } }]).settings.mealTypes).toEqual(['Ланч']);
    expect(applyOps(custom, [{ kind: 'settings.put', value: { ...defaultSettings(), mealTypes: [] } }]).settings.mealTypes).toEqual([]);
  });

  it('an old backup without meals, meal types, macro goals or dish macros parses with defaults', () => {
    const old = {
      days: { '2026-10-01': legacyDay, '2026-10-02': { ...legacyDay, meals: [] } },
      weights: [],
      measures: [],
      foods: [{ name: 'Борщ', portion: '300 г', kcal: 180, count: 2, lastUsed: '2026-10-01' }],
      settings: { goal: 60, kcalGoal: 1700, rem: defaultSettings().rem, timezone: 'Europe/Kyiv', customTypes: [], onboarded: true },
    };
    const parsed = appDataSchema.parse(old);
    expect(parsed.settings.mealTypes).toEqual([...DEFAULT_MEAL_TYPES]);
    expect(parsed.settings.macroGoals).toEqual(emptyMacroGoals());
    expect(parsed.foods[0]).not.toHaveProperty('protein');
    expect(parsed.days['2026-10-01']).not.toHaveProperty('meals');
  });

  it('normalizeSettings fills meal types and macro goals; an explicit [] stays []', () => {
    expect(normalizeSettings({ goal: 58 })).toMatchObject({ mealTypes: [...DEFAULT_MEAL_TYPES], macroGoals: emptyMacroGoals() });
    expect(normalizeSettings({ mealTypes: [] }).mealTypes).toEqual([]);
    expect(normalizeSettings({ mealTypes: [' Ланч ', 'ланч'] }).mealTypes).toEqual(['Ланч']);
    expect(normalizeSettings({ macroGoals: { protein: 90 } as never }).macroGoals).toEqual({ protein: 90, fat: null, carbs: null });
    expect(normalizeSettings({ macroGoals: 'x' as never, mealTypes: 'x' as never })).toMatchObject({
      macroGoals: emptyMacroGoals(),
      mealTypes: [...DEFAULT_MEAL_TYPES],
    });
    expect(defaultSettings()).toMatchObject({ mealTypes: ['Сніданок', 'Обід', 'Вечеря', 'Перекус'], macroGoals: emptyMacroGoals() });
  });

  it('useFood: the use’s macros win; else the stored ones while kcal is unchanged; else none (D13)', () => {
    const first = useFood([], { name: 'Борщ', portion: '300 г', kcal: 180, protein: 6, fat: 9, carbs: 19 }, '2026-10-09');
    expect(first[0]).toEqual({ name: 'Борщ', portion: '300 г', kcal: 180, count: 1, lastUsed: '2026-10-09', protein: 6, fat: 9, carbs: 19 });
    // An old client (no macros), same kcal: the stored macros stay.
    expect(useFood(first, { name: 'борщ', portion: '300 г', kcal: 180 }, '2026-10-10')[0]).toMatchObject({
      count: 2,
      protein: 6,
      fat: 9,
      carbs: 19,
    });
    // Changed kcal without macros: they no longer describe the dish.
    const changed = useFood(first, { name: 'Борщ', portion: '400 г', kcal: 240 }, '2026-10-10')[0];
    expect(changed).not.toHaveProperty('protein');
    expect(changed).not.toHaveProperty('carbs');
    // Only some macro keys: exactly those.
    const partial = useFood(first, { name: 'Борщ', portion: '300 г', kcal: 180, protein: 7 }, '2026-10-10')[0];
    expect(partial).toMatchObject({ protein: 7 });
    expect(partial).not.toHaveProperty('fat');
  });

  it('food estimate results carry nullable macros', () => {
    const item = { name: 'Борщ', portion: '300 г', kcal: 180, protein: 6, fat: null, carbs: 19.5 };
    expect(foodEstimateResultSchema.safeParse({ items: [item], comment: '' }).success).toBe(true);
    expect(foodEstimateResultSchema.safeParse({ items: [{ ...item, protein: 1001 }], comment: '' }).success).toBe(false);
    expect(foodEstimateResultSchema.safeParse({ items: [{ name: 'x', portion: '', kcal: 1 }], comment: '' }).success).toBe(false);
  });

  it('settingsPutSchema has no defaults, settingsSchema does', () => {
    const { mealTypes: _m, macroGoals: _g, ...old } = defaultSettings();
    expect(settingsPutSchema.parse(old)).not.toHaveProperty('macroGoals');
    expect(settingsSchema.parse(old).macroGoals).toEqual(emptyMacroGoals());
  });
});
