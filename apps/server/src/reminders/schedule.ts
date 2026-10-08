import {
  addDays,
  minutesOf,
  parse,
  weekdayOf,
  zonedNow,
  type HM,
  type ISODate,
  type ReminderKind,
  type Settings,
} from '@legko/shared';

/** A reminder may still fire this long after its scheduled time (covers restarts and tick jitter). */
export const REMINDER_WINDOW_MS = 15 * 60_000;

export const REMINDER_KINDS: readonly ReminderKind[] = ['workout', 'weigh', 'measure'];

const MINUTE_MS = 60_000;
const HALF_DAY_MS = 12 * 3600_000;

/** Wall-clock `date hm` read as if it were UTC, in ms. */
function wallAsUtc(date: ISODate, minutes: number): number {
  const d = parse(date);
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60);
}

/** UTC offset of `timeZone` at instant `t` (minute precision), in ms. */
function offsetAt(t: number, timeZone: string): number {
  const minute = Math.floor(t / MINUTE_MS) * MINUTE_MS;
  const z = zonedNow(timeZone, new Date(minute));
  return wallAsUtc(z.date, z.minutes) - minute;
}

/**
 * The instant at which the wall clock in `timeZone` shows `date hm`.
 * Like Temporal's "compatible" disambiguation: a time skipped by a DST jump moves forward by
 * the length of the gap, a time that occurs twice resolves to its first occurrence.
 */
export function zonedTimeToEpoch(date: ISODate, hm: HM, timeZone: string): number {
  const wall = wallAsUtc(date, minutesOf(hm));
  const before = offsetAt(wall - HALF_DAY_MS, timeZone);
  const after = offsetAt(wall + HALF_DAY_MS, timeZone);
  const valid = [wall - before, wall - after].filter((t) => t + offsetAt(t, timeZone) === wall);
  return valid.length ? Math.min(...valid) : wall - before;
}

export interface DueReminder {
  kind: ReminderKind;
  /** The local date the reminder belongs to (key of `reminder_log`). */
  date: ISODate;
}

function isScheduledOn(settings: Settings, kind: ReminderKind, date: ISODate): boolean {
  const weekday = weekdayOf(date);
  switch (kind) {
    case 'workout':
      return settings.rem.workout.on && settings.rem.workout.days.includes(weekday);
    case 'weigh':
      return settings.rem.weigh.on && settings.rem.weigh.day === weekday;
    case 'measure':
      return settings.rem.measure.on && settings.rem.measure.day === weekday;
  }
}

/**
 * Enabled reminders whose scheduled time `t` (in `settings.timezone`) satisfies
 * `t ≤ now < t + 15 min`. Yesterday is checked too, so 23:55 still fires at 00:05.
 */
export function dueReminders(settings: Settings, now: Date): DueReminder[] {
  const tz = settings.timezone;
  const today = zonedNow(tz, now).date;
  const due: DueReminder[] = [];
  for (const kind of REMINDER_KINDS) {
    for (const date of [addDays(today, -1), today]) {
      if (!isScheduledOn(settings, kind, date)) continue;
      const at = zonedTimeToEpoch(date, settings.rem[kind].time, tz);
      const elapsed = now.getTime() - at;
      if (elapsed >= 0 && elapsed < REMINDER_WINDOW_MS) due.push({ kind, date });
    }
  }
  return due;
}

export type ReminderAction = 'send' | 'skip';

export interface PlannedReminder extends DueReminder {
  /** `skip`: the action is already recorded for that day — log it as handled, send nothing. */
  action: ReminderAction;
}

export interface PlanInput {
  settings: Settings;
  now: Date;
  /** Already sent or skipped (present in `reminder_log`). */
  handled: (kind: ReminderKind, date: ISODate) => boolean;
  /** Weigh-in / measurements / workout mark already recorded for that day. */
  done: (kind: ReminderKind, date: ISODate) => boolean;
}

/** Pure decision for one scheduler tick. */
export function planReminders({ settings, now, handled, done }: PlanInput): PlannedReminder[] {
  return dueReminders(settings, now)
    .filter((r) => !handled(r.kind, r.date))
    .map((r) => ({ ...r, action: done(r.kind, r.date) ? 'skip' : 'send' }));
}
