import type { HTMLAttributes } from 'react';
import { cx } from '../internal/cx';
import s from './Card.module.css';

/**
 * - `default` — white card with a border (r24, padding 18, gap 14)
 * - `hero`    — dark «Поточна вага» card (r28, padding 22/22/20, gap 18, onSolid text)
 * - `solid`   — dark panel like «Сповіщення на телефон» (r24, padding 18, gap 14)
 * - `tint`    — lavender summary card «Цього тижня» (r24, padding 18, gap 4, no border)
 * - `list`    — bordered card for row lists (padding 6px 18px, no gap)
 */
export type CardVariant = 'default' | 'hero' | 'solid' | 'tint' | 'list';

export type CardGap = 0 | 2 | 4 | 6 | 8 | 10 | 12 | 14 | 18;

export interface CardProps extends HTMLAttributes<HTMLElement> {
  variant?: CardVariant;
  /** Overrides the variant's gap between children. */
  gap?: CardGap;
  /** Lay children out in a row (centred vertically) instead of a column. */
  row?: boolean;
  /** Span all columns of a <ContentGrid>. */
  full?: boolean;
  as?: 'div' | 'section' | 'article';
}

export function Card({
  variant = 'default',
  gap,
  row,
  full,
  as: Tag = 'div',
  className,
  ...rest
}: CardProps) {
  return (
    <Tag
      className={cx(
        s.card,
        s[variant],
        gap !== undefined && s[`gap${gap}`],
        row && s.row,
        full && s.full,
        className,
      )}
      {...rest}
    />
  );
}
