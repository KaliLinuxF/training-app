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
  /** Optional daily steps goal (whole 1 000–50 000); null = none. */
  stepsGoal: number | null;
}

/** `settings.put` value: the new fields are optional — absent means «keep what is stored» (old clients). */
export type SettingsPut = Omit<Settings, 'mealTypes' | 'macroGoals' | 'stepsGoal'> &
  Partial<Pick<Settings, 'mealTypes' | 'macroGoals' | 'stepsGoal'>>;

// ---- workouts and steps (docs/workouts-steps-rebrand.md §1.1) -----------------------------------

export type ExerciseKind = 'weight' | 'bodyweight' | 'time' | 'cardio';

export type MuscleId =
  | 'chest'
  | 'shoulders'
  | 'biceps'
  | 'triceps'
  | 'forearms'
  | 'abs'
  | 'obliques'
  | 'traps'
  | 'lats'
  | 'lowerBack'
  | 'glutes'
  | 'quads'
  | 'hamstrings'
  | 'adductors'
  | 'calves';

export type Equipment =
  | 'barbell'
  | 'dumbbell'
  | 'kettlebell'
  | 'machine'
  | 'cable'
  | 'band'
  | 'bodyweight'
  | 'cardio'
  | 'other';

/** A library (seed, id `lib.*`) or her own exercise (12+ char random id). */
export interface Exercise {
  id: string;
  /** 1–60, Ukrainian. */
  name: string;
  kind: ExerciseKind;
  /** 0–6, unique. */
  primary: MuscleId[];
  /** 0–8, unique, disjoint from primary. */
  secondary: MuscleId[];
  equipment: Equipment;
  /** 1–25, one decimal. */
  met: number;
}

/** One planned / logged set. Only the fields of the exercise's kind are meaningful, the others are null. */
export interface SetValues {
  /** weight, bodyweight: whole 0–1000. */
  reps: number | null;
  /** weight: 0–1000, multiple of 0.25. */
  kg: number | null;
  /** time: whole 0–36000. */
  sec: number | null;
  /** cardio: 0–1440, multiple of 0.5. */
  min: number | null;
  /** cardio (optional): 0–500, multiple of 0.01. */
  km: number | null;
}

export interface SessionSet extends SetValues {
  done: boolean;
}

export interface WorkoutItem {
  /** Unique within the workout (4–40 base64url chars): duplicates of one exercise are allowed. */
  key: string;
  /** lib.* or her own id; a missing own exercise is skipped. */
  exerciseId: string;
  /** 1–20. */
  sets: SetValues[];
  /** 0–900, whole. */
  restSec: number;
}

export interface Workout {
  /** 12+ random base64url. */
  id: string;
  /** 1–40. */
  name: string;
  /** Unique, stored in WEEK_ORDER (Mon…Sun). */
  days: Weekday[];
  /** 0–30 (the builder requires ≥ 1 to save; an op with 0 is valid). */
  items: WorkoutItem[];
}

export interface SessionExercise {
  /** Unique within the session. */
  key: string;
  exerciseId: string;
  // snapshot (W3)
  name: string;
  kind: ExerciseKind;
  met: number;
  equipment: Equipment;
  primary: MuscleId[];
  secondary: MuscleId[];
  restSec: number;
  skipped: boolean;
  /** 0–30. */
  sets: SessionSet[];
}

export type SessionStatus = 'active' | 'done';

export interface WorkoutSession {
  /** 12+ random base64url. */
  id: string;
  date: ISODate;
  /** The template it came from (null: «Вільне тренування»). */
  workoutId: string | null;
  /** 1–40 snapshot. */
  name: string;
  /** Epoch ms — ordering key. */
  createdAt: number;
  /** Epoch ms of a live start; null for a past-day log. */
  startedAt: number | null;
  /** Epoch ms (live finish); null while active / past-day log. */
  finishedAt: number | null;
  /** 0–86400; null = unknown. */
  durationSec: number | null;
  status: SessionStatus;
  /** 0–30. */
  exercises: SessionExercise[];
  /** ≤ 1000. */
  notes: string;
  /** Whole 0–1e9; every client write sends stored.rev + 1 (W13); absent in input → 0. */
  rev: number;
  /** The device that writes a live session (W4); null for past/done. */
  deviceId: string | null;
}

/** Steps of one date (whole 1–100 000). */
export interface StepsEntry {
  date: ISODate;
  steps: number;
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
  /** Her own exercises only (the seed library is code), creation order. */
  exercises: Exercise[];
  /** Her workouts, creation order. */
  workouts: Workout[];
  /** Sorted by (date, createdAt, id) — `compareSessions`. */
  sessions: WorkoutSession[];
  /** Sorted by date, one per date. */
  steps: StepsEntry[];
  /** Tombstones of deleted session ids (W13), unique, at most 10 000. */
  deletedSessions: string[];
}
