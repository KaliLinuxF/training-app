import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './Pill.module.css';

/**
 * - `acc`      — lavender tint (accT / accD): «Частково», workout type in history
 * - `acc2`     — mint tint (acc2T / acc2D): «Заповнено»
 * - `neutral`  — paper / muted: «Порожньо», «Відпочинок»
 * - `accSolid` — solid lavender (acc / onAcc): the hero «−3,0 кг» badge
 */
export type PillTone = 'acc' | 'acc2' | 'neutral' | 'accSolid';

export interface PillProps {
  children: ReactNode;
  tone?: PillTone;
  /** `md` 12/600 padding 6/10 (status), `sm` 12/600 padding 5/9 (history rows), `lg` 15/700 padding 8/12 (hero). */
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}

export function Pill({ children, tone = 'neutral', size = 'md', className }: PillProps) {
  return <span className={cx(s.pill, s[size], s[tone], className)}>{children}</span>;
}
