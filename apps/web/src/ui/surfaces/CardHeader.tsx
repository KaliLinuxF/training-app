import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './CardHeader.module.css';

/**
 * Title sizes from the prototype:
 * - `md` 18/700 (−0.01em) — most cards («Сьогодні», «Вага», «Харчування»)
 * - `sm` 17/700 with a 13px subtitle — reminder cards, «Мої цілі»
 * - `lg` 20/700 (−0.015em) with a 14px subtitle — calendar day details
 */
export type CardHeaderSize = 'sm' | 'md' | 'lg';

export interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  /** Muted 13px text on the right («ціль 1 700 ккал», «10 жовтня»). */
  meta?: ReactNode;
  /** Arbitrary element on the right (a ghost <Button>, <Switch>, <Pill>…). Rendered after `meta`. */
  right?: ReactNode;
  size?: CardHeaderSize;
  /** Cross-axis alignment of title block and right side; the prototype uses `baseline` for «Харчування». */
  align?: 'center' | 'baseline' | 'start';
  /** Heading level of the title. */
  as?: 'h2' | 'h3';
  /** id of the title element (for `aria-labelledby` on the card). */
  titleId?: string;
  className?: string;
}

export function CardHeader({
  title,
  subtitle,
  meta,
  right,
  size = 'md',
  align = 'center',
  as: Heading = 'h2',
  titleId,
  className,
}: CardHeaderProps) {
  return (
    <div className={cx(s.header, s[size], s[align], className)}>
      <div className={s.text}>
        <Heading id={titleId} className={s.title}>
          {title}
        </Heading>
        {subtitle != null && <span className={s.subtitle}>{subtitle}</span>}
      </div>
      {meta != null && <span className={s.meta}>{meta}</span>}
      {right}
    </div>
  );
}
