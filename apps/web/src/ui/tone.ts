import toneStyles from './tone.module.css';

/**
 * Text colour roles for values and deltas:
 * `ink` (default text), `acc` (lavender dark, `--accD`), `acc2` (mint dark, `--acc2D`),
 * `muted`, `faint`.
 */
export type Tone = 'ink' | 'acc' | 'acc2' | 'muted' | 'faint';

/** Below this magnitude a change counts as «no change» (same rule as `sgn()` in @legko/shared). */
const EPSILON = 0.04;

/**
 * Port of the prototype's `tone()`: a decrease is good (mint), an increase is lavender,
 * no change or no data stays ink.
 */
export function deltaTone(n: number | null | undefined): Tone {
  if (typeof n !== 'number' || !Number.isFinite(n)) return 'ink';
  if (n < -EPSILON) return 'acc2';
  if (n > EPSILON) return 'acc';
  return 'ink';
}

/** CSS-module class that sets `color` for a tone (undefined → inherit). */
export const toneClass = (tone: Tone | undefined): string | undefined =>
  tone ? toneStyles[tone] : undefined;
