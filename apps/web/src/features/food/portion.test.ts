import { describe, expect, it } from 'vitest';
import {
  amountStep,
  composePortion,
  convertAmount,
  formatAmount,
  MAX_AMOUNT,
  multiplyAmount,
  parseAmount,
  parsePortion,
  portionRatio,
  readPortion,
  sanitizeAmountInput,
  scaleKcal,
  stepAmount,
  unitForm,
} from './portion';

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

describe('readPortion', () => {
  it('reads counts in their Ukrainian forms (and a few Russian ones) as one canonical unit', () => {
    expect(readPortion('3 шт')).toEqual({ amount: 3, unit: 'шт' });
    expect(readPortion('3 шт.')).toEqual({ amount: 3, unit: 'шт' });
    expect(readPortion('2 штуки')).toEqual({ amount: 2, unit: 'шт' });
    expect(readPortion('1 скибка')).toEqual({ amount: 1, unit: 'скибка' });
    expect(readPortion('2 скибки')).toEqual({ amount: 2, unit: 'скибка' });
    expect(readPortion('5 скибок')).toEqual({ amount: 5, unit: 'скибка' });
    expect(readPortion('2 ложки')).toEqual({ amount: 2, unit: 'ложка' });
    expect(readPortion('1,5 порції')).toEqual({ amount: 1.5, unit: 'порція' });
    expect(readPortion('5 порцій')).toEqual({ amount: 5, unit: 'порція' });
    expect(readPortion('1 чашка')).toEqual({ amount: 1, unit: 'чашка' });
    expect(readPortion('2 склянки')).toEqual({ amount: 2, unit: 'склянка' });
    expect(readPortion('3 тарілки')).toEqual({ amount: 3, unit: 'тарілка' });
    expect(readPortion('2 шматки')).toEqual({ amount: 2, unit: 'шматок' });
    expect(readPortion('1 стакан')).toEqual({ amount: 1, unit: 'склянка' });
    expect(readPortion('2 ломтика')).toEqual({ amount: 2, unit: 'скибка' });
  });

  it('a bare count is one of it; a bare mass or volume unit says nothing', () => {
    expect(readPortion('тарілка')).toEqual({ amount: 1, unit: 'тарілка' });
    expect(readPortion('Чашка')).toEqual({ amount: 1, unit: 'чашка' });
    expect(readPortion('г')).toBeNull();
    expect(readPortion('мл')).toBeNull();
  });

  it('keeps the unit she wrote for mass and volume', () => {
    expect(readPortion('~250 гр')).toEqual({ amount: 250, unit: 'г' });
    expect(readPortion('0,15 кг')).toEqual({ amount: 0.15, unit: 'кг' });
    expect(readPortion('0,5 л')).toEqual({ amount: 0.5, unit: 'л' });
  });

  it('free text stays free text', () => {
    for (const p of ['2 ст. л.', 'велика тарілка', 'пів порції', 'скибка хліба', '0 шт', '1/2 шт', '300']) {
      expect(readPortion(p), p).toBeNull();
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

  it('scales by the count within the same count unit', () => {
    expect(scaleKcal({ portion: '1 шт', kcal: 80 }, '2 шт')).toBe(160);
    expect(scaleKcal({ portion: '3 шт', kcal: 420 }, '2 шт')).toBe(280);
    expect(scaleKcal({ portion: '2 скибки', kcal: 160 }, '5 скибок')).toBe(400);
    expect(scaleKcal({ portion: 'тарілка', kcal: 300 }, '1,5 тарілки')).toBe(450);
    expect(scaleKcal({ portion: '1 порція', kcal: 400 }, '0,5 порції')).toBe(200);
  });

  it('cannot compare grams with millilitres, with counts, or one count with another', () => {
    expect(scaleKcal(borshch, '300 мл')).toBeNull();
    expect(scaleKcal(borshch, '2 тарілки')).toBeNull();
    expect(scaleKcal({ portion: '1 шт', kcal: 80 }, '150 г')).toBeNull();
    expect(scaleKcal({ portion: '2 скибки', kcal: 160 }, '2 шт')).toBeNull();
    expect(scaleKcal({ portion: '2 ст. л.', kcal: 100 }, '4 ст. л.')).toBeNull();
  });

  it('stays within the kcal limits', () => {
    expect(scaleKcal({ portion: '10 г', kcal: 900 }, '1 кг')).toBe(20000);
  });

  it('portionRatio converts within mass and volume only', () => {
    expect(portionRatio({ amount: 0.5, unit: 'кг' }, { amount: 250, unit: 'г' })).toBe(0.5);
    expect(portionRatio({ amount: 1, unit: 'л' }, { amount: 250, unit: 'мл' })).toBe(0.25);
    expect(portionRatio({ amount: 1, unit: 'г' }, { amount: 1, unit: 'мл' })).toBeNull();
  });
});

describe('composing a portion', () => {
  it('plural forms after a number: 1 скибка, 2 скибки, 5 скибок, 21 скибка; «шт» and «г» never change', () => {
    expect([1, 2, 4, 5, 11, 12, 21, 22, 25].map((n) => unitForm('скибка', n))).toEqual([
      'скибка',
      'скибки',
      'скибки',
      'скибок',
      'скибок',
      'скибок',
      'скибка',
      'скибки',
      'скибок',
    ]);
    expect([1, 3, 5].map((n) => unitForm('ложка', n))).toEqual(['ложка', 'ложки', 'ложок']);
    expect([1, 3, 5].map((n) => unitForm('порція', n))).toEqual(['порція', 'порції', 'порцій']);
    expect([1, 3, 5].map((n) => unitForm('чашка', n))).toEqual(['чашка', 'чашки', 'чашок']);
    expect([1, 3, 5].map((n) => unitForm('склянка', n))).toEqual(['склянка', 'склянки', 'склянок']);
    expect([1, 3, 5].map((n) => unitForm('тарілка', n))).toEqual(['тарілка', 'тарілки', 'тарілок']);
    expect([1, 3, 5].map((n) => unitForm('шматок', n))).toEqual(['шматок', 'шматки', 'шматків']);
    expect([1, 3, 5].map((n) => unitForm('шт', n))).toEqual(['шт', 'шт', 'шт']);
    expect(unitForm('г', 1)).toBe('г');
  });

  it('a fraction takes the genitive singular: 1,5 порції, 0,5 ложки, 2,5 шматка', () => {
    expect(unitForm('порція', 1.5)).toBe('порції');
    expect(unitForm('ложка', 0.5)).toBe('ложки');
    expect(unitForm('шматок', 2.5)).toBe('шматка');
  });

  it('«<amount> <unit>» with comma decimals and no trailing zeros', () => {
    expect(composePortion(150, 'г')).toBe('150 г');
    expect(composePortion(2, 'скибка')).toBe('2 скибки');
    expect(composePortion(5, 'скибка')).toBe('5 скибок');
    expect(composePortion(1.5, 'порція')).toBe('1,5 порції');
    expect(composePortion(0.25, 'кг')).toBe('0,25 кг');
    expect(composePortion(3, 'шт')).toBe('3 шт');
    // Whole grams.
    expect(composePortion(62.5, 'г')).toBe('63 г');
    expect(formatAmount(0.1 + 0.2)).toBe('0,3');
  });

  it('reads back what it composes', () => {
    for (const [amount, unit] of [
      [150, 'г'],
      [2, 'скибка'],
      [1.5, 'порція'],
      [0.5, 'ложка'],
      [5, 'шматок'],
      [0.75, 'л'],
    ] as const) {
      expect(readPortion(composePortion(amount, unit))).toEqual({ amount, unit });
    }
  });
});

describe('steps and multipliers', () => {
  it('step by unit: г 10, мл 50, кг and л 0,1, counts 1', () => {
    const units = ['г', 'мл', 'кг', 'л', 'шт', 'скибка', 'порція'] as const;
    expect(units.map((u) => amountStep(u))).toEqual([10, 50, 0.1, 0.1, 1, 1, 1]);
  });

  it('+ and − go to the next multiple of the step', () => {
    expect(stepAmount(125, 'г', 1)).toBe(130);
    expect(stepAmount(130, 'г', 1)).toBe(140);
    expect(stepAmount(125, 'г', -1)).toBe(120);
    expect(stepAmount(130, 'г', -1)).toBe(120);
    expect(stepAmount(250, 'мл', 1)).toBe(300);
    expect(stepAmount(0.15, 'кг', 1)).toBe(0.2);
    expect(stepAmount(0.3, 'кг', 1)).toBe(0.4);
    expect(stepAmount(0.3, 'л', -1)).toBe(0.2);
    expect(stepAmount(3, 'шт', 1)).toBe(4);
    expect(stepAmount(1.5, 'шт', 1)).toBe(2);
    expect(stepAmount(1.5, 'шт', -1)).toBe(1);
  });

  it('− stops at the smallest amount: 10 г, 1 шт, half a portion or a spoon', () => {
    expect(stepAmount(10, 'г', -1)).toBeNull();
    expect(stepAmount(15, 'г', -1)).toBe(10);
    expect(stepAmount(5, 'г', -1)).toBeNull();
    expect(stepAmount(1, 'шт', -1)).toBeNull();
    expect(stepAmount(1, 'скибка', -1)).toBeNull();
    expect(stepAmount(1, 'порція', -1)).toBe(0.5);
    expect(stepAmount(1, 'ложка', -1)).toBe(0.5);
    expect(stepAmount(0.5, 'ложка', -1)).toBeNull();
    expect(stepAmount(0.5, 'порція', 1)).toBe(1);
  });

  it('+ from nothing starts the usual amount; − from nothing does nothing; + stops at the largest', () => {
    expect(stepAmount(null, 'г', 1)).toBe(100);
    expect(stepAmount(null, 'шт', 1)).toBe(1);
    expect(stepAmount(null, 'мл', 1)).toBe(250);
    expect(stepAmount(null, 'г', -1)).toBeNull();
    expect(stepAmount(MAX_AMOUNT, 'г', 1)).toBeNull();
    expect(stepAmount(9995, 'г', 1)).toBe(MAX_AMOUNT);
  });

  it('multiplies the reference amount: halves of a portion or a spoon, not of one piece', () => {
    expect(multiplyAmount({ amount: 200, unit: 'г' }, 0.5)).toEqual({ amount: 100, unit: 'г' });
    expect(multiplyAmount({ amount: 125, unit: 'г' }, 1.5)).toEqual({ amount: 188, unit: 'г' });
    expect(multiplyAmount({ amount: 3, unit: 'шт' }, 0.5)).toEqual({ amount: 1.5, unit: 'шт' });
    expect(multiplyAmount({ amount: 1, unit: 'порція' }, 0.5)).toEqual({ amount: 0.5, unit: 'порція' });
    expect(multiplyAmount({ amount: 1, unit: 'ложка' }, 0.5)).toEqual({ amount: 0.5, unit: 'ложка' });
    expect(multiplyAmount({ amount: 1, unit: 'шт' }, 0.5)).toBeNull();
    expect(multiplyAmount({ amount: 1, unit: 'скибка' }, 0.5)).toBeNull();
    expect(multiplyAmount({ amount: 1, unit: 'скибка' }, 2)).toEqual({ amount: 2, unit: 'скибка' });
  });

  it('another unit converts within its group, keeps the count between counts, else starts afresh', () => {
    expect(convertAmount(300, 'г', 'кг')).toBe(0.3);
    expect(convertAmount(0.25, 'л', 'мл')).toBe(250);
    expect(convertAmount(2, 'скибка', 'шт')).toBe(2);
    expect(convertAmount(300, 'г', 'шт')).toBe(1);
    expect(convertAmount(2, 'шт', 'г')).toBe(100);
    expect(convertAmount(2, 'шт', 'мл')).toBe(250);
    expect(convertAmount(null, 'г', 'шт')).toBeNull();
  });
});

describe('the amount field', () => {
  it('keeps digits and one decimal separator (comma or dot), 4 + 2 digits at most', () => {
    expect(sanitizeAmountInput('1,5')).toBe('1,5');
    expect(sanitizeAmountInput('1.5')).toBe('1.5');
    expect(sanitizeAmountInput('150 г')).toBe('150');
    expect(sanitizeAmountInput('1,2,3')).toBe('1,23');
    expect(sanitizeAmountInput('123456')).toBe('1234');
    expect(sanitizeAmountInput('0,125')).toBe('0,12');
    expect(sanitizeAmountInput('abc')).toBe('');
  });

  it('reads a positive number, comma allowed', () => {
    expect(parseAmount('1,5')).toBe(1.5);
    expect(parseAmount('1,')).toBe(1);
    expect(parseAmount(',5')).toBe(0.5);
    expect(parseAmount('')).toBeNull();
    expect(parseAmount('0')).toBeNull();
    expect(parseAmount(',')).toBeNull();
  });
});
