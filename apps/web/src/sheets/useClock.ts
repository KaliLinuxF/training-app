import { useEffect, useState } from 'react';

/**
 * The current time in ms, refreshed every `intervalMs` while `enabled` (and when the app returns to the foreground),
 * for the «Триває · 12 хв» of a live workout on Home and in the «Тренування» sheet. Disabled, it stays at the time of
 * the last render that enabled it, so nothing re-renders for nothing.
 */
export function useClock(enabled: boolean, intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!enabled) return;
    const tick = () => setNow(Date.now());
    // Catch up at once (the value may be from long ago), outside the effect body.
    const first = setTimeout(tick, 0);
    const iv = setInterval(tick, intervalMs);
    document.addEventListener('visibilitychange', tick);
    return () => {
      clearTimeout(first);
      clearInterval(iv);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [enabled, intervalMs]);
  return now;
}
