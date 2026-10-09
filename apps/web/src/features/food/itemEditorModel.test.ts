import type { FoodItem } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { editDraft, needsRecalc, toDrafts, type DraftItem } from './drafts';
import {
  canSave,
  canStep,
  dishSuggestions,
  editorChanged,
  editorReducer,
  kcalNote,
  kcalSource,
  multiplierChoices,
  newEditor,
  openEditor,
  referencePortion,
  restorableName,
  unitChoices,
  type EditorAction,
  type ItemEditorState,
} from './itemEditorModel';

const ROWS = toDrafts([
  { name: 'Гречка', portion: '200 г', kcal: 220 },
  { name: 'Сирники зі сметаною', portion: '3 шт', kcal: 420 },
  { name: 'Суп', portion: 'велика тарілка', kcal: 300 },
  { name: 'Хліб', portion: '2 скибки', kcal: 160 },
  { name: 'Сметана', portion: '', kcal: 60 },
]);

function row(i: number): DraftItem {
  const d = ROWS[i];
  if (!d) throw new Error(`no row ${i}`);
  return d;
}

const run = (s: ItemEditorState, ...actions: EditorAction[]) => actions.reduce(editorReducer, s);

const FOODS: FoodItem[] = [
  { name: 'Сирники', portion: '3 шт', kcal: 450, count: 5, lastUsed: '2026-10-01' },
  { name: 'Борщ', portion: '300 г', kcal: 180, count: 3, lastUsed: '2026-10-05' },
  { name: 'Борщ зелений', portion: '300 г', kcal: 150, count: 1, lastUsed: '2026-10-06' },
  { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, count: 9, lastUsed: '2026-10-08' },
  { name: 'Яблуко', portion: '1 шт', kcal: 80, count: 4, lastUsed: '2026-10-02' },
  { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, count: 6, lastUsed: '2026-10-07' },
  { name: 'Курка з рисом', portion: '350 г', kcal: 520, count: 2, lastUsed: '2026-10-03' },
];

describe('opening the editor', () => {
  it('on a row: the amount field and unit come from its portion', () => {
    expect(openEditor(row(0))).toEqual({
      item: row(0),
      original: row(0),
      amountText: '200',
      unit: 'г',
      textMode: false,
      manualKcal: false,
      dish: null,
    });
    expect(openEditor(row(1))).toMatchObject({ amountText: '3', unit: 'шт', textMode: false });
    expect(openEditor(row(3))).toMatchObject({ amountText: '2', unit: 'скибка', textMode: false });
  });

  it('a portion it cannot read stays free text; an empty one starts with grams', () => {
    expect(openEditor(row(2))).toMatchObject({ amountText: '', textMode: true });
    expect(openEditor(row(4))).toMatchObject({ amountText: '', unit: 'г', textMode: false });
  });

  it('a new row starts empty and is not «changed» until she types', () => {
    const s = newEditor('n1');
    expect(s.original).toBeNull();
    expect(s.item).toEqual({ id: 'n1', name: '', portion: '', kcalText: '', base: null, pinned: false });
    expect(editorChanged(s)).toBe(false);
    expect(canSave(s)).toBe(false);
    expect(editorChanged(run(s, { type: 'amount', text: '1' }))).toBe(true);
    expect(canSave(run(s, { type: 'name', value: 'Чай' }))).toBe(true);
  });
});

describe('amount', () => {
  it('a new amount composes the portion and rescales kcal from the model, live', () => {
    const s = run(openEditor(row(0)), { type: 'amount', text: '150' });
    expect(s.item).toMatchObject({ portion: '150 г', kcalText: '165', pinned: false });
    expect(kcalSource(s)).toEqual({ kind: 'scaled', group: 'mass' });
    expect(kcalNote(kcalSource(s))).toBe('перераховано за вагою');
    expect(editorChanged(s)).toBe(true);
    // Back to the model's amount: back to its number, nothing changed.
    const back = run(s, { type: 'amount', text: '200' });
    expect(back.item.kcalText).toBe('220');
    expect(kcalSource(back)).toEqual({ kind: 'model' });
    expect(editorChanged(back)).toBe(false);
  });

  it('counts rescale too, and the portion takes the right plural form', () => {
    const s = run(
      openEditor(row(3)),
      { type: 'step', dir: 1 },
      { type: 'step', dir: 1 },
      { type: 'step', dir: 1 },
    );
    expect(s.item).toMatchObject({ portion: '5 скибок', kcalText: '400' });
    expect(kcalNote(kcalSource(s))).toBe('перераховано за кількістю');
    const two = run(openEditor(row(1)), { type: 'amount', text: '2' });
    expect(two.item).toMatchObject({ portion: '2 шт', kcalText: '280' });
  });

  it('comma decimals; a half-typed amount is judged as it stands; anything but digits is dropped', () => {
    let s = openEditor(row(1));
    for (const text of ['', '1', '1,', '1,5']) s = run(s, { type: 'amount', text });
    expect(s.amountText).toBe('1,5');
    expect(s.item).toMatchObject({ portion: '1,5 шт', kcalText: '210' });
    expect(run(s, { type: 'amount', text: '2 шт' }).amountText).toBe('2');
    // Cleared: no portion (the model's number stays until she types one).
    const cleared = run(s, { type: 'amount', text: '' });
    expect(cleared.item.portion).toBe('');
    expect(needsRecalc(cleared.item)).toBe(true);
  });

  it('− / + step by the unit and stop where the unit stops', () => {
    const g = openEditor(row(0));
    expect(run(g, { type: 'step', dir: 1 }).item.portion).toBe('210 г');
    expect(run(g, { type: 'step', dir: -1 }).item.portion).toBe('190 г');
    const one = run(openEditor(row(1)), { type: 'amount', text: '1' });
    expect(canStep(one, -1)).toBe(false);
    expect(run(one, { type: 'step', dir: -1 })).toBe(one);
    expect(canStep(one, 1)).toBe(true);
    // + from an empty amount starts the unit's usual amount.
    expect(run(openEditor(row(4)), { type: 'step', dir: 1 }).item.portion).toBe('100 г');
  });

  it('another unit converts within its group, else starts afresh — and asks the model', () => {
    const kg = run(openEditor(row(0)), { type: 'unit', unit: 'кг' });
    expect(kg).toMatchObject({ amountText: '0,2', unit: 'кг' });
    expect(kg.item).toMatchObject({ portion: '0,2 кг', kcalText: '220' });
    const pieces = run(openEditor(row(0)), { type: 'unit', unit: 'шт' });
    expect(pieces.item.portion).toBe('1 шт');
    expect(kcalSource(pieces)).toEqual({ kind: 'needsAi', isNew: false });
    expect(kcalNote(kcalSource(pieces))).toBe('змінено — уточни калорії');
    // Picking the unit an empty amount already has changes nothing.
    const s = openEditor(row(4));
    expect(run(s, { type: 'unit', unit: 'г' })).toBe(s);
    // Without an amount only the unit changes.
    expect(run(s, { type: 'unit', unit: 'ложка' })).toMatchObject({ unit: 'ложка', item: row(4) });
  });

  it('«½ · ×1 · 1½ · ×2» multiply the model’s amount; the matching one is pressed', () => {
    const s = openEditor(row(0));
    expect(multiplierChoices(s)).toEqual([
      { factor: 0.5, label: '½', portion: '100 г', active: false },
      { factor: 1, label: '×1', portion: '200 г', active: true },
      { factor: 1.5, label: '1½', portion: '300 г', active: false },
      { factor: 2, label: '×2', portion: '400 г', active: false },
    ]);
    const half = run(s, { type: 'multiply', factor: 0.5 });
    expect(half.item).toMatchObject({ portion: '100 г', kcalText: '110' });
    expect(multiplierChoices(half).map((m) => m.active)).toEqual([true, false, false, false]);
    // From another unit, ×1 goes back to the model's amount and unit.
    const back = run(
      s,
      { type: 'unit', unit: 'кг' },
      { type: 'amount', text: '1' },
      { type: 'multiply', factor: 1 },
    );
    expect(back).toMatchObject({ amountText: '200', unit: 'г' });
    expect(back.item.kcalText).toBe('220');
  });

  it('half of one piece is not offered, half a portion is; no model amount, no multipliers', () => {
    const one = editDraft(
      { ...row(1), base: { name: 'Яблуко', portion: '1 шт', kcal: 80 } },
      'name',
      'Яблуко',
    );
    expect(multiplierChoices(openEditor(one))[0]).toMatchObject({ label: '½', portion: null });
    const portion = {
      ...row(1),
      portion: '1 порція',
      base: { name: 'Сирники зі сметаною', portion: '1 порція', kcal: 400 },
    };
    expect(multiplierChoices(openEditor(portion))[0]).toMatchObject({ portion: '0,5 порції' });
    expect(multiplierChoices(newEditor('n1'))).toEqual([]);
    expect(multiplierChoices(openEditor(row(2)))).toEqual([]);
    expect(run(newEditor('n1'), { type: 'multiply', factor: 2 }).item.portion).toBe('');
  });
});

describe('name', () => {
  it('another dish needs the model; «повернути» brings the model’s name (and its numbers) back', () => {
    const s = run(openEditor(row(0)), { type: 'amount', text: '100' }, { type: 'name', value: 'Рис' });
    expect(kcalSource(s)).toEqual({ kind: 'needsAi', isNew: false });
    expect(restorableName(s)).toBe('Гречка');
    const back = run(s, { type: 'restoreName' });
    expect(back.item).toMatchObject({ name: 'Гречка', portion: '100 г', kcalText: '110' });
    expect(restorableName(back)).toBeNull();
    // Case and spaces do not count as another dish.
    expect(restorableName(run(s, { type: 'name', value: ' гречка ' }))).toBeNull();
    // A new row has no model name to go back to.
    expect(run(newEditor('n1'), { type: 'restoreName' }).item.name).toBe('');
  });

  it('a new row with a name waits for the model: «ще не пораховано»', () => {
    const s = run(newEditor('n1'), { type: 'name', value: 'Сметана' });
    expect(kcalSource(s)).toEqual({ kind: 'needsAi', isNew: true });
    expect(kcalNote(kcalSource(s))).toBe('ще не пораховано');
    expect(kcalSource(newEditor('n1'))).toEqual({ kind: 'empty' });
    expect(kcalNote({ kind: 'empty' })).toBeNull();
  });
});

describe('kcal by hand', () => {
  it('typed kcal pin the row; a new amount afterwards lets them go (the rule of the rows)', () => {
    const s = run(openEditor(row(1)), { type: 'name', value: 'Млинці' }, { type: 'kcal', value: '3 5 0' });
    expect(s.item).toMatchObject({ kcalText: '350', pinned: true });
    expect(s.manualKcal).toBe(true);
    expect(kcalSource(s)).toEqual({ kind: 'manual' });
    expect(kcalNote(kcalSource(s))).toBe('вписано вручну');
    expect(needsRecalc(s.item)).toBe(false);
    const more = run(s, { type: 'amount', text: '4' });
    expect(more.item.pinned).toBe(false);
    expect(needsRecalc(more.item)).toBe(true);
  });

  it('«Вписати вручну» shows the field without changing anything', () => {
    const s = run(openEditor(row(0)), { type: 'manualKcal' });
    expect(s.manualKcal).toBe(true);
    expect(editorChanged(s)).toBe(false);
  });
});

describe('«Часті страви» suggestions', () => {
  it('match what she typed anywhere in the name, case-insensitively, most used first, top 5', () => {
    const borshch = run(openEditor(row(0)), { type: 'name', value: 'БОРЩ' });
    expect(dishSuggestions(FOODS, borshch).map((d) => d.name)).toEqual(['Борщ', 'Борщ зелений']);
    const s = run(openEditor(row(0)), { type: 'name', value: 'з' });
    expect(dishSuggestions(FOODS, s).map((d) => d.name)).toEqual([
      'Кава з молоком',
      'Вівсянка з бананом',
      'Курка з рисом',
      'Борщ зелений',
    ]);
    // Nothing typed yet (a new row): the most used ones.
    expect(dishSuggestions(FOODS, newEditor('n1'))).toHaveLength(5);
    expect(dishSuggestions(FOODS, newEditor('n1'))[0]).toEqual({
      name: 'Кава з молоком',
      portion: '1 чашка',
      kcal: 60,
    });
    expect(dishSuggestions(FOODS, run(s, { type: 'name', value: 'піца' }))).toEqual([]);
  });

  it('picking one takes its name, portion and kcal — hers, so no model needed', () => {
    const s = run(
      newEditor('n1'),
      { type: 'name', value: 'сир' },
      { type: 'dish', dish: { name: 'Сирники', portion: '3 шт', kcal: 450 } },
    );
    expect(s.item).toMatchObject({ name: 'Сирники', portion: '3 шт', kcalText: '450', pinned: true });
    expect(s).toMatchObject({ amountText: '3', unit: 'шт', textMode: false });
    expect(kcalSource(s)).toEqual({ kind: 'dish' });
    expect(kcalNote(kcalSource(s))).toBe('як у «Частих стравах»');
    expect(needsRecalc(s.item)).toBe(false);
    // The one already picked is not suggested again.
    expect(dishSuggestions(FOODS, s).map((d) => d.name)).toEqual([]);
    // Multipliers follow the dish.
    expect(referencePortion(s)).toEqual({ amount: 3, unit: 'шт' });
  });

  it('her amount rescales the dish’s kcal (still hers); another name or unit lets the dish go', () => {
    const s = run(newEditor('n1'), { type: 'dish', dish: { name: 'Сирники', portion: '3 шт', kcal: 450 } });
    const two = run(s, { type: 'step', dir: -1 });
    expect(two.item).toMatchObject({ portion: '2 шт', kcalText: '300', pinned: true });
    expect(two.dish).not.toBeNull();
    const renamed = run(two, { type: 'name', value: 'Сирники з родзинками' });
    expect(renamed.dish).toBeNull();
    expect(renamed.item.pinned).toBe(false);
    expect(needsRecalc(renamed.item)).toBe(true);
    const grams = run(s, { type: 'unit', unit: 'г' });
    expect(grams.dish).toBeNull();
    expect(needsRecalc(grams.item)).toBe(true);
    // Her own number replaces the dish's.
    const typed = run(s, { type: 'kcal', value: '500' });
    expect(typed).toMatchObject({ dish: null, item: { kcalText: '500', pinned: true } });
    expect(typed.item.fromDish).toBeUndefined();
    expect(kcalSource(typed)).toEqual({ kind: 'manual' });
  });

  const coffee = { name: 'Кава з молоком', portion: '1 чашка', kcal: 60 };

  it('the dish waits while she retypes the amount: empty, then «2»', () => {
    const picked = run(newEditor('n1'), { type: 'dish', dish: coffee });
    expect(picked.item.fromDish).toBe(true);
    const empty = run(picked, { type: 'amount', text: '' });
    // Nothing to scale yet: the dish and its last number stay, nothing for the model.
    expect(empty.dish).toEqual(coffee);
    expect(empty.item).toMatchObject({ portion: '', kcalText: '60', pinned: true, fromDish: true });
    expect(kcalSource(empty)).toEqual({ kind: 'dish' });
    expect(needsRecalc(empty.item)).toBe(false);
    const two = run(empty, { type: 'amount', text: '2' });
    expect(two.item).toMatchObject({ portion: '2 чашки', kcalText: '120', pinned: true, fromDish: true });
    expect(two.dish).toEqual(coffee);
    expect(kcalNote(kcalSource(two))).toBe('як у «Частих стравах»');
  });

  it('…and on the way to «0,5» through «0» and «0,»', () => {
    let s = run(newEditor('n1'), { type: 'dish', dish: coffee });
    for (const text of ['0', '0,']) {
      s = run(s, { type: 'amount', text });
      expect(s.dish).toEqual(coffee);
      expect(s.item).toMatchObject({ kcalText: '60', pinned: true });
      expect(kcalSource(s)).toEqual({ kind: 'dish' });
    }
    s = run(s, { type: 'amount', text: '0,5' });
    expect(s.item).toMatchObject({ portion: '0,5 чашки', kcalText: '30', pinned: true });
    expect(s.dish).toEqual(coffee);
  });

  it('a text portion it cannot be scaled to still lets the dish go', () => {
    const s = run(
      newEditor('n1'),
      { type: 'dish', dish: coffee },
      { type: 'textMode', on: true },
      { type: 'portionText', value: 'велика' },
    );
    expect(s.dish).toBeNull();
    expect(s.item).toMatchObject({ portion: 'велика', pinned: false });
    expect(needsRecalc(s.item)).toBe(true);
  });

  it('a row priced by a dish is that dish again when she opens it', () => {
    const saved = run(newEditor('n1'), { type: 'dish', dish: coffee }, { type: 'step', dir: 1 }).item;
    expect(saved).toMatchObject({ portion: '2 чашки', kcalText: '120', fromDish: true });
    const s = openEditor(saved);
    expect(s.dish).toEqual({ name: 'Кава з молоком', portion: '2 чашки', kcal: 120 });
    expect(kcalSource(s)).toEqual({ kind: 'dish' });
    expect(editorChanged(s)).toBe(false);
    expect(run(s, { type: 'step', dir: 1 }).item).toMatchObject({ portion: '3 чашки', kcalText: '180' });
    // A row whose kcal she typed is not a dish.
    const typed = openEditor({ ...saved, fromDish: undefined });
    expect(typed.dish).toBeNull();
    expect(kcalSource(typed)).toEqual({ kind: 'manual' });
  });
});

describe('free-text portion', () => {
  it('«Порція текстом» keeps what she types as it is; back to the amount reads it when it can', () => {
    let s = run(openEditor(row(0)), { type: 'textMode', on: true });
    expect(s.textMode).toBe(true);
    s = run(s, { type: 'portionText', value: '0,15 кг' });
    expect(s.item).toMatchObject({ portion: '0,15 кг', kcalText: '165' });
    s = run(s, { type: 'textMode', on: false });
    expect(s).toMatchObject({ textMode: false, amountText: '0,15', unit: 'кг' });
    const spoons = run(
      openEditor(row(4)),
      { type: 'portionText', value: '2 ст. л.' },
      { type: 'textMode', on: false },
    );
    expect(spoons).toMatchObject({ textMode: false, amountText: '' });
    expect(spoons.item.portion).toBe('2 ст. л.');
  });

  it('a row whose portion is text shows its unit among the chips when it has one', () => {
    expect(unitChoices(openEditor(row(0)))).toEqual(['г', 'мл', 'шт', 'ложка', 'скибка', 'порція']);
    const plate = { ...row(2), portion: '1 тарілка', base: { name: 'Суп', portion: '1 тарілка', kcal: 300 } };
    expect(unitChoices(openEditor(plate))).toEqual(['г', 'мл', 'шт', 'ложка', 'скибка', 'порція', 'тарілка']);
    const kg = run(openEditor(row(0)), { type: 'unit', unit: 'кг' });
    expect(unitChoices(kg).slice(6)).toEqual(['кг']);
  });
});

describe('editorChanged', () => {
  it('compares the draft with the row it opened on', () => {
    const s = openEditor(row(0));
    expect(editorChanged(s)).toBe(false);
    expect(editorChanged(run(s, { type: 'name', value: 'Гречка ' }))).toBe(true);
    expect(editorChanged(run(s, { type: 'name', value: 'Гречка ' }, { type: 'name', value: 'Гречка' }))).toBe(
      false,
    );
    expect(editorChanged(run(s, { type: 'textMode', on: true }))).toBe(false);
  });

  it('a row without a name cannot be saved', () => {
    expect(canSave(run(openEditor(row(0)), { type: 'name', value: '  ' }))).toBe(false);
  });
});
