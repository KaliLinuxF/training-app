import { emptyData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { latestWeight, measurePlaceholders, sheetDateLabels, stepKcal, stepWeight, weightHint } from './helpers';
import { digitsOnly } from './validation';

describe('sheet helpers', () => {
  const data = emptyData();
  data.weights = [
    { date: '2026-09-26', kg: 66 },
    { date: '2026-10-03', kg: 65.6 },
    { date: '2026-10-10', kg: 65.4 },
  ];
  data.measures = [
    { date: '2026-09-26', chest: 93, waist: 74, hips: 101 },
    { date: '2026-10-03', chest: null, waist: 73.5, hips: 100 },
    { date: '2026-10-10', chest: 91, waist: 72, hips: 99 },
  ];

  it('header labels', () => {
    expect(sheetDateLabels('2026-10-10', '2026-10-10')).toEqual({ date: '10 жовтня 2026', weekday: 'субота · сьогодні' });
    expect(sheetDateLabels('2026-10-09', '2026-10-10')).toEqual({ date: '9 жовтня 2026', weekday: 'пʼятниця' });
  });

  it('weight hint: previous weigh-in before the date, else the morning tip', () => {
    expect(weightHint(data, '2026-10-10')).toBe('Попереднє: 3 жовтня — 65,6 кг');
    expect(weightHint(data, '2026-09-26')).toBe('Найточніше — зранку, натщесерце');
  });

  it('measurement placeholders: previous value of each parameter', () => {
    expect(measurePlaceholders(data, '2026-10-10')).toEqual({ chest: '93', waist: '73,5', hips: '100' });
    expect(measurePlaceholders(data, '2026-09-01')).toEqual({ chest: '—', waist: '—', hips: '—' });
  });

  it('weight stepper starts from the input, else the latest weigh-in, else 60', () => {
    expect(latestWeight(data)).toBe(65.4);
    expect(stepWeight('65,6', 65.4, -0.1)).toBe('65,5');
    expect(stepWeight('', 65.4, 0.1)).toBe('65,5');
    expect(stepWeight('', null, -0.1)).toBe('59,9');
    expect(stepWeight('60', 60, 0.5)).toBe('60,5');
  });

  it('kcal stepper never goes below zero', () => {
    expect(stepKcal('', 50)).toBe('50');
    expect(stepKcal('1650', -50)).toBe('1600');
    expect(stepKcal('20', -50)).toBe('0');
    expect(digitsOnly('1 650 ккал')).toBe('1650');
  });
});
