import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import source from './useShownMonth.ts?raw';
import { useShownMonth } from './useShownMonth';

afterEach(cleanup);

describe('useShownMonth', () => {
  it("starts at the selected day's month and follows every change of the selection", () => {
    const { result, rerender } = renderHook(({ selected }) => useShownMonth(selected), {
      initialProps: { selected: '2026-10-09' },
    });
    expect(result.current[0]).toBe('2026-10');

    // A month browsed with ‹ › …
    act(() => result.current[1]('2026-08'));
    expect(result.current[0]).toBe('2026-08');

    // … is left as soon as another day is selected (a tap, «Сьогодні», a `?date=` link, midnight).
    rerender({ selected: '2026-09-30' });
    expect(result.current[0]).toBe('2026-09');
    rerender({ selected: '2026-10-01' });
    expect(result.current[0]).toBe('2026-10');
  });

  it('setMonth moves the shown month and keeps the selection', () => {
    const { result, rerender } = renderHook(({ selected }) => useShownMonth(selected), {
      initialProps: { selected: '2026-10-09' },
    });
    act(() => result.current[1]('2026-07'));
    expect(result.current[0]).toBe('2026-07');
    act(() => result.current[1]('2026-06'));
    expect(result.current[0]).toBe('2026-06');

    // Same selection re-rendered (new data, a clock tick): the browsed month stays.
    rerender({ selected: '2026-10-09' });
    expect(result.current[0]).toBe('2026-06');

    // The setter returned right after a selection change also keeps that new selection.
    rerender({ selected: '2026-05-20' });
    expect(result.current[0]).toBe('2026-05');
    act(() => result.current[1]('2026-04'));
    expect(result.current[0]).toBe('2026-04');
    rerender({ selected: '2026-05-20' });
    expect(result.current[0]).toBe('2026-04');
  });

  it('is store-free: imports only React, shared types and the calendar model', () => {
    const imports = [...source.matchAll(/from\s+'([^']+)'/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(['./model', '@legko/shared', 'react']);
    expect(source).not.toContain('@/store/');
  });
});
