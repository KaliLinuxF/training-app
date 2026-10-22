import { API, emptyData, USER_HEADER } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  api,
  ApiError,
  FOOD_ESTIMATE_TIMEOUT_MS,
  IMPORT_TIMEOUT_MS,
  NETWORK_MESSAGES,
  REQUEST_TIMEOUT_MS,
} from './api';

type FetchArgs = [input: string, init?: RequestInit];

const fetchMock = vi.fn<(...args: FetchArgs) => Promise<Response>>();

/** A fetch that never answers on its own, like a captive or one-bar network, but honours aborts. */
function hang(...[, init]: FetchArgs): Promise<Response> {
  return new Promise((_, reject) => {
    const abort = () => reject(new DOMException('Aborted', 'AbortError'));
    // Like the real fetch: an already aborted signal rejects straight away.
    if (init?.signal?.aborted) abort();
    else init?.signal?.addEventListener('abort', abort);
  });
}

function jsonResponse(status: number, body: unknown, json?: () => Promise<unknown>): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: `HTTP ${status}`,
    json: json ?? (async () => body),
  } as Response;
}

const signalOf = (call = 0): AbortSignal | null | undefined => fetchMock.mock.calls[call]?.[1]?.signal;

/** The device user's id (sent as `X-Legko-User`). */
const OWNER = 'a1'.padEnd(32, '0');
const USER = {
  id: OWNER,
  username: 'olya',
  role: 'user',
  createdAt: 1_760_000_000_000,
  legacyOwner: false,
  passwordChange: null,
} as const;

const TOKEN = 'T'.repeat(43);

/** The [path, init] of fetch call `call`. */
const callOf = (call = 0) => {
  const [path, init] = fetchMock.mock.calls[call] ?? [];
  return { path, init, body: init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined };
};

/** Attaches the expectation before timers run, so the rejection is never "unhandled". */
function expectNetworkError(promise: Promise<unknown>, message: string) {
  return expect(promise).rejects.toMatchObject({ name: 'ApiError', code: 'network', status: 0, message });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('request()', () => {
  it('sends JSON with the session cookie and returns the parsed body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, applied: 1 }));

    await expect(api.sendOps([{ kind: 'day.delete', date: '2026-10-09' }], OWNER)).resolves.toEqual({
      ok: true,
      applied: 1,
    });

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/ops');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Legko-User': OWNER },
      body: JSON.stringify({ ops: [{ kind: 'day.delete', date: '2026-10-09' }] }),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns server errors into ApiError with the code, message and op index', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_op', message: 'bad', index: 2 }));

    const err = await api.sendOps([], OWNER).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: 'invalid_op', message: 'bad', index: 2 });
    expect((err as ApiError).isNetwork).toBe(false);
  });

  it('treats a non-JSON 5xx (proxy page) as a network problem', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(502, null, async () => {
        throw new SyntaxError('Unexpected token <');
      }),
    );

    const err = await api.getData(OWNER).catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'internal' });
    expect((err as ApiError).isNetwork).toBe(true);
  });

  it('maps a failed fetch (offline) to ApiError("network")', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expectNetworkError(api.me(), NETWORK_MESSAGES.offline);
  });

  it('gives up on a hanging request after 15 s with ApiError("network")', async () => {
    fetchMock.mockImplementation(hang);
    const result = expectNetworkError(api.getData(OWNER), NETWORK_MESSAGES.timeout);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS - 1);
    expect(signalOf()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await result;
    expect(signalOf()?.aborted).toBe(true);
  });

  it('also cuts off a response body that stalls', async () => {
    fetchMock.mockImplementation(async (_path, init) =>
      jsonResponse(200, null, () => hang('', init).then(() => ({}))),
    );
    const result = expectNetworkError(api.me(), NETWORK_MESSAGES.timeout);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    await result;
  });

  it('gives the AI estimate a minute and still honours the caller’s signal', async () => {
    fetchMock.mockImplementation(hang);
    const slow = expectNetworkError(
      api.foodEstimate({ date: '2026-10-09', text: 'борщ' }),
      NETWORK_MESSAGES.timeout,
    );

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(signalOf(0)?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(FOOD_ESTIMATE_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    await slow;

    const controller = new AbortController();
    const cancelled = expectNetworkError(
      api.foodEstimate({ date: '2026-10-09', text: 'борщ' }, controller.signal),
      NETWORK_MESSAGES.offline,
    );
    controller.abort();
    await cancelled;
    expect(signalOf(1)?.aborted).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('rejects at once when the caller’s signal is already aborted', async () => {
    fetchMock.mockImplementation(hang);
    const controller = new AbortController();
    controller.abort();
    await expectNetworkError(
      api.foodEstimate({ date: '2026-10-09', text: 'чай' }, controller.signal),
      NETWORK_MESSAGES.offline,
    );
  });

  it('allows a backup upload a minute too', async () => {
    fetchMock.mockImplementation(hang);
    const upload = expectNetworkError(api.importData(emptyData(), OWNER), NETWORK_MESSAGES.timeout);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(signalOf()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    await upload;
  });
});

describe('the device user header (D11)', () => {
  it('sends X-Legko-User with GET /api/data, POST /api/ops and POST /api/import', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));

    await api.getData(OWNER);
    await api.sendOps([], OWNER);
    await api.importData(emptyData(), OWNER);

    expect(callOf(0).path).toBe('/api/data');
    expect(callOf(0).init?.method).toBe('GET');
    expect(callOf(0).init?.headers).toEqual({ [USER_HEADER]: OWNER });
    expect(callOf(1).path).toBe('/api/ops');
    expect(callOf(1).init?.headers).toEqual({ 'Content-Type': 'application/json', [USER_HEADER]: OWNER });
    expect(callOf(2).path).toBe('/api/import');
    expect(callOf(2).init?.headers).toEqual({ 'Content-Type': 'application/json', [USER_HEADER]: OWNER });
  });

  it('sends it nowhere else', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, user: USER }));
    await api.me();
    await api.foodStatus();
    await api.pushTest();
    expect(callOf(0).init?.headers).toBeUndefined();
    expect(callOf(1).init?.headers).toBeUndefined();
    expect(callOf(2).init?.headers).toEqual({ 'Content-Type': 'application/json' });
  });

  it('maps 409 user_mismatch to its own code', async () => {
    fetchMock.mockResolvedValue(jsonResponse(409, { error: 'user_mismatch', message: 'other account' }));
    await expect(api.sendOps([], OWNER)).rejects.toMatchObject({ status: 409, code: 'user_mismatch' });
  });
});

describe('accounts', () => {
  it('logs in with the username and the password and returns the validated account', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, user: USER }));
    await expect(api.login('olya', 'секрет-123')).resolves.toEqual({ ok: true, user: USER });
    expect(callOf()).toMatchObject({ path: API.login, body: { username: 'olya', password: 'секрет-123' } });
    expect(callOf().init?.method).toBe('POST');
  });

  it.each([
    ['me', () => api.me()],
    ['login', () => api.login('olya', 'pw')],
    ['invite accept', () => api.inviteAccept({ token: TOKEN, username: 'olya', password: 'password1' })],
    ['reset complete', () => api.resetComplete({ token: TOKEN, password: 'password1' })],
    ['rename', () => api.account.rename({ username: 'olya2', password: 'pw' })],
  ])('treats a 2xx %s answer without a valid user as outdated_server (an old server)', async (_name, call) => {
    // A v3 server answers `{ ok: true }` to me and to a `{ username, password }` login alike.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await expect(call()).rejects.toMatchObject({ name: 'ApiError', code: 'outdated_server', status: 200 });

    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, user: { ...USER, id: 'not-an-id' } }));
    const err = await call().catch((e: unknown) => e);
    expect(err).toMatchObject({ code: 'outdated_server' });
    expect((err as ApiError).isNetwork).toBe(false);
  });

  it('accepts a full SessionUser with a password provenance', async () => {
    const user = { ...USER, role: 'admin', passwordChange: { at: 1, via: 'reset', by: 'admin' } };
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, user }));
    await expect(api.me()).resolves.toEqual({ ok: true, user });
  });

  it('carries the reason of an unusable link', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse(410, { error: 'link_invalid', message: 'Посилання не працює', reason: 'expired' }),
    );
    const err = await api.inviteCheck(TOKEN).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 410, code: 'link_invalid', reason: 'expired' });

    fetchMock.mockResolvedValue(jsonResponse(410, { error: 'link_invalid', message: 'x', reason: 'bogus' }));
    expect(await api.resetCheck(TOKEN).catch((e: unknown) => e)).toMatchObject({ reason: undefined });
  });

  it('uses the one-time link endpoints', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true, expiresAt: 5, user: USER, username: 'anna' }));
    await api.inviteCheck(TOKEN);
    await api.inviteAccept({ token: TOKEN, username: 'olya', password: 'password1' });
    await api.resetCheck(TOKEN);
    await api.resetComplete({ token: TOKEN, password: 'password1' });
    expect([0, 1, 2, 3].map((i) => [callOf(i).path, callOf(i).body])).toEqual([
      [API.inviteCheck, { token: TOKEN }],
      [API.inviteAccept, { token: TOKEN, username: 'olya', password: 'password1' }],
      [API.resetCheck, { token: TOKEN }],
      [API.resetComplete, { token: TOKEN, password: 'password1' }],
    ]);
  });

  it('changes the password and the name of the signed-in account', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true }));
    await expect(api.account.changePassword({ currentPassword: 'old-pass', newPassword: 'new-pass1' })).resolves
      .toEqual({ ok: true });
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { ok: true, user: USER }));
    await expect(api.account.rename({ username: 'olya', password: 'pw' })).resolves.toEqual({ ok: true, user: USER });
    expect(callOf(0)).toMatchObject({
      path: API.accountPassword,
      body: { currentPassword: 'old-pass', newPassword: 'new-pass1' },
    });
    expect(callOf(1)).toMatchObject({ path: API.accountUsername, body: { username: 'olya', password: 'pw' } });
  });

  it('maps account errors', async () => {
    fetchMock.mockResolvedValue(jsonResponse(403, { error: 'wrong_password', message: 'Поточний пароль неправильний' }));
    await expect(
      api.account.changePassword({ currentPassword: 'x', newPassword: 'new-pass1' }),
    ).rejects.toMatchObject({ status: 403, code: 'wrong_password' });
  });
});

describe('admin', () => {
  it('calls every «Користувачі» endpoint with exactly its body', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    const userId = 'b2'.padEnd(32, '0');

    await api.admin.overview();
    await api.admin.createInvite({ note: 'для Олі' });
    await api.admin.createInvite();
    await api.admin.revokeInvite({ id: userId });
    await api.admin.resetLink({ userId });
    await api.admin.setRole({ userId, role: 'admin' });
    await api.admin.setDisabled({ userId, disabled: true });
    await api.admin.deleteUser({ userId, confirmUsername: 'olya' });
    await api.admin.setUserAiLimit({ userId, limit: null });
    await api.admin.setAiLimits({ perUser: 30, global: 100 });

    const calls = fetchMock.mock.calls.map((_, i) => [callOf(i).init?.method, callOf(i).path, callOf(i).body]);
    expect(calls).toEqual([
      ['GET', API.adminUsers, undefined],
      ['POST', API.adminInviteCreate, { note: 'для Олі' }],
      ['POST', API.adminInviteCreate, { note: '' }],
      ['POST', API.adminInviteRevoke, { id: userId }],
      ['POST', API.adminResetLink, { userId }],
      ['POST', API.adminSetRole, { userId, role: 'admin' }],
      ['POST', API.adminSetDisabled, { userId, disabled: true }],
      ['POST', API.adminDeleteUser, { userId, confirmUsername: 'olya' }],
      ['POST', API.adminUserAiLimit, { userId, limit: null }],
      ['POST', API.adminAiLimits, { perUser: 30, global: 100 }],
    ]);
    expect(API.adminUsers).toBe('/api/admin/users');
    expect(API.adminInviteRevoke).toBe('/api/admin/invites/revoke');
  });

  it('turns 403 forbidden and 409 last_admin into ApiError codes', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(403, { error: 'forbidden', message: 'Немає доступу' }));
    await expect(api.admin.overview()).rejects.toMatchObject({ status: 403, code: 'forbidden' });
    fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: 'last_admin', message: 'Це єдиний адміністратор' }));
    await expect(api.admin.setRole({ userId: OWNER, role: 'user' })).rejects.toMatchObject({ code: 'last_admin' });
  });
});

describe('push', () => {
  it('unsubscribes with the subscription’s auth key when given (D15)', async () => {
    fetchMock.mockResolvedValue(jsonResponse(200, { ok: true }));
    await api.pushUnsubscribe('https://push.example/a', 'auth-key');
    await api.pushUnsubscribe('https://push.example/b');
    expect(callOf(0)).toMatchObject({
      path: API.pushUnsubscribe,
      body: { endpoint: 'https://push.example/a', auth: 'auth-key' },
    });
    expect(callOf(1).body).toEqual({ endpoint: 'https://push.example/b' });
  });
});
