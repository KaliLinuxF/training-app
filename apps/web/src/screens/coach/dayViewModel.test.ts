import { describe, expect, it } from 'vitest';
import { meals, PHOTO_IDS, steady, TODAY } from './coach.fixtures';
import { coachDayModel } from './dayViewModel';

describe('coachDayModel (read-only day)', () => {
  it('takes the meals, the totals and only title / value / tone / text of the other rows', () => {
    const day = coachDayModel(meals(), '2026-10-13', TODAY);
    expect(day).toMatchObject({ title: '13 жовтня 2026', weekday: 'вівторок', empty: false });
    expect(day.meals.map((m) => [m.title, m.time, m.photos])).toEqual([
      ['Сніданок', '08:30', [...PHOTO_IDS]],
      ['Обід', '13:10', []],
      ['Вечеря', '19:00', []],
    ]);
    expect(day.totals?.kcal.value).toBe('1 590');
    expect(day.rows).toEqual([
      { key: 'training', title: 'Тренування', value: null, valueTone: 'ink', text: 'Кардіо' },
      { key: 'steps', title: 'Кроки', value: null, valueTone: 'ink', text: null },
      { key: 'weight', title: 'Вага', value: null, valueTone: 'ink', text: null },
      { key: 'measures', title: 'Заміри', value: null, valueTone: 'ink', text: null },
      { key: 'notes', title: 'Нотатки', value: null, valueTone: 'ink', text: 'Гарний день, багато ходила' },
    ]);
    // Nothing of the client's editing UI leaks into the coach rows.
    for (const row of day.rows) {
      expect(Object.keys(row).sort()).toEqual(['key', 'text', 'title', 'value', 'valueTone']);
      expect(JSON.stringify(row)).not.toMatch(/додати/i);
    }
  });

  it('reuses «Ще не відмічено» and shows the weigh-in and the measurements', () => {
    const day = coachDayModel(steady(), '2026-10-12', TODAY);
    expect(day.rows.find((r) => r.key === 'weight')).toMatchObject({ value: '69,6 кг' });
    expect(day.rows.find((r) => r.key === 'measures')?.text).toBe('Груди 92 · Талія 76 · Стегна 100');
    const tuesday = coachDayModel(steady(), '2026-10-06', TODAY);
    expect(tuesday.rows.find((r) => r.key === 'training')?.text).toBe('Ще не відмічено');
  });

  it('marks a day with nothing at all as empty, without totals or meals', () => {
    const day = coachDayModel(steady(), TODAY, TODAY);
    expect(day).toMatchObject({ empty: true, meals: [], totals: null, weekday: 'середа · сьогодні' });
  });
});
