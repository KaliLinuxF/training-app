import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { cx } from '../internal/cx';
import s from './Banner.module.css';

export type BannerProps = {
  title: ReactNode;
  sub?: ReactNode;
  /**
   * - `md` (default) — Home reminder banner: padding 14, `--r20`, 10px dot, title 15/600
   * - `compact` — one-glance hint (min-height 56, `--r16`, 8px dot, title 14/600 clamped to 2 lines, sub 13 clamped to
   *   3 lines; unclamped below 360px)
   */
  size?: 'md' | 'compact';
  /** Adds a ✕ that hides the banner (named by `dismissLabel`). */
  onDismiss?: () => void;
  /** Accessible name of the ✕ (default «Сховати»). */
  dismissLabel?: string;
  /** Span all columns of a <ContentGrid> (default true, as on Home). */
  full?: boolean;
  className?: string;
} & (
  | {
      /** Button text («Записати», «Почати»). */
      cta: string;
      onAction: () => void;
    }
  | { cta?: never; onAction?: never }
);

/** Lavender tint, accent dot, title + sub, optional small solid CTA and an optional ✕. */
export function Banner({
  title,
  sub,
  size = 'md',
  cta,
  onAction,
  onDismiss,
  dismissLabel = 'Сховати',
  full = true,
  className,
}: BannerProps) {
  return (
    <div className={cx(s.banner, size === 'compact' && s.compact, full && s.full, className)}>
      <span className={s.dot} aria-hidden="true" />
      <div className={s.text}>
        <span className={s.title}>{title}</span>
        {sub != null && <span className={s.sub}>{sub}</span>}
      </div>
      {cta !== undefined && (
        <Button size="sm" onClick={onAction}>
          {cta}
        </Button>
      )}
      {onDismiss && (
        <button type="button" className={s.close} aria-label={dismissLabel} onClick={onDismiss}>
          <span aria-hidden="true">✕</span>
        </button>
      )}
    </div>
  );
}
