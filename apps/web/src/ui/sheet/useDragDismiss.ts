import { useEffect, useRef, type PointerEvent, type RefObject } from 'react';

interface DragState {
  pointerId: number;
  startY: number;
  lastY: number;
  lastTime: number;
  /** px/ms, positive = downwards. */
  velocity: number;
}

/** Dismiss when dragged further than this share of the panel height (capped at 140px)… */
const DISTANCE_RATIO = 0.25;
const MAX_DISTANCE = 140;
/** …or flicked down faster than this. */
const FLICK_VELOCITY = 0.5;
const MIN_FLICK_DISTANCE = 24;

export interface DragHandlers {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: (e: PointerEvent<HTMLElement>) => void;
}

function setOffset(panel: HTMLElement | null, y: number | null): void {
  if (!panel) return;
  if (y === null) {
    panel.style.transition = '';
    panel.style.transform = '';
  } else {
    panel.style.transition = 'none';
    panel.style.transform = `translateY(${y}px)`;
  }
}

/**
 * Touch drag-down-to-dismiss for a bottom sheet. Spread the handlers on the drag area (handle + header).
 * The panel follows the finger via inline `transform` (no re-renders); on release it either snaps back
 * or slides out and `onDismiss` is called.
 */
export function useDragDismiss(
  panelRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  enabled: boolean,
): DragHandlers {
  const drag = useRef<DragState | null>(null);

  // Re-enabled (e.g. reopened while closing): drop any leftover offset.
  useEffect(() => {
    if (enabled) setOffset(panelRef.current, null);
    else drag.current = null;
  }, [enabled, panelRef]);

  const end = (e: PointerEvent<HTMLElement>, cancelled: boolean) => {
    const state = drag.current;
    if (!state || state.pointerId !== e.pointerId) return;
    drag.current = null;
    const panel = panelRef.current;
    if (!panel) return;
    const dy = Math.max(0, e.clientY - state.startY);
    const threshold = Math.min(MAX_DISTANCE, panel.offsetHeight * DISTANCE_RATIO);
    const dismiss =
      !cancelled && (dy > threshold || (state.velocity > FLICK_VELOCITY && dy > MIN_FLICK_DISTANCE));
    if (dismiss) {
      panel.style.transition = '';
      panel.style.transform = 'translateY(100%)';
      onDismiss();
    } else {
      setOffset(panel, null);
    }
  };

  return {
    onPointerDown(e) {
      if (!enabled || e.pointerType !== 'touch') return;
      if (e.target instanceof Element && e.target.closest('button, a, input, textarea, select')) return;
      drag.current = {
        pointerId: e.pointerId,
        startY: e.clientY,
        lastY: e.clientY,
        lastTime: e.timeStamp,
        velocity: 0,
      };
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e) {
      const state = drag.current;
      if (!state || state.pointerId !== e.pointerId) return;
      const dt = e.timeStamp - state.lastTime;
      if (dt > 0) state.velocity = (e.clientY - state.lastY) / dt;
      state.lastY = e.clientY;
      state.lastTime = e.timeStamp;
      setOffset(panelRef.current, Math.max(0, e.clientY - state.startY));
    },
    onPointerUp(e) {
      end(e, false);
    },
    onPointerCancel(e) {
      end(e, true);
    },
  };
}
