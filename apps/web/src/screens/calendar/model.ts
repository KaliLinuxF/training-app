/**
 * View model of the «Календар» screen: pure functions over `AppData` (unit-tested in
 * `model.test.ts`). The screen only renders what these return.
 */
import {
  bodyWeightOn,
  dayBurned,
  doneSessionsOn,
  DOW_LONG,
  dLong,
  dLongYear,
  f0,
  f1,
  fN,
  isValidISODate,
  mealContent,
  ok,
  parse,
  stepsKcal,
  type AppData,
  type DayEntry,
  type ISODate,
  type Meal,
  type MeasureValues,
} from '@legko/shared';
import { dayNutrition, macroLine, mealCountText, mealTitle, NBSP } from '@/lib/nutrition';
import {
  calendarMonth,
  dayStatus,
  shiftMonth,
  stepsOn,
  type CalendarCell,
  type CalendarMonth,
  type DayStatus,
} from '@/lib/stats';
import { sessionLine } from '@/sheets/record/workoutSheetModel';
import type { SheetMode } from '@/store/ui';

// ---------------------------------------------------------------------------
// Selection (URL `?date=`)
// ---------------------------------------------------------------------------

/** `?date=` value → selected day. Missing, malformed or future dates fall back to today. */
export function resolveSelected(param: string | null | undefined, today: ISODate): ISODate {
  if (!param || !isValidISODate(param) || param > today) return today;
  return param;
}

// ---------------------------------------------------------------------------
// Shown month (separate from the selection, as in the prototype's `calY` / `calM`)
// ---------------------------------------------------------------------------

/** A calendar month, `YYYY-MM`. */
export type MonthKey = string;

const monthKeyOf = (year: number, month0: number): MonthKey =>
  `${year}-${String(month0 + 1).padStart(2, '0')}`;

/** The month that contains `date`. */
export const monthOf = (date: ISODate): MonthKey => date.slice(0, 7);

/**
 * The header «Сьогодні» shortcut is shown once she has left today: another day is selected, or ‹ › / a swipe moved
 * the grid away from today's month.
 */
export function showTodayShortcut(selected: ISODate, shown: MonthKey, today: ISODate): boolean {
  return selected !== today || shown !== monthOf(today);
}

function parseMonthKey(key: MonthKey): { year: number; month0: number } {
  return { year: Number(key.slice(0, 4)), month0: Number(key.slice(5, 7)) - 1 };
}

/**
 * The shown month after ‹ / › or a swipe: `delta` months from `shown`, or `null` when that month
 * lies after today's. Only the view moves — the selected day and its card stay put.
 */
export function stepMonth(shown: MonthKey, delta: number, today: ISODate): MonthKey | null {
  const { year, month0 } = parseMonthKey(shown);
  const target = shiftMonth(year, month0, delta);
  const next = monthKeyOf(target.year, target.month0);
  return next > monthOf(today) ? null : next;
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

/** Cell background in the «Заливка» marks mode; `selected` wins, then `trained`, then `food`. */
export type CellFill = 'selected' | 'trained' | 'food' | 'none';

export interface MonthCell extends CalendarCell {
  fill: CellFill;
  /** Screen-reader name: «9 жовтня, сьогодні, тренування, їжа». */
  label: string;
}

export interface MonthModel extends Omit<CalendarMonth, 'cells'> {
  /** `YYYY-MM`, changes with the shown month (used to restart the slide animation). */
  key: string;
  cells: (MonthCell | null)[];
}

export function cellFill(c: CalendarCell): CellFill {
  if (c.isSelected) return 'selected';
  if (c.trained) return 'trained';
  if (c.food) return 'food';
  return 'none';
}

function cellLabel(c: CalendarCell): string {
  const parts = [dLong(c.date)];
  if (c.isToday) parts.push('сьогодні');
  if (c.trained) parts.push('тренування');
  if (c.food) parts.push('їжа');
  if (c.weighOrMeasure) parts.push('вага або заміри');
  return parts.join(', ');
}

/**
 * The `shown` month with fill kinds and accessible names per cell. `selected` is highlighted only
 * when it falls in that month.
 */
export function buildMonth(data: AppData, shown: MonthKey, selected: ISODate, today: ISODate): MonthModel {
  const { year, month0 } = parseMonthKey(shown);
  const month = calendarMonth(data, year, month0, today, selected);
  return {
    ...month,
    key: monthKeyOf(month.year, month.month0),
    cells: month.cells.map((c) => (c ? { ...c, fill: cellFill(c), label: cellLabel(c) } : null)),
  };
}

// ---------------------------------------------------------------------------
// Selected day card: a check-list of rows that open the focused sheets
// ---------------------------------------------------------------------------

export type StatusTone = 'acc2' | 'acc' | 'neutral';

const STATUS_TONE: Readonly<Record<DayStatus, StatusTone>> = {
  full: 'acc2',
  partial: 'acc',
  empty: 'neutral',
};

export type DayRowKey = 'food' | 'training' | 'steps' | 'weight' | 'measures' | 'notes';

/**
 * The sheet each row opens for the selected date (the notes row opens the full «Запис дня»). An empty Їжа row
 * («Додати») opens the new-meal editor `'meal'` instead of the day's meal list (meals doc D8).
 */
export const ROW_SHEET: Readonly<Record<DayRowKey, SheetMode>> = {
  food: 'food',
  training: 'workout',
  steps: 'steps',
  weight: 'weight',
  measures: 'measure',
  notes: 'day',
};

/** One row of the day check-list. */
export interface DayRowModel {
  key: DayRowKey;
  /** «Їжа», «Тренування», «Вага», «Заміри», «Нотатки». */
  title: string;
  /** Something is recorded for the row (Тренування: marked either way). */
  filled: boolean;
  /** Right-hand value: «1 880 ккал», «65,4 кг». */
  value?: string;
  /** `acc` when the day's kcal is over the goal. */
  valueTone: 'ink' | 'acc';
  /**
   * Second line, shown in full: food text, workout types / «Не було» / «Ще не відмічено», measurements, notes. On a
   * day with meals it is `lines` joined by «\n» (the row's description).
   */
  text?: string;
  /**
   * Їжа on a day with meals: one line per meal («Сніданок · 520 ккал · Тост з авокадо»), then the day's
   * «Б · Ж · В» line when some macronutrient is known. Each is shown on one line, cut with an ellipsis.
   */
  lines?: string[];
  /** Shown instead of a value on an empty Їжа / Вага / Заміри row (never «—»). */
  action?: 'Додати';
  /** Тренування only: the day's mark for the inline ✓ / ✕ (`null` = not marked). */
  trained?: boolean | null;
  /** Тренування only: the day has a done session, so the ✓ / ✕ is the static «Було» mark (W5). */
  recorded?: boolean;
  /** The sheet the row opens (`ROW_SHEET`; an empty Їжа row opens the new-meal editor `'meal'`). */
  mode: SheetMode;
  /** Short accessible name of the row button: «Їжа: 1 880 ккал», «Їжа: 1 740 ккал, 3 прийоми», «Вага: додати». */
  label: string;
  /** The text is long (food, notes): it becomes the row button's accessible description. */
  describe: boolean;
}

export interface DayDetail {
  date: ISODate;
  /** «10 жовтня 2026» */
  title: string;
  /** «субота · сьогодні» */
  weekday: string;
  status: DayStatus;
  statusLabel: string;
  statusTone: StatusTone;
  /** Їжа, Тренування, Кроки, Вага, Заміри — plus Нотатки when the day has notes. */
  rows: DayRowModel[];
  /** Food photo ids of the day (thumbnails under the Їжа row; on a meal day the union derived from its meals). */
  photos: string[];
  /** «Редагувати день» when the day has a record, else «Заповнити день». */
  actionLabel: string;
}

const ADD = 'Додати';

const MEASURE_NAMES: readonly (readonly [keyof MeasureValues, string])[] = [
  ['chest', 'Груди'],
  ['waist', 'Талія'],
  ['hips', 'Стегна'],
];

/**
 * One meal on one line: «Сніданок · 520 ккал · Тост з авокадо» (a NO-BREAK SPACE in «520 ккал»); « · … ккал» is
 * left out without kcal, « · content» without content (meals doc §7.8).
 */
function mealLine(meal: Meal): string {
  const parts = [mealTitle(meal)];
  if (ok(meal.kcal)) parts.push(`${f0(meal.kcal)}${NBSP}ккал`);
  const content = mealContent(meal);
  if (content) parts.push(content);
  return parts.join(' · ');
}

/**
 * Їжа: the day's kcal against `goal`. A day logged before meals existed (legacy) shows its food text as it always
 * did; a day with meals lists one line per meal plus the «Б · Ж · В» line. Empty → «Додати», which opens the
 * new-meal editor; otherwise the row opens the day's meal list «Їжа».
 */
function foodRow(e: DayEntry | undefined, goal: number): DayRowModel {
  const n = dayNutrition(e);
  const filled = n.count > 0;
  const over = n.kcal !== null && n.kcal > goal;
  const value = n.kcal !== null ? `${f0(n.kcal)} ккал` : undefined;

  let text: string | undefined;
  let lines: string[] | undefined;
  if (n.legacy) {
    text = e?.food.trim() || undefined;
  } else if (filled) {
    lines = n.meals.map(mealLine);
    const macros = macroLine(n.macros);
    if (macros) lines.push(macros);
    text = lines.join('\n');
  }

  let label = 'Їжа: додати';
  if (filled) {
    const parts = [value ?? 'калорії не вказані'];
    if (!n.legacy) parts.push(mealCountText(n.count));
    if (over) parts.push('більше цілі');
    label = `Їжа: ${parts.join(', ')}`;
  }

  const row: DayRowModel = {
    key: 'food',
    title: 'Їжа',
    filled,
    value,
    valueTone: over ? 'acc' : 'ink',
    text,
    action: filled ? undefined : ADD,
    mode: filled ? ROW_SHEET.food : 'meal',
    label,
    describe: text !== undefined,
  };
  if (lines) row.lines = lines;
  return row;
}

/** The steps of the day: «8 400» with «з 10 000 · ≈ 280 ккал» (the goal part only with a goal), or «Додати». */
function stepsRow(data: AppData, date: ISODate): DayRowModel {
  const steps = stepsOn(data, date);
  if (steps === null) {
    return {
      key: 'steps',
      title: 'Кроки',
      filled: false,
      valueTone: 'ink',
      action: ADD,
      mode: ROW_SHEET.steps,
      label: 'Кроки: додати',
      describe: false,
    };
  }
  const kcal = f0(stepsKcal(steps, bodyWeightOn(data.weights, date)));
  const goal = data.settings.stepsGoal ?? null;
  const parts = goal !== null ? [`з ${f0(goal)}`, `≈${NBSP}${kcal}${NBSP}ккал`] : [`≈${NBSP}${kcal}${NBSP}ккал`];
  return {
    key: 'steps',
    title: 'Кроки',
    filled: true,
    value: f0(steps),
    valueTone: 'ink',
    text: parts.join(' · '),
    mode: ROW_SHEET.steps,
    label: `Кроки: ${f0(steps)}, спалено близько ${kcal} ккал`.replace(/\s/g, ' '),
    describe: false,
  };
}

/**
 * Тренування on a day with done sessions: one line per session («Ноги + прес · 48 хв · 310 ккал»), the types line,
 * and «Разом спалено ≈ 590 ккал» (`dayBurned.total`: a logged walk is not counted twice) when the day also has steps.
 */
function sessionsTrainingRow(data: AppData, date: ISODate, types: readonly string[]): DayRowModel | null {
  const sessions = doneSessionsOn(data, date);
  if (!sessions.length) return null;
  const lines = sessions.map((x) => sessionLine(data, x));
  if (types.length) lines.push(types.join(', '));
  const burned = stepsOn(data, date) !== null ? dayBurned(data, date) : null;
  if (burned) lines.push(`Разом спалено ≈${NBSP}${f0(burned.total)}${NBSP}ккал`);
  return {
    key: 'training',
    title: 'Тренування',
    filled: true,
    valueTone: 'ink',
    text: lines.join('\n'),
    lines,
    trained: true,
    recorded: true,
    mode: ROW_SHEET.training,
    label: `Тренування: було, ${sessions.map((x) => x.name).join(', ')}`,
    describe: true,
  };
}

function trainingRow(trained: boolean | null, types: readonly string[]): DayRowModel {
  let text = 'Ще не відмічено';
  let label = 'Тренування: не відмічено';
  if (trained === true) {
    text = types.length ? types.join(', ') : 'Було';
    label = types.length ? `Тренування: було, ${types.join(', ')}` : 'Тренування: було';
  } else if (trained === false) {
    text = 'Не було';
    label = 'Тренування: не було';
  }
  // No action word: the inline ✓ / ✕ next to the row marks the day.
  return {
    key: 'training',
    title: 'Тренування',
    filled: trained !== null,
    valueTone: 'ink',
    text,
    trained,
    mode: ROW_SHEET.training,
    label,
    describe: false,
  };
}

function weightRow(kg: number | null): DayRowModel {
  const value = kg !== null ? `${f1(kg)} кг` : undefined;
  return {
    key: 'weight',
    title: 'Вага',
    filled: value !== undefined,
    value,
    valueTone: 'ink',
    action: value ? undefined : ADD,
    mode: ROW_SHEET.weight,
    label: value ? `Вага: ${value}` : 'Вага: додати',
    describe: false,
  };
}

function measuresRow(m: MeasureValues | undefined): DayRowModel {
  const parts = MEASURE_NAMES.flatMap(([key, name]) => {
    const v = m?.[key];
    return ok(v) ? [{ name, value: fN(v) }] : [];
  });
  const filled = parts.length > 0;
  return {
    key: 'measures',
    title: 'Заміри',
    filled,
    valueTone: 'ink',
    text: filled ? parts.map((p) => `${p.name} ${p.value}`).join(' · ') : undefined,
    action: filled ? undefined : ADD,
    mode: ROW_SHEET.measures,
    label: filled
      ? `Заміри: ${parts.map((p) => `${p.name.toLowerCase()} ${p.value}`).join(', ')}`
      : 'Заміри: додати',
    describe: false,
  };
}

function notesRow(notes: string): DayRowModel {
  return {
    key: 'notes',
    title: 'Нотатки',
    filled: true,
    valueTone: 'ink',
    text: notes,
    mode: ROW_SHEET.notes,
    label: 'Нотатки',
    describe: true,
  };
}

/**
 * The selected day as a check-list: Їжа (one line per meal — or a legacy day's text —, kcal against
 * `settings.kcalGoal`, photos), Тренування (the mark and its types, or one line per done session), Кроки, Вага,
 * Заміри, and Нотатки only when there are notes. Empty Їжа / Кроки / Вага / Заміри rows offer «Додати». The day's
 * status (`dayStatus`: food, kcal and the mark) never looks at steps or sessions.
 */
export function buildDayDetail(data: AppData, date: ISODate, today: ISODate): DayDetail {
  const e = data.days[date];
  const w = data.weights.find((x) => x.date === date);
  const m = data.measures.find((x) => x.date === date);
  const { status, label } = dayStatus(data, date);
  const photos = e?.photos ?? [];
  const notes = e?.notes.trim() ?? '';

  const types = e?.trained === true ? e.types : [];
  const rows: DayRowModel[] = [
    foodRow(e, data.settings.kcalGoal),
    sessionsTrainingRow(data, date, types) ?? trainingRow(e?.trained ?? null, types),
    stepsRow(data, date),
    weightRow(w && ok(w.kg) ? w.kg : null),
    measuresRow(m),
  ];
  if (notes) rows.push(notesRow(notes));

  return {
    date,
    title: dLongYear(date),
    weekday: `${DOW_LONG[parse(date).getDay()] ?? ''}${date === today ? ' · сьогодні' : ''}`,
    status,
    statusLabel: label,
    statusTone: STATUS_TONE[status],
    rows,
    photos,
    actionLabel: e ? 'Редагувати день' : 'Заповнити день',
  };
}
