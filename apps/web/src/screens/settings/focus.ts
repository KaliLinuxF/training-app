/**
 * Keeping the place on the page (WCAG 2.4.3) in «Акаунт» and «Користувачі» after an action whose control had the
 * focus and then lost it: a button disabled while it works («Змінюю…», «Зберегти ліміти» once nothing is left to
 * save), a row the reload removed (a revoked invite), a sheet that closed over a deleted account. Browsers drop the
 * focus to <body> then, and keyboard and screen-reader users would start again from the top of the page.
 */
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Where the focus may go: an element, a ref, an element id, or a lookup run after the render. `null` / `undefined`
 * (or a lookup that finds nothing) is skipped.
 */
export type FocusCandidate =
  | HTMLElement
  | RefObject<HTMLElement | null>
  | string
  | (() => HTMLElement | null | undefined)
  | null
  | undefined;

function resolve(candidate: FocusCandidate): HTMLElement | null {
  if (candidate == null) return null;
  if (typeof candidate === 'string') return document.getElementById(candidate);
  if (typeof candidate === 'function') return candidate() ?? null;
  if (candidate instanceof HTMLElement) return candidate;
  return candidate.current;
}

/** In the document, not disabled (also through a disabled fieldset), not inside an inert part, not <body>. */
export function canTakeFocus(el: HTMLElement): boolean {
  return (
    el.isConnected &&
    el !== document.body &&
    el !== document.documentElement &&
    !el.matches(':disabled') &&
    el.closest('[inert]') === null
  );
}

/**
 * Focuses the first candidate that can take it and returns it (null: none could). A heading or another element that
 * is not focusable by itself becomes focusable for scripts only (`tabindex="-1"`): never a Tab stop.
 */
export function focusFirst(candidates: readonly FocusCandidate[]): HTMLElement | null {
  for (const candidate of candidates) {
    const el = resolve(candidate);
    if (!el || !canTakeFocus(el)) continue;
    if (el.tabIndex < 0 && !el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
    el.focus();
    if (document.activeElement === el) return el;
  }
  return null;
}

/** The focus has no place: on <body>, on an element that was removed, or on one that is now disabled. */
export function focusIsLost(): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body || !active.isConnected) return true;
  return active.matches(':disabled');
}

/** The focused element (not <body>): the control an action was started from. */
export function focusedControl(): HTMLElement | null {
  const active = document.activeElement;
  return active instanceof HTMLElement && active !== document.body ? active : null;
}

export interface RefocusOptions {
  /**
   * Move the focus even when it is not lost — it sits in a sheet that is closing (and would go back to an opener
   * that is gone).
   */
  always?: boolean;
}

export type Refocus = (candidates: readonly FocusCandidate[], options?: RefocusOptions) => void;

/**
 * `refocus(candidates)`: once the next render is on screen (the reload's rows, the re-enabled button), focus the
 * first candidate that can take it. Only when the focus is lost (see `focusIsLost`): it never pulls the focus away
 * from where the person has moved on to meanwhile. Call it from the component that outlives the change (the page
 * for a row that goes away).
 */
export function useRefocus(): Refocus {
  const pending = useRef<{ candidates: readonly FocusCandidate[]; always: boolean } | null>(null);
  const [request, setRequest] = useState(0);

  useEffect(() => {
    const next = pending.current;
    if (next === null) return;
    pending.current = null;
    if (next.always || focusIsLost()) focusFirst(next.candidates);
  }, [request]);

  return useCallback<Refocus>((candidates, options = {}) => {
    pending.current = { candidates, always: options.always ?? false };
    setRequest((n) => n + 1);
  }, []);
}
