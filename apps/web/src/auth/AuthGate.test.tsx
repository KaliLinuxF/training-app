import type { SessionUser } from '@legko/shared';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';
import { ApiError } from '../lib/api';
import { cacheKeys, DEVICE_USER_KEY, LEGACY_KEYS } from '../store/cache';
import { bindOwner, dataActions, getAppData, resetLocal, useAppData } from '../store/data';
import { deferred, fakeIdb, sampleData, sessionUser, settle, type FakeIdb } from '../store/test-utils';
import { ui, useUiStore } from '../store/ui';
import { ConfirmHost } from '../ui';
import { authActions, LOGOUT_CONFIRM, UNSYNCED_LOGOUT_CONFIRM, useAuthStore } from './auth';
import { AuthGate } from './AuthGate';
import { setAuthEnv } from './env';

const mocks = vi.hoisted(() => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getData: vi.fn(),
    sendOps: vi.fn(),
    importData: vi.fn(),
    inviteCheck: vi.fn(),
    resetCheck: vi.fn(),
  },
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('idb-keyval', () => mocks.idb);

const OLYA = sessionUser({ id: 'b2'.padEnd(32, '0'), username: 'olya' });
const ANNA = sessionUser({ id: 'a1'.padEnd(32, '0'), username: 'anna', legacyOwner: true });
const ADMIN = sessionUser({ id: 'c3'.padEnd(32, '0'), username: 'admin', role: 'admin' });
const TOKEN = 'T'.repeat(43);

const me = (user: SessionUser = OLYA) => ({ ok: true as const, user });
const networkError = () => new ApiError(0, 'network', 'offline');
const unauthorized = () => new ApiError(401, 'unauthorized', 'Unauthorized');
const mismatch = () => new ApiError(409, 'user_mismatch', 'На цьому пристрої ввійдено в інший акаунт');

/** Stands in for the app shell: proves children render with the store's data. */
function App() {
  const data = useAppData();
  return <p>Застосунок: {data.weights.map((w) => w.kg).join(', ') || 'порожньо'}</p>;
}

const renderGate = () =>
  render(
    <AuthGate>
      <App />
    </AuthGate>,
  );

let idb: FakeIdb;
let replace: ReturnType<typeof vi.fn<(url: string) => void>>;
let restoreEnv: () => void;

function seedDevice(user: SessionUser, weights = [{ date: '2026-10-03', kg: 65.2 }]) {
  idb.store.set(DEVICE_USER_KEY, user);
  idb.store.set(cacheKeys(user.id).data, sampleData({ weights }));
}

const loginButton = () => screen.findByRole('button', { name: 'Увійти' });

async function logIn(username: string, password: string) {
  fireEvent.change(await screen.findByLabelText('Імʼя користувача'), { target: { value: username } });
  fireEvent.change(screen.getByLabelText('Пароль'), { target: { value: password } });
  fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));
}

beforeEach(async () => {
  idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  mocks.idb.keys.mockReset().mockImplementation(idb.keys);
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.me.mockResolvedValue(me());
  mocks.api.getData.mockResolvedValue(sampleData({ weights: [{ date: '2026-10-01', kg: 66 }] }));
  mocks.api.sendOps.mockImplementation(async (ops: unknown[]) => ({ ok: true, applied: ops.length }));
  mocks.api.logout.mockResolvedValue({ ok: true });
  replace = vi.fn();
  restoreEnv = setAuthEnv({ replace, reload: vi.fn(), openChannel: () => null, session: () => sessionStorage });
  bindOwner(null);
  await resetLocal();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  useAuthStore.setState({ status: 'checking', offline: false, user: null });
});

afterEach(async () => {
  useUiStore.getState().confirm?.resolve(false);
  cleanup();
  await resetLocal();
  restoreEnv();
  window.history.replaceState(null, '', '/');
  vi.restoreAllMocks();
});

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

describe('AuthGate', () => {
  it('shows the splash while checking, then the app once data is loaded', async () => {
    const answer = deferred<ReturnType<typeof me>>();
    mocks.api.me.mockReturnValue(answer.promise);
    renderGate();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText(/Застосунок/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Увійти' })).toBeNull();

    answer.resolve(me());
    expect(await screen.findByText('Застосунок: 66')).toBeTruthy();
    // The device user's copy, synced for them.
    expect(mocks.api.getData).toHaveBeenCalledWith(OLYA.id);
  });

  it('keeps the splash until the server copy arrives on a fresh device', async () => {
    const server = deferred<ReturnType<typeof sampleData>>();
    mocks.api.getData.mockReturnValue(server.promise);
    renderGate();

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authed'));
    expect(screen.getAllByRole('status').length).toBeGreaterThan(0);

    server.resolve(sampleData({ weights: [{ date: '2026-10-02', kg: 65.5 }] }));
    expect(await screen.findByText('Застосунок: 65.5')).toBeTruthy();
  });

  it('shows the login screen without a session', async () => {
    mocks.api.me.mockRejectedValue(unauthorized());
    renderGate();

    expect(await loginButton()).toBeTruthy();
    expect(screen.queryByText(/Немає зʼєднання/)).toBeNull();
    expect(mocks.api.getData).not.toHaveBeenCalled();
  });

  it('opens the app offline from the device user’s copy', async () => {
    seedDevice(OLYA);
    mocks.api.me.mockRejectedValue(networkError());
    mocks.api.getData.mockRejectedValue(networkError());
    renderGate();

    expect(await screen.findByText('Застосунок: 65.2')).toBeTruthy();
    expect(useAuthStore.getState()).toEqual({ status: 'authed', offline: false, user: OLYA });
  });

  it('opens the app from the device copy at once when the server does not answer', async () => {
    // One bar in a gym basement: requests neither succeed nor fail for a long time.
    seedDevice(OLYA);
    mocks.api.me.mockReturnValue(never());
    mocks.api.getData.mockReturnValue(never());
    renderGate();

    expect(await screen.findByText('Застосунок: 65.2')).toBeTruthy();
    expect(mocks.api.me).toHaveBeenCalledTimes(1);
  });

  it('a device with data still lands on the login screen when the background check finds no session', async () => {
    seedDevice(OLYA);
    const answer = deferred<ReturnType<typeof me>>();
    mocks.api.me.mockReturnValue(answer.promise);
    mocks.api.getData.mockReturnValue(never());
    renderGate();
    await screen.findByText('Застосунок: 65.2');

    answer.reject(unauthorized());
    expect(await loginButton()).toBeTruthy();
    // Kept for the next login, and her name is filled in.
    expect(getAppData().weights).toEqual([{ date: '2026-10-03', kg: 65.2 }]);
    expect(screen.getByLabelText<HTMLInputElement>('Імʼя користувача').value).toBe('olya');
  });

  it('ignores a late answer about the old session after logging in again', async () => {
    seedDevice(OLYA);
    const answer = deferred<ReturnType<typeof me>>();
    mocks.api.me.mockReturnValue(answer.promise);
    mocks.api.getData.mockRejectedValueOnce(unauthorized());
    mocks.api.login.mockResolvedValue(me());
    renderGate();

    // Sync found the session gone while the background check is still hanging.
    await logIn('olya', 'секрет-123');
    expect(await screen.findByText('Застосунок: 66')).toBeTruthy();

    answer.reject(unauthorized());
    await settle();
    expect(useAuthStore.getState().status).toBe('authed');
    expect(screen.getByText('Застосунок: 66')).toBeTruthy();
  });

  it('shows the login screen with an offline hint when offline without a cache', async () => {
    mocks.api.me.mockRejectedValue(networkError());
    renderGate();

    expect(await loginButton()).toBeTruthy();
    expect(screen.getByText(/Немає зʼєднання з сервером/)).toBeTruthy();
  });

  it('checks again when the network comes back', async () => {
    mocks.api.me.mockRejectedValueOnce(networkError()).mockResolvedValue(me());
    renderGate();
    await loginButton();

    window.dispatchEvent(new Event('online'));
    expect(await screen.findByText('Застосунок: 66')).toBeTruthy();
  });

  it('returns to the login screen when the server drops the session', async () => {
    mocks.api.getData.mockRejectedValue(unauthorized());
    renderGate();

    expect(await loginButton()).toBeTruthy();
    expect(useAuthStore.getState()).toEqual({ status: 'anon', offline: false, user: OLYA });
  });

  it('logs in with a username and opens the app', async () => {
    mocks.api.me.mockRejectedValue(unauthorized());
    mocks.api.login.mockResolvedValue(me());
    renderGate();

    await logIn('olya', 'секрет-123');

    expect(await screen.findByText('Застосунок: 66')).toBeTruthy();
    expect(mocks.api.login).toHaveBeenCalledWith('olya', 'секрет-123');
    expect(mocks.api.getData).toHaveBeenCalledWith(OLYA.id);
  });

  it('a 409 user_mismatch runs the start-up rules again (another account → switch)', async () => {
    seedDevice(OLYA);
    mocks.api.me.mockReturnValueOnce(never()).mockResolvedValue(me(ADMIN));
    mocks.api.getData.mockRejectedValue(mismatch());
    renderGate();

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(mocks.api.me).toHaveBeenCalledTimes(2);
    expect(mocks.api.getData).toHaveBeenCalledTimes(1);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ADMIN);
  });

  it('shows the legacy copy provisionally and starts syncing only once `me` says it is the legacy owner’s', async () => {
    idb.store.set(LEGACY_KEYS.data, sampleData({ weights: [{ date: '2026-09-30', kg: 67 }] }));
    const answer = deferred<ReturnType<typeof me>>();
    mocks.api.me.mockReturnValue(answer.promise);
    renderGate();

    expect(await screen.findByText('Застосунок: 67')).toBeTruthy();
    await settle();
    expect(mocks.api.getData).not.toHaveBeenCalled();

    answer.resolve(me(ANNA));
    await waitFor(() => expect(mocks.api.getData).toHaveBeenCalledWith(ANNA.id));
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ANNA);
  });
});

describe('link pages', () => {
  it('routes /invite to the invite screen before the status (the fragment is stripped)', async () => {
    mocks.api.me.mockRejectedValue(unauthorized());
    mocks.api.inviteCheck.mockResolvedValue({ ok: true, expiresAt: Date.UTC(2026, 9, 28, 12) });
    window.history.replaceState(null, '', `/invite#${TOKEN}`);
    renderGate();

    expect(await screen.findByRole('heading', { level: 1, name: 'Запрошення в Легко' })).toBeTruthy();
    expect(mocks.api.inviteCheck).toHaveBeenCalledWith(TOKEN);
    expect(window.location.hash).toBe('');
    expect(window.location.pathname).toBe('/invite');
    expect(screen.getByRole('button', { name: 'Створити акаунт' })).toBeTruthy();
    expect(mocks.api.getData).not.toHaveBeenCalled();
  });

  it('routes /reset to the reset screen, also while signed in, without syncing behind it', async () => {
    seedDevice(OLYA);
    mocks.api.resetCheck.mockResolvedValue({ ok: true, username: 'admin', purpose: 'setup', expiresAt: 1 });
    window.history.replaceState(null, '', `/reset#${TOKEN}`);
    renderGate();

    expect(await screen.findByText('Це посилання для admin, а на цьому пристрої ввійдено як olya.')).toBeTruthy();
    await settle();
    expect(mocks.api.getData).not.toHaveBeenCalled();
  });

  it('mounts the in-app dialog next to the link pages («Вийти й продовжити» asks)', async () => {
    seedDevice(OLYA);
    mocks.api.inviteCheck.mockResolvedValue({ ok: true, expiresAt: 1 });
    window.history.replaceState(null, '', `/invite#${TOKEN}`);
    renderGate();

    fireEvent.click(await screen.findByRole('button', { name: 'Вийти й продовжити' }));
    const dialog = await screen.findByRole('alertdialog', { name: LOGOUT_CONFIRM.title });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вийти' }));

    await waitFor(() => expect(replace).toHaveBeenCalledWith('/invite'));
    expect(idb.store.size).toBe(0);
    expect(sessionStorage.getItem('legko.linkToken')).toBe(JSON.stringify({ kind: 'invite', token: TOKEN }));
  });
});

describe('logout', () => {
  async function openApp(): Promise<void> {
    renderGate();
    await screen.findByText('Застосунок: 66');
  }

  it('flushes, asks, ends the session, wipes the device and reloads', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    await openApp();
    dataActions.setWeight('2026-10-09', 65);

    expect(await authActions.logout()).toBe(true);

    expect(mocks.api.sendOps).toHaveBeenCalled();
    expect(mocks.api.sendOps.mock.invocationCallOrder[0]).toBeLessThan(
      confirm.mock.invocationCallOrder[0] ?? 0,
    );
    expect(confirm).toHaveBeenCalledWith(LOGOUT_CONFIRM);
    expect(mocks.api.logout).toHaveBeenCalledTimes(1);
    expect(await loginButton()).toBeTruthy();
    expect(idb.store.size).toBe(0);
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('always asks in the app’s own dialog, and «Скасувати» keeps everything', async () => {
    // The app shell mounts the dialog host once (here: the stand-in app has none).
    render(<ConfirmHost />);
    await openApp();

    const leaving = authActions.logout();
    const dialog = await screen.findByRole('alertdialog', { name: LOGOUT_CONFIRM.title });
    expect(dialog.textContent).toContain(LOGOUT_CONFIRM.body);
    // Destructive: focus starts on the safe answer.
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Скасувати' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Скасувати' }));

    expect(await leaving).toBe(false);
    expect(mocks.api.logout).not.toHaveBeenCalled();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Застосунок: 66')).toBeTruthy();
    expect(idb.store.get(cacheKeys(OLYA.id).data)).toBeTruthy();
  });

  it('warns about unsynced changes instead, and can be cancelled', async () => {
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(false);
    await openApp();
    mocks.api.sendOps.mockRejectedValue(networkError());
    dataActions.setWeight('2026-10-09', 65);

    expect(await authActions.logout()).toBe(false);

    expect(confirm).toHaveBeenCalledTimes(1);
    expect(confirm).toHaveBeenCalledWith(UNSYNCED_LOGOUT_CONFIRM);
    expect(mocks.api.logout).not.toHaveBeenCalled();
    expect(screen.getByText('Застосунок: 66, 65')).toBeTruthy();
  });

  it('logs out offline once confirmed', async () => {
    vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    await openApp();
    mocks.api.sendOps.mockRejectedValue(networkError());
    mocks.api.logout.mockRejectedValue(networkError());
    dataActions.setWeight('2026-10-09', 65);

    expect(await authActions.logout()).toBe(true);
    expect(await loginButton()).toBeTruthy();
    expect(idb.store.size).toBe(0);
  });
});
