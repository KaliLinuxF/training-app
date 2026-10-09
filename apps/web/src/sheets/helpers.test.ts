import { emptyData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  latestWeight,
  measurePlaceholders,
  sheetDateLabels,
  stepBaseWeight,
  stepKcal,
  stepWeight,
  weightBefore,
  weightHint,
} from './helpers';
import { digitsOnly, FIELD_ERRORS, textError } from './validation';

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

  it('weigh-in before a date: what the weigh-in sheet offers on a past day without one', () => {
    expect(weightBefore(data, '2026-10-05')).toBe(65.6);
    expect(weightBefore(data, '2026-10-10')).toBe(65.6);
    expect(weightBefore(data, '2026-10-11')).toBe(65.4);
    expect(weightBefore(data, '2026-09-26')).toBeNull();
    // ± starts there too; before the first weigh-in, from the latest one.
    expect(stepBaseWeight(data, '2026-10-05')).toBe(65.6);
    expect(stepBaseWeight(data, '2026-09-01')).toBe(65.4);
    expect(stepBaseWeight(emptyData(), '2026-09-01')).toBeNull();
  });

  it('steppers stay within a range when one is given (the goals)', () => {
    const kg = { min: 30, max: 200 };
    expect(stepWeight('30', 60, -0.5, kg)).toBe('30,0');
    expect(stepWeight('199,8', 60, 0.5, kg)).toBe('200,0');
    expect(stepWeight('', 60, 0.5, kg)).toBe('60,5');
    const kcal = { min: 800, max: 5000 };
    expect(stepKcal('', 50, kcal)).toBe('800');
    expect(stepKcal('5000', 50, kcal)).toBe('5000');
    expect(stepKcal('1700', -50, kcal)).toBe('1650');
  });

  it('free text must fit the server limit once trimmed', () => {
    expect(textError('а'.repeat(5000))).toBeUndefined();
    expect(textError(`  ${'а'.repeat(5000)}  `)).toBeUndefined();
    expect(textError('а'.repeat(5001))).toBe(FIELD_ERRORS.text);
    expect(FIELD_ERRORS.text).toBe('Задовгий текст — не більше 5 000 символів');
  });
});
