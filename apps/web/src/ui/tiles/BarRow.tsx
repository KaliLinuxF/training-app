import type { ReactNode } from 'react';
import { ProgressBar } from '../feedback/ProgressBar';
import { cx } from '../internal/cx';
import s from './BarRow.module.css';

/**
 * - `rank`    — «Найчастіше» workout types: grid 92px / bar / 28px, label 14/500, 10px bar, value 14/700
 * - `history` — «Історія калорій»: grid 96px / bar / 78px, label 14, 6px bar, value 14/600,
 *               padding 9px 0, min-height 44 (tap target), a `--line2` divider above (clickable)
 */
export type BarRowVariant = 'rank' | 'history';

export interface BarRowProps {
  label: ReactNode;
  value: ReactNode;
  /** Fill width, 0–100. */
  pct: number;
  variant?: BarRowVariant;
  /** Fill colour: `acc` (lavender) or `acc2` (mint). */
  tone?: 'acc' | 'acc2';
  onClick?: () => void;
  'aria-label'?: string;
  className?: string;
}

export function BarRow({
  label,
  value,
  pct,
  variant = 'rank',
  tone = 'acc',
  onClick,
  className,
  ...aria
}: BarRowProps) {
  const content = (
    <>
      <span className={s.label}>{label}</span>
      <ProgressBar value={pct} size={variant === 'rank' ? 'lg' : 'sm'} tone={tone} />
      <span className={s.value}>{value}</span>
    </>
  );
  const classes = cx(s.row, s[variant], onClick && s.button, className);
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
