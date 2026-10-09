import { cx } from '../internal/cx';
import { toneClass, type Tone } from '../tone';
import s from './StatStrip.module.css';

export interface StatItem {
  /** «Всього», «Цього тижня», «Сер. цього місяця». */
  label: string;
  /** Formatted value («41», «1 795»); «—» is always drawn in `--faint`. */
  value: string;
  /** 13/600 suffix («ккал»). */
  unit?: string;
  tone?: Tone;
}

export interface StatStripProps {
  items: readonly StatItem[];
  /** Phone columns; default `min(items.length, 4)`. */
  columns?: 2 | 3 | 4;
  /** Columns in the desktop shell (`DESKTOP_QUERY`); default = `columns`. */
  desktopColumns?: 2 | 3 | 4;
  'aria-label'?: string;
  className?: string;
}

/** Big unboxed numbers in a row (Progress «Тренування», «Харчування»): a `<dl>`, the value drawn above its label. */
export function StatStrip({
  items,
  columns,
  desktopColumns,
  'aria-label': ariaLabel,
  className,
}: StatStripProps) {
  const phone = columns ?? Math.max(1, Math.min(items.length, 4));
  const desktop = desktopColumns ?? phone;
  return (
    <dl className={cx(s.strip, s[`c${phone}`], s[`d${desktop}`], className)} aria-label={ariaLabel}>
      {items.map((item) => (
        <div key={item.label} className={s.cell}>
          <dt className={s.label}>{item.label}</dt>
          <dd className={cx(s.value, toneClass(item.value === '—' ? 'faint' : item.tone))}>
            {item.value}
            {item.unit != null && <span className={s.unit}>{item.unit}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
