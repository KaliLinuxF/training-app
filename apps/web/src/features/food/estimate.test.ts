import type { FoodEstimateResponse } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { estimateReducer, IDLE, type EstimatePhase } from './estimate';

const RES: FoodEstimateResponse = {
  photoId: 'ph_0123456789abcdef',
  items: [
    { name: 'Борщ', portion: '300 г', kcal: 260 },
    { name: 'Хліб', portion: '1 скибка', kcal: 80 },
  ],
  totalKcal: 340,
  comment: '  Приблизно.  ',
};

describe('estimateReducer', () => {
  it('start → preview → result', () => {
    let s: EstimatePhase = estimateReducer(IDLE, { type: 'start', id: 1, photo: true });
    expect(s).toEqual({ kind: 'loading', id: 1, photo: true, preview: null });
    s = estimateReducer(s, { type: 'preview', id: 1, preview: 'data:image/jpeg;base64,AA' });
    s = estimateReducer(s, { type: 'resolve', id: 1, res: RES });
    expect(s).toEqual({
      kind: 'result',
      id: 1,
      preview: 'data:image/jpeg;base64,AA',
      photoId: 'ph_0123456789abcdef',
      comment: 'Приблизно.',
      drafts: [
        { id: 'i0', name: 'Борщ', portion: '300 г', kcalText: '260' },
        { id: 'i1', name: 'Хліб', portion: '1 скибка', kcalText: '80' },
      ],
    });
  });

  it('ignores answers of cancelled or replaced requests', () => {
    const loading2 = estimateReducer(IDLE, { type: 'start', id: 2, photo: false });
    expect(estimateReducer(loading2, { type: 'resolve', id: 1, res: RES })).toBe(loading2);
    expect(estimateReducer(loading2, { type: 'fail', id: 1 })).toBe(loading2);
    expect(estimateReducer(loading2, { type: 'preview', id: 1, preview: 'x' })).toBe(loading2);
    expect(estimateReducer(IDLE, { type: 'resolve', id: 2, res: RES })).toBe(IDLE);
    expect(estimateReducer(loading2, { type: 'fail', id: 2 })).toBe(IDLE);
  });

  it('edits sanitise kcal and remove drops a row', () => {
    const result = estimateReducer(estimateReducer(IDLE, { type: 'start', id: 1, photo: false }), {
      type: 'resolve',
      id: 1,
      res: RES,
    });
    const edited = estimateReducer(result, { type: 'edit', itemId: 'i1', kcalText: '1 60 ккал' });
    expect(edited.kind === 'result' && edited.drafts[1]?.kcalText).toBe('160');
    const removed = estimateReducer(edited, { type: 'remove', itemId: 'i0' });
    expect(removed.kind === 'result' && removed.drafts.map((d) => d.name)).toEqual(['Хліб']);
    expect(estimateReducer(removed, { type: 'reset' })).toBe(IDLE);
  });
});
