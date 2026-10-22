import { DEEP_LINKS, SETTINGS_REMINDERS_PATH, type ReminderKind } from '@legko/shared';

/** JSON payload read by the service worker's `push` handler. */
export interface PushMessage {
  title: string;
  body: string;
  url: string;
  tag: string;
}

export const REMINDER_MESSAGES: Readonly<Record<ReminderKind, PushMessage>> = {
  workout: {
    title: 'Час тренування 💪',
    body: 'Не забудь відмітити, як пройшло',
    url: DEEP_LINKS.workout,
    tag: 'workout',
  },
  weigh: {
    title: 'Контрольне зважування ⚖️',
    body: 'Найточніше — зранку, натщесерце',
    url: DEEP_LINKS.weigh,
    tag: 'weigh',
  },
  measure: {
    title: 'Час замірів 📏',
    body: 'Груди, талія, стегна — займе хвилину',
    url: DEEP_LINKS.measure,
    tag: 'measure',
  },
};

/**
 * The workout reminder naming today's scheduled workout(s) (docs/workouts-steps-rebrand.md §1.8): none → the
 * usual text; one → «Сьогодні: Ноги + прес»; two → «Сьогодні: Ноги + прес, Кардіо»; more → the first two + « і ще N».
 * The url stays DEEP_LINKS.workout (old service workers open it as before).
 */
export function workoutReminder(names: readonly string[]): PushMessage {
  const base = REMINDER_MESSAGES.workout;
  if (names.length === 0) return { ...base };
  const shown = names.slice(0, 2).join(', ');
  const rest = names.length - 2;
  return { ...base, body: `Сьогодні: ${shown}${rest > 0 ? ` і ще ${rest}` : ''}` };
}

/** Opens «Налаштування → Нагадування», where the «Тест» button is. */
export const TEST_MESSAGE: Readonly<PushMessage> = {
  title: 'Home Fit',
  body: 'Сповіщення працюють ✨',
  url: SETTINGS_REMINDERS_PATH,
  tag: 'test',
};
