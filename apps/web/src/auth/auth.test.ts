import type { Op, SessionUser } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type * as ApiModule from '../lib/api';
import { ApiError } from '../lib/api';
import { cacheKeys, DEVICE_USER_KEY, LEGACY_KEYS, WIPE_PENDING_KEY } from '../store/cache';
import { bindOwner, dataActions, getAppData, resetLocal, startSync, useDataStore } from '../store/data';
import { deferred, fakeIdb, sampleData, sessionUser, settle, type FakeIdb } from '../store/test-utils';
import { ui, useUiStore } from '../store/ui';
import {
  ADMIN_LANDING,
  authActions,
  landingPath,
  listenAuthBroadcasts,
  LOGOUT_CONFIRM,
  ME_REFRESH_MS,
  SWITCH_CONFIRM,
  useAuthStore,
  watchForeground,
} from './auth';
import { setAuthEnv, type AuthChannel } from './env';
import { LINK_TOKEN_KEY } from './linkToken';

const mocks = vi.hoisted(() => ({
  api: {
    me: vi.fn(),
    login: vi.fn(),
    logout: vi.fn(),
    getData: vi.fn(),
    sendOps: vi.fn(),
    importData: vi.fn(),
  },
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
  push: {
    disablePush: vi.fn<() => Promise<void>>(),
    getPushStatus: vi.fn(),
    syncPushSubscription: vi.fn<() => Promise<void>>(),
  },
}));

vi.mock('../lib/api', async (importOriginal) => ({
  ...(await importOriginal<typeof ApiModule>()),
  api: mocks.api,
}));
vi.mock('../lib/push', () => mocks.push);
vi.mock('idb-keyval', () => mocks.idb);

const ANNA = sessionUser({ id: 'a1'.padEnd(32, '0'), username: 'anna', legacyOwner: true });
const OLYA = sessionUser({ id: 'b2'.padEnd(32, '0'), username: 'olya' });
const ADMIN = sessionUser({ id: 'c3'.padEnd(32, '0'), username: 'admin', role: 'admin' });

const me = (user: SessionUser) => ({ ok: true as const, user });
const unauthorized = () => new ApiError(401, 'unauthorized', 'Unauthorized');
const networkError = () => new ApiError(0, 'network', 'offline');
const outdated = () => new ApiError(200, 'outdated_server', 'old server');
const weightOp = (date: string, kg: number): Op => ({ kind: 'weight.put', date, kg });
const item = (id: string, op: Op = weightOp('2026-10-09', 65)) => ({ id, op });

let idb: FakeIdb;
let replace: ReturnType<typeof vi.fn<(url: string) => void>>;
let reload: ReturnType<typeof vi.fn<() => void>>;
let posted: unknown[];
let deliver: (data: unknown) => void;
let restoreEnv: () => void;
let now: number;

/** A fake BroadcastChannel shared by "tabs" in this test (one object per tab, like the real one). */
function fakeChannel(): AuthChannel {
  const listeners = new Set<(event: MessageEvent) => void>();
  deliver = (data) => {
    for (const listener of listeners) listener({ data } as MessageEvent);
  };
  return {
    postMessage: (message) => posted.push(message),
    addEventListener: (_type, listener) => listeners.add(listener),
    removeEventListener: (_type, listener) => listeners.delete(listener),
  };
}

function seedDevice(user: SessionUser, { weights = [{ date: '2026-10-03', kg: 65.2 }], outbox = [] as unknown[] } = {}) {
  idb.store.set(DEVICE_USER_KEY, user);
  idb.store.set(cacheKeys(user.id).data, sampleData({ weights }));
  idb.store.set(cacheKeys(user.id).outbox, outbox);
}

const state = () => useAuthStore.getState();
const keys = () => [...idb.store.keys()].sort();

beforeEach(async () => {
  idb = fakeIdb();
  mocks.idb.getMany.mockReset().mockImplementation(idb.getMany);
  mocks.idb.setMany.mockReset().mockImplementation(idb.setMany);
  mocks.idb.delMany.mockReset().mockImplementation(idb.delMany);
  mocks.idb.keys.mockReset().mockImplementation(idb.keys);
  for (const fn of Object.values(mocks.api)) fn.mockReset();
  mocks.api.getData.mockResolvedValue(sampleData({ weights: [{ date: '2026-10-01', kg: 66 }] }));
  mocks.api.sendOps.mockImplementation(async (ops: unknown[]) => ({ ok: true, applied: ops.length }));
  mocks.api.logout.mockResolvedValue({ ok: true });
  // A background `me` that nobody set up answers like an unreachable server (ignored).
  mocks.api.me.mockRejectedValue(networkError());
  mocks.push.disablePush.mockReset().mockResolvedValue(undefined);
  mocks.push.syncPushSubscription.mockReset().mockResolvedValue(undefined);
  mocks.push.getPushStatus.mockReset().mockResolvedValue('default');
  posted = [];
  replace = vi.fn();
  reload = vi.fn();
  now = 1_000_000;
  restoreEnv = setAuthEnv({
    replace,
    reload,
    openChannel: () => fakeChannel(),
    now: () => now,
    session: () => sessionStorage,
  });
  bindOwner(null);
  await resetLocal();
  localStorage.clear();
  sessionStorage.clear();
  window.history.replaceState(null, '', '/');
  useAuthStore.setState({ status: 'checking', offline: false, user: null });
  useUiStore.setState({ confirm: null });
});

afterEach(async () => {
  useUiStore.getState().confirm?.resolve(false);
  await settle();
  restoreEnv();
  vi.restoreAllMocks();
});

describe('check(): start-up', () => {
  it('an empty device asks the server and remembers who signed in', async () => {
    mocks.api.me.mockResolvedValue(me(OLYA));
    await authActions.check();
    expect(state()).toEqual({ status: 'authed', offline: false, user: OLYA });
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(OLYA);
  });

  it('an empty device without a session shows the login screen', async () => {
    mocks.api.me.mockRejectedValue(unauthorized());
    await authActions.check();
    expect(state()).toEqual({ status: 'anon', offline: false, user: null });
  });

  it.each([
    ['network', networkError],
    ['an outdated server', outdated],
  ])('an empty device and %s: the login screen with the offline hint', async (_what, error) => {
    mocks.api.me.mockRejectedValue(error());
    await authActions.check();
    expect(state()).toEqual({ status: 'anon', offline: true, user: null });
    expect(keys()).toEqual([]);
  });

  it('the device user’s copy opens at once; `me` confirms and refreshes the pointer', async () => {
    seedDevice(OLYA);
    const answer = deferred<ReturnType<typeof me>>();
    mocks.api.me.mockReturnValue(answer.promise);

    await authActions.check();
    expect(state()).toEqual({ status: 'authed', offline: false, user: OLYA });
    expect(getAppData().weights).toEqual([{ date: '2026-10-03', kg: 65.2 }]);

    const renamed = { ...OLYA, username: 'Olya.K' };
    answer.resolve(me(renamed));
    await settle();
    expect(state().user).toEqual(renamed);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(renamed);
    expect(replace).not.toHaveBeenCalled();
  });

  it('another account on the cookie with nothing pending: switches without asking (wipe + reload)', async () => {
    seedDevice(OLYA);
    mocks.api.me.mockResolvedValue(me(ADMIN));
    const confirm = vi.spyOn(ui, 'confirm');

    await authActions.check();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/'));

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.push.disablePush).toHaveBeenCalledTimes(1);
    expect(keys()).toEqual([DEVICE_USER_KEY]);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ADMIN);
    expect(posted).toEqual([{ type: 'switched' }]);
  });

  it('another account on the cookie WITH pending changes: login screen, nothing wiped (never a silent wipe)', async () => {
    seedDevice(OLYA, { outbox: [item('pending')] });
    mocks.api.me.mockResolvedValue(me(ADMIN));

    await authActions.check();
    await vi.waitFor(() => expect(state().status).toBe('anon'));

    expect(state()).toEqual({ status: 'anon', offline: false, user: OLYA });
    expect(idb.store.get(cacheKeys(OLYA.id).outbox)).toEqual([item('pending')]);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(OLYA);
    expect(replace).not.toHaveBeenCalled();
    expect(mocks.push.disablePush).not.toHaveBeenCalled();
  });

  it('401 in the background: the login screen, the copy and the name kept', async () => {
    seedDevice(OLYA);
    mocks.api.me.mockRejectedValue(unauthorized());
    await authActions.check();
    await vi.waitFor(() => expect(state().status).toBe('anon'));
    expect(state().user).toEqual(OLYA);
    expect(getAppData().weights).toEqual([{ date: '2026-10-03', kg: 65.2 }]);
    expect(idb.store.get(cacheKeys(OLYA.id).data)).toBeTruthy();
  });

  it.each([
    ['network', networkError],
    ['an outdated server ({ ok: true } without a user)', outdated],
  ])('%s in the background changes nothing: pointer, copy and sync stay', async (_what, error) => {
    seedDevice(OLYA);
    mocks.api.me.mockRejectedValue(error());
    await authActions.check();
    await settle();
    expect(state()).toEqual({ status: 'authed', offline: false, user: OLYA });
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(OLYA);

    const stop = startSync(OLYA.id);
    await settle();
    expect(mocks.api.getData).toHaveBeenCalledWith(OLYA.id);
    stop();
  });

  it('a pointer without a copy asks in the foreground (and keeps the name for the login screen)', async () => {
    idb.store.set(DEVICE_USER_KEY, OLYA);
    mocks.api.me.mockRejectedValue(unauthorized());
    await authActions.check();
    expect(state()).toEqual({ status: 'anon', offline: false, user: OLYA });
  });

  describe('the legacy copy (written before accounts)', () => {
    function seedLegacy(outbox: unknown[] = []) {
      idb.store.set(LEGACY_KEYS.data, sampleData({ weights: [{ date: '2026-09-30', kg: 67 }] }));
      idb.store.set(LEGACY_KEYS.outbox, outbox);
    }

    it('is shown provisionally (no sync), then adopted by the legacy owner', async () => {
      seedLegacy([item('legacy-op', weightOp('2026-09-30', 67))]);
      const answer = deferred<ReturnType<typeof me>>();
      mocks.api.me.mockReturnValue(answer.promise);

      await authActions.check();
      expect(state()).toEqual({ status: 'authed', offline: false, user: null });
      expect(getAppData().weights).toEqual([{ date: '2026-09-30', kg: 67 }]);

      answer.resolve(me(ANNA));
      await vi.waitFor(() => expect(state().user).toEqual(ANNA));
      expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ANNA);
      expect(idb.store.has(LEGACY_KEYS.data)).toBe(false);
      expect(idb.store.has(LEGACY_KEYS.outbox)).toBe(false);
      expect(idb.store.get(cacheKeys(ANNA.id).outbox)).toEqual([item('legacy-op', weightOp('2026-09-30', 67))]);
      expect(mocks.api.sendOps).not.toHaveBeenCalled();
      expect(replace).not.toHaveBeenCalled();

      // Her unsent op goes out once, for her.
      const stop = startSync(ANNA.id);
      await settle();
      expect(mocks.api.sendOps).toHaveBeenCalledTimes(1);
      expect(mocks.api.sendOps).toHaveBeenCalledWith([weightOp('2026-09-30', 67)], ANNA.id);
      stop();
    });

    it('someone else’s session and nothing pending: wiped and reloaded', async () => {
      seedLegacy();
      mocks.api.me.mockResolvedValue(me(OLYA));
      await authActions.check();
      await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
      expect(keys()).toEqual([DEVICE_USER_KEY]);
      expect(idb.store.get(DEVICE_USER_KEY)).toEqual(OLYA);
    });

    it('someone else’s session WITH pending legacy ops: login screen, legacy kept', async () => {
      seedLegacy([item('legacy-op')]);
      mocks.api.me.mockResolvedValue(me(OLYA));
      await authActions.check();
      await vi.waitFor(() => expect(state().status).toBe('anon'));
      expect(state().user).toBeNull();
      expect(idb.store.get(LEGACY_KEYS.outbox)).toEqual([item('legacy-op')]);
      expect(replace).not.toHaveBeenCalled();
    });

    it('401: login screen, legacy kept until a login decides', async () => {
      seedLegacy([item('legacy-op')]);
      mocks.api.me.mockRejectedValue(unauthorized());
      await authActions.check();
      await vi.waitFor(() => expect(state().status).toBe('anon'));
      expect(idb.store.get(LEGACY_KEYS.outbox)).toEqual([item('legacy-op')]);
    });

    it('merges what a rolled-back app wrote for the legacy owner: the op is sent exactly once', async () => {
      // Pointer + per-user cache (v4) + legacy keys with one pending op (written by the old bundle meanwhile).
      seedDevice(ANNA, { outbox: [item('mine', weightOp('2026-10-02', 65.6))] });
      idb.store.set(LEGACY_KEYS.data, sampleData({ weights: [{ date: '2026-10-08', kg: 65 }] }));
      idb.store.set(LEGACY_KEYS.outbox, [item('mine', weightOp('2026-10-02', 65.6)), item('legacy')]);
      mocks.api.me.mockResolvedValue(me(ANNA));

      await authActions.check();
      expect(state().user).toEqual(ANNA);
      expect(idb.store.has(LEGACY_KEYS.data)).toBe(false);
      expect(idb.store.has(LEGACY_KEYS.outbox)).toBe(false);

      const stop = startSync(ANNA.id);
      await settle();
      await settle();
      expect(mocks.api.sendOps).toHaveBeenCalledTimes(1);
      expect(mocks.api.sendOps).toHaveBeenCalledWith([weightOp('2026-10-02', 65.6), weightOp('2026-10-09', 65)], ANNA.id);
      // Later starts find nothing more to send.
      await authActions.check();
      await settle();
      expect(mocks.api.sendOps).toHaveBeenCalledTimes(1);
      stop();
    });

    it('leaves the legacy keys alone under another account’s pointer', async () => {
      seedDevice(OLYA);
      seedLegacy([item('legacy-op')]);
      mocks.api.me.mockResolvedValue(me(OLYA));
      await authActions.check();
      await settle();
      expect(state().user).toEqual(OLYA);
      expect(idb.store.get(LEGACY_KEYS.outbox)).toEqual([item('legacy-op')]);
      expect(getAppData().weights).toEqual([{ date: '2026-10-03', kg: 65.2 }]);
    });
  });

  describe('an unverified wipe (tombstone)', () => {
    it('is wiped again first; then the device starts empty', async () => {
      seedDevice(OLYA);
      localStorage.setItem(WIPE_PENDING_KEY, '1');
      mocks.api.me.mockResolvedValue(me(ADMIN));
      await authActions.check();
      expect(localStorage.getItem(WIPE_PENDING_KEY)).toBeNull();
      expect(state()).toEqual({ status: 'authed', offline: false, user: ADMIN });
      expect(idb.store.has(cacheKeys(OLYA.id).data)).toBe(false);
      expect(getAppData().weights).toEqual([]);
    });
  });
});

describe('signedIn(): who gets the device', () => {
  it('an empty device: the pointer, no reload', async () => {
    mocks.api.login.mockResolvedValue(me(OLYA));
    expect(await authActions.login('olya', 'password1')).toBe('ok');
    expect(mocks.api.login).toHaveBeenCalledWith('olya', 'password1');
    expect(state()).toEqual({ status: 'authed', offline: false, user: OLYA });
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(OLYA);
    expect(replace).not.toHaveBeenCalled();
  });

  it('switching accounts with nothing pending: no question, wipe, pointer, broadcast, reload', async () => {
    seedDevice(OLYA);
    await authActions.check();
    const confirm = vi.spyOn(ui, 'confirm');

    expect(await authActions.signedIn(ADMIN)).toBe('switched');

    expect(confirm).not.toHaveBeenCalled();
    expect(mocks.push.disablePush).toHaveBeenCalledTimes(1);
    expect(keys()).toEqual([DEVICE_USER_KEY]);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ADMIN);
    expect(posted).toEqual([{ type: 'switched' }]);
    expect(replace).toHaveBeenCalledWith('/');
    expect(getAppData().weights).toEqual([]);
  });

  it('switching with pending changes asks first; «Скасувати» ends the new session and keeps everything', async () => {
    seedDevice(ANNA, { outbox: [item('p1'), item('p2'), item('p3')] });
    mocks.api.me.mockRejectedValue(unauthorized());
    await authActions.check();
    await vi.waitFor(() => expect(state().status).toBe('anon'));
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(false);

    expect(await authActions.signedIn(OLYA)).toBe('cancelled');

    expect(confirm).toHaveBeenCalledWith(SWITCH_CONFIRM('anna', 'olya', 3));
    expect(SWITCH_CONFIRM('anna', 'olya', 3)).toEqual({
      title: 'Увійти як olya?',
      body: 'Зміни anna, ще не надіслані на сервер: 3. Якщо ввійти іншим акаунтом, їх буде втрачено.',
      confirmLabel: 'Увійти як olya',
      cancelLabel: 'Скасувати',
      destructive: true,
    });
    expect(mocks.api.logout).toHaveBeenCalledTimes(1);
    expect(state()).toEqual({ status: 'anon', offline: false, user: ANNA });
    expect(idb.store.get(cacheKeys(ANNA.id).outbox)).toHaveLength(3);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ANNA);
    expect(replace).not.toHaveBeenCalled();
    expect(mocks.push.disablePush).not.toHaveBeenCalled();
  });

  it('switching with pending changes, confirmed: the previous copy is gone, the new pointer is saved', async () => {
    seedDevice(ANNA, { outbox: [item('p1')] });
    mocks.api.me.mockRejectedValue(unauthorized());
    await authActions.check();
    vi.spyOn(ui, 'confirm').mockResolvedValue(true);

    expect(await authActions.signedIn(OLYA)).toBe('switched');

    expect(keys()).toEqual([DEVICE_USER_KEY]);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(OLYA);
    expect(replace).toHaveBeenCalledWith('/');
  });

  it('a switch to the legacy owner keeps the legacy keys (her own unsent ops survive)', async () => {
    seedDevice(OLYA);
    idb.store.set(LEGACY_KEYS.data, sampleData());
    idb.store.set(LEGACY_KEYS.outbox, [item('hers')]);

    expect(await authActions.signedIn(ANNA)).toBe('switched');

    expect(keys()).toEqual([DEVICE_USER_KEY, LEGACY_KEYS.data, LEGACY_KEYS.outbox].sort());
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ANNA);
  });

  it('a switch to anyone else counts the legacy ops too and wipes them', async () => {
    idb.store.set(LEGACY_KEYS.data, sampleData());
    idb.store.set(LEGACY_KEYS.outbox, [item('hers')]);
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);

    expect(await authActions.signedIn(OLYA)).toBe('switched');

    expect(confirm).toHaveBeenCalledWith(SWITCH_CONFIRM(null, 'olya', 1));
    expect(SWITCH_CONFIRM(null, 'olya', 1).body).toBe(
      'Зміни, ще не надіслані на сервер: 1. Якщо ввійти іншим акаунтом, їх буде втрачено.',
    );
    expect(keys()).toEqual([DEVICE_USER_KEY]);
  });

  it('the same account again (expired session) keeps memory and the outbox, and sends it', async () => {
    seedDevice(OLYA, { outbox: [item('pending', weightOp('2026-10-08', 64.9))] });
    mocks.api.me.mockRejectedValue(unauthorized());
    await authActions.check();
    await vi.waitFor(() => expect(state().status).toBe('anon'));
    const confirm = vi.spyOn(ui, 'confirm');
    mocks.api.login.mockResolvedValue(me(OLYA));

    expect(await authActions.login('olya', 'password1')).toBe('ok');

    expect(confirm).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    expect(state()).toEqual({ status: 'authed', offline: false, user: OLYA });
    expect(useDataStore.getState().sync.pending).toBe(1);
    const stop = startSync(OLYA.id);
    await settle();
    expect(mocks.api.sendOps).toHaveBeenCalledWith([weightOp('2026-10-08', 64.9)], OLYA.id);
    stop();
  });

  it('the legacy owner on a device with only the legacy copy adopts it (no reload)', async () => {
    idb.store.set(LEGACY_KEYS.data, sampleData({ weights: [{ date: '2026-09-30', kg: 67 }] }));
    idb.store.set(LEGACY_KEYS.outbox, [item('hers')]);

    expect(await authActions.signedIn(ANNA)).toBe('ok');

    expect(replace).not.toHaveBeenCalled();
    expect(keys()).toEqual([DEVICE_USER_KEY, cacheKeys(ANNA.id).data, cacheKeys(ANNA.id).outbox].sort());
    expect(idb.store.get(cacheKeys(ANNA.id).outbox)).toEqual([item('hers')]);
    expect(getAppData().weights).toEqual([{ date: '2026-09-30', kg: 67 }]);
  });

  it('after a link flow an admin lands on «Користувачі», everyone else at home', async () => {
    expect(landingPath(ADMIN, { link: true })).toBe(ADMIN_LANDING);
    expect(landingPath(ADMIN)).toBe('/');
    expect(landingPath(OLYA, { link: true })).toBe('/');
    expect(landingPath(ADMIN, { link: true, next: '/progress' })).toBe('/progress');

    sessionStorage.setItem(LINK_TOKEN_KEY, '{"kind":"reset","token":"x"}');
    expect(await authActions.signedIn(ADMIN, { link: true })).toBe('ok');
    expect(replace).toHaveBeenCalledWith('/settings/users');
    expect(sessionStorage.getItem(LINK_TOKEN_KEY)).toBeNull();
  });

  it('a plain login keeps the URL (deep links), also for an admin', async () => {
    expect(await authActions.signedIn(ADMIN)).toBe('ok');
    expect(replace).not.toHaveBeenCalled();
  });

  it('reload: false does all the storage work but leaves the reload to the screen (iOS «Готово»)', async () => {
    seedDevice(OLYA);
    await authActions.check();

    expect(await authActions.signedIn(ADMIN, { link: true, reload: false })).toBe('switched');

    expect(replace).not.toHaveBeenCalled();
    expect(keys()).toEqual([DEVICE_USER_KEY]);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ADMIN);
    expect(state()).toEqual({ status: 'authed', offline: false, user: ADMIN });
  });

  it('a login answered by an outdated server leaves pointer, copy and state alone', async () => {
    seedDevice(OLYA);
    mocks.api.me.mockRejectedValue(unauthorized());
    await authActions.check();
    await vi.waitFor(() => expect(state().status).toBe('anon'));
    mocks.api.login.mockRejectedValue(outdated());

    await expect(authActions.login('olya', 'pw')).rejects.toMatchObject({ code: 'outdated_server' });

    expect(state()).toEqual({ status: 'anon', offline: false, user: OLYA });
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(OLYA);
    expect(idb.store.get(cacheKeys(OLYA.id).data)).toBeTruthy();
  });
});

describe('logout', () => {
  async function signedInAs(user: SessionUser) {
    seedDevice(user);
    mocks.api.me.mockResolvedValue(me(user));
    await authActions.check();
    await settle();
  }

  it('asks, ends the session, wipes the device and the session keys, tells the other tabs and reloads', async () => {
    await signedInAs(OLYA);
    sessionStorage.setItem('legko.setupShown', '1');
    sessionStorage.setItem('other', 'kept');
    const confirm = vi.spyOn(ui, 'confirm').mockResolvedValue(true);

    expect(await authActions.logout()).toBe(true);

    expect(confirm).toHaveBeenCalledWith(LOGOUT_CONFIRM);
    expect(mocks.push.disablePush).toHaveBeenCalledTimes(1);
    expect(mocks.api.logout).toHaveBeenCalledTimes(1);
    expect(idb.store.size).toBe(0);
    expect(sessionStorage.getItem('legko.setupShown')).toBeNull();
    expect(sessionStorage.getItem('other')).toBe('kept');
    expect(posted).toEqual([{ type: 'logged-out' }]);
    expect(replace).toHaveBeenCalledWith('/');
    expect(state()).toEqual({ status: 'anon', offline: false, user: null });
  });

  it('logout(next) for a link flow keeps the link token and goes there', async () => {
    await signedInAs(OLYA);
    sessionStorage.setItem(LINK_TOKEN_KEY, '{"kind":"invite","token":"t"}');
    vi.spyOn(ui, 'confirm').mockResolvedValue(true);

    expect(await authActions.logout('/invite')).toBe(true);

    expect(sessionStorage.getItem(LINK_TOKEN_KEY)).toBe('{"kind":"invite","token":"t"}');
    expect(replace).toHaveBeenCalledWith('/invite');
  });

  it('cancelled: nothing changes', async () => {
    await signedInAs(OLYA);
    vi.spyOn(ui, 'confirm').mockResolvedValue(false);
    expect(await authActions.logout()).toBe(false);
    expect(mocks.api.logout).not.toHaveBeenCalled();
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(OLYA);
    expect(replace).not.toHaveBeenCalled();
  });

  it('never hangs on a stuck IndexedDB (the wipe is bounded)', async () => {
    await signedInAs(OLYA);
    vi.spyOn(ui, 'confirm').mockResolvedValue(true);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.idb.keys.mockReturnValue(new Promise(() => undefined));
    vi.stubGlobal('indexedDB', { deleteDatabase: () => ({}) });
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let done: boolean | undefined;
    void authActions.logout().then((ok) => {
      done = ok;
    });
    await vi.advanceTimersByTimeAsync(8_000);
    vi.useRealTimers();
    expect(done).toBe(true);
    expect(replace).toHaveBeenCalledWith('/');
    // The next start wipes again before showing anything.
    expect(localStorage.getItem(WIPE_PENDING_KEY)).toBe('1');
    vi.unstubAllGlobals();
  });
});

describe('other tabs and freshness', () => {
  it('reloads when another tab switched or logged out', () => {
    const stop = listenAuthBroadcasts();
    deliver({ type: 'switched' });
    deliver({ type: 'logged-out' });
    deliver({ type: 'something-else' });
    deliver(null);
    expect(reload).toHaveBeenCalledTimes(2);
    stop();
    deliver({ type: 'switched' });
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it('refreshUser: the same account updates the pointer; another id re-runs the start-up rules', async () => {
    seedDevice(OLYA);
    mocks.api.me.mockResolvedValue(me(OLYA));
    await authActions.check();
    await settle();

    const promoted = { ...OLYA, role: 'admin' as const };
    mocks.api.me.mockResolvedValue(me(promoted));
    await authActions.refreshUser();
    expect(state().user).toEqual(promoted);
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(promoted);

    mocks.api.me.mockResolvedValue(me(ADMIN));
    await authActions.refreshUser();
    await vi.waitFor(() => expect(replace).toHaveBeenCalledWith('/'));
    expect(idb.store.get(DEVICE_USER_KEY)).toEqual(ADMIN);
  });

  it('refreshUser: 401 shows the login screen; network or an outdated server change nothing', async () => {
    seedDevice(OLYA);
    mocks.api.me.mockResolvedValue(me(OLYA));
    await authActions.check();
    await settle();

    mocks.api.me.mockRejectedValue(outdated());
    await authActions.refreshUser();
    mocks.api.me.mockRejectedValue(networkError());
    await authActions.refreshUser();
    expect(state()).toEqual({ status: 'authed', offline: false, user: OLYA });

    mocks.api.me.mockRejectedValue(unauthorized());
    await authActions.refreshUser();
    expect(state()).toEqual({ status: 'anon', offline: false, user: OLYA });
  });

  it('asks `me` again on the way back to the foreground, at most every 5 minutes', async () => {
    mocks.api.me.mockResolvedValue(me(OLYA));
    await authActions.check();
    expect(mocks.api.me).toHaveBeenCalledTimes(1);
    const stop = watchForeground();

    now += ME_REFRESH_MS - 1;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(mocks.api.me).toHaveBeenCalledTimes(1);

    now += 1;
    document.dispatchEvent(new Event('visibilitychange'));
    await settle();
    expect(mocks.api.me).toHaveBeenCalledTimes(2);
    stop();
  });

  it('updateUser ignores another account', async () => {
    mocks.api.me.mockResolvedValue(me(OLYA));
    await authActions.check();
    authActions.updateUser(ADMIN);
    expect(state().user).toEqual(OLYA);
    authActions.updateUser({ ...OLYA, username: 'olya2' });
    expect(state().user?.username).toBe('olya2');
  });

  it('commits made while signed in reach the server under the device user only', async () => {
    seedDevice(OLYA);
    mocks.api.me.mockResolvedValue(me(OLYA));
    await authActions.check();
    const stop = startSync(OLYA.id);
    await settle();
    dataActions.setWeight('2026-10-09', 64.5);
    await settle();
    expect(mocks.api.sendOps).toHaveBeenCalledWith([weightOp('2026-10-09', 64.5)], OLYA.id);
    stop();
  });
});

// Last: a wipe that keeps failing puts the cache in memory for the rest of the page (module state).
describe('a wipe that cannot be verified even on the next start', () => {
  it('keeps the tombstone and renders no copy after the reload', async () => {
    seedDevice(OLYA);
    localStorage.setItem(WIPE_PENDING_KEY, '1');
    mocks.idb.delMany.mockRejectedValue(new Error('IndexedDB is broken'));
    vi.stubGlobal('indexedDB', {
      deleteDatabase: () => {
        throw new Error('no');
      },
    });
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const answer = deferred<ReturnType<typeof me>>();
    mocks.api.me.mockReturnValue(answer.promise);

    const checking = authActions.check();
    await settle();
    await settle();
    // Splash (a foreground check) — never the previous person's copy.
    expect(state().status).toBe('checking');
    expect(useDataStore.getState().sync.loaded).toBe(false);
    answer.resolve(me(OLYA));
    await checking;

    expect(state()).toEqual({ status: 'authed', offline: false, user: OLYA });
    expect(getAppData().weights).toEqual([]);
    expect(localStorage.getItem(WIPE_PENDING_KEY)).toBe('1');
    // Nothing of the device copy is read any more in this page.
    mocks.idb.getMany.mockClear();
    bindOwner(OLYA.id);
    const stop = startSync(OLYA.id);
    await settle();
    expect(mocks.idb.getMany).not.toHaveBeenCalled();
    stop();
    vi.unstubAllGlobals();
  });
});
