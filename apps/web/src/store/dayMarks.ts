/**
 * One-tap workout mark for any day: the inline «✓ / ✕» on Home «Сьогодні» and on the calendar day card.
 * Saving goes through `dataActions.setDayMeta` (optimistic, offline-queued) with the mark ONLY: the reducer keeps
 * the stored types on ✓ and drops them on ✕; the food, the meals and the notes are never sent, so a ✓ on one
 * device cannot overwrite a meal or a note saved on another. Only a save that went through toasts — a refused
 * save already shows the sync notice.
 */
import type { DayMeta, ISODate } from '@legko/shared';
import { dataActions, getAppData } from './data';
import { ui } from './ui';

export const TRAINED_TOAST = 'Відмічено: тренування було';
export const NO_TRAINING_TOAST = 'Відмічено: без тренування';

/** «✓ Було»: the mark only (the day's types, food and notes stay as stored). */
export const markTrained = (): DayMeta => ({ trained: true });

/** «✕ Не було»: the mark only (the reducer drops the workout types; food and notes stay). */
export const markNoTraining = (): DayMeta => ({ trained: false });

/**
 * Marks `date` as trained / not trained. No-op (`false`, no save, no toast) when the day is already marked that way;
 * otherwise saves and toasts «Відмічено: …» when the save went through. Returns whether it saved.
 */
export function setTrainedMark(date: ISODate, trained: boolean): boolean {
  const e = getAppData().days[date];
  if ((e?.trained ?? null) === trained) return false;
  const saved = dataActions.setDayMeta(date, trained ? markTrained() : markNoTraining());
  if (saved) ui.flash(trained ? TRAINED_TOAST : NO_TRAINING_TOAST);
  return saved;
}
