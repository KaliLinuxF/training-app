import { DEEP_LINKS } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { REMINDER_MESSAGES, workoutReminder } from './messages';

describe('workoutReminder', () => {
  it('no scheduled workout → the usual reminder', () => {
    expect(workoutReminder([])).toEqual(REMINDER_MESSAGES.workout);
  });

  it('one, two, then the first two and «і ще N»; title, url and tag stay', () => {
    expect(workoutReminder(['Ноги + прес']).body).toBe('Сьогодні: Ноги + прес');
    expect(workoutReminder(['Ноги + прес', 'Кардіо']).body).toBe('Сьогодні: Ноги + прес, Кардіо');
    const four = workoutReminder(['Ноги + прес', 'Кардіо', 'Верх тіла', 'Прес']);
    expect(four).toEqual({
      title: REMINDER_MESSAGES.workout.title,
      body: 'Сьогодні: Ноги + прес, Кардіо і ще 2',
      url: DEEP_LINKS.workout,
      tag: 'workout',
    });
  });
});
