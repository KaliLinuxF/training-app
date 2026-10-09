import { cx } from '../internal/cx';
import s from './ProgressBar.module.css';

export interface ProgressBarProps {
  /** Fill, 0–100 (clamped). */
  value: number;
  /** Height: `sm` 6 (kcal history), `md` 8 (hero), `lg` 10 (workout types). */
  size?: 'sm' | 'md' | 'lg';
  /** Track colour: `line2` on light surfaces, `onSolid` (`--solidSub2`) inside the dark hero. */
  track?: 'line2' | 'onSolid';
  /** Fill colour. */
  tone?: 'acc' | 'acc2';
  /** Accessible name; without it the bar is decorative (the number is shown as text next to it). */
  label?: string;
  className?: string;
}

const clamp = (n: number): number => (Number.isFinite(n) ? Math.min(100, Math.max(0, n)) : 0);

export function ProgressBar({
  value,
  size = 'md',
  track = 'line2',
  tone = 'acc',
  label,
  className,
}: ProgressBarProps) {
  const pct = clamp(value);
  const a11y = label
    ? {
        role: 'progressbar',
        'aria-label': label,
        'aria-valuemin': 0,
        'aria-valuemax': 100,
        'aria-valuenow': Math.round(pct),
      }
    : { 'aria-hidden': true };
  // Block-level spans, not divs: the bar is phrasing content, so it may sit inside a <button> (a ListRow meter).
  return (
    <span className={cx(s.track, s[size], s[track], className)} {...a11y}>
      <span className={cx(s.fill, s[tone])} style={{ width: `${pct}%` }} />
    </span>
  );
}
