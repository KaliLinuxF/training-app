import { emptyData, f0, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  captureMenuDateLine,
  captureMenuRows,
  FULL_DAY_LABEL,
  MENU_ROW_COPY,
  MENU_STATUS,
  type CaptureMenuRow,
} from './menuModel';

/** Monday: the default weigh-in, measurements and workout reminders are all due. */
const MONDAY = '2026-10-12';
const WEDNESDAY = '2026-10-14';

function onboarded(): AppData {
  const data = emptyData();
  data.settings.onboarded = true;
  return data;
}

const statusOf = (rows: CaptureMenuRow[], mode: CaptureMenuRow['mode']) =>
  rows.find((r) => r.mode === mode)?.status;

describe('captureMenuRows', () => {
  it('lists Їжа, Тренування, Вага, Заміри with their copy, icons and tints', () => {
    const rows = captureMenuRows(onboarded(), WEDNESDAY, WEDNESDAY);
    expect(
      rows.map(({ mode, title, sub, icon, iconTone }) => ({ mode, title, sub, icon, iconTone })),
    ).toEqual([
      { mode: 'food', title: 'Їжа', sub: 'Опис або фото', icon: 'food', iconTone: 'acc2' },
      { mode: 'workout', title: 'Тренування', sub: 'Було чи ні, тип', icon: 'workout', iconTone: 'acc' },
      { mode: 'weight', title: 'Вага', sub: 'Контрольне зважування', icon: 'weight', iconTone: 'neutral' },
      { mode: 'measure', title: 'Заміри', sub: 'Груди, талія, стегна', icon: 'measure', iconTone: 'neutral' },
    ]);
    expect(MENU_ROW_COPY.food.title).toBe('Їжа');
    expect(FULL_DAY_LABEL).toBe('Повний запис дня');
  });

  it('an empty, unplanned day has no statuses', () => {
    // Wednesday is a workout day by default: switch the plan off.
    const data = onboarded();
    data.settings.rem.workout.on = false;
    expect(captureMenuRows(data, WEDNESDAY, WEDNESDAY).map((r) => r.status)).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  it('Їжа: the day’s kcal, in the «over» tone above the goal; «Записано» for a meal without kcal', () => {
    const data = onboarded();
    data.days[WEDNESDAY] = { food: 'Омлет', kcal: 1240, trained: null, types: [], notes: '' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'food')).toEqual({
      kind: 'value',
      text: `${f0(1240)} ккал`,
    });
    expect(`${f0(1240)} ккал`.replace(/\s/g, ' ')).toBe('1 240 ккал');

    data.days[WEDNESDAY] = { food: 'Омлет', kcal: 1820, trained: null, types: [], notes: '' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'food')).toEqual({
      kind: 'over',
      text: `${f0(1820)} ккал`,
    });
    // Exactly the goal is not over.
    data.days[WEDNESDAY] = { food: '', kcal: 1700, trained: null, types: [], notes: '' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'food')?.kind).toBe('value');
    // Food text or a photo without a kcal number (or with 0): soft «Записано», like Home's row.
    const recorded = { kind: 'value', text: 'Записано' };
    expect(MENU_STATUS.foodRecorded).toBe('Записано');
    data.days[WEDNESDAY] = { food: 'Омлет', kcal: null, trained: null, types: [], notes: '' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'food')).toEqual(recorded);
    data.days[WEDNESDAY] = { food: 'Омлет', kcal: 0, trained: null, types: [], notes: '' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'food')).toEqual(recorded);
    data.days[WEDNESDAY] = { food: '', kcal: null, trained: null, types: [], notes: '', photos: ['p1'] };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'food')).toEqual(recorded);
    // Blank text, no photo, no kcal: nothing recorded.
    data.days[WEDNESDAY] = { food: '   ', kcal: null, trained: null, types: [], notes: 'Сон 8 годин' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'food')).toBeNull();
    // A kcal number still wins over «Записано».
    data.days[WEDNESDAY] = { food: 'Омлет', kcal: 1240, trained: null, types: [], notes: '', photos: ['p1'] };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'food')).toEqual({
      kind: 'value',
      text: `${f0(1240)} ккал`,
    });
  });

  it('Тренування: «✓ Було», «✕ Не було», or the «За планом» pill on a planned day today', () => {
    const data = onboarded();
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'workout')).toEqual({
      kind: 'due',
      text: 'За планом',
    });
    data.days[WEDNESDAY] = { food: '', kcal: null, trained: true, types: ['Кардіо'], notes: '' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'workout')).toEqual({
      kind: 'done',
      text: '✓ Було',
    });
    data.days[WEDNESDAY] = { food: '', kcal: null, trained: false, types: [], notes: '' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'workout')).toEqual({
      kind: 'value',
      text: '✕ Не було',
    });
    // Tuesday is not a workout day.
    expect(statusOf(captureMenuRows(data, '2026-10-13', '2026-10-13'), 'workout')).toBeNull();
  });

  it('Вага: the weigh-in of the day, or the «Сьогодні» pill on the weigh-in day', () => {
    const data = onboarded();
    expect(statusOf(captureMenuRows(data, MONDAY, MONDAY), 'weight')).toEqual({
      kind: 'due',
      text: 'Сьогодні',
    });
    data.weights = [{ date: MONDAY, kg: 65.4 }];
    expect(statusOf(captureMenuRows(data, MONDAY, MONDAY), 'weight')).toEqual({
      kind: 'value',
      text: '65,4 кг',
    });
    data.weights = [{ date: MONDAY, kg: 65 }];
    expect(statusOf(captureMenuRows(data, MONDAY, MONDAY), 'weight')?.text).toBe('65,0 кг');
    // Not the weigh-in day: nothing.
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'weight')).toBeNull();
  });

  it('Заміри: «✓ записано», or the «Сьогодні» pill on the measurements day', () => {
    const data = onboarded();
    expect(statusOf(captureMenuRows(data, MONDAY, MONDAY), 'measure')).toEqual({
      kind: 'due',
      text: 'Сьогодні',
    });
    data.measures = [{ date: MONDAY, chest: null, waist: 70, hips: null }];
    expect(statusOf(captureMenuRows(data, MONDAY, MONDAY), 'measure')).toEqual({
      kind: 'done',
      text: '✓ записано',
    });
  });

  it('due pills are capitalised, like Home’s «Сьогодні»', () => {
    const due = captureMenuRows(onboarded(), MONDAY, MONDAY)
      .map((r) => r.status)
      .filter((st) => st?.kind === 'due')
      .map((st) => st?.text);
    expect(due).toEqual(['За планом', 'Сьогодні', 'Сьогодні']);
    expect(MENU_STATUS.dueToday).toBe('Сьогодні');
    expect(MENU_STATUS.planned).toBe('За планом');
  });

  it('no due pills before the first-run setup (like Home), recorded values still show', () => {
    // Default reminders (workout Mon/Wed/Fri, weigh-in and measurements on Monday), not onboarded.
    const data = emptyData();
    expect(data.settings.onboarded).toBe(false);
    expect(captureMenuRows(data, MONDAY, MONDAY).map((r) => r.status)).toEqual([null, null, null, null]);
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'workout')).toBeNull();

    data.days[WEDNESDAY] = { food: '', kcal: null, trained: true, types: [], notes: '' };
    expect(statusOf(captureMenuRows(data, WEDNESDAY, WEDNESDAY), 'workout')).toEqual({
      kind: 'done',
      text: '✓ Було',
    });

    // The same data once onboarded: the three due pills on Monday come back.
    data.settings.onboarded = true;
    expect(captureMenuRows(data, MONDAY, MONDAY).map((r) => r.status?.kind)).toEqual([
      undefined,
      'due',
      'due',
      'due',
    ]);
  });

  it('a past day gets no due pills, but shows what was recorded that day', () => {
    const data = onboarded();
    // A Monday a week ago, nothing recorded: no reminders are «due» in the past.
    expect(captureMenuRows(data, '2026-10-05', WEDNESDAY).map((r) => r.status)).toEqual([
      null,
      null,
      null,
      null,
    ]);

    data.days['2026-10-05'] = { food: 'Борщ', kcal: 900, trained: true, types: [], notes: '' };
    data.weights = [{ date: '2026-10-05', kg: 65.7 }];
    data.measures = [{ date: '2026-10-05', chest: 90, waist: 70, hips: 98 }];
    expect(captureMenuRows(data, '2026-10-05', WEDNESDAY).map((r) => r.status)).toEqual([
      { kind: 'value', text: '900 ккал' },
      { kind: 'done', text: '✓ Було' },
      { kind: 'value', text: '65,7 кг' },
      { kind: 'done', text: '✓ записано' },
    ]);
  });

  it('records of other days do not count', () => {
    const data = onboarded();
    data.weights = [{ date: '2026-10-05', kg: 65.7 }];
    data.measures = [{ date: '2026-10-05', chest: 90, waist: 70, hips: 98 }];
    data.days['2026-10-05'] = { food: 'Борщ', kcal: 900, trained: true, types: [], notes: '' };
    const rows = captureMenuRows(data, MONDAY, MONDAY);
    expect(rows.map((r) => r.status?.kind)).toEqual([undefined, 'due', 'due', 'due']);
  });
});

describe('captureMenuDateLine', () => {
  it('is empty for today and names another day with its weekday', () => {
    expect(captureMenuDateLine(WEDNESDAY, WEDNESDAY)).toBeNull();
    expect(captureMenuDateLine('2026-10-13', WEDNESDAY)).toBe('13 жовтня · вівторок');
    expect(captureMenuDateLine('2026-10-09', WEDNESDAY)).toBe('9 жовтня · пʼятниця');
  });
});
