import { Redirect, Route, Switch } from 'wouter';
import { AuthGate } from './auth/AuthGate';
import { CalendarScreen } from './screens/calendar';
import { HomeScreen } from './screens/home';
import { ProgressScreen } from './screens/progress';
import { RemindersScreen } from './screens/reminders';
import { AppShell } from './shell/AppShell';

/** Routes: `/` home, `/calendar?date=YYYY-MM-DD`, `/progress`, `/reminders`. */
export function App() {
  return (
    <AuthGate>
      <AppShell>
        <Switch>
          <Route path="/" component={HomeScreen} />
          <Route path="/calendar" component={CalendarScreen} />
          <Route path="/progress" component={ProgressScreen} />
          <Route path="/reminders" component={RemindersScreen} />
          <Route>
            <Redirect to="/" replace />
          </Route>
        </Switch>
      </AppShell>
    </AuthGate>
  );
}
