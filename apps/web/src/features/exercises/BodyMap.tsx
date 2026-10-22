import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { MuscleId } from '@legko/shared';
import { cx, Legend } from '@/ui';
import {
  ABS_LINES,
  autoView,
  clientToViewBox,
  figuresFor,
  hitTest,
  muscleSpeech,
  regionsFor,
  thumbViewBox,
  viewBoxFor,
  type BodyMapView,
} from './bodyMapModel';
import s from './BodyMap.module.css';

export interface BodyMapProps {
  primary: readonly MuscleId[];
  secondary?: readonly MuscleId[];
  /** 'both' (default for md/lg), 'front' | 'back' | 'auto' (thumb: the view holding most primary muscles). */
  view?: 'both' | 'front' | 'back' | 'auto';
  /**
   * thumb 44×44 (viewBox cropped to the primary muscles' bbox, padded to a square of ≥ 70 units, clamped to the
   * figure) · md 160 px tall · lg 240 px tall (exercise detail, editor).
   */
  size?: 'thumb' | 'md' | 'lg';
  /** Editor only: pointer taps on a region call this (the SVG stays aria-hidden; chips are the accessible control). */
  onRegionTap?: (muscle: MuscleId) => void;
  className?: string;
}

/** How long a tapped region keeps its outline. */
export const TAP_OUTLINE_MS = 1000;

const NONE: readonly MuscleId[] = [];

/**
 * The in-house body map: front and back silhouettes, primary muscles in `--acc`, secondary in `--accLine`.
 * md / lg: `role="img"` named by the muscles, with a colour key under it; thumb: decorative (the row names the
 * exercise). With `onRegionTap` a tap picks the region under it (or the nearest within 12 units) and outlines it
 * for a second; the map is then decorative too, the muscle chips being the accessible input.
 */
export function BodyMap({ primary, secondary = NONE, view, size = 'md', onRegionTap, className }: BodyMapProps) {
  const thumb = size === 'thumb';
  const resolved: BodyMapView =
    view === 'auto' || (thumb && (view === undefined || view === 'both')) ? autoView(primary) : (view ?? 'both');
  const viewBox = thumb && resolved !== 'both' ? thumbViewBox(primary, resolved) : viewBoxFor(resolved);
  const [outlined, setOutlined] = useState<MuscleId | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const interactive = onRegionTap !== undefined;
  const labelled = !thumb && !interactive;

  const onClick = (e: MouseEvent<SVGSVGElement>) => {
    if (!onRegionTap) return;
    const point = clientToViewBox(e.currentTarget.getBoundingClientRect(), viewBox, e.clientX, e.clientY);
    const muscle = point ? hitTest(resolved, point[0], point[1]) : null;
    if (!muscle) return;
    setOutlined(muscle);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOutlined(null), TAP_OUTLINE_MS);
    onRegionTap(muscle);
  };

  const toneOf = (m: MuscleId): string | undefined =>
    primary.includes(m) ? s.primary : secondary.includes(m) ? s.secondary : undefined;
  const figures = figuresFor(resolved);

  const svg = (
    <svg
      viewBox={viewBox}
      className={cx(s.map, s[size], interactive && s.interactive, thumb && className)}
      role={labelled ? 'img' : undefined}
      aria-label={labelled ? muscleSpeech(primary, secondary) : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      onClick={interactive ? onClick : undefined}
      data-view={resolved}
    >
      {figures.map((f) => (
        <g key={f.view} className={s.silhouette}>
          <path d={f.d} />
          <ellipse cx={f.head.cx} cy={f.head.cy} rx={f.head.rx} ry={f.head.ry} />
        </g>
      ))}
      {regionsFor(resolved).map((r) => (
        <path
          key={r.key}
          d={r.d}
          data-muscle={r.muscle}
          className={cx(s.region, toneOf(r.muscle), outlined === r.muscle && s.outlined)}
        />
      ))}
      {resolved !== 'back' &&
        ABS_LINES.map((d) => <path key={d} d={d} className={s.absLine} />)}
      {!thumb &&
        figures.map((f) => (
          <text key={f.view} x={f.caption.x} y={f.caption.y} textAnchor="middle" className={s.caption}>
            {f.caption.text}
          </text>
        ))}
    </svg>
  );

  if (thumb) return svg;
  return (
    <div className={cx(s.root, className)}>
      {svg}
      <Legend centered className={s.legend}>
        <span className={s.key} aria-hidden="true">
          <span className={cx(s.swatch, s.swatchPrimary)} />
          Основні
        </span>
        <span className={s.key} aria-hidden="true">
          <span className={cx(s.swatch, s.swatchSecondary)} />
          Допоміжні
        </span>
      </Legend>
    </div>
  );
}
