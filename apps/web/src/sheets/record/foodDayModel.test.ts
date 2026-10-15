import { emptyData, normalizeDay, type AppData, type DayEntry, type Meal } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  ADD_MEAL_LABEL,
  ADD_MEAL_TEXT,
  EMPTY_DAY_TEXT,
  EMPTY_FIELD_TEXT,
  foodDayModel,
  LEGACY_NOTE,
  MEALS_CAP_NOTE,
  MEALS_REGION,
  mealRow,
  mealRowLabel,
  PARTIAL_NOTE,
} from './foodDayModel';

const DATE = '2026-10-14';
/** U+00A0, as `lib/nutrition` and `f0` put it. */
const NB = String.fromCharCode(0xa0);
/** Text with every kind of space as a plain one (the model keeps no-break spaces). */
const flat = (s: string | null | undefined): string | null | undefined => s?.replace(/\s/g, ' ');

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: null,
  text: '',
  kcal,
  protein: null,
  fat: null,
  carbs: null,
  ...extra,
});

const TOAST = meal('m1', 'Сніданок', 420, {
  time: '08:30',
  text: 'Тост з тунцем, кава',
  protein: 27,
  fat: 11,
  carbs: 36,
});
const SOUP = meal('m2', 'Обід', 560, {
  time: '13:10',
  text: 'Борщ\nхліб житній',
  protein: 21,
  fat: 19,
  carbs: 64,
});
const APPLE = meal('m3', 'Перекус', null, { text: 'Яблуко' });

function withDay(day: Partial<DayEntry> | null, patch: (d: AppData) => void = () => undefined): AppData {
  const data = emptyData();
  if (day)
    data.days[DATE] = normalizeDay({ food: '', kcal: null, trained: null, types: [], notes: '', ...day });
  patch(data);
  return data;
}

describe('meal rows', () => {
  it('title, time, one-line content, macros, value and the spoken name', () => {
    expect(mealRow(TOAST)).toEqual({
      id: 'm1',
      title: 'Сніданок',
      time: '08:30',
      content: 'Тост з тунцем, кава',
      macros: `Б${NB}27${NB}· Ж${NB}11${NB}· В${NB}36${NB}г`,
      value: `420${NB}ккал`,
      hasKcal: true,
      label: `Сніданок о 08:30: тост з тунцем, кава. 420${NB}ккал, білки 27, жири 11, вуглеводи 36 г`,
      photos: [],
    });
    // Lines of the text are joined on one line.
    expect(mealRow(SOUP).content).toBe('Борщ, хліб житній');
  });

  it('leaves out what she did not record: «—» for no kcal, no macro line, no time', () => {
    const row = mealRow(APPLE);
    expect(row.value).toBe('—');
    expect(row.hasKcal).toBe(false);
    expect(row.macros).toBeNull();
    expect(row.time).toBeNull();
    expect(row.label).toBe('Перекус: яблуко');
    expect(mealRowLabel(meal('x', 'Вечеря', null, { protein: 12 }))).toBe('Вечеря. Білки 12 г');
    expect(flat(mealRowLabel(meal('x', 'Вечеря', 1240, { time: '19:00' })))).toBe(
      'Вечеря о 19:00. 1 240 ккал',
    );
    // Only the known macros, the unit once at the end.
    expect(mealRowLabel(meal('x', 'Обід', null, { text: 'Суп', protein: 10, carbs: 30 }))).toBe(
      'Обід: суп. Білки 10, вуглеводи 30 г',
    );
  });

  it('an acronym keeps its case in the spoken name', () => {
    expect(mealRowLabel(meal('x', 'Обід', null, { text: 'ШБ-бургер' }))).toBe('Обід: ШБ-бургер');
  });

  it('a meal of positions only reads their names; photos come along', () => {
    const row = mealRow(
      meal('m4', 'Вечеря', 380, {
        items: [
          { name: 'Курка з рисом', portion: '350 г', kcal: 320, protein: 30, fat: 8, carbs: 40 },
          { name: 'Чай', portion: '1 чашка', kcal: 60, protein: 0, fat: 0, carbs: 15 },
        ],
        photos: ['photo_aaaaaaaaaaaaaaaa'],
      }),
    );
    expect(row.content).toBe('Курка з рисом, Чай');
    expect(row.photos).toEqual(['photo_aaaaaaaaaaaaaaaa']);
  });

  it('untyped blocks: «Їжа за день» for the old version, «Прийом їжі» otherwise', () => {
    expect(mealRow(meal('legacy', '', 1880, { text: 'Омлет' })).title).toBe('Їжа за день');
    expect(mealRow(meal('old-abc', '', null, { text: 'Салат' })).title).toBe('Їжа за день');
    expect(mealRow(meal('n1', '', null, { text: 'Салат' })).title).toBe('Прийом їжі');
  });
});

describe('foodDayModel', () => {
  it('a day with meals: rows in time order, totals against the goals, the one-line total', () => {
    const data = withDay({ meals: [SOUP, TOAST] }, (d) => {
      d.settings.macroGoals = { protein: 90, fat: 30, carbs: null };
    });
    const m = foodDayModel(data, DATE);
    expect(m.rows.map((r) => r.title)).toEqual(['Сніданок', 'Обід']);
    expect(m.legacyNote).toBeNull();
    expect(m.canAdd).toBe(true);

    expect(m.totals.kcal).toMatchObject({
      value: `980`,
      goal: ` / 1${NB}700${NB}ккал`,
      state: 'ok',
      tone: 'ink',
      speech: `980 з 1${NB}700 ккал`,
    });
    expect(flat(m.totals.kcal.text)).toBe('Залишилось 720 з 1 700 ккал');
    expect(m.totals.kcal.pct).toBeCloseTo((980 / 1700) * 100, 5);

    expect(m.totals.macros).toEqual([
      {
        key: 'protein',
        name: 'Білки',
        value: '48 / 90 г',
        speech: '48 з 90 г',
        state: 'ok',
        tone: 'ink',
        hasGoal: true,
        pct: (48 / 90) * 100,
      },
      {
        key: 'fat',
        name: 'Жири',
        value: '30 / 30 г',
        speech: '30 з 30 г',
        state: 'reached',
        tone: 'acc2',
        hasGoal: true,
        pct: 100,
      },
      {
        key: 'carbs',
        name: 'Вуглеводи',
        value: '100 г',
        speech: '100 г',
        state: 'none',
        tone: 'ink',
        hasGoal: false,
        pct: 0,
      },
    ]);
    expect(m.totals.partialNote).toBeNull();

    expect(m.totalLine).toBe(
      `Разом${NB}980${NB}/${NB}1${NB}700${NB}ккал${NB}· Б${NB}48${NB}· Ж${NB}30${NB}· В${NB}100${NB}г`,
    );
    // The only ordinary spaces follow a «·»: the line can wrap there and nowhere else.
    expect(
      m.totalLine?.split(' ').every((part, i) => i === 0 || m.totalLine?.split(' ')[i - 1]?.endsWith('·')),
    ).toBe(true);
  });

  it('over a goal: lavender (acc) for kcal and macros, never red; the speech says so', () => {
    const data = withDay({ meals: [meal('a', 'Обід', 1900, { protein: 96 })] }, (d) => {
      d.settings.macroGoals = { protein: 90, fat: null, carbs: null };
    });
    const m = foodDayModel(data, DATE);
    expect(m.totals.kcal).toMatchObject({ state: 'over', tone: 'acc', pct: 100 });
    expect(m.totals.macros?.[0]).toMatchObject({
      value: '96 / 90 г',
      speech: '96 з 90 г, більше цілі',
      state: 'over',
      tone: 'acc',
      pct: 100,
    });
    expect(m.totals.macros?.[1]).toMatchObject({ value: '—', speech: 'ще не пораховано', hasGoal: false });
  });

  it('a partial sum (a meal with energy lacks macros) gets the note', () => {
    const m = foodDayModel(withDay({ meals: [TOAST, meal('b', 'Перекус', 80, { text: 'Яблуко' })] }), DATE);
    expect(m.totals.macros?.map((x) => x.value)).toEqual(['27 г', '11 г', '36 г']);
    expect(m.totals.partialNote).toBe(PARTIAL_NOTE);
    expect(PARTIAL_NOTE).toBe('Б · Ж · В пораховано не для всіх прийомів');
  });

  it('no macro known and no goal: no macro block; a goal alone shows it with «— / 90 г»', () => {
    expect(foodDayModel(withDay({ meals: [APPLE] }), DATE).totals.macros).toBeNull();
    const goal = foodDayModel(
      withDay({ meals: [APPLE] }, (d) => {
        d.settings.macroGoals = { protein: 90, fat: null, carbs: null };
      }),
      DATE,
    );
    expect(goal.totals.macros?.map((x) => x.value)).toEqual(['— / 90 г', '—', '—']);
    expect(goal.totals.macros?.[0]).toMatchObject({ speech: 'ще не пораховано, ціль 90 г', state: 'empty' });
    expect(goal.totals.partialNote).toBeNull();
  });

  it('an empty day: no rows, «— / 1 700 ккал», the goal line, no total line', () => {
    const m = foodDayModel(withDay(null), DATE);
    expect(m.rows).toEqual([]);
    expect(m.totals.kcal).toMatchObject({ value: '—', speech: null, state: 'empty', pct: 0, tone: 'ink' });
    expect(flat(m.totals.kcal.text)).toBe('Ціль — 1 700 ккал на день');
    expect(m.totals.macros).toBeNull();
    expect(m.totalLine).toBeNull();
    expect(m.canAdd).toBe(true);
    // A day with only a workout mark has no food either.
    expect(foodDayModel(withDay({ trained: true }), DATE).rows).toEqual([]);
  });

  it('a legacy day: one block «Їжа за день» with the note', () => {
    const m = foodDayModel(withDay({ food: 'Вівсянка з бананом, кава', kcal: 1880 }), DATE);
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0]).toMatchObject({
      id: 'legacy',
      title: 'Їжа за день',
      content: 'Вівсянка з бананом, кава',
    });
    expect(flat(m.rows[0]?.value)).toBe('1 880 ккал');
    expect(flat(m.rows[0]?.label)).toBe('Їжа за день: вівсянка з бананом, кава. 1 880 ккал');
    expect(m.legacyNote).toBe(LEGACY_NOTE);
    expect(LEGACY_NOTE).toBe('Запис зі старої версії — відкрий його, щоб обрати тип прийому.');
    expect(flat(m.totalLine)).toBe('Разом 1 880 / 1 700 ккал');
    expect(m.totals.kcal.state).toBe('over');
  });

  it('an old-client block among typed meals gets the note too; a typed «legacy» meal does not', () => {
    expect(
      foodDayModel(withDay({ meals: [TOAST, meal('old-1x2y', '', null, { text: 'Салат' })] }), DATE)
        .legacyNote,
    ).toBe(LEGACY_NOTE);
    expect(
      foodDayModel(withDay({ meals: [meal('legacy', 'Обід', 300, { text: 'Суп' })] }), DATE).legacyNote,
    ).toBeNull();
  });

  it('20 meals: no more can be added', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => meal(`m${i}`, 'Перекус', 10, { text: `${i}` }));
    expect(foodDayModel(withDay({ meals: twenty }), DATE).canAdd).toBe(false);
    expect(foodDayModel(withDay({ meals: twenty.slice(1) }), DATE).canAdd).toBe(true);
    expect(MEALS_CAP_NOTE).toBe('Не більше 20 прийомів на день');
  });

  it('a day with meals but no kcal: «—» in the card and the total line', () => {
    const m = foodDayModel(withDay({ meals: [APPLE] }), DATE);
    expect(m.totals.kcal.value).toBe('—');
    expect(flat(m.totalLine)).toBe('Разом — / 1 700 ккал');
  });

  it('copy', () => {
    expect(EMPTY_DAY_TEXT).toBe('Ще нічого не записано за цей день');
    expect(EMPTY_FIELD_TEXT).toBe('Ще нічого не записано');
    expect(ADD_MEAL_TEXT).toBe('+ Прийом їжі');
    expect(ADD_MEAL_LABEL).toBe('Додати прийом їжі');
    expect(MEALS_REGION).toBe('Прийоми їжі');
  });
});
