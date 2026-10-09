import { cleanup, renderHook } from '@testing-library/react';
import { createElement, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { BACK_STATE_KEY, backState, cameFrom, useBackTo } from './backNav';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.history.replaceState(null, '');
});

describe('backState / cameFrom', () => {
  it('stamps the parent under the legkoFrom key', () => {
    expect(BACK_STATE_KEY).toBe('legkoFrom');
    expect(backState('/settings')).toEqual({ legkoFrom: '/settings' });
  });

  it('is true only for an object naming that parent', () => {
    expect(cameFrom(null, '/settings')).toBe(false);
    expect(cameFrom(undefined, '/settings')).toBe(false);
    expect(cameFrom('/settings', '/settings')).toBe(false);
    expect(cameFrom({}, '/settings')).toBe(false);
    expect(cameFrom({ legkoFrom: '/calendar' }, '/settings')).toBe(false);
    expect(cameFrom({ legkoFrom: '/settings' }, '/settings')).toBe(true);
    expect(cameFrom(backState('/settings'), '/settings')).toBe(true);
  });
});

describe('useBackTo', () => {
  function setup() {
    const memory = memoryLocation({ path: '/settings/reminders', record: true });
    const wrapper = ({ children }: { children: ReactNode }) =>
      createElement(Router, { hook: memory.hook, children });
    const { result } = renderHook(() => useBackTo('/settings'), { wrapper });
    return { memory, backTo: result.current };
  }

  it('pops the history entry when the page was opened from the parent', () => {
    window.history.replaceState({ legkoFrom: '/settings' }, '');
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    const { memory, backTo } = setup();
    const preventDefault = vi.fn();
    backTo({ preventDefault });
    expect(preventDefault).toHaveBeenCalledOnce();
    expect(back).toHaveBeenCalledOnce();
    expect(memory.history).toEqual(['/settings/reminders']);
  });

  it('replace-navigates to the parent otherwise (deep link, reload, another parent)', () => {
    const back = vi.spyOn(window.history, 'back').mockImplementation(() => undefined);
    for (const state of [null, { legkoFrom: '/calendar' }]) {
      window.history.replaceState(state, '');
      const { memory, backTo } = setup();
      backTo();
      expect(memory.history).toEqual(['/settings']);
    }
    expect(back).not.toHaveBeenCalled();
  });
});
