import { describe, expect, it } from 'vitest';
import { sameTimeZone } from './timezone';

const OCT_2026 = Date.UTC(2026, 9, 9, 9);

describe('sameTimeZone', () => {
  it('treats spelling variants of one zone as the same zone', () => {
    expect(sameTimeZone('Europe/Kyiv', 'Europe/Kyiv')).toBe(true);
    expect(sameTimeZone('Europe/Kiev', 'Europe/Kyiv', OCT_2026)).toBe(true);
    expect(sameTimeZone('UTC', 'Etc/UTC', OCT_2026)).toBe(true);
  });

  it('tells apart zones that only agree for part of the year', () => {
    // Both UTC+3 in October 2026, but Kyiv goes back to UTC+2 on 25 October.
    expect(sameTimeZone('Europe/Kyiv', 'Europe/Simferopol', OCT_2026)).toBe(false);
    // Same offset in winter, different DST rules.
    expect(sameTimeZone('Europe/London', 'Africa/Abidjan', OCT_2026)).toBe(false);
    expect(sameTimeZone('Europe/Kyiv', 'Asia/Tokyo', OCT_2026)).toBe(false);
  });

  it('never matches an unknown zone with a real one', () => {
    expect(sameTimeZone('Mars/Olympus', 'Europe/Kyiv', OCT_2026)).toBe(false);
    expect(sameTimeZone('Europe/Kyiv', '', OCT_2026)).toBe(false);
  });
});
