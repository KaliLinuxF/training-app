import type { CoachClientResponse } from '@legko/shared';
import { describe, expect, it } from 'vitest';
import { client, meals, training } from './coach.fixtures';
import { withClientDefaults } from './useCoachData';

describe('withClientDefaults (the detail answer is not zod-parsed)', () => {
  it('fills in what a server from before schema v5 does not send', () => {
    const { exercises: _e, workouts: _w, sessions: _s, steps: _st, deletedSessions: _d, ...v4 } = meals();
    const { stepsGoal: _g, ...settings } = v4.settings;
    const response = { client: client(4, 'sofia'), data: { ...v4, settings, foods: [] } } as unknown as CoachClientResponse;
    const out = withClientDefaults(response);
    expect(out.client).toBe(response.client);
    expect(out.data).toMatchObject({ exercises: [], workouts: [], sessions: [], steps: [], deletedSessions: [] });
    expect(out.data.settings.stepsGoal).toBeNull();
    expect(out.data.settings.kcalGoal).toBe(1700);
    expect(out.data.days).toEqual(v4.days);
    expect(out.data.weights).toEqual(v4.weights);
  });

  it('keeps a v5 answer as it is', () => {
    const data = { ...training(), foods: [] };
    const out = withClientDefaults({ client: client(4, 'sofia'), data });
    expect(out.data.sessions).toEqual(data.sessions);
    expect(out.data.steps).toEqual(data.steps);
    expect(out.data.workouts).toEqual(data.workouts);
    expect(out.data.settings.stepsGoal).toBe(8000);
  });
});
