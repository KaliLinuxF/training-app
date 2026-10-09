import { describe, expect, it } from 'vitest';
import { parsePortion, scaleKcal } from './portion';

describe('parsePortion', () => {
  it('reads grams in every usual spelling', () => {
    for (const p of [
      '250 г',
      '250г',
      '~250 гр',
      '≈ 250 грам',
      '250 грамів',
      '250 g',
      '250 г.',
      '  250   Г ',
    ]) {
      expect(parsePortion(p), p).toEqual({ amount: 250, group: 'mass' });
    }
  });

  it('converts kilograms and litres, with comma or dot decimals', () => {
    expect(parsePortion('1,5 кг')).toEqual({ amount: 1500, group: 'mass' });
    expect(parsePortion('0.2 kg')).toEqual({ amount: 200, group: 'mass' });
    expect(parsePortion('300 мл')).toEqual({ amount: 300, group: 'volume' });
    expect(parsePortion('250ml')).toEqual({ amount: 250, group: 'volume' });
    expect(parsePortion('0,5 л')).toEqual({ amount: 500, group: 'volume' });
    expect(parsePortion('1 літр')).toEqual({ amount: 1000, group: 'volume' });
  });

  it('a count, a vague amount, a range or a bare number is not measurable', () => {
    for (const p of [
      '2 скибки',
      '1 шт',
      'тарілка',
      '',
      '300',
      '200-250 г',
      '2 × 150 г',
      '0 г',
      'г',
      'пів л',
    ]) {
      expect(parsePortion(p), p).toBeNull();
    }
  });
});

describe('scaleKcal', () => {
  const borshch = { portion: '300 г', kcal: 260 };

  it('scales proportionally within one unit group', () => {
    expect(scaleKcal(borshch, '150 г')).toBe(130);
    expect(scaleKcal(borshch, '~400 гр')).toBe(347);
    expect(scaleKcal({ portion: '0,5 кг', kcal: 600 }, '250 г')).toBe(300);
    expect(scaleKcal({ portion: '250 мл', kcal: 110 }, '0,5 л')).toBe(220);
  });

  it('cannot compare grams with millilitres or with counts', () => {
    expect(scaleKcal(borshch, '300 мл')).toBeNull();
    expect(scaleKcal(borshch, '2 тарілки')).toBeNull();
    expect(scaleKcal({ portion: '1 шт', kcal: 80 }, '150 г')).toBeNull();
  });

  it('stays within the kcal limits', () => {
    expect(scaleKcal({ portion: '10 г', kcal: 900 }, '1 кг')).toBe(20000);
  });
});
