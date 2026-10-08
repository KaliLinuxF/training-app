/** Calendar date in the user's local time, `YYYY-MM-DD`. */
export type ISODate = string;

/** Day of week as in `Date#getDay()`: 0 = Sunday … 6 = Saturday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** Wall-clock time `HH:MM`, 24h. */
export type HM = string;

/** Everything the user wrote down for one calendar day. */
export interface DayEntry {
  /** Free text: what she ate. */
  food: string;
  /** Calories for the whole day. */
  kcal: number | null;
  /** `null` = not marked yet, `true` = there was a workout, `false` = no workout. */
  trained: boolean | null;
  /** Workout types, only meaningful when `trained === true`. */
  types: string[];
  notes: string;
  /** Food photo ids (photo diary), oldest first. Omitted when there are none. */
  photos?: string[];
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
}

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
