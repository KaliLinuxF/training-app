import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './Section.module.css';

export interface SectionTitleProps {
  children: ReactNode;
  id?: string;
  as?: 'h2' | 'h3';
  className?: string;
}

/** Title above a group of tiles/cards: «Цей тиждень», «Останні записи» (18/700, padding 6px 4px 0). */
export function SectionTitle({ children, id, as: Heading = 'h2', className }: SectionTitleProps) {
  return (
    <Heading id={id} className={cx(s.title, className)}>
      {children}
    </Heading>
  );
}

export interface SectionProps {
  title: ReactNode;
  children: ReactNode;
  /** Gap between the title and the content: 10 («Цей тиждень») or 8 («Останні записи»). */
  gap?: 8 | 10;
  /** Span all columns of a <ContentGrid>. */
  full?: boolean;
  className?: string;
}

/** A <SectionTitle> followed by its content, as one grid item. */
export function Section({ title, children, gap = 10, full, className }: SectionProps) {
  return (
    <section className={cx(s.section, gap === 8 ? s.gap8 : s.gap10, full && s.full, className)}>
      <SectionTitle>{title}</SectionTitle>
      {children}
    </section>
  );
}
