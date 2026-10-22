import { addDays, normalizeDay } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { empty, meals, TODAY } from './coach.fixtures';
import { dayLabel, nutritionModel } from './nutritionModel';

const NB = ' ';

describe('nutritionModel', () => {
  it('draws one bar per day of the last 7 days, today included, toned against the goal', () => {
    const m = nutritionModel(meals(), TODAY, 7);
    expect(m.bars.map((b) => b.date)).toEqual([
      '2026-10-08',
      '2026-10-09',
      '2026-10-10',
      '2026-10-11',
      '2026-10-12',
      '2026-10-13',
      '2026-10-14',
    ]);
    expect(m.bars.map((b) => b.label)).toEqual(['Чт', 'Пт', 'Сб', 'Нд', 'Пн', 'Вт', 'Ср']);
    expect(m.bars.at(-1)).toMatchObject({ value: null, tone: 'empty' });
    expect(m.bars.at(-2)).toMatchObject({ value: 1590, tone: 'ok' });
    expect(m).toMatchObject({ labeled: true, gap: '8px', hasBarData: true, goal: 1700 });
    expect(m.goalText).toBe(`ціль 1${NB}700${NB}ккал`);
    expect(m.goalPct).toBeCloseTo(80);
  });

  it('draws 30 unlabeled bars for 30 days', () => {
    const m = nutritionModel(meals(), TODAY, 30);
    expect(m.bars).toHaveLength(30);
    expect(m.bars[0]?.date).toBe(addDays(TODAY, -29));
    expect(m).toMatchObject({ labeled: false, gap: '3px' });
    expect(m.stats[0]?.label).toBe('Сер. за 30 повних днів');
  });

  it('averages the full days before today', () => {
    const m = nutritionModel(meals(), TODAY, 7);
    // 10-07 … 10-13: six steady legacy days and the meal day (1 590).
    const data = meals();
    const values = [1, 2, 3, 4, 5, 6, 7].map((i) => data.days[addDays(TODAY, -i)]?.kcal ?? 0);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    expect(m.stats).toEqual([
      { label: 'Сер. за 7 повних днів', value: Math.round(avg).toLocaleString('uk-UA'), unit: 'ккал', tone: 'acc2' },
      { label: 'Днів із калоріями', value: '7' },
    ]);
  });

  it('lists Б · Ж · В per day with food, newest first; lavender above a goal, partial days marked', () => {
    const data = meals();
    data.settings = { ...data.settings, macroGoals: { protein: 80, fat: 60, carbs: null } };
    // Yesterday − 1: a meal with macros and a meal with kcal but no macros → partial.
    const date = addDays(TODAY, -2);
    data.days[date] = normalizeDay({
      food: '',
      kcal: null,
      trained: null,
      types: [],
      notes: '',
      meals: [
        { id: 'x', type: 'Обід', time: '13:00', text: 'Суп', kcal: 400, protein: 20, fat: 10, carbs: 40 },
        { id: 'y', type: 'Перекус', time: null, text: 'Тістечко', kcal: 300, protein: null, fat: null, carbs: null },
      ],
    });
    const m = nutritionModel(data, TODAY, 7);
    expect(m.macroRows.map((r) => r.date)).toEqual([
      '2026-10-13',
      '2026-10-12',
      '2026-10-11',
      '2026-10-10',
      '2026-10-09',
      '2026-10-08',
    ]);
    const [yesterday, partial, legacy] = m.macroRows;
    expect(yesterday).toMatchObject({ label: 'Вт, 13 жовтня', kcal: `1${NB}590`, kcalTone: 'ink' });
    expect(yesterday?.cells).toEqual([
      { key: 'protein', text: '85', tone: 'acc', partial: false },
      { key: 'fat', text: '51', tone: 'ink', partial: false },
      { key: 'carbs', text: '178', tone: 'ink', partial: false },
    ]);
    expect(partial?.cells[0]).toEqual({ key: 'protein', text: '20', tone: 'muted', partial: true });
    expect(legacy?.cells[0]).toEqual({ key: 'protein', text: '—', tone: 'faint', partial: false });
    expect(m.hasPartial).toBe(true);
    expect(m.goals).toEqual({ protein: 80, fat: 60, carbs: null });
  });

  it('keeps a journal of every day with food, newest first, with each meal', () => {
    const m = nutritionModel(meals(), TODAY, 7);
    expect(m.journal).toHaveLength(35);
    const [first] = m.journal;
    expect(first).toMatchObject({ date: '2026-10-13', title: 'Вт, 13 жовтня', kcal: `1${NB}590${NB}ккал` });
    expect(first?.meals).toEqual([
      {
        id: 'b',
        title: 'Сніданок · 08:30',
        value: `380${NB}ккал`,
        hasKcal: true,
        content: 'Вівсянка з бананом, Кава з молоком',
      },
      { id: 'l', title: 'Обід · 13:10', value: `650${NB}ккал`, hasKcal: true, content: 'Борщ, хліб' },
      { id: 'd', title: 'Вечеря · 19:00', value: `560${NB}ккал`, hasKcal: true, content: 'Курка з овочами' },
    ]);
  });

  it('has nothing to show for a new client', () => {
    const m = nutritionModel(empty(), TODAY, 7);
    expect(m.hasBarData).toBe(false);
    expect(m.macroRows).toEqual([]);
    expect(m.journal).toEqual([]);
    expect(m.stats).toEqual([
      { label: 'Сер. за 7 повних днів', value: '—', unit: undefined, tone: undefined },
      { label: 'Днів із калоріями', value: '0' },
    ]);
  });

  it('labels a day «Вт, 13 жовтня»', () => {
    expect(dayLabel('2026-10-13')).toBe('Вт, 13 жовтня');
    expect(dayLabel('2026-10-18')).toBe('Нд, 18 жовтня');
  });
});
