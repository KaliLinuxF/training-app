import { useId, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './ListGroup.module.css';

export interface ListGroupProps {
  /** `ListRow` elements only (rendered inside a `<ul role="list">`). */
  children: ReactNode;
  /** In-card `<h2>` that names the region: md 18/700 (Home «Сьогодні»), lg 20/700 (calendar day). */
  title?: ReactNode;
  /** Default `'md'`. */
  titleSize?: 'md' | 'lg';
  /** Id of the title `<h2>` (default: generated). */
  titleId?: string;
  /** 14 `--muted` line under the title («середа · сьогодні»); never part of the region's name. */
  subtitle?: ReactNode;
  /** Right side of the header: ghost `Button` «Відкрити день →», `Pill` «Частково». */
  headerRight?: ReactNode;
  /** Inside the card under the rows («Редагувати день»). */
  footer?: ReactNode;
  /** iOS-style group label above the card (`<h2>` 14/600 `--muted`); names the region when there is no title. */
  caption?: ReactNode;
  /** 13 `--muted` text under the card. */
  note?: ReactNode;
  /** Names the region when there is neither a title nor a caption. */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** Span all columns of a `<ContentGrid>`. */
  full?: boolean;
  /** No vertical padding around the rows (single-row groups: the Home week row). */
  flush?: boolean;
  className?: string;
}

/**
 * Grouped list card: optional caption above, `--card` box (1px `--line`, `--r24`) with an optional header
 * (title, subtitle, right slot), the rows and an optional footer, optional note below.
 * A `<section>` named by the title / caption / `aria-label`, otherwise a plain `<div>`.
 */
export function ListGroup({
  children,
  title,
  titleSize = 'md',
  titleId,
  subtitle,
  headerRight,
  footer,
  caption,
  note,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  full,
  flush,
  className,
}: ListGroupProps) {
  const autoTitleId = useId();
  const captionId = useId();
  const headingId = titleId ?? autoTitleId;
  const hasTitle = title != null;
  const hasCaption = caption != null;

  const card = (
    <div className={s.card}>
      {hasTitle && (
        <div className={s.header}>
          <div className={s.headText}>
            <h2 id={headingId} className={cx(s.title, s[titleSize])}>
              {title}
            </h2>
            {subtitle != null && <p className={s.subtitle}>{subtitle}</p>}
          </div>
          {headerRight}
        </div>
      )}
      <ul role="list" className={cx(s.rows, flush && s.flush)}>
        {children}
      </ul>
      {footer != null && <div className={s.footer}>{footer}</div>}
    </div>
  );
  const body = (
    <>
      {hasCaption && (
        <h2 id={captionId} className={s.caption}>
          {caption}
        </h2>
      )}
      {card}
      {note != null && <p className={s.note}>{note}</p>}
    </>
  );
  const rootClass = cx(s.group, full && s.full, className);

  if (hasTitle || hasCaption) {
    return (
      <section className={rootClass} aria-labelledby={hasTitle ? headingId : captionId}>
        {body}
      </section>
    );
  }
  if (ariaLabel !== undefined || ariaLabelledBy !== undefined) {
    return (
      <section className={rootClass} aria-label={ariaLabel} aria-labelledby={ariaLabelledBy}>
        {body}
      </section>
    );
  }
  return <div className={rootClass}>{body}</div>;
}
