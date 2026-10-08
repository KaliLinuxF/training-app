import { useEffect, useState } from 'react';
import { useToast, type ToastState } from '@/store/ui';
import { cx } from '../internal/cx';
import s from './Toast.module.css';

const EXIT_MS = 180;

/**
 * Confirmation pill at the top centre («Збережено»), driven by `ui.flash(text)`.
 * Rendered once by the app shell. The live region stays mounted so screen readers announce changes.
 */
export function Toast() {
  const toast = useToast();
  // Keep the last toast on screen while it animates out.
  const [shown, setShown] = useState<ToastState | null>(toast);
  if (toast !== null && toast !== shown) setShown(toast);
  const leaving = toast === null && shown !== null;

  useEffect(() => {
    if (!leaving) return;
    const timer = setTimeout(() => setShown(null), EXIT_MS);
    return () => clearTimeout(timer);
  }, [leaving]);

  return (
    <div className={s.region} role="status" aria-live="polite" aria-atomic="true">
      {shown && (
        <div key={shown.key} className={cx(s.toast, leaving && s.leaving)}>
          {shown.text}
        </div>
      )}
    </div>
  );
}
