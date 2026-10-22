/**
 * Coach («Клієнти») data sets and stub payloads (docs/coach-cabinet.md §8.3).
 *
 * The data sets are relative to `today` (default `TODAY`, Wednesday 2026-10-14) with the default plan: weigh-in on
 * Monday (reminder on), workouts Mon / Wed / Fri, 1 700 kcal a day; macro goals only in `coachMeals`. They are valid
 * `POST /api/import` bodies (`seedClient` in `e2e/support/coachApi.ts`). The stub payloads are what
 * `GET /api/coach/clients[/:id]` would answer at `now` (default `FIXED_NOW`), built with the shared
 * `coachItemFromData` and `coachWindow`, so visual / a11y specs can serve them with `page.route`.
 */
import {
  addDays,
  clientToday,
  coachItemFromData,
  coachWindow,
  emptyData,
  findExercise,
  normalizeDay,
  sessionExerciseFrom,
  weekdayOf,
  type AppData,
  type CoachClient,
  type CoachClientResponse,
  type CoachClientStatus,
  type CoachClientsResponse,
  type DayEntry,
  type ISODate,
  type MacroGoals,
  type MeasureEntry,
  type SetValues,
  type WeightEntry,
  type Workout,
  type WorkoutSession,
} from '../../packages/shared/src/index';
import { FIXED_NOW, TIMEZONE, TODAY } from '../support/env';

const HOUR = 3_600_000;
const DAY = 86_400_000;

/** Stored food photo ids of `coachMeals`' breakfast (valid `photoIdSchema` ids). */
export const COACH_PHOTO_IDS: readonly string[] = Object.freeze([
  'coachPhotoBreakfast01',
  'coachPhotoBreakfast02',
]);

/** Fixed ids (32 hex) of the stub clients. */
export const COACH_STUB_IDS = Object.freeze({
  olya: 'c0ac0000000000000000000000000001',
  marta: 'c0ac0000000000000000000000000002',
  ivan: 'c0ac0000000000000000000000000003',
  sofia: 'c0ac0000000000000000000000000004',
  taras: 'c0ac0000000000000000000000000005',
  petro: 'c0ac0000000000000000000000000006',
} as const);

export type CoachStubName = keyof typeof COACH_STUB_IDS;

/** Macro goals of `coachMeals` (carbs without a goal). */
export const COACH_MACRO_GOALS: MacroGoals = Object.freeze({ protein: 90, fat: 60, carbs: null });

/** Days of history in the steady sets: five weeks before today. */
const HISTORY_DAYS = 35;
/** Daily kcal of the steady sets (≈ 1 600, well under 1 700 + 10 %), by day index. */
const STEADY_KCAL = [1580, 1620, 1600, 1650, 1550, 1610, 1590] as const;
const STEADY_FOOD = 'Вівсянка, курка з рисом, салат, йогурт';
const PLAN_DAYS: readonly number[] = [1, 3, 5];

/** Onboarded account with the default reminders (weigh-in Monday, plan Mon / Wed / Fri) and 1 700 kcal. */
function baseData(): AppData {
  const data = emptyData();
  data.settings = { ...data.settings, onboarded: true, goal: 62, kcalGoal: 1700, timezone: TIMEZONE };
  return data;
}

const legacyDay = (kcal: number, trained: boolean | null, types: string[] = []): DayEntry =>
  normalizeDay({ food: STEADY_FOOD, kcal, trained, types: trained === true ? types : [], notes: '' });

/**
 * Five weeks of steady records before `today`: a legacy day every day (≈ 1 600 kcal, a workout on every plan day),
 * a weigh-in every Monday (2026-10-12 included for `TODAY`), measurements every other Monday. No attention flag.
 */
export function coachSteady(today: ISODate = TODAY): AppData {
  const data = baseData();
  const start = addDays(today, -HISTORY_DAYS);
  const weights: WeightEntry[] = [];
  const measures: MeasureEntry[] = [];
  for (let i = 0; i < HISTORY_DAYS; i++) {
    const date = addDays(start, i);
    const weekday = weekdayOf(date);
    const plan = PLAN_DAYS.includes(weekday);
    data.days[date] = legacyDay(STEADY_KCAL[i % STEADY_KCAL.length]!, plan ? true : null, [
      i % 2 === 0 ? 'Кардіо' : 'Все тіло',
    ]);
    if (weekday === 1) {
      weights.push({ date, kg: Math.round((71.2 - weights.length * 0.4) * 10) / 10 });
      if (weights.length % 2 === 1)
        measures.push({
          date,
          chest: 94 - measures.length,
          waist: 78 - measures.length,
          hips: 102 - measures.length,
        });
    }
  }
  // The Monday of the current week (today included): the weigh-in of that day.
  for (let d = addDays(start, HISTORY_DAYS); d <= today; d = addDays(d, 1))
    if (weekdayOf(d) === 1)
      weights.push({ date: d, kg: Math.round((71.2 - weights.length * 0.4) * 10) / 10 });
  data.weights = weights;
  data.measures = measures;
  return data;
}

/** Kcal of [today − 7, today − 1] in `coachOverKcal`: average 1 950 = goal + 15 %. */
export const COACH_OVER_KCAL = [1900, 1950, 2000, 1950, 1900, 2000, 1950] as const;

/** As `coachSteady`, but the last seven full days are over the goal → «Калорії +15% за 7 днів». */
export function coachOverKcal(today: ISODate = TODAY): AppData {
  const data = coachSteady(today);
  COACH_OVER_KCAL.forEach((kcal, i) => {
    const date = addDays(today, i - 7);
    const day = data.days[date];
    data.days[date] = normalizeDay({ ...(day ?? legacyDay(kcal, null)), kcal });
  });
  return data;
}

/** As `coachSteady`, but nothing after today − 5 (2026-10-09) → «4 дні без записів» + «Без зважування». */
export function coachQuiet(today: ISODate = TODAY): AppData {
  const data = coachSteady(today);
  const last = addDays(today, -5);
  data.days = Object.fromEntries(Object.entries(data.days).filter(([date]) => date <= last));
  data.weights = data.weights.filter((w) => w.date <= last);
  data.measures = data.measures.filter((m) => m.date <= last);
  return data;
}

/**
 * As `coachSteady`, plus yesterday (2026-10-13) logged as meals: Сніданок 08:30 (two positions with macros, photos
 * `COACH_PHOTO_IDS[0..1]`), Обід 13:10, Вечеря 19:00 — 1 590 kcal, inside the steady band (no flag); trained with
 * «Кардіо». Macro goals: Б 90 · Ж 60 · В none.
 */
export function coachMeals(today: ISODate = TODAY): AppData {
  const data = coachSteady(today);
  data.settings = { ...data.settings, macroGoals: { ...COACH_MACRO_GOALS } };
  const date = addDays(today, -1);
  data.days[date] = normalizeDay({
    food: '',
    kcal: null,
    trained: true,
    types: ['Кардіо'],
    notes: 'Гарний день, багато ходила',
    meals: [
      {
        id: 'coachBreakfast',
        type: 'Сніданок',
        time: '08:30',
        text: '',
        kcal: null,
        protein: null,
        fat: null,
        carbs: null,
        photos: [...COACH_PHOTO_IDS.slice(0, 2)],
        items: [
          { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, protein: 9, fat: 6, carbs: 58 },
          { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 },
        ],
      },
      {
        id: 'coachLunch',
        type: 'Обід',
        time: '13:10',
        text: 'Борщ, хліб',
        kcal: 650,
        protein: 28,
        fat: 22,
        carbs: 80,
      },
      {
        id: 'coachDinner',
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

// ---- workouts and steps (docs/workouts-steps-rebrand.md §3.18) ---------------------------------

const planned = (over: Partial<SetValues>, n = 3): SetValues[] =>
  Array.from({ length: n }, () => ({ reps: null, kg: null, sec: null, min: null, km: null, ...over }));

/** The two workouts of `coachTraining` (both with days, inside the Mon / Wed / Fri plan). */
export const COACH_WORKOUTS: readonly Workout[] = Object.freeze([
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

/** Steps of `coachTraining`: 5 of the 6 days before today (none 3 days ago); steps goal 8 000. */
export const COACH_STEPS: readonly { back: number; steps: number }[] = Object.freeze([
  { back: 6, steps: 7200 },
  { back: 5, steps: 9100 },
  { back: 2, steps: 6400 },
  { back: 4, steps: 10_500 },
  { back: 1, steps: 8300 },
]);

function coachSession(workout: Workout, date: ISODate, minutes: number): WorkoutSession {
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
    exercises: workout.items.map((item, i) => {
      const exercise = findExercise([], item.exerciseId);
      if (!exercise) throw new Error(`no ${item.exerciseId}`);
      return sessionExerciseFrom(exercise, item, null, { key: `${id}-${i}`, done: true });
    }),
    notes: '',
    rev: 1,
    deviceId: null,
  };
}

/**
 * As `coachMeals`, plus training: the two `COACH_WORKOUTS`, 3 done sessions on the last three plan days before today
 * (for `TODAY`: Ноги + прес 2026-10-12 and 10-07, Верх тіла 10-09; all already marked trained), steps on the
 * `COACH_STEPS` days and a steps goal of 8 000. No attention flag changes.
 */
export function coachTraining(today: ISODate = TODAY): AppData {
  const data = coachMeals(today);
  data.settings = { ...data.settings, stepsGoal: 8000 };
  data.workouts = COACH_WORKOUTS.map((w) => structuredClone(w));
  const sessions: WorkoutSession[] = [];
  for (let back = 1; back <= 14 && sessions.length < 3; back++) {
    const date = addDays(today, -back);
    const workout = COACH_WORKOUTS.find((w) => w.days.includes(weekdayOf(date)));
    if (workout && data.days[date]?.trained === true) sessions.unshift(coachSession(workout, date, workout === COACH_WORKOUTS[0] ? 48 : 40));
  }
  data.sessions = sessions;
  data.steps = COACH_STEPS.map(({ back, steps }) => ({ date: addDays(today, -back), steps })).sort((a, b) =>
    a.date < b.date ? -1 : 1,
  );
  return data;
}

/** Onboarded, nothing recorded. */
export function coachEmpty(): AppData {
  return baseData();
}

interface StubSpec {
  username: string;
  data: (today: ISODate) => AppData;
  status: CoachClientStatus;
  /** How long before `now` the account was created / last seen (null = never). */
  createdAgo: number;
  lastSeenAgo: number | null;
}

const STUBS: Readonly<Record<CoachStubName, StubSpec>> = {
  // «Калорії +15% за 7 днів»
  olya: { username: 'olya', data: coachOverKcal, status: 'active', createdAgo: 40 * DAY, lastSeenAgo: HOUR },
  // «4 дні без записів», «Без зважування»
  marta: {
    username: 'marta',
    data: coachQuiet,
    status: 'active',
    createdAgo: 40 * DAY,
    lastSeenAgo: 5 * DAY,
  },
  // no_records (a) «Жодного запису від реєстрації», activity «вчора»
  ivan: {
    username: 'ivan',
    data: () => coachEmpty(),
    status: 'active',
    createdAgo: 10 * DAY,
    lastSeenAgo: DAY,
  },
  // no flags; meals + photos on 2026-10-13; macro goals set; workouts, 3 sessions and steps (coachTraining)
  sofia: {
    username: 'sofia',
    data: coachTraining,
    status: 'active',
    createdAgo: 40 * DAY,
    lastSeenAgo: 2 * HOUR,
  },
  // «Вимкнено», no flags
  taras: {
    username: 'taras',
    data: coachSteady,
    status: 'disabled',
    createdAgo: 40 * DAY,
    lastSeenAgo: 3 * DAY,
  },
  // inactive «Ще не входили»
  petro: {
    username: 'petro',
    data: () => coachEmpty(),
    status: 'active',
    createdAgo: 10 * DAY,
    lastSeenAgo: null,
  },
};

/** The stub names in list order (as the server would list them: by creation). */
export const COACH_STUB_NAMES: readonly CoachStubName[] = Object.freeze([
  'olya',
  'marta',
  'ivan',
  'sofia',
  'taras',
  'petro',
]);

function stubClient(name: CoachStubName, now: Date): CoachClient {
  const spec = STUBS[name];
  return {
    id: COACH_STUB_IDS[name],
    username: spec.username,
    status: spec.status,
    createdAt: now.getTime() - spec.createdAgo,
    lastSeenAt: spec.lastSeenAgo === null ? null : now.getTime() - spec.lastSeenAgo,
  };
}

/** A stub client's full data at `now` (the data sets are relative to the client's today in Kyiv). */
const stubData = (name: CoachStubName, now: Date): AppData => STUBS[name].data(clientToday(TIMEZONE, now));

/** `GET /api/coach/clients` for the window the web asks for at `now`: the six stub clients. */
export function coachClientsPayload(now: Date = FIXED_NOW): CoachClientsResponse {
  const window = coachWindow(now);
  return {
    ...window,
    clients: COACH_STUB_NAMES.map((name) =>
      coachItemFromData(stubClient(name, now), stubData(name, now), window),
    ),
  };
}

/** `GET /api/coach/clients/:id` of one stub client (`foods: []`, as the server sends it). */
export function coachClientPayload(name: CoachStubName, now: Date = FIXED_NOW): CoachClientResponse {
  return { client: stubClient(name, now), data: { ...stubData(name, now), foods: [] } };
}
