import { vi } from 'vitest';

/** Test-only helpers. Not imported by app code. */

/** jsdom has no `matchMedia`; every query reports `matches(query)`. */
export function installMatchMedia(matches: (query: string) => boolean = () => false): void {
  window.matchMedia = (query: string): MediaQueryList => ({
    matches: matches(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  });
}

/** jsdom only logs «not implemented» for `scrollTo`; replace it with a spy. Undo with `vi.restoreAllMocks()`. */
export function stubScrollTo() {
  return vi.spyOn(window, 'scrollTo').mockImplementation(() => undefined);
}
