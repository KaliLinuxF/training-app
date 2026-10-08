import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import { toneClass, type Tone } from '../tone';
import s from './KeyValueRow.module.css';

/**
 * - `control` — Home «Останнє зважування…» rows inside a `list` card: label 14 muted, value 15/600,
 *               padding 13px 0, divider `--line2` below every row except the last
 * - `summary` — rows of the lavender summary card: label 15 ink2, value 16/700, padding 8px 0,
 *               `--accLine` divider above every row
 * - `plain`   — «Мої цілі» rows: label 15 ink2, any control on the right, no divider
 */
export type KeyValueRowVariant = 'control' | 'summary' | 'plain';

export interface KeyValueRowProps {
  label: ReactNode;
  value: ReactNode;
  variant?: KeyValueRowVariant;
  /** Colour of the value (ignored for `plain`). */
  tone?: Tone;
  className?: string;
}

export function KeyValueRow({ label, value, variant = 'control', tone, className }: KeyValueRowProps) {
  return (
    <div className={cx(s.row, s[variant], className)}>
      <span className={s.label}>{label}</span>
      {variant === 'plain' ? value : <span className={cx(s.value, toneClass(tone))}>{value}</span>}
    </div>
  );
}
