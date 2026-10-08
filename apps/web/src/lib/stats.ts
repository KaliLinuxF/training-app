/**
 * Statistics engine: pure functions over `AppData` that port the prototype's `renderVals` maths
 * (SPEC §3.6). Screens call these and only format/display the results. Every function takes
 * `today` explicitly (from `useToday()`), never reads the clock.
 */
export { daysInRange, type DatedDay, type DatedValue, type Metric } from './stats/common';
export * from './stats/periods';
export * from './stats/body';
export * from './stats/range';
export * from './stats/chart';
export * from './stats/workouts';
export * from './stats/kcal';
export * from './stats/calendar';
export * from './stats/reminders';
