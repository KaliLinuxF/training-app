import {
  emptyData,
  type AppData,
  type ISODate,
  type MeasureEntry,
  type Weekday,
  type WeeklyReminder,
} from '@legko/shared';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { measureCheck, nextReminderLabel, weeklyCheck, weighCheck } from './reminders';

// 2026-10-12 is a Monday; 2026-10-14 a Wednesday.
const MONDAY = '2026-10-12';
const WEDNESDAY = '2026-10-14';

const rem = (day: number, on = true, time = '08:00'): WeeklyReminder => ({ on, day: day as Weekday, time });
const MON = rem(1);

describe('weeklyCheck', () => {
  it('done: a record exists today (next skips today)', () => {
    expect(weeklyCheck(MON, ['2026-10-05', MONDAY], MONDAY)).toEqual({
      state: 'done',
      next: nextReminderLabel(MON, true, MONDAY),
      missed: null,
    });
    expect(weeklyCheck(MON, [MONDAY], MONDAY).next).toMatchObject({
      date: '2026-10-19',
      label: 'Пн, 19 жовтня',
      text: 'Пн, 19 жовтня · 08:00',
    });
  });

  it('done wins over a reminder that is off and over any other weekday', () => {
    const off = rem(1, false);
    expect(weeklyCheck(off, [WEDNESDAY], WEDNESDAY)).toEqual({
      state: 'done',
      next: nextReminderLabel(off, true, WEDNESDAY),
      missed: null,
    });
    expect(weeklyCheck(MON, ['2026-10-05', WEDNESDAY], WEDNESDAY).state).toBe('done');
  });

  it('off: the reminder is switched off (never due or overdue)', () => {
    const off = rem(1, false);
    expect(weeklyCheck(off, [], MONDAY)).toEqual({
      state: 'off',
      next: { date: null, label: 'вимкнено', time: null, text: 'вимкнено' },
      missed: null,
    });
    expect(weeklyCheck(off, ['2026-10-05'], WEDNESDAY).state).toBe('off');
  });

  it('due: today is the reminder day and nothing is recorded yet', () => {
    expect(weeklyCheck(MON, ['2026-10-05'], MONDAY)).toEqual({
      state: 'due',
      next: nextReminderLabel(MON, false, MONDAY),
      missed: null,
    });
    expect(weeklyCheck(MON, [], MONDAY).next).toMatchObject({ date: MONDAY, label: 'Сьогодні' });
    // A brand-new user is reminded on the day itself.
    expect(weeklyCheck(MON, [], MONDAY).state).toBe('due');
  });

  it('overdue: the scheduled day was missed after an earlier record', () => {
    expect(weeklyCheck(MON, ['2026-09-28', '2026-10-05'], WEDNESDAY)).toEqual({
      state: 'overdue',
      next: nextReminderLabel(MON, false, WEDNESDAY),
      missed: MONDAY,
    });
    expect(weeklyCheck(MON, ['2026-10-05'], WEDNESDAY).next.label).toBe('Пн, 19 жовтня');
  });

  it('a record from the missed day up to today clears overdue', () => {
    expect(weeklyCheck(MON, ['2026-10-05', '2026-10-13'], WEDNESDAY).state).toBe('upcoming');
    expect(weeklyCheck(MON, ['2026-10-05', MONDAY], WEDNESDAY).state).toBe('upcoming');
    // A record dated after today does not count as catching up.
    expect(weeklyCheck(MON, ['2026-10-05', '2026-10-16'], WEDNESDAY).state).toBe('overdue');
  });

  it('a brand-new user (no records) is upcoming, never overdue', () => {
    expect(weeklyCheck(MON, [], WEDNESDAY)).toEqual({
      state: 'upcoming',
      next: nextReminderLabel(MON, false, WEDNESDAY),
      missed: null,
    });
  });

  it('upcoming: the next date with no time in the label', () => {
    const check = weeklyCheck(rem(4), ['2026-10-08'], WEDNESDAY);
    expect(check.state).toBe('upcoming');
    expect(check.next).toMatchObject({ date: '2026-10-15', label: 'Завтра', text: 'Завтра · 08:00' });
    expect(check.missed).toBeNull();
  });

  it('looks back 6 days only: the latest scheduled day in [today − 6, today − 1]', () => {
    const sunday = '2026-10-18';
    // Monday 12 Oct is 6 days back: still the missed day (not the Monday before it).
    expect(weeklyCheck(MON, ['2026-10-05'], sunday)).toMatchObject({ state: 'overdue', missed: MONDAY });
    // A record before the missed day but inside the window does not clear it.
    expect(weeklyCheck(MON, ['2026-10-11'], sunday)).toMatchObject({ state: 'overdue', missed: MONDAY });
    // The day after the scheduled day.
    expect(weeklyCheck(MON, ['2026-10-05'], '2026-10-13')).toMatchObject({
      state: 'overdue',
      missed: MONDAY,
    });
    // Only the latest scheduled day counts: an older missed Monday with the last one recorded is fine.
    expect(weeklyCheck(MON, ['2026-09-28', MONDAY], sunday).state).toBe('upcoming');
  });

  it('accepts unsorted record dates', () => {
    expect(weeklyCheck(MON, ['2026-10-13', '2026-10-05'], WEDNESDAY).state).toBe('upcoming');
    expect(weeklyCheck(MON, [WEDNESDAY, '2026-10-05'], WEDNESDAY).state).toBe('done');
  });

  it('an invalid weekday is never due or overdue', () => {
    expect(weeklyCheck(rem(9), ['2026-10-05'], WEDNESDAY)).toMatchObject({ state: 'upcoming', missed: null });
  });
});

describe('weighCheck / measureCheck', () => {
  const measure = (date: ISODate): MeasureEntry => ({ date, chest: null, waist: 70, hips: null });

  function data(patch: Partial<AppData> = {}): AppData {
    const base = emptyData();
    return {
      ...base,
      settings: {
        ...base.settings,
        rem: { ...base.settings.rem, weigh: rem(1, true, '08:00'), measure: rem(3, true, '08:30') },
      },
      ...patch,
    };
  }

  it('use the weigh-in reminder and the weigh-in dates', () => {
    const d = data({ weights: [{ date: '2026-10-05', kg: 66 }] });
    expect(weighCheck(d, WEDNESDAY)).toMatchObject({ state: 'overdue', missed: MONDAY });
    expect(weighCheck(d, MONDAY).state).toBe('due');
    expect(weighCheck(data({ weights: [{ date: WEDNESDAY, kg: 65 }] }), WEDNESDAY).state).toBe('done');
  });

  it('use the measurements reminder and the measurement dates', () => {
    const d = data({ measures: [measure('2026-10-07')], weights: [{ date: WEDNESDAY, kg: 65 }] });
    expect(measureCheck(d, WEDNESDAY)).toMatchObject({ state: 'due', next: { label: 'Сьогодні' } });
    expect(measureCheck(d, '2026-10-16')).toMatchObject({ state: 'overdue', missed: WEDNESDAY });
    expect(measureCheck(data({ measures: [measure(WEDNESDAY)] }), WEDNESDAY)).toMatchObject({
      state: 'done',
      next: { label: 'Ср, 21 жовтня', text: 'Ср, 21 жовтня · 08:30' },
    });
  });
});

describe('weeklyCheck across the clock change (Europe/Kyiv, 25 October 2026)', () => {
  // Node re-reads TZ when it is assigned, so local `Date`s below really cross the clock change.
  beforeAll(() => {
    vi.stubEnv('TZ', 'Europe/Kyiv');
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('really runs in a zone with DST', () => {
    expect(new Date(2026, 9, 24).getTimezoneOffset()).not.toBe(new Date(2026, 9, 26).getTimezoneOffset());
  });

  it('finds the missed Sunday of the clock change and the next one', () => {
    const sunday = rem(0);
    expect(weeklyCheck(sunday, ['2026-10-18'], '2026-10-28')).toEqual({
      state: 'overdue',
      next: expect.objectContaining({ date: '2026-11-01', label: 'Нд, 1 листопада' }),
      missed: '2026-10-25',
    });
    expect(weeklyCheck(sunday, ['2026-10-18'], '2026-10-25').state).toBe('due');
  });

  it('looks back over the change from the Monday after it', () => {
    expect(weeklyCheck(rem(6), ['2026-10-17'], '2026-10-26')).toMatchObject({
      state: 'overdue',
      missed: '2026-10-24',
      next: { date: '2026-10-31', label: 'Сб, 31 жовтня' },
    });
    expect(weeklyCheck(MON, ['2026-10-19'], '2026-10-26').state).toBe('due');
    expect(weeklyCheck(MON, ['2026-10-19'], '2026-10-27')).toMatchObject({
      state: 'overdue',
      missed: '2026-10-26',
    });
  });
});
