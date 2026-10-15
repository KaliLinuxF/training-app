import {
  DEFAULT_MEAL_TYPES,
  emptyData,
  f0,
  LEGACY_MEAL_ID,
  normalizeDay,
  normalizeMeal,
  opSchema,
  type AppData,
  type FoodEstimateResponse,
  type Meal,
} from '@legko/shared';
import { describe, expect, it, vi } from 'vitest';
import type { EstimateAction } from '../estimate';
import {
  addCustomMealType,
  buildMeal,
  contextPhoto,
  dayBudget,
  dishAction,
  hasMealContent,
  initMealDraft,
  LEGACY_HINT,
  manualToPosition,
  MEAL_HINTS,
  mealChips,
  mealDraftDirty,
  mealReducer,
  mealUses,
  OTHER_POSITION,
  pendingTail,
  photoCapacity,
  retargetMealDraft,
  TYPES_CAP_NOTE,
  validateMeal,
  type MealAction,
  type MealDraft,
} from './mealModel';

vi.mock('@/store/data', () => ({ newMealId: () => 'mockMealId01' }));

const TODAY = '2026-10-14';
const YESTERDAY = '2026-10-13';
const NO_MACROS = { protein: null, fat: null, carbs: null };
const photo = (n: number): string => `photo${String(n).padStart(12, '0')}`;

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: null,
  text: `${type} ${id}`.trim(),
  kcal,
  ...NO_MACROS,
  ...extra,
});

/** Data with `meals` logged on `date` (normalised, as the store has them). */
function dataWith(meals: Meal[], date = TODAY, patch: Partial<AppData['settings']> = {}): AppData {
  const data = emptyData();
  data.settings = { ...data.settings, ...patch };
  if (meals.length)
    data.days[date] = normalizeDay({ food: '', kcal: null, trained: null, types: [], notes: '', meals });
  return data;
}

let seq = 0;
const newId = () => `newMeal${String(++seq).padStart(5, '0')}`;

/** A new meal for `date` at 10:00 today. */
const fresh = (data: AppData = emptyData(), date = TODAY): MealDraft =>
  initMealDraft(data, { date, mealId: null, key: 1 }, '10:00', TODAY, newId);

const open = (data: AppData, mealId: string, date = TODAY): MealDraft =>
  initMealDraft(data, { date, mealId, key: 1 }, '10:00', TODAY, newId);

const run = (d: MealDraft, ...actions: MealAction[]): MealDraft => actions.reduce(mealReducer, d);
const est = (action: EstimateAction, capacity?: number): MealAction => ({
  type: 'estimate',
  action,
  capacity,
});

const TOAST: FoodEstimateResponse = {
  photoId: null,
  items: [
    { name: 'Тост з тунцем', portion: '2 шт', kcal: 310, protein: 24, fat: 8, carbs: 31 },
    { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: null, carbs: 5 },
  ],
  totalKcal: 370,
  comment: '',
};

/** The draft after a text estimate (request `id`) of its text. */
const estimated = (
  d: MealDraft,
  id = 1,
  res: FoodEstimateResponse = TOAST,
  photoEstimate = false,
  capacity?: number,
) =>
  run(
    d,
    est({ type: 'start', id, photo: photoEstimate, counts: photoEstimate ? null : d.text }),
    est({ type: 'resolve', id, res }, capacity),
  );

describe('opening the editor', () => {
  it('a new meal today at 10:00 is «Сніданок», timed now; on a past day the first type not logged, no time', () => {
    const d = fresh();
    expect(d).toMatchObject({
      id: expect.stringMatching(/^newMeal/),
      isNew: true,
      legacy: false,
      type: 'Сніданок',
    });
    expect(d.time).toBe('10:00');
    expect(d.positions.drafts).toEqual([]);
    const past = fresh(dataWith([meal('b', 'Сніданок', 300)], YESTERDAY), YESTERDAY);
    expect(past).toMatchObject({ type: 'Обід', time: null });
    // Her own list: what the time of day suggests in it.
    const own = fresh(dataWith([], TODAY, { mealTypes: ['Ранок', 'Ланч', 'Після тренування'] }));
    expect(own.type).toBe('Ранок');
    // No types at all: an untyped meal.
    expect(fresh(dataWith([], TODAY, { mealTypes: [] })).type).toBe('');
  });

  it('the store’s new id when none is injected', () => {
    expect(initMealDraft(emptyData(), { date: TODAY, mealId: null, key: 1 }, '10:00', TODAY).id).toBe(
      'mockMealId01',
    );
  });

  it('an existing meal: its values; its items become the positions and count its text', () => {
    const breakfast = meal('b1', 'Сніданок', null, {
      time: '08:15',
      text: 'Тост з тунцем, кава',
      photos: [photo(1)],
      items: TOAST.items.map((i) => ({ ...i })),
    });
    const d = open(dataWith([breakfast]), 'b1');
    expect(d).toMatchObject({ id: 'b1', isNew: false, type: 'Сніданок', time: '08:15', photos: [photo(1)] });
    expect(d.positions.drafts.map((r) => [r.name, r.kcalText, r.proteinText])).toEqual([
      ['Тост з тунцем', '310', '24'],
      ['Кава з молоком', '60', '3'],
    ]);
    expect(d.kcalText).toBe('');
    expect(d.estimatedText).toBe('Тост з тунцем, кава');
    expect(pendingTail(d)).toBe('');
    expect(mealDraftDirty(d)).toBe(false);
  });

  it('a meal with typed numbers opens them, the macro inputs open when one is typed', () => {
    const d = open(dataWith([meal('s1', 'Перекус', 80, { protein: 0.5 })]), 's1');
    expect(d).toMatchObject({
      kcalText: '80',
      macroTexts: { protein: '0,5', fat: '', carbs: '' },
      macrosOpen: true,
    });
    expect(open(dataWith([meal('s2', 'Перекус', 80)]), 's2').macrosOpen).toBe(false);
  });

  it('the legacy block «Їжа за день»: untyped, flagged for the hint; an unknown id is a new meal', () => {
    const data = emptyData();
    data.days[TODAY] = { food: 'Борщ, хліб', kcal: 500, trained: null, types: [], notes: '' };
    const d = open(data, LEGACY_MEAL_ID);
    expect(d).toMatchObject({
      id: LEGACY_MEAL_ID,
      isNew: false,
      legacy: true,
      type: '',
      text: 'Борщ, хліб',
      kcalText: '500',
    });
    expect(LEGACY_HINT).toBe('Це запис зі старої версії. Обери тип — і він стане окремим прийомом їжі.');
    expect(open(data, 'gone-meal').isNew).toBe(true);
    // An old client's extra meal reads the same way; a typed one does not.
    expect(open(dataWith([meal('old-abc', '', 100)]), 'old-abc').legacy).toBe(true);
    expect(open(dataWith([meal('old-abc', 'Обід', 100)]), 'old-abc').legacy).toBe(false);
  });
});

describe('type', () => {
  it('chips are her types plus the meal’s own label when it is not in her list (any case)', () => {
    const settings = { mealTypes: ['Сніданок', 'Обід'] };
    const renamed = open(dataWith([meal('m', 'Полуденок', 100)], TODAY, settings), 'm');
    expect(mealChips(settings.mealTypes, renamed)).toEqual(['Сніданок', 'Обід', 'Полуденок']);
    const sameName = open(dataWith([meal('m', 'обід', 100)], TODAY, settings), 'm');
    expect(mealChips(settings.mealTypes, sameName)).toEqual(['Сніданок', 'Обід']);
    expect(mealChips(settings.mealTypes, fresh())).toEqual(['Сніданок', 'Обід']);
  });

  it('the meal’s own label stays a chip after she taps another one (renamed since), and brings back a clean draft', () => {
    const settings = { mealTypes: ['Ранок', 'Обід'] };
    const d = open(dataWith([meal('m', 'Сніданок', 300)], TODAY, settings), 'm');
    expect(mealChips(settings.mealTypes, d)).toEqual(['Ранок', 'Обід', 'Сніданок']);
    const lunch = run(d, { type: 'type', value: 'Обід' });
    expect(lunch.type).toBe('Обід');
    expect(mealChips(settings.mealTypes, lunch)).toEqual(['Ранок', 'Обід', 'Сніданок']);
    expect(mealDraftDirty(lunch)).toBe(true);
    const back = run(lunch, { type: 'type', value: 'Сніданок' });
    expect(mealDraftDirty(back)).toBe(false);
    expect(mealChips(settings.mealTypes, back)).toEqual(['Ранок', 'Обід', 'Сніданок']);
  });

  it('a name for this meal only (12 types) stays a chip after another chip is tapped', () => {
    const types = Array.from({ length: 12 }, (_, i) => `Тип ${i + 1}`);
    const d = fresh(dataWith([], TODAY, { mealTypes: types }));
    const added = addCustomMealType('Пізній', types);
    expect(added).toMatchObject({ name: 'Пізній', mealTypes: null });
    const late = run(d, { type: 'type', value: 'Пізній' });
    const other = run(late, { type: 'type', value: 'Тип 3' }, { type: 'type', value: 'Тип 5' });
    expect(mealChips(types, other)).toEqual([...types, 'Пізній']);
    // Any case: one chip per name.
    expect(mealChips(types, run(other, { type: 'type', value: 'пізній' }))).toEqual([...types, 'Пізній']);
  });

  it('tapping the selected chip again keeps it (no silent untyped meal); another one changes it', () => {
    const d = fresh();
    expect(run(d, { type: 'type', value: 'Сніданок' })).toBe(d);
    expect(run(d, { type: 'type', value: 'Перекус' })).toMatchObject({ type: 'Перекус', typeTouched: true });
  });

  it('«+ Свій»: added to her list (≤ 12, ≤ 30 chars); a spelling she has wins; at 12 for this meal only', () => {
    expect(addCustomMealType('  Після   тренування ', DEFAULT_MEAL_TYPES)).toEqual({
      name: 'Після тренування',
      mealTypes: [...DEFAULT_MEAL_TYPES, 'Після тренування'],
    });
    expect(addCustomMealType('ОБІД', DEFAULT_MEAL_TYPES)).toEqual({ name: 'Обід', mealTypes: null });
    expect(addCustomMealType('я'.repeat(40), [])?.name).toHaveLength(30);
    expect(addCustomMealType('   ', DEFAULT_MEAL_TYPES)).toBeNull();
    const twelve = Array.from({ length: 12 }, (_, i) => `Тип ${i + 1}`);
    expect(addCustomMealType('Після тренування', twelve)).toEqual({
      name: 'Після тренування',
      mealTypes: null,
      note: TYPES_CAP_NOTE,
    });
    expect(TYPES_CAP_NOTE).toBe('У списку вже 12 типів — ця назва лише для цього прийому');
  });
});

describe('validation', () => {
  it('needs content: text, a photo, kcal, a macro or a position', () => {
    expect(validateMeal(emptyData(), TODAY, fresh()).hint).toBe('Опиши, що їла, або додай калорії чи фото');
    expect(MEAL_HINTS.content).toBe('Опиши, що їла, або додай калорії чи фото');
    for (const action of [
      { type: 'text', value: 'кава' },
      { type: 'kcal', value: '0' },
      { type: 'macro', key: 'carbs', value: '5' },
    ] as MealAction[]) {
      const d = run(fresh(), action);
      expect(hasMealContent(d)).toBe(true);
      expect(validateMeal(emptyData(), TODAY, d)).toEqual({});
    }
    // A type alone is no meal.
    expect(hasMealContent(run(fresh(), { type: 'type', value: 'Обід' }))).toBe(false);
    expect(hasMealContent(run(fresh(), { type: 'text', value: '   ' }))).toBe(false);
  });

  it('the limits: kcal 20 000, grams 3 000 (inline and as the reason)', () => {
    const kcal = validateMeal(emptyData(), TODAY, run(fresh(), { type: 'kcal', value: '25000' }));
    expect(kcal).toEqual({
      hint: 'Калорії — не більше 20 000 ккал',
      kcal: 'Калорії — не більше 20 000 ккал',
    });
    const macro = validateMeal(
      emptyData(),
      TODAY,
      run(fresh(), { type: 'macro', key: 'fat', value: '3500' }),
    );
    expect(macro).toEqual({ hint: 'Не більше 3 000 г', macro: 'Не більше 3 000 г' });
    expect(
      validateMeal(emptyData(), TODAY, run(fresh(), { type: 'macro', key: 'fat', value: '3000' })),
    ).toEqual({});
  });

  it('a NEW meal on a day with 20 already: «Не більше 20 прийомів на день»; editing one of them is fine', () => {
    const twenty = dataWith(Array.from({ length: 20 }, (_, i) => meal(`m${i}`, 'Перекус', 10)));
    expect(validateMeal(twenty, TODAY, run(fresh(twenty), { type: 'text', value: 'яблуко' })).hint).toBe(
      'Не більше 20 прийомів на день',
    );
    expect(
      validateMeal(twenty, TODAY, run(open(twenty, 'm3'), { type: 'text', value: 'груша' })).hint,
    ).toBeUndefined();
  });

  it('photos past the day’s 12 (the other meals’ count) and a running request block «Зберегти»', () => {
    const many = Array.from({ length: 11 }, (_, i) => photo(i));
    const data = dataWith([meal('lunch', 'Обід', 500, { photos: many })]);
    const d = fresh(data);
    expect(photoCapacity(data, TODAY, d)).toBe(1);
    const two = { ...run(d, { type: 'text', value: 'салат' }), photos: [photo(50), photo(51)] };
    expect(validateMeal(data, TODAY, two).hint).toBe('Не більше 12 фото на день');
    // The meal's own photos are its own (an existing meal is left out of «the others»).
    expect(photoCapacity(data, TODAY, open(data, 'lunch'))).toBe(12);
    const busy = run(
      fresh(),
      { type: 'text', value: 'борщ' },
      est({ type: 'start', id: 1, photo: false, counts: 'борщ' }),
    );
    expect(validateMeal(emptyData(), TODAY, busy).hint).toBe('Рахую калорії…');
  });
});

describe('the saved meal', () => {
  it('with positions: their items and sums', () => {
    const d = estimated(run(fresh(), { type: 'text', value: ' Тост з тунцем, кава ' }));
    const m = buildMeal(d);
    expect(m).toEqual({
      id: d.id,
      type: 'Сніданок',
      time: '10:00',
      text: 'Тост з тунцем, кава',
      kcal: 370,
      protein: 27,
      fat: 8,
      carbs: 36,
      items: TOAST.items,
    });
    expect(normalizeMeal(m)).toEqual(m);
    expect(opSchema.safeParse({ kind: 'meal.put', date: TODAY, value: m }).success).toBe(true);
  });

  it('without positions: her numbers (0.5 g, up to 3 000 g); photos only when there are some', () => {
    const d = run(
      fresh(),
      { type: 'type', value: 'Перекус' },
      { type: 'time', value: null },
      { type: 'kcal', value: '120' },
      { type: 'macro', key: 'protein', value: '4,3' },
    );
    const m = buildMeal({ ...d, photos: [photo(1)] });
    expect(m).toEqual({
      id: d.id,
      type: 'Перекус',
      time: null,
      text: '',
      kcal: 120,
      protein: 4.5,
      fat: null,
      carbs: null,
      photos: [photo(1)],
    });
    expect(normalizeMeal(m)).toEqual(m);
    expect(buildMeal(run(fresh(), { type: 'text', value: 'кава' }))).not.toHaveProperty('photos');
    expect(buildMeal(run(fresh(), { type: 'text', value: 'кава' })).kcal).toBeNull();
  });

  it('records «Часті страви» only for positions added in this session, with only the known macros', () => {
    const breakfast = meal('b1', 'Сніданок', null, { items: [TOAST.items[0]!] });
    const d = estimated(open(dataWith([breakfast]), 'b1'), 1, {
      ...TOAST,
      items: [{ name: 'Яйце', portion: '1 шт', kcal: 70, protein: 6, fat: null, carbs: 0.5 }],
    });
    const uses = mealUses(run(d, dishAction('d1', { name: 'Кава', portion: '', kcal: 5, ...NO_MACROS })));
    expect(uses).toEqual([
      { name: 'Яйце', portion: '1 шт', kcal: 70, protein: 6, carbs: 0.5 },
      { name: 'Кава', portion: '', kcal: 5 },
    ]);
    expect(uses[0]).not.toHaveProperty('fat');
    for (const value of uses)
      expect(opSchema.safeParse({ kind: 'food.use', date: TODAY, value }).success).toBe(true);
  });
});

describe('positions', () => {
  it('a text estimate appends its rows and counts the text; the pending tail is what came after it', () => {
    const d = estimated(run(fresh(), { type: 'text', value: 'тост з тунцем' }));
    expect(d.estimatedText).toBe('тост з тунцем');
    expect(pendingTail(d)).toBe('');
    const more = run(d, { type: 'text', value: 'тост з тунцем, яблуко;\nкава' });
    expect(pendingTail(more)).toBe('яблуко, кава');
    // She changed the counted part: nothing reads as «not counted» any more.
    expect(pendingTail(run(d, { type: 'text', value: 'тост з сиром, яблуко' }))).toBe('');
    // Without positions there is nothing to compare with.
    expect(pendingTail(run(fresh(), { type: 'text', value: 'яблуко' }))).toBe('');
  });

  it('a photo estimate attaches its photo while the day has room; «Прибрати ці позиції» takes both back', () => {
    const res = { ...TOAST, photoId: photo(7) };
    const d = estimated(run(fresh(), { type: 'text', value: 'тост' }), 1, res, true, 12);
    expect(d.photos).toEqual([photo(7)]);
    expect(d.positions.undo).toEqual({ estimateId: 'e1', photoId: photo(7) });
    expect(contextPhoto(d)).toBe(photo(7));
    const undone = run(d, est({ type: 'undo' }));
    expect(undone.photos).toEqual([]);
    expect(undone.positions.drafts).toEqual([]);
    // No room: the rows come, the photo does not (and is not taken back with them).
    const full = estimated(fresh(), 2, res, true, 0);
    expect(full.photos).toEqual([]);
    expect(full.positions.undo).toEqual({ estimateId: 'e2', photoId: null });
    expect(full.positions.drafts).toHaveLength(2);
  });

  it('a photo removed from the strip is not taken back again; a photo gone from the server leaves the meal', () => {
    const res = { ...TOAST, photoId: photo(7) };
    const d = estimated(fresh(), 1, res, true, 12);
    const removed = run(d, { type: 'removePhoto', id: photo(7) });
    expect(removed.photos).toEqual([]);
    expect(removed.positions.undo?.photoId).toBeNull();
    const renamed = run(d, est({ type: 'edit', itemId: 'e1.0', field: 'name', value: 'Тост з сиром' }));
    const pending = run(renamed, est({ type: 'recalcStart', id: 5 }));
    const gone = run(pending, est({ type: 'photoGone', id: 5, photoId: photo(7) }));
    expect(gone.photos).toEqual([]);
    expect(contextPhoto(gone)).toBeNull();
    // The meal's last photo is the context when nothing was estimated in this session.
    expect(contextPhoto({ ...fresh(), photos: [photo(1), photo(2)] })).toBe(photo(2));
  });

  it('the first position on a meal she priced by hand turns her numbers into «Інше» (nothing lost)', () => {
    const typed = run(
      fresh(),
      { type: 'text', value: 'тост' },
      { type: 'kcal', value: '300' },
      { type: 'macro', key: 'protein', value: '20' },
    );
    expect(manualToPosition(typed)).toMatchObject({
      name: OTHER_POSITION,
      kcalText: '300',
      proteinText: '20',
      pinned: true,
      macrosPinned: true,
      base: null,
    });
    const d = run(
      typed,
      dishAction('d1', { name: 'Кава', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 }),
    );
    expect(d.positions.drafts.map((r) => [r.name, r.kcalText])).toEqual([
      ['Інше', '300'],
      ['Кава', '60'],
    ]);
    expect(d).toMatchObject({
      kcalText: '',
      macroTexts: { protein: '', fat: '', carbs: '' },
      estimatedText: 'тост',
    });
    expect(buildMeal(d)).toMatchObject({ kcal: 360, protein: 23 });
    // «Інше» is not a dish to remember.
    expect(mealUses(d).map((u) => u.name)).toEqual(['Кава']);
    // A photo estimated without her text adds food on top of what she priced, too.
    expect(estimated(typed, 1, TOAST, true).positions.drafts.map((r) => r.name)).toEqual([
      'Інше',
      'Тост з тунцем',
      'Кава з молоком',
    ]);
    // Nothing typed, nothing to convert.
    expect(manualToPosition(fresh())).toBeNull();
    expect(estimated(run(fresh(), { type: 'text', value: 'тост' })).positions.drafts).toHaveLength(2);
  });

  it('an estimate of the text her own numbers were for REPLACES them (no double count); undo puts them back', () => {
    const typed = run(
      fresh(),
      { type: 'text', value: 'тост' },
      { type: 'kcal', value: '300' },
      { type: 'openMacros' },
      { type: 'macro', key: 'protein', value: '20' },
    );
    const d = estimated(typed);
    expect(d.positions.drafts.map((r) => r.name)).toEqual(['Тост з тунцем', 'Кава з молоком']);
    expect(d).toMatchObject({
      kcalText: '',
      macroTexts: { protein: '', fat: '', carbs: '' },
      macrosOpen: false,
    });
    const estimate = TOAST.items.reduce((sum, i) => sum + i.kcal, 0);
    expect(buildMeal(d).kcal).toBe(estimate);
    expect(dayBudget(emptyData(), TODAY, d)?.text).toBe(`За день: ${f0(estimate)} / ${f0(1700)} ккал`);
    // «Прибрати ці позиції»: her numbers again, as she typed them.
    const undone = run(d, est({ type: 'undo' }));
    expect(undone.positions.drafts).toEqual([]);
    expect(undone).toMatchObject({ kcalText: '300', macroTexts: { protein: '20' }, macrosOpen: true });
    expect(buildMeal(undone)).toMatchObject({ kcal: 300, protein: 20 });
    // A photo with her text as the hint prices the same food: replaced as well.
    const photoed = run(
      typed,
      est({ type: 'start', id: 2, photo: true, counts: 'тост' }),
      est({ type: 'resolve', id: 2, res: { ...TOAST, photoId: photo(3) } }, 12),
    );
    expect(photoed.positions.drafts.map((r) => r.name)).toEqual(['Тост з тунцем', 'Кава з молоком']);
    expect(photoed.photos).toEqual([photo(3)]);
    const back = run(photoed, est({ type: 'undo' }));
    expect(back).toMatchObject({ kcalText: '300', photos: [] });
    // Nothing found: her numbers stay where they are.
    const none = estimated(typed, 3, { ...TOAST, items: [], totalKcal: 0 });
    expect(none).toMatchObject({ kcalText: '300', macroTexts: { protein: '20' } });
    expect(none.positions.drafts).toEqual([]);
  });

  it('a dish added after such an estimate stays on undo, and her numbers come back as «Інше» next to it', () => {
    const typed = run(fresh(), { type: 'text', value: 'тост' }, { type: 'kcal', value: '300' });
    const d = run(
      estimated(typed),
      dishAction('d1', { name: 'Кава', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 }),
    );
    const undone = run(d, est({ type: 'undo' }));
    expect(undone.positions.drafts.map((r) => [r.name, r.kcalText])).toEqual([
      ['Інше', '300'],
      ['Кава', '60'],
    ]);
    expect(buildMeal(undone).kcal).toBe(360);
    expect(undone.kcalText).toBe('');
  });

  it('an old «Їжа за день» block with kcal, estimated for Б · Ж · В: the day counts the estimate, not both', () => {
    const data = emptyData();
    data.days[TODAY] = {
      food: 'вівсянка, борщ, салат',
      kcal: 1880,
      trained: null,
      types: [],
      notes: '',
    };
    const legacy = open(data, LEGACY_MEAL_ID);
    expect(legacy.kcalText).toBe('1880');
    const d = estimated(legacy);
    expect(d.positions.drafts.map((r) => r.name)).toEqual(['Тост з тунцем', 'Кава з молоком']);
    const estimate = TOAST.items.reduce((sum, i) => sum + i.kcal, 0);
    expect(buildMeal(d)).toMatchObject({ kcal: estimate, items: expect.any(Array) });
    expect(dayBudget(data, TODAY, d)?.text).toBe(`За день: ${f0(estimate)} / ${f0(1700)} ккал`);
    // Taken back: the block as it was, nothing to save.
    const undone = run(d, est({ type: 'undo' }));
    expect(undone.kcalText).toBe('1880');
    expect(mealDraftDirty(undone)).toBe(false);
  });

  it('the composer opens with the pending tail and closes once an estimate is in', () => {
    const d = run(estimated(run(fresh(), { type: 'text', value: 'тост' })), {
      type: 'text',
      value: 'тост, кава',
    });
    const opened = run(d, { type: 'composer', open: true });
    expect(opened.composer).toEqual({ open: true, text: 'кава', prefill: 'кава' });
    expect(mealDraftDirty(run(opened, { type: 'composerText', text: 'кава і цукор' }))).toBe(true);
    const done = estimated(opened, 2);
    expect(done.composer.open).toBe(false);
  });
});

describe('dirty', () => {
  it('a new meal: once it has content (a suggested type and time alone are not worth asking)', () => {
    expect(mealDraftDirty(fresh())).toBe(false);
    expect(
      mealDraftDirty(run(fresh(), { type: 'type', value: 'Обід' }, { type: 'time', value: '12:00' })),
    ).toBe(false);
    expect(mealDraftDirty(run(fresh(), { type: 'text', value: 'борщ' }))).toBe(true);
    expect(mealDraftDirty(run(fresh(), { type: 'text', value: 'борщ' }, { type: 'text', value: '' }))).toBe(
      false,
    );
  });

  it('an existing meal: any change; a request in flight; the item editor with changes', () => {
    const data = dataWith([meal('m1', 'Обід', 500, { time: '13:00' })]);
    const d = open(data, 'm1');
    expect(mealDraftDirty(d)).toBe(false);
    expect(mealDraftDirty(run(d, { type: 'type', value: 'Вечеря' }))).toBe(true);
    expect(mealDraftDirty(run(d, { type: 'time', value: null }))).toBe(true);
    expect(mealDraftDirty(run(d, { type: 'kcal', value: '450' }))).toBe(true);
    expect(mealDraftDirty(run(d, est({ type: 'start', id: 1, photo: false, counts: null })))).toBe(true);
    const withRows = estimated(fresh(), 1);
    const editing = run(
      withRows,
      est({ type: 'openItem', itemId: 'e1.0' }),
      est({ type: 'editor', action: { type: 'name', value: 'Тост' } }),
    );
    expect(
      mealDraftDirty({
        ...editing,
        isNew: false,
        initial: { ...editing.initial, drafts: editing.positions.drafts },
      }),
    ).toBe(true);
  });
});

describe('the day', () => {
  it('«За день»: the other meals plus this draft against her goal; hidden at 0', () => {
    const data = dataWith([meal('lunch', 'Обід', 900), meal('snack', 'Перекус', null)]);
    expect(dayBudget(emptyData(), TODAY, fresh())).toBeNull();
    const d = run(fresh(data), { type: 'kcal', value: '340' });
    expect(dayBudget(data, TODAY, d)).toEqual({
      text: `За день: ${f0(1240)} / ${f0(1700)} ккал`,
      over: false,
    });
    // Editing the lunch: its stored kcal are replaced by the draft's.
    const lunch = run(open(data, 'lunch'), { type: 'kcal', value: '1000' });
    expect(dayBudget(data, TODAY, lunch)?.text).toBe(`За день: ${f0(1000)} / ${f0(1700)} ккал`);
    const over = run(fresh(data), { type: 'kcal', value: '900' });
    expect(dayBudget(data, TODAY, over)).toEqual({
      text: `За день: ${f0(1800)} / ${f0(1700)} ккал`,
      over: true,
    });
  });

  it('moved to another day: content kept, type and time suggested again unless she set them', () => {
    const d = run(fresh(), { type: 'text', value: 'борщ' }, { type: 'kcal', value: '200' });
    const yesterday = dataWith([meal('b', 'Сніданок', 300)], YESTERDAY);
    const moved = retargetMealDraft(d, yesterday, YESTERDAY, '10:00', TODAY);
    expect(moved).toMatchObject({ text: 'борщ', kcalText: '200', id: d.id, type: 'Обід', time: null });
    const back = retargetMealDraft(moved, emptyData(), TODAY, '10:05', TODAY);
    expect(back).toMatchObject({ type: 'Сніданок', time: '10:05' });
    const touched = run(d, { type: 'type', value: 'Перекус' }, { type: 'time', value: '09:00' });
    expect(retargetMealDraft(touched, yesterday, YESTERDAY, '10:00', TODAY)).toMatchObject({
      type: 'Перекус',
      time: '09:00',
    });
    // An existing meal does not move.
    const data = dataWith([meal('m1', 'Обід', 500)]);
    const existing = open(data, 'm1');
    expect(retargetMealDraft(existing, data, YESTERDAY, '10:00', TODAY)).toBe(existing);
  });
});
