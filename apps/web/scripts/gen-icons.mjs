#!/usr/bin/env node
/**
 * Generates the «Home Fit» app icons and the in-app brand mark from one design: a lavender roof chevron over
 * the «HF» monogram (Manrope 800) on the solid ink colour. The letters are converted to SVG paths (no font
 * needed at render time), then rasterised with sharp.
 *
 *   pnpm --filter @legko/web icons
 *
 * Outputs: apps/web/public/{favicon.svg, apple-touch-icon.png, icons/icon-192.png, icons/icon-512.png,
 * icons/maskable-512.png, icons/badge-96.png} and apps/web/src/shell/brandMark.generated.ts.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import opentype from 'opentype.js';
import sharp from 'sharp';

const BG = '#1E2229'; // --solid (light theme)
const FG = '#F7F9FB'; // --onSolid (light theme)
const ROOF = '#B9A8EE'; // lavender accent
const TEXT = 'HF';
const FONT_FILE = '@fontsource/manrope/files/manrope-latin-800-normal.woff';

/** Design units of the mark (as drawn in the logo picker). */
const VIEW = 120;
const RADIUS = 28;
const ROOF_PATH = 'M28 50 L60 26 L92 50';
const ROOF_WIDTH = 7;
const FONT_SIZE = 34;
const TRACKING = -1;
const BASELINE = 88;

const here = dirname(fileURLToPath(import.meta.url));
const publicDir = join(here, '..', 'public');
const generatedTs = join(here, '..', 'src', 'shell', 'brandMark.generated.ts');

async function loadFont() {
  const require = createRequire(import.meta.url);
  const buf = await readFile(require.resolve(FONT_FILE));
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
}

/** «HF» as one path, centred on x = 60 with its baseline at y = 88 (design units). */
function monogramPath(font) {
  const scale = FONT_SIZE / font.unitsPerEm;
  const glyphs = font.stringToGlyphs(TEXT);
  let advance = 0;
  const offsets = glyphs.map((g, i) => {
    const x = advance;
    const kern = i < glyphs.length - 1 ? font.getKerningValue(g, glyphs[i + 1]) * scale : 0;
    advance += g.advanceWidth * scale + kern + (i < glyphs.length - 1 ? TRACKING : 0);
    return x;
  });
  // Centre on the ink (bounding box), not the advance, so the side bearings don't shift it.
  const probe = new opentype.Path();
  glyphs.forEach((g, i) => probe.extend(g.getPath(offsets[i], 0, FONT_SIZE)));
  const box = probe.getBoundingBox();
  const dx = VIEW / 2 - (box.x1 + box.x2) / 2;
  const path = new opentype.Path();
  glyphs.forEach((g, i) => path.extend(g.getPath(offsets[i] + dx, BASELINE, FONT_SIZE)));
  return path.toPathData({ decimalPlaces: 2, flipY: false });
}

/** The mark's content (roof + monogram) scaled by `k` about the centre. */
function content(hf, k, colors = { roof: ROOF, text: FG }) {
  const t = k === 1 ? '' : ` transform="translate(${(VIEW * (1 - k)) / 2} ${(VIEW * (1 - k)) / 2}) scale(${k})"`;
  return (
    `<g${t}><path d="${ROOF_PATH}" fill="none" stroke="${colors.roof}" stroke-width="${ROOF_WIDTH}" ` +
    `stroke-linecap="round" stroke-linejoin="round"/><path d="${hf}" fill="${colors.text}"/></g>`
  );
}

const svgDoc = (size, body) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${VIEW} ${VIEW}">${body}</svg>\n`;
const rounded = `<rect width="${VIEW}" height="${VIEW}" rx="${RADIUS}" ry="${RADIUS}" fill="${BG}"/>`;
const full = `<rect width="${VIEW}" height="${VIEW}" fill="${BG}"/>`;

function iconSpecs(hf) {
  return [
    { file: 'favicon.svg', svg: svgDoc(64, rounded + content(hf, 1)), raster: false },
    { file: 'icons/icon-192.png', svg: svgDoc(192, rounded + content(hf, 1)), size: 192 },
    { file: 'icons/icon-512.png', svg: svgDoc(512, rounded + content(hf, 1)), size: 512 },
    // Maskable: keep everything inside the central 80% safe circle.
    { file: 'icons/maskable-512.png', svg: svgDoc(512, full + content(hf, 0.8)), size: 512, opaque: true },
    // iOS masks the icon itself and paints transparency black, so: full-bleed and opaque.
    { file: 'apple-touch-icon.png', svg: svgDoc(180, full + content(hf, 1)), size: 180, opaque: true },
    // Monochrome silhouette for the status bar (Android uses only the alpha channel).
    {
      file: 'icons/badge-96.png',
      svg: svgDoc(96, content(hf, 1.25, { roof: '#FFFFFF', text: '#FFFFFF' })),
      size: 96,
    },
  ];
}

async function render(spec) {
  const out = join(publicDir, spec.file);
  await mkdir(dirname(out), { recursive: true });
  if (spec.raster === false) {
    await writeFile(out, spec.svg, 'utf8');
    return out;
  }
  let img = sharp(Buffer.from(spec.svg), { density: 300 }).resize(spec.size, spec.size);
  if (spec.opaque) img = img.flatten({ background: BG }).removeAlpha();
  await img.png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(out);
  return out;
}

async function main() {
  const hf = monogramPath(await loadFont());
  for (const spec of iconSpecs(hf)) console.log(`  ${relative(process.cwd(), await render(spec))}`);
  await writeFile(
    generatedTs,
    `// Generated by apps/web/scripts/gen-icons.mjs — do not edit by hand.\n` +
      `/** «Home Fit» mark in ${VIEW}×${VIEW} design units: lavender roof over the «HF» monogram. */\n` +
      `export const BRAND_VIEW = ${VIEW};\n` +
      `export const BRAND_RADIUS = ${RADIUS};\n` +
      `export const ROOF_PATH = '${ROOF_PATH}';\n` +
      `export const ROOF_WIDTH = ${ROOF_WIDTH};\n` +
      `export const HF_PATH =\n  '${hf}';\n`,
    'utf8',
  );
  console.log(`  ${relative(process.cwd(), generatedTs)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
