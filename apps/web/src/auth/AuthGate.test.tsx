import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';
import { ApiError } from '../lib/api';
import { CACHE_KEYS } from '../store/cache';
import { dataActions, getAppData, resetLocal, useAppData } from '../store/data';
import { deferred, fakeIdb, sampleData, settle, type FakeIdb } from '../store/test-utils';
import { ui, useUiStore } from '../store/ui';
import { ConfirmHost } from '../ui';
import { authActions, LOGOUT_CONFIRM, UNSYNCED_LOGOUT_CONFIRM, useAuthStore } from './auth';
import { AuthGate } from './AuthGate';

const mocks = vi.hoisted(() => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getData: vi.fn(),
    sendOps: vi.fn(),
    importData: vi.fn(),
  },
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn() },
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('idb-keyval', () => mocks.idb);

const networkError = () => new ApiError(0, 'network', 'offline');
const unauthorized = () => new ApiError(401, 'unauthorized', 'Unauthorized');

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

beforeEach(async () => {
  idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.me.mockResolvedValue({ ok: true });
  mocks.api.getData.mockResolvedValue(sampleData({ weights: [{ date: '2026-10-01', kg: 66 }] }));
  mocks.api.sendOps.mockImplementation(async (ops: unknown[]) => ({ ok: true, applied: ops.length }));
  mocks.api.logout.mockResolvedValue({ ok: true });
  await resetLocal();
  useAuthStore.setState({ status: 'checking', offline: false });
});

afterEach(async () => {
  useUiStore.getState().confirm?.resolve(false);
  cleanup();
  await resetLocal();
  vi.restoreAllMocks();
});

const never = <T,>(): Promise<T> => new Promise<T>(() => undefined);

describe('AuthGate', () => {
  it('shows the splash while checking, then the app once data is loaded', async () => {
    const me = deferred<{ ok: true }>();
    mocks.api.me.mockReturnValue(me.promise);
    renderGate();

    expect(screen.getByRole('status')).toBeTruthy();
    expect(screen.queryByText(/Застосунок/)).toBeNull();
    expect(screen.queryByRole('button', { name: 'Увійти' })).toBeNull();

    me.resolve({ ok: true });
    expect(await screen.findByText('Застосунок: 66')).toBeTruthy();
  });

  it('keeps the splash until the server copy arrives on a fresh device', async () => {
    const server = deferred<ReturnType<typeof sampleData>>();
    mocks.api.getData.mockReturnValue(server.promise);
    renderGate();

    await waitFor(() => expect(useAuthStore.getState().status).toBe('authed'));
    expect(screen.getByRole('status')).toBeTruthy();

    server.resolve(sampleData({ weights: [{ date: '2026-10-02', kg: 65.5 }] }));
    expect(await screen.findByText('Застосунок: 65.5')).toBeTruthy();
  });

  it('shows the login screen without a session', async () => {
    mocks.api.me.mockRejectedValue(unauthorized());
    renderGate();

    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
    expect(screen.queryByText(/Немає зʼєднання/)).toBeNull();
    expect(mocks.api.getData).not.toHaveBeenCalled();
  });

  it('opens the app offline from the device cache', async () => {
    idb.store.set(CACHE_KEYS.data, sampleData({ weights: [{ date: '2026-10-03', kg: 65.2 }] }));
    mocks.api.me.mockRejectedValue(networkError());
    mocks.api.getData.mockRejectedValue(networkError());
    renderGate();

    expect(await screen.findByText('Застосунок: 65.2')).toBeTruthy();
    expect(useAuthStore.getState().status).toBe('authed');
  });

  it('opens the app from the device cache at once when the server does not answer', async () => {
    // One bar in a gym basement: requests neither succeed nor fail for a long time.
    idb.store.set(CACHE_KEYS.data, sampleData({ weights: [{ date: '2026-10-03', kg: 65.2 }] }));
    mocks.api.me.mockReturnValue(never());
    mocks.api.getData.mockReturnValue(never());
    renderGate();

    expect(await screen.findByText('Застосунок: 65.2')).toBeTruthy();
    expect(mocks.api.me).toHaveBeenCalledTimes(1);
  });

  it('a device with data still lands on the login screen when the background check finds no session', async () => {
    idb.store.set(CACHE_KEYS.data, sampleData({ weights: [{ date: '2026-10-03', kg: 65.2 }] }));
    const me = deferred<{ ok: true }>();
    mocks.api.me.mockReturnValue(me.promise);
    mocks.api.getData.mockReturnValue(never());
    renderGate();
    await screen.findByText('Застосунок: 65.2');

    me.reject(unauthorized());
    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
    // Kept for the next login.
    expect(getAppData().weights).toEqual([{ date: '2026-10-03', kg: 65.2 }]);
  });

  it('ignores a late answer about the old session after logging in again', async () => {
    idb.store.set(CACHE_KEYS.data, sampleData({ weights: [{ date: '2026-10-03', kg: 65.2 }] }));
    const me = deferred<{ ok: true }>();
    mocks.api.me.mockReturnValue(me.promise);
    mocks.api.getData.mockRejectedValueOnce(unauthorized());
    mocks.api.login.mockResolvedValue({ ok: true });
    renderGate();

    // Sync found the session gone while the background check is still hanging.
    fireEvent.change(await screen.findByLabelText('Пароль'), { target: { value: 'секрет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));
    expect(await screen.findByText('Застосунок: 66')).toBeTruthy();

    me.reject(unauthorized());
    await settle();
    expect(useAuthStore.getState().status).toBe('authed');
    expect(screen.getByText('Застосунок: 66')).toBeTruthy();
  });

  it('shows the login screen with an offline hint when offline without a cache', async () => {
    mocks.api.me.mockRejectedValue(networkError());
    renderGate();

    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
    expect(screen.getByText(/Немає зʼєднання з сервером/)).toBeTruthy();
  });

  it('checks again when the network comes back', async () => {
    mocks.api.me.mockRejectedValueOnce(networkError()).mockResolvedValue({ ok: true });
    renderGate();
    await screen.findByRole('button', { name: 'Увійти' });

    window.dispatchEvent(new Event('online'));
    expect(await screen.findByText('Застосунок: 66')).toBeTruthy();
  });

  it('returns to the login screen when the server drops the session', async () => {
    mocks.api.getData.mockRejectedValue(unauthorized());
    renderGate();

    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
    expect(useAuthStore.getState()).toEqual({ status: 'anon', offline: false });
  });

  it('logs in and opens the app', async () => {
    mocks.api.me.mockRejectedValue(unauthorized());
    mocks.api.login.mockResolvedValue({ ok: true });
    renderGate();

    fireEvent.change(await screen.findByLabelText('Пароль'), { target: { value: 'секрет' } });
    fireEvent.click(screen.getByRole('button', { name: 'Увійти' }));

    expect(await screen.findByText('Застосунок: 66')).toBeTruthy();
    expect(mocks.api.login).toHaveBeenCalledWith('секрет');
  });
});

describe('logout', () => {
  async function openApp(): Promise<void> {
    renderGate();
    await screen.findByText('Застосунок: 66');
  }

  it('flushes, asks, ends the session and wipes the device', async () => {
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
    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
    expect(idb.store.size).toBe(0);
  });

  it('always asks in the app’s own dialog, and «Скасувати» keeps everything', async () => {
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
    expect(idb.store.get(CACHE_KEYS.data)).toBeTruthy();
  });

  it('logs out after «Вийти» in the dialog', async () => {
    render(<ConfirmHost />);
    await openApp();

    const leaving = authActions.logout();
    const dialog = await screen.findByRole('alertdialog', { name: LOGOUT_CONFIRM.title });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Вийти' }));

    expect(await leaving).toBe(true);
    expect(mocks.api.logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
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
    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
    expect(idb.store.size).toBe(0);
  });
});
