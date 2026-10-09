import { useState } from 'react';
import { flushSync } from 'react-dom';
import { authActions } from '@/auth/auth';
import { ui, useConfirm } from '@/store/ui';
import { ListRow } from '@/ui';

export const LOGOUT_FAILED = 'Не вдалося вийти. Спробуй ще раз';

/**
 * «Вийти» row of the settings list (render it inside its own `ListGroup`). `authActions.logout()` asks first in the
 * app's dialog (`LOGOUT_CONFIRM`, or the warning about unsynced changes), never with `window.confirm`.
 *
 * The row stays disabled from the tap until the logout settles. When she cancels (or it fails), the dialog hands the
 * focus back while the row is still disabled, so it lands on <body>: the row takes it back itself once enabled.
 */
export function LogoutRow() {
  const [leaving, setLeaving] = useState(false);
  // Not «Виходжу…» while she is still deciding in the dialog.
  const asking = useConfirm() !== null;

  const onLogout = () => {
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setLeaving(true);
    authActions
      .logout()
      .catch(() => {
        ui.flash(LOGOUT_FAILED, 3200);
        return false;
      })
      .then((left) => {
        // Enabled right now (not on the next render), so the focus below can land. After a real logout the row is
        // already gone with the app shell and this is a no-op.
        flushSync(() => setLeaving(false));
        const lost = document.activeElement === null || document.activeElement === document.body;
        if (!left && lost && opener && opener !== document.body && opener.isConnected) opener.focus();
      });
  };

  return (
    <ListRow
      onClick={onLogout}
      title={leaving && !asking ? 'Виходжу…' : 'Вийти'}
      titleTone="accent"
      icon="logout"
      iconTone="neutral"
      chevron={false}
      disabled={leaving}
    />
  );
}
