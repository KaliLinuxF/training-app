import { useSyncExternalStore } from 'react';

/** iPhone/iPad, including iPadOS that reports itself as a Mac. */
export function isIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

/** Running as an installed app (home-screen icon), not in a browser tab. */
export function isStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

/**
 * Desktop shell (sidebar + two columns): wide enough AND a mouse/trackpad. Width alone is not enough —
 * a Plus/Pro Max iPhone in landscape is 932–956px wide but must keep the phone shell (tab bar, bottom sheets).
 * A CSS media query that switches to the desktop layout (ContentGrid) must use the same condition.
 */
export const DESKTOP_QUERY = '(min-width: 900px) and (hover: hover) and (pointer: fine)';

export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (cb) => {
      const mq = window.matchMedia(query);
      mq.addEventListener('change', cb);
      return () => mq.removeEventListener('change', cb);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export const useIsDesktop = (): boolean => useMediaQuery(DESKTOP_QUERY);
