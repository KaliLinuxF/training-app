import { emptyData, f0, type AppData, type DayEntry } from '@legko/shared';
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
    return { value: undefined, text: undefined, action: undefined, ...found };
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
      label: 'Їжа: калорії не вказані',
      describe: false,
    });
  });

  it('whitespace-only food and notes count as empty', () => {
    const data = fixture();
    data.days['2026-10-04'] = day({ food: '  ', notes: ' \n ' });
    const d = buildDayDetail(data, '2026-10-04', TODAY);
    expect(row(d, 'food')).toMatchObject({ filled: false, action: 'Додати', text: undefined });
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
});

describe('swipeDirection', () => {
  it('detects clear horizontal swipes only', () => {
    expect(swipeDirection(-80, 10)).toBe('left');
    expect(swipeDirection(60, -20)).toBe('right');
    expect(swipeDirection(30, 0)).toBeNull(); // too short
    expect(swipeDirection(-80, 70)).toBeNull(); // mostly vertical (scrolling)
  });
});
