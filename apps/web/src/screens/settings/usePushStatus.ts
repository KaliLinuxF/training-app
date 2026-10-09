import { useCallback, useEffect, useRef, useState } from 'react';
import { getPushStatus, type PushStatus } from '@/lib/push';

export interface PushStatusState {
  /** `null` until the first check finishes. */
  status: PushStatus | null;
  /** Sets a known status (e.g. the result of `enablePush`), superseding checks in flight. */
  setStatus: (status: PushStatus) => void;
  /** Re-reads the status from the browser. */
  refresh: () => void;
}

/**
 * This device's push status. Re-checked whenever the app comes back to the foreground: the user
 * may have changed the permission in Settings or added the app to the home screen meanwhile.
 * Called once by SettingsScreen and passed down, so the list's «Нагадування» badge and the
 * NotificationsCard (side by side on desktop) always show the same state.
 */
export function usePushStatus(): PushStatusState {
  const [status, setStatusState] = useState<PushStatus | null>(null);
  // Only the newest check (or explicit set) may write: an older, slower check must not win.
  const seq = useRef(0);

  const refresh = useCallback(() => {
    const id = ++seq.current;
    getPushStatus().then(
      (next) => {
        if (id === seq.current) setStatusState(next);
      },
      () => {
        if (id === seq.current) setStatusState('unsupported');
      },
    );
  }, []);

  const setStatus = useCallback((next: PushStatus) => {
    seq.current += 1;
    setStatusState(next);
  }, []);

  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [refresh]);

  return { status, setStatus, refresh };
}
