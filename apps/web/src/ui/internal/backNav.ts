import { useLocation } from 'wouter';

/**
 * In-app «back» for sub-pages (Settings sections). A `ListRow href` stamps the page it was opened from into
 * `history.state` (`{ legkoFrom: '/settings' }`); the sub-page's back link then pops that entry with
 * `history.back()`, so the history does not grow (the shell still scrolls to the top on every route change, popstate
 * included). Without the stamp (deep link, reload, a bookmark) it replace-navigates to the parent instead. Use flat
 * absolute routes (no wouter `nest`).
 */
export const BACK_STATE_KEY = 'legkoFrom';

/** `history.state` for a navigation that started on `from` (the key is `BACK_STATE_KEY`). */
export function backState(from: string): { legkoFrom: string } {
  return { legkoFrom: from };
}

/** True only when `state` (usually `window.history.state`) says the page was opened from `parent`. */
export function cameFrom(state: unknown, parent: string): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    (state as Record<string, unknown>)[BACK_STATE_KEY] === parent
  );
}

/**
 * Click handler for a back control to the absolute path `parent`: cancels the link's own navigation, then
 * `history.back()` when the current entry was opened from `parent`, else `navigate(parent, { replace: true })`.
 * Call it at the top level of a component (it is a hook), never inside the event handler.
 */
export function useBackTo(parent: string): (e?: { preventDefault(): void }) => void {
  const [, navigate] = useLocation();
  return (e) => {
    e?.preventDefault();
    if (cameFrom(window.history.state, parent)) window.history.back();
    else navigate(parent, { replace: true });
  };
}
