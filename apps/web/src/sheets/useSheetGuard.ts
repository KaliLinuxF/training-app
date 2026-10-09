import { useRef, type RefObject } from 'react';
import { ui } from '@/store/ui';
import { confirmDiscard } from './helpers';

export interface SheetGuard {
  /** Put on a hidden element inside the sheet body; used to find the panel. */
  anchor: RefObject<HTMLSpanElement | null>;
  /** `onClose` for <Sheet>: asks before dropping a dirty draft. */
  close: () => void;
  /** Runs `action` (e.g. day navigation) only if the draft is clean or she agreed to drop it. */
  guard: (action: () => void) => void;
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

export function useSheetGuard(dirty: boolean): SheetGuard {
  const anchor = useRef<HTMLSpanElement>(null);
  return {
    anchor,
    close() {
      if (confirmDiscard(dirty)) ui.closeSheet();
      else restorePanel(anchor.current);
    },
    guard(action) {
      if (confirmDiscard(dirty)) action();
    },
  };
}
