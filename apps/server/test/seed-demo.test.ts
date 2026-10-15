import { addDays, appDataSchema, dayMacros, mealsOf, normalizeDay } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { demoData } from '../scripts/seed-demo';
import { createTestServer, json } from './helpers';

// The e2e clock's day (Wed 14 Oct 2026).
const TODAY = '2026-10-14';

describe('demo data (dev seed and e2e fixture)', () => {
  const data = demoData(TODAY);

  it('logs the six days before today as 3–4 typed meals that add up to the day’s kcal', () => {
    for (let back = 1; back <= 6; back++) {
      const date = addDays(TODAY, -back);
      const day = data.days[date];
      if (!day) continue;
      const meals = day.meals ?? [];
      expect(meals.length, date).toBeGreaterThanOrEqual(3);
      expect(meals.length, date).toBeLessThanOrEqual(4);
      expect(meals.reduce((sum, m) => sum + (m.kcal ?? 0), 0)).toBe(day.kcal);
      expect(meals.map((m) => m.id)).toEqual(meals.map((_, i) => `demo-${date}-${i}`));
      expect(meals[0]).toMatchObject({ type: 'Сніданок', time: '08:30' });
      expect(meals.at(-1)).toMatchObject({ type: 'Вечеря', time: '19:30' });
      for (const m of meals) expect(m.text[0]).toBe(m.text[0]?.toLocaleUpperCase('uk'));
      expect(day).toEqual(normalizeDay(day));
    }
  });

  it('13 October: 1 740 kcal as 520 / 700 / 520 with the type shares of macros', () => {
    const day = data.days['2026-10-13'];
    expect(mealsOf(day).map((m) => [m.type, m.kcal, m.text])).toEqual([
      ['Сніданок', 520, 'Тост з авокадо'],
      ['Обід', 700, 'Салат з куркою'],
      ['Вечеря', 520, 'Індичка з броколі'],
    ]);
    expect(day?.kcal).toBe(1740);
    expect(dayMacros(day)).toEqual({ protein: 114, fat: 62, carbs: 181 });
    // Yesterday's breakfast mirrors itself as one position.
    expect(day?.meals?.[0]?.items).toEqual([
      { name: 'Тост з авокадо', portion: '1 порція', kcal: 520, protein: 23, fat: 17, carbs: 68 },
    ]);
    expect(day?.meals?.[1]).not.toHaveProperty('items');
  });

  it('keeps today and the older days legacy', () => {
    expect(data.days[TODAY]).toEqual({
      food: 'Вівсянка з бананом, кава',
      kcal: null,
      trained: null,
      types: [],
      notes: '',
    });
    const older = Object.entries(data.days).filter(([date]) => date < addDays(TODAY, -6));
    expect(older.length).toBeGreaterThan(40);
    for (const [, day] of older) expect(day).not.toHaveProperty('meals');
  });

  it('gives the frequent dishes macros (except the apple)', () => {
    expect(data.foods.find((f) => f.name === 'Борщ')).toMatchObject({ protein: 6, fat: 9, carbs: 19 });
    expect(data.foods.find((f) => f.name === 'Яблуко')).not.toHaveProperty('protein');
  });

  it('is a valid backup that round-trips through the server unchanged', async () => {
    expect(appDataSchema.safeParse(data).success).toBe(true);
    const s = await createTestServer();
    const cookie = await s.login();
    expect((await s.call('/api/import', { cookie, body: data })).status).toBe(200);
    expect(await json(await s.call('/api/data', { cookie }))).toEqual(data);
  });
});
