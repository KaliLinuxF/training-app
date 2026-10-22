/**
 * Test fixtures of «Клієнти» (imported by `*.test.ts(x)` only). They mirror `e2e/fixtures/coach.ts` (which the web
 * package cannot import): today is Wednesday 2026-10-14 in Kyiv, weigh-in on Monday (reminder on), workouts Mon /
 * Wed / Fri, 1 700 kcal a day, goal 62 kg.
 */
import {
  addDays,
  coachItemFromData,
  coachWindow,
  emptyData,
  findExercise,
  normalizeDay,
  sessionExerciseFrom,
  weekdayOf,
  type AppData,
  type CoachClient,
  type CoachClientItem,
  type CoachClientsResponse,
  type DayEntry,
  type ISODate,
  type MeasureEntry,
  type SetValues,
  type WeightEntry,
  type Workout,
  type WorkoutSession,
} from '@legko/shared';

/** 12:00 in Kyiv on Wednesday 2026-10-14 (the same date in every device zone from UTC−9 to UTC+14). */
export const NOW = new Date('2026-10-14T09:00:00Z');
export const TODAY: ISODate = '2026-10-14';
export const KYIV = 'Europe/Kyiv';
const HOUR = 3_600_000;
const DAY = 86_400_000;

const STEADY_KCAL = [1580, 1620, 1600, 1650, 1550, 1610, 1590] as const;
const PLAN = [1, 3, 5];
export const OVER_KCAL = [1900, 1950, 2000, 1950, 1900, 2000, 1950] as const;
export const PHOTO_IDS = ['coachPhotoBreakfast01', 'coachPhotoBreakfast02'] as const;

function base(): AppData {
  const data = emptyData();
  data.settings = { ...data.settings, onboarded: true, goal: 62, kcalGoal: 1700, timezone: KYIV };
  return data;
}

const legacyDay = (kcal: number, trained: boolean | null): DayEntry =>
  normalizeDay({ food: 'Вівсянка, курка з рисом', kcal, trained, types: trained ? ['Кардіо'] : [], notes: '' });

/** Five weeks of steady records before today, a weigh-in every Monday, measurements every other Monday. */
export function steady(today: ISODate = TODAY): AppData {
  const data = base();
  const start = addDays(today, -35);
  const weights: WeightEntry[] = [];
  const measures: MeasureEntry[] = [];
  for (let i = 0; i < 35; i++) {
    const date = addDays(start, i);
    const weekday = weekdayOf(date);
    data.days[date] = legacyDay(STEADY_KCAL[i % STEADY_KCAL.length] ?? 1600, PLAN.includes(weekday) ? true : null);
    if (weekday === 1) {
      weights.push({ date, kg: Math.round((71.2 - weights.length * 0.4) * 10) / 10 });
      if (weights.length % 2 === 1)
        measures.push({ date, chest: 94 - measures.length, waist: 78 - measures.length, hips: 102 - measures.length });
    }
  }
  for (let d = addDays(start, 35); d <= today; d = addDays(d, 1))
    if (weekdayOf(d) === 1) weights.push({ date: d, kg: Math.round((71.2 - weights.length * 0.4) * 10) / 10 });
  data.weights = weights;
  data.measures = measures;
  return data;
}

/** Steady, but the last seven full days average 1 950 kcal (+15 %). */
export function overKcal(today: ISODate = TODAY): AppData {
  const data = steady(today);
  OVER_KCAL.forEach((kcal, i) => {
    const date = addDays(today, i - 7);
    data.days[date] = normalizeDay({ ...(data.days[date] ?? legacyDay(kcal, null)), kcal });
  });
  return data;
}

/** Steady up to today − 5 only: «4 дні без записів» + «Без зважування». */
export function quiet(today: ISODate = TODAY): AppData {
  const data = steady(today);
  const last = addDays(today, -5);
  data.days = Object.fromEntries(Object.entries(data.days).filter(([date]) => date <= last));
  data.weights = data.weights.filter((w) => w.date <= last);
  data.measures = data.measures.filter((m) => m.date <= last);
  return data;
}

/** Steady + yesterday logged as three meals (photos on the breakfast), trained «Кардіо», notes; Б 90 · Ж 60 goals. */
export function meals(today: ISODate = TODAY): AppData {
  const data = steady(today);
  data.settings = { ...data.settings, macroGoals: { protein: 90, fat: 60, carbs: null } };
  const date = addDays(today, -1);
  data.days[date] = normalizeDay({
    food: '',
    kcal: null,
    trained: true,
    types: ['Кардіо'],
    notes: 'Гарний день, багато ходила',
    meals: [
      {
        id: 'b',
        type: 'Сніданок',
        time: '08:30',
        text: '',
        kcal: null,
        protein: null,
        fat: null,
        carbs: null,
        photos: [...PHOTO_IDS],
        items: [
          { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, protein: 9, fat: 6, carbs: 58 },
          { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 },
        ],
      },
      { id: 'l', type: 'Обід', time: '13:10', text: 'Борщ, хліб', kcal: 650, protein: 28, fat: 22, carbs: 80 },
      {
        id: 'd',
        type: 'Вечеря',
        time: '19:00',
        text: 'Курка з овочами',
        kcal: 560,
        protein: 45,
        fat: 20,
        carbs: 35,
      },
    ],
  });
  return data;
}

// ---- workouts and steps (mirror `coachTraining` of e2e/fixtures/coach.ts) ------------------------

const planned = (over: Partial<SetValues>, n = 3): SetValues[] =>
  Array.from({ length: n }, () => ({ reps: null, kg: null, sec: null, min: null, km: null, ...over }));

/** «Ноги + прес» (Пн, Ср) and «Верх тіла» (Пт), inside the Mon / Wed / Fri plan. */
export const WORKOUTS: readonly Workout[] = Object.freeze([
  {
    id: 'coachWorkoutLegs',
    name: 'Ноги + прес',
    days: [1, 3],
    items: [
      { key: 'legs1', exerciseId: 'lib.back-squat', sets: planned({ reps: 12, kg: 40 }), restSec: 90 },
      { key: 'legs2', exerciseId: 'lib.crunch', sets: planned({ reps: 20 }), restSec: 60 },
    ],
  },
  {
    id: 'coachWorkoutUpper',
    name: 'Верх тіла',
    days: [5],
    items: [
      { key: 'upper1', exerciseId: 'lib.lat-pulldown', sets: planned({ reps: 12, kg: 30 }), restSec: 90 },
      { key: 'upper2', exerciseId: 'lib.plank', sets: planned({ sec: 45 }), restSec: 45 },
    ],
  },
]);

/** Steps on 5 of the 6 days before today (none 3 days ago); the steps goal is 8 000. */
export const STEPS: readonly { back: number; steps: number }[] = Object.freeze([
  { back: 6, steps: 7200 },
  { back: 5, steps: 9100 },
  { back: 2, steps: 6400 },
  { back: 4, steps: 10_500 },
  { back: 1, steps: 8300 },
]);

/** A done session of `workout` on `date` at 18:00 Kyiv, every planned set done. */
export function doneSession(workout: Workout, date: ISODate, minutes: number): WorkoutSession {
  const id = `coach${date.replace(/-/g, '')}`;
  const start = Date.parse(`${date}T18:00:00+03:00`);
  return {
    id,
    date,
    workoutId: workout.id,
    name: workout.name,
    createdAt: start,
    startedAt: start,
    finishedAt: start + minutes * 60_000,
    durationSec: minutes * 60,
    status: 'done',
    exercises: workout.items.map((it, i) => {
      const exercise = findExercise([], it.exerciseId);
      if (!exercise) throw new Error(`no ${it.exerciseId}`);
      return sessionExerciseFrom(exercise, it, null, { key: `${id}-${i}`, done: true });
    }),
    notes: '',
    rev: 1,
    deviceId: null,
  };
}

/**
 * As `meals`, plus training: the two `WORKOUTS`, 3 done sessions on the last three plan days before today
 * (Ноги + прес 2026-10-12 and 10-07, 48 min; Верх тіла 10-09, 40 min), the `STEPS` days and a steps goal of 8 000.
 */
export function training(today: ISODate = TODAY): AppData {
  const data = meals(today);
  data.settings = { ...data.settings, stepsGoal: 8000 };
  data.workouts = WORKOUTS.map((w) => structuredClone(w));
  const sessions: WorkoutSession[] = [];
  for (let back = 1; back <= 14 && sessions.length < 3; back++) {
    const date = addDays(today, -back);
    const workout = WORKOUTS.find((w) => w.days.includes(weekdayOf(date)));
    if (workout && data.days[date]?.trained === true)
      sessions.unshift(doneSession(workout, date, workout === WORKOUTS[0] ? 48 : 40));
  }
  data.sessions = sessions;
  data.steps = STEPS.map(({ back, steps }) => ({ date: addDays(today, -back), steps })).sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
  return data;
}

/** Onboarded, nothing recorded. */
export const empty = (): AppData => base();

/** A client account (32-hex id from `n`). */
export function client(n: number, username: string, patch: Partial<CoachClient> = {}): CoachClient {
  return {
    id: `c0ac${String(n).padStart(28, '0')}`,
    username,
    status: 'active',
    createdAt: NOW.getTime() - 40 * DAY,
    lastSeenAt: NOW.getTime() - HOUR,
    ...patch,
  };
}

export const item = (c: CoachClient, data: AppData, now: Date = NOW): CoachClientItem =>
  coachItemFromData(c, data, coachWindow(now));

/** The six stub clients of the e2e fixtures. */
export function stubClients(now: Date = NOW): CoachClientItem[] {
  const t = now.getTime();
  return [
    item(client(1, 'olya', { lastSeenAt: t - HOUR }), overKcal(), now),
    item(client(2, 'marta', { lastSeenAt: t - 5 * DAY }), quiet(), now),
    item(client(3, 'ivan', { createdAt: t - 10 * DAY, lastSeenAt: t - DAY }), empty(), now),
    item(client(4, 'sofia', { lastSeenAt: t - 2 * HOUR }), training(), now),
    item(client(5, 'taras', { status: 'disabled', lastSeenAt: t - 3 * DAY }), steady(), now),
    item(client(6, 'petro', { createdAt: t - 10 * DAY, lastSeenAt: null }), empty(), now),
  ];
}

export const clientsPayload = (now: Date = NOW): CoachClientsResponse => ({
  ...coachWindow(now),
  clients: stubClients(now),
});

/** An admin / a user as `useAuthStore` holds them. */
export const account = (role: 'user' | 'admin') => ({
  id: (role === 'admin' ? 'ad' : 'a1').padEnd(32, '0'),
  username: role === 'admin' ? 'admin' : 'anna',
  role,
  createdAt: 1_760_000_000_000,
  legacyOwner: false,
  passwordChange: null,
});
