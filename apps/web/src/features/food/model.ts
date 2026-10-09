/**
 * Pure view logic of the food feature: estimate line formatting, the composer, editable item
 * drafts, «Часті страви» chips and screen-reader copy. No React, no I/O.
 */
import {
  f0,
  LIMITS,
  rankFoods,
  type FoodEstimateItem,
  type FoodEstimateResponse,
  type FoodItem,
} from '@legko/shared';
import type { FoodAdd } from './types';

/** How many «Часті страви» chips the day sheet shows. */
export const FREQUENT_LIMIT = 10;

/** Upper-case first letter (for the first dish in a line). */
function upperFirst(s: string): string {
  return s ? s[0]!.toLocaleUpperCase('uk') + s.slice(1) : s;
}

/** Lower-case first letter for dishes after the first, unless the word looks like an acronym («КФС»). */
function lowerFirst(s: string): string {
  if (s.length > 1 && s[1] === s[1]!.toLocaleUpperCase('uk') && s[1] !== s[1]!.toLocaleLowerCase('uk')) return s;
  return s ? s[0]!.toLocaleLowerCase('uk') + s.slice(1) : s;
}

/** «Борщ (300 г)», or just «Борщ» when the portion is empty. */
function dishText(item: FoodEstimateItem, first: boolean): string {
  const name = item.name.trim();
  const portion = item.portion.trim();
  const shown = first ? upperFirst(name) : lowerFirst(name);
  return portion ? `${shown} (${portion})` : shown;
}

export function sumKcal(items: readonly FoodEstimateItem[]): number {
  return items.reduce((acc, it) => acc + it.kcal, 0);
}

/** Line appended to the day's food text: «Борщ (300 г), хліб (1 скибка) — 420 ккал». */
export function formatFoodLine(items: readonly FoodEstimateItem[]): string {
  const dishes = items.map((it, i) => dishText(it, i === 0)).join(', ');
  return `${dishes} — ${f0(sumKcal(items))} ккал`;
}

/**
 * What `onAdd` receives for a set of confirmed items. `consumed` is the «Що я їла» tail the
 * estimate was made from ('' → the sheet appends the line). The sheet records `uses` on save.
 */
export function buildFoodAdd(
  items: readonly FoodEstimateItem[],
  photoId: string | null,
  consumed = '',
): FoodAdd {
  return {
    line: formatFoodLine(items),
    consumed,
    kcal: sumKcal(items),
    photoId,
    items: [...items],
    uses: items.map((it) => ({ name: it.name, portion: it.portion, kcal: it.kcal })),
  };
}

// ---------------------------------------------------------------------------------------------
// «✨ Порахувати» composer

export interface ComposerState {
  open: boolean;
  text: string;
  /** The unestimated «Що я їла» tail it was pre-filled with ('' when there was none). */
  prefill: string;
}

export const COMPOSER_CLOSED: ComposerState = { open: false, text: '', prefill: '' };

/** The composer holds text she typed or changed herself (not just the pre-filled tail). */
export function composerEdited(c: ComposerState): boolean {
  const text = c.text.trim();
  return text !== '' && text !== c.prefill.trim();
}

/** Opening the composer pre-fills the unestimated tail, unless it still holds her own text. */
export function openComposer(c: ComposerState, tail: string): ComposerState {
  return composerEdited(c) ? { ...c, open: true } : { open: true, text: tail, prefill: tail };
}

/** The tail an estimate of this text replaces on «Додати»: only when she left the pre-fill as it was. */
export function consumedTail(c: ComposerState): string {
  return c.prefill.trim() !== '' && !composerEdited(c) ? c.prefill : '';
}

// ---------------------------------------------------------------------------------------------
// Editable estimate items

/** An estimate row while she reviews it: kcal is kept as the raw input text. */
export interface DraftItem {
  id: string;
  name: string;
  portion: string;
  kcalText: string;
}

export function toDrafts(items: readonly FoodEstimateItem[]): DraftItem[] {
  return items.map((it, i) => ({ id: `i${i}`, name: it.name, portion: it.portion, kcalText: String(it.kcal) }));
}

/** Keeps digits only, at most 5 of them (the kcal input). */
export function sanitizeKcalInput(text: string): string {
  return text.replace(/\D/g, '').slice(0, 5);
}

/** Raw kcal text → integer within the data limits; empty → 0. */
export function parseKcal(text: string): number {
  const digits = sanitizeKcalInput(text);
  if (!digits) return 0;
  return Math.min(LIMITS.kcal.max, Math.max(LIMITS.kcal.min, parseInt(digits, 10)));
}

export function draftsToItems(drafts: readonly DraftItem[]): FoodEstimateItem[] {
  return drafts.map((d) => ({ name: d.name.trim(), portion: d.portion.trim(), kcal: parseKcal(d.kcalText) }));
}

export function draftsTotal(drafts: readonly DraftItem[]): number {
  return drafts.reduce((acc, d) => acc + parseKcal(d.kcalText), 0);
}

/** Server items can (in theory) exceed the op limits; trim them so `food.use` stays valid. */
export function clampItem(item: FoodEstimateItem): FoodEstimateItem {
  return {
    name: item.name.trim().slice(0, LIMITS.foodName),
    portion: item.portion.trim().slice(0, LIMITS.portion),
    kcal: Math.min(LIMITS.kcal.max, Math.max(LIMITS.kcal.min, Math.round(item.kcal))),
  };
}

/** Normalised estimate as the card shows it. */
export function estimateItems(res: FoodEstimateResponse): FoodEstimateItem[] {
  return res.items.map(clampItem).filter((it) => it.name.length > 0);
}

// ---------------------------------------------------------------------------------------------
// «Часті страви»

export interface FrequentDish {
  /** Case-insensitive identity (also the React key). */
  key: string;
  item: FoodEstimateItem;
  /** Chip text: «Вівсянка з бананом · 320». */
  label: string;
}

export const chipLabel = (f: Pick<FoodItem, 'name' | 'kcal'>): string => `${f.name} · ${f0(f.kcal)}`;

/** Accessible name of a chip: «Додати «Кава з молоком», 60 ккал» (the visible «·» is not read out). */
export const chipAddLabel = (f: Pick<FoodItem, 'name' | 'kcal'>): string =>
  `Додати «${f.name.trim()}», ${f0(f.kcal)} ккал`;

/** Top dishes by use count, then recency (`rankFoods`). */
export function buildFrequentDishes(foods: readonly FoodItem[], limit = FREQUENT_LIMIT): FrequentDish[] {
  return rankFoods(foods)
    .slice(0, limit)
    .map((f) => ({
      key: f.name.trim().toLocaleLowerCase('uk'),
      item: { name: f.name, portion: f.portion, kcal: f.kcal },
      label: chipLabel(f),
    }));
}

// ---------------------------------------------------------------------------------------------
// Copy helpers

/** Ukrainian plural: 1 страва, 2 страви, 5 страв, 21 страва. */
export function pluralUk(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** Comment on a result with no food in it, when the model gave none. */
export function emptyEstimateComment(photo: boolean): string {
  return photo
    ? 'Не вдалося знайти їжу на фото — спробуй описати текстом.'
    : 'Не вдалося знайти їжу в описі — спробуй сформулювати інакше.';
}

/** Screen-reader announcement when an estimate arrives: «Знайдено 3 позиції, разом 385 ккал». */
export function foundMessage(count: number, total: number): string {
  if (count <= 0) return 'Нічого не знайдено';
  return `Знайдено ${count} ${pluralUk(count, 'позицію', 'позиції', 'позицій')}, разом ${f0(total)} ккал`;
}

/** Announcement after «Додати» or a chip: «Додано «Борщ», 260 ккал» / «Додано 385 ккал». */
export function addedMessage(add: Pick<FoodAdd, 'items' | 'kcal'>): string {
  const only = add.items.length === 1 ? add.items[0] : undefined;
  return only ? `Додано «${only.name.trim()}», ${f0(add.kcal)} ккал` : `Додано ${f0(add.kcal)} ккал`;
}

/** Hint under the result when few estimates are left today (≤ 10), else null. */
export function remainingHint(remaining: number | null | undefined): string | null {
  if (remaining == null || remaining > 10) return null;
  if (remaining <= 0) return 'Ліміт підрахунків на сьогодні вичерпано';
  return `Сьогодні ще ${remaining} ${pluralUk(remaining, 'підрахунок', 'підрахунки', 'підрахунків')}`;
}
