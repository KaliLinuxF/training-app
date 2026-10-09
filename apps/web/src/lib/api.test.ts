import { emptyData } from '@legko/shared';
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

    await expect(api.sendOps([{ kind: 'day.delete', date: '2026-10-09' }])).resolves.toEqual({
      ok: true,
      applied: 1,
    });

    const [path, init] = fetchMock.mock.calls[0] ?? [];
    expect(path).toBe('/api/ops');
    expect(init).toMatchObject({
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ops: [{ kind: 'day.delete', date: '2026-10-09' }] }),
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('turns server errors into ApiError with the code, message and op index', async () => {
    fetchMock.mockResolvedValue(jsonResponse(400, { error: 'invalid_op', message: 'bad', index: 2 }));

    const err = await api.sendOps([]).catch((e: unknown) => e);
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

    const err = await api.getData().catch((e: unknown) => e);
    expect(err).toMatchObject({ status: 502, code: 'internal' });
    expect((err as ApiError).isNetwork).toBe(true);
  });

  it('maps a failed fetch (offline) to ApiError("network")', async () => {
    fetchMock.mockRejectedValue(new TypeError('Failed to fetch'));
    await expectNetworkError(api.me(), NETWORK_MESSAGES.offline);
  });

  it('gives up on a hanging request after 15 s with ApiError("network")', async () => {
    fetchMock.mockImplementation(hang);
    const result = expectNetworkError(api.getData(), NETWORK_MESSAGES.timeout);

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
    const upload = expectNetworkError(api.importData(emptyData()), NETWORK_MESSAGES.timeout);

    await vi.advanceTimersByTimeAsync(REQUEST_TIMEOUT_MS);
    expect(signalOf()?.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(IMPORT_TIMEOUT_MS - REQUEST_TIMEOUT_MS);
    await upload;
  });
});
