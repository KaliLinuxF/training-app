import { DEEP_LINKS } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { hasDeepLinkParams, parseSheetDeepLink, urlWithoutDeepLink } from './deepLinks';

const searchOf = (url: string): string => url.split('?')[1] ?? '';

describe('sheet deep links', () => {
  it('parses the notification links from the shared contract', () => {
    expect(parseSheetDeepLink(searchOf(DEEP_LINKS.workout))).toEqual({ mode: 'day', patch: { trained: true } });
    expect(parseSheetDeepLink(searchOf(DEEP_LINKS.weigh))).toEqual({ mode: 'weight' });
    expect(parseSheetDeepLink(searchOf(DEEP_LINKS.measure))).toEqual({ mode: 'measure' });
  });

  it('accepts a leading «?» and a plain day link', () => {
    expect(parseSheetDeepLink('?sheet=day')).toEqual({ mode: 'day' });
    expect(parseSheetDeepLink('sheet=day&trained=0')).toEqual({ mode: 'day' });
  });

  it('ignores unknown sheets, sheets that are not deep-linkable and trained on other sheets', () => {
    expect(parseSheetDeepLink('')).toBeNull();
    expect(parseSheetDeepLink('date=2026-10-09')).toBeNull();
    expect(parseSheetDeepLink('sheet=setup')).toBeNull();
    expect(parseSheetDeepLink('sheet=install')).toBeNull();
    expect(parseSheetDeepLink('sheet=evil')).toBeNull();
    expect(parseSheetDeepLink('sheet=weight&trained=1')).toEqual({ mode: 'weight' });
  });

  it('removes only its own params from the URL', () => {
    expect(urlWithoutDeepLink('/', 'sheet=day&trained=1')).toBe('/');
    expect(urlWithoutDeepLink('/calendar', 'date=2026-10-09&sheet=weight')).toBe('/calendar?date=2026-10-09');
  });

  it('knows when there is something to clean', () => {
    expect(hasDeepLinkParams('sheet=weight')).toBe(true);
    expect(hasDeepLinkParams('sheet=nope')).toBe(true);
    expect(hasDeepLinkParams('date=2026-10-09')).toBe(false);
    expect(hasDeepLinkParams('')).toBe(false);
  });
});
