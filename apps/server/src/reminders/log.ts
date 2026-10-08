import type { ISODate, ReminderKind } from '@legko/shared';
import type { Database } from '../db/sqlite';

export type ReminderStatus = 'sent' | 'skipped';

/** `reminder_log(kind, date)`: each reminder is handled at most once per local day. */
export interface ReminderLog {
  has(kind: ReminderKind, date: ISODate): boolean;
  record(kind: ReminderKind, date: ISODate, status: ReminderStatus, sent: number, now: number): void;
}

export function createReminderLog(db: Database): ReminderLog {
  const q = {
    has: db.prepare('SELECT 1 AS found FROM reminder_log WHERE kind = ? AND date = ?'),
    record: db.prepare(
      'INSERT OR IGNORE INTO reminder_log (kind, date, status, sent, created_at) VALUES (?, ?, ?, ?, ?)',
    ),
  };
  return {
    has: (kind, date) => q.has.get(kind, date) !== undefined,
    record: (kind, date, status, sent, now) => {
      q.record.run(kind, date, status, sent, now);
    },
  };
}
