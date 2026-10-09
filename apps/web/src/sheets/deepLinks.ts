/**
 * Sheet deep links, opened for today (plan §3.3). Push notifications use `DEEP_LINKS` in
 * @legko/shared, which stay as they are: `/?sheet=day&trained=1` (the workout push, a legacy alias
 * of «Тренування» with ✓), `/?sheet=weight`, `/?sheet=measure`. The app also understands
 * `/?sheet=day` (the full «Запис дня»), `/?sheet=food` and `/?sheet=workout[&trained=1]`.
 * The menu, setup and install sheets are not linkable.
 */
import type { SheetPatch } from '@/store/ui';
import type { RecordMode } from './record/model';

const SHEET_PARAM = 'sheet';
const TRAINED_PARAM = 'trained';
const LINK_MODES: readonly RecordMode[] = ['day', 'food', 'workout', 'weight', 'measure'];

export interface SheetDeepLink {
  mode: RecordMode;
  patch?: SheetPatch;
}

const isLinkMode = (v: string | null): v is RecordMode => LINK_MODES.some((m) => m === v);

/** `search` with or without the leading «?». Unknown sheets are ignored (`null`). */
export function parseSheetDeepLink(search: string): SheetDeepLink | null {
  const params = new URLSearchParams(search);
  const mode = params.get(SHEET_PARAM);
  if (!isLinkMode(mode)) return null;
  // `trained` only means something for the workout; other sheets ignore it.
  const trained = params.get(TRAINED_PARAM) === '1';
  // Pushes already delivered (and the server's DEEP_LINKS.workout) say `sheet=day&trained=1`.
  if (mode === 'day' && trained) return { mode: 'workout', patch: { trained: true } };
  if (mode === 'workout' && trained) return { mode, patch: { trained: true } };
  return { mode };
}

/** The URL to replace the current one with: same path, the deep-link params removed. */
export function urlWithoutDeepLink(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete(SHEET_PARAM);
  params.delete(TRAINED_PARAM);
  const rest = params.toString();
  return rest ? `${pathname}?${rest}` : pathname;
}

/** Whether the search string carries the `sheet` param at all (valid or not) and needs cleaning. */
export const hasDeepLinkParams = (search: string): boolean => new URLSearchParams(search).has(SHEET_PARAM);
