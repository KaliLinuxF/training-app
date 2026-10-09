import { describe, expect, it } from 'vitest';
import {
  applyRecalc,
  draftStatus,
  draftsToItems,
  draftsTotal,
  editDraft,
  emptyDraft,
  needsRecalc,
  recalcRows,
  sameText,
  scaledByWeight,
  toDrafts,
  type DraftItem,
} from './drafts';

const ESTIMATE = [
  { name: 'Гречка', portion: '200 г', kcal: 220 },
  { name: 'Котлета куряча', portion: '1 шт', kcal: 180 },
  { name: 'Салат з огірків', portion: '100 г', kcal: 45 },
];

const drafts = () => toDrafts(ESTIMATE);

/** Applies edits to the row at `index`, as the card does keystroke by keystroke. */
function edit(
  ds: DraftItem[],
  index: number,
  ...edits: [field: 'name' | 'portion' | 'kcal', value: string][]
) {
  return ds.map((d, i) => (i === index ? edits.reduce((acc, [f, v]) => editDraft(acc, f, v), d) : d));
}

const at = (ds: DraftItem[], index: number): DraftItem => {
  const d = ds[index];
  if (!d) throw new Error(`no row ${index}`);
  return d;
};

describe('toDrafts', () => {
  it('keeps what the model said as each row’s base', () => {
    expect(at(drafts(), 0)).toEqual({
      id: 'i0',
      name: 'Гречка',
      portion: '200 г',
      kcalText: '220',
      base: { name: 'Гречка', portion: '200 г', kcal: 220 },
      pinned: false,
    });
    expect(drafts().map(draftStatus)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(recalcRows(drafts())).toBeNull();
  });
});

describe('editDraft', () => {
  it('a new amount of the same dish rescales kcal on the device, no recalculation needed', () => {
    const ds = edit(drafts(), 0, ['portion', '150 г']);
    expect(at(ds, 0).kcalText).toBe('165');
    expect(draftStatus(at(ds, 0))).toBe('scaled');
    expect(scaledByWeight(at(ds, 0))).toBe(true);
    expect(needsRecalc(at(ds, 0))).toBe(false);
    expect(recalcRows(ds)).toBeNull();
    // The scale always starts from what the model confirmed, not from the previous edit.
    expect(at(edit(ds, 0, ['portion', '0,4 кг']), 0).kcalText).toBe('440');
  });

  it('every keystroke is judged anew: a half-typed amount waits, the finished one scales', () => {
    let ds = drafts();
    for (const text of ['', '2', '25', '250', '250 ', '250 г']) ds = edit(ds, 0, ['portion', text]);
    expect(at(ds, 0).kcalText).toBe('275');
    expect(draftStatus(at(ds, 0))).toBe('scaled');
  });

  it('back to the confirmed portion restores the confirmed kcal', () => {
    const ds = edit(drafts(), 0, ['portion', '150 г'], ['portion', ' 200 Г']);
    expect(at(ds, 0).kcalText).toBe('220');
    expect(draftStatus(at(ds, 0))).toBe('confirmed');
  });

  it('another dish, an amount the device cannot compare, or other units need the model', () => {
    const renamed = edit(drafts(), 1, ['name', 'Котлета свиняча']);
    expect(draftStatus(at(renamed, 1))).toBe('changed');
    // The old number stays until the model answers.
    expect(at(renamed, 1).kcalText).toBe('180');
    expect(needsRecalc(at(renamed, 1))).toBe(true);

    expect(draftStatus(at(edit(drafts(), 1, ['portion', '2 шт']), 1))).toBe('changed');
    expect(draftStatus(at(edit(drafts(), 0, ['portion', '200 мл']), 0))).toBe('changed');
    expect(draftStatus(at(edit(drafts(), 0, ['portion', 'тарілка']), 0))).toBe('changed');
  });

  it('a renamed dish is not rescaled even when the amount is measurable', () => {
    const ds = edit(drafts(), 0, ['name', 'Рис'], ['portion', '100 г']);
    expect(at(ds, 0).kcalText).toBe('220');
    expect(draftStatus(at(ds, 0))).toBe('changed');
  });

  it('the name compares without case and extra spaces', () => {
    expect(sameText('  гречка ', 'Гречка')).toBe(true);
    expect(sameText('Котлета  куряча', 'котлета куряча')).toBe(true);
    const ds = edit(drafts(), 0, ['name', 'гречка '], ['portion', '100 г']);
    expect(at(ds, 0).kcalText).toBe('110');
    expect(draftStatus(at(ds, 0))).toBe('scaled');
  });

  it('kcal she types pins the row; a later name or portion change releases it', () => {
    const pinned = edit(drafts(), 1, ['name', 'Котлета свиняча'], ['kcal', '3 10']);
    expect(at(pinned, 1)).toMatchObject({ kcalText: '310', pinned: true });
    // Her own number: nothing to recalculate, no «змінено».
    expect(needsRecalc(at(pinned, 1))).toBe(false);
    expect(recalcRows(pinned)).toBeNull();

    const released = edit(pinned, 1, ['portion', '120 г']);
    expect(at(released, 1).pinned).toBe(false);
    expect(needsRecalc(at(released, 1))).toBe(true);

    // Pinned after a rescale: it is her number now, no «перераховано за вагою».
    const typed = edit(drafts(), 0, ['portion', '150 г'], ['kcal', '170']);
    expect(scaledByWeight(at(typed, 0))).toBe(false);
    expect(at(typed, 0).kcalText).toBe('170');
  });

  it('keeps names and portions within the data limits', () => {
    const ds = edit(drafts(), 0, ['name', 'а'.repeat(90)], ['portion', 'x'.repeat(70)]);
    expect(at(ds, 0).name).toHaveLength(80);
    expect(at(ds, 0).portion).toHaveLength(60);
  });
});

describe('rows she adds', () => {
  it('start empty and need the model once named', () => {
    const row = emptyDraft('n1');
    expect(draftStatus(row)).toBe('changed');
    // No name yet: nothing to send, and it does not count.
    expect(needsRecalc(row)).toBe(false);
    const named = editDraft(editDraft(row, 'name', 'Хліб'), 'portion', '30 г');
    expect(needsRecalc(named)).toBe(true);
    // Without a model value there is nothing to rescale from.
    expect(named.kcalText).toBe('');
  });

  it('nameless rows are left out of the total and of «Додати»', () => {
    const ds = [...drafts(), editDraft(emptyDraft('n1'), 'kcal', '50')];
    expect(draftsTotal(ds)).toBe(445);
    expect(draftsToItems(ds)).toHaveLength(3);
  });
});

describe('recalculation', () => {
  const edited = () =>
    edit(edit(drafts(), 0, ['portion', '150 г']), 1, ['name', ' Котлета свиняча '], ['portion', '120 г']);

  it('sends every named row with her names and portions, trimmed, in order', () => {
    const ds = [...edited(), emptyDraft('n1')];
    expect(recalcRows(ds)).toEqual([
      { id: 'i0', name: 'Гречка', portion: '150 г' },
      { id: 'i1', name: 'Котлета свиняча', portion: '120 г' },
      { id: 'i2', name: 'Салат з огірків', portion: '100 г' },
    ]);
  });

  it('only the rows marked «змінено» take the new kcal, which becomes their base', () => {
    const ds = edited();
    const sent = recalcRows(ds) ?? [];
    const answer = [
      { name: 'Гречка', portion: '150 г', kcal: 170 },
      { name: 'Котлета свиняча', portion: '120 г', kcal: 310.4 },
      { name: 'Салат з огірків', portion: '100 г', kcal: 50 },
    ];
    const next = applyRecalc(ds, sent, answer);
    expect(next.map((d) => d.kcalText)).toEqual(['165', '310', '45']);
    expect(at(next, 1).base).toEqual({ name: 'Котлета свиняча', portion: '120 г', kcal: 310 });
    expect(next.map(draftStatus)).toEqual(['scaled', 'confirmed', 'confirmed']);
    expect(recalcRows(next)).toBeNull();
    // Its grams now rescale from the new value.
    expect(at(edit(next, 1, ['portion', '240 г']), 1).kcalText).toBe('620');
    expect(draftsTotal(next)).toBe(520);
  });

  it('keeps her own kcal and any row she edited while the model was answering', () => {
    let ds = [...edited(), editDraft(editDraft(emptyDraft('n1'), 'name', 'Хліб'), 'kcal', '90')];
    const sent = recalcRows(ds) ?? [];
    expect(sent.map((r) => r.name)).toEqual(['Гречка', 'Котлета свиняча', 'Салат з огірків', 'Хліб']);
    ds = edit(ds, 1, ['portion', '150 г']);
    const answer = sent.map((r) => ({ name: r.name, portion: r.portion, kcal: 999 }));
    const next = applyRecalc(ds, sent, answer);
    expect(next.map((d) => d.kcalText)).toEqual(['165', '180', '45', '90']);
    expect(needsRecalc(at(next, 1))).toBe(true);
  });

  it('a row removed meanwhile is simply gone', () => {
    const ds = edited();
    const sent = recalcRows(ds) ?? [];
    const without = ds.filter((d) => d.id !== 'i1');
    const next = applyRecalc(
      without,
      sent,
      sent.map((r) => ({ ...r, kcal: 1 })),
    );
    expect(next).toEqual(without);
  });
});
