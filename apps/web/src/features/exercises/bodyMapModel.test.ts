import { MUSCLE_VIEW, MUSCLES, type MuscleId } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import {
  autoView,
  BACK_OFFSET,
  captionBox,
  centroid,
  clientToViewBox,
  cycleMuscle,
  figuresFor,
  HIT_RADIUS,
  hitTest,
  MAX_PRIMARY,
  MAX_SECONDARY,
  mirror,
  muscleList,
  muscleSpeech,
  parseViewBox,
  pointInPolygon,
  regionsFor,
  smoothPath,
  splineSegments,
  THUMB_MIN_SIDE,
  thumbBox,
  thumbViewBox,
  VIEWBOX,
  viewBoxFor,
  type Box,
  type MuscleState,
  type Point,
} from './bodyMapModel';

const inside = (inner: Box, outer: Box): boolean =>
  inner.x >= outer.x - 1e-9 &&
  inner.y >= outer.y - 1e-9 &&
  inner.x + inner.width <= outer.x + outer.width + 1e-9 &&
  inner.y + inner.height <= outer.y + outer.height + 1e-9;

describe('geometry helpers', () => {
  it('mirror reflects a left-half list across the centre line x = 50', () => {
    const pts: Point[] = [
      [30, 10],
      [49, 20],
    ];
    expect(mirror(pts)).toEqual([
      [70, 10],
      [51, 20],
    ]);
    expect(mirror(mirror(pts))).toEqual(pts);
  });

  it('smoothPath is a closed Catmull–Rom spline through every point (one cubic per point)', () => {
    const square: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    const d = smoothPath(square);
    expect(d.startsWith('M0 0C')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d.match(/C/g)).toHaveLength(4);
    // Each segment ends on the next point; tension 0.5 → control points a sixth of the neighbour chord away.
    const segs = splineSegments(square);
    expect(segs.map((seg) => seg[3])).toEqual([
      [10, 0],
      [10, 10],
      [0, 10],
      [0, 0],
    ]);
    const [p1, c1] = segs[0]!;
    expect(p1).toEqual([0, 0]);
    expect(c1[0]).toBeCloseTo((10 - 0) / 6);
    expect(c1[1]).toBeCloseTo((0 - 10) / 6);
    expect(smoothPath([[0, 0]])).toBe('');
  });

  it('centroid and point-in-polygon', () => {
    const sq: Point[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [0, 10],
    ];
    expect(centroid(sq)).toEqual([5, 5]);
    expect(pointInPolygon(sq, 5, 5)).toBe(true);
    expect(pointInPolygon(sq, 11, 5)).toBe(false);
  });
});

describe('figures and regions', () => {
  it('both views: front at x 0–100, back at x 120–220 in viewBox «0 0 220 232»', () => {
    expect(VIEWBOX).toBe('0 0 220 232');
    expect(viewBoxFor('both')).toBe(VIEWBOX);
    expect(viewBoxFor('front')).toBe('0 0 100 232');
    expect(viewBoxFor('back')).toBe(`${BACK_OFFSET} 0 100 232`);
    expect(figuresFor('both').map((f) => [f.view, f.box.x])).toEqual([
      ['front', 0],
      ['back', 120],
    ]);
    expect(figuresFor('both').map((f) => f.caption)).toEqual([
      { x: 50, y: 228, text: 'Спереду' },
      { x: 170, y: 228, text: 'Ззаду' },
    ]);
  });

  it('every region, silhouette and caption lies inside the viewBox; silhouettes end by y 206', () => {
    for (const view of ['both', 'front', 'back'] as const) {
      const vb = parseViewBox(viewBoxFor(view));
      for (const r of regionsFor(view)) expect(inside(r.bbox, vb), `${r.key} in ${view}`).toBe(true);
      for (const f of figuresFor(view)) {
        expect(inside(f.bbox, vb), `${f.view} silhouette`).toBe(true);
        expect(inside(captionBox(f), vb), `${f.view} caption`).toBe(true);
        expect(f.bbox.y + f.bbox.height).toBeLessThanOrEqual(f.caption.y - 9);
      }
    }
  });

  it('each muscle is drawn (both sides) exactly in the views of MUSCLE_VIEW', () => {
    for (const m of MUSCLES) {
      for (const view of ['front', 'back'] as const) {
        const sides = regionsFor(view)
          .filter((r) => r.muscle === m)
          .map((r) => r.side);
        expect(sides, `${m} ${view}`).toEqual(MUSCLE_VIEW[m].includes(view) ? ['left', 'right'] : []);
      }
    }
    expect(new Set(regionsFor('both').map((r) => r.key)).size).toBe(regionsFor('both').length);
  });

  it('right regions mirror the left ones; back regions sit in the back figure', () => {
    for (const r of regionsFor('both')) {
      const fig = r.view === 'back' ? { x: 120, y: 0, width: 100, height: 206 } : { x: 0, y: 0, width: 100, height: 206 };
      expect(inside(r.bbox, { ...fig, x: fig.x - 2, width: fig.width + 4 }), r.key).toBe(true);
      expect((r.side === 'left') === r.centroid[0] - (r.view === 'back' ? 120 : 0) < 50, r.key).toBe(true);
    }
  });
});

describe('autoView and thumbViewBox', () => {
  it('autoView: the view with most primary muscles; a tie or nothing → front', () => {
    expect(autoView(['glutes', 'hamstrings'])).toBe('back');
    expect(autoView(['chest', 'triceps'])).toBe('front');
    expect(autoView(['quads', 'glutes'])).toBe('front');
    expect(autoView(['lats'])).toBe('back');
    expect(autoView([])).toBe('front');
  });

  it('a square of at least 70 units around the primary muscles, inside the figure', () => {
    const cases: [MuscleId[], 'front' | 'back'][] = [
      [['chest'], 'front'],
      [['calves'], 'back'],
      [['forearms'], 'front'],
      [['quads', 'glutes'], 'front'],
      [['traps'], 'back'],
    ];
    for (const [primary, view] of cases) {
      const box = thumbBox(primary, view);
      const figX = view === 'back' ? 120 : 0;
      expect(box.width).toBe(box.height);
      expect(box.width).toBeGreaterThanOrEqual(THUMB_MIN_SIDE);
      expect(box.x).toBeGreaterThanOrEqual(figX);
      expect(box.x + box.width).toBeLessThanOrEqual(figX + 100 + 1e-9);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.y + box.height).toBeLessThanOrEqual(206 + 1e-9);
      for (const r of regionsFor(view).filter((x) => primary.includes(x.muscle)))
        expect(inside(r.bbox, box), `${r.key} in thumb`).toBe(true);
    }
  });

  it('chest crops the upper body; calves the lower legs; nothing → the whole figure, centred', () => {
    const chest = thumbBox(['chest']);
    expect(chest.y).toBeLessThan(20);
    const calves = thumbBox(['calves'], 'back');
    expect(calves.y + calves.height).toBeGreaterThan(180);
    const none = thumbBox([]);
    expect(none.width).toBe(206);
    expect(none.x).toBeCloseTo(-53);
    expect(thumbViewBox(['chest'])).toMatch(/^[\d.-]+ [\d.-]+ 70 70$/);
  });
});

describe('hitTest', () => {
  const centre = (key: string): Point => regionsFor('both').find((r) => r.key === key)!.centroid;

  it('the region under the point', () => {
    const [x, y] = centre('front-quads-left');
    expect(hitTest('both', x, y)).toBe('quads');
    const [bx, by] = centre('back-glutes-right');
    expect(hitTest('both', bx, by)).toBe('glutes');
    expect(hitTest('back', bx, by)).toBe('glutes');
  });

  it('small regions: the nearest centre within 12 units, else nothing', () => {
    const [x, y] = centre('front-adductors-left');
    // Just outside the thin adductor strip, towards the centre line.
    expect(hitTest('front', 49.7, y)).toBe('adductors');
    expect(hitTest('front', x, y)).toBe('adductors');
    // Far from every region (the space between the figures, the head).
    expect(hitTest('both', 110, 100)).toBeNull();
    expect(hitTest('front', 50, 4)).toBeNull();
    // On the shin below the calf region, ~26 units from its centre: beyond the 12-unit radius.
    const [cx, cy] = centre('front-calves-left');
    expect(HIT_RADIUS).toBe(12);
    expect(hitTest('front', cx - 6, cy + 25)).toBeNull();
  });

  it('maps client coordinates through the meet-scaled viewBox', () => {
    // 440×232 px for a 220×232 box: scale 1, 110px bars at the sides.
    expect(clientToViewBox({ left: 0, top: 0, width: 440, height: 232 }, VIEWBOX, 110 + 50, 100)).toEqual([50, 100]);
    // 110×116 px: scale 0.5.
    expect(clientToViewBox({ left: 10, top: 20, width: 110, height: 116 }, VIEWBOX, 10 + 85, 20 + 50)).toEqual([170, 100]);
    expect(clientToViewBox({ left: 0, top: 0, width: 0, height: 0 }, VIEWBOX, 1, 1)).toBeNull();
  });
});

describe('cycleMuscle', () => {
  const none: MuscleState = { primary: [], secondary: [] };

  it('not used → primary → secondary → not used, lists kept disjoint', () => {
    const a = cycleMuscle(none, 'quads');
    expect(a).toEqual({ primary: ['quads'], secondary: [] });
    const b = cycleMuscle(a, 'quads');
    expect(b).toEqual({ primary: [], secondary: ['quads'] });
    const c = cycleMuscle(b, 'quads');
    expect(c).toEqual(none);
    const both = cycleMuscle(cycleMuscle(none, 'glutes'), 'quads');
    expect(cycleMuscle(both, 'glutes')).toEqual({ primary: ['quads'], secondary: ['glutes'] });
  });

  it('respects the limits: a full primary list sends a muscle straight to secondary', () => {
    const fullPrimary: MuscleState = { primary: MUSCLES.slice(0, MAX_PRIMARY), secondary: [] };
    expect(cycleMuscle(fullPrimary, 'calves')).toEqual({ ...fullPrimary, secondary: ['calves'] });
    const full: MuscleState = {
      primary: MUSCLES.slice(0, MAX_PRIMARY),
      secondary: MUSCLES.slice(MAX_PRIMARY, MAX_PRIMARY + MAX_SECONDARY),
    };
    const last = MUSCLES[MUSCLES.length - 1]!;
    expect(cycleMuscle(full, last)).toEqual(full);
    // A primary one with a full secondary list goes back to not used.
    const first = MUSCLES[0]!;
    expect(cycleMuscle(full, first)).toEqual({ ...full, primary: full.primary.filter((m) => m !== first) });
  });
});

describe('speech', () => {
  it('names the muscles in lower case, primary first', () => {
    expect(muscleSpeech(['quads', 'glutes'], ['hamstrings', 'lowerBack'])).toBe(
      'Основні мʼязи: квадрицепс, сідниці. Допоміжні: задня поверхня стегна, поперек.',
    );
    expect(muscleSpeech(['abs'])).toBe('Основні мʼязи: прес.');
    expect(muscleSpeech([], [])).toBe('Мʼязи не вказано');
  });

  it('muscleList capitalises only the first label', () => {
    expect(muscleList(['quads', 'glutes'])).toBe('Квадрицепс, сідниці');
    expect(muscleList([])).toBe('');
  });
});
