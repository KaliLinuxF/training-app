/**
 * Coach API helpers for the e2e suite (docs/coach-cabinet.md §8.3): raw calls to `/api/coach/**` as any account,
 * seeding throwaway clients, a recursive secret-key check, and `page.route` stubs serving the payloads of
 * `e2e/fixtures/coach.ts`.
 */
import type { APIResponse, Page } from '@playwright/test';
import {
  API,
  coachClientPath,
  coachClientsPath,
  coachPhotoThumbUrl,
  coachPhotoUrl,
  coachWindow,
  type AppData,
  type CoachClientResponse,
  type CoachClientsResponse,
  type CoachWindow,
} from '../../packages/shared/src/index';
import { BASE_URL, FIXED_NOW } from './env';
import { createUser, uniqueUsername, type Playwright, type ServerApi, type TestUser } from './server';

type Headers = Record<string, string>;

const urlOf = (path: string): string => (/^https?:\/\//.test(path) ? path : `${BASE_URL}${path}`);

/** What a stubbed coach response carries besides the body (as the server sends it, C9). */
const NO_STORE: Headers = { 'Cache-Control': 'private, no-store' };

/** The window the web asks for at `now` (the browser clock of the suite by default). */
export const coachWindowAt = (now: Date = FIXED_NOW): CoachWindow => coachWindow(now);

/**
 * `GET /api/coach/clients` with only `headers`; unchecked. `window` defaults to `coachWindowAt()`; `null` sends no
 * query at all.
 */
export function getCoachClients(
  api: ServerApi,
  window?: CoachWindow | null,
  headers?: Headers,
): Promise<APIResponse> {
  const path = window === null ? API.coachClients : coachClientsPath(window ?? coachWindowAt());
  return api.rawGet(path, headers);
}

/** `GET /api/coach/clients/:id`; unchecked. */
export function getCoachClient(api: ServerApi, id: string): Promise<APIResponse> {
  return api.rawGet(coachClientPath(id));
}

/** `GET /api/coach/clients/:id/photos/:photoId[/thumb]`; unchecked. */
export function getCoachPhoto(
  api: ServerApi,
  clientId: string,
  photoId: string,
  variant: 'full' | 'thumb' = 'full',
): Promise<APIResponse> {
  return api.rawGet(
    variant === 'thumb' ? coachPhotoThumbUrl(clientId, photoId) : coachPhotoUrl(clientId, photoId),
  );
}

export type CoachWriteMethod = 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS';

/**
 * Any other method than GET on a coach path; unchecked. With `withOrigin` (default) it sends the same-origin
 * `Origin` and `Content-Type: application/json` the CSRF guard asks for (so the request gets past it); methods
 * that may carry a body send `{}`.
 */
export function sendToCoach(
  api: ServerApi,
  method: CoachWriteMethod,
  path: string,
  withOrigin = true,
): Promise<APIResponse> {
  const headers: Headers = withOrigin ? { Origin: BASE_URL, 'Content-Type': 'application/json' } : {};
  const hasBody = method !== 'HEAD' && method !== 'OPTIONS';
  return api.request.fetch(urlOf(path), {
    method,
    headers,
    ...(hasBody ? { data: '{}' } : {}),
    failOnStatusCode: false,
  });
}

/**
 * A throwaway client (role user) holding `data`: `createUser` + `importData`. Call `dispose()` in a `finally`
 * (it is disposed here when the import fails).
 */
export async function seedClient(
  playwright: Playwright,
  admin: ServerApi,
  data: AppData,
  prefix = 'c',
): Promise<TestUser> {
  const user = await createUser(playwright, admin, { username: uniqueUsername(prefix) });
  try {
    await user.api.importData(data);
  } catch (error) {
    await user.dispose();
    throw error;
  }
  return user;
}

const SECRET_KEY = /password|hash|token|session|endpoint|p256dh|^auth$|invite/i;
/** Workout sessions (schema v5) are not sign-in sessions: these keys are allowed although the pattern matches. */
const WORKOUT_SESSION_KEYS: ReadonlySet<string> = new Set(['sessions', 'deletedSessions']);

/**
 * Paths (`clients[0].client.passwordHash`) of every object key in `value`, at any depth, whose name looks like a
 * secret. A coach response must give [].
 */
export function secretKeysIn(value: unknown): string[] {
  const found: string[] = [];
  const walk = (v: unknown, path: string): void => {
    if (Array.isArray(v)) {
      v.forEach((item, i) => walk(item, `${path}[${i}]`));
      return;
    }
    if (typeof v !== 'object' || v === null) return;
    for (const [key, child] of Object.entries(v)) {
      const childPath = path ? `${path}.${key}` : key;
      if (SECRET_KEY.test(key) && !WORKOUT_SESSION_KEYS.has(key)) found.push(childPath);
      walk(child, childPath);
    }
  };
  walk(value, '');
  return found;
}

/** Serves `payload` for `GET /api/coach/clients` (any query); other methods go on to the server. */
export async function stubCoachClients(page: Page, payload: CoachClientsResponse): Promise<void> {
  await page.route(
    (url) => url.pathname === API.coachClients,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: payload, headers: NO_STORE })
        : route.fallback(),
  );
}

/** Serves `payload` for `GET /api/coach/clients/<payload.client.id>`; other methods go on to the server. */
export async function stubCoachClient(page: Page, payload: CoachClientResponse): Promise<void> {
  const path = coachClientPath(payload.client.id);
  await page.route(
    (url) => url.pathname === path,
    (route) =>
      route.request().method() === 'GET'
        ? route.fulfill({ json: payload, headers: NO_STORE })
        : route.fallback(),
  );
}

/**
 * Serves `jpeg` for every coach photo (full and thumb, any client) and returns the requested URLs — a live array
 * that grows as the page asks for photos.
 */
export async function stubCoachPhotos(page: Page, jpeg: Buffer): Promise<string[]> {
  const requested: string[] = [];
  await page.route('**/api/coach/clients/*/photos/**', (route) => {
    requested.push(route.request().url());
    return route.fulfill({
      status: 200,
      contentType: 'image/jpeg',
      body: jpeg,
      headers: { ...NO_STORE, 'X-Content-Type-Options': 'nosniff' },
    });
  });
  return requested;
}
