import { allExercises, EXERCISE_LIBRARY, type Exercise } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  chartSpeech,
  deleteConfirmBody,
  detailBack,
  detailModel,
  exerciseLabel,
  exerciseSub,
  filterExercises,
  formatMetric,
  GROUP_OPTIONS,
  libraryBack,
  normalizeText,
  plural,
} from './libraryModel';
import { entry, session, set, STEP, trainingData } from './testData';

const names = (list: readonly Exercise[]) => list.map((e) => e.name);
const ALL = allExercises([STEP]);

describe('filterExercises', () => {
  it('«Усі» lists the library and her own, sorted with the Ukrainian collation', () => {
    const list = filterExercises(ALL, { query: '', group: 'all' });
    expect(list).toHaveLength(EXERCISE_LIBRARY.length + 1);
    const sorted = [...names(list)].sort((a, b) => a.localeCompare(b, 'uk'));
    expect(names(list)).toEqual(sorted);
    // «Є», «І», «Ї» sort as in Ukrainian, not by code point.
    expect('Їзда'.localeCompare('Жим', 'uk')).toBeGreaterThan(0);
  });

  it('search «прис» finds every squat, case-insensitively, also in upper case', () => {
    const squats = names(filterExercises(ALL, { query: 'прис', group: 'all' }));
    expect(squats).toEqual(
      expect.arrayContaining(['Присідання зі штангою', 'Гоблет-присідання', 'Присідання', 'Сумо-присідання', 'Болгарські присідання']),
    );
    expect(squats.every((n) => n.toLocaleLowerCase('uk').includes('прис'))).toBe(true);
    expect(names(filterExercises(ALL, { query: '  ПРИС ', group: 'all' }))).toEqual(squats);
  });

  it('matches primary muscle labels and every word; one apostrophe form', () => {
    const glutes = filterExercises(ALL, { query: 'сідниці', group: 'all' });
    expect(glutes.length).toBeGreaterThan(5);
    expect(glutes.every((e) => e.primary.includes('glutes'))).toBe(true);
    expect(names(filterExercises(ALL, { query: 'жим гантел', group: 'all' }))).toEqual(
      expect.arrayContaining(['Жим гантелей лежачи', 'Жим гантелей сидячи']),
    );
    expect(normalizeText("Косі м'язи")).toBe(normalizeText('Косі мʼязи'));
    expect(filterExercises(ALL, { query: 'косі мʼязи', group: 'all' }).length).toBeGreaterThan(0);
    expect(filterExercises(ALL, { query: 'zzz', group: 'all' })).toEqual([]);
  });

  it('groups: by primary muscle, «Кардіо» by kind, «Мої» = her own; a query still filters inside', () => {
    expect(GROUP_OPTIONS.map((g) => g.label)).toEqual([
      'Усі', 'Груди', 'Спина', 'Плечі', 'Руки', 'Прес', 'Ноги', 'Сідниці', 'Кардіо', 'Мої',
    ]);
    const chest = filterExercises(ALL, { query: '', group: 'chest' });
    expect(chest.every((e) => e.primary.includes('chest'))).toBe(true);
    expect(names(chest)).toContain('Жим лежачи');
    const back = filterExercises(ALL, { query: '', group: 'back' });
    expect(back.every((e) => e.primary.some((m) => ['traps', 'lats', 'lowerBack'].includes(m)))).toBe(true);
    const cardio = filterExercises(ALL, { query: '', group: 'cardio' });
    expect(cardio.every((e) => e.kind === 'cardio')).toBe(true);
    expect(names(cardio)).toContain('Степ-аеробіка');
    expect(names(filterExercises(ALL, { query: '', group: 'mine' }))).toEqual(['Степ-аеробіка']);
    expect(names(filterExercises(ALL, { query: 'біг', group: 'cardio' }))).toEqual(['Біг']);
    expect(filterExercises(ALL, { query: 'біг', group: 'chest' })).toEqual([]);
  });
});

describe('labels', () => {
  it('exerciseSub: equipment · primary muscles', () => {
    const squat = EXERCISE_LIBRARY.find((e) => e.id === 'lib.back-squat')!;
    expect(exerciseSub(squat)).toBe('Штанга · Квадрицепс, сідниці');
    expect(exerciseSub(STEP)).toBe('Кардіо · Квадрицепс');
    expect(exerciseSub({ ...STEP, primary: [], kind: 'time' })).toBe('Інше');
    expect(exerciseLabel(STEP)).toBe('Степ-аеробіка');
    expect(exerciseLabel(undefined)).toBe('Вправу видалено');
  });

  it('formatMetric and plurals', () => {
    expect(formatMetric('kg', 42.5)).toBe('42,5 кг');
    expect(formatMetric('reps', 1)).toBe('1 повторення');
    expect(formatMetric('reps', 3)).toBe('3 повторення');
    expect(formatMetric('reps', 20)).toBe('20 повторень');
    expect(formatMetric('reps', 11)).toBe('11 повторень');
    expect(formatMetric('sec', 90)).toBe('1:30');
    expect(formatMetric('sec', 45)).toBe('45 с');
    expect(formatMetric('min', 30)).toBe('30 хв');
    expect(formatMetric('km', 5.2)).toBe('5,2 км');
    expect([1, 2, 5, 11, 12, 21, 22, 25].map((n) => plural(n, 'a', 'b', 'c')).join('')).toBe('abcccabc');
  });

  it('delete confirmation names the workouts count (omitted at 0)', () => {
    expect(deleteConfirmBody(2)).toBe('Її буде прибрано з 2 тренувань. Записані тренування залишаться.');
    expect(deleteConfirmBody(1)).toBe('Її буде прибрано з 1 тренування. Записані тренування залишаться.');
    expect(deleteConfirmBody(21)).toBe('Її буде прибрано з 21 тренування. Записані тренування залишаться.');
    expect(deleteConfirmBody(0)).toBe('Записані тренування залишаться.');
  });
});

describe('back targets', () => {
  it('the library goes back to Settings when opened from there, else to «Тренування»', () => {
    expect(libraryBack({ legkoFrom: '/settings/workouts' })).toEqual({ href: '/settings/workouts', label: 'Налаштування' });
    expect(libraryBack({ legkoFrom: '/workouts' })).toEqual({ href: '/workouts', label: 'Тренування' });
    expect(libraryBack(null)).toEqual({ href: '/workouts', label: 'Тренування' });
  });

  it('an exercise page goes back to Progress / a workout page it came from, else to «Вправи»', () => {
    expect(detailBack({ legkoFrom: '/progress' })).toEqual({ href: '/progress', label: 'Прогрес' });
    expect(detailBack({ legkoFrom: '/workouts/session/abc' })).toEqual({ href: '/workouts/session/abc', label: 'Тренування' });
    expect(detailBack({ legkoFrom: '/workouts/library' })).toEqual({ href: '/workouts/library', label: 'Вправи' });
    expect(detailBack({ legkoFrom: '/workouts/library/lib.run' })).toEqual({ href: '/workouts/library', label: 'Вправи' });
    expect(detailBack(undefined)).toEqual({ href: '/workouts/library', label: 'Вправи' });
  });
});

describe('detailModel', () => {
  it('unknown ids (and a deleted own exercise) → null', () => {
    expect(detailModel(trainingData(), 'lib.nope')).toBeNull();
    expect(detailModel({ ...trainingData(), exercises: [] }, STEP.id)).toBeNull();
  });

  it('the squat: facts, kg chart of done sessions oldest first, record, last sessions, the +2,5 kg hint', () => {
    const d = detailModel(trainingData(), 'lib.back-squat')!;
    expect(d.own).toBe(false);
    expect(d.facts).toEqual([
      { label: 'Тип', value: 'З вагою' },
      { label: 'Обладнання', value: 'Штанга' },
      { label: 'Основні', value: 'Квадрицепс, сідниці' },
      { label: 'Допоміжні', value: 'Задня поверхня стегна, привідні, поперек' },
      { label: 'Інтенсивність', value: 'Помірна · MET 5,0' },
    ]);
    expect(d.chart?.metric).toBe('kg');
    expect(d.chart?.title).toBe('Найкращий підхід, кг');
    // The active session (45 kg, nothing done) is not history.
    expect(d.chart?.points).toEqual([
      { date: '2026-09-30', value: 35 },
      { date: '2026-10-05', value: 37.5 },
      { date: '2026-10-07', value: 35 },
      { date: '2026-10-12', value: 40 },
    ]);
    expect(d.record).toMatchObject({ value: 40, date: '2026-10-12', text: '40 кг · 12 жовтня' });
    expect(d.recent.map((r) => r.title)).toEqual([
      '12 жовтня · Ноги + прес',
      '7 жовтня · Ноги + прес',
      '5 жовтня · Ноги + прес',
      '30 вересня · Ноги + прес',
    ]);
    expect(d.recent[0]).toMatchObject({ summary: '3 × 12 · 40 кг', href: `/workouts/session/${d.recent[0]!.sessionId}` });
    expect(d.hint).toBe('Минулого разу всі підходи виконано — спробуй +2,5 кг');
    expect(d.workoutsUsing).toBe(1);
    expect(chartSpeech(d.chart!)).toBe('Найкращий підхід, кг: з 35 кг до 40 кг');
  });

  it('records keep the first date the best was reached; at most 5 recent sessions', () => {
    const data = trainingData();
    for (const date of ['2026-10-01', '2026-10-02', '2026-10-03'])
      data.sessions.push(session(date, [entry('lib.back-squat', [set({ reps: 5, kg: 40 })])]));
    const d = detailModel(data, 'lib.back-squat')!;
    expect(d.record?.date).toBe('2026-10-01');
    expect(d.recent).toHaveLength(5);
  });

  it('no hint when a set was left undone or the exercise skipped', () => {
    const data = trainingData();
    data.sessions.push(
      session('2026-10-13', [entry('lib.back-squat', [set({ reps: 12, kg: 40 }), set({ reps: 12, kg: 40, done: false })])]),
    );
    expect(detailModel(data, 'lib.back-squat')!.hint).toBeNull();
  });

  it('cardio: km when any session has km, else minutes; one metric only', () => {
    const minutesOnly = detailModel(trainingData(), STEP.id)!;
    expect(minutesOnly.own).toBe(true);
    expect(minutesOnly.chart).toMatchObject({ metric: 'min', title: 'Найдовше, хв' });
    expect(minutesOnly.chart?.points.map((p) => p.value)).toEqual([20, 25]);
    expect(minutesOnly.hint).toBeNull();
    expect(minutesOnly.workoutsUsing).toBe(2);

    const data = trainingData();
    data.sessions.push(session('2026-10-13', [entry(STEP.id, [set({ min: 30, km: 4.2 })])]));
    const km = detailModel(data, STEP.id)!;
    expect(km.chart).toMatchObject({ metric: 'km', title: 'Найдовша дистанція, км' });
    expect(km.chart?.points).toEqual([{ date: '2026-10-13', value: 4.2 }]);
    expect(km.record?.text).toBe('4,2 км · 13 жовтня');
    // The recent list still shows every session of it.
    expect(km.recent).toHaveLength(3);
  });

  it('no history: no chart, no record, nothing recent', () => {
    const d = detailModel(trainingData(), 'lib.plank')!;
    expect(d.facts.find((f) => f.label === 'Тип')?.value).toBe('На час');
    expect(d.chart).toBeNull();
    expect(d.record).toBeNull();
    expect(d.recent).toEqual([]);
    expect(d.hint).toBeNull();
    expect(d.workoutsUsing).toBe(0);
  });
});
