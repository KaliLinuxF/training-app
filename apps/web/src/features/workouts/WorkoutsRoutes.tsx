import { Redirect, Route, Switch } from 'wouter';
import { ExerciseLibraryRoute } from '@/features/exercises';
import { HISTORY_PATH, LIBRARY_PATH, WORKOUT_NEW_PATH, WORKOUTS_PATH } from '@/lib/workoutRoutes';
import { HistoryScreen } from './HistoryScreen';
import { LogScreen } from './LogScreen';
import { SessionScreen } from './SessionScreen';
import { WorkoutBuilderScreen } from './WorkoutBuilderScreen';
import { WorkoutsScreen } from './WorkoutsScreen';

const decode = (raw: string): string => {
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
};

/**
 * Every `/workouts…` page (docs/workouts-steps-rebrand.md §3.1) as FLAT ABSOLUTE routes: no wouter `nest` — a nested
 * router makes `Link`, `navigate` and `useLocation` relative to its base, and the absolute `workoutRoutes` URLs would
 * resolve to `/workouts/workouts/…`. Anything else under `/workouts` goes to the list.
 */
export function WorkoutsRoutes() {
  return (
    <Switch>
      <Route path={WORKOUTS_PATH} component={WorkoutsScreen} />
      <Route path={WORKOUT_NEW_PATH}>
        <WorkoutBuilderScreen key="new" />
      </Route>
      <Route path="/workouts/edit/:id">
        {(params) => <WorkoutBuilderScreen key={params.id} id={decode(params.id)} />}
      </Route>
      <Route path={LIBRARY_PATH} component={ExerciseLibraryRoute} />
      <Route path={`${LIBRARY_PATH}/:id`} component={ExerciseLibraryRoute} />
      <Route path="/workouts/session/:id">
        {(params) => <SessionScreen key={params.id} id={decode(params.id)} />}
      </Route>
      <Route path="/workouts/log" component={LogScreen} />
      <Route path={HISTORY_PATH} component={HistoryScreen} />
      <Route>
        <Redirect to={WORKOUTS_PATH} replace />
      </Route>
    </Switch>
  );
}
