/**
 * Estimate rows (SPEC §3.7 «Result card»): her edits of name, portion and kcal (made in the item
 * editor, see `itemEditorModel.ts`), what the device rescales by itself and what waits for
 * «✨ Перерахувати». Pure; the estimate reducer uses it.
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
  /**
   * The pinned kcal are a «Часті страви» dish's (picked in the item editor), not a number she typed:
   * only typed ones are tagged «вручну». Set only on a pinned row.
   */
  fromDish?: boolean;
}

export type DraftField = 'name' | 'portion' | 'kcal';

/**
 * - `confirmed`: name and portion as the model last priced them;
 * - `scaled`: same dish, another amount the device can compare (г/кг, мл/л, or the same count unit:
 *   «2 скибки» → «3 скибки») — kcal rescaled on the device;
 * - `changed`: needs the model — another dish, a portion the device cannot compare, or a new row.
 */
export type DraftStatus = 'confirmed' | 'scaled' | 'changed';

/** One row as a recalculation sends it (trimmed), with the row it belongs to. */
export interface RecalcRow extends FoodRecalcItem {
  id: string;
}

/** Text as names and portions compare: trimmed, single spaces, lower case. */
export const foldText = (s: string): string => s.trim().replace(/\s+/g, ' ').toLocaleLowerCase('uk');

/** Names and portions compare without case and extra spaces («борщ » = «Борщ»). */
export function sameText(a: string, b: string): boolean {
  return foldText(a) === foldText(b);
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

/** Kcal follows her new amount (rescaled on the device), not typed by her. */
export function scaledOnDevice(d: DraftItem): boolean {
  return !d.pinned && draftStatus(d) === 'scaled';
}

/**
 * One edit. Kcal she types pins the row. A name or portion edit releases the pin and, when the
 * device knows the kcal for it (same dish, measurable amount), sets it right away; otherwise the
 * old number stays until the recalculation.
 */
export function editDraft(d: DraftItem, field: DraftField, value: string): DraftItem {
  const own = withoutDish(d);
  if (field === 'kcal') return { ...own, kcalText: sanitizeKcalInput(value), pinned: true };
  const next: DraftItem =
    field === 'name'
      ? { ...own, name: value.slice(0, LIMITS.foodName), pinned: false }
      : { ...own, portion: value.slice(0, LIMITS.portion), pinned: false };
  const kcal = knownKcal(next);
  return kcal === null ? next : { ...next, kcalText: String(kcal) };
}

/** The row without the «Часті страви» mark (kcal she typed, or no pin at all). */
function withoutDish(d: DraftItem): DraftItem {
  if (d.fromDish === undefined) return d;
  const { fromDish: _fromDish, ...rest } = d;
  return rest;
}

/** Kcal of a «Часті страви» dish: pinned like typed ones, marked as the dish's. */
export function dishKcal(d: DraftItem, kcal: number): DraftItem {
  return { ...editDraft(d, 'kcal', String(kcal)), fromDish: true };
}

/**
 * Her draft of a row on top of newer numbers the model gave for that row (an answer that came in
 * while she was editing it): the model's item becomes its base and, unless the kcal are pinned,
 * the device works them out again — rescaled when the name is still the priced one and the amount
 * comparable; otherwise the number stays and the row keeps waiting for the model.
 */
export function rebaseDraft(d: DraftItem, base: FoodEstimateItem): DraftItem {
  const next: DraftItem = { ...d, base: { ...base } };
  return d.pinned ? next : editDraft(next, 'portion', next.portion);
}

/** Same row content: name, portion, kcal, pin (and whose number it is) and what the model confirmed. */
export function sameDraft(a: DraftItem, b: DraftItem): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.portion === b.portion &&
    a.kcalText === b.kcalText &&
    a.pinned === b.pinned &&
    Boolean(a.fromDish) === Boolean(b.fromDish) &&
    sameBase(a.base, b.base)
  );
}

function sameBase(a: FoodEstimateItem | null, b: FoodEstimateItem | null): boolean {
  if (a === null || b === null) return a === b;
  return a.name === b.name && a.portion === b.portion && a.kcal === b.kcal;
}

/** The rows with `item` in place of the row with its id, or appended (up to `MAX_ROWS`) when it is new. */
export function putDraft(drafts: readonly DraftItem[], item: DraftItem): DraftItem[] {
  if (drafts.some((d) => d.id === item.id)) return drafts.map((d) => (d.id === item.id ? item : d));
  return drafts.length < MAX_ROWS ? [...drafts, item] : [...drafts];
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
