/**
 * Editable estimate rows (SPEC §3.7 «Result card»): her edits of name, portion and kcal, what the
 * device rescales by itself and what waits for «✨ Перерахувати». Pure; the estimate reducer uses it.
 */
import { LIMITS, type FoodEstimateItem, type FoodRecalcItem } from '@legko/shared';
import { clampItem, parseKcal, sanitizeKcalInput } from './model';
import { scaleKcal } from './portion';

/** At most this many rows: what one recalculation request takes. */
export const MAX_ROWS = 30;

/** An estimate row while she reviews it: kcal is kept as the raw input text. */
export interface DraftItem {
  id: string;
  name: string;
  portion: string;
  kcalText: string;
  /** What the model last confirmed for this row (estimate or recalculation); null for a row she added. */
  base: FoodEstimateItem | null;
  /** She typed the kcal herself: a recalculation keeps it, until she changes the name or portion. */
  pinned: boolean;
}

export type DraftField = 'name' | 'portion' | 'kcal';

/**
 * - `confirmed`: name and portion as the model last priced them;
 * - `scaled`: same dish, another amount of the same unit group — kcal rescaled on the device;
 * - `changed`: needs the model — another dish, a portion the device cannot compare, or a new row.
 */
export type DraftStatus = 'confirmed' | 'scaled' | 'changed';

/** One row as a recalculation sends it (trimmed), with the row it belongs to. */
export interface RecalcRow extends FoodRecalcItem {
  id: string;
}

const normalized = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');

/** Names and portions compare without case and extra spaces («борщ » = «Борщ»). */
export function sameText(a: string, b: string): boolean {
  return normalized(a) === normalized(b);
}

export function toDrafts(items: readonly FoodEstimateItem[]): DraftItem[] {
  return items.map((it, i) => ({
    id: `i${i}`,
    name: it.name,
    portion: it.portion,
    kcalText: String(it.kcal),
    base: { ...it },
    pinned: false,
  }));
}

/** A row she adds herself («+ позиція»). */
export function emptyDraft(id: string): DraftItem {
  return { id, name: '', portion: '', kcalText: '', base: null, pinned: false };
}

/** Kcal the device knows for the row as it is now: the confirmed value or its rescale, else null. */
function knownKcal(d: DraftItem): number | null {
  const { base } = d;
  if (!base || !sameText(d.name, base.name)) return null;
  if (sameText(d.portion, base.portion)) return base.kcal;
  return scaleKcal(base, d.portion);
}

export function draftStatus(d: DraftItem): DraftStatus {
  const { base } = d;
  if (!base || !sameText(d.name, base.name)) return 'changed';
  if (sameText(d.portion, base.portion)) return 'confirmed';
  return knownKcal(d) === null ? 'changed' : 'scaled';
}

/** Rows without a name are left out of the total, «Додати» and the recalculation. */
export const isNamed = (d: DraftItem): boolean => d.name.trim() !== '';

/** The row takes the model's kcal on «✨ Перерахувати» (shown as «змінено»). */
export function needsRecalc(d: DraftItem): boolean {
  return !d.pinned && isNamed(d) && draftStatus(d) === 'changed';
}

/** The muted «перераховано за вагою» note: kcal follows her new amount, not typed by her. */
export function scaledByWeight(d: DraftItem): boolean {
  return !d.pinned && draftStatus(d) === 'scaled';
}

/**
 * One edit. Kcal she types pins the row. A name or portion edit releases the pin and, when the
 * device knows the kcal for it (same dish, measurable amount), sets it right away; otherwise the
 * old number stays until the recalculation.
 */
export function editDraft(d: DraftItem, field: DraftField, value: string): DraftItem {
  if (field === 'kcal') return { ...d, kcalText: sanitizeKcalInput(value), pinned: true };
  const next: DraftItem =
    field === 'name'
      ? { ...d, name: value.slice(0, LIMITS.foodName), pinned: false }
      : { ...d, portion: value.slice(0, LIMITS.portion), pinned: false };
  const kcal = knownKcal(next);
  return kcal === null ? next : { ...next, kcalText: String(kcal) };
}

/** What a recalculation sends: every named row (the whole meal is context), or null when none needs it. */
export function recalcRows(drafts: readonly DraftItem[]): RecalcRow[] | null {
  if (!drafts.some(needsRecalc)) return null;
  return drafts.filter(isNamed).map((d) => ({ id: d.id, name: d.name.trim(), portion: d.portion.trim() }));
}

/**
 * Applies the model's answer (same order as `sent`): only rows still waiting for it, exactly as
 * they were sent, take the new kcal and make it their base. Rows she priced herself, edited
 * meanwhile, or that did not need it keep their numbers.
 */
export function applyRecalc(
  drafts: readonly DraftItem[],
  sent: readonly RecalcRow[],
  answer: readonly FoodEstimateItem[],
): DraftItem[] {
  const priced = new Map<string, FoodEstimateItem>();
  sent.forEach((row, i) => {
    const item = answer[i];
    if (item) priced.set(row.id, clampItem({ name: row.name, portion: row.portion, kcal: item.kcal }));
  });
  return drafts.map((d) => {
    const p = priced.get(d.id);
    if (!p || !needsRecalc(d) || d.name.trim() !== p.name || d.portion.trim() !== p.portion) return d;
    return { ...d, kcalText: String(p.kcal), base: p };
  });
}

/** The rows «Додати» adds, as she left them. */
export function draftsToItems(drafts: readonly DraftItem[]): FoodEstimateItem[] {
  return drafts
    .filter(isNamed)
    .map((d) => ({ name: d.name.trim(), portion: d.portion.trim(), kcal: parseKcal(d.kcalText) }));
}

export function draftsTotal(drafts: readonly DraftItem[]): number {
  return drafts.filter(isNamed).reduce((acc, d) => acc + parseKcal(d.kcalText), 0);
}
