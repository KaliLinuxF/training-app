import { useEffect, useState, type RefObject } from 'react';

export interface ScrollEdges {
  /** Content is hidden before the visible part (the box is scrolled away from its start). */
  start: boolean;
  /** Content is hidden after the visible part. */
  end: boolean;
}

const NONE: ScrollEdges = { start: false, end: false };

/** Where a horizontally scrolling box hides content (1px tolerance for fractional widths). */
export function scrollEdgesOf(el: Pick<HTMLElement, 'scrollLeft' | 'clientWidth' | 'scrollWidth'>): ScrollEdges {
  return {
    start: el.scrollLeft > 1,
    end: el.scrollLeft + el.clientWidth < el.scrollWidth - 1,
  };
}

/**
 * The `scrollLeft` of `box` (a horizontally scrolling strip) that brings `item` fully into view with the least
 * movement, `margin` px clear of the edge; null when it already is. Only the strip moves — unlike
 * `Element.scrollIntoView`, which also scrolls the page.
 */
export function scrollLeftToReveal(box: HTMLElement, item: HTMLElement, margin = 8): number | null {
  const b = box.getBoundingClientRect();
  const r = item.getBoundingClientRect();
  const start = r.left - b.left + box.scrollLeft;
  const end = start + r.width;
  let left: number | null = null;
  if (start - margin < box.scrollLeft) left = Math.max(0, start - margin);
  else if (end + margin > box.scrollLeft + box.clientWidth) left = end + margin - box.clientWidth;
  return left === null || Math.abs(left - box.scrollLeft) < 1 ? null : left;
}

/**
 * Tracks which sides of a horizontally scrolling box hide content, so the page can hint at it (an edge fade, a
 * shadow on a sticky column). Updates on scroll, on resize of the box or its first child, and on window resize;
 * re-renders only when an edge flips.
 */
export function useScrollEdges(ref: RefObject<HTMLElement | null>): ScrollEdges {
  const [edges, setEdges] = useState<ScrollEdges>(NONE);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const next = scrollEdgesOf(el);
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    el.addEventListener('scroll', update, { passive: true });
    window.addEventListener('resize', update);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(update);
    observer?.observe(el);
    if (el.firstElementChild) observer?.observe(el.firstElementChild);
    return () => {
      el.removeEventListener('scroll', update);
      window.removeEventListener('resize', update);
      observer?.disconnect();
    };
  }, [ref]);

  return edges;
}
