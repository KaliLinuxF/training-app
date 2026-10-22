import { useEffect } from 'react';

interface Sentinel {
  release(): Promise<void>;
}
interface WakeLockApi {
  request(type: 'screen'): Promise<Sentinel>;
}

/**
 * Keeps the screen on while `enabled` (a live session, §3.9): `navigator.wakeLock.request('screen')`, again whenever
 * the app comes back to the foreground (the browser drops the lock when hidden), released on unmount / when disabled.
 * Silently nothing where unsupported or refused (no copy about it).
 */
export function useWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let sentinel: Sentinel | null = null;
    let disposed = false;

    const release = (s: Sentinel | null) => {
      if (!s) return;
      try {
        void s.release().catch(() => undefined);
      } catch {
        // already released
      }
    };

    const request = async () => {
      const api = (navigator as Navigator & { wakeLock?: WakeLockApi }).wakeLock;
      if (!api) return;
      try {
        const next = await api.request('screen');
        if (disposed) {
          release(next);
          return;
        }
        release(sentinel);
        sentinel = next;
      } catch {
        // Refused (low battery, not visible): try again on the next visibilitychange.
      }
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') void request();
    };

    void request();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      disposed = true;
      document.removeEventListener('visibilitychange', onVisibility);
      release(sentinel);
      sentinel = null;
    };
  }, [enabled]);
}
