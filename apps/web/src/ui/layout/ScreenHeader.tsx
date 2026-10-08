import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './ScreenHeader.module.css';

export interface ScreenHeaderProps {
  /** Small muted line above the title («Історія по днях», «Субота, 10 жовтня»). */
  subtitle?: ReactNode;
  /** Display title («Календар», «Доброго ранку»), rendered as the page's <h1>. */
  title: ReactNode;
  /** Optional element on the right, bottom-aligned (e.g. <Avatar />). */
  right?: ReactNode;
  className?: string;
}

/** Screen title block; always spans the full width of a <ContentGrid>. */
export function ScreenHeader({ subtitle, title, right, className }: ScreenHeaderProps) {
  return (
    <header className={cx(s.header, className)}>
      <div className={s.text}>
        {subtitle != null && <p className={s.subtitle}>{subtitle}</p>}
        <h1 className={s.title}>{title}</h1>
      </div>
      {right}
    </header>
  );
}
