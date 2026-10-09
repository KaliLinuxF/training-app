/**
 * View model of the «Календар» screen: pure functions over `AppData` (unit-tested in
 * `model.test.ts`). The screen only renders what these return.
 */
import {
  DOW_LONG,
  dLong,
  dLongYear,
  f0,
  f1,
  fN,
  isValidISODate,
  ok,
  parse,
  type AppData,
  type ISODate,
  type MeasureValues,
} from '@legko/shared';
import {
  calendarMonth,
  dayStatus,
  shiftMonth,
  type CalendarCell,
  type CalendarMonth,
  type DayStatus,
} from '@/lib/stats';
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

export type DayRowKey = 'food' | 'training' | 'weight' | 'measures' | 'notes';

/** The sheet each row opens for the selected date (the notes row opens the full «Запис дня»). */
export const ROW_SHEET: Readonly<Record<DayRowKey, SheetMode>> = {
  food: 'food',
  training: 'workout',
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
  /** Second line, shown in full: food text, workout types / «Не було» / «Ще не відмічено», measurements, notes. */
  text?: string;
  /** Shown instead of a value on an empty Їжа / Вага / Заміри row (never «—»). */
  action?: 'Додати';
  /** Тренування only: the day's mark for the inline ✓ / ✕ (`null` = not marked). */
  trained?: boolean | null;
  /** The sheet the row opens (`ROW_SHEET`). */
  mode: SheetMode;
  /** Short accessible name of the row button: «Їжа: 1 880 ккал», «Вага: додати». */
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
  /** Їжа, Тренування, Вага, Заміри — plus Нотатки when the day has notes. */
  rows: DayRowModel[];
  /** Food photo ids of the day (thumbnails under the Їжа row). */
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

function foodRow(food: string, kcal: number | null, photos: number, goal: number): DayRowModel {
  const text = food || undefined;
  const filled = text !== undefined || kcal !== null || photos > 0;
  const over = kcal !== null && kcal > goal;
  const value = kcal !== null ? `${f0(kcal)} ккал` : undefined;
  let label = 'Їжа: додати';
  if (value) label = `Їжа: ${value}${over ? ', більше цілі' : ''}`;
  else if (filled) label = 'Їжа: калорії не вказані';
  return {
    key: 'food',
    title: 'Їжа',
    filled,
    value,
    valueTone: over ? 'acc' : 'ink',
    text,
    action: filled ? undefined : ADD,
    mode: ROW_SHEET.food,
    label,
    describe: text !== undefined,
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
 * The selected day as a check-list: Їжа (text, kcal against `settings.kcalGoal`, photos), Тренування (the mark and
 * its types), Вага, Заміри, and Нотатки only when there are notes. Empty Їжа / Вага / Заміри rows offer «Додати».
 */
export function buildDayDetail(data: AppData, date: ISODate, today: ISODate): DayDetail {
  const e = data.days[date];
  const w = data.weights.find((x) => x.date === date);
  const m = data.measures.find((x) => x.date === date);
  const { status, label } = dayStatus(data, date);
  const photos = e?.photos ?? [];
  const notes = e?.notes.trim() ?? '';

  const rows: DayRowModel[] = [
    foodRow(e?.food.trim() ?? '', e && ok(e.kcal) ? e.kcal : null, photos.length, data.settings.kcalGoal),
    trainingRow(e?.trained ?? null, e?.trained === true ? e.types : []),
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
