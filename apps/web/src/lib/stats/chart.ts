import { dShort, fN, type ISODate } from '@legko/shared';
import type { DatedValue } from './common';

/** Width of the chart's SVG viewBox; the SVG is stretched (`preserveAspectRatio="none"`). */
export const CHART_WIDTH = 320;
const SIDE_INSET = 6;
const TOP_BOTTOM_INSET = 10;
const MIN_SPAN = 1;
const PADDING = 0.18;
/** Dots are hidden (except the last one) when a chart has more points than this. */
export const MAX_DOTTED_POINTS = 16;
const DOT_SIZE = 7;
const LAST_DOT_SIZE = 12;

export interface ChartDot {
  date: ISODate;
  value: number;
  /** Position in % of the chart box (dots are HTML overlays centred with translate(-50%,-50%)). */
  leftPct: number;
  topPct: number;
  /** Diameter in px: 12 for the last point, 0 (hidden) when there are > 16 points, else 7. */
  size: number;
}

export interface ChartTag {
  leftPct: number;
  topPct: number;
  /** Latest value, «65,4». */
  text: string;
}

export interface ChartGeometry {
  /** `viewBox` for the SVG: «0 0 320 120». */
  viewBox: string;
  /** SVG path of the line; '' when there are no points. */
  line: string;
  /** SVG path of the gradient area under the line; ''. */
  area: string;
  dots: ChartDot[];
  /** Value tag above the last point; `null` when there are no points. */
  tag: ChartTag | null;
  /** First / last date under the chart, «10.10»; '' when empty. */
  from: string;
  to: string;
}

/**
 * Line-chart geometry, a faithful port of the prototype's `chart()`: viewBox 320×height,
 * 6px side inset, 10px top/bottom inset, a value span of at least 1 (±0.5 around flat data)
 * plus 18% vertical padding. A single point sits in the middle.
 */
export function chartGeometry(points: readonly DatedValue[], height = 120): ChartGeometry {
  const viewBox = `0 0 ${CHART_WIDTH} ${height}`;
  const firstPoint = points[0];
  const lastPoint = points.at(-1);
  if (!firstPoint || !lastPoint) {
    return { viewBox, line: '', area: '', dots: [], tag: null, from: '', to: '' };
  }

  const values = points.map((p) => p.value);
  let min = Math.min(...values);
  let max = Math.max(...values);
  if (max - min < MIN_SPAN) {
    max += MIN_SPAN / 2;
    min -= MIN_SPAN / 2;
  }
  const pad = (max - min) * PADDING;
  min -= pad;
  max += pad;

  const n = points.length;
  const x = (i: number): number =>
    n === 1 ? CHART_WIDTH / 2 : SIDE_INSET + (i * (CHART_WIDTH - 2 * SIDE_INSET)) / (n - 1);
  const y = (v: number): number =>
    TOP_BOTTOM_INSET + (height - 2 * TOP_BOTTOM_INSET) * (1 - (v - min) / (max - min));
  const leftPct = (i: number): number => (x(i) / CHART_WIDTH) * 100;
  const topPct = (v: number): number => (y(v) / height) * 100;

  const line = 'M' + points.map((p, i) => `${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join(' L');
  const area = `${line} L${x(n - 1).toFixed(1)} ${height} L${x(0).toFixed(1)} ${height} Z`;
  const dots = points.map((p, i): ChartDot => ({
    date: p.date,
    value: p.value,
    leftPct: leftPct(i),
    topPct: topPct(p.value),
    size: i === n - 1 ? LAST_DOT_SIZE : n > MAX_DOTTED_POINTS ? 0 : DOT_SIZE,
  }));
  return {
    viewBox,
    line,
    area,
    dots,
    tag: { leftPct: leftPct(n - 1), topPct: topPct(lastPoint.value), text: fN(lastPoint.value) },
    from: dShort(firstPoint.date),
    to: dShort(lastPoint.date),
  };
}
