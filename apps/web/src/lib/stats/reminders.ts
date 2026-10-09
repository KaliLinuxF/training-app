import {
  addDays,
  dLong,
  DOW_SHORT,
  weekdayOf,
  type AppData,
  type HM,
  type ISODate,
  type ReminderKind,
  type WeeklyReminder,
} from '@legko/shared';
import { measuredOn, weighedOn } from './calendar';

export interface NextReminder {
  /** Date of the next occurrence; `null` when the reminder is off. */
  date: ISODate | null;
  /** «Сьогодні» | «Завтра» | «Пн, 12 жовтня» | «вимкнено». */
  label: string;
  /** Reminder time, `null` when off. */
  time: HM | null;
  /** Ready-to-show line: «Сьогодні · 08:00», «Пн, 12 жовтня · 08:00» or «вимкнено». */
  text: string;
}

export const REMINDER_OFF_LABEL = 'вимкнено';

/**
 * Next date with the reminder's weekday, starting today; today is skipped when the action
 * is already done (`doneToday`), so the answer then is a week later.
 */
export function nextReminderLabel(
  reminder: WeeklyReminder,
  doneToday: boolean,
  today: ISODate,
): NextReminder {
  if (!reminder.on) return { date: null, label: REMINDER_OFF_LABEL, time: null, text: REMINDER_OFF_LABEL };
  for (let i = 0; i < 8; i++) {
    const date = addDays(today, i);
    if (weekdayOf(date) !== reminder.day || (i === 0 && doneToday)) continue;
    const label = i === 0 ? 'Сьогодні' : i === 1 ? 'Завтра' : `${DOW_SHORT[reminder.day]}, ${dLong(date)}`;
    return { date, label, time: reminder.time, text: `${label} · ${reminder.time}` };
  }
  // Unreachable for a valid weekday (8 consecutive days always contain it twice).
  return { date: null, label: '—', time: reminder.time, text: `— · ${reminder.time}` };
}

/** «Наступне зважування» on Home. */
export const nextWeighIn = (data: AppData, today: ISODate): NextReminder =>
  nextReminderLabel(data.settings.rem.weigh, weighedOn(data, today), today);

/** «Наступні заміри» on Home. */
export const nextMeasurements = (data: AppData, today: ISODate): NextReminder =>
  nextReminderLabel(data.settings.rem.measure, measuredOn(data, today), today);

/**
 * Where a weekly check (weigh-in / measurements) stands today:
 * - `done`     — recorded today (wins over everything, even a reminder that is off);
 * - `off`      — the reminder is switched off;
 * - `due`      — today is the reminder's weekday and nothing is recorded yet;
 * - `overdue`  — the scheduled day in the past 6 days was missed (nothing recorded from it up to today)
 *                after an earlier record, so a brand-new user is never nagged;
 * - `upcoming` — anything else.
 */
export type WeeklyCheckState = 'done' | 'due' | 'overdue' | 'upcoming' | 'off';

export interface WeeklyCheck {
  state: WeeklyCheckState;
  /** Next occurrence (`nextReminderLabel` with «done today» = a record exists today). */
  next: NextReminder;
  /** The missed scheduled day when `overdue`, else `null`. */
  missed: ISODate | null;
}

/**
 * Home «Вага» / «Заміри» row state from the reminder and the dates that have a record.
 * Rule order: done → off → due → overdue → upcoming (see `WeeklyCheckState`).
 */
export function weeklyCheck(
  reminder: WeeklyReminder,
  recordDates: readonly ISODate[],
  today: ISODate,
): WeeklyCheck {
  const doneToday = recordDates.includes(today);
  const next = nextReminderLabel(reminder, doneToday, today);
  if (doneToday) return { state: 'done', next, missed: null };
  if (!reminder.on) return { state: 'off', next, missed: null };
  if (weekdayOf(today) === reminder.day) return { state: 'due', next, missed: null };
  const missed = lastScheduledBefore(reminder, today);
  if (
    missed !== null &&
    !recordDates.some((d) => d >= missed && d <= today) &&
    recordDates.some((d) => d < missed)
  ) {
    return { state: 'overdue', next, missed };
  }
  return { state: 'upcoming', next, missed: null };
}

/** The latest day in [today − 6, today − 1] that falls on the reminder's weekday (`null` for an invalid weekday). */
function lastScheduledBefore(reminder: WeeklyReminder, today: ISODate): ISODate | null {
  for (let i = 1; i <= 6; i++) {
    const date = addDays(today, -i);
    if (weekdayOf(date) === reminder.day) return date;
  }
  return null;
}

/** Home «Вага» row: the weigh-in reminder against the weigh-in dates. */
export const weighCheck = (data: AppData, today: ISODate): WeeklyCheck =>
  weeklyCheck(
    data.settings.rem.weigh,
    data.weights.map((w) => w.date),
    today,
  );

/** Home «Заміри» row: the measurements reminder against the measurement dates. */
export const measureCheck = (data: AppData, today: ISODate): WeeklyCheck =>
  weeklyCheck(
    data.settings.rem.measure,
    data.measures.map((m) => m.date),
    today,
  );

/**
 * Reminders scheduled for today whose action is not done yet, in order (weigh-in, measurements, workout).
 * Workout counts as done once the day has a yes/no mark.
 */
export function dueReminders(data: AppData, today: ISODate): ReminderKind[] {
  const { rem } = data.settings;
  const weekday = weekdayOf(today);
  const due: ReminderKind[] = [];
  if (rem.weigh.on && rem.weigh.day === weekday && !weighedOn(data, today)) due.push('weigh');
  if (rem.measure.on && rem.measure.day === weekday && !measuredOn(data, today)) due.push('measure');
  const trained = data.days[today]?.trained ?? null;
  if (rem.workout.on && rem.workout.days.includes(weekday) && trained === null) due.push('workout');
  return due;
}
