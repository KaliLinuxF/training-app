/** Calendar date in the user's local time, `YYYY-MM-DD`. */
export type ISODate = string;

/** Day of week as in `Date#getDay()`: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Wall-clock time `HH:MM`, 24h. */
export type HM = string;

export type MacroKey = 'protein' | 'fat' | 'carbs';

/** Grams of protein / fat / carbohydrate; `null` = unknown. Multiples of 0.5. */
export interface MacroGrams {
  protein: number | null;
  fat: number | null;
  carbs: number | null;
}

/** Daily goals in whole grams; `null` = no goal for that macronutrient. */
export type MacroGoals = MacroGrams;

/** One position of a meal: an AI-estimate row, a «Часті страви» dish, or one she typed. */
export interface MealItem extends MacroGrams {
  name: string;
  portion: string;
  kcal: number;
}

/** One meal of a day («Сніданок · 08:30 · тост з тунцем»). */
export interface Meal extends MacroGrams {
  /** Client-generated, unique within the day (`LEGACY_MEAL_ID` for a converted legacy day). */
  id: string;
  /** Type label as chosen when it was saved; '' = no type («Їжа за день» / «Прийом їжі»). */
  type: string;
  /** Local wall-clock time `HH:MM`, or null (past days, or she removed it). */
  time: HM | null;
  /** What she ate, as she wrote it (may be empty when there are positions or a photo). */
  text: string;
  /** With `items`: their sum (recomputed by `normalizeMeal`); otherwise typed by her or null. */
  kcal: number | null;
  /** Food photo ids, oldest first; omitted when none. */
  photos?: string[];
  /** AI / dish / manual positions; omitted when none. With positions, kcal and macros are their sums. */
  items?: MealItem[];
}

/** Everything the user wrote down for one calendar day. */
export interface DayEntry {
  /** Legacy day: what she ate (free text). Day with meals: DERIVED digest (`deriveDayFood`) — never edited directly. */
  food: string;
  /** Legacy day: calories for the whole day. Day with meals: DERIVED sum of meal kcal (null when no meal has kcal). */
  kcal: number | null;
  /** `null` = not marked yet, `true` = there was a workout, `false` = no workout. */
  trained: boolean | null;
  /** Workout types, only meaningful when `trained === true`. */
  types: string[];
  notes: string;
  /**
   * Legacy day: food photo ids (photo diary), oldest first. Day with meals: DERIVED union of the meals' photos
   * (first 12). Omitted when there are none.
   */
  photos?: string[];
  /** Present (non-empty) only on a day with meals; absent = legacy day. */
  meals?: Meal[];
}

/**
 * What `day.meta` writes: any of the workout mark, its types and the notes (never the food).
 * Partial: only the keys present are applied (at least one key; `types` is kept only while trained).
 */
export interface DayMeta {
  trained?: boolean | null;
  types?: string[];
  notes?: string;
}

/** A dish she has logged before — powers the «Часті страви» quick-add chips. */
export interface FoodItem {
  name: string;
  /** Human portion description, e.g. «250 г», «1 шматок». */
  portion: string;
  kcal: number;
  /** How many times it was added. */
  count: number;
  lastUsed: ISODate;
  /** Grams in that portion; omitted when unknown (older dishes, old clients). Never null. */
  protein?: number;
  fat?: number;
  carbs?: number;
}

export interface WeightEntry {
  date: ISODate;
  kg: number;
}

export interface MeasureValues {
  chest: number | null;
  waist: number | null;
  hips: number | null;
}

export type MeasureKey = keyof MeasureValues;

export interface MeasureEntry extends MeasureValues {
  date: ISODate;
}

export interface WorkoutReminder {
  on: boolean;
  days: Weekday[];
  time: HM;
}

export interface WeeklyReminder {
  on: boolean;
  day: Weekday;
  time: HM;
}

export interface Reminders {
  workout: WorkoutReminder;
  weigh: WeeklyReminder;
  measure: WeeklyReminder;
}

export type ReminderKind = keyof Reminders;

export interface Settings {
  /** Target weight, kg. */
  goal: number;
  /** Daily calorie goal, kcal. */
  kcalGoal: number;
  rem: Reminders;
  /** IANA time zone of the user's phone; the server fires reminders in it. */
  timezone: string;
  /** Workout types the user added herself (shown after the built-in ones). */
  customTypes: string[];
  /** `false` until the first-run setup sheet is completed. */
  onboarded: boolean;
  /** Her meal types, in chip order (defaults: `DEFAULT_MEAL_TYPES`); may be empty. */
  mealTypes: string[];
  /** Optional daily goals for protein / fat / carbs, whole grams. */
  macroGoals: MacroGoals;
}

/** `settings.put` value: the new fields are optional — absent means «keep what is stored» (old clients). */
export type SettingsPut = Omit<Settings, 'mealTypes' | 'macroGoals'> &
  Partial<Pick<Settings, 'mealTypes' | 'macroGoals'>>;

export interface AppData {
  days: Record<ISODate, DayEntry>;
  /** Sorted by date ascending, at most one entry per date. */
  weights: WeightEntry[];
  /** Sorted by date ascending, at most one entry per date. */
  measures: MeasureEntry[];
  /** Frequent dishes, at most one per (case-insensitive) name, in no particular order. */
  foods: FoodItem[];
  settings: Settings;
}
