import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClock } from '@/sheets/useClock';
import { RestTimer } from './RestTimer';
import {
  REST_FORGET_MS,
  REST_OVER_ANNOUNCEMENT,
  adjustRest,
  clearRestEnd,
  readRestEnd,
  restKey,
  restText,
  restView,
  writeRestEnd,
} from './restModel';
import { spoken } from './copy';

describe('rest maths', () => {
  it('counts down in whole seconds (rounded up), then counts up after the end', () => {
    expect(restView(10_000, 0)).toEqual({ phase: 'counting', remainingSec: 10 });
    expect(restView(10_000, 9_001)).toEqual({ phase: 'counting', remainingSec: 1 });
    expect(restView(10_000, 10_000)).toEqual({ phase: 'over', overSec: 0 });
    expect(restView(10_000, 33_400)).toEqual({ phase: 'over', overSec: 23 });
    expect(restText({ phase: 'counting', remainingSec: 72 })).toBe('Відпочинок 1:12');
    expect(restText({ phase: 'over', overSec: 23 })).toBe('Відпочинок завершено · +0:23');
  });

  it('−15 / +15 never end before now', () => {
    expect(adjustRest(50_000, 40_000, 15)).toBe(65_000);
    expect(adjustRest(50_000, 40_000, -15)).toBe(40_000);
  });

  it('keeps restEndsAt in localStorage per session; an old one is forgotten; storage errors are swallowed', () => {
    localStorage.clear();
    writeRestEnd('sessionA', 123_456);
    expect(localStorage.getItem(restKey('sessionA'))).toBe('123456');
    expect(readRestEnd('sessionA', 100_000)).toBe(123_456);
    expect(readRestEnd('sessionA', 123_456 + REST_FORGET_MS + 1)).toBeNull();
    expect(readRestEnd('sessionB', 0)).toBeNull();
    clearRestEnd('sessionA');
    expect(localStorage.getItem(restKey('sessionA'))).toBeNull();
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(readRestEnd('sessionA', 0)).toBeNull();
    spy.mockRestore();
  });
});

/** The bar driven by a real 1 s clock, as on the session screen. */
function Harness({ initial }: { initial: number }) {
  const now = useClock(true, 1000);
  const [endsAt, setEndsAt] = useState<number | null>(initial);
  if (endsAt === null) return <p>без відпочинку</p>;
  return (
    <RestTimer
      endsAt={endsAt}
      now={now}
      onAdjust={(d) => setEndsAt(adjustRest(endsAt, Date.now(), d))}
      onSkip={() => setEndsAt(null)}
      onHide={() => setEndsAt(null)}
    />
  );
}

const timerText = () => spoken(screen.getByRole('timer').textContent ?? '');

describe('RestTimer (fake timers)', () => {
  let vibrate: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-14T10:00:00'));
    vibrate = vi.fn(() => true);
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  const tick = (ms: number) => act(() => vi.advanceTimersByTime(ms));

  it('counts down, then vibrates once, announces once and stays — mint — counting up until «Сховати»', () => {
    render(<Harness initial={Date.now() + 5_000} />);
    tick(0);
    expect(timerText()).toBe('Відпочинок 0:05');
    expect(screen.getByRole('button', { name: 'Пропустити' })).toBeTruthy();
    tick(2_000);
    expect(timerText()).toBe('Відпочинок 0:03');
    expect(vibrate).not.toHaveBeenCalled();
    tick(3_000);
    expect(timerText()).toBe('Відпочинок завершено · +0:00');
    expect(vibrate).toHaveBeenCalledExactlyOnceWith([200, 100, 200]);
    expect(screen.getByText(REST_OVER_ANNOUNCEMENT)).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Відпочинок' }).className).toMatch(/over/);
    tick(23_000);
    expect(timerText()).toBe('Відпочинок завершено · +0:23');
    expect(vibrate).toHaveBeenCalledOnce();
    expect(screen.queryByRole('button', { name: 'Пропустити' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Сховати' }));
    expect(screen.getByText('без відпочинку')).toBeTruthy();
  });

  it('−15 с / +15 с adjust the countdown; «Пропустити» drops it', () => {
    render(<Harness initial={Date.now() + 60_000} />);
    tick(0);
    fireEvent.click(screen.getByRole('button', { name: 'Відпочинок: плюс 15 секунд' }));
    tick(1_000);
    expect(timerText()).toBe('Відпочинок 1:14');
    fireEvent.click(screen.getByRole('button', { name: 'Відпочинок: мінус 15 секунд' }));
    tick(1_000);
    expect(timerText()).toBe('Відпочинок 0:58');
    fireEvent.click(screen.getByRole('button', { name: 'Пропустити' }));
    expect(screen.getByText('без відпочинку')).toBeTruthy();
  });

  it('recomputes from the clock when the app comes back (a frozen background timer catches up)', () => {
    render(<Harness initial={Date.now() + 90_000} />);
    tick(0);
    // iOS freezes intervals in the background: move the clock without running them, then become visible.
    vi.setSystemTime(Date.now() + 60_000);
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
    });
    expect(timerText()).toBe('Відпочинок 0:30');
  });

  it('a bar that is already over when shown (after a reload) does not vibrate again', () => {
    render(<Harness initial={Date.now() - 10_000} />);
    tick(2_000);
    expect(timerText()).toBe('Відпочинок завершено · +0:12');
    expect(vibrate).not.toHaveBeenCalled();
  });
});
