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

const start = (id: number, photo = false, consumed = '') =>
  ({ type: 'start', id, photo, consumed }) as const;

describe('estimateReducer', () => {
  it('start → preview → result', () => {
    let s: EstimatePhase = estimateReducer(IDLE, start(1, true));
    expect(s).toEqual({ kind: 'loading', id: 1, photo: true, consumed: '', preview: null });
    s = estimateReducer(s, { type: 'preview', id: 1, preview: 'data:image/jpeg;base64,AA' });
    s = estimateReducer(s, { type: 'resolve', id: 1, res: RES });
    expect(s).toEqual({
      kind: 'result',
      id: 1,
      photo: true,
      consumed: '',
      preview: 'data:image/jpeg;base64,AA',
      photoId: 'ph_0123456789abcdef',
      comment: 'Приблизно.',
      drafts: [
        { id: 'i0', name: 'Борщ', portion: '300 г', kcalText: '260' },
        { id: 'i1', name: 'Хліб', portion: '1 скибка', kcalText: '80' },
      ],
      found: { count: 2, total: 340 },
    });
  });

  it('a text estimate keeps the «Що я їла» tail it will replace', () => {
    const loading = estimateReducer(IDLE, start(3, false, 'борщ, хліб'));
    const result = estimateReducer(loading, { type: 'resolve', id: 3, res: { ...RES, photoId: null } });
    expect(result).toMatchObject({ kind: 'result', photo: false, consumed: 'борщ, хліб', photoId: null });
  });

  it('ignores answers of cancelled or replaced requests', () => {
    const loading2 = estimateReducer(IDLE, start(2));
    expect(estimateReducer(loading2, { type: 'resolve', id: 1, res: RES })).toBe(loading2);
    expect(estimateReducer(loading2, { type: 'fail', id: 1, message: 'x' })).toBe(loading2);
    expect(estimateReducer(loading2, { type: 'preview', id: 1, preview: 'x' })).toBe(loading2);
    expect(estimateReducer(IDLE, { type: 'resolve', id: 2, res: RES })).toBe(IDLE);
  });

  it('a failure goes back to idle and keeps the reason until the next attempt or reset', () => {
    const failed = estimateReducer(estimateReducer(IDLE, start(2)), { type: 'fail', id: 2, message: 'Немає зʼєднання' });
    expect(failed).toEqual({ kind: 'idle', error: 'Немає зʼєднання' });
    expect(estimateReducer(failed, start(3))).toEqual({
      kind: 'loading',
      id: 3,
      photo: false,
      consumed: '',
      preview: null,
    });
    expect(estimateReducer(failed, { type: 'reset' })).toBe(IDLE);
  });

  it('edits sanitise kcal and remove drops a row; what was found stays as announced', () => {
    const result = estimateReducer(estimateReducer(IDLE, start(1)), { type: 'resolve', id: 1, res: RES });
    const edited = estimateReducer(result, { type: 'edit', itemId: 'i1', kcalText: '1 60 ккал' });
    expect(edited.kind === 'result' && edited.drafts[1]?.kcalText).toBe('160');
    const removed = estimateReducer(edited, { type: 'remove', itemId: 'i0' });
    expect(removed.kind === 'result' && removed.drafts.map((d) => d.name)).toEqual(['Хліб']);
    expect(removed.kind === 'result' && removed.found).toEqual({ count: 2, total: 340 });
    expect(estimateReducer(removed, { type: 'reset' })).toBe(IDLE);
  });
});
