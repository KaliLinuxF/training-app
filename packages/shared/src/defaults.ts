import type { AppData, Reminders, Settings } from './types';

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
  };
}

export function emptyData(): AppData {
  return { days: {}, weights: [], measures: [], foods: [], settings: defaultSettings() };
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
