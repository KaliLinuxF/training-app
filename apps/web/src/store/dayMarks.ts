/**
 * One-tap workout mark for any day: the inline «✓ / ✕» on Home «Сьогодні» and on the calendar day card.
 * Saving goes through `dataActions.saveDay` (optimistic, offline-queued); only a save that went through toasts —
 * a refused save already shows the sync notice.
 */
import type { DayEntry, ISODate } from '@legko/shared';
import { dataActions, getAppData } from './data';
import { ui } from './ui';

export const TRAINED_TOAST = 'Відмічено: тренування було';
export const NO_TRAINING_TOAST = 'Відмічено: без тренування';

const EMPTY_DAY: DayEntry = { food: '', kcal: null, trained: null, types: [], notes: '' };

/** «✓ Було»: keeps the day's types, food, kcal, notes and photos. */
export function markTrained(entry: DayEntry | undefined): DayEntry {
  return { ...EMPTY_DAY, ...entry, trained: true };
}

/** «✕ Не було»: clears the workout types, keeps everything else. */
export function markNoTraining(entry: DayEntry | undefined): DayEntry {
  return { ...EMPTY_DAY, ...entry, trained: false, types: [] };
}

/**
 * Marks `date` as trained / not trained. No-op (`false`, no save, no toast) when the day is already marked that way;
 * otherwise saves and toasts «Відмічено: …» when the save went through. Returns whether it saved.
 */
export function setTrainedMark(date: ISODate, trained: boolean): boolean {
  const e = getAppData().days[date];
  if ((e?.trained ?? null) === trained) return false;
  const saved = dataActions.saveDay(date, trained ? markTrained(e) : markNoTraining(e));
  if (saved) ui.flash(trained ? TRAINED_TOAST : NO_TRAINING_TOAST);
  return saved;
}
