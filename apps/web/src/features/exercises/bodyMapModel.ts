/**
 * Geometry and pure helpers of the in-house body map (docs/workouts-steps-rebrand.md §2): soft geometric regions,
 * authored as LEFT-half point lists on a 100 × 220 figure (centre line x = 50) and mirrored. The back figure sits at
 * x 120–220, so one coordinate frame serves every view: `viewBoxFor('back')` simply looks at that part of it.
 */
import { MUSCLE_LABELS, MUSCLE_VIEW, type BodyView, type MuscleId } from '@legko/shared';

export type Point = readonly [x: number, y: number];
export type BodyMapView = 'both' | 'front' | 'back';

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** One figure: 100 wide; the silhouette ends at y 206, the captions sit at y 228. */
export const FIGURE_WIDTH = 100;
export const FIGURE_BOTTOM = 206;
/** x of the back figure in the shared frame. */
export const BACK_OFFSET = 120;
export const VIEWBOX_HEIGHT = 232;
/** Both views side by side. */
export const VIEWBOX = `0 0 220 ${VIEWBOX_HEIGHT}`;
export const CAPTION_Y = 228;
export const CAPTION_SIZE = 9;
export const CAPTIONS: Readonly<Record<BodyView, string>> = { front: 'Спереду', back: 'Ззаду' };
/** The head, in a figure's own frame. */
export const HEAD = { cx: 50, cy: 13, rx: 9, ry: 11 } as const;
/** A thumbnail crops to a square at least this many units wide. */
export const THUMB_MIN_SIDE = 70;
const THUMB_PAD = 6;
/** A tap that misses every region still picks the nearest one whose centre is this close. */
export const HIT_RADIUS = 12;

const SILHOUETTE_LEFT: readonly Point[] = [
  [45, 24], [44, 30], [34, 32], [27, 36], [24, 46], [21, 62], [18, 78], [15, 96], [13, 104], [17, 108], [21, 98],
  [25, 80], [28, 64], [31, 52], [32, 70], [31, 86], [30, 100], [31, 130], [33, 148], [32, 172], [35, 196], [33, 204],
  [44, 206], [44, 198], [44, 172], [45, 150], [47, 130], [49, 104], [50, 104],
];

const FOREARMS: readonly Point[] = [[22, 64], [28, 65], [24, 84], [19, 92], [17, 90]];

/** Left-half regions of the front figure. */
const FRONT_LEFT: ReadonlyArray<readonly [MuscleId, readonly Point[]]> = [
  ['shoulders', [[34, 32], [27, 36], [25, 45], [31, 47], [35, 40]]],
  ['chest', [[36, 36], [49, 36], [49, 52], [40, 54], [33, 49]]],
  ['biceps', [[25, 47], [31, 49], [29, 63], [23, 61]]],
  ['forearms', FOREARMS],
  ['abs', [[42, 56], [49, 56], [49, 96], [44, 96], [42, 80]]],
  ['obliques', [[34, 56], [41, 57], [41, 82], [35, 88], [33, 72]]],
  ['quads', [[32, 104], [46, 106], [45, 140], [37, 146], [32, 132]]],
  ['adductors', [[46, 104], [49, 106], [48, 128], [46, 136]]],
  ['calves', [[34, 154], [42, 154], [41, 184], [36, 186]]],
];

/** Left-half regions of the back figure (in its own frame, before the offset). */
const BACK_LEFT: ReadonlyArray<readonly [MuscleId, readonly Point[]]> = [
  ['traps', [[44, 26], [49, 26], [49, 48], [40, 42], [35, 33]]],
  ['shoulders', [[34, 32], [27, 36], [25, 45], [32, 46]]],
  ['lats', [[34, 46], [48, 52], [46, 78], [37, 74], [33, 60]]],
  ['lowerBack', [[42, 78], [49, 78], [49, 94], [42, 94]]],
  ['triceps', [[25, 46], [32, 48], [30, 64], [23, 62]]],
  ['forearms', FOREARMS],
  ['glutes', [[32, 96], [49, 98], [49, 118], [36, 120], [31, 108]]],
  ['hamstrings', [[32, 122], [47, 122], [45, 148], [35, 148]]],
  ['calves', [[33, 152], [43, 152], [42, 182], [35, 184]]],
];

/** The two faint segment lines across the abs (front figure frame). */
export const ABS_LINES: readonly string[] = ['M42 68H58', 'M42.5 82H57.5'];

// ---- geometry helpers ----------------------------------------------------------------------------

/** Mirrors a left-half point list onto the right half: x' = 100 − x. */
export const mirror = (points: readonly Point[]): Point[] => points.map(([x, y]): Point => [FIGURE_WIDTH - x, y]);

const shift = (points: readonly Point[], dx: number): Point[] => points.map(([x, y]): Point => [x + dx, y]);

const n2 = (v: number): string => String(Math.round(v * 100) / 100);

/** One cubic Bézier: start, two control points, end. */
export type Segment = readonly [p1: Point, c1: Point, c2: Point, p2: Point];

/** The cubic Bézier segments of a closed Catmull–Rom spline through `points`. */
export function splineSegments(points: readonly Point[], tension = 0.5): Segment[] {
  const n = points.length;
  if (n < 3) return [];
  const at = (i: number): Point => points[((i % n) + n) % n] as Point;
  const k = tension / 3;
  const out: Segment[] = [];
  for (let i = 0; i < n; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Point = [p1[0] + (p2[0] - p0[0]) * k, p1[1] + (p2[1] - p0[1]) * k];
    const c2: Point = [p2[0] - (p3[0] - p1[0]) * k, p2[1] - (p3[1] - p1[1]) * k];
    out.push([p1, c1, c2, p2]);
  }
  return out;
}

/** A closed point list as a smooth SVG path: Catmull–Rom (tension 0.5) → cubic Bézier. '' below 3 points. */
export function smoothPath(points: readonly Point[], tension = 0.5): string {
  const segments = splineSegments(points, tension);
  const first = points[0];
  if (!first || segments.length === 0) return '';
  const body = segments
    .map(([, c1, c2, p2]) => `C${n2(c1[0])} ${n2(c1[1])} ${n2(c2[0])} ${n2(c2[1])} ${n2(p2[0])} ${n2(p2[1])}`)
    .join('');
  return `M${n2(first[0])} ${n2(first[1])}${body}Z`;
}

const boxOf = (points: readonly Point[]): Box => {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

/** A box that surely holds the smoothed path: a Bézier lies inside the hull of its control points. */
export const pathBox = (points: readonly Point[]): Box => boxOf(splineSegments(points).flat());

export function unionBox(boxes: readonly Box[]): Box | null {
  if (boxes.length === 0) return null;
  const x = Math.min(...boxes.map((b) => b.x));
  const y = Math.min(...boxes.map((b) => b.y));
  const right = Math.max(...boxes.map((b) => b.x + b.width));
  const bottom = Math.max(...boxes.map((b) => b.y + b.height));
  return { x, y, width: right - x, height: bottom - y };
}

function polygonArea(points: readonly Point[]): number {
  let a = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i] as Point;
    const [x2, y2] = points[(i + 1) % points.length] as Point;
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

/** Area centroid of a simple polygon (the mean of its points when degenerate). */
export function centroid(points: readonly Point[]): Point {
  const area = polygonArea(points);
  if (Math.abs(area) < 1e-9) {
    const sx = points.reduce((s, p) => s + p[0], 0);
    const sy = points.reduce((s, p) => s + p[1], 0);
    return [sx / points.length, sy / points.length];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i] as Point;
    const [x2, y2] = points[(i + 1) % points.length] as Point;
    const f = x1 * y2 - x2 * y1;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  return [cx / (6 * area), cy / (6 * area)];
}

/** Ray casting: is (x, y) inside the polygon? */
export function pointInPolygon(points: readonly Point[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i] as Point;
    const [xj, yj] = points[j] as Point;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// ---- figures and regions -------------------------------------------------------------------------

export interface BodyRegion {
  /** `front-quads-left`. */
  key: string;
  muscle: MuscleId;
  view: BodyView;
  side: 'left' | 'right';
  /** Polygon in the shared frame (the back figure shifted by 120). */
  points: Point[];
  /** Smoothed SVG path. */
  d: string;
  centroid: Point;
  /** Conservative bounds of the drawn path. */
  bbox: Box;
  area: number;
}

export interface BodyFigure {
  view: BodyView;
  /** The silhouette outline (without the head). */
  d: string;
  head: { cx: number; cy: number; rx: number; ry: number };
  caption: { x: number; y: number; text: string };
  /** The figure's drawn area (silhouette + head), for cropping. */
  box: Box;
  bbox: Box;
}

export const offsetOf = (view: BodyView): number => (view === 'back' ? BACK_OFFSET : 0);

/** The full outline: the left half, then its mirror back up (the centre point once). */
const SILHOUETTE: readonly Point[] = [
  ...SILHOUETTE_LEFT,
  ...mirror(SILHOUETTE_LEFT)
    .reverse()
    .filter(([x]) => x !== FIGURE_WIDTH / 2),
];

function buildFigure(view: BodyView): BodyFigure {
  const dx = offsetOf(view);
  const points = shift(SILHOUETTE, dx);
  const head = { cx: HEAD.cx + dx, cy: HEAD.cy, rx: HEAD.rx, ry: HEAD.ry };
  const headBox: Box = { x: head.cx - head.rx, y: head.cy - head.ry, width: head.rx * 2, height: head.ry * 2 };
  const bbox = unionBox([pathBox(points), headBox]) as Box;
  return {
    view,
    d: smoothPath(points),
    head,
    caption: { x: FIGURE_WIDTH / 2 + dx, y: CAPTION_Y, text: CAPTIONS[view] },
    box: { x: dx, y: 0, width: FIGURE_WIDTH, height: FIGURE_BOTTOM },
    bbox,
  };
}

function buildRegions(view: BodyView): BodyRegion[] {
  const dx = offsetOf(view);
  const source = view === 'front' ? FRONT_LEFT : BACK_LEFT;
  const out: BodyRegion[] = [];
  for (const [muscle, left] of source) {
    for (const side of ['left', 'right'] as const) {
      const points = shift(side === 'left' ? left : mirror(left), dx);
      out.push({
        key: `${view}-${muscle}-${side}`,
        muscle,
        view,
        side,
        points,
        d: smoothPath(points),
        centroid: centroid(points),
        bbox: pathBox(points),
        area: Math.abs(polygonArea(points)),
      });
    }
  }
  return out;
}

const FIGURES: Readonly<Record<BodyView, BodyFigure>> = { front: buildFigure('front'), back: buildFigure('back') };
const REGIONS: Readonly<Record<BodyView, readonly BodyRegion[]>> = {
  front: buildRegions('front'),
  back: buildRegions('back'),
};

export const viewsOf = (view: BodyMapView): BodyView[] => (view === 'both' ? ['front', 'back'] : [view]);

/** The silhouettes drawn in a view. */
export const figuresFor = (view: BodyMapView): BodyFigure[] => viewsOf(view).map((v) => FIGURES[v]);

/** Every region drawn in a view (both sides), in the shared frame. */
export const regionsFor = (view: BodyMapView): BodyRegion[] => viewsOf(view).flatMap((v) => REGIONS[v]);

/** viewBox of a full-size map: both figures, or one of them (captions included). */
export function viewBoxFor(view: BodyMapView): string {
  if (view === 'both') return VIEWBOX;
  return `${offsetOf(view)} 0 ${FIGURE_WIDTH} ${VIEWBOX_HEIGHT}`;
}

/** Parses «x y w h». */
export function parseViewBox(viewBox: string): Box {
  const [x = 0, y = 0, width = 0, height = 0] = viewBox.trim().split(/[\s,]+/).map(Number);
  return { x, y, width, height };
}

/** Rough bounds of a caption: centred text, ~0.6 em per character, from the cap height down to the descenders. */
export function captionBox(figure: BodyFigure): Box {
  const width = figure.caption.text.length * CAPTION_SIZE * 0.6;
  return {
    x: figure.caption.x - width / 2,
    y: figure.caption.y - CAPTION_SIZE,
    width,
    height: CAPTION_SIZE * 1.25,
  };
}

// ---- views, cropping, hit testing --------------------------------------------------------------

/** The single view holding most of the primary muscles (a tie, or none, → front). */
export function autoView(primary: readonly MuscleId[]): BodyView {
  let front = 0;
  let back = 0;
  for (const m of primary) {
    if (MUSCLE_VIEW[m].includes('front')) front++;
    if (MUSCLE_VIEW[m].includes('back')) back++;
  }
  return back > front ? 'back' : 'front';
}

/** Start of a `side`-long span inside [min, min + length]: clamped, or centred when it does not fit. */
function place(start: number, min: number, length: number, side: number): number {
  if (side >= length) return min + (length - side) / 2;
  return Math.min(Math.max(start, min), min + length - side);
}

/**
 * The thumbnail crop: the primary muscles' bounds (in `view`, default `autoView`), padded to a square of at least
 * 70 units and moved inside the figure. Without primary muscles: the whole figure, centred.
 */
export function thumbBox(primary: readonly MuscleId[], view: BodyView = autoView(primary)): Box {
  const figure = FIGURES[view];
  const fig = figure.box;
  const regions = REGIONS[view].filter((r) => primary.includes(r.muscle));
  const target = unionBox(regions.map((r) => r.bbox)) ?? figure.bbox;
  const side = Math.min(
    Math.max(THUMB_MIN_SIDE, target.width + 2 * THUMB_PAD, target.height + 2 * THUMB_PAD),
    fig.height,
  );
  const cx = target.x + target.width / 2;
  const cy = target.y + target.height / 2;
  return {
    x: place(cx - side / 2, fig.x, fig.width, side),
    y: place(cy - side / 2, fig.y, fig.height, side),
    width: side,
    height: side,
  };
}

const n1 = (v: number): string => String(Math.round(v * 10) / 10);

/** `thumbBox` as a viewBox string. */
export function thumbViewBox(primary: readonly MuscleId[], view?: BodyView): string {
  const b = thumbBox(primary, view);
  return `${n1(b.x)} ${n1(b.y)} ${n1(b.width)} ${n1(b.height)}`;
}

/** Client (CSS px) → viewBox coordinates of an SVG drawn with the default `xMidYMid meet`. Null when not laid out. */
export function clientToViewBox(
  rect: { left: number; top: number; width: number; height: number },
  viewBox: string,
  clientX: number,
  clientY: number,
): Point | null {
  const vb = parseViewBox(viewBox);
  if (rect.width <= 0 || rect.height <= 0 || vb.width <= 0 || vb.height <= 0) return null;
  const scale = Math.min(rect.width / vb.width, rect.height / vb.height);
  const left = rect.left + (rect.width - vb.width * scale) / 2;
  const top = rect.top + (rect.height - vb.height * scale) / 2;
  return [vb.x + (clientX - left) / scale, vb.y + (clientY - top) / scale];
}

/**
 * The muscle under (x, y) in a view's frame (the smallest region wins where two touch); else the region whose
 * centre is nearest, within 12 units (small muscles are hard to hit); else null.
 */
export function hitTest(view: BodyMapView, x: number, y: number): MuscleId | null {
  const regions = [...regionsFor(view)].sort((a, b) => a.area - b.area);
  const inside = regions.find((r) => pointInPolygon(r.points, x, y));
  if (inside) return inside.muscle;
  let best: BodyRegion | null = null;
  let bestDist = HIT_RADIUS;
  for (const r of regions) {
    const dist = Math.hypot(r.centroid[0] - x, r.centroid[1] - y);
    if (dist <= bestDist) {
      best = r;
      bestDist = dist;
    }
  }
  return best?.muscle ?? null;
}

// ---- muscle state ------------------------------------------------------------------------------

export interface MuscleState {
  primary: MuscleId[];
  secondary: MuscleId[];
}

export type MuscleRole = 'primary' | 'secondary' | 'none';

export const MAX_PRIMARY = 6;
export const MAX_SECONDARY = 8;

export const roleOf = (state: MuscleState, muscle: MuscleId): MuscleRole =>
  state.primary.includes(muscle) ? 'primary' : state.secondary.includes(muscle) ? 'secondary' : 'none';

/**
 * One tap: not used → primary → secondary → not used. The lists stay disjoint and within their limits (6 / 8): a
 * full primary list sends a new muscle straight to secondary; a full secondary list skips that step.
 */
export function cycleMuscle(state: MuscleState, muscle: MuscleId): MuscleState {
  const primary = state.primary.filter((m) => m !== muscle);
  const secondary = state.secondary.filter((m) => m !== muscle);
  switch (roleOf(state, muscle)) {
    case 'none':
      if (primary.length < MAX_PRIMARY) return { primary: [...primary, muscle], secondary };
      if (secondary.length < MAX_SECONDARY) return { primary, secondary: [...secondary, muscle] };
      return { primary, secondary };
    case 'primary':
      if (secondary.length < MAX_SECONDARY) return { primary, secondary: [...secondary, muscle] };
      return { primary, secondary };
    case 'secondary':
      return { primary, secondary };
  }
}

const lower = (text: string): string => text.toLocaleLowerCase('uk');

/** «Квадрицепс, сідниці» (the first label as is, the rest lower-case); '' for none. */
export function muscleList(muscles: readonly MuscleId[]): string {
  return muscles.map((m, i) => (i === 0 ? MUSCLE_LABELS[m] : lower(MUSCLE_LABELS[m]))).join(', ');
}

/** Text alternative of a map: «Основні мʼязи: квадрицепс, сідниці. Допоміжні: поперек.» */
export function muscleSpeech(primary: readonly MuscleId[], secondary: readonly MuscleId[] = []): string {
  const say = (ms: readonly MuscleId[]) => ms.map((m) => lower(MUSCLE_LABELS[m])).join(', ');
  const parts: string[] = [];
  if (primary.length > 0) parts.push(`Основні мʼязи: ${say(primary)}.`);
  if (secondary.length > 0) parts.push(`Допоміжні: ${say(secondary)}.`);
  return parts.length > 0 ? parts.join(' ') : 'Мʼязи не вказано';
}
