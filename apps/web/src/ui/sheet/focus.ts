import type { KeyboardEvent } from 'react';

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

export function focusableIn(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE));
}

/** The focused element, if it is an HTML element (the opener a sheet gives focus back to). */
export function focusedElement(): HTMLElement | null {
  return document.activeElement instanceof HTMLElement ? document.activeElement : null;
}

/** An element focus can usefully go back to: still in the document, and not <body>. */
export function isFocusTarget(el: HTMLElement | null): el is HTMLElement {
  return el !== null && el !== document.body && el.isConnected;
}

/**
 * Focus is inside `panel` (even a detached one), or nowhere in particular (<body>, or an element that
 * was just removed): the sheet may still move it. Not when another dialog or element has taken it.
 */
export function holdsFocus(panel: HTMLElement | null): boolean {
  const active = document.activeElement;
  if (!active || active === document.body || !active.isConnected) return true;
  return panel?.contains(active) ?? false;
}

/**
 * Keeps Tab / Shift+Tab cycling inside `event.currentTarget` (the dialog panel). Keys from a sheet
 * stacked over this one reach it too (React events bubble through portals) and are left alone.
 */
export function trapTabKey(event: KeyboardEvent<HTMLElement>): void {
  if (event.key !== 'Tab') return;
  const root = event.currentTarget;
  if (!(event.target instanceof Node) || !root.contains(event.target)) return;
  const items = focusableIn(root);
  const first = items[0];
  const last = items.at(-1);
  if (!first || !last) {
    event.preventDefault();
    return;
  }
  const active = document.activeElement;
  if (event.shiftKey && (active === first || active === root)) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && active === last) {
    event.preventDefault();
    first.focus();
  }
}
