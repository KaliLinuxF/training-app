/**
 * Deep links used by push notifications (SPEC §3.5, `DEEP_LINKS` in @legko/shared):
 * `/?sheet=day&trained=1`, `/?sheet=weight`, `/?sheet=measure` open that sheet for today.
 */
import type { SheetPatch } from '@/store/ui';
import type { RecordMode } from './record/model';

const SHEET_PARAM = 'sheet';
const TRAINED_PARAM = 'trained';
const LINK_MODES: readonly RecordMode[] = ['day', 'weight', 'measure'];

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
  // `trained` only makes sense for the day record.
  return mode === 'day' && params.get(TRAINED_PARAM) === '1' ? { mode, patch: { trained: true } } : { mode };
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
