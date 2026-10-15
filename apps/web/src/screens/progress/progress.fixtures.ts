/**
 * Test fixtures for the progress screen (imported by `*.test.ts(x)` only).
 *
 * TODAY is Friday 9 October 2026 (week from Monday 5 October).
 * - Weigh-ins every Monday 10 Aug … 5 Oct: 68,4 → 65,4 kg.
 * - Measurements 10 Aug, 7 Sep, 5 Oct: chest 93 → 92 → 91,5 · waist 74 → 72 → 70 · hips 101 → 100 → 99,5.
 * - 7 Sep … 4 Oct: 1 600 kcal every day (legacy days: food text, no meals); «Кардіо» on Mondays and Thursdays
 *   (8 workouts).
 * - This week: Mon 1 600 «Верх тіла» (legacy), Tue 1 800 rest, Wed 1 500 «Низ тіла + Прес», Thu 1 700 rest,
 *   today only food (legacy, no kcal).
 * - Tue, Wed and Thu are logged as meals (`MEALS_TUE`, `MEALS_WED`, `MEALS_THU`; the day kcal is their sum):
 *   Tue and Thu are complete for Б · Ж · В (Tue Б 100 · Ж 60 · В 200, Thu Б 97 · Ж 58 · В 188 → week averages
 *   98,5 · 59 · 194); Wed is partial (the converted legacy block «Їжа за день» has 600 kcal and no macros).
 */
import {
  addDays,
  emptyData,
  normalizeDay,
  weekdayOf,
  type AppData,
  type DayEntry,
  type Meal,
} from '@legko/shared';

export const TODAY = '2026-10-09';

const WEIGHTS: [string, number][] = [
  ['2026-08-10', 68.4],
  ['2026-08-17', 68.0],
  ['2026-08-24', 67.7],
  ['2026-08-31', 67.3],
  ['2026-09-07', 67.0],
  ['2026-09-14', 66.6],
  ['2026-09-21', 66.3],
  ['2026-09-28', 65.8],
  ['2026-10-05', 65.4],
];

const day = (patch: Partial<DayEntry>): DayEntry => ({
  food: 'Омлет, борщ, курка з рисом',
  kcal: null,
  trained: null,
  types: [],
  notes: '',
  ...patch,
});

/** A meal without positions; `patch` may add positions, macros, photos. */
export const meal = (patch: Partial<Meal> & Pick<Meal, 'id'>): Meal => ({
  type: '',
  time: null,
  text: '',
  kcal: null,
  protein: null,
  fat: null,
  carbs: null,
  ...patch,
});

/** Tuesday 6 Oct, 1 800 kcal, complete: Б 100 · Ж 60 · В 200 (the tea has no energy and is ignored, D22). */
export const MEALS_TUE: Meal[] = [
  meal({
    id: 'tueBreakfast',
    type: 'Сніданок',
    time: '08:30',
    text: 'Тост з тунцем',
    kcal: 450,
    protein: 30,
    fat: 15,
    carbs: 45,
  }),
  meal({
    id: 'tueLunch',
    type: 'Обід',
    time: '13:00',
    items: [
      { name: 'Борщ', portion: '300 г', kcal: 180, protein: 6, fat: 9, carbs: 19 },
      { name: 'Курка з рисом', portion: '350 г', kcal: 520, protein: 38, fat: 14, carbs: 60 },
    ],
  }),
  meal({ id: 'tueTea', type: 'Перекус', time: '16:30', text: 'Чай без цукру' }),
  meal({
    id: 'tueDinner',
    type: 'Вечеря',
    time: '19:30',
    text: 'Сирники зі сметаною',
    kcal: 650,
    protein: 26,
    fat: 22,
    carbs: 76,
  }),
];

/**
 * Wednesday 7 Oct, 1 500 kcal, partial for all three: the legacy block (600 kcal, no macros) next to an AI meal
 * with positions (900 kcal, Б 48 · Ж 44 · В 80).
 */
export const MEALS_WED: Meal[] = [
  meal({ id: 'legacy', text: 'Омлет, борщ', kcal: 600 }),
  meal({
    id: 'wedDinner',
    type: 'Вечеря',
    time: '19:00',
    items: [
      { name: 'Курка з рисом', portion: '350 г', kcal: 520, protein: 38, fat: 14, carbs: 60 },
      { name: 'Салат з горіхами', portion: '200 г', kcal: 380, protein: 10, fat: 30, carbs: 20 },
    ],
  }),
];

/** Thursday 8 Oct, 1 700 kcal, complete: Б 97 · Ж 58 · В 188. */
export const MEALS_THU: Meal[] = [
  meal({
    id: 'thuBreakfast',
    type: 'Сніданок',
    time: '08:00',
    text: 'Вівсянка з бананом',
    kcal: 320,
    protein: 9,
    fat: 6,
    carbs: 58,
  }),
  meal({
    id: 'thuLunch',
    type: 'Обід',
    time: '13:00',
    text: 'Курка з рисом',
    kcal: 520,
    protein: 38,
    fat: 14,
    carbs: 60,
  }),
  meal({
    id: 'thuDinner',
    type: 'Вечеря',
    time: '19:00',
    text: 'Риба з овочами',
    kcal: 860,
    protein: 50,
    fat: 38,
    carbs: 70,
  }),
];

/** A day logged as `meals`, stored as the reducer stores it (derived food / kcal / photos). */
export const mealDay = (meals: Meal[], patch: Partial<DayEntry> = {}): DayEntry =>
  normalizeDay({ ...day({ food: '', ...patch }), meals });

export function progressData(): AppData {
  const data = emptyData();
  data.settings.onboarded = true;
  data.weights = WEIGHTS.map(([date, kg]) => ({ date, kg }));
  data.measures = [
    { date: '2026-08-10', chest: 93, waist: 74, hips: 101 },
    { date: '2026-09-07', chest: 92, waist: 72, hips: 100 },
    { date: '2026-10-05', chest: 91.5, waist: 70, hips: 99.5 },
  ];
  for (let d = '2026-09-07'; d <= '2026-10-04'; d = addDays(d, 1)) {
    const cardio = weekdayOf(d) === 1 || weekdayOf(d) === 4;
    data.days[d] = day({ kcal: 1600, trained: cardio, types: cardio ? ['Кардіо'] : [] });
  }
  data.days['2026-10-05'] = day({ kcal: 1600, trained: true, types: ['Верх тіла'] });
  data.days['2026-10-06'] = mealDay(MEALS_TUE, { trained: false });
  data.days['2026-10-07'] = mealDay(MEALS_WED, { trained: true, types: ['Низ тіла', 'Прес'] });
  data.days['2026-10-08'] = mealDay(MEALS_THU, { trained: false });
  data.days[TODAY] = day({ food: 'Вівсянка з бананом, кава' });
  return data;
}

/** A brand-new user: nothing recorded yet. */
export function freshData(): AppData {
  const data = emptyData();
  data.settings.onboarded = true;
  return data;
}
