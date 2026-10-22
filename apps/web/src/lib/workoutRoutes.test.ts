import { describe, expect, it } from 'vitest';
import {
  exercisePath,
  HISTORY_PATH,
  LIBRARY_PATH,
  logPath,
  sessionPath,
  WORKOUT_NEW_PATH,
  workoutEditPath,
  WORKOUTS_PATH,
} from './workoutRoutes';

describe('workout routes', () => {
  it('are flat absolute paths under /workouts', () => {
    expect(WORKOUTS_PATH).toBe('/workouts');
    expect(WORKOUT_NEW_PATH).toBe('/workouts/new');
    expect(LIBRARY_PATH).toBe('/workouts/library');
    expect(HISTORY_PATH).toBe('/workouts/history');
    expect(workoutEditPath('workout00001')).toBe('/workouts/edit/workout00001');
    expect(sessionPath('abc_DEF-123')).toBe('/workouts/session/abc_DEF-123');
  });

  it('keeps the dot of library ids and encodes anything unusual', () => {
    expect(exercisePath('lib.back-squat')).toBe('/workouts/library/lib.back-squat');
    expect(exercisePath('a/b c')).toBe('/workouts/library/a%2Fb%20c');
  });

  it('logPath: the date, and the workout only when there is one', () => {
    expect(logPath('2026-10-12', null)).toBe('/workouts/log?date=2026-10-12');
    expect(logPath('2026-10-12', 'workout00001')).toBe('/workouts/log?date=2026-10-12&workout=workout00001');
    const url = new URL(logPath('2026-10-12', 'a&b'), 'https://x.test');
    expect(url.searchParams.get('workout')).toBe('a&b');
    expect(url.searchParams.get('date')).toBe('2026-10-12');
  });
});
