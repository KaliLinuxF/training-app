import type { FoodEstimateResponse } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { needsRecalc, type RecalcRow } from './drafts';
import { estimateReducer, IDLE, type EstimateAction, type EstimatePhase } from './estimate';
import { editorChanged, kcalSource, restorableName } from './itemEditorModel';

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
      editor: null,
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

describe('estimateReducer: the item editor', () => {
  const editor = (s: EstimatePhase) => {
    const r = result(s);
    if (!r.editor) throw new Error('no editor open');
    return r.editor;
  };

  it('opens on a row as a local draft: the list is untouched until «Готово»', () => {
    const open = run(resolved(), { type: 'openItem', itemId: 'i1' });
    expect(editor(open).item).toBe(result(open).drafts[1]);
    const edited = run(open, { type: 'editor', action: { type: 'name', value: 'Хліб житній' } });
    expect(editor(edited).item.name).toBe('Хліб житній');
    expect(result(edited).drafts[1]?.name).toBe('Хліб');

    const saved = result(run(edited, { type: 'saveItem' }));
    expect(saved.editor).toBeNull();
    expect(saved.drafts.map((d) => d.name)).toEqual(['Борщ', 'Хліб житній']);
    // Still waiting for the model: the old number until then.
    expect(saved.drafts[1]).toMatchObject({ kcalText: '80', base: { name: 'Хліб' } });
  });

  it('«Готово» on a new amount puts the rescaled row in place', () => {
    const s = result(
      run(
        resolved(),
        { type: 'openItem', itemId: 'i0' },
        { type: 'editor', action: { type: 'amount', text: '450' } },
        { type: 'saveItem' },
      ),
    );
    expect(s.drafts[0]).toMatchObject({ portion: '450 г', kcalText: '390' });
  });

  it('closing drops the draft; another row or no result opens nothing', () => {
    const s = run(
      resolved(),
      { type: 'openItem', itemId: 'i0' },
      { type: 'editor', action: { type: 'name', value: 'Рис' } },
      { type: 'closeItem' },
    );
    expect(result(s).editor).toBeNull();
    expect(result(s).drafts[0]?.name).toBe('Борщ');
    expect(run(resolved(), { type: 'openItem', itemId: 'nope' })).toEqual(resolved());
    expect(estimateReducer(IDLE, { type: 'openItem', itemId: 'i0' })).toBe(IDLE);
    expect(estimateReducer(IDLE, { type: 'saveItem' })).toBe(IDLE);
    // Nothing open: editor changes, «Готово» and closing do nothing.
    const r = resolved();
    expect(estimateReducer(r, { type: 'editor', action: { type: 'name', value: 'x' } })).toBe(r);
    expect(estimateReducer(r, { type: 'saveItem' })).toBe(r);
    expect(estimateReducer(r, { type: 'closeItem' })).toBe(r);
  });

  it('a new row joins the list only on «Додати позицію», and only with a name', () => {
    const open = run(resolved(), { type: 'newItem', itemId: 'n1' });
    expect(result(open).drafts).toHaveLength(2);
    expect(editor(open).original).toBeNull();
    // Nameless: «Додати позицію» does nothing.
    expect(run(open, { type: 'saveItem' })).toEqual(open);
    const added = result(
      run(
        open,
        { type: 'editor', action: { type: 'name', value: 'Чай' } },
        { type: 'editor', action: { type: 'kcal', value: '5' } },
        { type: 'saveItem' },
      ),
    );
    expect(added.editor).toBeNull();
    expect(added.drafts[2]).toEqual({
      id: 'n1',
      name: 'Чай',
      portion: '',
      kcalText: '5',
      base: null,
      pinned: true,
    });

    let full: EstimatePhase = resolved();
    for (let i = 0; i < 28; i++) full = estimateReducer(full, { type: 'add', itemId: `a${i}` });
    expect(result(full).drafts).toHaveLength(30);
    expect(result(estimateReducer(full, { type: 'newItem', itemId: 'n9' })).editor).toBeNull();
  });

  it('«Видалити позицію» removes the row and closes the editor on it', () => {
    const s = result(run(resolved(), { type: 'openItem', itemId: 'i0' }, { type: 'remove', itemId: 'i0' }));
    expect(s.editor).toBeNull();
    expect(s.drafts.map((d) => d.id)).toEqual(['i1']);
    // Another row removed meanwhile leaves the editor open.
    const other = result(
      run(resolved(), { type: 'openItem', itemId: 'i0' }, { type: 'remove', itemId: 'i1' }),
    );
    expect(other.editor?.item.id).toBe('i0');
  });

  it('a recalculation asked for in the editor prices its draft; the list row stays as it was', () => {
    const asked = result(
      run(
        resolved(),
        { type: 'openItem', itemId: 'i1' },
        { type: 'editor', action: { type: 'name', value: 'Хліб житній' } },
        { type: 'editor', action: { type: 'amount', text: '2' } },
        { type: 'recalcStart', id: 4 },
      ),
    );
    expect(asked.recalc).toEqual({ pending: 4, fromEditor: true });
    const sent: RecalcRow[] = [
      { id: 'i0', name: 'Борщ', portion: '300 г' },
      { id: 'i1', name: 'Хліб житній', portion: '2 скибки' },
    ];
    const res: FoodEstimateResponse = {
      photoId: null,
      items: [
        { name: 'Борщ', portion: '300 г', kcal: 999 },
        { name: 'Хліб житній', portion: '2 скибки', kcal: 170 },
      ],
      totalKcal: 0,
      comment: '',
    };
    const done = result(estimateReducer(asked, { type: 'recalcResolve', id: 4, rows: sent, res }));
    expect(done.editor?.item).toMatchObject({
      name: 'Хліб житній',
      kcalText: '170',
      base: { name: 'Хліб житній', portion: '2 скибки', kcal: 170 },
    });
    // Not applied yet: «Готово» does that.
    expect(done.drafts.map((d) => d.kcalText)).toEqual(['260', '80']);
    expect(done.recalc).toEqual({ pending: null, done: { id: 4, total: 340, fromEditor: true } });
    const saved = result(estimateReducer(done, { type: 'saveItem' }));
    expect(saved.drafts[1]).toMatchObject({ name: 'Хліб житній', kcalText: '170' });
  });

  it('a draft changed while the model works keeps waiting; a failure asked for in the editor stays there', () => {
    const asked = run(
      resolved(),
      { type: 'openItem', itemId: 'i1' },
      { type: 'editor', action: { type: 'name', value: 'Хліб житній' } },
      { type: 'recalcStart', id: 5 },
      { type: 'editor', action: { type: 'name', value: 'Хліб білий' } },
    );
    const sent: RecalcRow[] = [
      { id: 'i0', name: 'Борщ', portion: '300 г' },
      { id: 'i1', name: 'Хліб житній', portion: '1 скибка' },
    ];
    const res: FoodEstimateResponse = {
      photoId: null,
      items: sent.map((r) => ({ name: r.name, portion: r.portion, kcal: 1 })),
      totalKcal: 2,
      comment: '',
    };
    const done = result(estimateReducer(asked, { type: 'recalcResolve', id: 5, rows: sent, res }));
    expect(done.editor?.item).toMatchObject({ name: 'Хліб білий', kcalText: '80' });

    const failed = result(run(asked, { type: 'recalcFail', id: 5, message: 'Немає зʼєднання з сервером' }));
    expect(failed.recalc).toEqual({ pending: null, error: 'Немає зʼєднання з сервером', fromEditor: true });
  });

  it('a recalculation from the card is not the editor one even if she opens the editor meanwhile', () => {
    const s = result(run(resolved(), { type: 'recalcStart', id: 6 }, { type: 'openItem', itemId: 'i0' }));
    expect(s.recalc).toEqual({ pending: 6 });
  });

  it('reset drops the editor with the result', () => {
    expect(run(resolved(), { type: 'openItem', itemId: 'i0' }, { type: 'reset' })).toBe(IDLE);
  });
});

describe('estimateReducer: an answer and an open editor', () => {
  const editor = (s: EstimatePhase) => {
    const r = result(s);
    if (!r.editor) throw new Error('no editor open');
    return r.editor;
  };
  /** «Хліб» renamed in the list, then the card's «Перерахувати» (id 7). */
  const askedFromCard = () =>
    run(
      resolved(),
      { type: 'openItem', itemId: 'i1' },
      { type: 'editor', action: { type: 'name', value: 'Хліб житній' } },
      { type: 'saveItem' },
      { type: 'recalcStart', id: 7 },
    );
  const sent: RecalcRow[] = [
    { id: 'i0', name: 'Борщ', portion: '300 г' },
    { id: 'i1', name: 'Хліб житній', portion: '1 скибка' },
  ];
  const answer = (comment = ''): EstimateAction => ({
    type: 'recalcResolve',
    id: 7,
    rows: sent,
    res: {
      photoId: null,
      items: [
        { name: 'Борщ', portion: '300 г', kcal: 999 },
        { name: 'Хліб житній', portion: '1 скибка', kcal: 100 },
      ],
      totalKcal: 0,
      comment,
    },
  });

  it('a draft she changed meanwhile keeps her change on the model’s new numbers: «Готово» keeps them', () => {
    const open = run(
      askedFromCard(),
      { type: 'openItem', itemId: 'i1' },
      { type: 'editor', action: { type: 'step', dir: 1 } },
    );
    expect(editor(open).item).toMatchObject({ portion: '2 скибки', kcalText: '80' });
    const done = run(open, answer());
    expect(result(done).drafts[1]).toMatchObject({ portion: '1 скибка', kcalText: '100' });
    // Rescaled on the device from the answer: 2 × 100, nothing left for the model.
    expect(editor(done).item).toMatchObject({
      name: 'Хліб житній',
      portion: '2 скибки',
      kcalText: '200',
      base: { name: 'Хліб житній', portion: '1 скибка', kcal: 100 },
    });
    expect(editor(done).original).toBe(result(done).drafts[1]);
    expect(kcalSource(editor(done))).toEqual({ kind: 'scaled', group: 'count' });
    const saved = result(run(done, { type: 'saveItem' }));
    expect(saved.drafts[1]).toMatchObject({ portion: '2 скибки', kcalText: '200' });
    expect(saved.drafts.some(needsRecalc)).toBe(false);
  });

  it('an untouched draft becomes the priced row: nothing to ask about on ✕', () => {
    const done = run(askedFromCard(), { type: 'openItem', itemId: 'i1' }, answer());
    expect(editor(done).item).toEqual(result(done).drafts[1]);
    expect(editorChanged(editor(done))).toBe(false);
    expect(result(run(done, { type: 'closeItem' })).drafts[1]?.kcalText).toBe('100');
  });

  it('another name meanwhile still waits for the model, with «повернути» to the priced one', () => {
    const done = run(
      askedFromCard(),
      { type: 'openItem', itemId: 'i1' },
      { type: 'editor', action: { type: 'name', value: 'Хліб білий' } },
      answer(),
    );
    expect(editor(done).item).toMatchObject({ name: 'Хліб білий', kcalText: '80' });
    expect(needsRecalc(editor(done).item)).toBe(true);
    expect(restorableName(editor(done))).toBe('Хліб житній');
    const back = run(done, { type: 'editor', action: { type: 'restoreName' } });
    expect(editor(back).item.kcalText).toBe('100');
    expect(editorChanged(editor(back))).toBe(false);
  });

  it('kcal she typed meanwhile stay hers', () => {
    const done = run(
      askedFromCard(),
      { type: 'openItem', itemId: 'i1' },
      { type: 'editor', action: { type: 'kcal', value: '90' } },
      answer(),
    );
    expect(editor(done).item).toMatchObject({ kcalText: '90', pinned: true, base: { kcal: 100 } });
  });

  it('a row that did not take the answer leaves the editor on it alone', () => {
    const open = run(askedFromCard(), { type: 'openItem', itemId: 'i0' });
    const done = run(open, answer());
    expect(editor(done)).toBe(editor(open));
  });

  it('the card’s remark changes only when a row in the list took the answer', () => {
    expect(result(run(askedFromCard(), answer(' Житній темніший. '))).comment).toBe('Житній темніший.');
    // She changed the only row that needed it while the model worked: the remark is about nothing on screen.
    const changed = run(
      askedFromCard(),
      { type: 'openItem', itemId: 'i1' },
      { type: 'editor', action: { type: 'name', value: 'Хліб білий' } },
      { type: 'saveItem' },
      answer('Житній темніший.'),
    );
    expect(result(changed).comment).toBe('Приблизно.');
  });
});

describe('estimateReducer: a recalculation asked for in the editor', () => {
  /** The editor on «Хліб», renamed, its «Перерахувати» (id 8). */
  const asked = () =>
    run(
      resolved(),
      { type: 'openItem', itemId: 'i1' },
      { type: 'editor', action: { type: 'name', value: 'Хліб житній' } },
      { type: 'recalcStart', id: 8 },
    );
  const sent: RecalcRow[] = [
    { id: 'i0', name: 'Борщ', portion: '300 г' },
    { id: 'i1', name: 'Хліб житній', portion: '1 скибка' },
  ];
  const answer = (comment: string): EstimateAction => ({
    type: 'recalcResolve',
    id: 8,
    rows: sent,
    res: {
      photoId: null,
      items: sent.map((r) => ({ name: r.name, portion: r.portion, kcal: 100 })),
      totalKcal: 200,
      comment,
    },
  });
  const failed = () => run(asked(), { type: 'recalcFail', id: 8, message: 'Не вдалося' });

  it('its remark waits in the editor: the card gets it with her draft on «Готово», never on ✕', () => {
    const done = result(run(asked(), answer(' Житній темніший. ')));
    expect(done.editor?.comment).toBe('Житній темніший.');
    expect(done.comment).toBe('Приблизно.');
    expect(result(run(done, { type: 'closeItem' })).comment).toBe('Приблизно.');
    expect(result(run(done, { type: 'saveItem' })).comment).toBe('Житній темніший.');
    // No remark: the card's stays.
    expect(result(run(asked(), answer(''), { type: 'saveItem' })).comment).toBe('Приблизно.');
    // Her draft changed while the model worked: the remark is about a version no longer there.
    const moved = result(
      run(
        asked(),
        { type: 'editor', action: { type: 'name', value: 'Хліб білий' } },
        answer('Житній темніший.'),
      ),
    );
    expect(moved.editor?.comment).toBeUndefined();
    expect(moved.comment).toBe('Приблизно.');
  });

  it('its failure goes with the draft on ✕ or «Видалити позицію», quietly', () => {
    expect(result(failed()).recalc).toEqual({ pending: null, error: 'Не вдалося', fromEditor: true });
    const closed = result(run(failed(), { type: 'closeItem' }));
    // `fromEditor` stays: nothing to announce instead.
    expect(closed.recalc).toEqual({ pending: null, fromEditor: true });
    const removed = result(run(failed(), { type: 'remove', itemId: 'i1' }));
    expect(removed.recalc).toEqual({ pending: null, fromEditor: true });
    // A failure from the card is not the editor's to drop.
    const fromCard = run(
      resolved(),
      { type: 'edit', itemId: 'i1', field: 'name', value: 'Хліб житній' },
      { type: 'recalcStart', id: 9 },
      { type: 'recalcFail', id: 9, message: 'Не вдалося' },
      { type: 'openItem', itemId: 'i0' },
      { type: 'closeItem' },
    );
    expect(result(fromCard).recalc).toEqual({ pending: null, error: 'Не вдалося' });
  });

  it('kept with «Готово», it is the card’s: the failure shows there, not in the next editor', () => {
    const saved = result(run(failed(), { type: 'saveItem' }));
    expect(saved.recalc).toEqual({ pending: null, error: 'Не вдалося' });
    // Still running when she saves: the answer is announced with the card's new total.
    const running = run(asked(), { type: 'saveItem' });
    expect(result(running).recalc).toEqual({ pending: 8 });
    const done = result(run(running, answer('')));
    expect(done.drafts[1]?.kcalText).toBe('100');
    expect(done.recalc).toEqual({ pending: null, done: { id: 8, total: 360 } });
  });

  it('dropped while it runs: the answer prices only what the list still needs, quietly', () => {
    const dropped = run(asked(), { type: 'closeItem' });
    expect(result(dropped).recalc).toEqual({ pending: 8, fromEditor: true });
    const done = result(run(dropped, answer('Житній темніший.')));
    expect(done.drafts.map((d) => d.kcalText)).toEqual(['260', '80']);
    expect(done.comment).toBe('Приблизно.');
    expect(done.recalc.done).toEqual({ id: 8, total: 340, fromEditor: true });
    // A failure about nothing still in the list says nothing…
    expect(result(run(dropped, { type: 'recalcFail', id: 8, message: 'Не вдалося' })).recalc).toEqual({
      pending: null,
      fromEditor: true,
    });
    // …but one the list still waits for keeps its alert in the card.
    const otherDirty = run(
      resolved(),
      { type: 'edit', itemId: 'i0', field: 'name', value: 'Борщ зелений' },
      { type: 'openItem', itemId: 'i1' },
      { type: 'editor', action: { type: 'name', value: 'Хліб житній' } },
      { type: 'recalcStart', id: 8 },
      { type: 'closeItem' },
      { type: 'recalcFail', id: 8, message: 'Не вдалося' },
    );
    expect(result(otherDirty).recalc).toEqual({ pending: null, error: 'Не вдалося', fromEditor: true });
    // Opening a row then: the card's failure, not that editor's.
    expect(result(run(otherDirty, { type: 'openItem', itemId: 'i0' })).recalc).toEqual({
      pending: null,
      error: 'Не вдалося',
    });
  });

  it('dropped while it runs, then another row opened: «Рахую…» is the card’s, not that editor’s', () => {
    const s = result(run(asked(), { type: 'closeItem' }, { type: 'newItem', itemId: 'n1' }));
    expect(s.recalc).toEqual({ pending: 8 });
  });
});
