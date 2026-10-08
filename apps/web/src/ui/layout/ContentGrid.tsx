import type { HTMLAttributes } from 'react';
import { cx } from '../internal/cx';
import s from './ContentGrid.module.css';

/**
 * Screen content grid: one column on mobile, two equal columns from 900px (same breakpoint as
 * `useIsDesktop`), gap 14, items aligned to the top.
 */
export function ContentGrid({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(s.grid, className)} {...rest} />;
}

/** Class that makes any grid child span all columns (`grid-column: 1 / -1`). */
export const fullRowClass: string = s.full ?? '';

/** Full-width row wrapper for arbitrary content inside a <ContentGrid>. */
export function FullRow({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cx(s.full, className)} {...rest} />;
}
