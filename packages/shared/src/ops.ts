import { normalizeTypeNames } from './defaults';
import { LIMITS, type FoodUse, type Op } from './schemas';
import type { AppData, DayEntry, FoodItem, ISODate, MeasureValues } from './types';

const byDate = <T extends { date: string }>(a: T, b: T): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Trims text fields, drops workout types unless a workout was marked, de-duplicates photos. */
export function normalizeDay(e: DayEntry): DayEntry {
  const day: DayEntry = {
    food: e.food.trim(),
    kcal: e.kcal,
    trained: e.trained,
    types: e.trained === true ? [...new Set(e.types.map((t) => t.trim()).filter(Boolean))] : [],
    notes: e.notes.trim(),
  };
  const photos = [...new Set(e.photos ?? [])];
  if (photos.length) day.photos = photos;
  return day;
}

/** A day with nothing recorded is not stored at all. */
export const isEmptyDay = (e: DayEntry): boolean =>
  !e.food.trim() && e.kcal == null && e.trained === null && !e.notes.trim() && !e.photos?.length;

export const isEmptyMeasure = (m: MeasureValues): boolean => m.chest == null && m.waist == null && m.hips == null;

/** Case-insensitive identity of a dish name. */
export const foodKey = (name: string): string => name.trim().toLocaleLowerCase('uk');

/** Upserts a dish: count + 1, latest spelling/portion/kcal, newest `lastUsed`; keeps at most `LIMITS.foods`. */
export function useFood(foods: readonly FoodItem[], use: FoodUse, date: ISODate): FoodItem[] {
  const key = foodKey(use.name);
  const prev = foods.find((f) => foodKey(f.name) === key);
  const next: FoodItem = {
    name: use.name.trim(),
    portion: use.portion.trim(),
    kcal: use.kcal,
    count: (prev?.count ?? 0) + 1,
    lastUsed: prev && prev.lastUsed > date ? prev.lastUsed : date,
  };
  const out = foods.filter((f) => foodKey(f.name) !== key);
  out.push(next);
  if (out.length <= LIMITS.foods) return out;
  // Evict the least useful dish: fewest uses, then least recently used.
  const victim = [...out].sort((a, b) => a.count - b.count || (a.lastUsed < b.lastUsed ? -1 : 1))[0];
  return out.filter((f) => f !== victim);
}

/** «Часті страви» order: most used first, then most recently used, then name. */
export function rankFoods(foods: readonly FoodItem[]): FoodItem[] {
  return [...foods].sort(
    (a, b) =>
      b.count - a.count || (a.lastUsed < b.lastUsed ? 1 : a.lastUsed > b.lastUsed ? -1 : 0) || a.name.localeCompare(b.name, 'uk'),
  );
}

/**
 * Pure reducer shared by the client (optimistic updates, replaying the offline queue)
 * and the server tests (the server itself persists the same semantics in SQL).
 * `day.put` of an empty day and `measure.put` with no values behave as deletes.
 */
export function applyOp(data: AppData, op: Op): AppData {
  switch (op.kind) {
    case 'day.put': {
      const entry = normalizeDay(op.value);
      const days = { ...data.days };
      if (isEmptyDay(entry)) delete days[op.date];
      else days[op.date] = entry;
      return { ...data, days };
    }
    case 'day.delete': {
      if (!(op.date in data.days)) return data;
      const days = { ...data.days };
      delete days[op.date];
      return { ...data, days };
    }
    case 'weight.put': {
      const weights = data.weights.filter((w) => w.date !== op.date);
      weights.push({ date: op.date, kg: op.kg });
      weights.sort(byDate);
      return { ...data, weights };
    }
    case 'weight.delete':
      return { ...data, weights: data.weights.filter((w) => w.date !== op.date) };
    case 'measure.put': {
      const measures = data.measures.filter((m) => m.date !== op.date);
      if (!isEmptyMeasure(op.value)) measures.push({ date: op.date, ...op.value });
      measures.sort(byDate);
      return { ...data, measures };
    }
    case 'measure.delete':
      return { ...data, measures: data.measures.filter((m) => m.date !== op.date) };
    case 'settings.put':
      return { ...data, settings: { ...op.value, customTypes: normalizeTypeNames(op.value.customTypes) } };
    case 'food.use':
      return { ...data, foods: useFood(data.foods, op.value, op.date) };
    case 'food.delete': {
      const key = foodKey(op.name);
      return { ...data, foods: data.foods.filter((f) => foodKey(f.name) !== key) };
    }
  }
}

export const applyOps = (data: AppData, ops: readonly Op[]): AppData => ops.reduce(applyOp, data);
