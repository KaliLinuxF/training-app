/**
 * Session state and the device-user rules (docs/multi-user.md §8.2).
 *
 * - `checking` — asking the server who is signed in (splash). Only on a device without a copy: one that has the
 *   device user's copy opens at once and checks the session in the background.
 * - `authed`   — the app is shown and syncing (also offline, when this device has the copy). `user` is null only
 *   while the legacy copy (written before accounts existed) is shown provisionally, before `me` says whose it is.
 * - `anon`     — the login screen is shown; `user` is still the device user when the session expired.
 *
 * One signed-in person per device (D12): signing in as another account wipes the previous one's device copy (after
 * the in-app confirm when it still has unsent changes) and reloads; a logout wipes everything and reloads.
 */
import { LINK_PATHS, type SessionUser } from '@legko/shared';
import { create } from 'zustand';
import { api, ApiError } from '../lib/api';
import { disablePush, getPushStatus, syncPushSubscription } from '../lib/push';
import { deviceTimeZone } from '../pwa/protocol';
import {
  hasLegacyCache,
  hasWipeTombstone,
  keepCacheInMemory,
  LEGACY_OWNER,
  loadDeviceUser,
  mergeLegacyCache,
  outboxSize,
  saveDeviceUser,
  wipeDevice,
} from '../store/cache';
import {
  adoptLegacy,
  bindOwner,
  boundOwner,
  flushNow,
  getAppData,
  hasDeviceCache,
  refreshFromServer,
  rehydrate,
  resetLocal,
  resumeSync,
  stopSync,
} from '../store/data';
import { sameTimeZone } from '../store/timezone';
import { ui, type ConfirmOptions } from '../store/ui';
import { authEnv, onAuthEnvChange, type AuthChannel } from './env';
import { clearLinkToken, LINK_TOKEN_KEY, linkKindOf } from './linkToken';

export type AuthStatus = 'checking' | 'authed' | 'anon';

export interface AuthState {
  status: AuthStatus;
  /** The last check could not reach the server (and there was no device data to fall back on). */
  offline: boolean;
  /** The device user (from the pointer at once, then from `me`); null on an empty device. */
  user: SessionUser | null;
}

/** «Вийти» always asks: it also switches off this device's reminders and wipes its copy. */
export const LOGOUT_CONFIRM: ConfirmOptions = {
  title: 'Вийти з Home Fit на цьому пристрої?',
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

/**
 * Signing in as `next` on a device whose copy (of `previous`; null = the legacy copy, whose account is not known)
 * still has `pending` unsent changes.
 */
export function SWITCH_CONFIRM(previous: string | null, next: string, pending: number): ConfirmOptions {
  const whose = previous === null ? 'Зміни' : `Зміни ${previous}`;
  return {
    title: `Увійти як ${next}?`,
    body: `${whose}, ще не надіслані на сервер: ${pending}. Якщо ввійти іншим акаунтом, їх буде втрачено.`,
    confirmLabel: `Увійти як ${next}`,
    cancelLabel: 'Скасувати',
    destructive: true,
  };
}

/** Where an admin lands after an invite / reset / setup link (D23). */
export const ADMIN_LANDING = '/settings/users';
/** Cross-tab channel: `{ type: 'switched' | 'logged-out' }` makes the other tabs reload. */
export const AUTH_CHANNEL = 'legko.auth';
/** `me` again when the app comes back to the foreground this long after the last one. */
export const ME_REFRESH_MS = 5 * 60_000;
/** sessionStorage keys of this app start with it (cleared on logout / switch). */
const SESSION_PREFIX = 'legko.';

export type AuthBroadcast = 'switched' | 'logged-out';

/** `signedIn` / `login` result: `cancelled` = the switch confirm was declined (the new session was ended). */
export type SignInResult = 'ok' | 'switched' | 'cancelled';

export interface SignedInOptions {
  /** `false`: do the storage work but leave the reload to the screen (the iOS Safari «Готово» state). */
  reload?: boolean;
  /** Where to land after a reload (default `landingPath`). */
  next?: string;
  /** After an invite / reset / setup link: the screen goes away (reload to the landing page), admins land on users. */
  link?: boolean;
}

export const useAuthStore = create<AuthState>(() => ({ status: 'checking', offline: false, user: null }));

let checking: Promise<void> | null = null;
/**
 * Bumped on login, logout, session expiry and a device switch. A check that started under an older value answers
 * about a session that is gone and must not change the state any more.
 */
let epoch = 0;
/** When the last `me` answered (for the foreground refresh). */
let lastMeAt = 0;
/** Numbers the background `me` checks: only the newest one acts on its answer. */
let verifySeq = 0;

function setAuth(patch: Partial<AuthState>): void {
  useAuthStore.setState(patch);
}

/** Where to go after signing in: `next`, else the users page for an admin after a link flow, else home. */
export function landingPath(user: SessionUser, { next, link = false }: { next?: string; link?: boolean } = {}): string {
  return next ?? (link && user.role === 'admin' ? ADMIN_LANDING : '/');
}

const isLinkPath = (path: string | undefined): boolean =>
  path !== undefined && (Object.values(LINK_PATHS) as string[]).includes(path);

const isNetworkLike = (err: unknown): boolean =>
  err instanceof ApiError && (err.isNetwork || err.code === 'outdated_server');

const isUnauthorized = (err: unknown): boolean => err instanceof ApiError && err.status === 401;

async function fetchMe(): Promise<SessionUser> {
  const { user } = await api.me();
  lastMeAt = authEnv().now();
  return user;
}

// ---- cross-tab ---------------------------------------------------------------------------

let channel: AuthChannel | null | undefined;
onAuthEnvChange(() => {
  channel = undefined;
});

function authChannel(): AuthChannel | null {
  if (channel === undefined) {
    try {
      channel = authEnv().openChannel(AUTH_CHANNEL);
    } catch {
      channel = null;
    }
  }
  return channel;
}

function broadcast(type: AuthBroadcast): void {
  try {
    authChannel()?.postMessage({ type });
  } catch {
    // Another tab only finds out through `X-Legko-User` then (D11).
  }
}

/** Reloads this tab when another tab signed in as someone else or logged out. Returns a cleanup. */
export function listenAuthBroadcasts(): () => void {
  const ch = authChannel();
  if (!ch) return () => undefined;
  const onMessage = (event: MessageEvent) => {
    const type = (event.data as { type?: unknown } | null)?.type;
    if (type === 'switched' || type === 'logged-out') authEnv().reload();
  };
  ch.addEventListener('message', onMessage);
  return () => ch.removeEventListener('message', onMessage);
}

/** Drops this app's sessionStorage keys (e.g. `legko.setupShown`); the link token only when no link flow goes on. */
function clearSessionKeys(keepLinkToken: boolean): void {
  try {
    const store = authEnv().session();
    if (!store) return;
    const doomed: string[] = [];
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i);
      if (key?.startsWith(SESSION_PREFIX) && !(keepLinkToken && key === LINK_TOKEN_KEY)) doomed.push(key);
    }
    for (const key of doomed) store.removeItem(key);
  } catch {
    // Storage blocked: nothing to clear.
  }
}

// ---- push --------------------------------------------------------------------------------

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

// ---- device user ---------------------------------------------------------------------------

/** The device user is `user` (same account): store the fresh copy of it. */
async function confirmDeviceUser(user: SessionUser): Promise<void> {
  await saveDeviceUser(user);
  setAuth({ status: 'authed', offline: false, user });
  resumeSync();
  refreshPush();
}

/**
 * The device becomes `user`'s: reminders of the previous person stop, every copy on the device is wiped (the legacy
 * keys survive a switch to the legacy owner: her own unsent ops are adopted after the reload), the pointer is saved,
 * other tabs reload, and so does this one (unless `reload` is false: the iOS «Готово» state reloads later).
 */
async function switchDevice(
  user: SessionUser,
  target: string,
  { reload = true, keepLinkToken = false }: { reload?: boolean; keepLinkToken?: boolean } = {},
): Promise<void> {
  epoch += 1;
  stopSync();
  await disablePush().catch(() => undefined);
  await resetLocal({ keepLegacy: user.legacyOwner });
  bindOwner(user.id);
  await saveDeviceUser(user);
  clearSessionKeys(keepLinkToken);
  broadcast('switched');
  if (reload) {
    authEnv().replace(target);
    return;
  }
  setAuth({ status: 'authed', offline: false, user });
}

/**
 * The session belongs to `user`, the device copy to someone else (`previous`: the pointer, or null for the legacy
 * copy). Nothing pending → switch without asking (the cookie already belongs to `user`). Something pending → stop,
 * show the login screen, wipe nothing: signing in as the device user sends it, anyone else goes through the confirm.
 */
async function otherAccount(user: SessionUser, previous: SessionUser | null, started: number): Promise<void> {
  const pending = await outboxSize(previous?.id ?? LEGACY_OWNER);
  if (started !== epoch) return;
  if (pending > 0) {
    epoch += 1;
    stopSync();
    setAuth({ status: 'anon', offline: false, user: previous });
    return;
  }
  // Stay on a link screen (its token is kept); anywhere else start over at home (the reminder was for the other person).
  const here = window.location.pathname;
  const onLink = linkKindOf(here) !== null;
  await switchDevice(user, onLink ? here : '/', { keepLinkToken: onLink });
}

/** `me` answered `user`: decide whose device this is (start-up rules 2–4). */
async function onSessionUser(
  user: SessionUser,
  pointer: SessionUser | null,
  legacy: boolean,
  started: number,
): Promise<void> {
  if (started !== epoch) return;
  if (pointer) {
    if (pointer.id === user.id) return confirmDeviceUser(user);
    return otherAccount(user, pointer, started);
  }
  if (legacy) {
    if (!user.legacyOwner) return otherAccount(user, null, started);
    await adoptLegacy(user.id);
    if (started !== epoch) return;
    return confirmDeviceUser(user);
  }
  bindOwner(user.id);
  return confirmDeviceUser(user);
}

/**
 * Background half of a start-up from the device copy. Network problems and an outdated server are ignored. Only the
 * newest verification acts on its answer (a re-check after a 409 must not switch twice).
 */
function verifyInBackground(pointer: SessionUser | null, legacy: boolean, started: number): Promise<void> {
  const seq = ++verifySeq;
  return fetchMe()
    .then(
      (user) => (seq === verifySeq ? onSessionUser(user, pointer, legacy, started) : undefined),
      (err: unknown) => {
        if (seq !== verifySeq || started !== epoch) return;
        if (isUnauthorized(err)) {
          authActions.sessionExpired();
          return;
        }
        if (!isNetworkLike(err)) console.error('[legko] session check failed', err);
      },
    )
    .catch((err: unknown) => console.error('[legko] could not apply the session check', err));
}

/** Foreground `me` (nothing to show yet). */
async function checkInForeground(pointer: SessionUser | null, legacy: boolean, started: number): Promise<void> {
  let user: SessionUser;
  try {
    user = await fetchMe();
  } catch (err) {
    if (started !== epoch) return;
    if (isNetworkLike(err)) {
      // Nothing on this device to show: the login screen explains that the server is out of reach.
      setAuth({ status: 'anon', offline: true, user: pointer });
      return;
    }
    if (!isUnauthorized(err)) console.error('[legko] session check failed', err);
    setAuth({ status: 'anon', offline: false, user: pointer });
    return;
  }
  await onSessionUser(user, pointer, legacy, started);
}

async function runCheck(): Promise<void> {
  const started = epoch;
  // 0. A logout / switch wipe that was never verified: wipe again; if that fails too, trust nothing on the device.
  let empty = false;
  if (hasWipeTombstone() && !(await wipeDevice())) {
    keepCacheInMemory();
    empty = true;
  }
  if (started !== epoch) return;
  const pointer = empty ? null : await loadDeviceUser();
  const legacy = empty ? false : await hasLegacyCache();
  if (started !== epoch) return;

  // 1. The rolled-back app wrote the legacy keys for the legacy owner: their unsent ops are sent once. A pointer of
  //    anyone else leaves them alone (never shown, never sent) until the legacy owner signs in or a logout wipes.
  if (pointer && legacy && pointer.legacyOwner) {
    await mergeLegacyCache(pointer.id);
    if (boundOwner() === pointer.id) await rehydrate();
    if (started !== epoch) return;
  }

  // 2. The device user's copy opens at once (offline-first); `me` confirms in the background.
  if (pointer) {
    bindOwner(pointer.id);
    setAuth({ user: pointer });
    const cached = await hasDeviceCache();
    if (started !== epoch) return;
    if (cached) {
      setAuth({ status: 'authed', offline: false, user: pointer });
      void verifyInBackground(pointer, false, started);
      return;
    }
    await checkInForeground(pointer, false, started);
    return;
  }

  // 3. Only the legacy copy: shown provisionally (no sync — whose it is is not known yet), adopted on `me`.
  if (legacy && !pointer) {
    bindOwner(LEGACY_OWNER);
    const cached = await hasDeviceCache();
    if (started !== epoch) return;
    if (cached) {
      setAuth({ status: 'authed', offline: false, user: null });
      void verifyInBackground(null, true, started);
      return;
    }
    await checkInForeground(null, true, started);
    return;
  }

  // 4. Nothing on the device.
  await checkInForeground(null, false, started);
}

export const authActions = {
  /** Resolves the current status (device copy, then `GET /api/auth/me`). Concurrent calls share one run. */
  check(): Promise<void> {
    checking ??= runCheck()
      .catch((err: unknown) => {
        console.error('[legko] session check crashed', err);
        if (useAuthStore.getState().status === 'checking') setAuth({ status: 'anon', offline: false });
      })
      .finally(() => {
        checking = null;
      });
    return checking;
  },

  /** Throws `ApiError` (`bad_credentials`, `account_disabled`, `rate_limited`, `network`, …) when the login fails. */
  async login(username: string, password: string): Promise<SignInResult> {
    const { user } = await api.login(username, password);
    return authActions.signedIn(user);
  },

  /**
   * A login, invite accept or reset complete answered `user` (and set its cookie). Decides what happens to the
   * device copy:
   * - another account's copy (or the legacy copy and `user` is not its owner) → when it has unsent changes, the
   *   switch confirm (cancel ends the new session and resolves `cancelled`); then wipe + reload (`switched`);
   * - the legacy copy and `user` is the legacy owner → adopted;
   * - the same account (expired session) → memory and outbox kept, pending changes are sent;
   * - an empty device → the pointer.
   * After a link flow the page then goes to `landingPath` (unless `reload` is false).
   */
  async signedIn(user: SessionUser, { reload = true, next, link = false }: SignedInOptions = {}): Promise<SignInResult> {
    epoch += 1;
    const started = epoch;
    lastMeAt = authEnv().now();
    const target = landingPath(user, { next, link });
    const previous = await loadDeviceUser();
    const legacy = await hasLegacyCache();
    // The legacy keys are wiped by a switch unless the new account is their owner.
    const legacyDoomed = legacy && !user.legacyOwner;
    const another = previous !== null ? previous.id !== user.id : legacyDoomed;

    if (another) {
      const own = previous !== null ? await outboxSize(previous.id) : 0;
      const legacyPending = legacyDoomed ? await outboxSize(LEGACY_OWNER) : 0;
      const pending = own + legacyPending;
      if (pending > 0) {
        // Only name the account when all of it is that account's.
        const name = previous !== null && legacyPending === 0 ? previous.username : null;
        if (!(await ui.confirm(SWITCH_CONFIRM(name, user.username, pending)))) {
          await api.logout().catch(() => undefined);
          if (started === epoch) setAuth({ status: 'anon', offline: false, user: previous });
          return 'cancelled';
        }
      }
      await switchDevice(user, target, { reload });
      return 'switched';
    }

    if (legacy && user.legacyOwner) await adoptLegacy(user.id);
    else bindOwner(user.id);
    await saveDeviceUser(user);
    if (started !== epoch) return 'ok';
    setAuth({ status: 'authed', offline: false, user });
    resumeSync();
    refreshPush();
    if (link) {
      clearLinkToken();
      if (reload) authEnv().replace(target);
    }
    return 'ok';
  },

  /**
   * Sends what is still pending, then always asks (in the app's own dialog): logging out stops reminders on this
   * device and wipes its copy, and unsynced changes would be lost. Then ends the server session, wipes the device
   * (bounded, never hangs), tells the other tabs and reloads to `next` (default `/`). Resolves `false` when cancelled.
   */
  async logout(next?: string): Promise<boolean> {
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
    epoch += 1;
    await resetLocal();
    clearSessionKeys(isLinkPath(next));
    broadcast('logged-out');
    setAuth({ status: 'anon', offline: false, user: null });
    authEnv().replace(next ?? '/');
    return true;
  },

  /** The server rejected the session (401 during sync). The device copy is kept for the next login. */
  sessionExpired(): void {
    epoch += 1;
    stopSync();
    setAuth({ status: 'anon', offline: false });
  },

  /** A fresh copy of the signed-in account (rename, role change): stored as the pointer. Another id is ignored. */
  updateUser(user: SessionUser): void {
    const current = useAuthStore.getState().user;
    if (current !== null && current.id !== user.id) return;
    void saveDeviceUser(user);
    setAuth({ user });
  },

  /**
   * Asks the server again who is signed in (foreground after a while, an admin page answered 403): the same account
   * → `updateUser`; another one → the start-up rules decide; 401 → the login screen; network / outdated server →
   * nothing changes.
   */
  async refreshUser(): Promise<void> {
    const started = epoch;
    const current = useAuthStore.getState().user;
    let user: SessionUser;
    try {
      user = await fetchMe();
    } catch (err) {
      if (started === epoch && isUnauthorized(err) && useAuthStore.getState().status === 'authed') {
        authActions.sessionExpired();
      }
      return;
    }
    if (started !== epoch || current === null) return;
    if (current.id === user.id) authActions.updateUser(user);
    else await authActions.check();
  },
};

/** `me` again when the app comes back to the foreground at least `ME_REFRESH_MS` after the last one. */
export function watchForeground(): () => void {
  const onVisible = () => {
    if (document.visibilityState !== 'visible') return;
    if (useAuthStore.getState().status !== 'authed') return;
    if (authEnv().now() - lastMeAt < ME_REFRESH_MS) return;
    void authActions.refreshUser();
  };
  document.addEventListener('visibilitychange', onVisible);
  return () => document.removeEventListener('visibilitychange', onVisible);
}

export interface UseAuth extends AuthState {
  login: (username: string, password: string) => Promise<SignInResult>;
  logout: (next?: string) => Promise<boolean>;
}

export function useAuth(): UseAuth {
  const status = useAuthStore((s) => s.status);
  const offline = useAuthStore((s) => s.offline);
  const user = useAuthStore((s) => s.user);
  return { status, offline, user, login: authActions.login, logout: authActions.logout };
}

/** The device user (the full `SessionUser`, from the pointer at once, then from `me`); null when there is none. */
export function useCurrentUser(): SessionUser | null {
  return useAuthStore((s) => s.user);
}
