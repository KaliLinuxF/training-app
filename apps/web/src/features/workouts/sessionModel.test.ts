import { describe, expect, it } from 'vitest';
import { findExercise, sessionKcal, sessionSchema } from '@legko/shared';
import {
  addExercise,
  addSet,
  applyHint,
  cardState,
  cardSummary,
  confirmLabel,
  confirmSet,
  currentPosition,
  finishPlan,
  hintDeltaText,
  lastTime,
  minutesText,
  minutesToSec,
  moveExercise,
  progressOf,
  progressText,
  recordText,
  removeExercise,
  removeSet,
  restAfter,
  setSkipped,
  summaryOf,
  toggleSet,
  undoneBody,
  undoneCount,
  updateSet,
} from './sessionModel';
import { spoken } from './copy';
import { doneLegs, entry, session, set, trainingData } from './testing';

const plain = spoken;

describe('current exercise and set', () => {
  it('is the first exercise that is not skipped with an undone set, and its first undone set', () => {
    const s = session();
    expect(currentPosition(s)).toEqual({ key: 'back-squat-key', index: 0 });
    const one = confirmSet(s, 'back-squat-key', 0);
    expect(currentPosition(one)).toEqual({ key: 'back-squat-key', index: 1 });
    // A set done out of order: the first undone one is still current.
    expect(currentPosition(confirmSet(s, 'back-squat-key', 1))).toEqual({ key: 'back-squat-key', index: 0 });
    const squatDone = [0, 1, 2].reduce((acc, i) => confirmSet(acc, 'back-squat-key', i), s);
    expect(currentPosition(squatDone)).toEqual({ key: 'crunch-key', index: 0 });
    expect(currentPosition(setSkipped(squatDone, 'crunch-key', true))).toBeNull();
  });

  it('cards: current / done / upcoming / skipped', () => {
    const s = [0, 1, 2].reduce((acc, i) => confirmSet(acc, 'back-squat-key', i), session());
    const cur = currentPosition(s);
    expect(cardState(s.exercises[0]!, cur)).toBe('done');
    expect(cardState(s.exercises[1]!, cur)).toBe('current');
    expect(cardState(session().exercises[1]!, currentPosition(session()))).toBe('upcoming');
    expect(cardState({ ...s.exercises[0]!, skipped: true }, cur)).toBe('skipped');
    expect(plain(cardSummary(s.exercises[0]!, 'done'))).toBe('3 × 12 · 40 кг');
    expect(plain(cardSummary(session().exercises[1]!, 'upcoming'))).toBe('20 · 20 повт.');
    expect(cardSummary(s.exercises[0]!, 'skipped')).toBe('Пропущено');
  });
});

describe('set changes', () => {
  it('toggle undoes a done set; update rounds kg to 0,25 and clamps; add copies the last set; remove keeps one', () => {
    const s = session();
    const done = confirmSet(s, 'back-squat-key', 0);
    expect(done.exercises[0]!.sets[0]!.done).toBe(true);
    expect(toggleSet(done, 'back-squat-key', 0).exercises[0]!.sets[0]!.done).toBe(false);
    expect(updateSet(s, 'back-squat-key', 1, 'kg', 42.6).exercises[0]!.sets[1]!.kg).toBe(42.5);
    expect(updateSet(s, 'back-squat-key', 1, 'reps', -3).exercises[0]!.sets[1]!.reps).toBe(0);
    expect(updateSet(s, 'back-squat-key', 1, 'kg', null).exercises[0]!.sets[1]!.kg).toBeNull();
    const four = addSet(done, 'back-squat-key');
    expect(four.exercises[0]!.sets).toHaveLength(4);
    expect(four.exercises[0]!.sets[3]).toEqual({ ...set({ reps: 12, kg: 40 }) });
    expect(addSet(s, 'back-squat-key', true).exercises[0]!.sets[3]!.done).toBe(true);
    expect(removeSet(four, 'back-squat-key', 3).exercises[0]!.sets).toHaveLength(3);
    const single = { ...s, exercises: [entry('lib.plank', [set({ sec: 45 })])] };
    expect(removeSet(single, 'plank-key', 0).exercises[0]!.sets).toHaveLength(1);
  });

  it('skip / back, remove from this session, move up and down within it', () => {
    const s = session();
    expect(setSkipped(s, 'crunch-key', true).exercises[1]!.skipped).toBe(true);
    expect(removeExercise(s, 'back-squat-key').exercises.map((e) => e.key)).toEqual(['crunch-key']);
    expect(moveExercise(s, 'crunch-key', -1).exercises.map((e) => e.key)).toEqual([
      'crunch-key',
      'back-squat-key',
    ]);
    expect(moveExercise(s, 'crunch-key', 1)).toBe(s);
  });

  it('adds an exercise prefilled from the last time (live: not done; edit: done)', () => {
    const data = trainingData();
    const squat = findExercise([], 'lib.back-squat')!;
    const s = { ...session(), exercises: [] };
    const live = addExercise(s, data, squat, 'addedKey01', false);
    expect(live.exercises[0]!.sets).toEqual([1, 2, 3].map(() => set({ reps: 12, kg: 40 })));
    const past = addExercise(s, data, squat, 'addedKey01', true);
    expect(past.exercises[0]!.sets.every((x) => x.done)).toBe(true);
    expect(sessionSchema.safeParse(live).success).toBe(true);
  });
});

describe('hint', () => {
  it('reads the last time before this session and offers +2,5 кг when every set was done', () => {
    const data = trainingData();
    const s = session();
    const lt = lastTime(data, s, s.exercises[0]!);
    expect(plain(lt.summary ?? '')).toBe('3 × 12 · 40 кг');
    expect(lt.hint).toEqual({ text: 'Минулого разу всі підходи виконано — спробуй +2,5 кг', kgDelta: 2.5 });
    expect(hintDeltaText(lt.hint!)).toBe('+2,5 кг');
    expect(hintDeltaText({ text: '', repsDelta: 1 })).toBe('+1 повторення');
    expect(hintDeltaText({ text: '', secDelta: 10 })).toBe('+10 с');
  });

  it('applies to the sets not done yet only, and «Скасувати» takes exactly that back', () => {
    const s = confirmSet(session(), 'back-squat-key', 0);
    const hint = { text: '', kgDelta: 2.5 };
    const up = applyHint(s, 'back-squat-key', hint, 1);
    expect(up.exercises[0]!.sets.map((x) => x.kg)).toEqual([40, 42.5, 42.5]);
    expect(applyHint(up, 'back-squat-key', hint, -1).exercises[0]!.sets.map((x) => x.kg)).toEqual([
      40, 40, 40,
    ]);
    const reps = applyHint(session(), 'crunch-key', { text: '', repsDelta: 1 }, 1);
    expect(reps.exercises[1]!.sets.map((x) => x.reps)).toEqual([21, 21]);
  });

  it('no hint for an exercise she never did', () => {
    const s = { ...session(), exercises: [entry('lib.plank', [set({ sec: 45 })])] };
    expect(lastTime(trainingData(), s, s.exercises[0]!)).toEqual({ last: null, summary: null, hint: null });
  });
});

describe('progress, rest and finishing', () => {
  it('«2 з 4 вправ · 7 з 13 підходів» leaves skipped exercises out', () => {
    const s = [0, 1, 2].reduce((acc, i) => confirmSet(acc, 'back-squat-key', i), session());
    expect(progressOf(s)).toEqual({ exercisesDone: 1, exercisesTotal: 2, setsDone: 3, setsTotal: 5 });
    expect(progressText(progressOf(s))).toBe('1 з 2 вправ · 3 з 5 підходів');
    expect(progressOf(setSkipped(s, 'crunch-key', true))).toEqual({
      exercisesDone: 1,
      exercisesTotal: 1,
      setsDone: 3,
      setsTotal: 3,
    });
  });

  it('rest after a set: the exercise’s rest, none after the last undone set of the session or with rest 0', () => {
    const s = session();
    expect(restAfter(s, 'back-squat-key', 0)).toBe(90);
    const almost = [0, 1, 2].reduce(
      (acc, i) => confirmSet(acc, 'back-squat-key', i),
      confirmSet(s, 'crunch-key', 0),
    );
    expect(restAfter(almost, 'crunch-key', 1)).toBe(0);
    const noRest = { ...s, exercises: s.exercises.map((e) => ({ ...e, restSec: 0 })) };
    expect(restAfter(noRest, 'back-squat-key', 0)).toBe(0);
  });

  it('finish plan: nothing done → offer to delete; undone sets → «не зарахуються»; else straight', () => {
    expect(finishPlan(session())).toEqual({ kind: 'empty' });
    const one = confirmSet(session(), 'back-squat-key', 0);
    expect(finishPlan(one)).toEqual({ kind: 'undone', count: 4 });
    expect(undoneCount(setSkipped(one, 'crunch-key', true))).toBe(2);
    expect(undoneBody(4)).toBe('Ще 4 підходи не відмічено — вони не зарахуються.');
    expect(undoneBody(1)).toBe('Ще 1 підхід не відмічено — вони не зарахуються.');
    expect(undoneBody(5)).toBe('Ще 5 підходів не відмічено — вони не зарахуються.');
    const all = [0, 1].reduce(
      (acc, i) => confirmSet(acc, 'crunch-key', i),
      [0, 1, 2].reduce((acc, i) => confirmSet(acc, 'back-squat-key', i), session()),
    );
    expect(finishPlan(all)).toEqual({ kind: 'ok' });
  });

  it('footer label «✓ Підхід 2 · 12 × 40 кг»', () => {
    expect(plain(confirmLabel(session().exercises[0]!, 1))).toBe('✓ Підхід 2 · 12 × 40 кг');
    expect(plain(confirmLabel(session().exercises[1]!, 0))).toBe('✓ Підхід 1 · 20 повт.');
  });
});

describe('summary', () => {
  it('duration, volume, sets, kcal (shared sessionKcal at her weight), records metric-aware, exercise rows', () => {
    const data = trainingData();
    const s = doneLegs({ id: 'sessionNew00001', date: '2026-10-14', createdAt: Date.now() });
    s.exercises[0]!.sets = s.exercises[0]!.sets.map((x) => ({ ...x, kg: 42.5 }));
    s.exercises.push(entry('lib.plank', [set({ sec: 45 })], { skipped: true }));
    data.sessions.push(s);
    const sum = summaryOf(data, s);
    expect(sum.durationSec).toBe(2880);
    expect(sum.volumeKg).toBe(3 * 12 * 42.5);
    expect(sum.setsDone).toBe(5);
    expect(sum.kcal).toBe(sessionKcal(s, 65));
    expect(sum.durationIgnored).toBe(false);
    expect(sum.records.map((r) => plain(r.text))).toEqual(['42,5 кг (було 40)']);
    expect(sum.exercises.map((e) => [e.name, plain(e.value)])).toEqual([
      ['Присідання зі штангою', '3 × 12 · 42,5 кг'],
      ['Скручування', '20 · 20 повт.'],
      ['Планка', 'Пропущено'],
    ]);
  });

  it('a too-short duration is flagged (the kcal ignores it)', () => {
    const s = doneLegs({ durationSec: 60 });
    expect(summaryOf(trainingData(), s).durationIgnored).toBe(true);
  });

  it('record texts per metric', () => {
    expect(plain(recordText({ metric: 'kg', value: 42.5, previous: 40 }))).toBe('42,5 кг (було 40)');
    expect(plain(recordText({ metric: 'km', value: 6, previous: 5.25 }))).toBe('6 км (було 5,25)');
  });

  it('duration minutes in the edit mode: empty = unknown', () => {
    expect(minutesText(null)).toBe('');
    expect(minutesText(2880)).toBe('48');
    expect(minutesToSec('')).toBeNull();
    expect(minutesToSec('48')).toBe(2880);
    expect(minutesToSec('x')).toBeUndefined();
    expect(minutesToSec('99999')).toBe(86400);
  });
});
