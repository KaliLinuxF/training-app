import { LIMITS } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  applyRecalculation,
  clampMacro,
  FoodAiError,
  sanitizeEstimate,
  sanitizeRecalculation,
  totalKcal,
  type RawEstimate,
} from './estimator';

const sent = [
  { name: 'Гречка з куркою', portion: '300 г' },
  { name: 'Салат зі сметаною', portion: '' },
];

const thrown = (fn: () => unknown): unknown => {
  try {
    fn();
  } catch (err) {
    return err;
  }
  return null;
};

type RawItem = RawEstimate['items'][number];
const raw = (name: string, portion: string, kcal: number, p = 1, f = 1, c = 1): RawItem => ({
  name,
  portion,
  kcal,
  protein: p,
  fat: f,
  carbs: c,
});
const noMacros = { protein: null, fat: null, carbs: null };

describe('clampMacro', () => {
  it('rounds to 0.5 g within 0–1 000 g; non-finite or missing → null', () => {
    expect(clampMacro(12.3)).toBe(12.5);
    expect(clampMacro(12.2)).toBe(12);
    expect(clampMacro(-4)).toBe(0);
    expect(clampMacro(1e6)).toBe(LIMITS.macro.max);
    expect(clampMacro(Number.NaN)).toBeNull();
    expect(clampMacro(Number.POSITIVE_INFINITY)).toBeNull();
    expect(clampMacro(undefined)).toBeNull();
    expect(clampMacro('12')).toBeNull();
  });
});

describe('sanitizeEstimate', () => {
  it('sets all three macros on every item, rounded and clamped', () => {
    const result = sanitizeEstimate({
      items: [raw(' Борщ ', '300 г', 180.4, 6.2, 9, 19.3), raw('Пиво', '0,5 л', 215, 0, -1, 1e5)],
      comment: '',
    });
    expect(result.items).toEqual([
      { name: 'Борщ', portion: '300 г', kcal: 180, protein: 6, fat: 9, carbs: 19.5 },
      { name: 'Пиво', portion: '0,5 л', kcal: 215, protein: 0, fat: 0, carbs: LIMITS.macro.max },
    ]);
  });

  it('turns unusable macros into null instead of failing the estimate', () => {
    const odd = { name: 'Чай', portion: '', kcal: 2, protein: Number.NaN } as unknown as RawItem;
    expect(sanitizeEstimate({ items: [odd], comment: '' }).items).toEqual([
      { name: 'Чай', portion: '', kcal: 2, ...noMacros },
    ]);
  });
});

describe('sanitizeRecalculation', () => {
  it('takes kcal and macros by index and ignores the names and portions the model wrote', () => {
    const result = sanitizeRecalculation(
      {
        items: [raw('Гречка', '200 г', 412.4, 30.2, 12, 45), raw('Салат', '1 миска', 95, 2, 7.6, 5)],
        comment: '  Сметану враховано  ',
      },
      2,
    );
    expect(result).toEqual({
      kcal: [412, 95],
      macros: [
        { protein: 30, fat: 12, carbs: 45 },
        { protein: 2, fat: 7.5, carbs: 5 },
      ],
      comment: 'Сметану враховано',
    });
  });

  it('clamps kcal and macros to the API limits and cuts a long comment', () => {
    const result = sanitizeRecalculation(
      {
        items: [raw('a', '', -20, -1), raw('b', '', 1e9, 5000), raw('c', '', Number.NaN, Number.NaN)],
        comment: 'Порція приблизна. '.repeat(40),
      },
      3,
    );
    expect(result.kcal).toEqual([0, LIMITS.kcal.max, 0]);
    expect(result.macros.map((m) => m.protein)).toEqual([0, LIMITS.macro.max, null]);
    expect(result.comment.length).toBeLessThanOrEqual(300);
  });

  it.each([
    ['fewer', 1],
    ['more', 3],
    ['no', 0],
  ])('fails with ai_failed when the model returns %s items', (_name, count) => {
    const err = thrown(() =>
      sanitizeRecalculation(
        { items: Array.from({ length: count }, (_, i) => raw(`Страва ${i}`, '', 100)), comment: '' },
        2,
      ),
    );
    expect(err).toBeInstanceOf(FoodAiError);
    // The reason is logged: counts only, never her food.
    expect(err).toMatchObject({ code: 'ai_failed', reason: `model returned ${count} items for 2` });
  });
});

describe('applyRecalculation', () => {
  const macros = [
    { protein: 30, fat: 12, carbs: 45 },
    { protein: 2, fat: 7.5, carbs: 5 },
  ];

  it('keeps her names and portions verbatim, in order, with the new kcal and macros', () => {
    const result = applyRecalculation(sent, { kcal: [410, 95], macros, comment: 'Сметану враховано' });
    expect(result).toEqual({
      items: [
        { name: 'Гречка з куркою', portion: '300 г', kcal: 410, protein: 30, fat: 12, carbs: 45 },
        { name: 'Салат зі сметаною', portion: '', kcal: 95, protein: 2, fat: 7.5, carbs: 5 },
      ],
      comment: 'Сметану враховано',
    });
    expect(totalKcal(result.items)).toBe(505);
  });

  it('trims what she sent and clamps kcal and macros from any estimator; missing macros → null', () => {
    const result = applyRecalculation([{ name: '  Борщ ', portion: ' 350 г ' }], {
      kcal: [99_999.7],
      macros: [{ protein: 1e4, fat: 0.3, carbs: null }],
      comment: '',
    });
    expect(result.items).toEqual([
      {
        name: 'Борщ',
        portion: '350 г',
        kcal: LIMITS.kcal.max,
        protein: LIMITS.macro.max,
        fat: 0.5,
        carbs: null,
      },
    ]);
    const short = applyRecalculation(sent, { kcal: [12.5, -3], macros: [], comment: '' }).items;
    expect(short.map((i) => i.kcal)).toEqual([13, 0]);
    expect(short.map((i) => i.protein)).toEqual([null, null]);
  });

  it('fails with ai_failed when the number of kcal values differs', () => {
    for (const kcal of [[410], [410, 95, 60], []]) {
      const err = thrown(() => applyRecalculation(sent, { kcal, macros, comment: '' }));
      expect(err).toBeInstanceOf(FoodAiError);
      expect(err).toMatchObject({ code: 'ai_failed' });
    }
  });
});
