import { useEffect, type ReactNode } from 'react';
import { LoginScreen } from '../screens/login/LoginScreen';
import { onUnauthorized, startSync, useDataStore } from '../store/data';
import { authActions, useAuth } from './auth';
import { Splash } from './Splash';

const WAITING_FOR_NETWORK = 'Немає зʼєднання. Дані завантажаться, щойно зʼявиться інтернет.';

/**
 * Shows the login screen until there is a session, then starts data sync and renders the app.
 * Children render only once data is loaded (device cache or server), so screens never see the
 * empty placeholder data of a fresh device.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const { status, offline } = useAuth();
  const loaded = useDataStore((s) => s.sync.loaded);
  const online = useDataStore((s) => s.sync.online);

  useEffect(() => {
    void authActions.check();
    return onUnauthorized(authActions.sessionExpired);
  }, []);

  useEffect(() => (status === 'authed' ? startSync() : undefined), [status]);

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

  if (status === 'checking') return <Splash />;
  if (status === 'anon') return <LoginScreen />;
  if (!loaded) return <Splash hint={online ? undefined : WAITING_FOR_NETWORK} />;
  return <>{children}</>;
}
