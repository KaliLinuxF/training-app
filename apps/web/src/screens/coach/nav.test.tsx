import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Router } from 'wouter';
import { afterEach, describe, expect, it } from 'vitest';
import { clientHref, coachPhotoUrls, COACH_ROOT, useReplaceParams } from './nav';

afterEach(() => {
  cleanup();
  window.history.replaceState(null, '', '/');
});

const wrapper = ({ children }: { children: ReactNode }) => <Router>{children}</Router>;

describe('coach navigation helpers', () => {
  it('builds the client path and the coach photo URLs (never /api/photos)', () => {
    expect(COACH_ROOT).toBe('/coach');
    expect(clientHref('c0ac0000000000000000000000000001')).toBe('/coach/c0ac0000000000000000000000000001');
    const urls = coachPhotoUrls('c0ac0000000000000000000000000001');
    expect(urls.thumb('p1')).toBe('/api/coach/clients/c0ac0000000000000000000000000001/photos/p1/thumb');
    expect(urls.full('p1')).toBe('/api/coach/clients/c0ac0000000000000000000000000001/photos/p1');
    expect(Object.isFrozen(urls)).toBe(true);
  });

  it('useReplaceParams replaces the entry and keeps its state (the back stamp)', () => {
    window.history.replaceState({ legkoFrom: '/coach' }, '', '/coach/abc');
    const length = window.history.length;
    const { result, rerender } = renderHook(() => useReplaceParams(), { wrapper });
    const first = result.current;
    act(() => result.current('/coach/abc?tab=calendar'));
    act(() => result.current('/coach/abc?tab=calendar&date=2026-10-13'));
    expect(`${window.location.pathname}${window.location.search}`).toBe('/coach/abc?tab=calendar&date=2026-10-13');
    expect(window.history.state).toEqual({ legkoFrom: '/coach' });
    expect(window.history.length).toBe(length);
    rerender();
    expect(result.current).toBe(first);
  });
});
