import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import { toneClass, type Tone } from '../tone';
import s from './StatTile.module.css';

export interface StatTileProps {
  label: ReactNode;
  value: ReactNode;
  /** Muted 14/500 suffix after a space («ккал», «з 3»). */
  unit?: ReactNode;
  /** Colour of the value (use `deltaTone()` for changes). */
  tone?: Tone;
  className?: string;
}

/** Standalone bordered tile — Home «Цей тиждень» (value 24/700). */
export function StatTile({ label, value, unit, tone = 'ink', className }: StatTileProps) {
  return (
    <div className={cx(s.tile, className)}>
      <span className={s.label}>{label}</span>
      <span className={cx(s.value, toneClass(tone))}>
        {value}
        {unit != null && <span className={s.unit}> {unit}</span>}
      </span>
    </div>
  );
}
