import { SETTINGS_REMINDERS_PATH } from '@legko/shared';
import { Redirect, Route, Switch } from 'wouter';
import { AuthGate } from './auth/AuthGate';
import { CalendarScreen } from './screens/calendar';
import { HomeScreen } from './screens/home';
import { ProgressScreen } from './screens/progress';
import { SettingsScreen } from './screens/settings';
import { AppShell } from './shell/AppShell';

/**
 * Routes: `/` home, `/calendar?date=YYYY-MM-DD`, `/progress`, `/settings` (the list) and
 * `/settings/:section` (reminders | goals | workouts | appearance | data; anything else goes back to the list).
 * `/reminders` (old bookmarks, test notifications delivered before the move) redirects to `/settings/reminders`;
 * unknown paths go home.
 */
export function App() {
  return (
    <AuthGate>
      <AppShell>
        <AppRoutes />
      </AppShell>
    </AuthGate>
  );
}

/** The screens by URL (exported for the routing tests). */
export function AppRoutes() {
  return (
    <Switch>
      <Route path="/" component={HomeScreen} />
      <Route path="/calendar" component={CalendarScreen} />
      <Route path="/progress" component={ProgressScreen} />
      <Route path="/settings/:section?" component={SettingsScreen} />
      <Route path="/reminders">
        <Redirect to={SETTINGS_REMINDERS_PATH} replace />
      </Route>
      <Route>
        <Redirect to="/" replace />
      </Route>
    </Switch>
  );
}
