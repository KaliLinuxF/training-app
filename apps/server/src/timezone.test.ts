import { isValidTimeZone } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { canonicalTimeZone, sameTimeZone } from './timezone';

describe('canonicalTimeZone', () => {
  it.each([
    ['Europe/Kyiv', 'Europe/Kyiv'],
    ['Europe/Kiev', 'Europe/Kyiv'],
    ['europe/kyiv', 'Europe/Kyiv'],
    ['Europe/Zaporozhye', 'Europe/Kyiv'],
    ['Europe/Uzhgorod', 'Europe/Kyiv'],
    ['Europe/Simferopol', 'Europe/Simferopol'],
    ['Europe/Warsaw', 'Europe/Warsaw'],
    ['US/Eastern', 'America/New_York'],
    ['Asia/Calcutta', 'Asia/Kolkata'],
    ['Asia/Kolkata', 'Asia/Kolkata'],
    ['Etc/UTC', 'UTC'],
    ['Mars/Base', 'Mars/Base'],
  ])('%s → %s', (input, expected) => {
    expect(canonicalTimeZone(input)).toBe(expected);
  });

  it('maps every supported zone to a valid zone, and is idempotent', () => {
    for (const zone of Intl.supportedValuesOf('timeZone')) {
      const canonical = canonicalTimeZone(zone);
      expect(isValidTimeZone(canonical), zone).toBe(true);
      expect(canonicalTimeZone(canonical), zone).toBe(canonical);
    }
  });
});

describe('sameTimeZone', () => {
  it('treats aliases as one zone and different zones as different', () => {
    expect(sameTimeZone('Europe/Kiev', 'Europe/Kyiv')).toBe(true);
    expect(sameTimeZone('Europe/Kyiv', 'Europe/Kyiv')).toBe(true);
    // Simferopol stays on UTC+3 in winter while Kyiv goes back to UTC+2.
    expect(sameTimeZone('Europe/Simferopol', 'Europe/Kyiv')).toBe(false);
    expect(sameTimeZone('Europe/Warsaw', 'Europe/Berlin')).toBe(false);
  });
});
