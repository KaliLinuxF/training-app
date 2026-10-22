/**
 * An old (v3) server during a rollback (docs/multi-user.md §10), end to end through the real API client: it answers
 * `{ ok: true }` to `me` and to a `{ username, password }` login alike. The new client must keep the device user,
 * the copy and the sync as they are — never switch, never wipe.
 */
import type { SessionUser } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheKeys, DEVICE_USER_KEY } from '../store/cache';
import { bindOwner, getAppData, resetLocal, startSync } from '../store/data';
import { fakeIdb, sampleData, sessionUser, settle, type FakeIdb } from '../store/test-utils';
import { authActions, useAuthStore } from './auth';
import { setAuthEnv } from './env';

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
}));
vi.mock('idb-keyval', () => mocks.idb);
vi.mock('../lib/push', () => ({
  disablePush: vi.fn(async () => undefined),
  getPushStatus: vi.fn(async () => 'default'),
  syncPushSubscription: vi.fn(async () => undefined),
}));

const ANNA: SessionUser = sessionUser({ id: 'a1'.padEnd(32, '0'), username: 'anna', legacyOwner: true });

type Route = (path: string, init?: RequestInit) => { status: number; body: unknown };
const fetchMock = vi.fn<(path: string, init?: RequestInit) => Promise<Response>>();

function serve(route: Route): void {
  fetchMock.mockImplementation(async (path, init) => {
    const { status, body } = route(path, init);
    return { ok: status >= 200 && status < 300, status, statusText: String(status), json: async () => body } as Response;
  });
}

/** What a v3 server answers. */
const oldServer: Route = (path) => {
  if (path === '/api/auth/me' || path === '/api/auth/login') return { status: 200, body: { ok: true } };
  if (path === '/api/data') return { status: 200, body: sampleData({ weights: [{ date: '2026-10-05', kg: 64.8 }] }) };
  if (path === '/api/ops') return { status: 200, body: { ok: true, applied: 1 } };
  return { status: 404, body: { error: 'not_found', message: 'x' } };
};

let idb: FakeIdb;
let replace: ReturnType<typeof vi.fn<(url: string) => void>>;
let restoreEnv: () => void;

beforeEach(async () => {
  idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  mocks.idb.keys.mockReset().mockImplementation(idb.keys);
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
  replace = vi.fn();
  restoreEnv = setAuthEnv({ replace, openChannel: () => null, session: () => sessionStorage });
  bindOwner(null);
  await resetLocal();
  useAuthStore.setState({ status: 'checking', offline: false, user: null });
  idb.store.set(DEVICE_USER_KEY, ANNA);
  idb.store.set(cacheKeys(ANNA.id).data, sampleData({ weights: [{ date: '2026-10-03', kg: 65.2 }] }));
  idb.store.set(cacheKeys(ANNA.id).outbox, []);
});

afterEach(() => {
  restoreEnv();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('an outdated server ({ ok: true } without a user)', () => {
  it('`me` keeps the pointer, the copy and the sync (the X-Legko-User header still goes out)', async () => {
    serve(oldServer);
    await authActions.check();
    await settle();

    expect(useAuthStore.getState()).toEqual({ status: 'authed', offline: false, user: ANNA });
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ANNA);
    expect(replace).not.toHaveBeenCalled();

    const stop = startSync(ANNA.id);
    await settle();
    const dataCall = fetchMock.mock.calls.find(([path]) => path === '/api/data');
    expect(dataCall?.[1]?.headers).toEqual({ 'X-Legko-User': ANNA.id });
    expect(getAppData().weights).toEqual([{ date: '2026-10-05', kg: 64.8 }]);
    stop();
  });

  it('a login answered with { ok: true } fails as outdated_server and changes nothing', async () => {
    serve(oldServer);
    useAuthStore.setState({ status: 'anon', offline: false, user: ANNA });
    await expect(authActions.login('anna', 'password1')).rejects.toMatchObject({ code: 'outdated_server' });
    expect(useAuthStore.getState()).toEqual({ status: 'anon', offline: false, user: ANNA });
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ANNA);
    expect(idb.store.get(cacheKeys(ANNA.id).data)).toBeTruthy();
  });

  it('an empty device: the login screen with the offline hint', async () => {
    idb.store.clear();
    serve(oldServer);
    await authActions.check();
    expect(useAuthStore.getState()).toEqual({ status: 'anon', offline: true, user: null });
  });
});
