import { describe, expect, it } from 'vitest';
import {
  addDays,
  applyOps,
  appDataSchema,
  diffDays,
  emptyData,
  f0,
  f1,
  fN,
  mondayOf,
  normalizeSettings,
  num,
  opSchema,
  sgn,
  zonedNow,
} from './index';

describe('dates', () => {
  it('adds days across month and DST boundaries', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30');
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31');
  });

  it('finds the Monday of a week', () => {
    expect(mondayOf('2026-10-11')).toBe('2026-10-05'); // Sunday
    expect(mondayOf('2026-10-05')).toBe('2026-10-05'); // Monday
    expect(mondayOf('2026-10-09')).toBe('2026-10-05'); // Friday
  });

  it('counts whole days', () => {
    expect(diffDays('2026-10-01', '2026-10-09')).toBe(8);
    expect(diffDays('2026-03-28', '2026-03-30')).toBe(2);
  });

  it('reads wall-clock time in a zone', () => {
    const z = zonedNow('Europe/Kyiv', new Date('2026-10-09T05:30:00Z'));
    expect(z).toEqual({ date: '2026-10-09', hm: '08:30', weekday: 5, minutes: 510 });
    const w = zonedNow('Europe/Kyiv', new Date('2026-12-31T22:30:00Z'));
    expect(w.date).toBe('2027-01-01');
    expect(w.hm).toBe('00:30');
  });
});

describe('format', () => {
  it('formats numbers the Ukrainian way', () => {
    expect(f1(65.44)).toBe('65,4');
    expect(f1(null)).toBe('—');
    expect(fN(70)).toBe('70');
    expect(fN(70.25)).toBe('70,3');
    expect(f0(1650).replace(/\s/g, ' ')).toBe('1 650');
    expect(sgn(-0.4, f1)).toBe('−0,4');
    expect(sgn(2)).toBe('+2');
    expect(sgn(0.01)).toBe('0');
  });

  it('parses comma decimals', () => {
    expect(num('65,4')).toBe(65.4);
    expect(num('')).toBeNull();
    expect(num('abc')).toBeNull();
  });
});

describe('ops', () => {
  it('applies puts and deletes like the design prototype', () => {
    const d = applyOps(emptyData(), [
      { kind: 'day.put', date: '2026-10-10', value: { food: ' Омлет ', kcal: 1650, trained: true, types: ['Верх тіла'], notes: '' } },
      { kind: 'weight.put', date: '2026-10-10', kg: 65.4 },
      { kind: 'weight.put', date: '2026-10-03', kg: 66 },
      { kind: 'weight.put', date: '2026-10-10', kg: 65.3 },
      { kind: 'measure.put', date: '2026-10-10', value: { chest: 90, waist: 70, hips: null } },
    ]);
    expect(d.days['2026-10-10']).toEqual({ food: 'Омлет', kcal: 1650, trained: true, types: ['Верх тіла'], notes: '' });
    expect(d.weights).toEqual([
      { date: '2026-10-03', kg: 66 },
      { date: '2026-10-10', kg: 65.3 },
    ]);
    expect(d.measures).toEqual([{ date: '2026-10-10', chest: 90, waist: 70, hips: null }]);

    const cleared = applyOps(d, [
      { kind: 'day.put', date: '2026-10-10', value: { food: '', kcal: null, trained: null, types: [], notes: ' ' } },
      { kind: 'measure.put', date: '2026-10-10', value: { chest: null, waist: null, hips: null } },
    ]);
    expect(cleared.days).toEqual({});
    expect(cleared.measures).toEqual([]);
  });

  it('drops workout types when there was no workout', () => {
    const d = applyOps(emptyData(), [
      { kind: 'day.put', date: '2026-10-10', value: { food: '', kcal: null, trained: false, types: ['Кардіо'], notes: '' } },
    ]);
    expect(d.days['2026-10-10']?.types).toEqual([]);
  });

  it('validates ops', () => {
    expect(opSchema.safeParse({ kind: 'weight.put', date: '2026-02-30', kg: 60 }).success).toBe(false);
    expect(opSchema.safeParse({ kind: 'weight.put', date: '2026-02-28', kg: 5 }).success).toBe(false);
    expect(opSchema.safeParse({ kind: 'weight.put', date: '2026-02-28', kg: 60.5 }).success).toBe(true);
    expect(
      opSchema.safeParse({ kind: 'measure.put', date: '2026-02-28', value: { chest: null, waist: null, hips: null } })
        .success,
    ).toBe(false);
  });

  it('validates a full data export', () => {
    const data = { ...emptyData(), weights: [{ date: '2026-10-10', kg: 65.4 }] };
    expect(appDataSchema.safeParse(data).success).toBe(true);
    const dup = { ...data, weights: [...data.weights, { date: '2026-10-10', kg: 65 }] };
    expect(appDataSchema.safeParse(dup).success).toBe(false);
  });
});

describe('settings', () => {
  it('fills in missing fields', () => {
    const s = normalizeSettings({ goal: 58, rem: { weigh: { on: false } } as never });
    expect(s.goal).toBe(58);
    expect(s.rem.weigh).toEqual({ on: false, day: 1, time: '08:00' });
    expect(s.rem.workout.days).toEqual([1, 3, 5]);
    expect(s.customTypes).toEqual([]);
  });
});
