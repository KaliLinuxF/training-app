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

/** Opens «Налаштування → Нагадування», where the «Тест» button is. */
export const TEST_MESSAGE: Readonly<PushMessage> = {
  title: 'Легко',
  body: 'Сповіщення працюють ✨',
  url: SETTINGS_REMINDERS_PATH,
  tag: 'test',
};
