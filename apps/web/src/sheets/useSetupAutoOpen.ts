import { useEffect } from 'react';
import { useToday } from '@/lib/useToday';
import { dataActions, useAppData, useSyncState } from '@/store/data';
import { ui, useSheet } from '@/store/ui';
import { readSetupShown, setupGateAction, syncSettled, writeSetupShown } from './setupGate';

/** Offers the first-run setup sheet once per session to a new account (see `setupGateAction`). */
export function useSetupAutoOpen(): void {
  const data = useAppData();
  const settled = syncSettled(useSyncState());
  const sheetOpen = useSheet() !== null;
  const today = useToday();

  useEffect(() => {
    const action = setupGateAction(data, settled, readSetupShown());
    if (action === 'mark-onboarded') {
      dataActions.updateSettings((s) => ({ ...s, onboarded: true }));
    } else if (action === 'open' && !sheetOpen) {
      // Another sheet (e.g. a deep link) goes first; the setup follows when it closes.
      writeSetupShown();
      ui.openSheet(today, 'setup');
    }
  }, [data, settled, sheetOpen, today]);
}
