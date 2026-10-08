import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import { toneClass, type Tone } from '../tone';
import s from './Tile.module.css';

/**
 * Small value tiles that sit inside cards (paper background):
 * - `entry`   — Home «Сьогодні»: label 13, value 16/600, r16, padding 12/14 (usually clickable)
 * - `measure` — Home «Поточні заміри»: label 13, value 22/700, r16, padding 12, delta 13/600
 * - `compact` — Progress weight / kcal tiles: label 12, value 18/700, r14, padding 10/12
 * - `count`   — Progress workout tiles: label 12, value 22/700, r14, padding 12
 * - `onSolid` — tiles inside the dark hero card: label 13 onSolidMuted, value 20/600, r16, padding 12/14
 */
export type TileVariant = 'entry' | 'measure' | 'compact' | 'count' | 'onSolid';

export interface TileProps {
  label: ReactNode;
  value: ReactNode;
  /** Third line (delta) — 13/600, mint by default («−4 см»). */
  sub?: ReactNode;
  subTone?: Tone;
  /** Colour of the value; inherits when omitted. */
  tone?: Tone;
  variant?: TileVariant;
  /** Makes the whole tile a button. */
  onClick?: () => void;
  'aria-label'?: string;
  className?: string;
}

export function Tile({
  label,
  value,
  sub,
  subTone = 'acc2',
  tone,
  variant = 'compact',
  onClick,
  className,
  ...aria
}: TileProps) {
  const content = (
    <>
      <span className={s.label}>{label}</span>
      <span className={cx(s.value, toneClass(tone))}>{value}</span>
      {sub != null && <span className={cx(s.sub, toneClass(subTone))}>{sub}</span>}
    </>
  );
  const classes = cx(s.tile, s[variant], onClick && s.button, className);
  if (onClick) {
    return (
      <button type="button" className={classes} onClick={onClick} {...aria}>
        {content}
      </button>
    );
  }
  return (
    <div className={classes} {...aria}>
      {content}
    </div>
  );
}
