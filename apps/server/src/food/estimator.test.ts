import { LIMITS } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  applyRecalculation,
  FoodAiError,
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

describe('sanitizeRecalculation', () => {
  it('takes kcal by index and ignores the names and portions the model wrote', () => {
    const raw: RawEstimate = {
      items: [
        { name: 'Гречка', portion: '200 г', kcal: 412.4 },
        { name: 'Салат', portion: '1 миска', kcal: 95 },
      ],
      comment: '  Сметану враховано  ',
    };
    expect(sanitizeRecalculation(raw, 2)).toEqual({ kcal: [412, 95], comment: 'Сметану враховано' });
  });

  it('clamps kcal to the API limits and cuts a long comment', () => {
    const raw: RawEstimate = {
      items: [
        { name: 'a', portion: '', kcal: -20 },
        { name: 'b', portion: '', kcal: 1e9 },
        { name: 'c', portion: '', kcal: Number.NaN },
      ],
      comment: 'Порція приблизна. '.repeat(40),
    };
    const result = sanitizeRecalculation(raw, 3);
    expect(result.kcal).toEqual([0, LIMITS.kcal.max, 0]);
    expect(result.comment.length).toBeLessThanOrEqual(300);
  });

  it.each([
    ['fewer', 1],
    ['more', 3],
    ['no', 0],
  ])('fails with ai_failed when the model returns %s items', (_name, count) => {
    const raw: RawEstimate = {
      items: Array.from({ length: count }, (_, i) => ({ name: `Страва ${i}`, portion: '', kcal: 100 })),
      comment: '',
    };
    const err = thrown(() => sanitizeRecalculation(raw, 2));
    expect(err).toBeInstanceOf(FoodAiError);
    // The reason is logged: counts only, never her food.
    expect(err).toMatchObject({ code: 'ai_failed', reason: `model returned ${count} items for 2` });
  });
});

describe('applyRecalculation', () => {
  it('keeps her names and portions verbatim, in order, with the new kcal', () => {
    const result = applyRecalculation(sent, { kcal: [410, 95], comment: 'Сметану враховано' });
    expect(result).toEqual({
      items: [
        { name: 'Гречка з куркою', portion: '300 г', kcal: 410 },
        { name: 'Салат зі сметаною', portion: '', kcal: 95 },
      ],
      comment: 'Сметану враховано',
    });
    expect(totalKcal(result.items)).toBe(505);
  });

  it('trims what she sent and clamps kcal from any estimator', () => {
    const result = applyRecalculation([{ name: '  Борщ ', portion: ' 350 г ' }], {
      kcal: [99_999.7],
      comment: '',
    });
    expect(result.items).toEqual([{ name: 'Борщ', portion: '350 г', kcal: LIMITS.kcal.max }]);
    expect(applyRecalculation(sent, { kcal: [12.5, -3], comment: '' }).items.map((i) => i.kcal)).toEqual([
      13, 0,
    ]);
  });

  it('fails with ai_failed when the number of kcal values differs', () => {
    for (const kcal of [[410], [410, 95, 60], []]) {
      const err = thrown(() => applyRecalculation(sent, { kcal, comment: '' }));
      expect(err).toBeInstanceOf(FoodAiError);
      expect(err).toMatchObject({ code: 'ai_failed' });
    }
  });
});
