/**
 * Test fixtures for the progress screen (imported by `*.test.ts(x)` only).
 *
 * TODAY is Friday 9 October 2026 (week from Monday 5 October).
 * - Weigh-ins every Monday 10 Aug … 5 Oct: 68,4 → 65,4 kg.
 * - Measurements 10 Aug, 7 Sep, 5 Oct: chest 93 → 92 → 91,5 · waist 74 → 72 → 70 · hips 101 → 100 → 99,5.
 * - 7 Sep … 4 Oct: 1 600 kcal every day; «Кардіо» on Mondays and Thursdays (8 workouts).
 * - This week: Mon 1 600 «Верх тіла», Tue 1 800 rest, Wed 1 500 «Низ тіла + Прес», Thu 1 700 rest,
 *   today only food.
 */
import { addDays, emptyData, weekdayOf, type AppData, type DayEntry } from '@legko/shared';

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
  data.days['2026-10-06'] = day({ kcal: 1800, trained: false });
  data.days['2026-10-07'] = day({ kcal: 1500, trained: true, types: ['Низ тіла', 'Прес'] });
  data.days['2026-10-08'] = day({ kcal: 1700, trained: false });
  data.days[TODAY] = day({ food: 'Вівсянка з бананом, кава' });
  return data;
}

/** A brand-new user: nothing recorded yet. */
export function freshData(): AppData {
  const data = emptyData();
  data.settings.onboarded = true;
  return data;
}
