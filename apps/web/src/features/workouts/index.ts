/**
 * Workouts (docs/workouts-steps-rebrand.md §3.1, §3.5–§3.12): «Мої тренування», the builder, the session (live,
 * summary, edit), the past-day log and the history — routed by `WorkoutsRoutes` (flat absolute paths, no `nest`).
 */
export { WorkoutsRoutes } from './WorkoutsRoutes';
export { WorkoutsScreen } from './WorkoutsScreen';
export { WorkoutBuilderScreen, type WorkoutBuilderScreenProps } from './WorkoutBuilderScreen';
export { SessionScreen, type SessionScreenProps } from './SessionScreen';
export { HistoryScreen } from './HistoryScreen';
export { LogScreen } from './LogScreen';
