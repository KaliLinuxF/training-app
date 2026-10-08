import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';
import { ApiError } from '../lib/api';
import { CACHE_KEYS } from '../store/cache';
import { dataActions, resetLocal, useAppData } from '../store/data';
import { deferred, fakeIdb, sampleData, type FakeIdb } from '../store/test-utils';
import { authActions, UNSYNCED_LOGOUT_CONFIRM, useAuthStore } from './auth';
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
  cleanup();
  await resetLocal();
  vi.restoreAllMocks();
});

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

  it('flushes, ends the session and wipes the device', async () => {
    await openApp();
    dataActions.setWeight('2026-10-09', 65);

    expect(await authActions.logout()).toBe(true);

    expect(mocks.api.sendOps).toHaveBeenCalled();
    expect(mocks.api.logout).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
    expect(idb.store.size).toBe(0);
  });

  it('asks before dropping unsynced changes and can be cancelled', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    await openApp();
    mocks.api.sendOps.mockRejectedValue(networkError());
    dataActions.setWeight('2026-10-09', 65);

    expect(await authActions.logout()).toBe(false);

    expect(confirm).toHaveBeenCalledWith(UNSYNCED_LOGOUT_CONFIRM);
    expect(mocks.api.logout).not.toHaveBeenCalled();
    expect(screen.getByText('Застосунок: 66, 65')).toBeTruthy();
  });

  it('logs out offline once confirmed', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    await openApp();
    mocks.api.sendOps.mockRejectedValue(networkError());
    mocks.api.logout.mockRejectedValue(networkError());
    dataActions.setWeight('2026-10-09', 65);

    expect(await authActions.logout()).toBe(true);
    expect(await screen.findByRole('button', { name: 'Увійти' })).toBeTruthy();
    expect(idb.store.size).toBe(0);
  });
});
