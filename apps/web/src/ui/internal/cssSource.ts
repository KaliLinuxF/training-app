/**
 * Test-only: read the kit's CSS sources and the design tokens so unit tests can check contracts that
 * jsdom cannot render (contrast of token pairs, tap-target sizes, media queries). Not imported by app code.
 *
 * Vitest hands CSS imports (even `?raw`) to its CSS-module stub, so the files are read from disk. The web
 * tsconfig has no Node types (app code must not use them), hence the narrow local typing of the two calls.
 */

interface NodeFs {
  readFileSync(path: string, encoding: 'utf8'): string;
}

const node = (globalThis as unknown as { process: { getBuiltinModule(id: 'node:fs'): NodeFs } }).process;
/** `apps/web/src/` (this file lives in `src/ui/internal/`). */
const SRC = `${(import.meta as ImportMeta & { dirname: string }).dirname}/../../`;

/** Contents of a stylesheet, path relative to `apps/web/src` («ui/controls/Button.module.css»). */
export function readCss(path: string): string {
  return node.getBuiltinModule('node:fs').readFileSync(SRC + path, 'utf8');
}

export interface CssRule {
  /** Normalised selector list («.hero, .solid»). */
  selector: string;
  /** `@media` condition the rule sits in, or null. */
  media: string | null;
  decls: Record<string, string>;
}

/** Flat list of style rules (one level of `@media` nesting, which is all the kit uses). */
export function cssRules(css: string): CssRule[] {
  const out: CssRule[] = [];
  const walk = (text: string, media: string | null) => {
    let i = 0;
    for (;;) {
      const open = text.indexOf('{', i);
      if (open < 0) return;
      const prelude = text.slice(i, open).trim().replace(/\s+/g, ' ');
      let depth = 1;
      let j = open + 1;
      for (; j < text.length && depth > 0; j++) {
        if (text[j] === '{') depth++;
        else if (text[j] === '}') depth--;
      }
      const body = text.slice(open + 1, j - 1);
      if (prelude.startsWith('@media')) walk(body, prelude.slice('@media'.length).trim());
      else if (!prelude.startsWith('@')) out.push({ selector: prelude, media, decls: declarations(body) });
      i = j;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), null);
  return out;
}

function declarations(body: string): Record<string, string> {
  const decls: Record<string, string> = {};
  for (const part of body.split(';')) {
    const colon = part.indexOf(':');
    if (colon < 0) continue;
    decls[part.slice(0, colon).trim()] = part
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, ' ');
  }
  return decls;
}

/**
 * Value of `prop` for `selector` (one entry of a selector list), the last declaration winning,
 * as in the cascade. `media` picks rules inside that `@media` condition (default: outside any).
 */
export function cssValue(
  css: string,
  selector: string,
  prop: string,
  media: string | null = null,
): string | undefined {
  let value: string | undefined;
  for (const rule of cssRules(css)) {
    if (rule.media !== media) continue;
    if (!rule.selector.split(',').some((sel) => sel.trim() === selector)) continue;
    if (prop in rule.decls) value = rule.decls[prop];
  }
  return value;
}

/** `var(--name)` → `name`. */
export function tokenName(value: string | undefined): string {
  const m = /^var\(--([\w-]+)\)$/.exec(value ?? '');
  if (!m?.[1]) throw new Error(`expected a single token reference, got «${value}»`);
  return m[1];
}

/** Pixels of a `NNpx` length (0 for `0`). */
export function px(value: string | undefined): number {
  if (value === '0') return 0;
  const m = /^(-?\d+(?:\.\d+)?)px$/.exec(value ?? '');
  if (!m?.[1]) throw new Error(`expected a px length, got «${value}»`);
  return Number(m[1]);
}

// ---- tokens & contrast ---------------------------------------------------------------------

export type Theme = 'light' | 'dark';
export type TokenMap = Record<string, string>;

const tokensOf = (rule: CssRule | undefined): TokenMap =>
  Object.fromEntries(
    Object.entries(rule?.decls ?? {})
      .filter(([k]) => k.startsWith('--'))
      .map(([k, v]) => [k.slice(2), v]),
  );

/** Raw token declarations of each theme block in `styles/tokens.css`. */
export function themeBlocks(): { light: TokenMap; darkAuto: TokenMap; dark: TokenMap } {
  const rules = cssRules(readCss('styles/tokens.css'));
  const find = (selector: string, media: string | null) =>
    rules.find((r) => r.selector === selector && r.media === media);
  return {
    light: tokensOf(find(':root', null)),
    darkAuto: tokensOf(find(":root:not([data-theme='light'])", '(prefers-color-scheme: dark)')),
    dark: tokensOf(find(":root[data-theme='dark']", null)),
  };
}

/** Token values of a theme with `var(--x)` references resolved (dark = light overridden by the dark block). */
export function themeTokens(theme: Theme): TokenMap {
  const { light, dark } = themeBlocks();
  const raw = theme === 'light' ? light : { ...light, ...dark };
  const resolveValue = (value: string, seen: string[]): string =>
    value.replace(/var\(--([\w-]+)\)/g, (_, name: string) => {
      const next = raw[name];
      if (next === undefined || seen.includes(name)) throw new Error(`unresolvable token --${name}`);
      return resolveValue(next, [...seen, name]);
    });
  return Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, resolveValue(v, [k])]));
}

type Rgb = [number, number, number];

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

/** Linear-light sRGB of a `#rrggbb` or `oklch(L C h)` colour (out-of-gamut channels clipped). */
export function linearRgb(color: string): Rgb {
  const hex = /^#([\da-f]{6})$/i.exec(color);
  if (hex?.[1]) {
    const n = parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => toLinear(c / 255)) as Rgb;
  }
  const ok = /^oklch\(([\d.]+) ([\d.]+) ([\d.]+)\)$/.exec(color);
  if (ok) {
    const [L, C, h] = ok.slice(1).map(Number) as [number, number, number];
    const a = C * Math.cos((h * Math.PI) / 180);
    const b = C * Math.sin((h * Math.PI) / 180);
    const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
    const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
    const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
    return [
      4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
    ].map((x) => Math.min(1, Math.max(0, x))) as Rgb;
  }
  throw new Error(`unsupported colour «${color}»`);
}

/** WCAG 2 contrast ratio of two opaque colours. */
export function contrast(a: string, b: string): number {
  const lum = ([r, g, bl]: Rgb) => 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  const [hi, lo] = [lum(linearRgb(a)), lum(linearRgb(b))].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}
