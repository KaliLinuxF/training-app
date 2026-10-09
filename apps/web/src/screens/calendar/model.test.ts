import { emptyData, f0, type AppData, type DayEntry } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  buildDayDetail,
  buildHistory,
  buildMonth,
  cellFill,
  monthOf,
  resolveSelected,
  stepMonth,
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

  it('builds spoken labels', () => {
    const m = buildMonth(fixture(), '2026-10', '2026-10-01', TODAY);
    const byDay = new Map(cells(m).map((c) => [c.day, c]));
    expect(byDay.get(8)?.label).toBe('8 жовтня, тренування, харчування');
    expect(byDay.get(10)?.label).toBe('10 жовтня, сьогодні, харчування');
    expect(byDay.get(5)?.label).toBe('5 жовтня, вага або заміри');
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
  const values = (d: ReturnType<typeof buildDayDetail>) =>
    Object.fromEntries(d.rows.map((r) => [r.label, r.value]));

  it('formats a full day like the prototype', () => {
    const data = fixture();
    data.weights.push({ date: '2026-10-08', kg: 65.4 });
    const d = buildDayDetail(data, '2026-10-08', TODAY);
    expect(d.title).toBe('8 жовтня 2026');
    expect(d.weekday).toBe('четвер');
    expect(d.status).toBe('full');
    expect(d.statusLabel).toBe('Заповнено');
    expect(d.statusTone).toBe('acc2');
    expect(values(d)).toEqual({
      Харчування: 'Омлет, борщ',
      Калорії: `${f0(1650)} ккал`,
      Тренування: '✓ Верх тіла, Прес',
      Вага: '65,4 кг',
      Заміри: '—',
      Нотатки: 'Добре',
    });
    expect(d.actionLabel).toBe('Редагувати день');
    expect(d.photos).toEqual([]);
  });

  it('marks today and partial days', () => {
    const d = buildDayDetail(fixture(), TODAY, TODAY);
    expect(d.weekday).toBe('субота · сьогодні');
    expect(d.status).toBe('partial');
    expect(d.statusLabel).toBe('Частково');
    expect(d.statusTone).toBe('acc');
    expect(values(d).Тренування).toBe('—');
  });

  it('shows «Не було», «Було», weight and measurements', () => {
    const data = fixture();
    expect(values(buildDayDetail(data, '2026-10-07', TODAY)).Тренування).toBe('Не було');
    expect(values(buildDayDetail(data, '2026-10-06', TODAY)).Тренування).toBe('✓ Було');
    const m = values(buildDayDetail(data, '2026-10-05', TODAY));
    expect(m.Вага).toBe('65,4 кг');
    expect(m.Заміри).toBe('Груди 90 · Талія 70,5 · Стегна 98');
    expect(m.Нотатки).toBe('Лише нотатка');
  });

  it('describes an empty day', () => {
    const d = buildDayDetail(fixture(), '2026-10-09', TODAY);
    expect(d.status).toBe('empty');
    expect(d.statusLabel).toBe('Порожньо');
    expect(d.statusTone).toBe('neutral');
    expect(d.rows.every((r) => r.value === '—')).toBe(true);
    expect(d.actionLabel).toBe('Заповнити день');
    expect(d.weekday).toBe('пʼятниця');
  });

  it('passes the photo ids through', () => {
    expect(buildDayDetail(fixture(), '2026-09-30', TODAY).photos).toEqual(['p1', 'p2']);
  });
});

describe('buildHistory', () => {
  it('lists the newest records with prototype copy', () => {
    const h = buildHistory(fixture(), 8);
    expect(h.hasMore).toBe(false);
    expect(h.rows.map((r) => r.date)).toEqual([
      '2026-10-10',
      '2026-10-08',
      '2026-10-07',
      '2026-10-06',
      '2026-10-05',
      '2026-09-30',
    ]);
    const [today, trained, rest, wasTrained, notesOnly, sep] = h.rows;
    expect(today).toMatchObject({
      day: 10,
      month: 'жов',
      kcal: 'Калорії не вказані',
      food: 'Вівсянка з бананом, кава',
      training: '—',
      trainingTone: 'neutral',
    });
    expect(trained).toMatchObject({ kcal: `${f0(1650)} ккал`, training: 'Верх тіла', trainingTone: 'acc' });
    expect(rest).toMatchObject({
      food: 'Харчування не записане',
      training: 'Відпочинок',
      trainingTone: 'neutral',
    });
    expect(wasTrained?.training).toBe('Тренування');
    expect(notesOnly?.food).toBe('Харчування не записане');
    expect(sep).toMatchObject({ day: 30, month: 'вер' });
  });

  it('names rows for screen readers in one lower-case sentence, keeping her own words', () => {
    const [today, trained, rest, wasTrained, notesOnly] = buildHistory(fixture(), 8).rows;
    expect(today?.label).toBe(
      '10 жовтня, калорії не вказані, Вівсянка з бананом, кава, тренування не відмічене',
    );
    expect(trained?.label).toBe(`8 жовтня, ${f0(1650)} ккал, Омлет, борщ, тренування: Верх тіла, Прес`);
    expect(rest?.label).toBe(`7 жовтня, ${f0(1500)} ккал, харчування не записане, відпочинок`);
    expect(wasTrained?.label).toBe('6 жовтня, калорії не вказані, харчування не записане, тренування');
    expect(notesOnly?.label).toBe(
      '5 жовтня, калорії не вказані, харчування не записане, тренування не відмічене',
    );
  });

  it('pages', () => {
    const h = buildHistory(fixture(), 4);
    expect(h.rows).toHaveLength(4);
    expect(h.hasMore).toBe(true);
    expect(buildHistory(emptyData(), 8)).toEqual({ rows: [], hasMore: false });
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
