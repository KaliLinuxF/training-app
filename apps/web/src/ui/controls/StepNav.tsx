import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import { IconButton } from './IconButton';
import s from './StepNav.module.css';

export interface StepNavProps {
  /** Centre content (month title, or date + weekday). */
  children: ReactNode;
  onPrev: () => void;
  onNext: () => void;
  /** Accessible names of the arrows («Попередній місяць», «Наступний день»…). */
  prevLabel: string;
  nextLabel: string;
  canPrev?: boolean;
  /** `false` disables «›» and shows it faint (e.g. the future is not reachable). */
  canNext?: boolean;
  /** Arrow background: `paper` (calendar card) or `card` (sheet header). */
  surface?: 'paper' | 'card';
  className?: string;
}

/** «‹ centre ›» navigator used by the calendar month header and the sheet date header. */
export function StepNav({
  children,
  onPrev,
  onNext,
  prevLabel,
  nextLabel,
  canPrev = true,
  canNext = true,
  surface = 'paper',
  className,
}: StepNavProps) {
  return (
    <div className={cx(s.nav, className)}>
      <IconButton label={prevLabel} surface={surface} onClick={onPrev} disabled={!canPrev}>
        ‹
      </IconButton>
      <div className={s.center}>{children}</div>
      <IconButton label={nextLabel} surface={surface} onClick={onNext} disabled={!canNext}>
        ›
      </IconButton>
    </div>
  );
}
