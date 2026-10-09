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
  iso,
  isValidISODate,
  MONTHS_SHORT,
  ok,
  parse,
  type AppData,
  type ISODate,
} from '@legko/shared';
import {
  calendarMonth,
  dayStatus,
  recentDays,
  shiftMonth,
  type CalendarCell,
  type CalendarMonth,
  type DayStatus,
} from '@/lib/stats';

/** How many «Останні записи» rows are shown at first and added by «Показати ще». */
export const HISTORY_PAGE = 8;

const EMPTY = '—';

// ---------------------------------------------------------------------------
// Selection (URL `?date=`)
// ---------------------------------------------------------------------------

/** `?date=` value → selected day. Missing, malformed or future dates fall back to today. */
export function resolveSelected(param: string | null | undefined, today: ISODate): ISODate {
  if (!param || !isValidISODate(param) || param > today) return today;
  return param;
}

const monthKeyOf = (year: number, month0: number): string => `${year}-${String(month0 + 1).padStart(2, '0')}`;

/**
 * Selection after moving the calendar by `delta` months: the same day of the month, clamped to
 * the target month's length («31 березня» → «30 квітня») and to today. `null` when the target
 * month lies in the future.
 */
export function stepMonth(selected: ISODate, delta: number, today: ISODate): ISODate | null {
  const d = parse(selected);
  const target = shiftMonth(d.getFullYear(), d.getMonth(), delta);
  if (monthKeyOf(target.year, target.month0) > today.slice(0, 7)) return null;
  const daysInMonth = new Date(target.year, target.month0 + 1, 0).getDate();
  const next = iso(new Date(target.year, target.month0, Math.min(d.getDate(), daysInMonth)));
  return next > today ? today : next;
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

/** Cell background in the «Заливка» marks mode; `selected` wins, then `trained`, then `food`. */
export type CellFill = 'selected' | 'trained' | 'food' | 'none';

export interface MonthCell extends CalendarCell {
  fill: CellFill;
  /** Screen-reader name: «9 жовтня, сьогодні, тренування, харчування». */
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
  if (c.food) parts.push('харчування');
  if (c.weighOrMeasure) parts.push('вага або заміри');
  return parts.join(', ');
}

/** The month that contains `selected`, with fill kinds and accessible names per cell. */
export function buildMonth(data: AppData, selected: ISODate, today: ISODate): MonthModel {
  const d = parse(selected);
  const month = calendarMonth(data, d.getFullYear(), d.getMonth(), today, selected);
  return {
    ...month,
    key: monthKeyOf(month.year, month.month0),
    cells: month.cells.map((c) => (c ? { ...c, fill: cellFill(c), label: cellLabel(c) } : null)),
  };
}

// ---------------------------------------------------------------------------
// Selected day card
// ---------------------------------------------------------------------------

export type StatusTone = 'acc2' | 'acc' | 'neutral';

const STATUS_TONE: Readonly<Record<DayStatus, StatusTone>> = {
  full: 'acc2',
  partial: 'acc',
  empty: 'neutral',
};

export interface DetailRowModel {
  key: 'food' | 'kcal' | 'training' | 'weight' | 'measures' | 'notes';
  label: string;
  /** Formatted value, «—» when there is nothing. */
  value: string;
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
  rows: DetailRowModel[];
  /** Food photo ids of the day (thumbnails under «Харчування»). */
  photos: string[];
  /** «Редагувати день» when the day has a record, else «Заповнити день». */
  actionLabel: string;
}

export function buildDayDetail(data: AppData, date: ISODate, today: ISODate): DayDetail {
  const e = data.days[date];
  const w = data.weights.find((x) => x.date === date);
  const m = data.measures.find((x) => x.date === date);
  const { status, label } = dayStatus(data, date);

  let training = EMPTY;
  if (e?.trained === true) training = `✓ ${e.types.join(', ') || 'Було'}`;
  else if (e?.trained === false) training = 'Не було';

  const rows: DetailRowModel[] = [
    { key: 'food', label: 'Харчування', value: e?.food.trim() || EMPTY },
    { key: 'kcal', label: 'Калорії', value: e && ok(e.kcal) ? `${f0(e.kcal)} ккал` : EMPTY },
    { key: 'training', label: 'Тренування', value: training },
    { key: 'weight', label: 'Вага', value: w && ok(w.kg) ? `${f1(w.kg)} кг` : EMPTY },
    {
      key: 'measures',
      label: 'Заміри',
      value: m ? `Груди ${fN(m.chest)} · Талія ${fN(m.waist)} · Стегна ${fN(m.hips)}` : EMPTY,
    },
    { key: 'notes', label: 'Нотатки', value: e?.notes.trim() || EMPTY },
  ];

  return {
    date,
    title: dLongYear(date),
    weekday: `${DOW_LONG[parse(date).getDay()] ?? ''}${date === today ? ' · сьогодні' : ''}`,
    status,
    statusLabel: label,
    statusTone: STATUS_TONE[status],
    rows,
    photos: e?.photos ?? [],
    actionLabel: e ? 'Редагувати день' : 'Заповнити день',
  };
}

// ---------------------------------------------------------------------------
// «Останні записи»
// ---------------------------------------------------------------------------

export interface HistoryRow {
  date: ISODate;
  /** Day of month for the badge. */
  day: number;
  /** Short month for the badge: «жов». */
  month: string;
  /** «1 650 ккал» or «Калорії не вказані». */
  kcal: string;
  /** Food text or «Харчування не записане». */
  food: string;
  /** Workout pill: the first type / «Тренування», «Відпочинок», or «—». */
  training: string;
  trainingTone: 'acc' | 'neutral';
  /** Screen-reader name of the row button. */
  label: string;
}

export interface HistoryModel {
  rows: HistoryRow[];
  /** More day records exist than are shown («Показати ще»). */
  hasMore: boolean;
}

export function buildHistory(data: AppData, limit: number): HistoryModel {
  const rows = recentDays(data, limit).map(({ date, entry: e }): HistoryRow => {
    const d = parse(date);
    const training = e.trained === true ? e.types[0] || 'Тренування' : e.trained === false ? 'Відпочинок' : EMPTY;
    const kcal = ok(e.kcal) ? `${f0(e.kcal)} ккал` : 'Калорії не вказані';
    const food = e.food.trim() || 'Харчування не записане';
    return {
      date,
      day: d.getDate(),
      month: MONTHS_SHORT[d.getMonth()] ?? '',
      kcal,
      food,
      training,
      trainingTone: e.trained === true ? 'acc' : 'neutral',
      label: [dLong(date), kcal, food, training === EMPTY ? 'тренування не відмічене' : training].join(', '),
    };
  });
  return { rows, hasMore: Object.keys(data.days).length > rows.length };
}
