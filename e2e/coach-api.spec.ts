/**
 * The coach API on the real bundle (docs/coach-cabinet.md §3.2, §8.2): admin only, GET only, role-user accounts
 * only, no secrets, no caching, no writes.
 *
 * Rules (docs/multi-user.md §11.2): anna and admin only read here; every other account is a throwaway one, disposed
 * in `finally` (a promoted one is demoted first); no failed login, no failed link attempt; no server-derived date
 * (`createdAt`, `lastSeenAt`) or the `inactive` flag is asserted against the real server clock.
 */
import type { APIResponse } from '@playwright/test';
import {
  API,
  coachClientPath,
  coachClientsPath,
  coachPhotoThumbUrl,
  coachPhotoUrl,
  type CoachClientResponse,
  type CoachClientsResponse,
} from '../packages/shared/src/index';
import { coachSteady } from './fixtures/coach';
import {
  coachWindowAt,
  getCoachClient,
  getCoachClients,
  getCoachPhoto,
  secretKeysIn,
  seedClient,
  sendToCoach,
} from './support/coachApi';
import { BASE_URL } from './support/env';
import { createUser, ServerApi, type TestUser } from './support/server';
import { expect, test } from './support/test';

const NO_STORE = 'private, no-store';
const UNKNOWN_ID = 'e'.repeat(32);
const MALFORMED_ID = 'not-a-user-id';
/** A valid `photoIdSchema` id that no photo has. */
const UNKNOWN_PHOTO = 'AAAAAAAAAAAAAAAAAAAAAA';
const MALFORMED_PHOTO = 'bad!';

async function errorOf(res: APIResponse): Promise<string | undefined> {
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  return body.error;
}

async function expectStatus(res: APIResponse, status: number, code?: string): Promise<void> {
  expect(res.status(), `${res.url()}: ${await res.text()}`).toBe(status);
  if (code) expect(await errorOf(res)).toBe(code);
}

/** The four coach paths about `clientId` (photo paths with a valid photo id). */
const coachPaths = (clientId: string): string[] => [
  coachClientsPath(coachWindowAt()),
  coachClientPath(clientId),
  coachPhotoUrl(clientId, UNKNOWN_PHOTO),
  coachPhotoThumbUrl(clientId, UNKNOWN_PHOTO),
];

test.describe('coach API', () => {
  test('401 without a session and 403 for anna on all four routes', async ({ playwright, server }) => {
    const request = await playwright.request.newContext({ baseURL: BASE_URL });
    try {
      const anonymous = new ServerApi(request);
      for (const path of coachPaths(server.id)) {
        await expectStatus(await anonymous.rawGet(path), 401, 'unauthorized');
      }
    } finally {
      await request.dispose();
    }
    for (const path of coachPaths(server.id)) {
      await expectStatus(await server.rawGet(path), 403, 'forbidden');
    }
  });

  test('the admin lists clients, never an admin (a promoted throwaway disappears)', async ({
    playwright,
    admin,
    server,
  }) => {
    let client: TestUser | null = null;
    let promoted: TestUser | null = null;
    try {
      client = await seedClient(playwright, admin, coachSteady(), 'coach');
      promoted = await createUser(playwright, admin);
      await admin.setRole(promoted.id, 'admin');

      const res = await getCoachClients(admin);
      await expectStatus(res, 200);
      expect(res.headers()['cache-control']).toBe(NO_STORE);
      const body = (await res.json()) as CoachClientsResponse;
      expect(body.from).toBe(coachWindowAt().from);
      expect(body.to).toBe(coachWindowAt().to);
      const ids = body.clients.map((c) => c.client.id);
      expect(ids).toContain(server.id);
      expect(ids).toContain(client.id);
      expect(ids).not.toContain(admin.id);
      expect(ids).not.toContain(promoted.id);
      const seeded = body.clients.find((c) => c.client.id === client?.id);
      expect(seeded?.client.username).toBe(client.creds.username);
      expect(seeded?.client.status).toBe('active');
      expect(seeded?.weights.length).toBeGreaterThan(0);
      expect(secretKeysIn(body)).toEqual([]);

      // The promoted admin is not a client: 404 on detail too.
      await expectStatus(await getCoachClient(admin, promoted.id), 404, 'not_found');
    } finally {
      if (promoted) {
        await admin.setRole(promoted.id, 'user');
        await promoted.dispose();
      }
      if (client) await client.dispose();
    }
  });

  test('anna’s detail is her own copy with foods: [] and no secrets', async ({ admin, server }) => {
    const own = await server.getData();
    const res = await getCoachClient(admin, server.id);
    await expectStatus(res, 200);
    expect(res.headers()['cache-control']).toBe(NO_STORE);
    const body = (await res.json()) as CoachClientResponse;
    expect(body.data).toEqual({ ...own, foods: [] });
    expect(Object.keys(body.client).sort()).toEqual(['createdAt', 'id', 'lastSeenAt', 'status', 'username']);
    expect(body.client.id).toBe(server.id);
    expect(body.client.username).toBe(server.creds.username);
    expect(secretKeysIn(body)).toEqual([]);
  });

  test('404 for the admin’s own id, malformed and unknown ids', async ({ admin }) => {
    for (const id of [admin.id, MALFORMED_ID, UNKNOWN_ID]) {
      const res = await getCoachClient(admin, id);
      await expectStatus(res, 404, 'not_found');
      expect(res.headers()['cache-control']).toBe(NO_STORE);
      await expectStatus(await getCoachPhoto(admin, id, UNKNOWN_PHOTO), 404, 'not_found');
    }
  });

  test('a bad window is a 400 «Некоректний період»', async ({ admin }) => {
    const bad: APIResponse[] = [
      await getCoachClients(admin, null),
      await admin.rawGet(`${API.coachClients}?from=2026-10-01`),
      await getCoachClients(admin, { from: '2026-02-30', to: '2026-03-10' }),
      await getCoachClients(admin, { from: '2026-10-15', to: '2026-10-14' }),
      await getCoachClients(admin, { from: '2026-09-01', to: '2026-11-02' }),
    ];
    for (const res of bad) {
      await expectStatus(res, 400, 'bad_request');
      expect(res.headers()['cache-control']).toBe(NO_STORE);
    }
    expect(((await (await getCoachClients(admin, null)).json()) as { message: string }).message).toBe(
      'Некоректний період',
    );
  });

  test('POST / PUT / PATCH / DELETE are 404 with Origin + JSON; anna’s data is unchanged', async ({
    admin,
    server,
  }) => {
    const before = await server.getData();
    for (const path of [API.coachClients, ...coachPaths(server.id)]) {
      for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
        await expectStatus(await sendToCoach(admin, method, path), 404, 'not_found');
        await expectStatus(await sendToCoach(admin, method, path, false), 403, 'forbidden_origin');
      }
    }
    expect(await server.getData()).toEqual(before);
  });

  test('HEAD as the admin is a 405 with Allow: GET; OPTIONS is a 404', async ({ admin, server }) => {
    for (const path of coachPaths(server.id)) {
      const head = await sendToCoach(admin, 'HEAD', path);
      expect(head.status(), path).toBe(405);
      expect(head.headers().allow).toBe('GET');
      expect(head.headers()['cache-control']).toBe(NO_STORE);
      expect((await sendToCoach(admin, 'OPTIONS', path)).status(), path).toBe(404);
    }
  });

  test('photos: an unknown id is a 404, a malformed one a 400', async ({ admin, server }) => {
    for (const variant of ['full', 'thumb'] as const) {
      const unknown = await getCoachPhoto(admin, server.id, UNKNOWN_PHOTO, variant);
      await expectStatus(unknown, 404, 'not_found');
      expect(unknown.headers()['cache-control']).toBe(NO_STORE);
      const malformed = await getCoachPhoto(admin, server.id, MALFORMED_PHOTO, variant);
      await expectStatus(malformed, 400, 'bad_request');
      expect(malformed.headers()['cache-control']).toBe(NO_STORE);
    }
    // anna on the coach photo route: 403.
    await expectStatus(await getCoachPhoto(server, server.id, UNKNOWN_PHOTO), 403, 'forbidden');
  });
});
