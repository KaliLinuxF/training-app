import { emptyData, type AppData } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { session, workout } from '@/lib/stats/workouts.testing';
import {
  buildWorkoutSheet,
  exercisesText,
  LOG_PAST_HEADING,
  plannedMinutesText,
  START_TODAY_HEADING,
} from './workoutSheetModel';

const TODAY = '2026-10-14'; // Wednesday
const NOW = Date.UTC(2026, 9, 14, 7);
const flat = (text: string | undefined | null) => (text ?? '').replace(/\s/g, ' ');
const data = (patch: Partial<AppData> = {}): AppData => ({ ...emptyData(), ...patch });

describe('workout sheet model', () => {
  it('words: «1 вправа», «2 вправи», «5 вправ», «11 вправ», «22 вправи»', () => {
    expect([1, 2, 5, 11, 22].map(exercisesText)).toEqual(['1 вправа', '2 вправи', '5 вправ', '11 вправ', '22 вправи']);
  });

  it('planned time rounds to 5 minutes, nothing for 0', () => {
    expect(flat(plannedMinutesText(43 * 60))).toBe('≈ 45 хв');
    expect(flat(plannedMinutesText(62 * 60))).toBe('≈ 1 год 00 хв');
    expect(plannedMinutesText(60)).toBeNull();
  });

  it('she does not use workouts yet: no start group, «Скласти своє тренування →»', () => {
    const m = buildWorkoutSheet(data(), TODAY, TODAY, NOW);
    expect(m.start).toBeNull();
    expect(m.live).toBeNull();
    expect(m.recorded).toEqual([]);
    expect(m.hasDone).toBe(false);
    expect(m.link).toEqual({ text: 'Скласти своє тренування →', to: 'new' });
  });

  it('today: «Почати тренування», scheduled first with a pill, then the rest and «Вільне тренування»', () => {
    const m = buildWorkoutSheet(
      data({ workouts: [workout({ id: 'workoutUpper1', name: 'Верх тіла', days: [5] }), workout()] }),
      TODAY,
      TODAY,
      NOW,
    );
    expect(m.startHeading).toBe(START_TODAY_HEADING);
    expect(m.start?.map((r) => [r.title, r.scheduled])).toEqual([
      ['Ноги + прес', true],
      ['Верх тіла', false],
      ['Вільне тренування', false],
    ]);
    expect(flat(m.start?.[0]?.sub)).toMatch(/^2 вправи · ≈ \d+ хв$/);
    expect(m.start?.[0]?.label).toMatch(/^Почати «Ноги \+ прес», за планом, 2 вправи, близько \d+ хв$/);
    expect(m.start?.[2]).toMatchObject({ workoutId: null, sub: 'Додаси вправи по ходу' });
    expect(m.link).toEqual({ text: 'Мої тренування →', to: 'list' });
  });

  it('a past day: «Записати тренування», its own weekday decides «За планом»', () => {
    const m = buildWorkoutSheet(data({ workouts: [workout({ days: [2] })] }), '2026-10-13', TODAY, NOW);
    expect(m.startHeading).toBe(LOG_PAST_HEADING);
    expect(m.start?.[0]).toMatchObject({ scheduled: true });
    expect(m.start?.[0]?.label.startsWith('Записати «Ноги + прес»')).toBe(true);
  });

  it('a live session shows today and on its own date, never on another past day', () => {
    const live = session({ status: 'active', startedAt: NOW - 25 * 60_000, date: '2026-10-13', durationSec: null });
    const d = data({ workouts: [workout()], sessions: [live] });
    expect(flat(buildWorkoutSheet(d, TODAY, TODAY, NOW).live?.sub)).toBe('Ноги + прес · 25 хв');
    expect(buildWorkoutSheet(d, '2026-10-13', TODAY, NOW).live).not.toBeNull();
    expect(buildWorkoutSheet(d, '2026-10-12', TODAY, NOW).live).toBeNull();
    // Over 6 hours it is stale: not live anymore.
    expect(buildWorkoutSheet(d, TODAY, TODAY, NOW + 7 * 3600_000).live).toBeNull();
  });

  it('done sessions of the date are «Записано» and hide the ✓ / ✕', () => {
    const m = buildWorkoutSheet(data({ sessions: [session({ id: 'doneSession1' })] }), TODAY, TODAY, NOW);
    expect(m.hasDone).toBe(true);
    expect(m.recorded).toHaveLength(1);
    expect(m.recorded[0]).toMatchObject({ sessionId: 'doneSession1', title: 'Ноги + прес' });
    expect(flat(m.recorded[0]?.sub)).toMatch(/^48 хв · \d+ ккал$/);
    // A session without a known duration leaves it out.
    const noDuration = buildWorkoutSheet(data({ sessions: [session({ durationSec: null })] }), TODAY, TODAY, NOW);
    expect(flat(noDuration.recorded[0]?.sub)).toMatch(/^\d+ ккал$/);
  });
});
