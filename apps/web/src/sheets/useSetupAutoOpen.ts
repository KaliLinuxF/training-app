import { useEffect } from 'react';
import { useToday } from '@/lib/useToday';
import { dataActions, useAppData, useSyncState } from '@/store/data';
import { ui, useSheet, useUiStore } from '@/store/ui';
import { readSetupShown, setupGateAction, syncSettled, writeSetupShown } from './setupGate';

/** Offers the first-run setup sheet once per session to a new account (see `setupGateAction`). */
export function useSetupAutoOpen(): void {
  const data = useAppData();
  const settled = syncSettled(useSyncState());
  // Re-runs the effect when a sheet closes, so the setup can follow it.
  const sheetOpen = useSheet() !== null;
  const today = useToday();

  useEffect(() => {
    const action = setupGateAction(data, settled, readSetupShown());
    if (action === 'mark-onboarded') {
      dataActions.updateSettings((s) => ({ ...s, onboarded: true }));
    } else if (action === 'open' && useUiStore.getState().sheet === null) {
      // Another sheet (e.g. a deep link) goes first; the setup follows when it closes. The live
      // store is read, not `sheetOpen`: a deep link opened earlier in this same commit is not in it.
      writeSetupShown();
      ui.openSheet(today, 'setup');
    }
  }, [data, settled, sheetOpen, today]);
}
