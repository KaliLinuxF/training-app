import type { ISODate } from '@legko/shared';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAppData, useSyncState } from '@/store/data';
import { buildHomeModel, type HomeModel } from './homeModel';
import { rememberInstallHintDismissed, shouldShowInstallHint } from './installHint';

/**
 * The current time as a value that only changes when the hour does (checked every minute and
 * when the app returns to the foreground), so the greeting turns from «ранку» to «дня» on its own.
 */
export function useHourlyNow(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const update = () =>
      setNow((prev) => {
        const next = new Date();
        return next.getHours() === prev.getHours() && next.toDateString() === prev.toDateString()
          ? prev
          : next;
      });
    const iv = setInterval(update, 60_000);
    document.addEventListener('visibilitychange', update);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(iv);
      document.removeEventListener('visibilitychange', update);
      window.removeEventListener('focus', update);
    };
  }, []);
  return now;
}

export interface InstallHint {
  visible: boolean;
  dismiss: () => void;
}

/** «Встанови Легко на iPhone» banner state; dismissing it is remembered on the device. */
export function useInstallHint(): InstallHint {
  const [visible, setVisible] = useState(shouldShowInstallHint);
  const dismiss = useCallback(() => {
    rememberInstallHintDismissed();
    setVisible(false);
  }, []);
  return { visible, dismiss };
}

export interface HomeView {
  model: HomeModel;
  dismissInstallHint: () => void;
}

export function useHomeModel(today: ISODate): HomeView {
  const data = useAppData();
  const { online } = useSyncState();
  const now = useHourlyNow();
  const installHint = useInstallHint();
  const showInstallHint = installHint.visible;
  const model = useMemo(
    () => buildHomeModel(data, today, { now, online, showInstallHint }),
    [data, today, now, online, showInstallHint],
  );
  return { model, dismissInstallHint: installHint.dismiss };
}
