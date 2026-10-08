import { useId, type ReactNode } from 'react';
import { cx } from '../internal/cx';
import s from './LineChart.module.css';

export interface LineChartDot {
  /** Centre position in % of the plot box. */
  leftPct: number;
  topPct: number;
  /** Diameter in px (12 last, 7 regular); 0 hides the dot. A 2px card-coloured ring is added outside. */
  size: number;
}

export interface LineChartTag {
  leftPct: number;
  topPct: number;
  text: string;
}

/** Plain geometry (see `chartGeometry()` in lib/stats — its `ChartGeometry` is assignable to this). */
export interface LineChartGeometry {
  /** SVG viewBox, «0 0 320 120» by default. */
  viewBox?: string;
  line: string;
  area: string;
  dots: readonly LineChartDot[];
  tag: LineChartTag | null;
  /** Labels under the chart («10.08», «06.10»). */
  from: string;
  to: string;
}

export interface LineChartProps {
  geometry: LineChartGeometry;
  /** Plot height in px: 150 (weight) or 120 (measurements). */
  height?: 150 | 120;
  /** `acc` lavender (weight) or `acc2` mint (measurements). */
  tone?: 'acc' | 'acc2';
  /** Show the value tag above the last dot (the prototype shows it for weight only). */
  showTag?: boolean;
  /** Centre footer label («Талія, см»). */
  middleLabel?: ReactNode;
  /** Text alternative for screen readers («Вага: з 68,4 до 65,4 кг»). */
  'aria-label'?: string;
  className?: string;
}

const DEFAULT_VIEWBOX = '0 0 320 120';

/** Area + line chart with HTML dots and a value tag, stretched to the container width. */
export function LineChart({
  geometry,
  height = 150,
  tone = 'acc',
  showTag = true,
  middleLabel,
  className,
  'aria-label': ariaLabel,
}: LineChartProps) {
  // useId() contains characters (":", "«") that are awkward inside url(#…).
  const gradientId = `lc${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  const { tag } = geometry;
  return (
    <div
      className={cx(s.chart, s[tone], className)}
      role={ariaLabel ? 'img' : undefined}
      aria-label={ariaLabel}
    >
      <div className={cx(s.plot, height === 120 ? s.h120 : s.h150)} aria-hidden="true">
        <svg className={s.svg} viewBox={geometry.viewBox ?? DEFAULT_VIEWBOX} preserveAspectRatio="none">
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" className={s.stopTop} />
              <stop offset="1" className={s.stopBottom} />
            </linearGradient>
          </defs>
          {geometry.area && <path d={geometry.area} fill={`url(#${gradientId})`} />}
          {geometry.line && (
            <path
              d={geometry.line}
              className={s.line}
              fill="none"
              strokeWidth={2.5}
              strokeLinejoin="round"
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        {geometry.dots.map((dot, i) =>
          dot.size > 0 ? (
            <span
              key={i}
              className={s.dot}
              style={{ left: `${dot.leftPct}%`, top: `${dot.topPct}%`, width: dot.size, height: dot.size }}
            />
          ) : null,
        )}
        {showTag && tag && (
          <span className={s.tag} style={{ left: `${tag.leftPct}%`, top: `${tag.topPct}%` }}>
            {tag.text}
          </span>
        )}
      </div>
      <div className={s.footer} aria-hidden={ariaLabel ? true : undefined}>
        <span>{geometry.from}</span>
        {middleLabel != null && <span>{middleLabel}</span>}
        <span>{geometry.to}</span>
      </div>
    </div>
  );
}
