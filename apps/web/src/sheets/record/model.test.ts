import { applyOps, emptyData, type AppData, type FoodUse } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import type { FoodAdd } from '@/features/food';
import { FIELD_ERRORS } from '../validation';
import {
  addCustomType,
  applyFoodAdd,
  draftDayEntry,
  foodUseOps,
  hasRecordErrors,
  initRecordDraft,
  isRecordDirty,
  recordOps,
  recordSections,
  removePhoto,
  toggleType,
  typeChoices,
  validateRecord,
  type RecordDraft,
  type RecordMode,
} from './model';

const TODAY = '2026-10-10';

function fixture(): AppData {
  const data = emptyData();
  data.days[TODAY] = { food: 'Вівсянка з бананом, кава', kcal: 1650, trained: true, types: ['Кардіо'], notes: 'ок', photos: ['photo_aaaaaaaaaaaaaaaa'] };
  data.days['2026-10-03'] = { food: 'Борщ', kcal: null, trained: false, types: [], notes: '' };
  data.weights = [
    { date: '2026-09-28', kg: 66.1 },
    { date: '2026-10-03', kg: 65.6 },
  ];
  data.measures = [{ date: '2026-10-03', chest: 92, waist: 72.5, hips: null }];
  data.settings.customTypes = ['Йога'];
  return data;
}

const blank = (patch: Partial<RecordDraft> = {}): RecordDraft => ({
  food: '',
  kcal: '',
  trained: null,
  types: [],
  notes: '',
  photos: [],
  weight: '',
  chest: '',
  waist: '',
  hips: '',
  foodUses: [],
  ...patch,
});

describe('initRecordDraft (prototype openSheet)', () => {
  it('loads the day entry, weigh-in and measurements of the date as input text', () => {
    const d = initRecordDraft(fixture(), '2026-10-03', 'day');
    expect(d).toEqual(
      blank({ food: 'Борщ', trained: false, weight: '65,6', chest: '92', waist: '72,5', hips: '' }),
    );
  });

  it('copies arrays so editing the draft never mutates the store', () => {
    const data = fixture();
    const d = initRecordDraft(data, TODAY, 'day');
    d.types.push('Прес');
    d.photos.push('x');
    expect(data.days[TODAY]?.types).toEqual(['Кардіо']);
    expect(data.days[TODAY]?.photos).toEqual(['photo_aaaaaaaaaaaaaaaa']);
  });

  it('pre-fills the weigh-in before the date only in the weight sheet when the date has none', () => {
    expect(initRecordDraft(fixture(), TODAY, 'weight').weight).toBe('65,6');
    expect(initRecordDraft(fixture(), TODAY, 'day').weight).toBe('');
    expect(initRecordDraft(fixture(), TODAY, 'measure').weight).toBe('');
    expect(initRecordDraft(emptyData(), TODAY, 'weight').weight).toBe('');
  });

  it('going back to a past day offers the weigh-in before that day, not the latest one', () => {
    const data = fixture();
    expect(initRecordDraft(data, '2026-10-01', 'weight').weight).toBe('66,1');
    expect(initRecordDraft(data, '2026-09-28', 'weight').weight).toBe('66,1'); // its own
    expect(initRecordDraft(data, '2026-09-20', 'weight').weight).toBe(''); // nothing before
  });

  it('applies the open patch on top (Home «✓ Було», workout deep link)', () => {
    const d = initRecordDraft(fixture(), '2026-10-03', 'day', { trained: true });
    expect(d.trained).toBe(true);
    expect(d.food).toBe('Борщ');
  });

  it('a patched draft is dirty against its baseline, an untouched one is not', () => {
    const data = fixture();
    const baseline = initRecordDraft(data, '2026-10-03', 'day');
    expect(isRecordDirty(baseline, initRecordDraft(data, '2026-10-03', 'day'))).toBe(false);
    expect(isRecordDirty(baseline, initRecordDraft(data, '2026-10-03', 'day', { trained: true }))).toBe(true);
    expect(isRecordDirty(baseline, { ...baseline, types: ['Прес'] })).toBe(true);
    expect(isRecordDirty(baseline, { ...baseline, hips: '100' })).toBe(true);
    expect(isRecordDirty(baseline, { ...baseline, foodUses: [{ name: 'Борщ', portion: '', kcal: 300 }] })).toBe(true);
  });
});

describe('validateRecord', () => {
  it('accepts empty optional fields and values within the limits (comma decimals)', () => {
    const e = validateRecord(blank({ weight: '65,4', chest: '10', waist: '300', kcal: '20000' }), 'day');
    expect(hasRecordErrors(e)).toBe(false);
    expect(hasRecordErrors(validateRecord(blank(), 'day'))).toBe(false);
  });

  it('flags weight outside 20–400 kg and unparseable text', () => {
    expect(validateRecord(blank({ weight: '19,9' }), 'weight').weight).toBe(FIELD_ERRORS.kg);
    expect(validateRecord(blank({ weight: '400,1' }), 'day').weight).toBe(FIELD_ERRORS.kg);
    expect(validateRecord(blank({ weight: 'abc' }), 'weight').weight).toBe(FIELD_ERRORS.kg);
  });

  it('flags measurements outside 10–300 cm and lists the offending tiles', () => {
    const e = validateRecord(blank({ chest: '9', waist: '70', hips: '301' }), 'measure');
    expect(e.measure).toEqual({ message: FIELD_ERRORS.cm, invalid: ['chest', 'hips'] });
    expect(hasRecordErrors(e)).toBe(true);
  });

  it('flags kcal above 20 000', () => {
    expect(validateRecord(blank({ kcal: '20001' }), 'day').kcal).toBe(FIELD_ERRORS.kcal);
  });

  it('flags food and notes longer than the server accepts (5 000 after trimming)', () => {
    const long = 'а'.repeat(5001);
    const e = validateRecord(blank({ food: long, notes: long }), 'day');
    expect(e.food).toBe(FIELD_ERRORS.text);
    expect(e.notes).toBe(FIELD_ERRORS.text);
    expect(hasRecordErrors(e)).toBe(true);
    expect(hasRecordErrors(validateRecord(blank({ notes: `${'а'.repeat(5000)}\n\n` }), 'day'))).toBe(false);
  });

  it('flags more than 20 workout types, but only when they count (trained)', () => {
    const types = Array.from({ length: 21 }, (_, i) => `Тип ${i}`);
    expect(validateRecord(blank({ trained: true, types }), 'day').types).toBe(FIELD_ERRORS.types);
    expect(validateRecord(blank({ trained: false, types }), 'day').types).toBeUndefined();
    expect(validateRecord(blank({ trained: true, types: types.slice(0, 20) }), 'day').types).toBeUndefined();
  });

  it('only validates the blocks the mode shows', () => {
    const bad = blank({ kcal: '99999', weight: '5', chest: '5', notes: 'а'.repeat(6000) });
    expect(hasRecordErrors(validateRecord(bad, 'weight'))).toBe(true);
    expect(validateRecord(bad, 'weight').kcal).toBeUndefined();
    expect(validateRecord(bad, 'weight').notes).toBeUndefined();
    expect(validateRecord(bad, 'weight').measure.message).toBeUndefined();
    expect(validateRecord(bad, 'measure').weight).toBeUndefined();
  });
});

/** Opens a sheet on `data` like the app does, lets `edit` change the draft, and saves against `atSave`. */
function save(
  data: AppData,
  date: string,
  mode: RecordMode,
  edit: (d: RecordDraft) => RecordDraft,
  atSave: AppData = data,
) {
  const baseline = initRecordDraft(data, date, mode);
  return recordOps({ baseline, draft: edit(baseline), data: atSave, date, mode });
}

describe('recordOps (prototype save, per changed field)', () => {
  const date = '2026-10-09';

  it('day mode: a filled-in empty day writes the day, the weigh-in and the measurements', () => {
    const ops = save(emptyData(), date, 'day', (d) => ({
      ...d,
      food: '  Омлет, борщ  ',
      kcal: '1650',
      trained: true,
      types: ['Кардіо', 'Прес'],
      notes: ' добре ',
      photos: ['photo_aaaaaaaaaaaaaaaa'],
      weight: '65,4',
      chest: '92',
      waist: '',
      hips: '100,5',
    }));
    expect(ops).toEqual([
      {
        kind: 'day.put',
        date,
        value: {
          food: 'Омлет, борщ',
          kcal: 1650,
          trained: true,
          types: ['Кардіо', 'Прес'],
          notes: 'добре',
          photos: ['photo_aaaaaaaaaaaaaaaa'],
        },
      },
      { kind: 'weight.put', date, kg: 65.4 },
      { kind: 'measure.put', date, value: { chest: 92, waist: null, hips: 100.5 } },
    ]);
  });

  it('nothing changed → nothing written (no pointless deletes counted as pending changes)', () => {
    expect(save(emptyData(), date, 'day', (d) => d)).toEqual([]);
    expect(save(emptyData(), date, 'day', (d) => ({ ...d, food: '   ' }))).toEqual([]);
    expect(save(fixture(), '2026-10-03', 'day', (d) => d)).toEqual([]);
    expect(save(fixture(), '2026-10-03', 'measure', (d) => d)).toEqual([]);
  });

  it('a notes-only save writes just the day (one change, not three)', () => {
    const ops = save(fixture(), '2026-10-03', 'day', (d) => ({ ...d, notes: 'Сон 8 год' }));
    expect(ops).toEqual([
      { kind: 'day.put', date: '2026-10-03', value: { food: 'Борщ', kcal: null, trained: false, types: [], notes: 'Сон 8 год' } },
    ]);
  });

  it('clearing what was there deletes it', () => {
    const data = fixture();
    const ops = save(data, '2026-10-03', 'day', (d) => ({ ...d, food: '', trained: null, weight: '', chest: '', waist: '' }));
    expect(ops).toEqual([
      { kind: 'day.delete', date: '2026-10-03' },
      { kind: 'weight.delete', date: '2026-10-03' },
      { kind: 'measure.delete', date: '2026-10-03' },
    ]);
  });

  it('a stale device never deletes a weigh-in or measurements recorded elsewhere, nor rewrites the day', () => {
    // The sheet opened on a cache without today's weigh-in and measurements…
    const stale = fixture();
    // …which the phone recorded meanwhile, together with kcal (the store has been refreshed since).
    const fresh = applyOps(stale, [
      { kind: 'weight.put', date: TODAY, kg: 65.1 },
      { kind: 'measure.put', date: TODAY, value: { chest: 89.5, waist: 69.5, hips: 97.5 } },
      {
        kind: 'day.put',
        date: TODAY,
        value: { food: 'Вівсянка з бананом, кава', kcal: 1790, trained: true, types: ['Кардіо'], notes: 'ок', photos: ['photo_aaaaaaaaaaaaaaaa'] },
      },
    ]);
    const ops = save(stale, TODAY, 'day', (d) => ({ ...d, food: `${d.food}\nБорщ` }), fresh);
    expect(ops).toEqual([
      {
        kind: 'day.put',
        date: TODAY,
        value: {
          food: 'Вівсянка з бананом, кава\nБорщ',
          kcal: 1790, // not hers to change: the stored value stays
          trained: true,
          types: ['Кардіо'],
          notes: 'ок',
          photos: ['photo_aaaaaaaaaaaaaaaa'],
        },
      },
    ]);
    // Not even when the cache was never refreshed: untouched weight / measurements send nothing.
    expect(save(stale, TODAY, 'day', (d) => ({ ...d, notes: 'x' })).map((op) => op.kind)).toEqual(['day.put']);
  });

  it('a workout deep link on a stale phone keeps the food logged on desktop', () => {
    const stale = emptyData();
    const fresh = applyOps(stale, [
      { kind: 'day.put', date, value: { food: 'Омлет', kcal: 1500, trained: null, types: [], notes: '' } },
    ]);
    const baseline = initRecordDraft(stale, date, 'day');
    const draft = { ...initRecordDraft(stale, date, 'day', { trained: true }), types: ['Кардіо'] };
    expect(recordOps({ baseline, draft, data: fresh, date, mode: 'day' })).toEqual([
      { kind: 'day.put', date, value: { food: 'Омлет', kcal: 1500, trained: true, types: ['Кардіо'], notes: '' } },
    ]);
  });

  it('measurements merge per parameter: only the ones she changed are hers', () => {
    const stale = emptyData();
    const fresh = applyOps(stale, [{ kind: 'measure.put', date, value: { chest: 90, waist: null, hips: 98 } }]);
    expect(save(stale, date, 'measure', (d) => ({ ...d, waist: '70' }), fresh)).toEqual([
      { kind: 'measure.put', date, value: { chest: 90, waist: 70, hips: 98 } },
    ]);
  });

  it('drops workout types unless trained and omits photos when there are none', () => {
    const entry = draftDayEntry(blank({ trained: false, types: ['Кардіо'], kcal: '0' }));
    expect(entry).toEqual({ food: '', kcal: 0, trained: false, types: [], notes: '' });
    expect('photos' in entry).toBe(false);
  });

  it('weight mode touches only the weigh-in and records the offered weight as that day’s', () => {
    expect(save(fixture(), date, 'weight', (d) => ({ ...d, food: 'x', weight: '64', chest: '90' }))).toEqual([
      { kind: 'weight.put', date, kg: 64 },
    ]);
    // Saved untouched: the offered weigh-in (from 3 Oct) becomes this day's.
    expect(save(fixture(), date, 'weight', (d) => d)).toEqual([{ kind: 'weight.put', date, kg: 65.6 }]);
    // Its own weigh-in, unchanged: nothing to write.
    expect(save(fixture(), '2026-10-03', 'weight', (d) => d)).toEqual([]);
    expect(save(fixture(), '2026-10-03', 'weight', (d) => ({ ...d, weight: '' }))).toEqual([
      { kind: 'weight.delete', date: '2026-10-03' },
    ]);
    expect(save(emptyData(), date, 'weight', (d) => d)).toEqual([]);
  });

  it('measure mode touches only the measurements', () => {
    expect(save(emptyData(), date, 'measure', (d) => ({ ...d, weight: '64', waist: '70' }))).toEqual([
      { kind: 'measure.put', date, value: { chest: null, waist: 70, hips: null } },
    ]);
    expect(save(fixture(), '2026-10-03', 'measure', (d) => ({ ...d, chest: '', waist: '' }))).toEqual([
      { kind: 'measure.delete', date: '2026-10-03' },
    ]);
  });

  it('sections per mode', () => {
    expect(recordSections('day')).toEqual({ day: true, weight: true, measure: true });
    expect(recordSections('weight')).toEqual({ day: false, weight: true, measure: false });
    expect(recordSections('measure')).toEqual({ day: false, weight: false, measure: true });
  });
});

describe('foodUseOps', () => {
  it('turns the dishes added in the sheet into food.use for that day, skipping ones the server would refuse', () => {
    const uses: FoodUse[] = [
      { name: 'Борщ', portion: '300 г', kcal: 250 },
      { name: '   ', portion: '', kcal: 10 },
      { name: 'Хліб', portion: '1 скибка', kcal: 80 },
    ];
    expect(foodUseOps(blank({ foodUses: uses }), '2026-10-09')).toEqual([
      { kind: 'food.use', date: '2026-10-09', value: { name: 'Борщ', portion: '300 г', kcal: 250 } },
      { kind: 'food.use', date: '2026-10-09', value: { name: 'Хліб', portion: '1 скибка', kcal: 80 } },
    ]);
    expect(foodUseOps(blank(), '2026-10-09')).toEqual([]);
  });
});

describe('workout types', () => {
  it('lists built-in, custom, then selected-but-unknown types without duplicates', () => {
    expect(typeChoices(['Йога', 'кардіо'], ['Плавання', 'Йога'])).toEqual([
      'Верх тіла',
      'Низ тіла',
      'Кардіо',
      'Прес',
      'Все тіло',
      'Розтяжка',
      'Прогулянка',
      'Йога',
      'Плавання',
    ]);
  });

  it('toggles a type', () => {
    expect(toggleType(['Кардіо'], 'Прес')).toEqual(['Кардіо', 'Прес']);
    expect(toggleType(['Кардіо', 'Прес'], 'Кардіо')).toEqual(['Прес']);
  });

  it('never selects more than 20 types (deselecting still works)', () => {
    const twenty = Array.from({ length: 20 }, (_, i) => `Тип ${i}`);
    expect(toggleType(twenty, 'Кардіо')).toEqual(twenty);
    expect(toggleType(twenty, 'Тип 3')).toHaveLength(19);
  });

  it('adds a new custom type to settings and selects it', () => {
    expect(addCustomType('  Пілатес  ', ['Йога'], ['Кардіо'])).toEqual({
      name: 'Пілатес',
      customTypes: ['Йога', 'Пілатес'],
      types: ['Кардіо', 'Пілатес'],
    });
  });

  it('reuses an existing spelling instead of adding a duplicate', () => {
    expect(addCustomType('кардіо', [], [])).toEqual({ name: 'Кардіо', customTypes: null, types: ['Кардіо'] });
    expect(addCustomType('ЙОГА', ['Йога'], ['Йога'])).toEqual({ name: 'Йога', customTypes: null, types: ['Йога'] });
  });

  it('ignores blank input and trims to the length limit', () => {
    expect(addCustomType('   ', [], [])).toBeNull();
    const long = addCustomType('а'.repeat(60), [], []);
    expect(long?.name).toHaveLength(40);
  });
});

describe('applyFoodAdd', () => {
  const use: FoodUse = { name: 'Борщ', portion: '300 г', kcal: 420 };
  const add: FoodAdd = {
    line: 'Борщ (300 г) — 420 ккал',
    consumed: '',
    kcal: 420,
    photoId: 'photo_bbbbbbbbbbbbbbbb',
    items: [],
    uses: [use],
  };

  it('appends the line on a new line, adds kcal, attaches the photo and keeps the usage for the save', () => {
    const next = applyFoodAdd(blank({ food: 'Вівсянка — 350 ккал\n', kcal: '350', photos: ['p1'] }), add);
    expect(next.food).toBe('Вівсянка — 350 ккал\nБорщ (300 г) — 420 ккал');
    expect(next.kcal).toBe('770');
    expect(next.photos).toEqual(['p1', 'photo_bbbbbbbbbbbbbbbb']);
    expect(next.foodUses).toEqual([use]);
    expect(applyFoodAdd(next, { ...add, photoId: null }).foodUses).toEqual([use, use]);
  });

  it('replaces the typed meal the estimate was made from, so it is not written twice', () => {
    const typed = 'Вівсянка — 350 ккал\nборщ\nхліб';
    const next = applyFoodAdd(blank({ food: typed, kcal: '350' }), { ...add, consumed: 'борщ, хліб' });
    expect(next.food).toBe('Вівсянка — 350 ккал\nБорщ (300 г) — 420 ккал');
    expect(next.kcal).toBe('770');
  });

  it('starts the text and kcal from scratch on an empty day', () => {
    const next = applyFoodAdd(blank(), { ...add, photoId: null });
    expect(next.food).toBe('Борщ (300 г) — 420 ккал');
    expect(next.kcal).toBe('420');
    expect(next.photos).toEqual([]);
  });

  it('never attaches more than 12 photos or the same one twice', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => `p${i}`);
    expect(applyFoodAdd(blank({ photos: twelve }), add).photos).toHaveLength(12);
    expect(applyFoodAdd(blank({ photos: [add.photoId ?? ''] }), add).photos).toEqual([add.photoId]);
  });

  it('removes a photo', () => {
    expect(removePhoto(blank({ photos: ['a', 'b'] }), 'a').photos).toEqual(['b']);
  });
});
