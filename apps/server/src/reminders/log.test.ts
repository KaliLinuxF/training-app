import { describe, expect, it } from 'vitest';
import { openDatabase } from '../db/open';
import { createUserRepo } from '../db/users';
import { createReminderLog } from './log';

describe('reminder log per user', () => {
  it('records each reminder once per user and day; users never see each other’s entries', () => {
    const db = openDatabase(':memory:');
    const users = createUserRepo(db);
    const anna = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0 }).id;
    const olya = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
    const logs = createReminderLog(db);
    const A = logs.forUser(anna);
    const B = logs.forUser(olya);

    expect(A.has('weigh', '2026-10-12')).toBe(false);
    A.record('weigh', '2026-10-12', 'sent', 2, 100);
    expect(A.has('weigh', '2026-10-12')).toBe(true);
    expect(A.has('weigh', '2026-10-13')).toBe(false);
    expect(A.has('measure', '2026-10-12')).toBe(false);
    expect(B.has('weigh', '2026-10-12')).toBe(false);

    // The same reminder for another user on the same day is its own row.
    B.record('weigh', '2026-10-12', 'skipped', 0, 101);
    expect(B.has('weigh', '2026-10-12')).toBe(true);
    // A second record of the same reminder is ignored (first one wins).
    A.record('weigh', '2026-10-12', 'skipped', 0, 102);
    expect(
      db
        .prepare('SELECT user_id, status, sent FROM reminder_log ORDER BY created_at')
        .all()
        .map((r) => ({ ...r })),
    ).toEqual([
      { user_id: anna, status: 'sent', sent: 2 },
      { user_id: olya, status: 'skipped', sent: 0 },
    ]);
  });
});
