import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './Legend.module.css';

export type SwatchColor = 'acc' | 'acc2' | 'accT' | 'acc2T' | 'solid' | 'line' | 'faint';

export interface LegendItemProps {
  color: SwatchColor;
  label: ReactNode;
  /** `dot` 8px circle (calendar) or `square` 10px with radius 3 (kcal chart). */
  shape?: 'dot' | 'square';
}

export function LegendItem({ color, label, shape = 'dot' }: LegendItemProps) {
  return (
    <span className={s.item}>
      <span className={cx(s.swatch, s[shape], s[color])} aria-hidden="true" />
      {label}
    </span>
  );
}

export interface LegendProps {
  children: ReactNode;
  /** Centre the items with 4px top padding (calendar legend). */
  centered?: boolean;
  className?: string;
}

/** Row of legend items: 12px muted, gap 14, wraps. Plain text children (e.g. «· середнє за тиждень») are fine. */
export function Legend({ children, centered, className }: LegendProps) {
  return <div className={cx(s.legend, centered && s.centered, className)}>{children}</div>;
}
