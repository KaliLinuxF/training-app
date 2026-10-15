import { applyOps, emptyData, normalizeDay, type AppData, type Meal, type Op } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import type { SheetMode } from '@/store/ui';
import { FIELD_ERRORS } from '../validation';
import {
  addCustomType,
  dayMetaOf,
  hasRecordErrors,
  initRecordDraft,
  isCaptureMode,
  isRecordDirty,
  isRecordMode,
  MENU_HEADING,
  RECORD_HEADINGS,
  recordOps,
  recordSections,
  toggleType,
  typeChoices,
  validateRecord,
  type RecordDraft,
  type RecordMode,
} from './model';

const TODAY = '2026-10-10';

function fixture(): AppData {
  const data = emptyData();
  data.days[TODAY] = {
    food: 'Вівсянка з бананом, кава',
    kcal: 1650,
    trained: true,
    types: ['Кардіо'],
    notes: 'ок',
    photos: ['photo_aaaaaaaaaaaaaaaa'],
  };
  data.days['2026-10-03'] = { food: 'Борщ', kcal: null, trained: false, types: [], notes: '' };
  data.weights = [
    { date: '2026-09-28', kg: 66.1 },
    { date: '2026-10-03', kg: 65.6 },
  ];
  data.measures = [{ date: '2026-10-03', chest: 92, waist: 72.5, hips: null }];
  data.settings.customTypes = ['Йога'];
  return data;
}

const meal = (id: string, type: string, kcal: number | null, extra: Partial<Meal> = {}): Meal => ({
  id,
  type,
  time: null,
  text: type,
  kcal,
  protein: null,
  fat: null,
  carbs: null,
  ...extra,
});

/** A day with two meals, as the reducer stores it (food / kcal derived). */
function mealDay(data: AppData, date: string, patch: Partial<AppData['days'][string]> = {}) {
  data.days[date] = normalizeDay({
    food: '',
    kcal: null,
    trained: null,
    types: [],
    notes: '',
    ...patch,
    meals: [meal('m1', 'Сніданок', 420, { time: '08:30' }), meal('m2', 'Обід', 560, { time: '13:10' })],
  });
}

const blank = (patch: Partial<RecordDraft> = {}): RecordDraft => ({
  trained: null,
  types: [],
  notes: '',
  weight: '',
  chest: '',
  waist: '',
  hips: '',
  ...patch,
});

describe('initRecordDraft (prototype openSheet)', () => {
  it('loads the workout, notes, weigh-in and measurements of the date as input text — never the food', () => {
    const d = initRecordDraft(fixture(), '2026-10-03', 'day');
    expect(d).toEqual(blank({ trained: false, weight: '65,6', chest: '92', waist: '72,5', hips: '' }));
    expect('food' in d || 'kcal' in d || 'photos' in d).toBe(false);
  });

  it('copies arrays so editing the draft never mutates the store', () => {
    const data = fixture();
    const d = initRecordDraft(data, TODAY, 'day');
    d.types.push('Прес');
    expect(data.days[TODAY]?.types).toEqual(['Кардіо']);
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
    expect(d.weight).toBe('65,6');
  });

  it('a patched draft is dirty against its baseline, an untouched one is not', () => {
    const data = fixture();
    const baseline = initRecordDraft(data, '2026-10-03', 'day');
    expect(isRecordDirty(baseline, initRecordDraft(data, '2026-10-03', 'day'))).toBe(false);
    expect(isRecordDirty(baseline, initRecordDraft(data, '2026-10-03', 'day', { trained: true }))).toBe(true);
    expect(isRecordDirty(baseline, { ...baseline, types: ['Прес'] })).toBe(true);
    expect(isRecordDirty(baseline, { ...baseline, hips: '100' })).toBe(true);
    expect(isRecordDirty(baseline, { ...baseline, notes: 'x' })).toBe(true);
  });

  it('a meal day loads its workout and notes; its meals stay out of the draft', () => {
    const data = emptyData();
    mealDay(data, TODAY, { trained: true, types: ['Йога'], notes: 'Легко' });
    expect(initRecordDraft(data, TODAY, 'day')).toEqual(
      blank({ trained: true, types: ['Йога'], notes: 'Легко' }),
    );
  });
});

describe('validateRecord', () => {
  it('accepts empty optional fields and values within the limits (comma decimals)', () => {
    const e = validateRecord(blank({ weight: '65,4', chest: '10', waist: '300' }), 'day');
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

  it('flags notes longer than the server accepts (5 000 after trimming)', () => {
    const long = 'а'.repeat(5001);
    const e = validateRecord(blank({ notes: long }), 'day');
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
    const bad = blank({ weight: '5', chest: '5', notes: 'а'.repeat(6000) });
    expect(hasRecordErrors(validateRecord(bad, 'weight'))).toBe(true);
    expect(validateRecord(bad, 'weight').notes).toBeUndefined();
    expect(validateRecord(bad, 'weight').measure.message).toBeUndefined();
    expect(validateRecord(bad, 'measure').weight).toBeUndefined();
    // The day list and the new-meal editor validate nothing of this draft (the meal editor has its own).
    const types = Array.from({ length: 21 }, (_, i) => `${i}`);
    for (const mode of ['food', 'meal'] as const) {
      expect(hasRecordErrors(validateRecord({ ...bad, trained: true, types }, mode))).toBe(false);
    }
  });
});

/** Opens a sheet on `data` like the app does, lets `edit` change the draft, and saves against `atSave`. */
function save(
  data: AppData,
  date: string,
  mode: RecordMode,
  edit: (d: RecordDraft) => RecordDraft,
  atSave: AppData = data,
): Op[] {
  const baseline = initRecordDraft(data, date, mode);
  return recordOps({ baseline, draft: edit(baseline), data: atSave, date, mode });
}

describe('recordOps (per changed field; the day goes as a partial day.meta)', () => {
  const date = '2026-10-09';

  it('day mode: a filled-in empty day writes the workout and notes, the weigh-in and the measurements', () => {
    const ops = save(emptyData(), date, 'day', (d) => ({
      ...d,
      trained: true,
      types: ['Кардіо', 'Прес'],
      notes: ' добре ',
      weight: '65,4',
      chest: '92',
      waist: '',
      hips: '100,5',
    }));
    expect(ops).toEqual([
      { kind: 'day.meta', date, value: { trained: true, types: ['Кардіо', 'Прес'], notes: 'добре' } },
      { kind: 'weight.put', date, kg: 65.4 },
      { kind: 'measure.put', date, value: { chest: 92, waist: null, hips: 100.5 } },
    ]);
  });

  it('never writes day.put or day.delete, nor anything about the food', () => {
    const data = fixture();
    const ops = [
      ...save(data, TODAY, 'day', (d) => ({ ...d, trained: false, types: [], notes: '' })),
      ...save(data, '2026-10-03', 'day', (d) => ({ ...d, trained: null })),
      ...save(data, TODAY, 'workout', (d) => ({ ...d, types: ['Прес'] })),
    ];
    expect(ops.map((op) => op.kind)).toEqual(['day.meta', 'day.meta', 'day.meta']);
    for (const op of ops) {
      if (op.kind !== 'day.meta') continue;
      expect(Object.keys(op.value).some((k) => ['food', 'kcal', 'photos', 'meals'].includes(k))).toBe(false);
    }
  });

  it('nothing changed → nothing written (no pointless ops counted as pending changes)', () => {
    expect(save(emptyData(), date, 'day', (d) => d)).toEqual([]);
    expect(save(emptyData(), date, 'day', (d) => ({ ...d, notes: '   ' }))).toEqual([]);
    expect(save(fixture(), '2026-10-03', 'day', (d) => d)).toEqual([]);
    expect(save(fixture(), '2026-10-03', 'measure', (d) => d)).toEqual([]);
  });

  it('notes only → { notes } (trimmed); ✓ only → { trained }', () => {
    expect(save(fixture(), '2026-10-03', 'day', (d) => ({ ...d, notes: ' Сон 8 год ' }))).toEqual([
      { kind: 'day.meta', date: '2026-10-03', value: { notes: 'Сон 8 год' } },
    ]);
    expect(save(fixture(), '2026-10-03', 'day', (d) => ({ ...d, trained: true }))).toEqual([
      { kind: 'day.meta', date: '2026-10-03', value: { trained: true } },
    ]);
    expect(save(emptyData(), date, 'workout', (d) => ({ ...d, trained: true }))).toEqual([
      { kind: 'day.meta', date, value: { trained: true } },
    ]);
  });

  it('types go along only when she changed them and the day is trained', () => {
    // ✓ and a type.
    expect(save(emptyData(), date, 'workout', (d) => ({ ...d, trained: true, types: ['Кардіо'] }))).toEqual([
      { kind: 'day.meta', date, value: { trained: true, types: ['Кардіо'] } },
    ]);
    // Just another type on a trained day.
    expect(save(fixture(), TODAY, 'workout', (d) => ({ ...d, types: ['Кардіо', 'Прес'] }))).toEqual([
      { kind: 'day.meta', date: TODAY, value: { types: ['Кардіо', 'Прес'] } },
    ]);
    // ✕ drops the types in the reducer: only { trained } goes.
    expect(save(fixture(), TODAY, 'workout', (d) => ({ ...d, trained: false, types: [] }))).toEqual([
      { kind: 'day.meta', date: TODAY, value: { trained: false } },
    ]);
  });

  it('a type picked on a stale device is not sent once the day is no longer trained elsewhere', () => {
    const stale = fixture();
    const fresh = applyOps(stale, [{ kind: 'day.meta', date: TODAY, value: { trained: false } }]);
    expect(save(stale, TODAY, 'workout', (d) => ({ ...d, types: ['Кардіо', 'Прес'] }), fresh)).toEqual([]);
  });

  it('an op is emitted only when what she changed differs from what is stored now', () => {
    const stale = emptyData();
    const fresh = applyOps(stale, [{ kind: 'day.meta', date, value: { trained: true, notes: 'Легко' } }]);
    expect(save(stale, date, 'day', (d) => ({ ...d, trained: true, notes: 'Легко ' }), fresh)).toEqual([]);
    // One field still differs: everything she changed goes.
    expect(save(stale, date, 'day', (d) => ({ ...d, trained: true, notes: 'Важко' }), fresh)).toEqual([
      { kind: 'day.meta', date, value: { trained: true, notes: 'Важко' } },
    ]);
  });

  it('clearing what was there clears it (the reducer deletes a day left empty) and deletes the records', () => {
    const data = fixture();
    const ops = save(data, '2026-10-03', 'day', (d) => ({
      ...d,
      trained: null,
      weight: '',
      chest: '',
      waist: '',
    }));
    expect(ops).toEqual([
      { kind: 'day.meta', date: '2026-10-03', value: { trained: null } },
      { kind: 'weight.delete', date: '2026-10-03' },
      { kind: 'measure.delete', date: '2026-10-03' },
    ]);
    // 3 Oct keeps its food (a legacy day): the mark goes, the day stays.
    expect(applyOps(data, ops).days['2026-10-03']).toEqual({
      food: 'Борщ',
      kcal: null,
      trained: null,
      types: [],
      notes: '',
    });
    // A day with nothing else goes away entirely.
    const bare = emptyData();
    bare.days[date] = { food: '', kcal: null, trained: false, types: [], notes: '' };
    const cleared = save(bare, date, 'workout', (d) => ({ ...d, trained: null }));
    expect(cleared).toEqual([{ kind: 'day.meta', date, value: { trained: null } }]);
    expect(applyOps(bare, cleared).days[date]).toBeUndefined();
  });

  it('a day save on a meal day leaves every meal as it is', () => {
    const data = emptyData();
    mealDay(data, TODAY, { trained: null, notes: '' });
    const before = data.days[TODAY]?.meals;
    const ops = save(data, TODAY, 'day', (d) => ({ ...d, trained: true, types: ['Йога'], notes: 'Легко' }));
    expect(ops).toEqual([
      { kind: 'day.meta', date: TODAY, value: { trained: true, types: ['Йога'], notes: 'Легко' } },
    ]);
    const after = applyOps(data, ops).days[TODAY];
    expect(after?.meals).toEqual(before);
    expect(after?.kcal).toBe(980);
    expect(after).toMatchObject({ trained: true, types: ['Йога'], notes: 'Легко' });
  });

  it('a stale device never deletes a weigh-in or measurements recorded elsewhere, nor rewrites the day', () => {
    // The sheet opened on a cache without today's weigh-in and measurements…
    const stale = fixture();
    // …which the phone recorded meanwhile, together with a type (the store has been refreshed since).
    const fresh = applyOps(stale, [
      { kind: 'weight.put', date: TODAY, kg: 65.1 },
      { kind: 'measure.put', date: TODAY, value: { chest: 89.5, waist: 69.5, hips: 97.5 } },
      { kind: 'day.meta', date: TODAY, value: { types: ['Кардіо', 'Прес'] } },
    ]);
    const ops = save(stale, TODAY, 'day', (d) => ({ ...d, notes: 'Сон 8 год' }), fresh);
    expect(ops).toEqual([{ kind: 'day.meta', date: TODAY, value: { notes: 'Сон 8 год' } }]);
    expect(applyOps(fresh, ops).days[TODAY]).toMatchObject({ types: ['Кардіо', 'Прес'], kcal: 1650 });
  });

  it('a workout deep link on a stale phone keeps the food and types logged on desktop', () => {
    const stale = emptyData();
    const fresh = applyOps(stale, [
      {
        kind: 'day.put',
        date,
        value: { food: 'Омлет', kcal: 1500, trained: true, types: ['Йога'], notes: '' },
      },
    ]);
    const baseline = initRecordDraft(stale, date, 'workout');
    const draft = initRecordDraft(stale, date, 'workout', { trained: true });
    const ops = recordOps({ baseline, draft, data: fresh, date, mode: 'workout' });
    // ✓ is already stored: nothing to send.
    expect(ops).toEqual([]);
    const notes = recordOps({
      baseline,
      draft: { ...draft, notes: 'Легко' },
      data: fresh,
      date,
      mode: 'workout',
    });
    expect(notes).toEqual([{ kind: 'day.meta', date, value: { trained: true, notes: 'Легко' } }]);
    expect(applyOps(fresh, notes).days[date]).toEqual({
      food: 'Омлет',
      kcal: 1500,
      trained: true,
      types: ['Йога'],
      notes: 'Легко',
    });
  });

  it('measurements merge per parameter: only the ones she changed are hers', () => {
    const stale = emptyData();
    const fresh = applyOps(stale, [
      { kind: 'measure.put', date, value: { chest: 90, waist: null, hips: 98 } },
    ]);
    expect(save(stale, date, 'measure', (d) => ({ ...d, waist: '70' }), fresh)).toEqual([
      { kind: 'measure.put', date, value: { chest: 90, waist: 70, hips: 98 } },
    ]);
  });

  it('weight mode touches only the weigh-in and records the offered weight as that day’s', () => {
    expect(save(fixture(), date, 'weight', (d) => ({ ...d, notes: 'x', weight: '64', chest: '90' }))).toEqual(
      [{ kind: 'weight.put', date, kg: 64 }],
    );
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

  it('the day list and the new-meal editor never write through this draft', () => {
    for (const mode of ['food', 'meal'] as const) {
      expect(
        save(fixture(), TODAY, mode, (d) => ({
          ...d,
          trained: false,
          notes: 'x',
          weight: '64',
          waist: '70',
        })),
      ).toEqual([]);
    }
  });

  it('dayMetaOf: the same partial value, or null', () => {
    const data = fixture();
    const baseline = initRecordDraft(data, TODAY, 'workout');
    expect(dayMetaOf({ baseline, draft: baseline, data, date: TODAY, mode: 'workout' })).toBeNull();
    expect(
      dayMetaOf({ baseline, draft: { ...baseline, notes: '  нове ' }, data, date: TODAY, mode: 'workout' }),
    ).toEqual({ notes: 'нове' });
    // The weight sheet shows neither the workout nor the notes.
    expect(
      dayMetaOf({ baseline, draft: { ...baseline, notes: 'x' }, data, date: TODAY, mode: 'weight' }),
    ).toBeNull();
  });

  it('sections per mode', () => {
    const none = { workout: false, food: false, meal: false, notes: false, weight: false, measure: false };
    expect(recordSections('day')).toEqual({
      ...none,
      workout: true,
      food: true,
      notes: true,
      weight: true,
      measure: true,
    });
    expect(recordSections('food')).toEqual({ ...none, food: true });
    expect(recordSections('meal')).toEqual({ ...none, meal: true });
    expect(recordSections('workout')).toEqual({ ...none, workout: true, notes: true });
    expect(recordSections('weight')).toEqual({ ...none, weight: true });
    expect(recordSections('measure')).toEqual({ ...none, measure: true });
  });

  it('returns a copy of the sections table', () => {
    const show = recordSections('food');
    show.weight = true;
    expect(recordSections('food').weight).toBe(false);
  });
});

describe('modes', () => {
  it('knows the record and capture modes', () => {
    const record: SheetMode[] = ['day', 'food', 'meal', 'workout', 'weight', 'measure'];
    for (const mode of record) {
      expect(isRecordMode(mode)).toBe(true);
      expect(isCaptureMode(mode)).toBe(true);
    }
    expect(isRecordMode('menu')).toBe(false);
    expect(isCaptureMode('menu')).toBe(true);
    for (const mode of ['setup', 'install'] as const) {
      expect(isRecordMode(mode)).toBe(false);
      expect(isCaptureMode(mode)).toBe(false);
    }
  });

  it('names every sheet', () => {
    expect(MENU_HEADING).toBe('Що записати?');
    expect(RECORD_HEADINGS).toEqual({
      day: 'Запис дня',
      food: 'Їжа',
      meal: 'Прийом їжі',
      workout: 'Тренування',
      weight: 'Контрольне зважування',
      measure: 'Заміри тіла',
    });
  });
});

describe('short sheets', () => {
  const date = '2026-10-09';

  it('«Тренування» ignores a bad weight and measurements, but checks the notes and the types', () => {
    const long = 'а'.repeat(5001);
    const workout = validateRecord(blank({ weight: '5', chest: '5' }), 'workout');
    expect(hasRecordErrors(workout)).toBe(false);
    expect(validateRecord(blank({ notes: long }), 'workout').notes).toBe(FIELD_ERRORS.text);
    const types = Array.from({ length: 21 }, (_, i) => `Тип ${i}`);
    expect(validateRecord(blank({ trained: true, types }), 'workout').types).toBe(FIELD_ERRORS.types);
  });

  it('workout mode with the push patch and types keeps the food, kcal and photos', () => {
    const data = fixture();
    const baseline = initRecordDraft(data, TODAY, 'workout');
    const draft = {
      ...initRecordDraft(data, TODAY, 'workout', { trained: true }),
      types: ['Кардіо', 'Прес'],
    };
    const ops = recordOps({ baseline, draft, data, date: TODAY, mode: 'workout' });
    expect(ops).toEqual([{ kind: 'day.meta', date: TODAY, value: { types: ['Кардіо', 'Прес'] } }]);
    expect(applyOps(data, ops).days[TODAY]).toEqual({
      food: 'Вівсянка з бананом, кава',
      kcal: 1650,
      trained: true,
      types: ['Кардіо', 'Прес'],
      notes: 'ок',
      photos: ['photo_aaaaaaaaaaaaaaaa'],
    });
  });

  it('a stale device: the food logged elsewhere survives a workout save', () => {
    const stale = emptyData();
    const fresh = applyOps(stale, [
      {
        kind: 'day.put',
        date,
        value: {
          food: 'Омлет',
          kcal: 1500,
          trained: null,
          types: [],
          notes: '',
          photos: ['photo_aaaaaaaaaaaaaaaa'],
        },
      },
    ]);
    const ops = save(
      stale,
      date,
      'workout',
      (d) => ({ ...d, trained: true, types: ['Кардіо'], notes: 'Легко' }),
      fresh,
    );
    expect(ops).toEqual([
      { kind: 'day.meta', date, value: { trained: true, types: ['Кардіо'], notes: 'Легко' } },
    ]);
    expect(applyOps(fresh, ops).days[date]).toEqual({
      food: 'Омлет',
      kcal: 1500,
      trained: true,
      types: ['Кардіо'],
      notes: 'Легко',
      photos: ['photo_aaaaaaaaaaaaaaaa'],
    });
  });

  it('unchanged short sheets write nothing', () => {
    for (const mode of ['food', 'meal', 'workout'] as const) {
      expect(save(fixture(), TODAY, mode, (d) => d)).toEqual([]);
      expect(save(fixture(), '2026-10-03', mode, (d) => d)).toEqual([]);
      expect(save(emptyData(), date, mode, (d) => d)).toEqual([]);
    }
  });

  it('applies the open patch only in sheets that show the workout', () => {
    const data = fixture();
    expect(initRecordDraft(data, '2026-10-03', 'workout', { trained: true }).trained).toBe(true);
    expect(initRecordDraft(data, '2026-10-03', 'day', { trained: true }).trained).toBe(true);
    for (const mode of ['food', 'meal', 'weight', 'measure'] as const) {
      expect(initRecordDraft(data, '2026-10-03', mode, { trained: true }).trained).toBe(false);
    }
    // So a patched food sheet is not dirty and saves nothing.
    const baseline = initRecordDraft(data, '2026-10-03', 'food');
    const draft = initRecordDraft(data, '2026-10-03', 'food', { trained: true });
    expect(isRecordDirty(baseline, draft)).toBe(false);
    expect(recordOps({ baseline, draft, data, date: '2026-10-03', mode: 'food' })).toEqual([]);
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
    expect(addCustomType('ЙОГА', ['Йога'], ['Йога'])).toEqual({
      name: 'Йога',
      customTypes: null,
      types: ['Йога'],
    });
  });

  it('ignores blank input and trims to the length limit', () => {
    expect(addCustomType('   ', [], [])).toBeNull();
    const long = addCustomType('а'.repeat(60), [], []);
    expect(long?.name).toHaveLength(40);
  });
});
