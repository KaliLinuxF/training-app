import type { ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './DetailRow.module.css';

export interface DetailRowProps {
  label: ReactNode;
  /** Empty (`null`, `''` or «—») renders a faint «—». */
  value: ReactNode;
  className?: string;
}

const isEmpty = (v: ReactNode): boolean => v == null || v === '' || v === '—' || v === false;

/** Calendar day details row: 104px label column + wrapping value (15/500), divider above. */
export function DetailRow({ label, value, className }: DetailRowProps) {
  const empty = isEmpty(value);
  return (
    <div className={cx(s.row, className)}>
      <span className={s.label}>{label}</span>
      <span className={cx(s.value, empty && s.empty)}>{empty ? '—' : value}</span>
    </div>
  );
}
