import type { AppData, MacroGoals, Reminders, Settings } from './types';

/** Built-in workout types, in the order the chips are shown. */
export const WORKOUT_TYPES = [
  'Верх тіла',
  'Низ тіла',
  'Кардіо',
  'Прес',
  'Все тіло',
  'Розтяжка',
  'Прогулянка',
] as const;

/** Default meal types of a new account (and of data saved before meal types existed), in chip order. */
export const DEFAULT_MEAL_TYPES = ['Сніданок', 'Обід', 'Вечеря', 'Перекус'] as const;

/** No macro goals set. */
export const emptyMacroGoals = (): MacroGoals => ({ protein: null, fat: null, carbs: null });

export const DEFAULT_TIMEZONE = 'Europe/Kyiv';

/** Bounds for the goal steppers and the first-run setup (narrower than the schema's sanity limits). */
export const GOAL_LIMITS = {
  kg: { min: 30, max: 200, step: 0.5 },
  kcal: { min: 800, max: 5000, step: 50 },
} as const;

export function defaultReminders(): Reminders {
  return {
    workout: { on: true, days: [1, 3, 5], time: '18:00' },
    weigh: { on: true, day: 1, time: '08:00' },
    measure: { on: true, day: 1, time: '08:30' },
  };
}

export function defaultSettings(): Settings {
  return {
    goal: 60,
    kcalGoal: 1700,
    rem: defaultReminders(),
    timezone: DEFAULT_TIMEZONE,
    customTypes: [],
    onboarded: false,
    mealTypes: [...DEFAULT_MEAL_TYPES],
    macroGoals: emptyMacroGoals(),
    stepsGoal: null,
  };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const goalOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** The three goal keys of a stored object (anything else, or a non-object, is dropped). */
function macroGoalsOf(v: unknown): MacroGoals {
  if (!isRecord(v)) return emptyMacroGoals();
  return { protein: goalOrNull(v.protein), fat: goalOrNull(v.fat), carbs: goalOrNull(v.carbs) };
}

/** A stored steps goal: a whole number in its bounds, else null (none). */
function stepsGoalOf(v: unknown): number | null {
  return typeof v === 'number' && Number.isInteger(v) && v >= 1000 && v <= 50000 ? v : null;
}

/**
 * AppData from an older server / cache / backup with the newer keys filled in (no validation, no sorting): missing
 * exercises / workouts / sessions / steps / deletedSessions → [], settings.stepsGoal → null. Used where the data is
 * not zod-parsed (the coach detail response, the web normaliser).
 */
export function withDataDefaults(data: Partial<AppData>): AppData {
  const arr = <T>(v: T[] | undefined): T[] => (Array.isArray(v) ? v : []);
  const settings: Partial<Settings> | undefined = isRecord(data.settings) ? data.settings : undefined;
  return {
    days: isRecord(data.days) ? (data.days as AppData['days']) : {},
    weights: arr(data.weights),
    measures: arr(data.measures),
    foods: arr(data.foods),
    settings: settings
      ? ({ ...settings, stepsGoal: stepsGoalOf(settings.stepsGoal) } as Settings)
      : defaultSettings(),
    exercises: arr(data.exercises),
    workouts: arr(data.workouts),
    sessions: arr(data.sessions),
    steps: arr(data.steps),
    deletedSessions: arr(data.deletedSessions),
  };
}

export function emptyData(): AppData {
  return {
    days: {},
    weights: [],
    measures: [],
    foods: [],
    settings: defaultSettings(),
    exercises: [],
    workouts: [],
    sessions: [],
    steps: [],
    deletedSessions: [],
  };
}

/** Fills in anything missing from a stored/partial settings object (older data, new fields). */
export function normalizeSettings(input: Partial<Settings> | null | undefined): Settings {
  const d = defaultSettings();
  const s = input ?? {};
  const rem: Partial<Reminders> = s.rem ?? {};
  return {
    ...d,
    ...s,
    rem: {
      workout: { ...d.rem.workout, ...rem.workout },
      weigh: { ...d.rem.weigh, ...rem.weigh },
      measure: { ...d.rem.measure, ...rem.measure },
    },
    customTypes: normalizeTypeNames(s.customTypes ?? d.customTypes),
    // Missing (data saved before meal types existed) → the defaults; an explicit [] stays [].
    mealTypes: Array.isArray(s.mealTypes)
      ? normalizeTypeNames(s.mealTypes.filter((t): t is string => typeof t === 'string'))
      : d.mealTypes,
    macroGoals: macroGoalsOf(s.macroGoals),
    stepsGoal: stepsGoalOf(s.stepsGoal),
  };
}

/** Trimmed, non-empty, de-duplicated (case-insensitive) type names, first spelling wins. */
export function normalizeTypeNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of names) {
    const name = raw.trim();
    const key = name.toLocaleLowerCase('uk');
    if (!name || seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }
  return out;
}
