import { describe, expect, it } from 'vitest';
import { defaultSettings, workoutSchema, type WorkoutItem } from '@legko/shared';
import {
  ITEMS_REQUIRED,
  NAME_REQUIRED,
  addExercises,
  addedPlanDays,
  commonValue,
  daysNote,
  draftFrom,
  dropIndex,
  duplicateItem,
  isDirty,
  itemSummary,
  moveItem,
  moveItemTo,
  parseBuilderDraft,
  removeItem,
  removeSet,
  savedToast,
  setCommon,
  setCount,
  setOne,
  setRest,
  setsDiffer,
  toWorkout,
  validate,
} from './builderModel';
import { spoken } from './copy';
import { LEGS, doneLegs, trainingData } from './testing';
import { findExercise } from '@legko/shared';

const squat = findExercise([], 'lib.back-squat');
let n = 0;
const key = () => `newKey${String(++n).padStart(4, '0')}`;

describe('builder draft', () => {
  it('starts empty, or as a deep copy of the workout (editing never touches it)', () => {
    expect(draftFrom(null)).toEqual({ id: null, name: '', days: [], items: [] });
    const d = draftFrom(LEGS);
    expect(d).toEqual({ id: LEGS.id, name: LEGS.name, days: LEGS.days, items: LEGS.items });
    d.items[0]!.sets[0]!.kg = 99;
    expect(LEGS.items[0]!.sets[0]!.kg).toBe(40);
  });

  it('is dirty after any change, and not after a name change of spaces only', () => {
    const o = draftFrom(LEGS);
    expect(isDirty(o, o)).toBe(false);
    expect(isDirty({ ...o, name: ' Ноги + прес ' }, o)).toBe(false);
    expect(isDirty({ ...o, name: 'Ноги' }, o)).toBe(true);
    expect(isDirty({ ...o, days: [1] }, o)).toBe(true);
    expect(isDirty(moveItem(o, 'item0001', 1), o)).toBe(true);
    expect(
      isDirty(
        setRest(o.items[0]!, 75) === o.items[0]
          ? o
          : { ...o, items: [setRest(o.items[0]!, 75), o.items[1]!] },
        o,
      ),
    ).toBe(true);
  });

  it('adds picked exercises prefilled from her last performance, else the defaults (unknown ids left out)', () => {
    const data = trainingData();
    const d = addExercises(draftFrom(null), data, ['lib.back-squat', 'lib.nope', 'lib.plank'], key);
    expect(d.items).toHaveLength(2);
    const [sq, plank] = d.items as [WorkoutItem, WorkoutItem];
    expect(sq.exerciseId).toBe('lib.back-squat');
    expect(sq.sets).toEqual([1, 2, 3].map(() => ({ reps: 12, kg: 40, sec: null, min: null, km: null })));
    expect(sq.restSec).toBe(90);
    expect(plank.sets).toEqual([1, 2, 3].map(() => ({ reps: null, kg: null, sec: 30, min: null, km: null })));
    expect(plank.restSec).toBe(45);
    expect(new Set(d.items.map((i) => i.key)).size).toBe(2);
  });

  it('duplicates right after with a new key; removes; moves with ↑ / ↓ and by index (clamped)', () => {
    const d = draftFrom(LEGS);
    const dup = duplicateItem(d, 'item0001', 'copyKey1');
    expect(dup.items.map((i) => i.key)).toEqual(['item0001', 'copyKey1', 'item0002']);
    expect(dup.items[1]!.sets).toEqual(d.items[0]!.sets);
    expect(dup.items[1]!.sets).not.toBe(d.items[0]!.sets);
    expect(removeItem(dup, 'copyKey1').items.map((i) => i.key)).toEqual(['item0001', 'item0002']);
    expect(moveItem(d, 'item0002', -1).items.map((i) => i.key)).toEqual(['item0002', 'item0001']);
    expect(moveItem(d, 'item0001', -1)).toBe(d);
    expect(moveItemTo(dup, 0, 9).items.map((i) => i.key)).toEqual(['copyKey1', 'item0002', 'item0001']);
  });

  it('drop index of a drag: by the dragged centre against the other cards’ midpoints', () => {
    const rects = [0, 100, 200, 300].map((top) => ({ top, height: 90 }));
    expect(dropIndex(rects, 0, 0)).toBe(0);
    expect(dropIndex(rects, 0, 120)).toBe(1);
    expect(dropIndex(rects, 0, 260)).toBe(2);
    expect(dropIndex(rects, 0, 310)).toBe(3);
    expect(dropIndex(rects, 3, -310)).toBe(0);
    expect(dropIndex(rects, 2, 10)).toBe(2);
  });

  it('set count 1–20 (new sets copy the last); common values write every set; per-set values one', () => {
    const item = LEGS.items[0]!;
    const four = setCount(item, 4);
    expect(four.sets).toHaveLength(4);
    expect(four.sets.every((s) => s.kg === 40 && s.reps === 12)).toBe(true);
    expect(setCount(item, 0).sets).toHaveLength(1);
    expect(setCount(item, 99).sets).toHaveLength(20);
    const heavier = setCommon(four, 'kg', 42.6);
    expect(heavier.sets.map((s) => s.kg)).toEqual([42.5, 42.5, 42.5, 42.5]);
    expect(setsDiffer(heavier)).toBe(false);
    const pyramid = setOne(heavier, 3, 'reps', 8);
    expect(pyramid.sets.map((s) => s.reps)).toEqual([12, 12, 12, 8]);
    expect(setsDiffer(pyramid)).toBe(true);
    expect(commonValue(pyramid, 'reps')).toBe(12);
    expect(removeSet(pyramid, 3).sets).toHaveLength(3);
    expect(removeSet(setCount(item, 1), 0).sets).toHaveLength(1);
    expect(setRest(item, 1000).restSec).toBe(900);
    expect(setRest(item, -5).restSec).toBe(0);
  });

  it('summary line: «3 × 12 · 40 кг · відпочинок 1:30»; a deleted own exercise reads «Вправу видалено»', () => {
    expect(spoken(itemSummary(setCount(LEGS.items[0]!, 3), squat))).toBe('3 × 12 · 40 кг · відпочинок 1:30');
    expect(itemSummary({ ...LEGS.items[0]!, exerciseId: 'goneOwnExercise' }, undefined)).toBe(
      'Вправу видалено',
    );
  });

  it('validates on save: a name and at least one existing exercise', () => {
    expect(validate(draftFrom(null), [])).toEqual({ name: NAME_REQUIRED, items: ITEMS_REQUIRED });
    expect(validate({ ...draftFrom(LEGS), name: '  ' }, [])).toEqual({ name: NAME_REQUIRED });
    expect(validate(draftFrom(LEGS), [])).toBeNull();
    expect(
      validate({ ...draftFrom(LEGS), items: [{ ...LEGS.items[0]!, exerciseId: 'goneOwnExercise' }] }, []),
    ).toEqual({ items: ITEMS_REQUIRED });
  });

  it('toWorkout: trimmed name, days Monday-first, only the kind’s set fields, missing exercises dropped — a valid op value', () => {
    const d = {
      id: null,
      name: '  Ноги   +  прес ',
      days: [0, 4, 1] as const,
      items: [
        { ...LEGS.items[0]!, sets: [{ reps: 12, kg: 40, sec: 30, min: 5, km: 1 }] },
        { ...LEGS.items[1]!, exerciseId: 'goneOwnExercise' },
      ],
    };
    const w = toWorkout({ ...d, days: [...d.days] }, 'workoutNew0001', []);
    expect(w).toEqual({
      id: 'workoutNew0001',
      name: 'Ноги + прес',
      days: [1, 4, 0],
      items: [{ ...LEGS.items[0]!, sets: [{ reps: 12, kg: 40, sec: null, min: null, km: null }] }],
    });
    expect(workoutSchema.safeParse(w).success).toBe(true);
  });

  it('plan days: which days the save adds, and the toast that says so', () => {
    const settings = defaultSettings();
    settings.rem.workout.days = [1, 3];
    expect(addedPlanDays(settings, [1, 3])).toEqual([]);
    expect(addedPlanDays(settings, [5, 4, 1])).toEqual([4, 5]);
    expect(savedToast([])).toBe('Збережено');
    expect(savedToast([4])).toBe('Збережено · Чт додано до плану');
    expect(savedToast([4, 5])).toBe('Збережено · Чт, Пт додано до плану');
  });

  it('days note: the reminder time, or that the days join the plan when it is off', () => {
    const settings = defaultSettings();
    settings.rem.workout = { on: true, days: [1], time: '18:00' };
    expect(daysNote(settings)).toBe(
      'У ці дні нагадаю о 18:00. Дні тренувань — це твій план у Налаштуваннях → Нагадування.',
    );
    settings.rem.workout.on = false;
    expect(daysNote(settings)).toBe('Нагадування вимкнено. Ці дні додадуться до плану тренувань.');
  });

  it('restores a stored draft field by field; anything malformed is dropped', () => {
    const d = draftFrom(LEGS);
    expect(parseBuilderDraft(JSON.parse(JSON.stringify(d)))).toEqual(d);
    expect(parseBuilderDraft({ ...d, days: [1, 9, 'x', 3] })?.days).toEqual([1, 3]);
    expect(parseBuilderDraft(null)).toBeNull();
    expect(parseBuilderDraft({ ...d, items: [{ key: 1 }] })).toBeNull();
    expect(parseBuilderDraft({ ...d, items: [{ ...LEGS.items[0], sets: [] }] })).toBeNull();
    expect(parseBuilderDraft({ ...d, id: 5 })).toBeNull();
  });

  it('prefill reads the latest done session only (an active one is ignored)', () => {
    const data = trainingData();
    data.sessions = [
      doneLegs(),
      { ...doneLegs({ id: 'sessionLive0001', date: '2026-10-14' }), status: 'active' },
    ];
    data.sessions[1]!.exercises[0]!.sets = data.sessions[1]!.exercises[0]!.sets.map((s) => ({
      ...s,
      kg: 80,
    }));
    const d = addExercises(draftFrom(null), data, ['lib.back-squat'], key);
    expect(d.items[0]!.sets[0]!.kg).toBe(40);
  });
});
