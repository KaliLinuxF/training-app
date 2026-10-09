import { cx } from '@/ui';
import s from './ChartPlaceholder.module.css';

export interface ChartPlaceholderProps {
  /** Height of the chart plot it replaces. */
  height: 150 | 120;
  /** What to record to get a chart. */
  hint: string;
}

export const NOT_ENOUGH_DATA = 'Ще недостатньо даних';

/** Friendly empty state of a line chart (fewer than two points). */
export function ChartPlaceholder({ height, hint }: ChartPlaceholderProps) {
  return (
    <div className={cx(s.box, height === 150 ? s.h150 : s.h120)}>
      <span className={s.title}>{NOT_ENOUGH_DATA}</span>
      <span className={s.hint}>{hint}</span>
    </div>
  );
}
