/**
 * Unsaved drafts of the builder and the edit / past-day screens (docs/workouts-steps-rebrand.md §3.6, §3.12).
 * wouter has no navigation blocker (the tab bar, the sidebar, iOS edge swipe and history.back bypass any in-screen
 * question), so every change is kept in localStorage and offered back on the next visit instead.
 * Storage may be missing or full (private mode, blocked site data): every access is in a try/catch and the screens
 * work without it.
 */
import type { ISODate } from '@legko/shared';

export const workoutDraftKey = (id: string | null): string => `legko.draft.workout.${id ?? 'new'}`;
export const logDraftKey = (date: ISODate, workoutId: string | null): string =>
  `legko.draft.log.${date}.${workoutId ?? 'free'}`;
export const sessionDraftKey = (id: string): string => `legko.draft.session.${id}`;

const VERSION = 1;

/** The stored value when it is there and `parse` accepts it; null otherwise (a broken entry is removed). */
export function readDraft<T>(key: string, parse: (value: unknown) => T | null): T | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(key);
  } catch {
    return null;
  }
  if (raw === null) return null;
  try {
    const stored = JSON.parse(raw) as unknown;
    if (typeof stored === 'object' && stored !== null && (stored as { v?: unknown }).v === VERSION) {
      const value = parse((stored as { value?: unknown }).value);
      if (value !== null) return value;
    }
  } catch {
    // fall through: not JSON
  }
  clearDraft(key);
  return null;
}

export function writeDraft(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify({ v: VERSION, value }));
  } catch {
    // Storage unavailable or full: the draft only lives on screen.
  }
}

export function clearDraft(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to clear
  }
}
