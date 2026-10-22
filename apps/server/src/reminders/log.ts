import type { ISODate, ReminderKind } from '@legko/shared';
import type { Database } from '../db/sqlite';
import type { UserId } from '../db/users';

export type ReminderStatus = 'sent' | 'skipped';

/** `reminder_log(user_id, kind, date)`: each reminder is handled at most once per user and local day. */
export interface ReminderLog {
  has(kind: ReminderKind, date: ISODate): boolean;
  record(kind: ReminderKind, date: ISODate, status: ReminderStatus, sent: number, now: number): void;
}

export interface ReminderLogs {
  forUser(id: UserId): ReminderLog;
}

export function createReminderLog(db: Database): ReminderLogs {
  const q = {
    has: db.prepare('SELECT 1 AS found FROM reminder_log WHERE user_id = ? AND kind = ? AND date = ?'),
    record: db.prepare(
      `INSERT OR IGNORE INTO reminder_log (user_id, kind, date, status, sent, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    ),
  };
  return {
    forUser: (id) => ({
      has: (kind, date) => q.has.get(id, kind, date) !== undefined,
      record: (kind, date, status, sent, now) => {
        q.record.run(id, kind, date, status, sent, now);
      },
    }),
  };
}
