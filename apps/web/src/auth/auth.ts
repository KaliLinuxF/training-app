/**
 * Session state for the single-password login.
 *
 * - `checking` — asking the server whether the cookie is still valid (splash).
 * - `authed`   — the app is shown and syncing (also offline, when this device has data).
 * - `anon`     — the login screen is shown.
 */
import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { flushNow, hasDeviceCache, resetLocal } from '../store/data';

export type AuthStatus = 'checking' | 'authed' | 'anon';

export interface AuthState {
  status: AuthStatus;
  /** The last check could not reach the server (and there was no device data to fall back on). */
  offline: boolean;
}

export const UNSYNCED_LOGOUT_CONFIRM =
  'Деякі зміни ще не встигли синхронізуватися з сервером і будуть втрачені. Все одно вийти?';

export const useAuthStore = create<AuthState>(() => ({ status: 'checking', offline: false }));

let checking: Promise<void> | null = null;

async function runCheck(): Promise<void> {
  try {
    await api.me();
    useAuthStore.setState({ status: 'authed', offline: false });
  } catch (err) {
    if (err instanceof ApiError && err.isNetwork) {
      // Offline start: the cookie is probably fine, so open the app from the device cache.
      const hasData = await hasDeviceCache();
      useAuthStore.setState(
        hasData ? { status: 'authed', offline: false } : { status: 'anon', offline: true },
      );
      return;
    }
    if (!(err instanceof ApiError && err.status === 401)) console.error('[legko] session check failed', err);
    useAuthStore.setState({ status: 'anon', offline: false });
  }
}

export const authActions = {
  /** Resolves the current status from the server (`GET /api/auth/me`). Concurrent calls share one request. */
  check(): Promise<void> {
    checking ??= runCheck().finally(() => {
      checking = null;
    });
    return checking;
  },

  /** Throws `ApiError` (`bad_password`, `rate_limited`, `network`, …) when the login fails. */
  async login(password: string): Promise<void> {
    await api.login(password);
    useAuthStore.setState({ status: 'authed', offline: false });
  },

  /**
   * Sends what is still pending, asks before dropping unsynced changes, ends the server
   * session and wipes this device. Resolves `false` when the user cancelled.
   */
  async logout(): Promise<boolean> {
    const synced = await flushNow();
    if (!synced && !window.confirm(UNSYNCED_LOGOUT_CONFIRM)) return false;
    try {
      await api.logout();
    } catch (err) {
      // Offline or already logged out: the local wipe below is what matters.
      if (!(err instanceof ApiError && (err.isNetwork || err.status === 401))) {
        console.warn('[legko] logout request failed', err);
      }
    }
    await resetLocal();
    useAuthStore.setState({ status: 'anon', offline: false });
    return true;
  },

  /** The server rejected the session (401 during sync). Local data is kept for the next login. */
  sessionExpired(): void {
    useAuthStore.setState({ status: 'anon', offline: false });
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
