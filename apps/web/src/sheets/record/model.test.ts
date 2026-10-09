import { emptyData, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { FIELD_ERRORS } from '../validation';
import {
  addCustomType,
  applyFoodAdd,
  draftDayEntry,
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

  it('pre-fills the latest weight only in the weight sheet when the date has none', () => {
    expect(initRecordDraft(fixture(), TODAY, 'weight').weight).toBe('65,6');
    expect(initRecordDraft(fixture(), TODAY, 'day').weight).toBe('');
    expect(initRecordDraft(fixture(), TODAY, 'measure').weight).toBe('');
    expect(initRecordDraft(emptyData(), TODAY, 'weight').weight).toBe('');
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

  it('only validates the blocks the mode shows', () => {
    const bad = blank({ kcal: '99999', weight: '5', chest: '5' });
    expect(hasRecordErrors(validateRecord(bad, 'weight'))).toBe(true);
    expect(validateRecord(bad, 'weight').kcal).toBeUndefined();
    expect(validateRecord(bad, 'weight').measure.message).toBeUndefined();
    expect(validateRecord(bad, 'measure').weight).toBeUndefined();
  });
});

describe('recordOps (prototype save)', () => {
  const date = '2026-10-09';

  it('day mode: day + weigh-in + measurements', () => {
    const draft = blank({
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
    });
    expect(recordOps(draft, date, 'day')).toEqual([
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

  it('day mode with nothing filled deletes the day, the weigh-in and the measurements', () => {
    expect(recordOps(blank({ food: '   ' }), date, 'day')).toEqual([
      { kind: 'day.delete', date },
      { kind: 'weight.delete', date },
      { kind: 'measure.delete', date },
    ]);
  });

  it('drops workout types unless trained and omits photos when there are none', () => {
    const entry = draftDayEntry(blank({ trained: false, types: ['Кардіо'], kcal: '0' }));
    expect(entry).toEqual({ food: '', kcal: 0, trained: false, types: [], notes: '' });
    expect('photos' in entry).toBe(false);
  });

  it('weight mode touches only the weigh-in', () => {
    const draft = blank({ food: 'x', weight: '64', chest: '90' });
    expect(recordOps(draft, date, 'weight')).toEqual([{ kind: 'weight.put', date, kg: 64 }]);
    expect(recordOps(blank(), date, 'weight')).toEqual([{ kind: 'weight.delete', date }]);
  });

  it('measure mode touches only the measurements', () => {
    expect(recordOps(blank({ weight: '64', waist: '70' }), date, 'measure')).toEqual([
      { kind: 'measure.put', date, value: { chest: null, waist: 70, hips: null } },
    ]);
    expect(recordOps(blank(), date, 'measure')).toEqual([{ kind: 'measure.delete', date }]);
  });

  it('sections per mode', () => {
    expect(recordSections('day')).toEqual({ day: true, weight: true, measure: true });
    expect(recordSections('weight')).toEqual({ day: false, weight: true, measure: false });
    expect(recordSections('measure')).toEqual({ day: false, weight: false, measure: true });
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
  const add = { line: 'Борщ (300 г) — 420 ккал', kcal: 420, photoId: 'photo_bbbbbbbbbbbbbbbb', items: [] };

  it('appends the line on a new line, adds kcal and attaches the photo', () => {
    const next = applyFoodAdd(blank({ food: 'Вівсянка\n', kcal: '350', photos: ['p1'] }), add);
    expect(next.food).toBe('Вівсянка\nБорщ (300 г) — 420 ккал');
    expect(next.kcal).toBe('770');
    expect(next.photos).toEqual(['p1', 'photo_bbbbbbbbbbbbbbbb']);
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
    expect(applyFoodAdd(blank({ photos: [add.photoId] }), add).photos).toEqual([add.photoId]);
  });

  it('removes a photo', () => {
    expect(removePhoto(blank({ photos: ['a', 'b'] }), 'a').photos).toEqual(['b']);
  });
});
