import { cx } from '../internal/cx';
import s from './BarChart.module.css';

/** `empty` — no data (`--line`), `ok` — within the goal (`--acc2`), `over` — above the goal (`--acc`). */
export type BarTone = 'empty' | 'ok' | 'over';

/** One bar (lib/stats `KcalBar` is assignable to this). */
export interface ChartBar {
  /** Height in % of the plot. */
  heightPct: number;
  tone: BarTone;
  /** Label under the bar («Пн»); shown when `labeled`. */
  label?: string;
}

export interface BarChartProps {
  bars: readonly ChartBar[];
  /** Dashed goal line position, % from the bottom. */
  goalPct: number;
  /** CSS gap between bars: '8px' (week) or '3px' (denser periods). */
  gap?: string;
  /** Show the labels row under the bars (week view). */
  labeled?: boolean;
  /** Text alternative («Калорії за тиждень, ціль 1 700 ккал»). */
  'aria-label'?: string;
  className?: string;
}

/** Kcal bars with a dashed goal line (height 130). */
export function BarChart({
  bars,
  goalPct,
  gap = '8px',
  labeled = false,
  className,
  'aria-label': ariaLabel,
}: BarChartProps) {
  return (
    <div className={cx(s.chart, className)} role={ariaLabel ? 'img' : undefined} aria-label={ariaLabel}>
      <div className={s.plot} style={{ gap }} aria-hidden="true">
        <div className={s.goal} style={{ bottom: `${goalPct}%` }} />
        {bars.map((bar, i) => (
          <div key={i} className={cx(s.bar, s[bar.tone])} style={{ height: `${bar.heightPct}%` }} />
        ))}
      </div>
      {labeled && (
        <div className={s.labels} aria-hidden="true">
          {bars.map((bar, i) => (
            <span key={i} className={s.label}>
              {bar.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
