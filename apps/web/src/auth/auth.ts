/**
 * Session state for the single-password login.
 *
 * - `checking` — asking the server whether the cookie is still valid (splash). Only on a device
 *   without data: one that has data opens at once and checks the session in the background.
 * - `authed`   — the app is shown and syncing (also offline, when this device has data).
 * - `anon`     — the login screen is shown.
 */
import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { disablePush, getPushStatus, syncPushSubscription } from '../lib/push';
import { deviceTimeZone } from '../pwa/protocol';
import { flushNow, getAppData, hasDeviceCache, refreshFromServer, resetLocal } from '../store/data';
import { sameTimeZone } from '../store/timezone';
import { ui, type ConfirmOptions } from '../store/ui';

export type AuthStatus = 'checking' | 'authed' | 'anon';

export interface AuthState {
  status: AuthStatus;
  /** The last check could not reach the server (and there was no device data to fall back on). */
  offline: boolean;
}

/** «Вийти» always asks: it also switches off this device's reminders and wipes its copy. */
export const LOGOUT_CONFIRM: ConfirmOptions = {
  title: 'Вийти з Легко на цьому пристрої?',
  body: 'Нагадування сюди більше не приходитимуть, а дані на пристрої буде очищено. Усі записи залишаться на сервері.',
  confirmLabel: 'Вийти',
  destructive: true,
};

/** Asked instead of `LOGOUT_CONFIRM` when some changes could not reach the server. */
export const UNSYNCED_LOGOUT_CONFIRM: ConfirmOptions = {
  title: 'Деякі зміни ще не синхронізовано',
  body: 'Якщо вийти зараз, вони будуть втрачені.',
  confirmLabel: 'Усе одно вийти',
  destructive: true,
};

export const useAuthStore = create<AuthState>(() => ({ status: 'checking', offline: false }));

let checking: Promise<void> | null = null;
/**
 * Bumped on login, logout and session expiry. A check that started under an older value
 * answers about a session that is gone and must not change the state any more.
 */
let epoch = 0;

function setAuth(state: AuthState): void {
  useAuthStore.setState(state);
}

async function runCheck(): Promise<void> {
  const started = epoch;
  // A device with data opens straight away, also on a weak or hanging network (SPEC §3.5).
  // The session is confirmed in the background; a 401 there, or from sync, shows the login.
  if (await hasDeviceCache()) {
    if (started !== epoch) return;
    setAuth({ status: 'authed', offline: false });
    verifySession(started);
    return;
  }
  try {
    await api.me();
    if (started !== epoch) return;
    setAuth({ status: 'authed', offline: false });
    refreshPush();
  } catch (err) {
    if (started !== epoch) return;
    if (err instanceof ApiError && err.isNetwork) {
      // Nothing on this device to show: the login screen explains that the server is out of reach.
      setAuth({ status: 'anon', offline: true });
      return;
    }
    if (!(err instanceof ApiError && err.status === 401)) console.error('[legko] session check failed', err);
    setAuth({ status: 'anon', offline: false });
  }
}

/** Background half of a start-up from the device cache. Network problems are ignored (sync retries). */
function verifySession(started: number): void {
  api.me().then(
    () => {
      if (started === epoch) refreshPush();
    },
    (err: unknown) => {
      if (started !== epoch) return;
      if (err instanceof ApiError && err.status === 401) authActions.sessionExpired();
      else if (!(err instanceof ApiError && err.isNetwork))
        console.error('[legko] session check failed', err);
    },
  );
}

/**
 * Re-registers this device's push subscription once the session is known to be valid (best effort).
 * The server moves `settings.timezone` to the zone sent with it, so when this phone's zone differs
 * from the local copy, the copy is re-read: a later settings save must not send the old zone back.
 */
function refreshPush(): void {
  syncPushSubscription()
    .then(async () => {
      if ((await getPushStatus()) !== 'enabled') return;
      const zone = deviceTimeZone();
      if (zone && !sameTimeZone(zone, getAppData().settings.timezone)) refreshFromServer();
    })
    .catch(() => {});
}

export const authActions = {
  /** Resolves the current status (device cache, then `GET /api/auth/me`). Concurrent calls share one run. */
  check(): Promise<void> {
    checking ??= runCheck().finally(() => {
      checking = null;
    });
    return checking;
  },

  /** Throws `ApiError` (`bad_password`, `rate_limited`, `network`, …) when the login fails. */
  async login(password: string): Promise<void> {
    await api.login(password);
    epoch += 1;
    setAuth({ status: 'authed', offline: false });
    refreshPush();
  },

  /**
   * Sends what is still pending, then always asks (in the app's own dialog): logging out stops
   * reminders on this device and wipes its data, and unsynced changes would be lost. Then ends
   * the server session and wipes this device. Resolves `false` when she cancelled.
   */
  async logout(): Promise<boolean> {
    const synced = await flushNow();
    if (!(await ui.confirm(synced ? LOGOUT_CONFIRM : UNSYNCED_LOGOUT_CONFIRM))) return false;
    // Stop reminders on this device while the session still authorises the unsubscribe call.
    await disablePush().catch(() => {});
    try {
      await api.logout();
    } catch (err) {
      // Offline or already logged out: the local wipe below is what matters.
      if (!(err instanceof ApiError && (err.isNetwork || err.status === 401))) {
        console.warn('[legko] logout request failed', err);
      }
    }
    await resetLocal();
    epoch += 1;
    setAuth({ status: 'anon', offline: false });
    return true;
  },

  /** The server rejected the session (401 during sync). Local data is kept for the next login. */
  sessionExpired(): void {
    epoch += 1;
    setAuth({ status: 'anon', offline: false });
  },
};

export interface UseAuth extends AuthState {
  login: (password: string) => Promise<void>;
  logout: () => Promise<boolean>;
}

export function useAuth(): UseAuth {
  const status = useAuthStore((s) => s.status);
  const offline = useAuthStore((s) => s.offline);
  return { status, offline, login: authActions.login, logout: authActions.logout };
}
