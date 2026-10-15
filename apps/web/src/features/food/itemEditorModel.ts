/**
 * The item editor («Позиція» / «Нова позиція», a sheet stacked over the meal editor): a local draft
 * of one position. Every change goes through `editDraft`, so kcal and Б · Ж · В follow exactly the
 * rules of the rows (rescale on the device, «змінено» for the model, pins). Nothing reaches the
 * list until «Готово» / «Додати позицію»; ✕ drops it. Pure; the estimate reducer holds the state.
 */
import { MACRO_KEYS, rankFoods, type FoodEstimateItem, type FoodItem, type MacroKey } from '@legko/shared';
import {
  dishKcal,
  draftMacros,
  draftStatus,
  editDraft,
  emptyDraft,
  foldText,
  isNamed,
  needsRecalc,
  sameDraft,
  sameText,
  type DraftItem,
} from './drafts';
import { dishItem, parseKcal } from './model';
import {
  BASIC_UNITS,
  composePortion,
  convertAmount,
  formatAmount,
  MULTIPLIERS,
  multiplyAmount,
  parseAmount,
  readPortion,
  roundAmount,
  sanitizeAmountInput,
  scaleItem,
  stepAmount,
  unitGroup,
  type PortionParts,
  type UnitGroup,
  type UnitKey,
} from './portion';

export interface ItemEditorState {
  /** The row as «Готово» would put it in the list. */
  item: DraftItem;
  /** The row when the editor opened; null for a new one («+ позиція»). */
  original: DraftItem | null;
  /** The amount field as she types it («1,5»); with `unit` it makes the portion. */
  amountText: string;
  unit: UnitKey;
  /** The portion is a plain text field: it is not «<number> <unit>», or she chose «Порція текстом». */
  textMode: boolean;
  /** «Вписати вручну»: kcal and Б · Ж · В are fields she types in. */
  manualKcal: boolean;
  /** The frequent dish she picked: its kcal and macros follow her amount while the name is still that dish. */
  dish: FoodEstimateItem | null;
  /**
   * The model's remark from a recalculation asked for here. It is about her draft, so it joins the
   * card with it on «Готово» and is dropped with it on ✕.
   */
  comment?: string;
}

export type EditorAction =
  | { type: 'name'; value: string }
  /** «повернути: <назва>»: the model's name back. */
  | { type: 'restoreName' }
  /** A «Часті страви» suggestion: its name, portion, kcal and macros (pinned: no model needed). */
  | { type: 'dish'; dish: FoodEstimateItem }
  | { type: 'amount'; text: string }
  | { type: 'step'; dir: 1 | -1 }
  | { type: 'unit'; unit: UnitKey }
  | { type: 'multiply'; factor: number }
  | { type: 'portionText'; value: string }
  | { type: 'textMode'; on: boolean }
  | { type: 'kcal'; value: string }
  /** Grams of one macronutrient she types (pins Б · Ж · В). */
  | { type: 'macro'; key: MacroKey; value: string }
  | { type: 'manualKcal' };

/** Unit the amount field starts with when the portion says none. */
const DEFAULT_UNIT: UnitKey = 'г';

/** How many «Часті страви» the name field suggests. */
export const SUGGESTION_LIMIT = 5;

/** Amount field and unit for a portion; free text when it cannot be read. */
function portionFields(
  portion: string,
  unit: UnitKey,
): Pick<ItemEditorState, 'amountText' | 'unit' | 'textMode'> {
  const parts = readPortion(portion);
  if (parts) return { amountText: formatAmount(parts.amount), unit: parts.unit, textMode: false };
  return { amountText: '', unit, textMode: portion.trim() !== '' };
}

/**
 * The editor on one of the rows. A row priced by a frequent dish is that dish again: its kcal keep
 * following her amount.
 */
export function openEditor(row: DraftItem): ItemEditorState {
  const dish =
    row.pinned && row.fromDish
      ? { name: row.name, portion: row.portion, kcal: parseKcal(row.kcalText), ...draftMacros(row) }
      : null;
  return {
    item: row,
    original: row,
    ...portionFields(row.portion, DEFAULT_UNIT),
    manualKcal: false,
    dish,
  };
}

/** The editor on a row she adds; it joins the list on «Додати позицію». */
export function newEditor(itemId: string): ItemEditorState {
  return {
    // A row she adds is recorded in «Часті страви» with the meal.
    item: { ...emptyDraft(itemId), fresh: true },
    original: null,
    amountText: '',
    unit: DEFAULT_UNIT,
    textMode: false,
    manualKcal: false,
    dish: null,
  };
}

/** Something would be lost on ✕ (asks «Скасувати зміни?»). */
export function editorChanged(s: ItemEditorState): boolean {
  return !sameDraft(s.item, s.original ?? emptyDraft(s.item.id));
}

/** «Готово» / «Додати позицію» can apply it: a row needs a name. */
export const canSave = (s: ItemEditorState): boolean => isNamed(s.item);

/**
 * While the name is still the picked dish's, its kcal and macros follow her amount (and stay hers:
 * pinned). Another name, or an amount the dish cannot be scaled to, lets the dish go.
 */
function followDish(s: ItemEditorState): ItemEditorState {
  const { dish, item } = s;
  if (!dish) return s;
  if (!sameText(item.name, dish.name)) return { ...s, dish: null };
  const scaled = sameText(item.portion, dish.portion) ? dish : scaleItem(dish, item.portion);
  if (scaled === null) return { ...s, dish: null };
  return { ...s, item: dishKcal(item, scaled) };
}

/**
 * A new portion. `s.item` is the draft before it: while she retypes the amount of a picked dish
 * (empty for a moment, «0», «0,» on the way to «0,5»), the dish waits with its last kcal instead
 * of letting go — on the iPhone, backspacing is how she changes a number.
 */
function withPortion(s: ItemEditorState, portion: string): ItemEditorState {
  const item = editDraft(s.item, 'portion', portion);
  if (s.dish && !s.textMode && parseAmount(s.amountText) === null) {
    const { kcalText, proteinText, fatText, carbsText, macrosPinned } = s.item;
    const waiting = { kcalText, proteinText, fatText, carbsText, macrosPinned, pinned: true, fromDish: true };
    return { ...s, item: { ...item, ...waiting } };
  }
  return followDish({ ...s, item });
}

/** A new amount (or unit) in the fields: the portion is composed from them («150 г», «2 скибки»). */
function withAmount(s: ItemEditorState, amountText: string, unit: UnitKey): ItemEditorState {
  const amount = parseAmount(amountText);
  const portion = amount === null ? '' : composePortion(amount, unit);
  return withPortion({ ...s, amountText, unit, textMode: false }, portion);
}

const amountOf = (s: ItemEditorState): number | null => parseAmount(s.amountText);

/** What «½ · ×1 · 1½ · ×2» multiply: the picked dish's amount, else the model's. */
export function referencePortion(s: ItemEditorState): PortionParts | null {
  const portion = s.dish?.portion ?? s.item.base?.portion;
  return portion === undefined ? null : readPortion(portion);
}

export function editorReducer(s: ItemEditorState, action: EditorAction): ItemEditorState {
  switch (action.type) {
    case 'name':
      return followDish({ ...s, item: editDraft(s.item, 'name', action.value) });
    case 'restoreName': {
      const base = s.item.base;
      return base ? editorReducer(s, { type: 'name', value: base.name }) : s;
    }
    case 'dish': {
      const { name, portion, kcal, protein, fat, carbs } = action.dish;
      const dish = { name, portion, kcal, protein, fat, carbs };
      let item = editDraft(s.item, 'name', dish.name);
      item = editDraft(item, 'portion', dish.portion);
      item = dishKcal(item, dish);
      return { ...s, ...portionFields(dish.portion, s.unit), item, dish };
    }
    case 'amount':
      return withAmount(s, sanitizeAmountInput(action.text), s.unit);
    case 'step': {
      const next = stepAmount(amountOf(s), s.unit, action.dir);
      return next === null ? s : withAmount(s, formatAmount(next), s.unit);
    }
    case 'unit': {
      if (action.unit === s.unit) return s;
      const next = convertAmount(amountOf(s), s.unit, action.unit);
      // No amount yet: only the unit changes (a portion she typed as text is not wiped).
      if (next === null) return { ...s, unit: action.unit };
      return withAmount(s, formatAmount(next), action.unit);
    }
    case 'multiply': {
      const ref = referencePortion(s);
      const next = ref ? multiplyAmount(ref, action.factor) : null;
      return next ? withAmount(s, formatAmount(next.amount), next.unit) : s;
    }
    case 'portionText':
      return withPortion({ ...s, textMode: true }, action.value);
    case 'textMode': {
      if (action.on) return { ...s, textMode: true };
      return { ...s, ...portionFields(s.item.portion, s.unit), textMode: false };
    }
    case 'kcal':
      return { ...s, item: editDraft(s.item, 'kcal', action.value), dish: null, manualKcal: true };
    case 'macro':
      // Kcal still follow a picked dish; her grams are pinned (an amount change releases them).
      return { ...s, item: editDraft(s.item, action.key, action.value), manualKcal: true };
    case 'manualKcal':
      return { ...s, manualKcal: true };
  }
}

// ---------------------------------------------------------------------------------------------
// What the editor shows

/** Unit chips: г · мл · шт · ложка · скибка · порція, then the row's own unit when it is another one. */
export function unitChoices(s: ItemEditorState): UnitKey[] {
  const ref = referencePortion(s)?.unit;
  const extra = [s.unit, ref].filter((u): u is UnitKey => u !== undefined && !BASIC_UNITS.includes(u));
  return [...BASIC_UNITS, ...new Set(extra)];
}

export interface MultiplierChoice {
  factor: number;
  label: string;
  /** The portion it sets, or null when it makes no sense (½ of «1 шт»). */
  portion: string | null;
  /** The amount and unit on screen are this multiple of the reference. */
  active: boolean;
}

/** «½ · ×1 · 1½ · ×2» of the reference amount, or [] when there is none to multiply. */
export function multiplierChoices(s: ItemEditorState): MultiplierChoice[] {
  const ref = referencePortion(s);
  if (!ref) return [];
  const amount = amountOf(s);
  return MULTIPLIERS.map(({ factor, label }) => {
    const next = multiplyAmount(ref, factor);
    return {
      factor,
      label,
      portion: next ? composePortion(next.amount, next.unit) : null,
      active:
        next !== null &&
        !s.textMode &&
        amount !== null &&
        s.unit === next.unit &&
        roundAmount(amount, s.unit) === next.amount,
    };
  });
}

/** Whether − / + can change the amount right now. */
export function canStep(s: ItemEditorState, dir: 1 | -1): boolean {
  return stepAmount(amountOf(s), s.unit, dir) !== null;
}

/**
 * What the kcal number is:
 * - `model`: as the model priced this name and portion;
 * - `scaled`: rescaled on the device from the model's numbers (`group` says by what);
 * - `needsAi`: another dish or an amount the device cannot compare — «✨ Перерахувати» or by hand;
 * - `dish`: from «Часті страви»; `manual`: typed by her;
 * - `empty`: no name yet, so nothing to price.
 */
export type KcalSource =
  | { kind: 'model' }
  | { kind: 'scaled'; group: UnitGroup }
  | { kind: 'needsAi'; isNew: boolean }
  | { kind: 'dish' }
  /** `rescaled`: Б · Ж · В follow her kcal (known, not typed by her). */
  | { kind: 'manual'; rescaled?: true }
  | { kind: 'empty' };

export function kcalSource(s: ItemEditorState): KcalSource {
  const { item } = s;
  if (item.pinned) {
    if (item.fromDish) return { kind: 'dish' };
    const rescaled = !item.macrosPinned && MACRO_KEYS.some((k) => draftMacros(item)[k] !== null);
    return rescaled ? { kind: 'manual', rescaled: true } : { kind: 'manual' };
  }
  if (!isNamed(item)) return { kind: 'empty' };
  if (needsRecalc(item)) return { kind: 'needsAi', isNew: item.base === null };
  if (draftStatus(item) === 'scaled') {
    const parts = readPortion(item.portion);
    return { kind: 'scaled', group: parts ? unitGroup(parts.unit) : 'mass' };
  }
  return { kind: 'model' };
}

/** Muted line under the kcal number (null: nothing to say). */
export function kcalNote(source: KcalSource): string | null {
  switch (source.kind) {
    case 'scaled':
      return source.group === 'count'
        ? 'перераховано за кількістю'
        : source.group === 'volume'
          ? 'перераховано за обʼємом'
          : 'перераховано за вагою';
    case 'needsAi':
      return source.isNew ? 'ще не пораховано' : 'змінено — уточни калорії';
    case 'dish':
      return 'як у «Частих стравах»';
    case 'manual':
      return source.rescaled ? 'Б · Ж · В перераховано за калоріями' : 'вписано вручну';
    case 'model':
    case 'empty':
      return null;
  }
}

/**
 * «Часті страви» whose name contains what she typed (case-insensitive; all of them while the name
 * is empty), most used first, without the one the row already is.
 */
export function dishSuggestions(
  foods: readonly FoodItem[],
  s: ItemEditorState,
  limit = SUGGESTION_LIMIT,
): FoodEstimateItem[] {
  const { item } = s;
  const query = foldText(item.name);
  return rankFoods(foods)
    .filter((f) => foldText(f.name).includes(query))
    .filter(
      (f) =>
        !(
          sameText(f.name, item.name) &&
          sameText(f.portion, item.portion) &&
          String(f.kcal) === item.kcalText
        ),
    )
    .slice(0, limit)
    .map(dishItem);
}

/** The model's name, when hers is another one («повернути: Борщ»). */
export function restorableName(s: ItemEditorState): string | null {
  const base = s.item.base;
  return base && !sameText(s.item.name, base.name) ? base.name : null;
}
