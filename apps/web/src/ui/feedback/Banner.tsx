import type { ReactNode } from 'react';
import { Button } from '../controls/Button';
import { cx } from '../internal/cx';
import s from './Banner.module.css';

export interface BannerProps {
  title: ReactNode;
  sub?: ReactNode;
  /** Button text («Записати», «Відмітити»). */
  cta: string;
  onAction: () => void;
  /** Span all columns of a <ContentGrid> (default true, as on Home). */
  full?: boolean;
  className?: string;
}

/** Home reminder banner: lavender tint, accent dot, title + sub, small solid CTA. */
export function Banner({ title, sub, cta, onAction, full = true, className }: BannerProps) {
  return (
    <div className={cx(s.banner, full && s.full, className)}>
      <span className={s.dot} aria-hidden="true" />
      <div className={s.text}>
        <span className={s.title}>{title}</span>
        {sub != null && <span className={s.sub}>{sub}</span>}
      </div>
      <Button size="sm" onClick={onAction}>
        {cta}
      </Button>
    </div>
  );
}
