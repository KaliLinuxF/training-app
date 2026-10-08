/**
 * Defensive shaping of data that comes from outside this page: the server copy and the
 * device cache (which may have been written by an older app version).
 */
import { normalizeSettings, opSchema, type AppData, type Op } from '@legko/shared';

/** An op waiting for the server. The id is local only: it identifies what a request carried. */
export interface OutboxItem {
  id: string;
  op: Op;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const byDate = <T extends { date: string }>(a: T, b: T): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : 0;

/** Fills in missing parts and restores the sort order the stats rely on. */
export function normalizeAppData(input: Partial<AppData> | null | undefined): AppData {
  const src = input ?? {};
  return {
    days: isRecord(src.days) ? { ...src.days } : {},
    weights: Array.isArray(src.weights) ? [...src.weights].sort(byDate) : [],
    measures: Array.isArray(src.measures) ? [...src.measures].sort(byDate) : [],
    foods: Array.isArray(src.foods) ? [...src.foods] : [],
    settings: normalizeSettings(isRecord(src.settings) ? src.settings : undefined),
  };
}

/** Cached `legko.data` → AppData, or `null` when nothing usable is stored. */
export function parseCachedData(raw: unknown): AppData | null {
  return isRecord(raw) ? normalizeAppData(raw as Partial<AppData>) : null;
}

/** Cached `legko.outbox` → valid items only (an op the schema rejects would be rejected by the server too). */
export function parseOutbox(raw: unknown): OutboxItem[] {
  if (!Array.isArray(raw)) return [];
  const items: OutboxItem[] = [];
  for (const entry of raw) {
    if (!isRecord(entry) || typeof entry.id !== 'string') continue;
    const parsed = opSchema.safeParse(entry.op);
    if (parsed.success) items.push({ id: entry.id, op: parsed.data });
  }
  return items;
}

/** Random id for an outbox item; `randomUUID` is missing outside secure contexts (LAN dev over http). */
export function newOutboxId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}
