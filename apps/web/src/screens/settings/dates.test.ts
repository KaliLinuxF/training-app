import { describe, expect, it } from 'vitest';
import { calendarDate, clockTime, dayTime, dayWord, longDate, shortDate, untilDateTime } from './dates';

/** Local wall-clock times, so the expectations hold in any time zone the tests run in. */
const at = (y: number, m: number, d: number, h = 12, min = 0) => new Date(y, m - 1, d, h, min).getTime();
const NOW = at(2026, 10, 22, 10, 0);

describe('account dates', () => {
  it('formats a date with and without the year, and a 24-hour time', () => {
    expect(longDate(at(2026, 10, 9))).toBe('9 жовтня 2026');
    expect(shortDate(at(2026, 10, 28))).toBe('28 жовтня');
    expect(clockTime(at(2026, 10, 28, 14, 5))).toBe('14:05');
    expect(clockTime(at(2026, 10, 28, 0, 0))).toBe('00:00');
    expect(untilDateTime(at(2026, 10, 28, 14, 5))).toBe('28 жовтня, 14:05');
    expect(untilDateTime(at(2027, 1, 3, 9, 30))).toBe('3 січня, 09:30');
  });

  it('leaves the year out only in the current one', () => {
    expect(calendarDate(at(2026, 10, 21), NOW)).toBe('21 жовтня');
    expect(calendarDate(at(2025, 12, 31), NOW)).toBe('31 грудня 2025');
    expect(calendarDate(at(2027, 1, 2), NOW)).toBe('2 січня 2027');
  });

  it('says «сьогодні» and «вчора», otherwise the date', () => {
    expect(dayWord(at(2026, 10, 22, 0, 5), NOW)).toBe('сьогодні');
    expect(dayWord(at(2026, 10, 22, 9, 12), NOW)).toBe('сьогодні');
    expect(dayWord(at(2026, 10, 21, 23, 59), NOW)).toBe('вчора');
    expect(dayWord(at(2026, 10, 20, 8, 0), NOW)).toBe('20 жовтня');
    expect(dayWord(at(2025, 10, 22, 8, 0), NOW)).toBe('22 жовтня 2025');
    expect(dayTime(at(2026, 10, 22, 9, 12), NOW)).toBe('сьогодні, 09:12');
    expect(dayTime(at(2026, 10, 21, 18, 40), NOW)).toBe('вчора, 18:40');
    expect(dayTime(at(2026, 10, 3, 7, 1), NOW)).toBe('3 жовтня, 07:01');
  });

  it('shows a timestamp after «now» (server clock ahead of the device) as its own day, never as a negative', () => {
    // Later today: still today.
    expect(dayWord(at(2026, 10, 22, 23, 0), NOW)).toBe('сьогодні');
    // Tomorrow / next week / next year: the date, not «вчора», «завтра» or «через …».
    expect(dayWord(at(2026, 10, 23, 1, 0), NOW)).toBe('23 жовтня');
    expect(dayWord(at(2026, 10, 30), NOW)).toBe('30 жовтня');
    expect(dayTime(at(2027, 1, 1, 0, 30), NOW)).toBe('1 січня 2027, 00:30');
    expect(calendarDate(at(2026, 10, 30), NOW)).toBe('30 жовтня');
  });

  it('handles the turn of the year and of the month for «вчора»', () => {
    const newYear = at(2027, 1, 1, 9, 0);
    expect(dayWord(at(2026, 12, 31, 22, 0), newYear)).toBe('вчора');
    expect(dayWord(at(2026, 12, 30, 22, 0), newYear)).toBe('30 грудня 2026');
    expect(dayWord(at(2026, 9, 30, 22, 0), at(2026, 10, 1, 8, 0))).toBe('вчора');
  });
});
