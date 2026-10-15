import { emptyData, f0, normalizeDay, type AppData, type DayEntry, type Meal } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  buildDayDetail,
  buildMonth,
  cellFill,
  monthOf,
  resolveSelected,
  ROW_SHEET,
  showTodayShortcut,
  stepMonth,
  type DayDetail,
  type DayRowKey,
  type DayRowModel,
  type MonthCell,
} from './model';
import { swipeDirection } from './useSwipe';

const TODAY = '2026-10-10'; // Saturday

const day = (patch: Partial<DayEntry> = {}): DayEntry => ({
  food: '',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

function fixture(): AppData {
  const data = emptyData();
  data.days = {
    '2026-10-10': day({ food: 'Вівсянка з бананом, кава' }),
    '2026-10-08': day({
      food: 'Омлет, борщ',
      kcal: 1650,
      trained: true,
      types: ['Верх тіла', 'Прес'],
      notes: 'Добре',
    }),
    '2026-10-07': day({ kcal: 1500, trained: false }),
    '2026-10-06': day({ trained: true }),
    '2026-10-05': day({ notes: 'Лише нотатка' }),
    '2026-09-30': day({ food: 'Сирники', kcal: 1720, trained: false, photos: ['p1', 'p2'] }),
  };
  data.weights = [
    { date: '2026-09-28', kg: 65.8 },
    { date: '2026-10-05', kg: 65.4 },
  ];
  data.measures = [{ date: '2026-10-05', chest: 90, waist: 70.5, hips: 98 }];
  return data;
}

describe('resolveSelected', () => {
  it('accepts a valid past or current date', () => {
    expect(resolveSelected('2026-09-01', TODAY)).toBe('2026-09-01');
    expect(resolveSelected(TODAY, TODAY)).toBe(TODAY);
  });

  it('falls back to today for missing, malformed, impossible or future dates', () => {
    expect(resolveSelected(null, TODAY)).toBe(TODAY);
    expect(resolveSelected('', TODAY)).toBe(TODAY);
    expect(resolveSelected('10.10.2026', TODAY)).toBe(TODAY);
    expect(resolveSelected('2026-02-30', TODAY)).toBe(TODAY);
    expect(resolveSelected('2026-10-11', TODAY)).toBe(TODAY);
  });
});

describe('monthOf / stepMonth', () => {
  it('takes the month of a day', () => {
    expect(monthOf('2026-10-05')).toBe('2026-10');
    expect(monthOf('2025-01-31')).toBe('2025-01');
  });

  it('moves the shown month by one', () => {
    expect(stepMonth('2026-10', -1, TODAY)).toBe('2026-09');
    expect(stepMonth('2026-08', 1, TODAY)).toBe('2026-09');
  });

  it('crosses years', () => {
    expect(stepMonth('2026-01', -1, TODAY)).toBe('2025-12');
    expect(stepMonth('2025-12', 1, TODAY)).toBe('2026-01');
  });

  it('reaches the current month but never a future one', () => {
    expect(stepMonth('2026-09', 1, TODAY)).toBe('2026-10');
    expect(stepMonth('2026-10', 1, TODAY)).toBeNull();
    expect(stepMonth('2026-12', -1, '2026-12-01')).toBe('2026-11');
  });
});

describe('showTodayShortcut', () => {
  it('is hidden on today in its own month', () => {
    expect(showTodayShortcut(TODAY, '2026-10', TODAY)).toBe(false);
  });

  it('shows once another day is selected, even in the same month', () => {
    expect(showTodayShortcut('2026-10-05', '2026-10', TODAY)).toBe(true);
    expect(showTodayShortcut('2026-09-30', '2026-09', TODAY)).toBe(true);
  });

  it('shows when only the shown month moved away (‹ › or a swipe)', () => {
    expect(showTodayShortcut(TODAY, '2026-09', TODAY)).toBe(true);
    expect(showTodayShortcut(TODAY, '2025-10', TODAY)).toBe(true);
  });
});

describe('buildMonth', () => {
  const cells = (m: ReturnType<typeof buildMonth>): MonthCell[] =>
    m.cells.filter((c): c is MonthCell => c !== null);

  it('shows the given month, Monday first', () => {
    const m = buildMonth(fixture(), '2026-10', '2026-10-05', TODAY);
    expect(m.title).toBe('Жовтень 2026');
    expect(m.key).toBe('2026-10');
    expect(m.weekdays).toEqual(['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд']);
    // 1 October 2026 is a Thursday → three leading blanks.
    expect(m.cells.slice(0, 4).map((c) => c?.day ?? null)).toEqual([null, null, null, 1]);
    expect(cells(m)).toHaveLength(31);
    expect(m.isCurrentMonth).toBe(true);
    expect(m.canGoNext).toBe(false);
  });

  it('marks fills: selected › trained › food › none', () => {
    const m = buildMonth(fixture(), '2026-10', '2026-10-08', TODAY);
    const byDay = new Map(cells(m).map((c) => [c.day, c]));
    expect(byDay.get(8)?.fill).toBe('selected');
    expect(byDay.get(6)?.fill).toBe('trained');
    expect(byDay.get(7)?.fill).toBe('food'); // kcal only, no workout
    expect(byDay.get(10)?.fill).toBe('food');
    expect(byDay.get(5)?.fill).toBe('none'); // notes only
    expect(byDay.get(5)?.weighOrMeasure).toBe(true);
    expect(byDay.get(9)?.fill).toBe('none');
    expect(byDay.get(11)?.isFuture).toBe(true);
    expect(byDay.get(10)?.isToday).toBe(true);
  });

  it('builds spoken labels with «їжа»', () => {
    const m = buildMonth(fixture(), '2026-10', '2026-10-01', TODAY);
    const byDay = new Map(cells(m).map((c) => [c.day, c]));
    expect(byDay.get(8)?.label).toBe('8 жовтня, тренування, їжа');
    expect(byDay.get(10)?.label).toBe('10 жовтня, сьогодні, їжа');
    expect(byDay.get(5)?.label).toBe('5 жовтня, вага або заміри');
    expect(byDay.get(9)?.label).toBe('9 жовтня');
    expect(cells(m).some((c) => c.label.includes('харчування'))).toBe(false);
  });

  it('allows going forward from past months', () => {
    const m = buildMonth(fixture(), '2026-09', '2026-09-30', TODAY);
    expect(m.title).toBe('Вересень 2026');
    expect(m.key).toBe('2026-09');
    expect(m.canGoNext).toBe(true);
    expect(m.isCurrentMonth).toBe(false);
  });

  it('highlights the selection only in its own month', () => {
    const sep = cells(buildMonth(fixture(), '2026-09', '2026-10-08', TODAY));
    expect(sep.some((c) => c.isSelected || c.fill === 'selected')).toBe(false);
    expect(sep.find((c) => c.day === 30)?.fill).toBe('food');
    const oct = cells(buildMonth(fixture(), '2026-10', '2026-10-08', TODAY));
    expect(oct.filter((c) => c.fill === 'selected').map((c) => c.day)).toEqual([8]);
  });

  it('cellFill ignores the weigh-in mark', () => {
    const base = cells(buildMonth(emptyData(), '2026-10', '2026-10-01', TODAY))[2];
    expect(base && cellFill({ ...base, isSelected: false, weighOrMeasure: true })).toBe('none');
  });
});

describe('buildDayDetail', () => {
  /** The row with its optional fields spelled out, so `toMatchObject({ value: undefined })` can check absence. */
  const row = (d: DayDetail, key: DayRowKey): DayRowModel => {
    const found = d.rows.find((r) => r.key === key);
    if (!found) throw new Error(`no ${key} row`);
    return { value: undefined, text: undefined, lines: undefined, action: undefined, ...found };
  };
  /** Nothing on the card ever falls back to «—». */
  const expectNoDash = (d: DayDetail) => {
    for (const r of d.rows) {
      expect(r.value).not.toBe('—');
      expect(r.text).not.toBe('—');
      expect(r.label).not.toContain('—');
    }
  };

  it('maps every row to its sheet', () => {
    expect(ROW_SHEET).toEqual({
      food: 'food',
      training: 'workout',
      weight: 'weight',
      measures: 'measure',
      notes: 'day',
    });
  });

  it('builds a full day as a check-list', () => {
    const data = fixture();
    data.weights.push({ date: '2026-10-08', kg: 65.4 });
    const d = buildDayDetail(data, '2026-10-08', TODAY);
    expect(d.title).toBe('8 жовтня 2026');
    expect(d.weekday).toBe('четвер');
    expect(d.status).toBe('full');
    expect(d.statusLabel).toBe('Заповнено');
    expect(d.statusTone).toBe('acc2');
    expect(d.actionLabel).toBe('Редагувати день');
    expect(d.photos).toEqual([]);
    expect(d.rows.map((r) => r.key)).toEqual(['food', 'training', 'weight', 'measures', 'notes']);
    expect(d.rows.map((r) => r.title)).toEqual(['Їжа', 'Тренування', 'Вага', 'Заміри', 'Нотатки']);
    expect(d.rows.map((r) => r.mode)).toEqual(d.rows.map((r) => ROW_SHEET[r.key]));

    expect(row(d, 'food')).toEqual({
      key: 'food',
      title: 'Їжа',
      filled: true,
      value: `${f0(1650)} ккал`,
      valueTone: 'ink',
      text: 'Омлет, борщ',
      action: undefined,
      mode: 'food',
      label: `Їжа: ${f0(1650)} ккал`,
      describe: true,
    });
    expect(row(d, 'training')).toEqual({
      key: 'training',
      title: 'Тренування',
      filled: true,
      valueTone: 'ink',
      text: 'Верх тіла, Прес',
      trained: true,
      mode: 'workout',
      label: 'Тренування: було, Верх тіла, Прес',
      describe: false,
    });
    expect(row(d, 'weight')).toMatchObject({
      filled: true,
      value: '65,4 кг',
      action: undefined,
      mode: 'weight',
      label: 'Вага: 65,4 кг',
      describe: false,
    });
    // No measurements that day: an action, not a dash.
    expect(row(d, 'measures')).toMatchObject({
      filled: false,
      value: undefined,
      text: undefined,
      action: 'Додати',
      mode: 'measure',
      label: 'Заміри: додати',
    });
    expect(row(d, 'notes')).toEqual({
      key: 'notes',
      title: 'Нотатки',
      filled: true,
      valueTone: 'ink',
      text: 'Добре',
      mode: 'day',
      label: 'Нотатки',
      describe: true,
    });
    expectNoDash(d);
  });

  it('describes an empty day: four rows with «Додати», the workout not marked yet', () => {
    const d = buildDayDetail(fixture(), '2026-10-09', TODAY);
    expect(d.status).toBe('empty');
    expect(d.statusLabel).toBe('Порожньо');
    expect(d.statusTone).toBe('neutral');
    expect(d.actionLabel).toBe('Заповнити день');
    expect(d.weekday).toBe('пʼятниця');
    expect(d.rows.map((r) => r.key)).toEqual(['food', 'training', 'weight', 'measures']);
    expect(d.rows.map((r) => r.label)).toEqual([
      'Їжа: додати',
      'Тренування: не відмічено',
      'Вага: додати',
      'Заміри: додати',
    ]);
    for (const key of ['food', 'weight', 'measures'] as const) {
      expect(row(d, key)).toMatchObject({
        filled: false,
        action: 'Додати',
        value: undefined,
        describe: false,
      });
    }
    // «Додати» on Їжа opens the new-meal editor right away (an empty list would be one more tap); the other rows
    // open their usual sheets.
    expect(d.rows.map((r) => r.mode)).toEqual(['meal', 'workout', 'weight', 'measure']);
    expect(d.rows.filter((r) => r.key !== 'food').map((r) => r.mode)).toEqual(
      d.rows.filter((r) => r.key !== 'food').map((r) => ROW_SHEET[r.key]),
    );
    expect(row(d, 'training')).toMatchObject({
      filled: false,
      trained: null,
      text: 'Ще не відмічено',
      action: undefined,
      value: undefined,
    });
    expectNoDash(d);
  });

  it('marks today; food text without kcal says the calories are missing', () => {
    const d = buildDayDetail(fixture(), TODAY, TODAY);
    expect(d.weekday).toBe('субота · сьогодні');
    expect(d.status).toBe('partial');
    expect(d.statusLabel).toBe('Частково');
    expect(d.statusTone).toBe('acc');
    expect(row(d, 'food')).toMatchObject({
      filled: true,
      value: undefined,
      action: undefined,
      text: 'Вівсянка з бананом, кава',
      label: 'Їжа: калорії не вказані',
      describe: true,
    });
    expect(row(d, 'training').label).toBe('Тренування: не відмічено');
  });

  it('kcal only: a value without text or description; «Не було»', () => {
    const d = buildDayDetail(fixture(), '2026-10-07', TODAY);
    expect(row(d, 'food')).toMatchObject({
      filled: true,
      value: `${f0(1500)} ккал`,
      text: undefined,
      label: `Їжа: ${f0(1500)} ккал`,
      describe: false,
    });
    expect(row(d, 'training')).toMatchObject({
      filled: true,
      trained: false,
      text: 'Не було',
      label: 'Тренування: не було',
    });
  });

  it('a workout without types reads «Було»', () => {
    const d = buildDayDetail(fixture(), '2026-10-06', TODAY);
    expect(row(d, 'training')).toMatchObject({ trained: true, text: 'Було', label: 'Тренування: було' });
  });

  it('photos only count as food, without kcal', () => {
    const data = fixture();
    data.days['2026-10-04'] = day({ photos: ['ph1'] });
    const d = buildDayDetail(data, '2026-10-04', TODAY);
    expect(d.photos).toEqual(['ph1']);
    expect(row(d, 'food')).toMatchObject({
      filled: true,
      value: undefined,
      action: undefined,
      text: undefined,
      lines: undefined,
      label: 'Їжа: калорії не вказані',
      describe: false,
      mode: 'food',
    });
  });

  it('whitespace-only food and notes count as empty', () => {
    const data = fixture();
    data.days['2026-10-04'] = day({ food: '  ', notes: ' \n ' });
    const d = buildDayDetail(data, '2026-10-04', TODAY);
    expect(row(d, 'food')).toMatchObject({ filled: false, action: 'Додати', text: undefined, mode: 'meal' });
    expect(d.rows.some((r) => r.key === 'notes')).toBe(false);
  });

  it('a notes-only day with a weigh-in and measurements', () => {
    const d = buildDayDetail(fixture(), '2026-10-05', TODAY);
    expect(d.status).toBe('partial');
    expect(d.rows.map((r) => r.key)).toEqual(['food', 'training', 'weight', 'measures', 'notes']);
    expect(row(d, 'food').action).toBe('Додати');
    expect(row(d, 'weight')).toMatchObject({ value: '65,4 кг', label: 'Вага: 65,4 кг' });
    expect(row(d, 'measures')).toMatchObject({
      filled: true,
      action: undefined,
      value: undefined,
      text: 'Груди 90 · Талія 70,5 · Стегна 98',
      label: 'Заміри: груди 90, талія 70,5, стегна 98',
      describe: false,
    });
    expect(row(d, 'notes')).toMatchObject({ text: 'Лише нотатка', describe: true, mode: 'day' });
  });

  it('lists only the measurements that were taken', () => {
    const data = fixture();
    data.measures = [{ date: '2026-10-05', chest: 90, waist: null, hips: 98.5 }];
    expect(row(buildDayDetail(data, '2026-10-05', TODAY), 'measures')).toMatchObject({
      text: 'Груди 90 · Стегна 98,5',
      label: 'Заміри: груди 90, стегна 98,5',
    });
  });

  it('over the kcal goal: accent value and a spoken hint', () => {
    const data = fixture(); // default goal 1 700
    const d = buildDayDetail(data, '2026-09-30', TODAY);
    expect(row(d, 'food')).toMatchObject({
      value: `${f0(1720)} ккал`,
      valueTone: 'acc',
      text: 'Сирники',
      label: `Їжа: ${f0(1720)} ккал, більше цілі`,
    });
    expect(d.photos).toEqual(['p1', 'p2']);

    data.settings.kcalGoal = 1720; // exactly at the goal is not over
    expect(row(buildDayDetail(data, '2026-09-30', TODAY), 'food')).toMatchObject({
      valueTone: 'ink',
      label: `Їжа: ${f0(1720)} ккал`,
    });
  });

  describe('Їжа on a day with meals', () => {
    /** U+00A0, spelled out so the tests pin it (the row helpers keep «520 ккал» and «3 прийоми» together). */
    const NB = ' ';
    const DATE = '2026-10-03';

    const meal = (patch: Partial<Meal> & Pick<Meal, 'id'>): Meal => ({
      type: '',
      time: null,
      text: '',
      kcal: null,
      protein: null,
      fat: null,
      carbs: null,
      ...patch,
    });
    /** Stored as the reducer stores it: food, kcal and photos derived from the meals. */
    const withMeals = (meals: Meal[], patch: Partial<DayEntry> = {}): AppData => {
      const data = fixture();
      data.days[DATE] = normalizeDay({ ...day(patch), meals });
      return data;
    };
    const foodOf = (data: AppData): DayRowModel => row(buildDayDetail(data, DATE, TODAY), 'food');

    /** The demo seed's 13 October: 1 740 ккал in three meals (meals doc §7.8). */
    const THREE = (): Meal[] => [
      meal({
        id: 'demoB',
        type: 'Сніданок',
        time: '08:30',
        text: 'Тост з авокадо',
        photos: ['ph1'],
        items: [{ name: 'Тост з авокадо', portion: '1 порція', kcal: 520, protein: 23, fat: 17, carbs: 68 }],
      }),
      meal({
        id: 'demoL',
        type: 'Обід',
        time: '13:00',
        text: 'Салат з куркою',
        kcal: 700,
        protein: 49,
        fat: 25,
        carbs: 70,
        photos: ['ph2'],
      }),
      meal({
        id: 'demoD',
        type: 'Вечеря',
        time: '19:30',
        text: 'Індичка з броколі',
        kcal: 520,
        protein: 42,
        fat: 20,
        carbs: 43,
      }),
    ];
    const THREE_LINES = [
      `Сніданок · 520${NB}ккал · Тост з авокадо`,
      `Обід · 700${NB}ккал · Салат з куркою`,
      `Вечеря · 520${NB}ккал · Індичка з броколі`,
      `Б${NB}114${NB}· Ж${NB}62${NB}· В${NB}181${NB}г`,
    ];

    it('one line per meal, then the day’s «Б · Ж · В»; the lines are the row’s description', () => {
      const data = withMeals(THREE(), { trained: true, types: ['Кардіо'] });
      data.settings.kcalGoal = 1800;
      const d = buildDayDetail(data, DATE, TODAY);
      expect(row(d, 'food')).toEqual({
        key: 'food',
        title: 'Їжа',
        filled: true,
        value: `${f0(1740)} ккал`,
        valueTone: 'ink',
        text: THREE_LINES.join('\n'),
        lines: THREE_LINES,
        action: undefined,
        mode: 'food',
        label: `Їжа: ${f0(1740)} ккал, 3${NB}прийоми`,
        describe: true,
      });
      // The derived day photos still sit under the row; the other rows are untouched.
      expect(d.photos).toEqual(['ph1', 'ph2']);
      expect(row(d, 'training').label).toBe('Тренування: було, Кардіо');
      expect(d.statusLabel).toBe('Заповнено');
    });

    it('keeps the number and «ккал» together, and never says «БЖУ»', () => {
      const { lines = [], label } = foodOf(withMeals(THREE()));
      for (const line of lines.slice(0, 3)) {
        expect(line).toMatch(new RegExp(`\\d${NB}ккал`));
        expect(line).not.toMatch(/\d ккал/);
      }
      expect(lines.join(' ')).not.toContain('БЖУ');
      expect(label).toContain(`3${NB}прийоми`);
    });

    it('over the kcal goal: accent value and «більше цілі» after the meal count', () => {
      expect(foodOf(withMeals(THREE()))).toMatchObject({
        value: `${f0(1740)} ккал`,
        valueTone: 'acc',
        label: `Їжа: ${f0(1740)} ккал, 3${NB}прийоми, більше цілі`,
      });
    });

    it('leaves out « · … ккал» without kcal and « · content» without content', () => {
      const data = withMeals([
        meal({ id: 'snack', type: 'Перекус', time: '10:00', text: 'Яблуко' }),
        meal({ id: 'photo', type: 'Обід', time: '13:00', kcal: 450, photos: ['ph1'] }),
        meal({ id: 'bare', type: 'Вечеря', time: '19:00', photos: ['ph2'] }),
      ]);
      expect(foodOf(data)).toMatchObject({
        lines: ['Перекус · Яблуко', `Обід · 450${NB}ккал`, 'Вечеря'],
        value: `${f0(450)} ккал`,
        label: `Їжа: ${f0(450)} ккал, 3${NB}прийоми`,
        describe: true,
      });
    });

    it('titles and content: untyped meals, a converted legacy block, positions, several text lines', () => {
      const data = withMeals([
        meal({ id: 'legacy', text: 'Омлет, борщ', kcal: 900 }),
        meal({ id: 'untyped0001', time: '12:00', text: 'Кава' }),
        meal({
          id: 'withItems',
          type: 'Після тренування',
          time: '18:00',
          items: [
            { name: 'Протеїновий батончик', portion: '1 шт', kcal: 200, protein: 20, fat: 7, carbs: 18 },
            { name: 'Банан', portion: '1 шт', kcal: 100, protein: 1, fat: 0, carbs: 23 },
          ],
        }),
        meal({ id: 'lines', type: 'Вечеря', time: '20:00', text: 'Риба,\nсалат;\n\n  кефір  ', kcal: 400 }),
      ]);
      expect(foodOf(data).lines).toEqual([
        'Прийом їжі · Кава',
        `Після тренування · 300${NB}ккал · Протеїновий батончик, Банан`,
        `Вечеря · 400${NB}ккал · Риба, салат, кефір`,
        // No time: after the timed meals (D14).
        `Їжа за день · 900${NB}ккал · Омлет, борщ`,
        `Б${NB}21${NB}· Ж${NB}7${NB}· В${NB}41${NB}г`,
      ]);
    });

    it('a macro line only when some macronutrient is known; unknown parts read «—»', () => {
      const none = withMeals([meal({ id: 'a', type: 'Обід', text: 'Борщ', kcal: 300 })]);
      expect(foodOf(none).lines).toEqual([`Обід · 300${NB}ккал · Борщ`]);
      expect(foodOf(none).text).toBe(`Обід · 300${NB}ккал · Борщ`);

      const protein = withMeals([meal({ id: 'a', type: 'Обід', text: 'Курка', kcal: 300, protein: 30 })]);
      expect(foodOf(protein).lines).toEqual([
        `Обід · 300${NB}ккал · Курка`,
        `Б${NB}30${NB}г${NB}· Ж${NB}—${NB}· В${NB}—`,
      ]);
    });

    it('no kcal on any meal: the label says so, with the meal count', () => {
      const data = withMeals([
        meal({ id: 'a', type: 'Сніданок', time: '08:00', text: 'Вівсянка' }),
        meal({ id: 'b', type: 'Перекус', time: '11:00', text: 'Яблуко' }),
      ]);
      expect(foodOf(data)).toMatchObject({
        filled: true,
        value: undefined,
        valueTone: 'ink',
        action: undefined,
        lines: ['Сніданок · Вівсянка', 'Перекус · Яблуко'],
        label: `Їжа: калорії не вказані, 2${NB}прийоми`,
        mode: 'food',
        describe: true,
      });
    });

    it('counts one meal as «1 прийом»', () => {
      const data = withMeals([meal({ id: 'a', type: 'Обід', text: 'Борщ', kcal: 300 })]);
      data.settings.kcalGoal = 1700;
      expect(foodOf(data).label).toBe(`Їжа: 300 ккал, 1${NB}прийом`);
    });

    it('a legacy day stays one text block, opened as the day’s list; `meals: []` is still legacy', () => {
      const data = fixture();
      data.days[DATE] = day({ food: 'Сирники, суп', kcal: 1200, meals: [] });
      expect(foodOf(data)).toEqual({
        key: 'food',
        title: 'Їжа',
        filled: true,
        value: `${f0(1200)} ккал`,
        valueTone: 'ink',
        text: 'Сирники, суп',
        lines: undefined,
        action: undefined,
        mode: 'food',
        label: `Їжа: ${f0(1200)} ккал`,
        describe: true,
      });
    });

    it('a day whose meals were all removed is empty again: «Додати» opens a new meal', () => {
      const data = withMeals([meal({ id: 'a', type: 'Обід' })], { trained: true });
      expect(data.days[DATE]?.meals).toBeUndefined();
      expect(foodOf(data)).toMatchObject({
        filled: false,
        action: 'Додати',
        lines: undefined,
        text: undefined,
        label: 'Їжа: додати',
        mode: 'meal',
      });
    });
  });
});

describe('swipeDirection', () => {
  it('detects clear horizontal swipes only', () => {
    expect(swipeDirection(-80, 10)).toBe('left');
    expect(swipeDirection(60, -20)).toBe('right');
    expect(swipeDirection(30, 0)).toBeNull(); // too short
    expect(swipeDirection(-80, 70)).toBeNull(); // mostly vertical (scrolling)
  });
});
