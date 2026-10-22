/**
 * Starting a workout today from Home or the «Тренування» sheet (docs/workouts-steps-rebrand.md §3.5, §3.8): one live
 * session at a time (W14). When another workout is still live she is asked first; «Завершити й почати» finishes it
 * (`finishSession`, which also marks its day trained) and starts the new one. The same workout that is live — or a
 * second «Вільне тренування» — just continues it. The session screens belong to the workouts package: we only go to
 * `sessionPath(id)`.
 */
import { activeSession, FREE_WORKOUT_NAME, type ISODate } from '@legko/shared';
import { dataActions, getAppData } from '@/store/data';
import { ui, type ConfirmOptions } from '@/store/ui';

/** Toast when the store refused to start (e.g. the day already has 10 sessions). */
export const START_FAILED = 'Не вдалося почати тренування';

/** Asked before a new workout replaces the live one. */
export function switchConfirm(liveName: string): ConfirmOptions {
  return {
    title: `Тренування «${liveName}» ще триває. Завершити його й почати нове?`,
    confirmLabel: 'Завершити й почати',
    cancelLabel: 'Скасувати',
  };
}

/**
 * Starts `workoutId` (null = «Вільне тренування») on `date`. Resolves to the id of the session to open — the new one,
 * or the live one when it is the same workout —, or null when she kept the live one or the store refused (then a
 * toast says so). `clock` is read again after the question.
 */
export async function startWorkout(
  date: ISODate,
  workoutId: string | null,
  clock: () => number = Date.now,
): Promise<string | null> {
  const live = activeSession(getAppData(), clock());
  if (live && live.workoutId !== workoutId) {
    const ok = await ui.confirm(switchConfirm(live.name || FREE_WORKOUT_NAME));
    if (!ok) return null;
    // It may have been finished elsewhere meanwhile: finishSession then just does nothing.
    dataActions.finishSession(live.id, clock());
  }
  const id = dataActions.startSession(date, workoutId, clock());
  if (id === null) ui.flash(START_FAILED);
  return id;
}
