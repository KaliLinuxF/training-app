/**
 * Direct access to the e2e server's HTTP API (outside the browser): log in, replace all data,
 * read what actually reached the server.
 */
import { expect, type APIRequestContext, type BrowserContext } from '@playwright/test';
import type { AppData } from '../../packages/shared/src/index';
import { BASE_URL, PASSWORD } from './env';

/** Mutating requests need a same-origin `Origin` header (CSRF guard) and a JSON body. */
const MUTATION_HEADERS = { Origin: BASE_URL, 'Content-Type': 'application/json' };

/** Logs `request` in (its cookie jar keeps the `sid` cookie). */
export async function apiLogin(request: APIRequestContext, password = PASSWORD): Promise<void> {
  const res = await request.post(`${BASE_URL}/api/auth/login`, {
    data: { password },
    headers: MUTATION_HEADERS,
  });
  expect(res.status(), `login failed: ${await res.text()}`).toBe(200);
}

/**
 * Logs a browser context in without the UI: the cookie set by the API response lands in the
 * context's cookie jar, so the next page load starts authenticated.
 */
export const loginContext = (context: BrowserContext): Promise<void> => apiLogin(context.request);

export class ServerApi {
  constructor(private readonly request: APIRequestContext) {}

  async login(): Promise<void> {
    await apiLogin(this.request);
  }

  /** Replaces everything on the server (`POST /api/import`). */
  async importData(data: AppData): Promise<void> {
    const res = await this.request.post(`${BASE_URL}/api/import`, { data, headers: MUTATION_HEADERS });
    expect(res.status(), `import failed: ${await res.text()}`).toBe(200);
  }

  /** What the server currently stores (`GET /api/data`). */
  async getData(): Promise<AppData> {
    const res = await this.request.get(`${BASE_URL}/api/data`);
    expect(res.status()).toBe(200);
    return (await res.json()) as AppData;
  }
}
