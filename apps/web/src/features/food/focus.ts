/**
 * Focus helpers for controls that remove themselves (a deleted chip or photo): focus must not
 * fall to <body>, where the sheet's Tab trap no longer sees it and VoiceOver loses her place.
 */

/** Buttons and links only: focusing a text field would pop up the iPhone keyboard. */
const CONTROLS = 'button:not([disabled]), a[href]';

/** Whether the element can take focus right now (not hidden from the tab order or from AT). */
function usable(el: HTMLElement): boolean {
  return el.tabIndex >= 0 && !el.closest('[aria-hidden="true"], [inert]');
}

/**
 * The nearest button/link before or after `node` (outside it) within its dialog, or the page.
 * Computed before `node` goes away; focus it afterwards with `focusFirst`.
 */
export function neighbourControls(node: Element, direction: 'before' | 'after'): HTMLElement[] {
  const scope = node.closest('[role="dialog"]') ?? node.ownerDocument.body;
  const want = direction === 'after' ? Node.DOCUMENT_POSITION_FOLLOWING : Node.DOCUMENT_POSITION_PRECEDING;
  const found = Array.from(scope.querySelectorAll<HTMLElement>(CONTROLS)).filter(
    (el) => !node.contains(el) && usable(el) && (node.compareDocumentPosition(el) & want) !== 0,
  );
  // Nearest first.
  return direction === 'after' ? found : found.reverse();
}

/** Focuses the first candidate that is still in the document and actually takes focus. */
export function focusFirst(candidates: readonly (HTMLElement | null | undefined)[]): boolean {
  for (const el of candidates) {
    if (!el?.isConnected) continue;
    el.focus();
    if (el.ownerDocument.activeElement === el) return true;
  }
  return false;
}

/**
 * Whether focus is somewhere that a change inside `root` may take it from: inside `root`,
 * on an ancestor of it (Safari focuses the dialog panel, not the tapped button), or lost to <body>.
 * Focus in any other control means she is working elsewhere — leave it there.
 */
export function focusIsAround(root: HTMLElement): boolean {
  const active = root.ownerDocument.activeElement;
  if (!active || active === root.ownerDocument.body) return true;
  return active.contains(root) || root.contains(active);
}
