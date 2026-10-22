/**
 * Routes of the workouts feature (docs/workouts-steps-rebrand.md §3.1): flat absolute paths (wouter without `nest`),
 * so ListRow / ScreenHeader / `legkoFrom` hrefs resolve to exactly these URLs.
 */
import type { ISODate } from '@legko/shared';

/** «Мої тренування». */
export const WORKOUTS_PATH = '/workouts';
/** The builder, empty. */
export const WORKOUT_NEW_PATH = '/workouts/new';
export const workoutEditPath = (id: string): string => `/workouts/edit/${encodeURIComponent(id)}`;
/** «Вправи». */
export const LIBRARY_PATH = '/workouts/library';
export const exercisePath = (id: string): string => `/workouts/library/${encodeURIComponent(id)}`;
export const sessionPath = (id: string): string => `/workouts/session/${encodeURIComponent(id)}`;
/** Logging a past day (a draft until «Зберегти»). */
export const logPath = (date: ISODate, workoutId: string | null): string =>
  `/workouts/log?date=${date}${workoutId ? `&workout=${encodeURIComponent(workoutId)}` : ''}`;
export const HISTORY_PATH = '/workouts/history';
