import { useEffect, type ReactNode } from 'react';
import { InviteScreen } from '../screens/login/InviteScreen';
import { LoginScreen } from '../screens/login/LoginScreen';
import { ResetScreen } from '../screens/login/ResetScreen';
import { onUnauthorized, onUserMismatch, startSync, useDataStore } from '../store/data';
import { ConfirmHost, Toast } from '../ui';
import { authActions, listenAuthBroadcasts, useAuth, watchForeground } from './auth';
import { linkKindOf } from './linkToken';
import { Splash } from './Splash';

const WAITING_FOR_NETWORK = 'Немає зʼєднання. Дані завантажаться, щойно зʼявиться інтернет.';

/** Screens outside the app shell still need the in-app dialog (switch / logout confirm) and the toast. */
function Standalone({ children }: { children: ReactNode }) {
  return (
    <>
      {children}
      <Toast />
      <ConfirmHost />
    </>
  );
}

/**
 * Shows the login screen until there is a session, then starts data sync for the device user and renders the app.
 * Children render only once data is loaded (device cache or server), so screens never see the empty placeholder
 * data of a fresh device. The one-time link pages `/invite` and `/reset` are routed here, before the status.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, offline, user } = useAuth();
  const loaded = useDataStore((s) => s.sync.loaded);
  const online = useDataStore((s) => s.sync.online);
  const link = linkKindOf(window.location.pathname);

  useEffect(() => {
    void authActions.check();
    const offUnauthorized = onUnauthorized(authActions.sessionExpired);
    // The session is someone else's (another tab signed in): the start-up rules decide again.
    const offMismatch = onUserMismatch(() => void authActions.check());
    const offBroadcasts = listenAuthBroadcasts();
    const offForeground = watchForeground();
    return () => {
      offUnauthorized();
      offMismatch();
      offBroadcasts();
      offForeground();
    };
  }, []);

  // Sync runs for the device user only (never for the provisional legacy copy, never behind a link page).
  const owner = status === 'authed' && user !== null && link === null ? user.id : null;
  useEffect(() => (owner !== null ? startSync(owner) : undefined), [owner]);

  // The first check could not reach the server: check again when the network or the app comes back.
  useEffect(() => {
    if (status !== 'anon' || !offline) return;
    const recheck = () => void authActions.check();
    const recheckIfVisible = () => {
      if (document.visibilityState === 'visible') recheck();
    };
    window.addEventListener('online', recheck);
    document.addEventListener('visibilitychange', recheckIfVisible);
    return () => {
      window.removeEventListener('online', recheck);
      document.removeEventListener('visibilitychange', recheckIfVisible);
    };
  }, [status, offline]);

  if (link === 'invite')
    return (
      <Standalone>
        <InviteScreen />
      </Standalone>
    );
  if (link === 'reset')
    return (
      <Standalone>
        <ResetScreen />
      </Standalone>
    );
  if (status === 'checking') return <Splash />;
  if (status === 'anon')
    return (
      <Standalone>
        <LoginScreen />
      </Standalone>
    );
  if (!loaded) return <Splash hint={online ? undefined : WAITING_FOR_NETWORK} />;
  return <>{children}</>;
}
