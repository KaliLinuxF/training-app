/**
 * Rest timer state (docs/workouts-steps-rebrand.md §3.10): only `restEndsAt` (epoch ms) is kept, in component state
 * and in `localStorage['legko.rest.<sessionId>']` — iOS may kill the backgrounded app, and sessionStorage would go
 * with it. What the bar shows is recomputed from the clock on every tick and when the app comes back.
 */
import { clockText } from './copy';

/** The wall clock (event handlers only; renders use the screen's ticking `now`). */
export const clockNow = (): number => Date.now();

export const restKey = (sessionId: string): string => `legko.rest.${sessionId}`;

/** A rest that ended this long ago is not shown again after a reload. */
export const REST_FORGET_MS = 30 * 60_000;

export function readRestEnd(sessionId: string, now: number): number | null {
  try {
    const raw = localStorage.getItem(restKey(sessionId));
    const endsAt = raw === null ? NaN : Number(raw);
    if (!Number.isFinite(endsAt)) return null;
    return now - endsAt > REST_FORGET_MS ? null : endsAt;
  } catch {
    return null;
  }
}

export function writeRestEnd(sessionId: string, endsAt: number): void {
  try {
    localStorage.setItem(restKey(sessionId), String(Math.round(endsAt)));
  } catch {
    // Storage unavailable: the timer lives on screen only.
  }
}

export function clearRestEnd(sessionId: string): void {
  try {
    localStorage.removeItem(restKey(sessionId));
  } catch {
    // nothing stored
  }
}

export type RestView = { phase: 'counting'; remainingSec: number } | { phase: 'over'; overSec: number };

/** Counting down (whole seconds left, rounded up) or over (whole seconds since it ended). */
export function restView(endsAt: number, now: number): RestView {
  const ms = endsAt - now;
  if (ms > 0) return { phase: 'counting', remainingSec: Math.ceil(ms / 1000) };
  return { phase: 'over', overSec: Math.floor((now - endsAt) / 1000) };
}

/** «−15 с» / «+15 с»: never before now. */
export const adjustRest = (endsAt: number, now: number, deltaSec: number): number =>
  Math.max(now, endsAt + deltaSec * 1000);

/** «Відпочинок 1:12» / «Відпочинок завершено · +0:23». */
export function restText(view: RestView): string {
  return view.phase === 'counting'
    ? `Відпочинок ${clockText(view.remainingSec)}`
    : `Відпочинок завершено · +${clockText(view.overSec)}`;
}

/** Announced once, politely, when the rest is over. */
export const REST_OVER_ANNOUNCEMENT = 'Час! Наступний підхід';

/** Vibration pattern at the end of a rest (a no-op on iOS). */
export const REST_VIBRATION = [200, 100, 200];
