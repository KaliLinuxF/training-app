/**
 * The open sheets, bottom to top. A sheet opened while another one is open (a second window, e.g. one
 * food position over the day sheet) stacks above it: a higher z-index, and it is the only *live* sheet,
 * the one that reacts to Escape, backdrop presses and drag-down. Every sheet under a live one is made
 * `inert` (no focus, no pointer, hidden from assistive tech) until the sheet above starts closing.
 *
 * A closing sheet keeps its place (and z-index) while it animates out, but it no longer covers anything:
 * the sheet under it is live again (focus can go back there). Its backdrop still swallows taps until it
 * unmounts (Sheet.module.css `.closing`), so a quick second tap cannot reach that sheet.
 *
 * A sheet rendered inside another sheet's content always sits above that sheet, even when both mount in
 * the same commit (effects run child-first); sibling sheets stack in the order they open.
 */

interface Layer {
  readonly id: string;
  /** Ids of the sheets this one is rendered inside (React tree), outermost first. */
  readonly ancestors: readonly string[];
  /** Backdrop: the element made `inert` while covered. */
  readonly root: HTMLElement | null;
  /** Dialog panel: where focus goes when the sheet above closes and its opener is gone. */
  readonly panel: HTMLElement | null;
  closing: boolean;
}

const layers: Layer[] = [];
const listeners = new Set<() => void>();

/** z-index of the bottom sheet (as in Sheet.module.css); each sheet above it adds 2. */
export const SHEET_Z_BASE = 60;
/** Highest sheet z-index: below the photo viewer (70), the toast (80) and `ui.confirm()` (90). */
export const SHEET_Z_MAX = 68;

export function sheetZIndex(depth: number): number {
  return Math.min(SHEET_Z_BASE + depth * 2, SHEET_Z_MAX);
}

function find(id: string): number {
  return layers.findIndex((layer) => layer.id === id);
}

/** Where `id` sits, or would go once registered: under any sheet rendered inside it, else on top. */
function position(id: string): number {
  const i = find(id);
  if (i >= 0) return i;
  const child = layers.findIndex((layer) => layer.ancestors.includes(id));
  return child >= 0 ? child : layers.length;
}

function coveredAt(index: number): boolean {
  return layers.slice(index + 1).some((layer) => !layer.closing);
}

function changed(): void {
  layers.forEach((layer, i) => layer.root?.toggleAttribute('inert', coveredAt(i)));
  for (const listener of [...listeners]) listener();
}

/** Adds a sheet to the stack; the returned function removes it again. */
export function enterSheetStack(
  id: string,
  ancestors: readonly string[],
  root: HTMLElement | null,
  panel: HTMLElement | null,
): () => void {
  if (find(id) >= 0) return () => undefined;
  const layer: Layer = { id, ancestors, root, panel, closing: false };
  layers.splice(position(id), 0, layer);
  changed();
  return () => {
    const i = layers.indexOf(layer);
    if (i < 0) return;
    layers.splice(i, 1);
    layer.root?.removeAttribute('inert');
    changed();
  };
}

/** A closing sheet stops covering the sheets under it (they become live again at once). */
export function setSheetClosing(id: string, closing: boolean): void {
  const layer = layers[find(id)];
  if (!layer || layer.closing === closing) return;
  layer.closing = closing;
  changed();
}

/** 0 for the bottom (or only) sheet, 1 for a sheet over it, … */
export function sheetDepth(id: string): number {
  return position(id);
}

/** A sheet that is not closing sits above this one. */
export function isSheetCovered(id: string): boolean {
  return coveredAt(position(id));
}

/** Open, not closing and not covered: the sheet that reacts to Escape, backdrop and drag. */
export function isSheetLive(id: string): boolean {
  const layer = layers[find(id)];
  return layer !== undefined && !layer.closing && !isSheetCovered(id);
}

/** Panel of the sheet right under this one, if any. */
export function panelBelow(id: string): HTMLElement | null {
  return layers[position(id) - 1]?.panel ?? null;
}

export function subscribeSheetStack(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
