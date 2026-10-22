/** Test-only fixtures of «Користувачі» (never imported by app code). */
import type { AdminInvite, AdminOverview, AdminUser } from '@legko/shared';

/** Local wall-clock time in ms (expectations then hold in any time zone the tests run in). */
export const at = (y: number, m: number, d: number, h = 12, min = 0): number =>
  new Date(y, m - 1, d, h, min).getTime();

/** A stable 32-hex id from a name. */
export const idOf = (name: string): string =>
  Array.from(name, (c) => c.charCodeAt(0).toString(16))
    .join('')
    .padEnd(32, '0')
    .slice(0, 32);

export function adminUser(username: string, patch: Partial<AdminUser> = {}): AdminUser {
  return {
    id: idOf(username),
    username,
    role: 'user',
    status: 'active',
    createdAt: at(2026, 10, 9),
    lastSeenAt: null,
    ai: { today: 0, last30Days: 0, limit: 40, customLimit: null },
    self: false,
    ...patch,
  };
}

export function adminInvite(patch: Partial<AdminInvite> = {}): AdminInvite {
  return {
    id: 'b'.repeat(32),
    note: 'для Олі',
    role: 'user',
    createdAt: at(2026, 10, 21),
    expiresAt: at(2026, 10, 28, 14, 5),
    createdBy: 'admin',
    ...patch,
  };
}

/** admin (self, the only admin), anna, olya; no invites; the default limits. */
export function adminOverview(patch: Partial<AdminOverview> = {}): AdminOverview {
  return {
    users: [adminUser('admin', { role: 'admin', self: true }), adminUser('anna'), adminUser('olya')],
    invites: [],
    limits: { perUser: 40, global: 150 },
    aiToday: { used: 12, ceiling: 150 },
    ...patch,
  };
}
