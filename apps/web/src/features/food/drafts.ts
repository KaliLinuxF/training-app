/**
 * A meal's positions while she edits them (SPEC §3.7, docs/meals-macros.md §5, §7.4): her edits of
 * name, portion, kcal and Б · Ж · В (made in the item editor, see `itemEditorModel.ts`), what the
 * device rescales by itself and what waits for «✨ Перерахувати». Pure; the estimate reducer uses it.
 *
 * Two pins: kcal she typed (`pinned`) and macronutrients she typed (`macrosPinned`, as a set). A
 * recalculation never overwrites a pinned value; a name or portion edit releases both.
 */
import {
  emptyMacros,
  LIMITS,
  MACRO_KEYS,
  roundMacro,
  sumMacros,
  type FoodEstimateItem,
  type FoodRecalcItem,
  type MacroGrams,
  type MacroKey,
  type MealItem,
} from '@legko/shared';
import {
  clampItem,
  macroInputText,
  parseKcal,
  parseMacroInput,
  sanitizeKcalInput,
  sanitizeMacroInput,
} from './model';
import { scaleItem, type ScaledItem } from './portion';

/** At most this many positions in a meal (also what one recalculation request takes). */
export const MAX_ROWS = LIMITS.mealItems;

/** A position while she reviews it: numbers are kept as the raw input text (comma allowed). */
export interface DraftItem {
  id: string;
  name: string;
  portion: string;
  kcalText: string;
  proteinText: string;
  fatText: string;
  carbsText: string;
  /** What the model last confirmed for this row (estimate, recalculation, or the saved position); null for a row she added. */
  base: FoodEstimateItem | null;
  /** She typed the kcal herself: a recalculation keeps it, until she changes the name or portion. */
  pinned: boolean;
  /** She typed Б · Ж · В (or a «Часті страви» dish set them): a recalculation keeps them, until she changes the name or portion. */
  macrosPinned: boolean;
  /**
   * The pinned kcal are a «Часті страви» dish's (picked in the item editor), not a number she typed:
   * only typed ones are tagged «вручну». Set only on a pinned row.
   */
  fromDish?: boolean;
  /** Added in this editor session (an estimate, a dish chip or «+ позиція»): recorded as `food.use` on save. */
  fresh?: true;
  /** The estimate that added it («Прибрати ці позиції» takes those rows back). */
  estimateId?: string;
}

export type DraftField = 'name' | 'portion' | 'kcal' | MacroKey;

type MacroTextKey = 'proteinText' | 'fatText' | 'carbsText';

const MACRO_TEXT: Readonly<Record<MacroKey, MacroTextKey>> = {
  protein: 'proteinText',
  fat: 'fatText',
  carbs: 'carbsText',
};

const isMacroKey = (field: DraftField): field is MacroKey =>
  (MACRO_KEYS as readonly string[]).includes(field);

/**
 * - `confirmed`: name and portion as the model last priced them;
 * - `scaled`: same dish, another amount the device can compare (г/кг, мл/л, or the same count unit:
 *   «2 скибки» → «3 скибки») — kcal and macros rescaled on the device;
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

/** The three macro input texts of known grams («12,5», '' when unknown). */
export function macroTexts(m: MacroGrams): Pick<DraftItem, MacroTextKey> {
  return {
    proteinText: macroInputText(m.protein),
    fatText: macroInputText(m.fat),
    carbsText: macroInputText(m.carbs),
  };
}

/** The macros of a row as typed (0.5 g steps within one position's limit); empty → null. */
export function draftMacros(d: DraftItem): MacroGrams {
  return {
    protein: parseMacroInput(d.proteinText),
    fat: parseMacroInput(d.fatText),
    carbs: parseMacroInput(d.carbsText),
  };
}

/** The raw input text of one macronutrient of a row. */
export const macroText = (d: DraftItem, key: MacroKey): string => d[MACRO_TEXT[key]];

interface DraftOptions {
  /** Row ids are `${prefix}${index}` (unique within the editor session). */
  prefix?: string;
  /** The estimate these rows come from: they are `fresh` and carry its id. */
  estimateId?: string;
}

/** Rows of an estimate (or any priced items): what the model said is each row's base. */
export function toDrafts(
  items: readonly FoodEstimateItem[],
  { prefix = 'i', estimateId }: DraftOptions = {},
): DraftItem[] {
  return items.map((it, i) => ({
    id: `${prefix}${i}`,
    name: it.name,
    portion: it.portion,
    kcalText: String(it.kcal),
    ...macroTexts(it),
    base: { ...it },
    pinned: false,
    macrosPinned: false,
    ...(estimateId !== undefined ? { fresh: true as const, estimateId } : {}),
  }));
}

/** The positions of a saved meal: each is its own base (rescaled from on the device); not fresh, not pinned. */
export function fromMealItems(items: readonly MealItem[] | undefined): DraftItem[] {
  return toDrafts(
    (items ?? []).map((it) => ({
      name: it.name,
      portion: it.portion,
      kcal: it.kcal,
      protein: it.protein ?? null,
      fat: it.fat ?? null,
      carbs: it.carbs ?? null,
    })),
    { prefix: 'm' },
  );
}

/** A row she adds herself («+ позиція»). */
export function emptyDraft(id: string): DraftItem {
  return {
    id,
    name: '',
    portion: '',
    kcalText: '',
    proteinText: '',
    fatText: '',
    carbsText: '',
    base: null,
    pinned: false,
    macrosPinned: false,
  };
}

/** Kcal and macros the device knows for the row as it is now: the confirmed values or their rescale, else null. */
export function knownItem(d: DraftItem): ScaledItem | null {
  const { base } = d;
  if (!base || !sameText(d.name, base.name)) return null;
  if (sameText(d.portion, base.portion)) {
    return { kcal: base.kcal, protein: base.protein, fat: base.fat, carbs: base.carbs };
  }
  return scaleItem(base, d.portion);
}

export function draftStatus(d: DraftItem): DraftStatus {
  const { base } = d;
  if (!base || !sameText(d.name, base.name)) return 'changed';
  if (sameText(d.portion, base.portion)) return 'confirmed';
  return knownItem(d) === null ? 'changed' : 'scaled';
}

/** Rows without a name are left out of the totals, the saved meal and the recalculation. */
export const isNamed = (d: DraftItem): boolean => d.name.trim() !== '';

/** The row takes the model's numbers on «✨ Перерахувати» (shown as «змінено»). */
export function needsRecalc(d: DraftItem): boolean {
  return !d.pinned && isNamed(d) && draftStatus(d) === 'changed';
}

/** Kcal follow her new amount (rescaled on the device), not typed by her. */
export function scaledOnDevice(d: DraftItem): boolean {
  return !d.pinned && draftStatus(d) === 'scaled';
}

/** Typed kcal with unpinned macros: they follow `typed / reference` kcal; no reference (or 0) → unknown. */
function rescaledMacros(ref: ScaledItem | null, kcalText: string): MacroGrams {
  if (!ref || !(ref.kcal > 0) || kcalText === '') return emptyMacros();
  const ratio = parseKcal(kcalText) / ref.kcal;
  const scale = (v: number | null): number | null => (v === null ? null : roundMacro(v * ratio));
  return { protein: scale(ref.protein), fat: scale(ref.fat), carbs: scale(ref.carbs) };
}

/** The numbers the device knows for the row, where they are not pinned. */
function withKnown(d: DraftItem): DraftItem {
  const known = knownItem(d);
  if (!known) return d;
  return {
    ...d,
    ...(d.pinned ? {} : { kcalText: String(known.kcal) }),
    ...(d.macrosPinned ? {} : macroTexts(known)),
  };
}

/**
 * One edit.
 * - Kcal she types pin the kcal; unless the macros are pinned, they follow by typed / reference kcal
 *   (the reference is what the device knows for that name and amount; none → «—»).
 * - A macronutrient she types pins the macros.
 * - A name or portion edit releases both pins and, when the device knows the item (same dish,
 *   comparable amount), sets kcal and macros right away; otherwise the numbers stay until the
 *   recalculation.
 */
export function editDraft(d: DraftItem, field: DraftField, value: string): DraftItem {
  if (isMacroKey(field)) {
    return { ...d, [MACRO_TEXT[field]]: sanitizeMacroInput(value), macrosPinned: true };
  }
  const own = withoutDish(d);
  if (field === 'kcal') {
    const kcalText = sanitizeKcalInput(value);
    const next: DraftItem = { ...own, kcalText, pinned: true };
    return own.macrosPinned ? next : { ...next, ...macroTexts(rescaledMacros(knownItem(own), kcalText)) };
  }
  const next: DraftItem =
    field === 'name'
      ? { ...own, name: value.slice(0, LIMITS.foodName), pinned: false, macrosPinned: false }
      : { ...own, portion: value.slice(0, LIMITS.portion), pinned: false, macrosPinned: false };
  return withKnown(next);
}

/** The row without the «Часті страви» mark (kcal she typed, or no pin at all). */
function withoutDish(d: DraftItem): DraftItem {
  if (d.fromDish === undefined) return d;
  const { fromDish: _fromDish, ...rest } = d;
  return rest;
}

/**
 * The numbers of a «Часті страви» dish (at her amount): kcal pinned like typed ones but marked as
 * the dish's; the dish's macros pinned with them. A dish without macros leaves them unknown, unless
 * she pinned her own.
 */
export function dishKcal(d: DraftItem, dish: ScaledItem): DraftItem {
  const own = withoutDish(d);
  const next: DraftItem = {
    ...own,
    kcalText: sanitizeKcalInput(String(dish.kcal)),
    pinned: true,
    fromDish: true,
  };
  if (MACRO_KEYS.some((k) => dish[k] !== null)) return { ...next, ...macroTexts(dish), macrosPinned: true };
  return own.macrosPinned ? next : { ...next, ...macroTexts(emptyMacros()) };
}

/**
 * Her draft of a row on top of newer numbers the model gave for that row (an answer that came in
 * while she was editing it): the model's item becomes its base and, unless the kcal are pinned,
 * the device works them out again — rescaled when the name is still the priced one and the amount
 * comparable (macros too, unless she pinned them); otherwise the numbers stay and the row keeps
 * waiting for the model.
 */
export function rebaseDraft(d: DraftItem, base: FoodEstimateItem): DraftItem {
  const next: DraftItem = { ...d, base: { ...base } };
  return d.pinned ? next : withKnown(next);
}

/** Same row content: name, portion, numbers, pins (and whose number it is) and what the model confirmed. */
export function sameDraft(a: DraftItem, b: DraftItem): boolean {
  return (
    a.id === b.id &&
    a.name === b.name &&
    a.portion === b.portion &&
    a.kcalText === b.kcalText &&
    a.proteinText === b.proteinText &&
    a.fatText === b.fatText &&
    a.carbsText === b.carbsText &&
    a.pinned === b.pinned &&
    a.macrosPinned === b.macrosPinned &&
    Boolean(a.fromDish) === Boolean(b.fromDish) &&
    sameBase(a.base, b.base)
  );
}

function sameBase(a: FoodEstimateItem | null, b: FoodEstimateItem | null): boolean {
  if (a === null || b === null) return a === b;
  return (
    a.name === b.name &&
    a.portion === b.portion &&
    a.kcal === b.kcal &&
    MACRO_KEYS.every((k) => a[k] === b[k])
  );
}

/** The rows with `item` in place of the row with its id, or appended (up to `MAX_ROWS`) when it is new. */
export function putDraft(drafts: readonly DraftItem[], item: DraftItem): DraftItem[] {
  if (drafts.some((d) => d.id === item.id)) return drafts.map((d) => (d.id === item.id ? item : d));
  return drafts.length < MAX_ROWS ? [...drafts, item] : [...drafts];
}

/** `rows` after the list, as many as fit under `MAX_ROWS`; `added` = the ones that did. */
export function appendDrafts(
  drafts: readonly DraftItem[],
  rows: readonly DraftItem[],
): { drafts: DraftItem[]; added: DraftItem[] } {
  const added = rows.slice(0, Math.max(0, MAX_ROWS - drafts.length));
  return { drafts: [...drafts, ...added], added };
}

/** What a recalculation sends: every named row (the whole meal is context), or null when none needs it. */
export function recalcRows(drafts: readonly DraftItem[]): RecalcRow[] | null {
  if (!drafts.some(needsRecalc)) return null;
  return drafts.filter(isNamed).map((d) => ({ id: d.id, name: d.name.trim(), portion: d.portion.trim() }));
}

/**
 * Applies the model's answer (same order as `sent`): only rows still waiting for it, exactly as
 * they were sent, take the new kcal and make it their base (with its macros), and its macros
 * unless she pinned her own. Rows she priced herself, edited meanwhile, or that did not need it
 * keep their numbers.
 */
export function applyRecalc(
  drafts: readonly DraftItem[],
  sent: readonly RecalcRow[],
  answer: readonly FoodEstimateItem[],
): DraftItem[] {
  const priced = new Map<string, FoodEstimateItem>();
  sent.forEach((row, i) => {
    const item = answer[i];
    if (item) priced.set(row.id, clampItem({ ...item, name: row.name, portion: row.portion }));
  });
  return drafts.map((d) => {
    const p = priced.get(d.id);
    if (!p || !needsRecalc(d) || d.name.trim() !== p.name || d.portion.trim() !== p.portion) return d;
    return { ...d, kcalText: String(p.kcal), base: p, ...(d.macrosPinned ? {} : macroTexts(p)) };
  });
}

/** The named rows as the meal saves them, as she left them. */
export function draftsToItems(drafts: readonly DraftItem[]): MealItem[] {
  return drafts.filter(isNamed).map((d) => ({
    name: d.name.trim(),
    portion: d.portion.trim(),
    kcal: parseKcal(d.kcalText),
    ...draftMacros(d),
  }));
}

export function draftsTotal(drafts: readonly DraftItem[]): number {
  return drafts.filter(isNamed).reduce((acc, d) => acc + parseKcal(d.kcalText), 0);
}

/** «Разом»: kcal and the sums of the known macros of the named rows. */
export function draftsTotals(drafts: readonly DraftItem[]): { kcal: number; macros: MacroGrams } {
  const named = drafts.filter(isNamed);
  return { kcal: draftsTotal(named), macros: sumMacros(named.map(draftMacros)) };
}
