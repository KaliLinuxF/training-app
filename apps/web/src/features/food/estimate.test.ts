import type { FoodEstimateResponse } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import type { RecalcRow } from './drafts';
import { estimateReducer, IDLE, type EstimateAction, type EstimatePhase } from './estimate';

const RES: FoodEstimateResponse = {
  photoId: 'ph_0123456789abcdef',
  items: [
    { name: 'Борщ', portion: '300 г', kcal: 260 },
    { name: 'Хліб', portion: '1 скибка', kcal: 80 },
  ],
  totalKcal: 340,
  comment: '  Приблизно.  ',
};

const start = (id: number, photo = false, consumed = '') => ({ type: 'start', id, photo, consumed }) as const;

const run = (state: EstimatePhase, ...actions: EstimateAction[]): EstimatePhase =>
  actions.reduce(estimateReducer, state);

type Result = Extract<EstimatePhase, { kind: 'result' }>;

function result(state: EstimatePhase): Result {
  if (state.kind !== 'result') throw new Error(`expected a result, got ${state.kind}`);
  return state;
}

const resolved = () => result(run(IDLE, start(1, true), { type: 'resolve', id: 1, res: RES }));

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
        {
          id: 'i0',
          name: 'Борщ',
          portion: '300 г',
          kcalText: '260',
          base: { name: 'Борщ', portion: '300 г', kcal: 260 },
          pinned: false,
        },
        {
          id: 'i1',
          name: 'Хліб',
          portion: '1 скибка',
          kcalText: '80',
          base: { name: 'Хліб', portion: '1 скибка', kcal: 80 },
          pinned: false,
        },
      ],
      found: { count: 2, total: 340 },
      recalc: { pending: null },
    });
  });

  it('a text estimate keeps the «Що я їла» tail it will replace', () => {
    const loading = estimateReducer(IDLE, start(3, false, 'борщ, хліб'));
    const res = estimateReducer(loading, { type: 'resolve', id: 3, res: { ...RES, photoId: null } });
    expect(res).toMatchObject({ kind: 'result', photo: false, consumed: 'борщ, хліб', photoId: null });
  });

  it('ignores answers of cancelled or replaced requests', () => {
    const loading2 = estimateReducer(IDLE, start(2));
    expect(estimateReducer(loading2, { type: 'resolve', id: 1, res: RES })).toBe(loading2);
    expect(estimateReducer(loading2, { type: 'fail', id: 1, message: 'x' })).toBe(loading2);
    expect(estimateReducer(loading2, { type: 'preview', id: 1, preview: 'x' })).toBe(loading2);
    expect(estimateReducer(IDLE, { type: 'resolve', id: 2, res: RES })).toBe(IDLE);
  });

  it('a failure goes back to idle and keeps the reason until the next attempt or reset', () => {
    const failed = estimateReducer(estimateReducer(IDLE, start(2)), {
      type: 'fail',
      id: 2,
      message: 'Немає зʼєднання',
    });
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

  it('kcal edits are sanitised and pin the row; remove drops a row; what was found stays as announced', () => {
    const edited = result(
      estimateReducer(resolved(), { type: 'edit', itemId: 'i1', field: 'kcal', value: '1 60 ккал' }),
    );
    expect(edited.drafts[1]).toMatchObject({ kcalText: '160', pinned: true });
    const removed = result(estimateReducer(edited, { type: 'remove', itemId: 'i0' }));
    expect(removed.drafts.map((d) => d.name)).toEqual(['Хліб']);
    expect(removed.found).toEqual({ count: 2, total: 340 });
    expect(estimateReducer(removed, { type: 'reset' })).toBe(IDLE);
  });

  it('a new amount rescales at once; a new name marks the row for recalculation', () => {
    const s = result(
      run(
        resolved(),
        { type: 'edit', itemId: 'i0', field: 'portion', value: '450 г' },
        { type: 'edit', itemId: 'i1', field: 'name', value: 'Хліб житній' },
      ),
    );
    expect(s.drafts.map((d) => [d.name, d.portion, d.kcalText])).toEqual([
      ['Борщ', '450 г', '390'],
      ['Хліб житній', '1 скибка', '80'],
    ]);
    // Bases are untouched until the model confirms.
    expect(s.drafts[1]?.base).toEqual({ name: 'Хліб', portion: '1 скибка', kcal: 80 });
  });

  it('«+ позиція» appends an empty row, up to 30', () => {
    const s = result(estimateReducer(resolved(), { type: 'add', itemId: 'n1' }));
    expect(s.drafts[2]).toEqual({ id: 'n1', name: '', portion: '', kcalText: '', base: null, pinned: false });
    let full: EstimatePhase = s;
    for (let i = 2; i <= 40; i++) full = estimateReducer(full, { type: 'add', itemId: `n${i}` });
    expect(result(full).drafts).toHaveLength(30);
  });

  it('row edits outside a result are ignored', () => {
    const loading = estimateReducer(IDLE, start(1));
    expect(estimateReducer(loading, { type: 'add', itemId: 'n1' })).toBe(loading);
    expect(estimateReducer(loading, { type: 'edit', itemId: 'i0', field: 'name', value: 'x' })).toBe(loading);
    expect(estimateReducer(IDLE, { type: 'recalcStart', id: 2 })).toBe(IDLE);
  });
});

describe('estimateReducer: recalculation', () => {
  const rows: RecalcRow[] = [
    { id: 'i0', name: 'Борщ', portion: '300 г' },
    { id: 'i1', name: 'Хліб житній', portion: '2 скибки' },
  ];
  const answer = (kcal: [number, number], comment = ''): FoodEstimateResponse => ({
    photoId: 'ph_0123456789abcdef',
    items: rows.map((r, i) => ({ name: r.name, portion: r.portion, kcal: kcal[i] ?? 0 })),
    totalKcal: kcal[0] + kcal[1],
    comment,
  });
  const changed = () =>
    run(
      resolved(),
      { type: 'edit', itemId: 'i1', field: 'name', value: 'Хліб житній' },
      { type: 'edit', itemId: 'i1', field: 'portion', value: '2 скибки' },
    );

  it('start → the changed rows take the new kcal; the new total is kept for the announcement', () => {
    const pending = result(estimateReducer(changed(), { type: 'recalcStart', id: 2 }));
    expect(pending.recalc).toEqual({ pending: 2 });

    const done = result(
      estimateReducer(pending, { type: 'recalcResolve', id: 2, rows, res: answer([300, 170]) }),
    );
    // Борщ was not changed: it keeps its number even though the model priced it differently.
    expect(done.drafts.map((d) => d.kcalText)).toEqual(['260', '170']);
    expect(done.drafts[1]?.base).toEqual({ name: 'Хліб житній', portion: '2 скибки', kcal: 170 });
    expect(done.recalc).toEqual({ pending: null, done: { id: 2, total: 430 } });
    // No remark this time: the first one stays.
    expect(done.comment).toBe('Приблизно.');
    expect(done.found).toEqual({ count: 2, total: 340 });
  });

  it('a new remark from the model replaces the old one', () => {
    const s = run(
      changed(),
      { type: 'recalcStart', id: 2 },
      { type: 'recalcResolve', id: 2, rows, res: answer([1, 170], ' Житній — темніший. ') },
    );
    expect(result(s).comment).toBe('Житній — темніший.');
  });

  it('a failure keeps the rows and shows why until the next attempt', () => {
    const failed = result(
      run(
        changed(),
        { type: 'recalcStart', id: 2 },
        { type: 'recalcFail', id: 2, message: 'Немає зʼєднання з сервером' },
      ),
    );
    expect(failed.recalc).toEqual({ pending: null, error: 'Немає зʼєднання з сервером' });
    expect(failed.drafts[1]?.kcalText).toBe('80');
    expect(result(estimateReducer(failed, { type: 'recalcStart', id: 3 })).recalc).toEqual({ pending: 3 });
  });

  it('ignores answers of another recalculation or after the card closed', () => {
    const pending = run(changed(), { type: 'recalcStart', id: 3 });
    expect(estimateReducer(pending, { type: 'recalcResolve', id: 2, rows, res: answer([1, 2]) })).toBe(
      pending,
    );
    expect(estimateReducer(pending, { type: 'recalcFail', id: 2, message: 'x' })).toBe(pending);
    expect(estimateReducer(IDLE, { type: 'recalcResolve', id: 3, rows, res: answer([1, 2]) })).toBe(IDLE);
    const done = run(pending, { type: 'recalcResolve', id: 3, rows, res: answer([1, 2]) });
    expect(estimateReducer(done, { type: 'recalcResolve', id: 3, rows, res: answer([5, 5]) })).toBe(done);
  });

  it('a photo the server no longer has is dropped for the running recalculation only', () => {
    const pending = run(changed(), { type: 'recalcStart', id: 2 });
    // Another recalculation's news, or none running: ignored.
    expect(estimateReducer(pending, { type: 'photoGone', id: 1 })).toBe(pending);
    expect(estimateReducer(changed(), { type: 'photoGone', id: 2 })).toEqual(changed());
    expect(estimateReducer(IDLE, { type: 'photoGone', id: 2 })).toBe(IDLE);

    const gone = result(estimateReducer(pending, { type: 'photoGone', id: 2 }));
    expect(gone.photoId).toBeNull();
    // Still waiting for the answer (asked again without the photo), the thumbnail stays on the card.
    expect(gone.recalc).toEqual({ pending: 2 });
    expect(gone.preview).toBe(result(pending).preview);
    const done = result(run(gone, { type: 'recalcResolve', id: 2, rows, res: answer([1, 170]) }));
    expect(done.photoId).toBeNull();
    expect(done.drafts[1]?.kcalText).toBe('170');
  });

  it('she can keep editing while it runs; a row changed meanwhile keeps waiting', () => {
    const s = result(
      run(
        changed(),
        { type: 'recalcStart', id: 2 },
        { type: 'edit', itemId: 'i1', field: 'portion', value: '3 скибки' },
        { type: 'recalcResolve', id: 2, rows, res: answer([1, 170]) },
      ),
    );
    expect(s.drafts[1]).toMatchObject({ portion: '3 скибки', kcalText: '80' });
    expect(s.drafts[1]?.base?.name).toBe('Хліб');
  });
});
