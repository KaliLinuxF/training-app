/**
 * Pure view logic of the food feature: estimate line formatting, the composer, kcal and macro
 * inputs, estimate normalisation, «Часті страви» chips and screen-reader copy. No React, no I/O.
 * The editable positions are in `drafts.ts`.
 */
import {
  f0,
  fN,
  LIMITS,
  MACRO_KEYS,
  rankFoods,
  roundMacro,
  type FoodEstimateItem,
  type FoodEstimateResponse,
  type FoodItem,
  type MacroGrams,
} from '@legko/shared';
import { gramsText, MACRO_LABELS, NBSP, PART_SEPARATOR } from '@/lib/nutrition';

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

/** What a line of food text needs of a dish. */
type LineItem = Pick<FoodEstimateItem, 'name' | 'portion' | 'kcal'>;

/** «Борщ (300 г)», or just «Борщ» when the portion is empty. */
function dishText(item: LineItem, first: boolean): string {
  const name = item.name.trim();
  const portion = item.portion.trim();
  const shown = first ? upperFirst(name) : lowerFirst(name);
  return portion ? `${shown} (${portion})` : shown;
}

export function sumKcal(items: readonly LineItem[]): number {
  return items.reduce((acc, it) => acc + it.kcal, 0);
}

/**
 * «Борщ (300 г), хліб (1 скибка) — 420 ккал»: the line the record sheet's old food block appended
 * (kept for it until it moves to the meal editor).
 */
export function formatFoodLine(items: readonly LineItem[]): string {
  const dishes = items.map((it, i) => dishText(it, i === 0)).join(', ');
  return `${dishes} — ${f0(sumKcal(items))} ккал`;
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

/** The pending tail an estimate of this text counts: only when she left the pre-fill as it was. */
export function consumedTail(c: ComposerState): string {
  return c.prefill.trim() !== '' && !composerEdited(c) ? c.prefill : '';
}

// ---------------------------------------------------------------------------------------------
// Estimate items (the editable rows themselves live in `drafts.ts`)

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

/**
 * Server items can (in theory) exceed the op limits; trim them so `food.use` and `meal.put` stay
 * valid. Macronutrients are rounded to 0.5 g within one position's limit; unknown stays null.
 */
export function clampItem(item: FoodEstimateItem): FoodEstimateItem {
  return {
    name: item.name.trim().slice(0, LIMITS.foodName),
    portion: item.portion.trim().slice(0, LIMITS.portion),
    kcal: Math.min(LIMITS.kcal.max, Math.max(LIMITS.kcal.min, Math.round(item.kcal))),
    protein: roundMacro(item.protein, LIMITS.macro.max),
    fat: roundMacro(item.fat, LIMITS.macro.max),
    carbs: roundMacro(item.carbs, LIMITS.macro.max),
  };
}

// ---------------------------------------------------------------------------------------------
// Macronutrient inputs and lines (Б · Ж · В)

/** The macros of anything that carries them (a FoodItem omits unknown keys: those are null). */
export function macrosOf(m: Partial<Record<keyof MacroGrams, number | null | undefined>>): MacroGrams {
  return { protein: m.protein ?? null, fat: m.fat ?? null, carbs: m.carbs ?? null };
}

/** Keeps digits and one decimal separator (comma or dot): at most 4 whole digits and 1 decimal. */
export function sanitizeMacroInput(text: string): string {
  const cleaned = text.replace(/[^\d.,]/g, '');
  const sep = cleaned.search(/[.,]/);
  if (sep < 0) return cleaned.slice(0, 4);
  const whole = cleaned.slice(0, sep).slice(0, 4);
  const fraction = cleaned
    .slice(sep + 1)
    .replace(/[.,]/g, '')
    .slice(0, 1);
  return `${whole}${cleaned[sep]}${fraction}`;
}

/** Raw grams as typed → a multiple of 0.5 g within `max`, or null when empty / unreadable. */
export function parseMacroInput(text: string, max: number = LIMITS.macro.max): number | null {
  const clean = sanitizeMacroInput(text);
  if (!/\d/.test(clean)) return null;
  return roundMacro(Number(clean.replace(',', '.')), max);
}

/** The number as she would type it: 12.5 → «12,5», 68 → «68», unknown → ''. */
export const macroInputText = (g: number | null): string => (g === null ? '' : fN(g));

/** «Б 24 · Ж 8 · В 31»: the known parts only (whole grams, no unit), or '' when none is known. */
export function macroShort(m: MacroGrams): string {
  return MACRO_KEYS.filter((k) => m[k] !== null)
    .map((k) => `${MACRO_LABELS[k].abbr}${NBSP}${gramsText(m[k])}`)
    .join(PART_SEPARATOR);
}

/**
 * «Б 24 · Ж 8 · В 31 г» with 0.5 g precision (the item editor): unknown parts are «—», the unit
 * follows the last part; null when none is known.
 */
export function macroPrecise(m: MacroGrams): string | null {
  if (MACRO_KEYS.every((k) => m[k] === null)) return null;
  return MACRO_KEYS.map((k) => `${MACRO_LABELS[k].abbr}${NBSP}${gramsText(m[k], true)}`).join(PART_SEPARATOR) +
    `${NBSP}г`;
}

/** «білки 24, жири 8, вуглеводи 31 г» (accessible names): the known parts, or '' when none. */
export function macroWords(m: MacroGrams): string {
  const parts = MACRO_KEYS.filter((k) => m[k] !== null).map((k) => `${MACRO_LABELS[k].lower} ${gramsText(m[k])}`);
  return parts.length ? `${parts.join(', ')} г` : '';
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

/** A «Часті страви» dish as a position: its numbers, macros null where the dish has none. */
export const dishItem = (f: FoodItem): FoodEstimateItem => ({
  name: f.name,
  portion: f.portion,
  kcal: f.kcal,
  ...macrosOf(f),
});

/** Top dishes by use count, then recency (`rankFoods`). */
export function buildFrequentDishes(foods: readonly FoodItem[], limit = FREQUENT_LIMIT): FrequentDish[] {
  return rankFoods(foods)
    .slice(0, limit)
    .map((f) => ({
      key: f.name.trim().toLocaleLowerCase('uk'),
      item: dishItem(f),
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

/**
 * Screen-reader announcement when an estimate arrives: «Знайдено 3 позиції, разом 385 ккал» for the
 * rows actually added, plus «. Не більше 30 позицій» when some were left out (`capped`).
 */
export function foundMessage(count: number, total: number, capped = false): string {
  const cap = capped ? `. ${MAX_POSITIONS_HINT}` : '';
  if (count <= 0) return `Нічого не знайдено${cap}`;
  return `Знайдено ${count} ${pluralUk(count, 'позицію', 'позиції', 'позицій')}, разом ${f0(total)} ккал${cap}`;
}

/** A meal holds at most `LIMITS.mealItems` positions. */
export const MAX_POSITIONS_HINT = `Не більше ${LIMITS.mealItems} позицій`;

/** «Позиції прибрано»: the last estimate's rows were taken back. */
export const UNDONE_MESSAGE = 'Позиції прибрано';

/** «2 позиції · можна виправити». */
export const positionsSubtitle = (n: number): string =>
  `${n} ${pluralUk(n, 'позиція', 'позиції', 'позицій')} · можна виправити`;

/** Screen-reader announcement after «✨ Перерахувати»: «Перераховано: разом 520 ккал». */
export function recalculatedMessage(total: number): string {
  return `Перераховано: разом ${f0(total)} ккал`;
}

/** Announcement after a «Часті страви» chip: «Додано «Борщ», 260 ккал» / «Додано 385 ккал». */
export function addedMessage(add: { items: readonly LineItem[]; kcal: number }): string {
  const only = add.items.length === 1 ? add.items[0] : undefined;
  return only ? `Додано «${only.name.trim()}», ${f0(add.kcal)} ккал` : `Додано ${f0(add.kcal)} ккал`;
}

/** Hint under the result when few estimates are left today (≤ 10), else null. */
export function remainingHint(remaining: number | null | undefined): string | null {
  if (remaining == null || remaining > 10) return null;
  if (remaining <= 0) return 'Ліміт підрахунків на сьогодні вичерпано';
  return `Сьогодні ще ${remaining} ${pluralUk(remaining, 'підрахунок', 'підрахунки', 'підрахунків')}`;
}
