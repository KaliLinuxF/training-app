import { useEffect } from 'react';
import { clearSyncError, useSyncState } from '@/store/data';
import { ui } from '@/store/ui';

/** Surfaces data-sync problems as a toast once, then clears them. Renders nothing. */
export function SyncWatcher() {
  const { error } = useSyncState();
  useEffect(() => {
    if (!error) return;
    ui.flash(error, 3200);
    clearSyncError();
  }, [error]);
  return null;
}
