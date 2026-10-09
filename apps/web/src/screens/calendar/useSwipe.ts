import { useRef, type TouchEvent } from 'react';

/** Minimum horizontal travel, px, for a swipe. */
export const SWIPE_MIN_PX = 40;

/**
 * Decides whether a finished touch was a horizontal swipe: far enough sideways and clearly more
 * horizontal than vertical (so scrolling the page never flips the month).
 */
export function swipeDirection(dx: number, dy: number): 'left' | 'right' | null {
  if (Math.abs(dx) < SWIPE_MIN_PX || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  return dx < 0 ? 'left' : 'right';
}

export interface SwipeHandlers {
  onTouchStart: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
  onTouchCancel: () => void;
}

/** Touch handlers that call `onSwipe` with the direction of a single-finger horizontal swipe. */
export function useSwipe(onSwipe: (dir: 'left' | 'right') => void): SwipeHandlers {
  const start = useRef<{ x: number; y: number } | null>(null);
  return {
    onTouchStart: (e) => {
      const t = e.touches[0];
      start.current = e.touches.length === 1 && t ? { x: t.clientX, y: t.clientY } : null;
    },
    onTouchEnd: (e) => {
      const from = start.current;
      start.current = null;
      const t = e.changedTouches[0];
      if (!from || !t) return;
      const dir = swipeDirection(t.clientX - from.x, t.clientY - from.y);
      if (dir) onSwipe(dir);
    },
    onTouchCancel: () => {
      start.current = null;
    },
  };
}
