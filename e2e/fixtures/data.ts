/**
 * Data sets the tests import into the server (`POST /api/import`) before they start.
 * The demo set is the dev seed script's generator (apps/server/scripts/seed-demo.ts), so the
 * suite sees exactly what developers see locally.
 */
import { demoData } from '../../apps/server/scripts/seed-demo';
import {
  emptyData,
  normalizeDay,
  type AppData,
  type MacroGoals,
  type Meal,
} from '../../packages/shared/src/index';
import { TODAY } from '../support/env';

export type SeedName = 'demo' | 'empty' | 'onboarded' | 'meals';

/**
 * ~10 weeks of realistic records ending today. Today: a legacy day (food text only, no kcal / workout mark yet);
 * the six days before it are logged as 3–4 typed meals with macros; older days are legacy days.
 */
export const demo = (): AppData => demoData(TODAY);

/** A brand-new account: nothing recorded, not onboarded (the setup sheet opens by itself). */
export const empty = (): AppData => emptyData();

/** Nothing recorded, but the first-run setup is done (no setup sheet). */
export function onboarded(): AppData {
  const data = emptyData();
  data.settings.onboarded = true;
  return data;
}

/**
 * Today's meals in the 'meals' seed (normalised, as the server stores them): Сніданок 08:15 with two positions
 * (380 ккал, Б 12 · Ж 9 · В 63) and Перекус 09:40 «Яблуко» 80 ккал without macros — so the day is 460 ккал,
 * Б 12 · Ж 9 · В 63, and partial for all three (D22: the apple has energy but no macros).
 */
export const MEALS_TODAY: Meal[] =
  normalizeDay({
    food: '',
    kcal: null,
    trained: null,
    types: [],
    notes: '',
    meals: [
      {
        id: 'e2eBreakfast',
        type: 'Сніданок',
        time: '08:15',
        text: 'Вівсянка з бананом, кава з молоком',
        kcal: null,
        protein: null,
        fat: null,
        carbs: null,
        items: [
          { name: 'Вівсянка з бананом', portion: '250 г', kcal: 320, protein: 9, fat: 6, carbs: 58 },
          { name: 'Кава з молоком', portion: '1 чашка', kcal: 60, protein: 3, fat: 3, carbs: 5 },
        ],
      },
      {
        id: 'e2eSnack0001',
        type: 'Перекус',
        time: '09:40',
        text: 'Яблуко',
        kcal: 80,
        protein: null,
        fat: null,
        carbs: null,
      },
    ],
  }).meals ?? [];

/** Macro goals of the 'meals' seed: protein and fat set, carbs without a goal. */
export const MEALS_GOALS: MacroGoals = { protein: 90, fat: 60, carbs: null };

/** The demo set, with today logged as `MEALS_TODAY` and macro goals `MEALS_GOALS`. */
export function meals(): AppData {
  const data = demo();
  const today = data.days[TODAY] ?? { food: '', kcal: null, trained: null, types: [], notes: '' };
  data.days[TODAY] = normalizeDay({ ...today, meals: MEALS_TODAY });
  data.settings = { ...data.settings, macroGoals: { ...MEALS_GOALS } };
  return data;
}

export function seedData(name: SeedName): AppData {
  switch (name) {
    case 'demo':
      return demo();
    case 'empty':
      return empty();
    case 'onboarded':
      return onboarded();
    case 'meals':
      return meals();
  }
}

export { demoData };
