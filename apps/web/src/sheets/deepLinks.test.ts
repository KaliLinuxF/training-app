import { DEEP_LINKS } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { hasDeepLinkParams, parseSheetDeepLink, urlWithoutDeepLink } from './deepLinks';

const searchOf = (url: string): string => url.split('?')[1] ?? '';

describe('sheet deep links', () => {
  it('parses the notification links from the shared contract (the workout push opens «Тренування» with ✓)', () => {
    expect(parseSheetDeepLink(searchOf(DEEP_LINKS.workout))).toEqual({ mode: 'workout', patch: { trained: true } });
    expect(parseSheetDeepLink(searchOf(DEEP_LINKS.weigh))).toEqual({ mode: 'weight' });
    expect(parseSheetDeepLink(searchOf(DEEP_LINKS.measure))).toEqual({ mode: 'measure' });
  });

  it('keeps `sheet=day&trained=1` as an alias of the workout sheet; a plain day link opens the full day', () => {
    expect(parseSheetDeepLink('?sheet=day&trained=1')).toEqual({ mode: 'workout', patch: { trained: true } });
    expect(parseSheetDeepLink('?sheet=day')).toEqual({ mode: 'day' });
    expect(parseSheetDeepLink('sheet=day&trained=0')).toEqual({ mode: 'day' });
  });

  it('opens the short sheets, the workout pre-set to ✓ only with trained=1', () => {
    expect(parseSheetDeepLink('sheet=food')).toEqual({ mode: 'food' });
    expect(parseSheetDeepLink('sheet=workout')).toEqual({ mode: 'workout' });
    expect(parseSheetDeepLink('?sheet=workout&trained=1')).toEqual({ mode: 'workout', patch: { trained: true } });
    expect(parseSheetDeepLink('sheet=workout&trained=yes')).toEqual({ mode: 'workout' });
  });

  it('ignores unknown sheets, sheets that are not deep-linkable and trained on other sheets', () => {
    expect(parseSheetDeepLink('')).toBeNull();
    expect(parseSheetDeepLink('date=2026-10-09')).toBeNull();
    expect(parseSheetDeepLink('sheet=menu')).toBeNull();
    expect(parseSheetDeepLink('sheet=setup')).toBeNull();
    expect(parseSheetDeepLink('sheet=install')).toBeNull();
    expect(parseSheetDeepLink('sheet=evil')).toBeNull();
    expect(parseSheetDeepLink('sheet=weight&trained=1')).toEqual({ mode: 'weight' });
    expect(parseSheetDeepLink('sheet=food&trained=1')).toEqual({ mode: 'food' });
    expect(parseSheetDeepLink('sheet=measure&trained=1')).toEqual({ mode: 'measure' });
  });

  it('removes only its own params from the URL', () => {
    expect(urlWithoutDeepLink('/', 'sheet=day&trained=1')).toBe('/');
    expect(urlWithoutDeepLink('/', 'sheet=menu')).toBe('/');
    expect(urlWithoutDeepLink('/calendar', 'date=2026-10-09&sheet=weight')).toBe('/calendar?date=2026-10-09');
  });

  it('knows when there is something to clean', () => {
    expect(hasDeepLinkParams('sheet=weight')).toBe(true);
    expect(hasDeepLinkParams('sheet=nope')).toBe(true);
    expect(hasDeepLinkParams('sheet=menu')).toBe(true);
    expect(hasDeepLinkParams('date=2026-10-09')).toBe(false);
    expect(hasDeepLinkParams('')).toBe(false);
  });
});
