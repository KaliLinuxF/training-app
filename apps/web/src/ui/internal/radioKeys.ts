import type { KeyboardEvent } from 'react';

/** Arrow / Home / End navigation for radio-style groups (WAI-ARIA radiogroup pattern). */
export function nextRadioIndex(key: string, index: number, count: number): number | null {
  switch (key) {
    case 'ArrowRight':
    case 'ArrowDown':
      return (index + 1) % count;
    case 'ArrowLeft':
    case 'ArrowUp':
      return (index - 1 + count) % count;
    case 'Home':
      return 0;
    case 'End':
      return count - 1;
    default:
      return null;
  }
}

/**
 * Keydown handler for a button inside a `role="radiogroup"`: selects the neighbour and moves focus to it.
 * `select(i)` must make option `i` the checked one.
 */
export function handleRadioKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  count: number,
  select: (index: number) => void,
): void {
  const next = nextRadioIndex(event.key, index, count);
  if (next === null) return;
  event.preventDefault();
  select(next);
  const group = event.currentTarget.closest('[role="radiogroup"]');
  group?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus();
}
