import { useSheet } from '@/store/ui';
import { useRetained } from '@/ui';
import { InstallSheet } from './install/InstallSheet';
import { isCaptureMode } from './record/model';
import { RecordSheet } from './record/RecordSheet';
import { SetupSheet } from './setup/SetupSheet';
import { useSetupAutoOpen } from './useSetupAutoOpen';
import { useSheetDeepLinks } from './useSheetDeepLinks';

/**
 * Renders the open sheet (the «+» menu and the record forms / setup / install), rendered once by
 * the shell. Also handles `?sheet=…` deep links and offers the first-run setup to a new account.
 */
export function SheetHost() {
  const sheet = useSheet();
  // Keeps the last sheet rendered while it animates out after `ui.closeSheet()`.
  const shown = useRetained(sheet);
  useSheetDeepLinks();
  useSetupAutoOpen();

  if (!shown) return null;
  const open = sheet !== null;
  const { mode } = shown;
  // Never key RecordSheet by mode: the menu swaps to a form inside the same, still mounted dialog.
  if (isCaptureMode(mode)) return <RecordSheet state={{ ...shown, mode }} open={open} />;
  if (mode === 'setup') return <SetupSheet state={shown} open={open} />;
  return <InstallSheet open={open} />;
}
