import { describe, expect, it } from 'vitest';
import {
  activeSession,
  appDataSchema,
  applyOp,
  applyOps,
  bestSetValue,
  bodyWeightOn,
  coachItemFromData,
  coachSummary,
  compareSessions,
  dayBurned,
  defaultSettings,
  digestSession,
  doneSessionsOn,
  durationIgnored,
  emptyData,
  EQUIPMENT_LABELS,
  EXERCISE_GROUPS,
  EXERCISE_KIND_LABELS,
  EXERCISE_LIBRARY,
  exerciseActiveSec,
  exerciseHistory,
  exerciseSchema,
  FALLBACK_BODY_KG,
  findExercise,
  formatDuration,
  formatSet,
  formatSetsSummary,
  historyMetric,
  intensityOf,
  isLibraryExerciseId,
  isLiveSession,
  kgStep,
  lastPerformance,
  libraryExerciseSchema,
  LIMITS,
  MAX_SESSION_SEC,
  mergeSettingsPut,
  mergeTypes,
  MUSCLE_LABELS,
  MUSCLES,
  newSessionFromWorkout,
  normalizeExercise,
  normalizeSession,
  normalizeSettings,
  normalizeWorkout,
  opSchema,
  plannedActiveSec,
  progressionHint,
  reduceSessions,
  sessionExerciseFrom,
  sessionKcal,
  sessionKcalParts,
  sessionRecords,
  sessionSchema,
  sessionVolume,
  sessionWorkoutTypes,
  setsDone,
  settingsPutSchema,
  settingsSchema,
  staleActiveSessions,
  STEP_COUNTED_EXERCISES,
  stepsKcal,
  stepsStats,
  withDataDefaults,
  workoutsOn,
  type AppData,
  type CoachClient,
  type Exercise,
  type Op,
  type SessionExercise,
  type SessionSet,
  type WorkoutSession,
  type Workout,
} from './index';

// ---- builders --------------------------------------------------------------------------------

const NBSP = ' ';
const lib = (id: string): Exercise => {
  const e = findExercise([], id);
  if (!e) throw new Error(`no ${id}`);
  return e;
};

const set = (over: Partial<SessionSet> = {}): SessionSet => ({
  reps: null,
  kg: null,
  sec: null,
  min: null,
  km: null,
  done: true,
  ...over,
});

let keySeq = 0;
function entry(id: string, sets: SessionSet[], over: Partial<SessionExercise> = {}): SessionExercise {
  const e = lib(id);
  return {
    key: `key${++keySeq}`,
    exerciseId: e.id,
    name: e.name,
    kind: e.kind,
    met: e.met,
    equipment: e.equipment,
    primary: [...e.primary],
    secondary: [...e.secondary],
    restSec: e.kind === 'weight' ? 90 : e.kind === 'cardio' ? 0 : 45,
    skipped: false,
    sets,
    ...over,
  };
}

function session(over: Partial<WorkoutSession> = {}): WorkoutSession {
  return {
    id: 'session00001',
    date: '2026-10-14',
    workoutId: null,
    name: 'Ноги + прес',
    createdAt: 1_000,
    startedAt: null,
    finishedAt: null,
    durationSec: null,
    status: 'done',
    exercises: [],
    notes: '',
    rev: 0,
    deviceId: null,
    ...over,
  };
}

const squat3x12 = () => entry('lib.back-squat', [1, 2, 3].map(() => set({ reps: 12, kg: 40 })));
const plank3x45 = () => entry('lib.plank', [1, 2, 3].map(() => set({ sec: 45 })));
const run30 = () => entry('lib.run', [set({ min: 30 })]);

const put = (s: WorkoutSession): Op => ({ kind: 'session.put', value: s });

// ---- library ---------------------------------------------------------------------------------

describe('exercise library', () => {
  it('has 60–75 valid, unique, frozen rows', () => {
    expect(EXERCISE_LIBRARY.length).toBe(71);
    expect(new Set(EXERCISE_LIBRARY.map((e) => e.id)).size).toBe(EXERCISE_LIBRARY.length);
    expect(new Set(EXERCISE_LIBRARY.map((e) => e.name)).size).toBe(EXERCISE_LIBRARY.length);
    for (const e of EXERCISE_LIBRARY) {
      expect(libraryExerciseSchema.safeParse(e).success, e.id).toBe(true);
      expect(e.primary.length, e.id).toBeGreaterThan(0);
      expect(e.secondary.some((m) => e.primary.includes(m)), e.id).toBe(false);
      expect(e.met).toBeGreaterThanOrEqual(LIMITS.met.min);
      expect(e.met).toBeLessThanOrEqual(LIMITS.met.max);
      expect(isLibraryExerciseId(e.id)).toBe(true);
      expect(Object.isFrozen(e)).toBe(true);
    }
    expect(Object.isFrozen(EXERCISE_LIBRARY)).toBe(true);
  });

  it('never measures a band or the gravitron in kg', () => {
    for (const e of EXERCISE_LIBRARY) if (e.equipment === 'band') expect(e.kind, e.id).not.toBe('weight');
    expect(lib('lib.assisted-pull-up').kind).toBe('bodyweight');
    expect(lib('lib.band-pull-apart').kind).toBe('bodyweight');
    expect(lib('lib.russian-twist').name).toBe('Повороти корпусу сидячи');
  });

  it('every library group has members; labels cover every muscle, kind and equipment', () => {
    for (const g of EXERCISE_GROUPS) {
      if (g.id === 'mine') continue;
      const members = EXERCISE_LIBRARY.filter((e) =>
        g.id === 'cardio' ? e.kind === 'cardio' : e.primary.some((m) => g.muscles.includes(m)),
      );
      expect(members.length, g.id).toBeGreaterThan(0);
    }
    expect(Object.keys(MUSCLE_LABELS).sort()).toEqual([...MUSCLES].sort());
    expect(Object.keys(EXERCISE_KIND_LABELS)).toHaveLength(4);
    expect(Object.keys(EQUIPMENT_LABELS)).toHaveLength(9);
  });

  it('own ids never collide with seed ids; findExercise finds both, undefined when gone', () => {
    const own: Exercise = { ...lib('lib.walk'), id: 'ownExercise01', name: 'Степ-аеробіка' };
    expect(findExercise([own], 'ownExercise01')).toBe(own);
    expect(findExercise([own], 'lib.walk')?.name).toBe('Ходьба');
    expect(findExercise([], 'ownExercise01')).toBeUndefined();
    expect(findExercise([], 'lib.nope')).toBeUndefined();
    expect(isLibraryExerciseId('ownExercise01')).toBe(false);
    expect(STEP_COUNTED_EXERCISES).toEqual(['lib.walk', 'lib.incline-walk', 'lib.run']);
  });

  it('intensity and steps helpers', () => {
    expect(intensityOf('weight', 5.0)).toBe('moderate');
    expect(intensityOf('cardio', 9.8)).toBe('high');
    expect(intensityOf('bodyweight', 3.0)).toBe('light');
    expect(kgStep('dumbbell')).toBe(1);
    expect(kgStep('kettlebell')).toBe(1);
    expect(kgStep('barbell')).toBe(2.5);
  });
});

// ---- schemas / ops ---------------------------------------------------------------------------

describe('schemas', () => {
  it('exercise.put refuses a library id; own ids need 12+ base64url chars', () => {
    const own = { ...lib('lib.plank'), id: 'myPlank00001' };
    expect(opSchema.safeParse({ kind: 'exercise.put', value: own }).success).toBe(true);
    expect(opSchema.safeParse({ kind: 'exercise.put', value: lib('lib.plank') }).success).toBe(false);
    expect(exerciseSchema.safeParse({ ...own, id: 'short' }).success).toBe(false);
    expect(exerciseSchema.safeParse({ ...own, primary: ['abs', 'abs'] }).success).toBe(false);
  });

  it('set values: multiples of 0.25 kg, 0.5 min, 0.01 km; missing fields default to null', () => {
    const base = session({ exercises: [squat3x12()] });
    expect(sessionSchema.safeParse(base).success).toBe(true);
    const bad = (sets: unknown) =>
      sessionSchema.safeParse({ ...base, exercises: [{ ...base.exercises[0], sets }] }).success;
    expect(bad([{ ...set({ reps: 10, kg: 42.25 }) }])).toBe(true);
    expect(bad([{ ...set({ reps: 10, kg: 42.3 }) }])).toBe(false);
    expect(bad([{ ...set({ min: 20.5, km: 3.21 }) }])).toBe(true);
    expect(bad([{ ...set({ min: 20.3 }) }])).toBe(false);
    const parsed = sessionSchema.parse({
      ...base,
      rev: undefined,
      deviceId: undefined,
      exercises: [{ ...base.exercises[0], sets: [{ reps: 10, done: true }] }],
    });
    expect(parsed.rev).toBe(0);
    expect(parsed.deviceId).toBeNull();
    expect(parsed.exercises[0]?.sets[0]).toEqual(set({ reps: 10 }));
  });

  it('a duration out of 0…86 400 and duplicate keys are refused', () => {
    expect(sessionSchema.safeParse(session({ durationSec: -1 })).success).toBe(false);
    expect(sessionSchema.safeParse(session({ durationSec: 86_401 })).success).toBe(false);
    const e = squat3x12();
    expect(sessionSchema.safeParse(session({ exercises: [e, { ...e }] })).success).toBe(false);
  });

  it('steps ops: 1–100 000 whole', () => {
    expect(opSchema.safeParse({ kind: 'steps.put', date: '2026-10-14', steps: 8400 }).success).toBe(true);
    expect(opSchema.safeParse({ kind: 'steps.put', date: '2026-10-14', steps: 0 }).success).toBe(false);
    expect(opSchema.safeParse({ kind: 'steps.put', date: '2026-10-14', steps: 100_001 }).success).toBe(false);
    expect(opSchema.safeParse({ kind: 'steps.delete', date: '2026-10-14' }).success).toBe(true);
  });
});

describe('compatibility', () => {
  it('an old settings.put has no stepsGoal key and keeps a stored 8000', () => {
    const { stepsGoal: _drop, ...old } = defaultSettings();
    const parsed = settingsPutSchema.parse(old);
    expect('stepsGoal' in parsed).toBe(false);
    const stored = { ...defaultSettings(), stepsGoal: 8000 };
    expect(mergeSettingsPut(stored, parsed).stepsGoal).toBe(8000);
    expect(mergeSettingsPut(stored, { ...parsed, stepsGoal: null }).stepsGoal).toBeNull();
    // Stored settings without the key get null; normalizeSettings too.
    expect(settingsSchema.parse(old).stepsGoal).toBeNull();
    expect(normalizeSettings(old).stepsGoal).toBeNull();
    expect(normalizeSettings({ ...old, stepsGoal: 9000 }).stepsGoal).toBe(9000);
  });

  it('an old AppData parses with the new keys empty', () => {
    const { exercises: _a, workouts: _b, sessions: _c, steps: _d, deletedSessions: _e, ...old } = emptyData();
    const parsed = appDataSchema.parse({ ...old, settings: { ...old.settings, stepsGoal: undefined } });
    expect(parsed).toMatchObject({ exercises: [], workouts: [], sessions: [], steps: [], deletedSessions: [] });
    expect(parsed.settings.stepsGoal).toBeNull();
  });

  it('withDataDefaults fills a v4-shaped payload and keeps present keys', () => {
    const { exercises: _a, workouts: _b, sessions: _c, steps: _d, deletedSessions: _e, ...old } = emptyData();
    const { stepsGoal: _g, ...oldSettings } = old.settings;
    const filled = withDataDefaults({ ...old, settings: oldSettings as AppData['settings'] });
    expect(filled).toEqual(emptyData());
    const full = { ...emptyData(), steps: [{ date: '2026-10-14', steps: 5000 }] };
    full.settings.stepsGoal = 8000;
    expect(withDataDefaults(full)).toEqual(full);
  });

  it('day.put / day.delete / day.meta never touch sessions or steps', () => {
    let data = applyOps(emptyData(), [
      put(session({ exercises: [squat3x12()] })),
      { kind: 'steps.put', date: '2026-10-14', steps: 5000 },
    ]);
    const before = { sessions: data.sessions, steps: data.steps };
    data = applyOps(data, [
      { kind: 'day.put', date: '2026-10-14', value: { food: 'x', kcal: 100, trained: null, types: [], notes: '' } },
      { kind: 'day.delete', date: '2026-10-14' },
      { kind: 'day.meta', date: '2026-10-14', value: { trained: false } },
    ]);
    expect({ sessions: data.sessions, steps: data.steps }).toEqual(before);
  });
});

// ---- reducers --------------------------------------------------------------------------------

describe('reducers', () => {
  const ownEx = (i: number): Exercise => ({ ...lib('lib.plank'), id: `ownExercise${String(i).padStart(4, '0')}` });
  const workout = (i: number, over: Partial<Workout> = {}): Workout => ({
    id: `workout${String(i).padStart(5, '0')}`,
    name: `Тренування ${i}`,
    days: [],
    items: [],
    ...over,
  });

  it('exercise.put upserts in place; a new one beyond 300 is ignored; delete removes', () => {
    let data = emptyData();
    for (let i = 0; i < LIMITS.customExercises; i++) data = applyOp(data, { kind: 'exercise.put', value: ownEx(i) });
    expect(data.exercises).toHaveLength(300);
    const full = applyOp(data, { kind: 'exercise.put', value: ownEx(300) });
    expect(full.exercises).toHaveLength(300);
    const renamed = applyOp(full, { kind: 'exercise.put', value: { ...ownEx(5), name: '  Моя   планка ' } });
    expect(renamed.exercises[5]?.name).toBe('Моя планка');
    expect(applyOp(renamed, { kind: 'exercise.delete', id: ownEx(5).id }).exercises).toHaveLength(299);
  });

  it('workout.put keeps the position; a new one beyond 50 is ignored', () => {
    let data = emptyData();
    for (let i = 0; i < LIMITS.workouts; i++) data = applyOp(data, { kind: 'workout.put', value: workout(i) });
    data = applyOp(data, { kind: 'workout.put', value: workout(50) });
    expect(data.workouts).toHaveLength(50);
    data = applyOp(data, { kind: 'workout.put', value: workout(3, { name: 'Ноги', days: [0, 1, 3] }) });
    expect(data.workouts[3]).toMatchObject({ name: 'Ноги', days: [1, 3, 0] });
    expect(applyOp(data, { kind: 'workout.delete', id: workout(3).id }).workouts.map((w) => w.id)).not.toContain(
      workout(3).id,
    );
  });

  it('sessions are sorted by (date, createdAt, id); a NEW 11th on a date is ignored', () => {
    let data = emptyData();
    for (let i = 9; i >= 0; i--)
      data = applyOp(data, put(session({ id: `session0000${i}`, createdAt: 100 - i })));
    data = applyOp(data, put(session({ id: 'session00010', date: '2026-10-01' })));
    expect(data.sessions[0]?.date).toBe('2026-10-01');
    expect(data.sessions.slice(1).map((s) => s.createdAt)).toEqual([91, 92, 93, 94, 95, 96, 97, 98, 99, 100]);
    // The day is full: a new one is ignored, a move of an existing one is allowed.
    expect(applyOp(data, put(session({ id: 'session00011' }))).sessions).toHaveLength(11);
    const moved = applyOp(data, put(session({ id: 'session00010', createdAt: 1 })));
    expect(moved.sessions.filter((s) => s.date === '2026-10-14')).toHaveLength(11);
    expect(compareSessions(session({ id: 'a' }), session({ id: 'b' }))).toBeLessThan(0);
  });

  it('W13: [put active r3, put done r4, put active r3] stays done r4', () => {
    const active = session({ status: 'active', rev: 3, startedAt: 1 });
    const done = session({ status: 'done', rev: 4, finishedAt: 2 });
    const data = applyOps(emptyData(), [put(active), put(done), put(active)]);
    expect(data.sessions).toEqual([normalizeSession(done)]);
    // An active put with a higher rev still does not reopen it; a lower-rev done edit is ignored too.
    expect(applyOp(data, put({ ...active, rev: 9 })).sessions[0]?.status).toBe('done');
    expect(applyOp(data, put({ ...done, rev: 2, name: 'Інше' })).sessions[0]?.name).toBe('Ноги + прес');
    expect(applyOp(data, put({ ...done, rev: 5, name: 'Інше' })).sessions[0]?.name).toBe('Інше');
  });

  it('W13: [put, delete, put] stays deleted (tombstone)', () => {
    const s = session();
    const data = applyOps(emptyData(), [put(s), { kind: 'session.delete', id: s.id }, put({ ...s, rev: 7 })]);
    expect(data.sessions).toEqual([]);
    expect(data.deletedSessions).toEqual([s.id]);
    const state = reduceSessions({ sessions: [], deletedSessions: [] }, { kind: 'session.delete', id: 'zzzzzzzzzzzz' });
    expect(reduceSessions(state, { kind: 'session.delete', id: 'aaaaaaaaaaaa' }).deletedSessions).toEqual([
      'aaaaaaaaaaaa',
      'zzzzzzzzzzzz',
    ]);
  });

  it('every op sequence is idempotent: replaying it gives the same state', () => {
    const s = session({ exercises: [squat3x12()] });
    const ops: Op[] = [
      { kind: 'exercise.put', value: ownEx(1) },
      { kind: 'exercise.put', value: { ...ownEx(1), name: 'Друга' } },
      { kind: 'workout.put', value: workout(1, { days: [1] }) },
      put({ ...s, status: 'active', startedAt: 5 }),
      put({ ...s, rev: 1 }),
      put(session({ id: 'session00002' })),
      { kind: 'session.delete', id: 'session00002' },
      { kind: 'steps.put', date: '2026-10-14', steps: 5000 },
      { kind: 'steps.put', date: '2026-10-13', steps: 7000 },
      { kind: 'steps.delete', date: '2026-10-14' },
      { kind: 'exercise.delete', id: ownEx(2).id },
    ];
    const once = applyOps(emptyData(), ops);
    expect(applyOps(once, ops)).toEqual(once);
    expect(once.steps).toEqual([{ date: '2026-10-13', steps: 7000 }]);
  });
});

describe('normalisers', () => {
  it('normalizeExercise: name, unique and disjoint muscles, MET to one decimal', () => {
    const e = normalizeExercise({
      id: 'ownExercise01',
      name: '  Степ   аеробіка  ',
      kind: 'cardio',
      primary: ['quads', 'quads', 'calves'],
      secondary: ['calves', 'glutes', 'glutes'],
      equipment: 'other',
      met: 7.04,
    });
    expect(e).toMatchObject({ name: 'Степ аеробіка', primary: ['quads', 'calves'], secondary: ['glutes'], met: 7 });
  });

  it('normalizeWorkout: days in WEEK_ORDER, first key wins, library kind fields only', () => {
    const w = normalizeWorkout({
      id: 'workout00001',
      name: ' Ноги  + прес ',
      days: [0, 3, 1, 3],
      items: [
        { key: 'aaaa', exerciseId: 'lib.plank', sets: [{ reps: 5, kg: 10, sec: 45, min: null, km: null }], restSec: 45 },
        { key: 'aaaa', exerciseId: 'lib.crunch', sets: [{ reps: 20, kg: null, sec: null, min: null, km: null }], restSec: 30 },
      ],
    });
    expect(w.name).toBe('Ноги + прес');
    expect(w.days).toEqual([1, 3, 0]);
    expect(w.items).toHaveLength(1);
    expect(w.items[0]?.sets[0]).toEqual({ reps: null, kg: null, sec: 45, min: null, km: null });
  });

  it('normalizeSession: clamps the duration, active has no finish, defaults rev and deviceId', () => {
    const raw = {
      ...session({ status: 'active', finishedAt: 5, durationSec: 90_000.4 }),
      rev: undefined,
      deviceId: undefined,
    } as unknown as WorkoutSession;
    const s = normalizeSession(raw);
    expect(s).toMatchObject({ finishedAt: null, durationSec: 86_400, rev: 0, deviceId: null });
    expect(normalizeSession(session({ durationSec: -20 })).durationSec).toBe(0);
    const ex = entry('lib.crunch', [set({ reps: 20, kg: 5, sec: 10 })]);
    expect(normalizeSession(session({ exercises: [ex] })).exercises[0]?.sets[0]).toEqual(set({ reps: 20 }));
  });
});

// ---- formulas --------------------------------------------------------------------------------

describe('kcal', () => {
  const KG = 70;

  it('active time: strength 3 × 12 + 2 rests = 288 s; time 3 × 45 + 2 × 45 = 225 s; cardio typed minutes', () => {
    expect(exerciseActiveSec(squat3x12())).toBe(288);
    expect(exerciseActiveSec(plank3x45())).toBe(225);
    expect(exerciseActiveSec(run30())).toBe(1800);
    expect(exerciseActiveSec({ ...squat3x12(), skipped: true })).toBe(0);
    // Unknown reps → 40 s; few reps → at least 15 s; undone sets do not count.
    expect(exerciseActiveSec(entry('lib.push-up', [set(), set({ reps: 2 }), set({ reps: 50, done: false })], { restSec: 0 }))).toBe(55);
  });

  it('no duration: Σ MET × kg × hours (28 + 13.125 = 41)', () => {
    const s = session({ exercises: [squat3x12(), plank3x45()] });
    expect(sessionKcal(s, KG)).toBe(41);
    expect(sessionKcal(session(), KG)).toBe(0);
  });

  it('a plausible shorter duration scales the estimate down (400 s of 513 → 32)', () => {
    const s = session({ exercises: [squat3x12(), plank3x45()], durationSec: 400 });
    expect(sessionKcal(s, KG)).toBe(32);
    expect(durationIgnored(s)).toBe(false);
  });

  it('an implausible duration (2 minutes) is ignored', () => {
    const s = session({ exercises: [squat3x12(), plank3x45()], durationSec: 120 });
    expect(sessionKcal(s, KG)).toBe(41);
    expect(durationIgnored(s)).toBe(true);
    // A longer duration never scales up.
    expect(sessionKcal({ ...s, durationSec: 3600 }, KG)).toBe(41);
  });

  it('cardio is never scaled: 30 min run 290.5 + strength scaled to 200 s → 307', () => {
    const s = session({ exercises: [run30(), squat3x12(), plank3x45()], durationSec: 2000 });
    expect(sessionKcalParts(s, KG)).toEqual({ total: 307, stepCounted: 291 });
    // Even when the whole duration is shorter than the run.
    expect(sessionKcal({ ...s, durationSec: 1200 }, KG)).toBe(291);
  });

  it('steps kcal = round(steps × 0.0005 × kg)', () => {
    expect(stepsKcal(10_000, 70)).toBe(350);
    expect(stepsKcal(4500, 70)).toBe(158);
    expect(stepsKcal(8400, 66.5)).toBe(279);
  });

  it('a 40-min walk + 4 500 steps: the walk is not counted twice', () => {
    const data: AppData = {
      ...emptyData(),
      sessions: [session({ exercises: [entry('lib.walk', [set({ min: 40 })])] })],
      steps: [{ date: '2026-10-14', steps: 4500 }],
    };
    expect(dayBurned(data, '2026-10-14')).toEqual({ sessions: 163, steps: 158, total: 158 });
    // Without steps the walk counts fully; strength is never subtracted.
    expect(dayBurned({ ...data, steps: [] }, '2026-10-14')).toEqual({ sessions: 163, steps: 0, total: 163 });
    const gym = { ...data, sessions: [session({ exercises: [squat3x12()] })] };
    expect(dayBurned(gym, '2026-10-14')).toEqual({ sessions: 28, steps: 158, total: 186 });
    expect(dayBurned(data, '2026-10-13')).toBeNull();
    // Active sessions do not count.
    expect(dayBurned({ ...data, steps: [], sessions: [session({ status: 'active', exercises: [squat3x12()] })] }, '2026-10-14')).toBeNull();
  });

  it('body weight: latest on or before, else earliest after, else 70', () => {
    const weights = [
      { date: '2026-10-12', kg: 67 },
      { date: '2026-10-05', kg: 68 },
    ];
    expect(bodyWeightOn(weights, '2026-10-13')).toBe(67);
    expect(bodyWeightOn(weights, '2026-10-12')).toBe(67);
    expect(bodyWeightOn(weights, '2026-10-06')).toBe(68);
    expect(bodyWeightOn(weights, '2026-10-01')).toBe(68);
    expect(bodyWeightOn([], '2026-10-01')).toBe(FALLBACK_BODY_KG);
  });

  it('stepsStats: avg of the logged days in range, goal days', () => {
    const steps = [
      { date: '2026-10-07', steps: 12_000 },
      { date: '2026-10-08', steps: 6000 },
      { date: '2026-10-09', steps: 9001 },
      { date: '2026-10-15', steps: 20_000 },
    ];
    expect(stepsStats(steps, '2026-10-07', '2026-10-13', 9000)).toEqual({ avg: 9000, days: 3, goalDays: 2 });
    expect(stepsStats(steps, '2026-10-07', '2026-10-13', null)).toEqual({ avg: 9000, days: 3, goalDays: 0 });
    expect(stepsStats([], '2026-10-07', '2026-10-13', 9000)).toEqual({ avg: null, days: 0, goalDays: 0 });
  });
});

describe('volume, records, history', () => {
  it('volume = Σ kg × reps of done weight sets; sets done', () => {
    const s = session({
      exercises: [
        entry('lib.back-squat', [set({ reps: 12, kg: 40 }), set({ reps: 10, kg: 42.5 }), set({ reps: 8, kg: 45, done: false })]),
        entry('lib.crunch', [set({ reps: 20 })]),
        entry('lib.leg-press', [set({ reps: 10, kg: 100 })], { skipped: true }),
      ],
    });
    expect(sessionVolume(s)).toBe(905);
    expect(setsDone(s)).toBe(3);
  });

  it('bestSetValue is metric-aware', () => {
    expect(bestSetValue([set({ reps: 5, kg: 50 }), set({ reps: 0, kg: 60 }), set({ reps: 3, kg: 70, done: false })], 'weight')).toEqual({ metric: 'kg', value: 50 });
    expect(bestSetValue([set({ reps: 15 }), set({ reps: 20 })], 'bodyweight')).toEqual({ metric: 'reps', value: 20 });
    expect(bestSetValue([set({ sec: 45 }), set({ sec: 60 })], 'time')).toEqual({ metric: 'sec', value: 60 });
    expect(bestSetValue([set({ min: 30 })], 'cardio')).toEqual({ metric: 'min', value: 30 });
    expect(bestSetValue([set({ min: 30, km: 5 })], 'cardio')).toEqual({ metric: 'km', value: 5 });
    expect(bestSetValue([], 'weight')).toBeNull();
  });

  it('cardio [5 km, 30 min, 6 km] → only «6 км (було 5)»', () => {
    const runs = [
      session({ id: 'session00001', date: '2026-10-01', exercises: [entry('lib.run', [set({ min: 28, km: 5 })])] }),
      session({ id: 'session00002', date: '2026-10-05', exercises: [entry('lib.run', [set({ min: 30 })])] }),
      session({ id: 'session00003', date: '2026-10-09', exercises: [entry('lib.run', [set({ min: 33, km: 6 })])] }),
    ];
    expect(sessionRecords(runs, runs[0] as WorkoutSession)).toEqual([]);
    expect(sessionRecords(runs, runs[1] as WorkoutSession)).toEqual([]);
    expect(sessionRecords(runs, runs[2] as WorkoutSession)).toEqual([
      { exerciseId: 'lib.run', name: 'Біг', kind: 'cardio', metric: 'km', value: 6, previous: 5 },
    ]);
    const history = exerciseHistory(runs, 'lib.run');
    expect(history.map((p) => [p.metric, p.value])).toEqual([
      ['km', 5],
      ['min', 30],
      ['km', 6],
    ]);
    expect(historyMetric(history)).toBe('km');
  });

  it('the first time is not a record; an exercise added twice is pooled', () => {
    const first = session({ id: 'session00001', date: '2026-10-01', exercises: [squat3x12()] });
    expect(sessionRecords([first], first)).toEqual([]);
    const twice = session({
      id: 'session00002',
      date: '2026-10-05',
      exercises: [
        entry('lib.back-squat', [set({ reps: 12, kg: 40 })]),
        entry('lib.back-squat', [set({ reps: 8, kg: 45 })]),
      ],
    });
    const all = [first, twice];
    expect(sessionRecords(all, twice)).toEqual([
      { exerciseId: 'lib.back-squat', name: 'Присідання зі штангою', kind: 'weight', metric: 'kg', value: 45, previous: 40 },
    ]);
    const history = exerciseHistory(all, 'lib.back-squat');
    expect(history).toHaveLength(2);
    expect(history[1]).toMatchObject({ sessionId: 'session00002', value: 45 });
    expect(history[1]?.sets).toHaveLength(2);
    // A later session at the same weight is no record (strictly better only).
    const same = session({ id: 'session00003', date: '2026-10-09', exercises: [entry('lib.back-squat', [set({ reps: 5, kg: 45 })])] });
    expect(sessionRecords([...all, same], same)).toEqual([]);
  });
});

describe('last time, prefill, hint', () => {
  const earlier = session({
    id: 'session00001',
    date: '2026-10-10',
    exercises: [
      entry('lib.back-squat', [set({ reps: 12, kg: 40 }), set({ reps: 10, kg: 42.5 }), set({ reps: 8, kg: 45, done: false })]),
      entry('lib.back-squat', [set({ reps: 6, kg: 50 })]),
    ],
  });
  const older = session({ id: 'session00000', date: '2026-10-03', exercises: [entry('lib.back-squat', [set({ reps: 12, kg: 35 })])] });
  const sessions = [older, earlier];

  it('lastPerformance: the latest done session before, the n-th entry else the first', () => {
    const before = { date: '2026-10-14', createdAt: 0, id: 'new000000000' };
    expect(lastPerformance(sessions, 'lib.back-squat', before)?.sets[0]?.kg).toBe(40);
    expect(lastPerformance(sessions, 'lib.back-squat', before, 1)?.sets[0]?.kg).toBe(50);
    expect(lastPerformance(sessions, 'lib.back-squat', before, 5)?.sets[0]?.kg).toBe(40);
    expect(lastPerformance(sessions, 'lib.back-squat', { date: '2026-10-10', createdAt: 0, id: 'x' })?.sets[0]?.kg).toBe(35);
    expect(lastPerformance(sessions, 'lib.plank', before)).toBeNull();
    expect(lastPerformance(sessions, 'lib.back-squat', null)?.sets).toHaveLength(3);
  });

  it('prefill precedence: last done sets, then the plan, then DEFAULT_SET', () => {
    const squat = lib('lib.back-squat');
    const last = lastPerformance(sessions, 'lib.back-squat', null);
    const planned = { sets: [1, 2, 3, 4].map(() => ({ reps: 10, kg: 30, sec: null, min: null, km: null })), restSec: 120 };
    const withPlan = sessionExerciseFrom(squat, planned, last, { key: 'kkkk' });
    expect(withPlan.sets.map((s) => [s.reps, s.kg, s.done])).toEqual([
      [12, 40, false],
      [10, 42.5, false],
      [10, 42.5, false],
      [10, 42.5, false],
    ]);
    expect(withPlan.restSec).toBe(120);
    const noPlan = sessionExerciseFrom(squat, null, last, { key: 'kkkk', done: true });
    expect(noPlan.sets.map((s) => [s.reps, s.kg, s.done])).toEqual([
      [12, 40, true],
      [10, 42.5, true],
    ]);
    expect(noPlan.restSec).toBe(90);
    expect(sessionExerciseFrom(squat, planned, null, { key: 'kkkk' }).sets[0]).toMatchObject({ reps: 10, kg: 30 });
    const fresh = sessionExerciseFrom(lib('lib.run'), null, null, { key: 'kkkk' });
    expect(fresh.sets).toEqual([set({ min: 20, done: false })]);
    expect(sessionExerciseFrom(squat, null, null, { key: 'kkkk' }).sets).toEqual([1, 2, 3].map(() => set({ reps: 10, done: false })));
  });

  it('newSessionFromWorkout: skips gone exercises, prefills per occurrence', () => {
    let n = 0;
    const workout: Workout = {
      id: 'workout00001',
      name: 'Ноги + прес',
      days: [1, 3],
      items: [
        { key: 'it01', exerciseId: 'lib.back-squat', sets: [{ reps: 12, kg: 40, sec: null, min: null, km: null }], restSec: 90 },
        { key: 'it02', exerciseId: 'goneExercise1', sets: [{ reps: 1, kg: null, sec: null, min: null, km: null }], restSec: 0 },
        { key: 'it03', exerciseId: 'lib.back-squat', sets: [{ reps: 5, kg: 20, sec: null, min: null, km: null }], restSec: 60 },
      ],
    };
    const s = newSessionFromWorkout({
      data: { exercises: [], sessions },
      workout,
      date: '2026-10-14',
      id: 'session00009',
      now: 5000,
      newKey: () => `nk${++n}xx`,
      status: 'active',
    });
    expect(s).toMatchObject({ status: 'active', startedAt: 5000, createdAt: 5000, workoutId: 'workout00001', rev: 0 });
    expect(s.exercises.map((e) => e.sets[0]?.kg)).toEqual([40, 50]);
    expect(s.exercises.map((e) => e.key)).toEqual(['nk1xx', 'nk2xx']);
    expect(sessionSchema.safeParse(s).success).toBe(true);
    const free = newSessionFromWorkout({ data: { exercises: [], sessions }, workout: null, date: '2026-10-12', id: 'session00010', now: 1, newKey: () => 'k', status: 'done' });
    expect(free).toMatchObject({ name: 'Вільне тренування', startedAt: null, exercises: [] });
    expect(plannedActiveSec(workout, [])).toBe(36 + 15);
  });

  it('progressionHint: only after a fully done, not skipped last time', () => {
    const squat = (sets: SessionSet[]) => entry('lib.back-squat', sets);
    expect(progressionHint(squat([set({ reps: 10, kg: 40 }), set({ reps: 10, kg: 40, done: false }), set({ reps: 10, kg: 40, done: false })]))).toBeNull();
    expect(progressionHint(squat([set({ reps: 10, kg: 40 }), set({ reps: 10, kg: 40 })]))).toEqual({
      text: 'Минулого разу всі підходи виконано — спробуй +2,5 кг',
      kgDelta: 2.5,
    });
    expect(progressionHint(entry('lib.biceps-curl', [set({ reps: 10, kg: 8 })]))).toMatchObject({ kgDelta: 1, text: expect.stringContaining('+1 кг') });
    expect(progressionHint(squat([set({ reps: 10 })]))).toBeNull();
    expect(progressionHint({ ...squat([set({ reps: 10, kg: 40 })]), skipped: true })).toBeNull();
    expect(progressionHint(entry('lib.crunch', [set({ reps: 20 })]))).toEqual({
      text: 'Минулого разу всі підходи виконано — спробуй +1 повторення',
      repsDelta: 1,
    });
    expect(progressionHint(entry('lib.plank', [set({ sec: 45 })]))).toMatchObject({ secDelta: 10 });
    expect(progressionHint(run30())).toBeNull();
    expect(progressionHint(null)).toBeNull();
    expect(progressionHint(squat([]))).toBeNull();
  });
});

describe('types, schedule, liveness', () => {
  it('derives types from primary muscles of done exercises', () => {
    const types = (...ex: SessionExercise[]) => sessionWorkoutTypes(session({ exercises: ex }));
    expect(types(squat3x12(), entry('lib.crunch', [set({ reps: 20 })]))).toEqual(['Низ тіла', 'Прес']);
    expect(types(squat3x12(), entry('lib.bench-press', [set({ reps: 8, kg: 30 })]))).toEqual(['Все тіло']);
    expect(types(entry('lib.lat-pulldown', [set({ reps: 8, kg: 30 })]))).toEqual(['Верх тіла']);
    expect(types(entry('lib.walk', [set({ min: 40 })]))).toEqual(['Прогулянка']);
    expect(types(run30(), squat3x12())).toEqual(['Низ тіла', 'Кардіо']);
    expect(types({ ...squat3x12(), skipped: true })).toEqual([]);
    expect(types(entry('lib.back-extension', [set({ reps: 12 })]))).toEqual([]);
  });

  it('mergeTypes never removes her types', () => {
    const day = { food: '', kcal: null, trained: true, types: ['Розтяжка', 'Прес'], notes: '' };
    expect(mergeTypes(day, ['Прес', 'Низ тіла'])).toEqual(['Розтяжка', 'Прес', 'Низ тіла']);
    expect(mergeTypes({ ...day, trained: false }, ['Кардіо'])).toEqual(['Кардіо']);
    expect(mergeTypes(undefined, [])).toEqual([]);
  });

  it('workoutsOn uses the weekday of the date', () => {
    const w = (id: string, days: Workout['days']): Workout => ({ id, name: id, days, items: [] });
    // 2026-10-14 is a Wednesday.
    expect(workoutsOn([w('a', [1, 3]), w('b', [5]), w('c', [3])], '2026-10-14').map((x) => x.id)).toEqual(['a', 'c']);
  });

  it('a session started at 23:50 is still live at 00:20 with its own date; stale after 6 h', () => {
    const start = new Date(2026, 9, 14, 23, 50).getTime();
    const s = session({ status: 'active', startedAt: start, date: '2026-10-14' });
    const data = { sessions: [s] };
    const at0020 = start + 30 * 60_000;
    expect(isLiveSession(s, at0020)).toBe(true);
    expect(activeSession(data, at0020)?.date).toBe('2026-10-14');
    expect(Math.round((at0020 - start) / 1000)).toBe(1800);
    const later = start + MAX_SESSION_SEC * 1000 + 1;
    expect(activeSession(data, later)).toBeNull();
    expect(staleActiveSessions(data, later)).toEqual([s]);
    // Clock skew: a start in the future is live.
    expect(isLiveSession({ ...s, startedAt: at0020 + 60_000 }, at0020)).toBe(true);
    expect(isLiveSession({ ...s, status: 'done' }, at0020)).toBe(false);
    expect(doneSessionsOn({ sessions: [s, session({ id: 'session00002' })] }, '2026-10-14').map((x) => x.id)).toEqual(['session00002']);
  });

  it('activeSession picks the latest start', () => {
    const a = session({ id: 'session0000a', status: 'active', startedAt: 1000, date: '2026-10-13' });
    const b = session({ id: 'session0000b', status: 'active', startedAt: 2000 });
    expect(activeSession({ sessions: [b, a] }, 3000)?.id).toBe('session0000b');
  });
});

describe('formatting', () => {
  it('durations', () => {
    expect(formatDuration(48 * 60)).toBe(`48${NBSP}хв`);
    expect(formatDuration(65 * 60)).toBe(`1${NBSP}год 05${NBSP}хв`);
    expect(formatDuration(null)).toBe('—');
  });

  it('one set and a summary per kind', () => {
    expect(formatSet('weight', set({ reps: 12, kg: 40 }))).toBe(`12 × 40${NBSP}кг`);
    expect(formatSet('bodyweight', set({ reps: 15 }))).toBe(`15${NBSP}повт.`);
    expect(formatSet('time', set({ sec: 45 }))).toBe(`45${NBSP}с`);
    expect(formatSet('cardio', set({ min: 25, km: 3.2 }))).toBe(`25${NBSP}хв · 3,2${NBSP}км`);
    expect(formatSetsSummary(squat3x12())).toBe(`3 × 12 · 40${NBSP}кг`);
    const sets = [set({ reps: 12, kg: 42.5 }), set({ reps: 12, kg: 42.5 }), set({ reps: 10, kg: 42.5 })];
    expect(formatSetsSummary({ kind: 'weight', sets })).toBe(`12 · 12 · 10 × 42,5${NBSP}кг`);
    const mixed = [set({ reps: 12, kg: 40 }), set({ reps: 12, kg: 40 }), set({ reps: 10, kg: 42.5 })];
    expect(formatSetsSummary({ kind: 'weight', sets: mixed })).toBe(`12 × 40 · 12 × 40 · 10 × 42,5${NBSP}кг`);
    expect(formatSetsSummary(plank3x45())).toBe(`3 × 45${NBSP}с`);
    expect(formatSetsSummary({ kind: 'cardio', sets: [set({ min: 25, km: 3.2 })] })).toBe(`25${NBSP}хв · 3,2${NBSP}км`);
    expect(formatSetsSummary({ kind: 'weight', sets: [set({ reps: 10, kg: 35, done: false })] })).toBe('');
  });
});

describe('coach additions', () => {
  const client: CoachClient = { id: 'a1'.repeat(16), username: 'olya', status: 'active', createdAt: 0, lastSeenAt: null };
  const window = { from: '2026-09-11', to: '2026-10-15' };

  function sample(): AppData {
    const data = emptyData();
    data.settings = { ...defaultSettings(), onboarded: true, stepsGoal: 8000 };
    data.weights = [{ date: '2026-10-01', kg: 66 }];
    data.sessions = [
      session({ id: 'session00001', date: '2026-10-12', durationSec: 2880, exercises: [squat3x12()] }),
      session({ id: 'session00002', date: '2026-10-13', status: 'active', exercises: [squat3x12()] }),
      session({ id: 'session00003', date: '2026-09-01', exercises: [squat3x12()] }),
    ];
    data.steps = [
      { date: '2026-09-01', steps: 4000 },
      { date: '2026-10-10', steps: 9000 },
      { date: '2026-10-12', steps: 7000 },
      { date: '2026-10-16', steps: 6000 },
    ];
    data.workouts = [
      { id: 'workout00001', name: 'Ноги + прес', days: [1, 3], items: [] },
      { id: 'workout00002', name: 'Без днів', days: [], items: [] },
    ];
    return data;
  }

  it('digestSession: duration, sets, volume, kcal with the weight of the day', () => {
    const s = sample().sessions[0] as WorkoutSession;
    expect(digestSession(s, [{ date: '2026-10-01', kg: 66 }])).toEqual({
      id: 'session00001',
      date: '2026-10-12',
      name: 'Ноги + прес',
      durationSec: 2880,
      setsDone: 3,
      volumeKg: 1440,
      kcal: Math.round((5 * 66 * 288) / 3600),
    });
  });

  it('coachItemFromData: window steps, done sessions, the schedule', () => {
    const item = coachItemFromData(client, sample(), window);
    expect(item.steps).toEqual([
      { date: '2026-10-10', steps: 9000 },
      { date: '2026-10-12', steps: 7000 },
    ]);
    expect(item.sessions.map((s) => s.id)).toEqual(['session00001']);
    expect(item.schedule).toEqual([{ id: 'workout00001', name: 'Ноги + прес', days: [1, 3] }]);
  });

  it('coachSummary: steps over [T − 7, T − 1], sessions in the workouts range', () => {
    const now = new Date('2026-10-14T10:00:00+03:00');
    const summary = coachSummary(coachItemFromData(client, sample(), window), now, 7);
    expect(summary.steps).toEqual({ avg: 8000, days: 2, goal: 8000, goalDays: 1 });
    expect(summary.sessions).toEqual({ count: 1, kcal: 26 });
    // Older server: no new fields on the item.
    const { steps: _s, sessions: _x, schedule: _c, ...old } = coachItemFromData(client, sample(), window);
    const legacy = coachSummary(old as never, now, 7);
    expect(legacy.steps).toEqual({ avg: null, days: 0, goal: 8000, goalDays: 0 });
    expect(legacy.sessions).toEqual({ count: 0, kcal: 0 });
  });
});
