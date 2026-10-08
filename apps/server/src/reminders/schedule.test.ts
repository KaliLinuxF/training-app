import { defaultSettings, type ISODate, type ReminderKind, type Settings } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { dueReminders, planReminders, REMINDER_WINDOW_MS, zonedTimeToEpoch } from './schedule';

const MIN = 60_000;
const utc = (iso: string): Date => new Date(iso);

/** All reminders off except the ones patched in. */
function settings(patch: Partial<Settings['rem']> = {}, timezone = 'Europe/Kyiv'): Settings {
  const base = defaultSettings();
  return {
    ...base,
    timezone,
    rem: {
      workout: { ...base.rem.workout, on: false },
      weigh: { ...base.rem.weigh, on: false },
      measure: { ...base.rem.measure, on: false },
      ...patch,
    },
  };
}

const weighMonday8 = settings({ weigh: { on: true, day: 1, time: '08:00' } });

describe('zonedTimeToEpoch (Europe/Kyiv)', () => {
  it('handles summer (+3) and winter (+2) offsets', () => {
    expect(zonedTimeToEpoch('2026-10-09', '18:00', 'Europe/Kyiv')).toBe(Date.UTC(2026, 9, 9, 15, 0));
    expect(zonedTimeToEpoch('2026-12-01', '08:00', 'Europe/Kyiv')).toBe(Date.UTC(2026, 11, 1, 6, 0));
  });

  it('uses the new offset after the change on DST days', () => {
    expect(zonedTimeToEpoch('2026-03-29', '08:00', 'Europe/Kyiv')).toBe(Date.UTC(2026, 2, 29, 5, 0));
    expect(zonedTimeToEpoch('2026-10-25', '08:00', 'Europe/Kyiv')).toBe(Date.UTC(2026, 9, 25, 6, 0));
    // Before the 03:00/04:00 switch the old offset still applies.
    expect(zonedTimeToEpoch('2026-03-29', '02:30', 'Europe/Kyiv')).toBe(Date.UTC(2026, 2, 29, 0, 30));
    expect(zonedTimeToEpoch('2026-10-25', '02:30', 'Europe/Kyiv')).toBe(Date.UTC(2026, 9, 24, 23, 30));
  });

  it('moves a time skipped by spring-forward ahead by the gap (03:30 → 04:30)', () => {
    expect(zonedTimeToEpoch('2026-03-29', '03:30', 'Europe/Kyiv')).toBe(Date.UTC(2026, 2, 29, 1, 30));
  });

  it('resolves a repeated fall-back time to its first occurrence', () => {
    expect(zonedTimeToEpoch('2026-10-25', '03:30', 'Europe/Kyiv')).toBe(Date.UTC(2026, 9, 25, 0, 30));
  });

  it('works for other zones', () => {
    expect(zonedTimeToEpoch('2026-10-09', '08:00', 'UTC')).toBe(Date.UTC(2026, 9, 9, 8, 0));
    expect(zonedTimeToEpoch('2026-07-01', '08:00', 'America/New_York')).toBe(Date.UTC(2026, 6, 1, 12, 0));
  });
});

describe('dueReminders', () => {
  // Monday 2026-10-12, 08:00 Kyiv (EEST) = 05:00 UTC.
  const at = Date.UTC(2026, 9, 12, 5, 0);

  it('is due from the scheduled minute for 15 minutes', () => {
    expect(dueReminders(weighMonday8, new Date(at - 1))).toEqual([]);
    expect(dueReminders(weighMonday8, new Date(at))).toEqual([{ kind: 'weigh', date: '2026-10-12' }]);
    expect(dueReminders(weighMonday8, new Date(at + REMINDER_WINDOW_MS - 1))).toEqual([
      { kind: 'weigh', date: '2026-10-12' },
    ]);
    expect(dueReminders(weighMonday8, new Date(at + REMINDER_WINDOW_MS))).toEqual([]);
  });

  it('only on the configured weekday', () => {
    expect(dueReminders(weighMonday8, new Date(at + 86_400_000))).toEqual([]); // Tuesday
    expect(dueReminders(weighMonday8, new Date(at - 86_400_000))).toEqual([]); // Sunday
  });

  it('uses settings.timezone', () => {
    const utcSettings = { ...weighMonday8, timezone: 'UTC' };
    expect(dueReminders(utcSettings, new Date(at))).toEqual([]);
    expect(dueReminders(utcSettings, utc('2026-10-12T08:05:00Z'))).toEqual([
      { kind: 'weigh', date: '2026-10-12' },
    ]);
  });

  it('follows the wall clock across DST changes', () => {
    // Monday before/after the October change: 08:00 is 05:00Z (EEST) then 06:00Z (EET).
    expect(dueReminders(weighMonday8, utc('2026-10-19T05:00:00Z'))).toHaveLength(1);
    expect(dueReminders(weighMonday8, utc('2026-10-26T05:00:00Z'))).toEqual([]);
    expect(dueReminders(weighMonday8, utc('2026-10-26T06:00:00Z'))).toHaveLength(1);
    // And the March change: 06:00Z (EET) then 05:00Z (EEST).
    expect(dueReminders(weighMonday8, utc('2026-03-23T06:00:00Z'))).toHaveLength(1);
    expect(dueReminders(weighMonday8, utc('2026-03-30T05:00:00Z'))).toHaveLength(1);
    expect(dueReminders(weighMonday8, utc('2026-03-30T06:00:00Z'))).toEqual([]);
  });

  it('still fires on spring-forward day when the time does not exist', () => {
    const s = settings({ workout: { on: true, days: [0], time: '03:30' } });
    expect(dueReminders(s, utc('2026-03-29T01:29:00Z'))).toEqual([]);
    expect(dueReminders(s, utc('2026-03-29T01:30:00Z'))).toEqual([{ kind: 'workout', date: '2026-03-29' }]);
  });

  it('fires only for the first 03:30 on fall-back day', () => {
    const s = settings({ workout: { on: true, days: [0], time: '03:30' } });
    expect(dueReminders(s, utc('2026-10-25T00:30:00Z'))).toEqual([{ kind: 'workout', date: '2026-10-25' }]);
    expect(dueReminders(s, utc('2026-10-25T01:30:00Z'))).toEqual([]); // the second 03:30
  });

  it('keeps the window open past midnight and attributes it to the scheduled day', () => {
    const s = settings({ workout: { on: true, days: [5], time: '23:55' } }); // Friday
    // Saturday 2026-10-10 00:05 Kyiv = Friday 21:05 UTC.
    expect(dueReminders(s, utc('2026-10-09T21:05:00Z'))).toEqual([{ kind: 'workout', date: '2026-10-09' }]);
    expect(dueReminders(s, utc('2026-10-09T21:10:00Z'))).toEqual([]);
  });

  it('ignores disabled reminders', () => {
    const off = settings({ weigh: { on: false, day: 1, time: '08:00' } });
    expect(dueReminders(off, new Date(at))).toEqual([]);
    const noDays = settings({ workout: { on: true, days: [], time: '08:00' } });
    expect(dueReminders(noDays, new Date(at))).toEqual([]);
  });

  it('handles workout reminders on several weekdays', () => {
    const s = settings({ workout: { on: true, days: [1, 3, 5], time: '18:00' } });
    const evening = (date: string) => utc(`${date}T15:00:00Z`); // 18:00 Kyiv in October
    expect(dueReminders(s, evening('2026-10-12'))).toEqual([{ kind: 'workout', date: '2026-10-12' }]); // Mon
    expect(dueReminders(s, evening('2026-10-13'))).toEqual([]); // Tue
    expect(dueReminders(s, evening('2026-10-14'))).toEqual([{ kind: 'workout', date: '2026-10-14' }]); // Wed
    expect(dueReminders(s, evening('2026-10-16'))).toEqual([{ kind: 'workout', date: '2026-10-16' }]); // Fri
    expect(dueReminders(s, evening('2026-10-18'))).toEqual([]); // Sun
  });

  it('returns several kinds that share a slot', () => {
    const s = settings({
      workout: { on: true, days: [1], time: '08:00' },
      weigh: { on: true, day: 1, time: '08:00' },
      measure: { on: true, day: 1, time: '08:10' },
    });
    expect(dueReminders(s, new Date(at + 10 * MIN)).map((r) => r.kind)).toEqual([
      'workout',
      'weigh',
      'measure',
    ]);
  });
});

describe('planReminders', () => {
  const now = new Date(Date.UTC(2026, 9, 12, 5, 1));
  const both = settings({
    weigh: { on: true, day: 1, time: '08:00' },
    measure: { on: true, day: 1, time: '08:00' },
  });
  const key = (k: ReminderKind, d: ISODate) => `${k}:${d}`;

  it('sends each due reminder once per day', () => {
    const handled = new Set<string>();
    const first = planReminders({
      settings: both,
      now,
      handled: (k, d) => handled.has(key(k, d)),
      done: () => false,
    });
    expect(first).toEqual([
      { kind: 'weigh', date: '2026-10-12', action: 'send' },
      { kind: 'measure', date: '2026-10-12', action: 'send' },
    ]);
    for (const r of first) handled.add(key(r.kind, r.date));
    const later = new Date(now.getTime() + 30_000);
    expect(
      planReminders({
        settings: both,
        now: later,
        handled: (k, d) => handled.has(key(k, d)),
        done: () => false,
      }),
    ).toEqual([]);
  });

  it('skips (but plans for logging) when the action is already done', () => {
    const plan = planReminders({ settings: both, now, handled: () => false, done: (k) => k === 'weigh' });
    expect(plan).toEqual([
      { kind: 'weigh', date: '2026-10-12', action: 'skip' },
      { kind: 'measure', date: '2026-10-12', action: 'send' },
    ]);
  });
});
