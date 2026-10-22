import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backLabel, backTarget } from './backTarget';
import { clockText, elapsedText, exercisesText, plural, recordsText, setsText, weekdaysText } from './copy';
import { clearDraft, logDraftKey, readDraft, sessionDraftKey, workoutDraftKey, writeDraft } from './drafts';
import { historyGroups, workoutsList } from './listModel';
import { fitField, parseField, stepField } from './setFields';
import { LEGS, NOW, TODAY, doneLegs, session, trainingData } from './testing';
import { useWakeLock } from './useWakeLock';

describe('copy', () => {
  it('Ukrainian plurals', () => {
    expect([1, 2, 5, 11, 12, 21, 22, 25, 111].map((n) => plural(n, 'a', 'b', 'c'))).toEqual([
      'a',
      'b',
      'c',
      'c',
      'c',
      'a',
      'b',
      'c',
      'c',
    ]);
    expect(exercisesText(4)).toBe('4 вправи');
    expect(setsText(13)).toBe('13 підходів');
    expect(recordsText(12)).toBe('12 записів');
    expect(recordsText(1)).toBe('1 запис');
  });

  it('weekdays Monday-first, clocks', () => {
    expect(weekdaysText([3, 1])).toBe('Пн, Ср');
    expect(weekdaysText([0, 5])).toBe('Пт, Нд');
    expect(weekdaysText([])).toBe('');
    expect(clockText(90)).toBe('1:30');
    expect(clockText(5)).toBe('0:05');
    expect(elapsedText(23 * 60 + 41)).toBe('23:41');
    expect(elapsedText(3909)).toBe('1:05:09');
    expect(elapsedText(-5)).toBe('0:00');
  });
});

describe('set fields', () => {
  it('kg in 0,25, minutes in 0,5, km in 0,01, bounds; typed text with a comma', () => {
    expect(fitField('kg', 42.6)).toBe(42.5);
    expect(fitField('kg', 2000)).toBe(1000);
    expect(fitField('min', 20.3)).toBe(20.5);
    expect(fitField('km', 3.256)).toBe(3.26);
    expect(fitField('reps', 7.6)).toBe(8);
    expect(stepField('kg', 40, 2.5)).toBe(42.5);
    expect(stepField('kg', null, 2.5)).toBe(2.5);
    expect(stepField('reps', 0, -1)).toBe(0);
    expect(stepField('km', 0.2, 0.1)).toBe(0.3);
    expect(parseField('kg', '42,5')).toBe(42.5);
    expect(parseField('kg', '')).toBeNull();
    expect(parseField('kg', 'abc')).toBeUndefined();
  });
});

describe('drafts', () => {
  beforeEach(() => localStorage.clear());

  it('keys: workout (id | new), past-day log (date + workout | free), session', () => {
    expect(workoutDraftKey(null)).toBe('legko.draft.workout.new');
    expect(workoutDraftKey('abc')).toBe('legko.draft.workout.abc');
    expect(logDraftKey('2026-10-12', null)).toBe('legko.draft.log.2026-10-12.free');
    expect(logDraftKey('2026-10-12', 'w1')).toBe('legko.draft.log.2026-10-12.w1');
    expect(sessionDraftKey('s1')).toBe('legko.draft.session.s1');
  });

  it('round-trips through the parser; a broken or refused entry is removed', () => {
    writeDraft('k', { a: 1 });
    expect(readDraft('k', (v) => v as { a: number })).toEqual({ a: 1 });
    expect(readDraft('k', () => null)).toBeNull();
    expect(localStorage.getItem('k')).toBeNull();
    localStorage.setItem('k', '{not json');
    expect(readDraft('k', (v) => v)).toBeNull();
    expect(localStorage.getItem('k')).toBeNull();
    clearDraft('k');
  });

  it('works without storage (private mode): nothing is thrown', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('denied');
    });
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('denied');
    });
    expect(() => writeDraft('k', 1)).not.toThrow();
    expect(readDraft('k', (v) => v)).toBeNull();
    get.mockRestore();
    set.mockRestore();
  });
});

describe('back target', () => {
  it('the page in history.state, else the fallback; labels by page', () => {
    expect(backTarget({ legkoFrom: '/calendar' }, '/')).toEqual({ href: '/calendar', label: 'Календар' });
    expect(backTarget(null, '/')).toEqual({ href: '/', label: 'Головна' });
    expect(backTarget({ legkoFrom: '/workouts/session/x' }, '/', ['/workouts/session/'])).toEqual({
      href: '/',
      label: 'Головна',
    });
    expect(backTarget({ legkoFrom: '//evil.example' }, '/workouts').href).toBe('/workouts');
    expect(backLabel('/workouts')).toBe('Мої тренування');
    expect(backLabel('/workouts/history')).toBe('Історія');
    expect(backLabel('/settings/workouts')).toBe('Налаштування');
  });
});

describe('lists', () => {
  it('«Мої тренування»: days + count, today’s pill, the live one, stale ones, the done count', () => {
    const data = trainingData();
    const live = session({ startedAt: NOW - 12 * 60_000 });
    const stale = session({
      id: 'sessionStale001',
      date: '2026-10-12',
      startedAt: NOW - 2 * 86_400_000,
      workoutId: null,
      name: 'Вільне тренування',
    });
    data.sessions.push(live, stale);
    const list = workoutsList(data, TODAY, NOW);
    expect(list.rows).toEqual([
      { id: LEGS.id, name: 'Ноги + прес', sub: 'Пн, Ср · 2 вправи', today: true, live: true },
      { id: 'workoutUpper001', name: 'Верх тіла', sub: 'Пт · 1 вправа', today: false, live: false },
    ]);
    expect(list.live?.title.replace(/\s/g, ' ')).toBe('Тренування триває · Ноги + прес · 12 хв');
    expect(list.liveSessionId).toBe(live.id);
    expect(list.stale).toEqual([{ sessionId: 'sessionStale001', title: '12 жовтня · Вільне тренування' }]);
    expect(list.doneCount).toBe(1);
  });

  it('history: done sessions by month, newest first, with duration, sets and kcal', () => {
    const data = trainingData();
    data.sessions.push(
      doneLegs({
        id: 'sessionSept001',
        date: '2026-09-30',
        createdAt: NOW - 20 * 86_400_000,
        durationSec: null,
      }),
    );
    const groups = historyGroups(data);
    expect(groups.map((g) => g.month)).toEqual(['Жовтень 2026', 'Вересень 2026']);
    expect(groups[0]!.rows[0]!.title).toBe('12 жовтня · Ноги + прес');
    expect(groups[0]!.rows[0]!.sub.replace(/\s/g, ' ')).toMatch(/^48 хв · 5 підходів · ≈ \d+ ккал$/);
    expect(groups[1]!.rows[0]!.sub.replace(/\s/g, ' ')).toMatch(/^5 підходів · ≈ \d+ ккал$/);
    expect(groups[0]!.rows[0]!.label).toMatch(/близько \d+ ккал$/);
  });
});

function WakeLock({ on }: { on: boolean }) {
  useWakeLock(on);
  return null;
}

describe('useWakeLock', () => {
  afterEach(() => {
    cleanup();
    Reflect.deleteProperty(navigator, 'wakeLock');
  });

  it('requests the screen lock while enabled, again when the app is visible, releases on unmount', async () => {
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => Promise.resolve({ release }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const view = render(<WakeLock on />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledWith('screen'));
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    await vi.waitFor(() => expect(release).toHaveBeenCalledTimes(1));
    view.unmount();
    expect(release).toHaveBeenCalledTimes(2);
  });

  it('does nothing when disabled, unsupported or refused', async () => {
    const view = render(<WakeLock on />);
    view.unmount();
    const request = vi.fn(() => Promise.reject(new Error('NotAllowedError')));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    render(<WakeLock on={false} />);
    expect(request).not.toHaveBeenCalled();
    cleanup();
    render(<WakeLock on />);
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
  });
});
