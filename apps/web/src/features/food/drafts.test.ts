import type { FoodEstimateItem } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  appendDrafts,
  applyRecalc,
  dishKcal,
  draftMacros,
  draftStatus,
  draftsToItems,
  draftsTotal,
  draftsTotals,
  editDraft,
  emptyDraft,
  fromMealItems,
  knownItem,
  MAX_ROWS,
  needsRecalc,
  putDraft,
  rebaseDraft,
  recalcRows,
  sameDraft,
  sameText,
  scaledOnDevice,
  toDrafts,
  type DraftField,
  type DraftItem,
} from './drafts';

const ESTIMATE: FoodEstimateItem[] = [
  { name: 'Гречка', portion: '200 г', kcal: 220, protein: 8, fat: 2, carbs: 44 },
  { name: 'Котлета куряча', portion: '1 шт', kcal: 180, protein: 16, fat: 11, carbs: 5 },
  { name: 'Салат з огірків', portion: '100 г', kcal: 45, protein: 1, fat: 3.5, carbs: 3 },
];

const drafts = () => toDrafts(ESTIMATE);

/** Applies edits to the row at `index`, as the editor does keystroke by keystroke. */
function edit(ds: DraftItem[], index: number, ...edits: [field: DraftField, value: string][]) {
  return ds.map((d, i) => (i === index ? edits.reduce((acc, [f, v]) => editDraft(acc, f, v), d) : d));
}

const at = (ds: DraftItem[], index: number): DraftItem => {
  const d = ds[index];
  if (!d) throw new Error(`no row ${index}`);
  return d;
};

/** The macro texts of a row: [Б, Ж, В]. */
const macros = (d: DraftItem) => [d.proteinText, d.fatText, d.carbsText];

/** A price from the model for a row (no macros unless given). */
const priced = (
  name: string,
  portion: string,
  kcal: number,
  m: Partial<FoodEstimateItem> = {},
): FoodEstimateItem => ({
  name,
  portion,
  kcal,
  protein: null,
  fat: null,
  carbs: null,
  ...m,
});

describe('toDrafts / fromMealItems', () => {
  it('keeps what the model said as each row’s base, macros included', () => {
    expect(at(drafts(), 0)).toEqual({
      id: 'i0',
      name: 'Гречка',
      portion: '200 г',
      kcalText: '220',
      proteinText: '8',
      fatText: '2',
      carbsText: '44',
      base: ESTIMATE[0],
      pinned: false,
      macrosPinned: false,
    });
    expect(at(drafts(), 2).fatText).toBe('3,5');
    expect(drafts().map(draftStatus)).toEqual(['confirmed', 'confirmed', 'confirmed']);
    expect(recalcRows(drafts())).toBeNull();
  });

  it('rows of an estimate carry its id and are fresh (recorded in «Часті страви» with the meal)', () => {
    const rows = toDrafts(ESTIMATE.slice(0, 1), { prefix: 'e3.', estimateId: 'e3' });
    expect(rows[0]).toMatchObject({ id: 'e3.0', fresh: true, estimateId: 'e3' });
    expect(at(drafts(), 0)).not.toHaveProperty('fresh');
  });

  it('a saved meal’s positions are their own base: not fresh, not pinned, unknown macros empty', () => {
    const rows = fromMealItems([
      { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, protein: 9, fat: 6, carbs: 58 },
      { name: 'Яблуко', portion: '1 шт', kcal: 80, protein: null, fat: null, carbs: null },
    ]);
    expect(rows.map((d) => d.id)).toEqual(['m0', 'm1']);
    expect(rows[1]).toMatchObject({ kcalText: '80', proteinText: '', pinned: false, macrosPinned: false });
    expect(rows[0]).not.toHaveProperty('fresh');
    expect(rows.map(draftStatus)).toEqual(['confirmed', 'confirmed']);
    // Its amount rescales on the device from what was saved.
    expect(macros(editDraft(at(rows, 0), 'portion', '500 г'))).toEqual(['18', '12', '116']);
    expect(fromMealItems(undefined)).toEqual([]);
  });
});

describe('editDraft', () => {
  it('a new amount of the same dish rescales kcal and macros on the device, no recalculation needed', () => {
    const ds = edit(drafts(), 0, ['portion', '150 г']);
    expect(at(ds, 0).kcalText).toBe('165');
    expect(macros(at(ds, 0))).toEqual(['6', '1,5', '33']);
    expect(draftStatus(at(ds, 0))).toBe('scaled');
    expect(scaledOnDevice(at(ds, 0))).toBe(true);
    expect(needsRecalc(at(ds, 0))).toBe(false);
    expect(recalcRows(ds)).toBeNull();
    // The scale always starts from what the model confirmed, not from the previous edit.
    const kg = at(edit(ds, 0, ['portion', '0,4 кг']), 0);
    expect([kg.kcalText, ...macros(kg)]).toEqual(['440', '16', '4', '88']);
  });

  it('every keystroke is judged anew: a half-typed amount waits, the finished one scales', () => {
    let ds = drafts();
    for (const text of ['', '2', '25', '250', '250 ', '250 г']) ds = edit(ds, 0, ['portion', text]);
    expect(at(ds, 0).kcalText).toBe('275');
    expect(macros(at(ds, 0))).toEqual(['10', '2,5', '55']);
    expect(draftStatus(at(ds, 0))).toBe('scaled');
  });

  it('back to the confirmed portion restores the confirmed numbers', () => {
    const ds = edit(drafts(), 0, ['portion', '150 г'], ['portion', ' 200 Г']);
    expect(at(ds, 0).kcalText).toBe('220');
    expect(macros(at(ds, 0))).toEqual(['8', '2', '44']);
    expect(draftStatus(at(ds, 0))).toBe('confirmed');
  });

  it('another dish, an amount the device cannot compare, or other units need the model', () => {
    const renamed = edit(drafts(), 1, ['name', 'Котлета свиняча']);
    expect(draftStatus(at(renamed, 1))).toBe('changed');
    // The old numbers stay until the model answers.
    expect(at(renamed, 1).kcalText).toBe('180');
    expect(macros(at(renamed, 1))).toEqual(['16', '11', '5']);
    expect(needsRecalc(at(renamed, 1))).toBe(true);

    expect(draftStatus(at(edit(drafts(), 1, ['portion', '150 г']), 1))).toBe('changed');
    expect(draftStatus(at(edit(drafts(), 1, ['portion', '2 скибки']), 1))).toBe('changed');
    expect(draftStatus(at(edit(drafts(), 0, ['portion', '200 мл']), 0))).toBe('changed');
    expect(draftStatus(at(edit(drafts(), 0, ['portion', 'тарілка']), 0))).toBe('changed');
  });

  it('more of the same count unit rescales like grams do', () => {
    const two = edit(drafts(), 1, ['portion', '2 шт']);
    expect(at(two, 1).kcalText).toBe('360');
    expect(macros(at(two, 1))).toEqual(['32', '22', '10']);
    expect(draftStatus(at(two, 1))).toBe('scaled');
    expect(scaledOnDevice(at(two, 1))).toBe(true);
    expect(recalcRows(two)).toBeNull();
    expect(at(edit(drafts(), 1, ['portion', '1,5 шт']), 1).kcalText).toBe('270');
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
    expect(scaledOnDevice(at(typed, 0))).toBe(false);
    expect(at(typed, 0).kcalText).toBe('170');
  });

  it('typed kcal rescale the unpinned macros by typed / reference kcal, always from the reference', () => {
    // 440 of the model's 220 kcal: twice the macros.
    let row = at(drafts(), 0);
    for (const value of ['4', '44', '440']) row = editDraft(row, 'kcal', value);
    expect(row).toMatchObject({ kcalText: '440', pinned: true, macrosPinned: false });
    expect(macros(row)).toEqual(['16', '4', '88']);
    // The reference is what the device knows for that name and amount: 150 г → 165 kcal.
    const scaled = editDraft(editDraft(at(drafts(), 0), 'portion', '150 г'), 'kcal', '330');
    expect(macros(scaled)).toEqual(['12', '3', '66']);
    // Cleared while she retypes: unknown for a moment (nothing typed is nothing known).
    expect(macros(editDraft(at(drafts(), 0), 'kcal', ''))).toEqual(['', '', '']);
  });

  it('typed kcal without a reference (another dish, a new row, 0 kcal) leave the macros unknown', () => {
    const renamed = edit(drafts(), 1, ['name', 'Котлета свиняча'], ['kcal', '300']);
    expect(macros(at(renamed, 1))).toEqual(['', '', '']);
    const added = editDraft(editDraft(emptyDraft('n1'), 'name', 'Чай'), 'kcal', '5');
    expect(macros(added)).toEqual(['', '', '']);
    const water = toDrafts([priced('Вода', '250 мл', 0, { protein: 0, fat: 0, carbs: 0 })]);
    expect(macros(editDraft(at(water, 0), 'kcal', '10'))).toEqual(['', '', '']);
  });

  it('a macro she types pins the macros (as a set): typed kcal and a recalculation keep them', () => {
    const typed = edit(drafts(), 0, ['protein', '10,5']);
    expect(at(typed, 0)).toMatchObject({
      proteinText: '10,5',
      fatText: '2',
      macrosPinned: true,
      pinned: false,
    });
    expect(draftMacros(at(typed, 0))).toEqual({ protein: 10.5, fat: 2, carbs: 44 });
    const kcal = edit(typed, 0, ['kcal', '440']);
    expect(macros(at(kcal, 0))).toEqual(['10,5', '2', '44']);
    // Comma or dot, 0,5 g steps; anything else is dropped.
    expect(at(edit(drafts(), 0, ['fat', '3.7 г']), 0).fatText).toBe('3.7');
    expect(draftMacros(at(edit(drafts(), 0, ['fat', '3.7']), 0)).fat).toBe(3.5);
  });

  it('a name or portion change releases both pins and takes what the device knows', () => {
    const typed = edit(drafts(), 0, ['protein', '20'], ['kcal', '300']);
    expect(at(typed, 0)).toMatchObject({ pinned: true, macrosPinned: true });
    const released = edit(typed, 0, ['portion', '100 г']);
    expect(at(released, 0)).toMatchObject({ pinned: false, macrosPinned: false, kcalText: '110' });
    expect(macros(at(released, 0))).toEqual(['4', '1', '22']);
    // Unknown to the device: the numbers stay and the row waits for the model.
    const renamed = edit(typed, 0, ['name', 'Рис']);
    expect(at(renamed, 0)).toMatchObject({
      pinned: false,
      macrosPinned: false,
      kcalText: '300',
      proteinText: '20',
    });
    expect(needsRecalc(at(renamed, 0))).toBe(true);
  });

  it('keeps names and portions within the data limits', () => {
    const ds = edit(drafts(), 0, ['name', 'а'.repeat(90)], ['portion', 'x'.repeat(70)]);
    expect(at(ds, 0).name).toHaveLength(80);
    expect(at(ds, 0).portion).toHaveLength(60);
  });

  it('knownItem: the confirmed numbers or their rescale, else nothing', () => {
    expect(knownItem(at(drafts(), 0))).toEqual({ kcal: 220, protein: 8, fat: 2, carbs: 44 });
    expect(knownItem(editDraft(at(drafts(), 0), 'portion', '100 г'))).toEqual({
      kcal: 110,
      protein: 4,
      fat: 1,
      carbs: 22,
    });
    expect(knownItem(editDraft(at(drafts(), 0), 'name', 'Рис'))).toBeNull();
    expect(knownItem(emptyDraft('n1'))).toBeNull();
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

  it('nameless rows are left out of the totals and of the saved meal', () => {
    const ds = [...drafts(), editDraft(emptyDraft('n1'), 'kcal', '50')];
    expect(draftsTotal(ds)).toBe(445);
    expect(draftsToItems(ds)).toHaveLength(3);
  });
});

describe('totals and the saved positions', () => {
  it('«Разом»: kcal and the sums of the known macros', () => {
    expect(draftsTotals(drafts())).toEqual({ kcal: 445, macros: { protein: 25, fat: 16.5, carbs: 52 } });
    const partial = [...drafts(), editDraft(editDraft(emptyDraft('n1'), 'name', 'Чай'), 'kcal', '5')];
    expect(draftsTotals(partial)).toEqual({ kcal: 450, macros: { protein: 25, fat: 16.5, carbs: 52 } });
    expect(draftsTotals([])).toEqual({ kcal: 0, macros: { protein: null, fat: null, carbs: null } });
  });

  it('draftsToItems: trimmed names and portions, kcal, macros in 0.5 g (unknown → null)', () => {
    const row = editDraft(
      editDraft(editDraft(emptyDraft('n1'), 'name', ' Чай '), 'kcal', '5'),
      'carbs',
      '1,2',
    );
    expect(draftsToItems([row])).toEqual([
      { name: 'Чай', portion: '', kcal: 5, protein: null, fat: null, carbs: 1 },
    ]);
  });
});

describe('appendDrafts', () => {
  it('appends what fits under 30 and says which rows did', () => {
    const rows = toDrafts(ESTIMATE, { prefix: 'e2.', estimateId: 'e2' });
    const some = appendDrafts(drafts(), rows);
    expect(some.drafts).toHaveLength(6);
    expect(some.added).toEqual(rows);
    const full = Array.from({ length: MAX_ROWS - 1 }, (_, i) => emptyDraft(`f${i}`));
    const capped = appendDrafts(full, rows);
    expect(MAX_ROWS).toBe(30);
    expect(capped.drafts).toHaveLength(30);
    expect(capped.added.map((d) => d.id)).toEqual(['e2.0']);
    expect(appendDrafts(capped.drafts, rows).added).toEqual([]);
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

  it('only the rows marked «змінено» take the new kcal and macros, which become their base', () => {
    const ds = edited();
    const sent = recalcRows(ds) ?? [];
    const answer = [
      priced('Гречка', '150 г', 170, { protein: 9, fat: 9, carbs: 9 }),
      priced('Котлета свиняча', '120 г', 310.4, { protein: 22.3, fat: 24, carbs: 0 }),
      priced('Салат з огірків', '100 г', 50, { protein: 9, fat: 9, carbs: 9 }),
    ];
    const next = applyRecalc(ds, sent, answer);
    expect(next.map((d) => d.kcalText)).toEqual(['165', '310', '45']);
    expect(macros(at(next, 1))).toEqual(['22,5', '24', '0']);
    expect(at(next, 1).base).toEqual(
      priced('Котлета свиняча', '120 г', 310, { protein: 22.5, fat: 24, carbs: 0 }),
    );
    expect(macros(at(next, 0))).toEqual(['6', '1,5', '33']);
    expect(next.map(draftStatus)).toEqual(['scaled', 'confirmed', 'confirmed']);
    expect(recalcRows(next)).toBeNull();
    // Its grams now rescale from the new values.
    const more = at(edit(next, 1, ['portion', '240 г']), 1);
    expect([more.kcalText, ...macros(more)]).toEqual(['620', '45', '48', '0']);
    expect(draftsTotal(next)).toBe(520);
  });

  it('macros she typed survive it; the kcal (not pinned) still come from the model', () => {
    const ds = edit(edited(), 1, ['protein', '30']);
    const sent = recalcRows(ds) ?? [];
    const answer = sent.map((r) => priced(r.name, r.portion, 300, { protein: 1, fat: 2, carbs: 3 }));
    const next = applyRecalc(ds, sent, answer);
    expect(at(next, 1)).toMatchObject({ kcalText: '300', proteinText: '30', fatText: '11', carbsText: '5' });
    expect(at(next, 1).base).toMatchObject({ kcal: 300, protein: 1 });
  });

  it('keeps her own kcal and any row she edited while the model was answering', () => {
    let ds = [...edited(), editDraft(editDraft(emptyDraft('n1'), 'name', 'Хліб'), 'kcal', '90')];
    const sent = recalcRows(ds) ?? [];
    expect(sent.map((r) => r.name)).toEqual(['Гречка', 'Котлета свиняча', 'Салат з огірків', 'Хліб']);
    ds = edit(ds, 1, ['portion', '150 г']);
    const answer = sent.map((r) => priced(r.name, r.portion, 999));
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
      sent.map((r) => priced(r.name, r.portion, 1)),
    );
    expect(next).toEqual(without);
  });
});

describe('putDraft / sameDraft', () => {
  it('replaces the row with the same id in place, or appends a new one up to MAX_ROWS', () => {
    const ds = drafts();
    const edited = editDraft(at(ds, 1), 'name', 'Котлета свиняча');
    const put = putDraft(ds, edited);
    expect(put.map((d) => d.name)).toEqual(['Гречка', 'Котлета свиняча', 'Салат з огірків']);
    // The input is left alone.
    expect(at(ds, 1).name).toBe('Котлета куряча');

    const added = putDraft(ds, editDraft(emptyDraft('n1'), 'name', 'Хліб'));
    expect(added.map((d) => d.id)).toEqual(['i0', 'i1', 'i2', 'n1']);

    const full = Array.from({ length: MAX_ROWS }, (_, i) => emptyDraft(`f${i}`));
    expect(putDraft(full, emptyDraft('extra'))).toHaveLength(MAX_ROWS);
  });

  it('compares everything a row carries, the model’s base included', () => {
    const row = at(drafts(), 0);
    expect(sameDraft(row, { ...row, base: row.base && { ...row.base } })).toBe(true);
    expect(sameDraft(row, { ...row, kcalText: '221' })).toBe(false);
    expect(sameDraft(row, { ...row, fatText: '2,5' })).toBe(false);
    expect(sameDraft(row, { ...row, pinned: true })).toBe(false);
    expect(sameDraft(row, { ...row, macrosPinned: true })).toBe(false);
    expect(sameDraft(row, { ...row, base: priced('Гречка', '200 г', 230) })).toBe(false);
    expect(sameDraft(row, { ...row, base: { ...ESTIMATE[0]!, protein: 9 } })).toBe(false);
    expect(sameDraft(row, { ...row, base: null })).toBe(false);
    expect(sameDraft(emptyDraft('n1'), emptyDraft('n1'))).toBe(true);
    // Whose pinned number it is counts too; an absent mark is the same as `false`.
    const pinned = editDraft(row, 'kcal', '230');
    expect(sameDraft(pinned, dishKcal(row, { kcal: 230, protein: null, fat: null, carbs: null }))).toBe(
      false,
    );
    expect(sameDraft(pinned, { ...pinned, fromDish: false })).toBe(true);
  });
});

describe('numbers from «Часті страви»', () => {
  const coffee = { kcal: 60, protein: 3, fat: 3, carbs: 5 };

  it('are pinned like typed ones but marked as the dish’s; any edit of hers removes the mark', () => {
    const row = dishKcal(emptyDraft('n1'), coffee);
    expect(row).toEqual({
      id: 'n1',
      name: '',
      portion: '',
      kcalText: '60',
      proteinText: '3',
      fatText: '3',
      carbsText: '5',
      base: null,
      pinned: true,
      macrosPinned: true,
      fromDish: true,
    });
    expect(needsRecalc(editDraft(row, 'name', 'Кава'))).toBe(true);
    for (const field of ['name', 'portion', 'kcal'] as const) {
      expect(editDraft(row, field, '70')).not.toHaveProperty('fromDish');
    }
    expect(editDraft(row, 'kcal', '70')).toMatchObject({ kcalText: '70', pinned: true, proteinText: '3' });
  });

  it('a dish without macros leaves them unknown — unless she pinned her own', () => {
    const plain = { kcal: 80, protein: null, fat: null, carbs: null };
    const fromModel = dishKcal(at(drafts(), 1), plain);
    expect(fromModel).toMatchObject({ kcalText: '80', macrosPinned: false });
    expect(macros(fromModel)).toEqual(['', '', '']);
    const hers = dishKcal(editDraft(at(drafts(), 1), 'protein', '20'), plain);
    expect(hers).toMatchObject({ kcalText: '80', macrosPinned: true, proteinText: '20' });
  });
});

describe('rebaseDraft', () => {
  const pork = priced('Котлета свиняча', '1 шт', 310, { protein: 20, fat: 25, carbs: 0 });
  const renamed = () => editDraft(at(drafts(), 1), 'name', 'Котлета свиняча');

  it('her amount of the priced dish is rescaled from the new numbers, macros too', () => {
    const two = editDraft(renamed(), 'portion', '2 шт');
    expect(two.kcalText).toBe('180');
    const next = rebaseDraft(two, pork);
    expect(next).toMatchObject({ portion: '2 шт', kcalText: '620', base: pork, pinned: false });
    expect(macros(next)).toEqual(['40', '50', '0']);
    expect(needsRecalc(next)).toBe(false);
  });

  it('another dish keeps its numbers and waits; kcal or macros she typed stay hers', () => {
    const other = rebaseDraft(editDraft(renamed(), 'name', 'Котлета яловича'), pork);
    expect(other).toMatchObject({ kcalText: '180', base: pork });
    expect(needsRecalc(other)).toBe(true);
    const typed = rebaseDraft(editDraft(renamed(), 'kcal', '250'), pork);
    expect(typed).toMatchObject({ kcalText: '250', pinned: true, base: pork });
    const dish = rebaseDraft(dishKcal(renamed(), { kcal: 250, protein: null, fat: null, carbs: null }), pork);
    expect(dish).toMatchObject({ kcalText: '250', pinned: true, fromDish: true, base: pork });
    const grams = rebaseDraft(editDraft(renamed(), 'fat', '30'), pork);
    expect(grams).toMatchObject({ kcalText: '310', fatText: '30', proteinText: '16', macrosPinned: true });
  });
});
