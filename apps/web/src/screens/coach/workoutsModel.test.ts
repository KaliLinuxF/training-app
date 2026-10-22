import {
  addDays,
  coachSummary,
  findExercise,
  sessionExerciseFrom,
  stepsStats,
  type AppData,
  type CoachPeriod,
  type WorkoutSession,
} from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { doneSessionsIn, sessionsKcalIn } from '@/lib/stats';
import { client, doneSession, item, NOW, steady, TODAY, training, WORKOUTS } from './coach.fixtures';
import { coachDayModel } from './dayViewModel';
import { buildWorkoutsModel, coachSessionsOn, sessionsRange } from './workoutsModel';

const NB = String.fromCharCode(0xa0);
const SOFIA = client(4, 'sofia');
const summaryOf = (data: AppData, p: CoachPeriod) => coachSummary(item(SOFIA, data), NOW, p);
const model = (data: AppData, p: CoachPeriod) => buildWorkoutsModel(data, TODAY, summaryOf(data, p));

/** `training()` with the latest «Ноги + прес» (12 Oct) squatted at 42,5 kg on the last set and the crunches skipped. */
function withRecord(): AppData {
  const data = training();
  const latest = data.sessions.find((s) => s.date === '2026-10-12') as WorkoutSession;
  const [squat, crunch] = latest.exercises;
  if (!squat || !crunch) throw new Error('fixture');
  const last = squat.sets[2];
  if (last) {
    last.reps = 10;
    last.kg = 42.5;
  }
  crunch.skipped = true;
  return data;
}

describe('the range of «Тренування»', () => {
  it('is Monday … today for 7 and the last 30 days for 30 (as coachSummary counts workouts)', () => {
    expect(sessionsRange(TODAY, 7)).toEqual({ from: '2026-10-12', to: TODAY });
    expect(sessionsRange(TODAY, 30)).toEqual({ from: '2026-09-15', to: TODAY });
  });
});

describe('buildWorkoutsModel', () => {
  it('writes the schedule of her workouts', () => {
    expect(model(training(), 7).schedule).toBe('Розклад: Пн, Ср — Ноги + прес · Пт — Верх тіла');
    expect(model(steady(), 7).schedule).toBe('Розкладу немає');
  });

  it('lists the done sessions of the period newest first, with the date, duration and kcal', () => {
    const week = model(training(), 7);
    expect(week.sessions.map((s) => [s.title, s.value])).toEqual([
      ['12 жовтня · Ноги + прес', `48${NB}хв · ≈${NB}50${NB}ккал`],
    ]);
    const month = model(training(), 30);
    expect(month.sessions.map((s) => s.title)).toEqual([
      '12 жовтня · Ноги + прес',
      '9 жовтня · Верх тіла',
      '7 жовтня · Ноги + прес',
    ]);
    expect(month.sessions[1]?.value).toBe(`40${NB}хв · ≈${NB}33${NB}ккал`);
  });

  it('writes one row per exercise with its sets (formatSetsSummary)', () => {
    const [legs, upper] = model(training(), 30).sessions;
    expect(legs?.rows.map((r) => [r.title, r.sub, r.record])).toEqual([
      ['Присідання зі штангою', `3 × 12 · 40${NB}кг`, false],
      ['Скручування', `3 × 20${NB}повт.`, false],
    ]);
    expect(upper?.rows.map((r) => r.sub)).toEqual([`3 × 12 · 30${NB}кг`, `3 × 45${NB}с`]);
  });

  it('marks a skipped exercise «Пропущено» and a record with the pill (the first time is not a record)', () => {
    const [latest, , first] = model(withRecord(), 30).sessions;
    expect(latest?.rows).toEqual([
      {
        key: 'coach20261012-0',
        title: 'Присідання зі штангою',
        sub: `12 × 40 · 12 × 40 · 10 × 42,5${NB}кг`,
        skipped: false,
        record: true,
      },
      { key: 'coach20261012-1', title: 'Скручування', sub: 'Пропущено', skipped: true, record: false },
    ]);
    expect(first?.rows.some((r) => r.record)).toBe(false);
  });

  it('marks an exercise added twice once, and says when a kept exercise has no done set', () => {
    const data = withRecord();
    const latest = data.sessions.find((s) => s.date === '2026-10-12') as WorkoutSession;
    const squat = findExercise([], 'lib.back-squat');
    if (!squat) throw new Error('library');
    const again = sessionExerciseFrom(squat, null, null, { key: 'again', done: true });
    const undone = sessionExerciseFrom(squat, null, null, { key: 'undone', done: false });
    latest.exercises.push(again, undone);
    const rows = model(data, 7).sessions[0]?.rows ?? [];
    expect(rows.filter((r) => r.record).map((r) => r.key)).toEqual(['coach20261012-0']);
    expect(rows.find((r) => r.key === 'undone')?.sub).toBe('Підходи не виконано');
  });

  it('compares records in the same metric only (cardio: km, else minutes)', () => {
    const data = steady();
    const walk = findExercise([], 'lib.walk');
    if (!walk) throw new Error('library');
    const cardio = (date: string, values: { min: number; km: number | null }): WorkoutSession => {
      const base = doneSession(WORKOUTS[0] as (typeof WORKOUTS)[number], date, 40);
      const ex = sessionExerciseFrom(walk, null, null, { key: `walk-${date}`, done: true });
      ex.sets = [{ reps: null, kg: null, sec: null, min: values.min, km: values.km, done: true }];
      return { ...base, name: 'Прогулянка', workoutId: null, exercises: [ex] };
    };
    data.sessions = [
      cardio('2026-10-05', { min: 50, km: 5 }),
      cardio('2026-10-07', { min: 30, km: null }),
      cardio('2026-10-09', { min: 60, km: 6 }),
    ];
    const rows = model(data, 30).sessions.map((s) => [s.date, s.rows[0]?.sub, s.rows[0]?.record]);
    expect(rows).toEqual([
      ['2026-10-09', `60${NB}хв · 6${NB}км`, true],
      ['2026-10-07', `30${NB}хв`, false],
      ['2026-10-05', `50${NB}хв · 5${NB}км`, false],
    ]);
  });

  it('counts only done sessions (an active one never shows)', () => {
    const data = training();
    const active = doneSession(WORKOUTS[0] as (typeof WORKOUTS)[number], TODAY, 10);
    data.sessions.push({ ...active, id: 'activeToday', status: 'active', finishedAt: null, durationSec: null });
    expect(model(data, 7).sessions.map((s) => s.id)).toEqual(['coach20261012']);
    expect(coachSessionsOn(data, TODAY)).toEqual([]);
  });

  it('fills the strip with the table’s numbers: sessions, kcal, volume and the steps average with its goal', () => {
    expect(model(training(), 7).strip).toEqual([
      { label: 'Тренування', value: '1' },
      { label: 'Спалено', value: `≈${NB}50`, unit: 'ккал' },
      { label: 'Обʼєм', value: `1${NB}440`, unit: 'кг' },
      { label: 'Кроки, сер.', value: `8${NB}300`, unit: `/ 8${NB}000` },
    ]);
    // 1 440 + 3 × 12 × 30 + 1 440.
    expect(model(training(), 30).strip[2]).toEqual({ label: 'Обʼєм', value: `3${NB}960`, unit: 'кг' });
  });

  it('says so when the period has no session, with dashes in the strip', () => {
    const m = model(steady(), 30);
    expect(m.sessions).toEqual([]);
    expect(m.strip).toEqual([
      { label: 'Тренування', value: '0' },
      { label: 'Спалено', value: '—', unit: undefined },
      { label: 'Обʼєм', value: '—', unit: undefined },
      { label: 'Кроки, сер.', value: '—', unit: undefined },
    ]);
  });
});

describe('parity with the client’s own numbers', () => {
  it.each([7, 30] as const)('period %i: sessions and kcal equal lib/stats, steps equal stepsStats', (p) => {
    const data = training();
    const s = summaryOf(data, p);
    const { from, to } = sessionsRange(TODAY, p);
    expect(s.sessions.count).toBe(doneSessionsIn(data, from, to).length);
    expect(s.sessions.kcal).toBe(sessionsKcalIn(data, from, to));
    expect(model(data, p).sessions).toHaveLength(s.sessions.count);
    const steps = stepsStats(data.steps, addDays(TODAY, -p), addDays(TODAY, -1), 8000);
    expect(s.steps).toEqual({ ...steps, goal: 8000 });
  });
});

describe('the day view', () => {
  it('adds the steps row and each done session with its exercises; a day with only steps is not empty', () => {
    const data = training();
    const day = coachDayModel(data, '2026-10-12', TODAY);
    expect(day.rows.find((r) => r.key === 'steps')).toEqual({
      key: 'steps',
      title: 'Кроки',
      value: `6${NB}400`,
      valueTone: 'ink',
      text: `з 8${NB}000 · ≈${NB}223${NB}ккал`,
    });
    expect(day.rows.find((r) => r.key === 'training')?.text).toContain('Ноги + прес');
    expect(day.sessions.map((s) => [s.title, s.value, s.rows.map((r) => r.title)])).toEqual([
      ['Ноги + прес', `48${NB}хв · ≈${NB}50${NB}ккал`, ['Присідання зі штангою', 'Скручування']],
    ]);
    for (const row of day.rows) expect(Object.keys(row).sort()).toEqual(['key', 'text', 'title', 'value', 'valueTone']);

    const onlySteps: AppData = { ...steady(), steps: [{ date: TODAY, steps: 5000 }] };
    expect(coachDayModel(onlySteps, TODAY, TODAY).empty).toBe(false);
    expect(coachDayModel(steady(), TODAY, TODAY)).toMatchObject({ empty: true, sessions: [] });
  });
});
