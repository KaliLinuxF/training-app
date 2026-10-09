import { useEffect, useRef, type RefObject } from 'react';
import { ui, type ConfirmOptions } from '@/store/ui';
import { DISCARD_CONFIRM, DISCARD_ON_NAVIGATE_CONFIRM } from './helpers';

export interface SheetGuard {
  /** Put on a hidden element inside the sheet body; used to find the panel. */
  anchor: RefObject<HTMLSpanElement | null>;
  /** `onClose` for <Sheet>: asks before dropping a dirty draft. */
  close: () => void;
  /** ‹ › day navigation: runs `action` right away when the draft is clean, otherwise once she agrees. */
  guard: (action: () => void) => void;
}

/** Runs an action that replaces the open sheet, asking first when its draft is dirty. */
type ReplaceGuard = (action: () => void) => void;

/** The guard of the sheet that is open right now (one at a time; a closing sheet does not count). */
let openSheetGuard: ReplaceGuard | null = null;

/**
 * For code outside the sheet that opens another sheet over it (notification deep links):
 * goes through the open sheet's discard question, or runs `action` at once when nothing is at stake.
 */
export function replaceOpenSheet(action: () => void): void {
  if (openSheetGuard) openSheetGuard(action);
  else action();
}

/**
 * The kit's drag-to-dismiss slides the panel out before calling `onClose`; when she keeps the
 * draft, slide it back (the inline transform is the only thing holding it down).
 */
function restorePanel(anchor: HTMLElement | null): void {
  const panel = anchor?.closest<HTMLElement>('[role="dialog"]');
  if (!panel) return;
  panel.style.transition = '';
  panel.style.transform = '';
}

/**
 * Runs `action` when the draft may go: at once when nothing changed (no extra frame), otherwise
 * once she confirms in the app's dialog; `kept` runs when she chooses to stay.
 */
function whenDiscarded(
  dirty: boolean,
  options: Readonly<ConfirmOptions>,
  action: () => void,
  kept?: () => void,
): void {
  if (!dirty) {
    action();
    return;
  }
  void ui.confirm({ ...options }).then((ok) => (ok ? action() : kept?.()));
}

/**
 * Discard protection for a sheet with a draft: close / Escape / backdrop / drag-down, ‹ › day
 * navigation and deep links (via `replaceOpenSheet`) all ask «Є незбережені зміни» first.
 */
export function useSheetGuard(dirty: boolean, open: boolean): SheetGuard {
  const anchor = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!open) return;
    const guard: ReplaceGuard = (action) => whenDiscarded(dirty, DISCARD_CONFIRM, action);
    openSheetGuard = guard;
    return () => {
      if (openSheetGuard === guard) openSheetGuard = null;
    };
  }, [dirty, open]);

  return {
    anchor,
    close() {
      whenDiscarded(dirty, DISCARD_CONFIRM, ui.closeSheet, () => restorePanel(anchor.current));
    },
    guard(action) {
      whenDiscarded(dirty, DISCARD_ON_NAVIGATE_CONFIRM, action);
    },
  };
}
