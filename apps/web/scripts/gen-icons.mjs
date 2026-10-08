#!/usr/bin/env node
/**
 * Generates the app icons from the sidebar logo: «Л» in Manrope 700 on the solid ink colour.
 * The glyph is converted to an SVG path (no font needed at render time), then rasterised with sharp.
 *
 *   pnpm --filter @legko/web icons
 *
 * Outputs (apps/web/public): favicon.svg, apple-touch-icon.png, icons/icon-192.png, icons/icon-512.png,
 * icons/maskable-512.png, icons/badge-96.png.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';

const BG = '#1E2229'; // --solid (light theme)
const FG = '#F7F9FB'; // --onSolid (light theme)
const GLYPH = 'Л';
const FONT_FILE = '@fontsource/manrope/files/manrope-cyrillic-700-normal.woff';

/** Design canvas; every icon is drawn in a 512×512 viewBox and scaled by the renderer. */
const VIEW = 512;
/** Corner radius of the rounded-square icons, as a share of the side (≈ iOS / sidebar logo look). */
const RADIUS = 0.22;
/**
 * Glyph height (its bounding box) as a share of the canvas.
 * Maskable icons must keep the glyph inside the central 80% circle, so they use a smaller glyph.
 */
const GLYPH_HEIGHT = { any: 0.44, maskable: 0.36, badge: 0.7 };
/**
 * Optical correction: the bounding-box centre of «Л» looks slightly low and slightly left
 * (the left leg's foot curls outwards), so the glyph is nudged up and right by a hair.
 */
const OPTICAL = { dx: 0.004, dy: -0.006 };

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');

async function loadFont() {
  const require = createRequire(import.meta.url);
  const file = require.resolve(FONT_FILE);
  const buf = await readFile(file);
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/**
 * SVG path data for the glyph, scaled so its bounding box is `height` units tall
 * and centred (with the optical nudge) on (`cx`, `cy`).
 */
function glyphPathData(font, { height, cx, cy }) {
  const glyph = font.charToGlyph(GLYPH);
  if (!glyph || glyph.index === 0) throw new Error(`The font has no glyph for «${GLYPH}»`);

  const REF = 1000;
  const ref = glyph.getPath(0, 0, REF).getBoundingBox();
  const fontSize = (height / (ref.y2 - ref.y1)) * REF;
  const k = fontSize / REF;
  const x = cx + OPTICAL.dx * VIEW - ((ref.x1 + ref.x2) / 2) * k;
  const y = cy + OPTICAL.dy * VIEW - ((ref.y1 + ref.y2) / 2) * k;

  // getPath() already returns SVG (y-down) coordinates, so no flipping.
  return glyph.getPath(x, y, fontSize).toPathData({ decimalPlaces: 2, flipY: false });
}

function svgDoc(size, body) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEW} ${VIEW}">${body}</svg>\n`;
}

const roundedSquare = () => {
  const r = Math.round(VIEW * RADIUS);
  return `<rect width="${VIEW}" height="${VIEW}" rx="${r}" ry="${r}" fill="${BG}"/>`;
};
const fullSquare = () => `<rect width="${VIEW}" height="${VIEW}" fill="${BG}"/>`;
const glyphEl = (font, height, fill) =>
  `<path fill="${fill}" d="${glyphPathData(font, { height: VIEW * height, cx: VIEW / 2, cy: VIEW / 2 })}"/>`;

function iconSpecs(font) {
  const anyGlyph = glyphEl(font, GLYPH_HEIGHT.any, FG);
  const rounded = (size) => svgDoc(size, roundedSquare() + anyGlyph);
  const square = (size, glyphHeight) => svgDoc(size, fullSquare() + glyphEl(font, glyphHeight, FG));

  return [
    { file: 'favicon.svg', svg: rounded(64), raster: false },
    { file: 'icons/icon-192.png', svg: rounded(192), size: 192 },
    { file: 'icons/icon-512.png', svg: rounded(512), size: 512 },
    { file: 'icons/maskable-512.png', svg: square(512, GLYPH_HEIGHT.maskable), size: 512, opaque: true },
    // iOS masks the icon itself and paints transparency black, so: full-bleed and opaque.
    { file: 'apple-touch-icon.png', svg: square(180, GLYPH_HEIGHT.any), size: 180, opaque: true },
    // Monochrome silhouette for the status bar (Android uses only the alpha channel).
    { file: 'icons/badge-96.png', svg: svgDoc(96, glyphEl(font, GLYPH_HEIGHT.badge, '#FFFFFF')), size: 96 },
  ];
}

async function render(spec) {
  const out = join(publicDir, spec.file);
  await mkdir(dirname(out), { recursive: true });
  if (spec.raster === false) {
    await writeFile(out, spec.svg, 'utf8');
    return out;
  }
  let img = sharp(Buffer.from(spec.svg)).resize(spec.size, spec.size);
  if (spec.opaque) img = img.flatten({ background: BG }).removeAlpha();
  await img.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(out);
  return out;
}

async function main() {
  const font = await loadFont();
  for (const spec of iconSpecs(font)) {
    const out = await render(spec);
    console.log(`  ${relative(process.cwd(), out)}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
