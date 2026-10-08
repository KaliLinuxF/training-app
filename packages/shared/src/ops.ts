import type { Op } from './schemas';
import type { AppData, DayEntry, MeasureValues } from './types';

const byDate = <T extends { date: string }>(a: T, b: T): number => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0);

/** Trims text fields and drops workout types unless a workout was marked. */
export function normalizeDay(e: DayEntry): DayEntry {
  return {
    food: e.food.trim(),
    kcal: e.kcal,
    trained: e.trained,
    types: e.trained === true ? [...new Set(e.types.map((t) => t.trim()).filter(Boolean))] : [],
    notes: e.notes.trim(),
  };
}

/** A day with nothing recorded is not stored at all. */
export const isEmptyDay = (e: DayEntry): boolean =>
  !e.food.trim() && e.kcal == null && e.trained === null && !e.notes.trim();

export const isEmptyMeasure = (m: MeasureValues): boolean => m.chest == null && m.waist == null && m.hips == null;

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
      return { ...data, settings: op.value };
  }
}

export const applyOps = (data: AppData, ops: readonly Op[]): AppData => ops.reduce(applyOp, data);
