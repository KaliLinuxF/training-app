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
 * Home banners: reminders scheduled for today whose action is not done yet, in banner order
 * (weigh-in, measurements, workout). Workout counts as done once the day has a yes/no mark.
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
