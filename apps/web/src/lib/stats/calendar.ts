import {
  DOW_SHORT,
  iso,
  MONTHS_NOM,
  ok,
  WEEK_ORDER,
  type AppData,
  type DayEntry,
  type ISODate,
} from '@legko/shared';
import { sortedDayKeys, type DatedDay } from './common';

export type DayStatus = 'full' | 'partial' | 'empty';

export const DAY_STATUS_LABELS: Readonly<Record<DayStatus, string>> = {
  full: 'Заповнено',
  partial: 'Частково',
  empty: 'Порожньо',
};

/** Food was recorded: a description or at least one food photo. */
const hasFood = (e: DayEntry): boolean => e.food.trim() !== '' || (e.photos?.length ?? 0) > 0;

/**
 * Calendar detail pill: «Заповнено» when food, kcal and the workout mark (yes or no) are all
 * present; «Частково» when the day has any record; else «Порожньо».
 */
export function dayStatus(data: AppData, date: ISODate): { status: DayStatus; label: string } {
  const status = statusOf(data.days[date]);
  return { status, label: DAY_STATUS_LABELS[status] };
}

function statusOf(e: DayEntry | undefined): DayStatus {
  if (!e) return 'empty';
  return hasFood(e) && ok(e.kcal) && e.trained !== null ? 'full' : 'partial';
}

/** A weigh-in exists for `date`. */
export const weighedOn = (data: AppData, date: ISODate): boolean => data.weights.some((w) => w.date === date);

/** A measurement entry exists for `date`. */
export const measuredOn = (data: AppData, date: ISODate): boolean =>
  data.measures.some((m) => m.date === date);

export interface CalendarCell {
  date: ISODate;
  /** Day of month, 1–31. */
  day: number;
  /** The day has any record (food, kcal, workout mark or notes). */
  hasEntry: boolean;
  /** Food text or kcal recorded (fill mode: `--acc2T`). */
  food: boolean;
  /** `trained === true` (fill mode: `--accT`, wins over food). */
  trained: boolean;
  /** A weigh-in or measurements on that day (the small dot). */
  weighOrMeasure: boolean;
  isToday: boolean;
  /** After today — not selectable, faint. */
  isFuture: boolean;
  isSelected: boolean;
}

export interface CalendarMonth {
  year: number;
  /** 0 = January. */
  month0: number;
  /** «Жовтень 2026» */
  title: string;
  /** Monday-first headers: ['Пн', …, 'Нд']. */
  weekdays: string[];
  /** Leading `null`s pad the first week to Monday; then one cell per day. No trailing padding. */
  cells: (CalendarCell | null)[];
  /** The month containing today. */
  isCurrentMonth: boolean;
  /** Months after today's month are not browsable. */
  canGoNext: boolean;
}

/** Normalises an out-of-range month (e.g. −1 or 12) and moves by `delta` months. */
export function shiftMonth(year: number, month0: number, delta = 0): { year: number; month0: number } {
  const d = new Date(year, month0 + delta, 1);
  return { year: d.getFullYear(), month0: d.getMonth() };
}

/** Month grid of the calendar screen (Monday-first). */
export function calendarMonth(
  data: AppData,
  year: number,
  month0: number,
  today: ISODate,
  selected: ISODate,
): CalendarMonth {
  const m = shiftMonth(year, month0);
  const lead = (new Date(m.year, m.month0, 1).getDay() + 6) % 7;
  const daysInMonth = new Date(m.year, m.month0 + 1, 0).getDate();
  const marked = new Set([...data.weights.map((w) => w.date), ...data.measures.map((x) => x.date)]);

  const cells: (CalendarCell | null)[] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day++) {
    const date = iso(new Date(m.year, m.month0, day));
    const e = data.days[date];
    cells.push({
      date,
      day,
      hasEntry: e !== undefined,
      food: !!e && (hasFood(e) || ok(e.kcal)),
      trained: e?.trained === true,
      weighOrMeasure: marked.has(date),
      isToday: date === today,
      isFuture: date > today,
      isSelected: date === selected,
    });
  }

  const monthKey = `${m.year}-${String(m.month0 + 1).padStart(2, '0')}`;
  const todayKey = today.slice(0, 7);
  return {
    year: m.year,
    month0: m.month0,
    title: `${MONTHS_NOM[m.month0] ?? ''} ${m.year}`,
    weekdays: WEEK_ORDER.map((n) => DOW_SHORT[n]),
    cells,
    isCurrentMonth: monthKey === todayKey,
    canGoNext: monthKey < todayKey,
  };
}

/** «Останні записи»: the newest day records first. */
export function recentDays(data: AppData, limit = 8): DatedDay[] {
  const out: DatedDay[] = [];
  for (const date of sortedDayKeys(data).reverse()) {
    if (out.length >= limit) break;
    const entry = data.days[date];
    if (entry) out.push({ date, entry });
  }
  return out;
}
