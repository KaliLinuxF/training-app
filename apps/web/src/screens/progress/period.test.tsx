import { act, cleanup, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_PERIOD, PERIOD_STORAGE_KEY, readStoredPeriod, storePeriod, usePeriod } from './period';

beforeEach(() => {
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const blockStorage = () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });
};

/** `usePeriod` on `path` inside a memory router (location hook + its search hook). */
function renderPeriod(path: string) {
  const memory = memoryLocation({ path, record: true });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <Router hook={memory.hook} searchHook={memory.searchHook}>
      {children}
    </Router>
  );
  const hook = renderHook(() => usePeriod(), { wrapper });
  return { memory, hook, period: () => hook.result.current[0] };
}

describe('readStoredPeriod / storePeriod', () => {
  it('round-trips a period through sessionStorage', () => {
    storePeriod('q');
    expect(window.sessionStorage.getItem(PERIOD_STORAGE_KEY)).toBe('q');
    expect(readStoredPeriod()).toBe('q');
  });

  it('falls back to the week for junk or a missing value', () => {
    expect(readStoredPeriod()).toBe(DEFAULT_PERIOD);
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, 'year');
    expect(readStoredPeriod()).toBe('week');
  });

  it('survives storage that throws (private mode, blocked site data)', () => {
    blockStorage();
    expect(readStoredPeriod()).toBe('week');
    expect(() => storePeriod('all')).not.toThrow();
  });
});

describe('usePeriod', () => {
  it('starts with the remembered period and remembers a new choice', () => {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, 'month');
    const { hook, period, memory } = renderPeriod('/progress');
    expect(period()).toBe('month');
    act(() => hook.result.current[1]('q'));
    expect(period()).toBe('q');
    expect(window.sessionStorage.getItem(PERIOD_STORAGE_KEY)).toBe('q');
    // Choosing never touches the URL.
    expect(memory.history).toEqual(['/progress']);
  });

  it('applies a valid ?period= over the remembered one, stores it and removes it with replace', () => {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, 'month');
    const { period, memory } = renderPeriod('/progress?period=all');
    expect(period()).toBe('all');
    expect(window.sessionStorage.getItem(PERIOD_STORAGE_KEY)).toBe('all');
    // Replaced, not pushed: «back» does not return to the link.
    expect(memory.history).toEqual(['/progress']);
  });

  it('keeps the other query parameters', () => {
    const { period, memory } = renderPeriod('/progress?period=q&utm=push');
    expect(period()).toBe('q');
    expect(memory.history).toEqual(['/progress?utm=push']);
  });

  it('only removes an invalid ?period=, keeping the remembered period', () => {
    window.sessionStorage.setItem(PERIOD_STORAGE_KEY, 'month');
    const { period, memory } = renderPeriod('/progress?period=year');
    expect(period()).toBe('month');
    expect(window.sessionStorage.getItem(PERIOD_STORAGE_KEY)).toBe('month');
    expect(memory.history).toEqual(['/progress']);
  });

  it('follows a ?period= link opened while the screen is already shown', () => {
    const { hook, period, memory } = renderPeriod('/progress');
    act(() => hook.result.current[1]('month'));
    act(() => memory.navigate('/progress?period=week'));
    expect(period()).toBe('week');
    expect(window.sessionStorage.getItem(PERIOD_STORAGE_KEY)).toBe('week');
    expect(memory.history?.at(-1)).toBe('/progress');
    // The choice after the link is hers again.
    act(() => hook.result.current[1]('q'));
    expect(period()).toBe('q');
  });

  it('still works with storage blocked', () => {
    blockStorage();
    const { hook, period, memory } = renderPeriod('/progress?period=q');
    expect(period()).toBe('q');
    expect(memory.history).toEqual(['/progress']);
    act(() => hook.result.current[1]('all'));
    expect(period()).toBe('all');
  });
});
