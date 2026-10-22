import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  API,
  coachClientPath,
  coachClientsPath,
  coachPhotoThumbUrl,
  coachPhotoUrl,
  defaultSettings,
  photoUrl,
  type AppData,
  type CoachClientResponse,
  type CoachClientsResponse,
  type CoachWindow,
  type ErrorResponse,
  type Op,
} from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { UserId } from '../src/db/users';
import { MESSAGES } from '../src/http/errors';
import { LAST_SEEN_EVERY_MS } from '../src/http/middleware/requireAuth';
import { COACH_CACHE_CONTROL, COACH_ROUTES } from '../src/http/routes/coach';
import type { Logger } from '../src/logger';
import { createTestServer, fakeJpeg, json, type TestServer, type TestUser } from './helpers';

/**
 * The coach routes (docs/coach-cabinet.md §2, §3.2, §8.1 «routes, negative authz»): admin only, GET only, role-user
 * accounts only, never a secret, never a write, never a cached copy.
 */

const WINDOW: CoachWindow = { from: '2026-09-11', to: '2026-10-15' };
const D1 = '2026-10-07';
const D2 = '2026-10-08';
const NOTE = 'Нотатка анни';
const MEAL_TEXT = 'Сирники зі сметаною';
const UNKNOWN_ID = 'e'.repeat(32);
const MALFORMED_ID = 'not-a-user-id';
const MALFORMED_PHOTO = 'bad!';
const NON_GET = ['POST', 'PUT', 'PATCH', 'DELETE'] as const;

/** Tables with a `user_id`: everything a user owns (as test/isolation.test.ts). */
const OWNED_TABLES = [
  'days',
  'weights',
  'measures',
  'foods',
  'user_settings',
  'photos',
  'push_subscriptions',
  'reminder_log',
  'ai_usage',
] as const;

/** Every stored row of one user, column for column (the "byte-identical" check). */
function rowsOf(s: TestServer, id: UserId): Record<string, unknown[]> {
  return Object.fromEntries(
    OWNED_TABLES.map((table) => [
      table,
      s.db.prepare(`SELECT * FROM ${table} WHERE user_id = ? ORDER BY 1, 2`).all(id),
    ]),
  );
}

const SECRET_KEY = /password|hash|token|session|endpoint|p256dh|^auth$|invite/i;
/** Workout sessions (schema v5), not sign-in sessions: allowed keys that the pattern above would catch. */
const WORKOUT_SESSION_KEYS: ReadonlySet<string> = new Set(['sessions', 'deletedSessions']);

/** Paths of keys that look like a secret, at any depth. */
function secretKeysIn(value: unknown, path = ''): string[] {
  if (Array.isArray(value)) return value.flatMap((v, i) => secretKeysIn(v, `${path}[${i}]`));
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) => {
    const here = path ? `${path}.${key}` : key;
    const secret = SECRET_KEY.test(key) && !WORKOUT_SESSION_KEYS.has(key);
    return [...(secret ? [here] : []), ...secretKeysIn(child, here)];
  });
}

const errorOf = async (res: Response): Promise<string> => (await json<ErrorResponse>(res)).error;

let photosDir: string;
let lines: string[];
let s: TestServer;
let adminCookie: string;
let annaCookie: string;
let olya: TestUser;
let annaPhoto: string;
let olyaPhoto: string;
let adminPhoto: string;

const capturing = (out: string[]): Logger => ({
  debug: () => undefined,
  info: (m) => out.push(m),
  warn: (m) => out.push(m),
  error: (m) => out.push(m),
});

const coachLines = (): string[] => lines.filter((l) => l.startsWith('coach:'));

/** Every user's owned rows (anna, olya, admin). */
const allRows = () => ({
  anna: rowsOf(s, s.anna.id),
  olya: rowsOf(s, olya.id),
  admin: rowsOf(s, s.admin.id),
});

beforeEach(async () => {
  photosDir = mkdtempSync(join(tmpdir(), 'legko-coach-routes-'));
  lines = [];
  s = await createTestServer({ photosDir, logger: capturing(lines) });
  adminCookie = await s.login('admin');
  annaCookie = await s.login('anna');
  olya = await s.createUser('olya');

  annaPhoto = await s.photos
    .forUser(s.anna.id)
    .save({ full: fakeJpeg(2000, 1), thumb: fakeJpeg(200, 2) }, D2);
  olyaPhoto = await s.photos.forUser(olya.id).save({ full: fakeJpeg(1500, 3), thumb: fakeJpeg(150, 4) }, D2);
  adminPhoto = await s.photos
    .forUser(s.admin.id)
    .save({ full: fakeJpeg(1000, 5), thumb: fakeJpeg(100, 6) }, D2);

  const annaOps: Op[] = [
    {
      kind: 'day.put',
      date: D1,
      value: { food: 'Омлет', kcal: 1650, trained: true, types: ['Кардіо'], notes: '' },
    },
    {
      kind: 'meal.put',
      date: D2,
      value: {
        id: 'breakfast001',
        type: 'Сніданок',
        time: '08:30',
        text: MEAL_TEXT,
        kcal: 420,
        protein: 27,
        fat: 11,
        carbs: 36,
        photos: [annaPhoto],
      },
    },
    { kind: 'day.meta', date: D2, value: { trained: false, types: [], notes: NOTE } },
    { kind: 'weight.put', date: D1, kg: 65.4 },
    { kind: 'measure.put', date: D1, value: { chest: 90, waist: 70, hips: 98 } },
    { kind: 'food.use', date: D1, value: { name: 'Борщ', portion: '300 г', kcal: 180 } },
    { kind: 'settings.put', value: { ...defaultSettings(), goal: 57, timezone: 'Europe/Warsaw' } },
  ];
  expect((await s.call(API.ops, { cookie: annaCookie, body: { ops: annaOps } })).status).toBe(200);
  expect(
    (
      await s.call(API.ops, {
        cookie: olya.cookie,
        body: { ops: [{ kind: 'weight.put', date: D1, kg: 80 }] },
      })
    ).status,
  ).toBe(200);
  // Pushes, so every owned table of anna has something to compare.
  await s.call(API.pushSubscribe, {
    cookie: annaCookie,
    body: { subscription: { endpoint: 'https://web.push.apple.com/anna', keys: { p256dh: 'p', auth: 'a' } } },
  });
  lines.length = 0;
});

afterEach(() => rmSync(photosDir, { recursive: true, force: true }));

const get = (path: string, cookie: string | null = adminCookie) => s.call(path, { cookie });

/** The four coach paths for one client id (photo paths with a valid photo id). */
const pathsFor = (id: string, photo = annaPhoto): string[] => [
  coachClientsPath(WINDOW),
  coachClientPath(id),
  coachPhotoUrl(id, photo),
  coachPhotoThumbUrl(id, photo),
];

describe('route table', () => {
  it('every /api/coach route is GET and the paths are exactly COACH_ROUTES', () => {
    const coach = s.app.routes.filter((r) => r.path.startsWith('/api/coach'));
    expect(coach.length).toBeGreaterThan(0);
    expect(coach.every((r) => r.method === 'GET')).toBe(true);
    expect(new Set(coach.map((r) => r.path))).toEqual(new Set(Object.values(COACH_ROUTES)));
  });

  it('COACH_ROUTES are the shared path helpers', () => {
    expect(coachClientsPath(WINDOW).split('?')[0]).toBe(COACH_ROUTES.clients);
    expect(API.coachClients).toBe(COACH_ROUTES.clients);
    expect(coachClientPath(s.anna.id)).toBe(COACH_ROUTES.client.replace(':id', s.anna.id));
    expect(coachPhotoUrl(s.anna.id, annaPhoto)).toBe(
      COACH_ROUTES.photo.replace(':id', s.anna.id).replace(':photoId', annaPhoto),
    );
    expect(coachPhotoThumbUrl(s.anna.id, annaPhoto)).toBe(
      COACH_ROUTES.thumb.replace(':id', s.anna.id).replace(':photoId', annaPhoto),
    );
  });
});

describe('authz', () => {
  it('401 without a session on all four routes', async () => {
    for (const path of pathsFor(s.anna.id)) {
      const res = await get(path, null);
      expect(res.status, path).toBe(401);
      expect(await errorOf(res)).toBe('unauthorized');
    }
  });

  it('403 for a user — about herself and about another user — on all four routes; nothing logged', async () => {
    for (const cookie of [annaCookie, olya.cookie]) {
      for (const path of [...pathsFor(s.anna.id), ...pathsFor(olya.id, olyaPhoto)]) {
        const res = await get(path, cookie);
        expect(res.status, path).toBe(403);
        expect(await errorOf(res)).toBe('forbidden');
      }
    }
    expect(coachLines()).toEqual([]);
  });

  it('404 for the admin’s own id, another admin, unknown and malformed ids (detail and photos)', async () => {
    const boss = await s.createUser('boss', 'admin');
    for (const id of [s.admin.id, boss.id, UNKNOWN_ID, MALFORMED_ID]) {
      for (const path of [
        coachClientPath(id),
        coachPhotoUrl(id, adminPhoto),
        coachPhotoThumbUrl(id, adminPhoto),
      ]) {
        const res = await get(path);
        expect(res.status, path).toBe(404);
        expect(await errorOf(res)).toBe('not_found');
        expect(res.headers.get('Cache-Control')).toBe(COACH_CACHE_CONTROL);
      }
    }
    expect(coachLines()).toEqual(
      expect.arrayContaining([
        `coach: admin ${s.admin.id} was refused ${s.admin.id}`,
        `coach: admin ${s.admin.id} was refused ${boss.id}`,
        `coach: admin ${s.admin.id} was refused ${UNKNOWN_ID}`,
        `coach: admin ${s.admin.id} was refused a malformed id`,
      ]),
    );
  });

  it('another admin is never listed; disabled clients are', async () => {
    const boss = await s.createUser('boss', 'admin');
    s.users.setDisabled(olya.id, s.clock.now);
    const body = await json<CoachClientsResponse>(await get(coachClientsPath(WINDOW)));
    expect(body.clients.map((c) => [c.client.username, c.client.status])).toEqual([
      ['anna', 'active'],
      ['olya', 'disabled'],
    ]);
    expect(body.clients.some((c) => c.client.id === boss.id || c.client.id === s.admin.id)).toBe(false);
  });
});

describe('GET only', () => {
  const allCoachPaths = (): string[] => [
    API.coachClients,
    ...pathsFor(s.anna.id),
    ...pathsFor(s.admin.id, adminPhoto),
    `${API.coachClients}/${UNKNOWN_ID}/anything`,
  ];

  it('POST / PUT / PATCH / DELETE: 403 without Origin, 404 with Origin + JSON; no row of any user changes', async () => {
    const before = allRows();
    const usersBefore = s.db.prepare('SELECT * FROM users ORDER BY id').all();
    for (const path of allCoachPaths()) {
      for (const method of NON_GET) {
        for (const cookie of [adminCookie, annaCookie]) {
          const bare = await s.call(path, { method, cookie, origin: null, contentType: null, body: {} });
          expect(bare.status, `${method} ${path}`).toBe(403);
          expect(await errorOf(bare)).toBe('forbidden_origin');
          const guarded = await s.call(path, { method, cookie, body: { ops: [] } });
          expect(guarded.status, `${method} ${path}`).toBe(404);
          expect(await errorOf(guarded)).toBe('not_found');
        }
      }
    }
    expect(allRows()).toEqual(before);
    expect(s.db.prepare('SELECT * FROM users ORDER BY id').all()).toEqual(usersBefore);
    expect(coachLines()).toEqual([]);
  });

  it('HEAD: 403 for a user; 405 + Allow: GET for the admin, nothing read, nothing logged', async () => {
    const before = allRows();
    for (const path of pathsFor(s.anna.id)) {
      expect((await s.call(path, { method: 'HEAD', cookie: annaCookie })).status, path).toBe(403);
      const res = await s.call(path, { method: 'HEAD', cookie: adminCookie });
      expect(res.status, path).toBe(405);
      expect(res.headers.get('Allow')).toBe('GET');
      expect(res.headers.get('Cache-Control')).toBe(COACH_CACHE_CONTROL);
      expect(await res.text()).toBe('');
    }
    expect(coachLines()).toEqual([]);
    expect(allRows()).toEqual(before);
  });

  it('OPTIONS → 404 (no route)', async () => {
    for (const path of pathsFor(s.anna.id)) {
      const res = await s.call(path, { method: 'OPTIONS', cookie: adminCookie });
      expect(res.status, path).toBe(404);
    }
    expect(coachLines()).toEqual([]);
  });
});

describe('GET /api/coach/clients', () => {
  it('lists the clients with their digests for the window; headers private, no-store', async () => {
    const res = await get(coachClientsPath(WINDOW));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(COACH_CACHE_CONTROL);
    expect(res.headers.get('Content-Type')).toContain('application/json');
    const body = await json<CoachClientsResponse>(res);
    expect(body.from).toBe(WINDOW.from);
    expect(body.to).toBe(WINDOW.to);
    const anna = body.clients.find((c) => c.client.id === s.anna.id);
    expect(anna?.days.map((d) => d.date)).toEqual([D1, D2]);
    expect(anna?.firstRecord).toBe(D1);
    expect(anna?.lastRecord).toBe(D2);
    expect(anna?.settings.timezone).toBe('Europe/Warsaw');
    const text = JSON.stringify(body);
    for (const content of [MEAL_TEXT, NOTE, annaPhoto, 'Борщ']) expect(text).not.toContain(content);
    expect(secretKeysIn(body)).toEqual([]);
    expect(coachLines()).toEqual([
      `coach: admin ${s.admin.id} listed 2 clients ${WINDOW.from}..${WINDOW.to}: ${s.anna.id},${olya.id}`,
    ]);
  });

  it.each([
    ['no query', API.coachClients],
    ['from only', `${API.coachClients}?from=2026-09-11`],
    ['to only', `${API.coachClients}?to=2026-10-15`],
    ['an invalid date', `${API.coachClients}?from=2026-02-30&to=2026-03-10`],
    ['not a date', `${API.coachClients}?from=yesterday&to=2026-10-15`],
    ['to before from', coachClientsPath({ from: '2026-10-15', to: '2026-10-14' })],
    ['63 days', coachClientsPath({ from: '2026-09-01', to: '2026-11-02' })],
  ])('400 «Некоректний період» for %s', async (_name, path) => {
    const res = await get(path);
    expect(res.status).toBe(400);
    expect(await json<ErrorResponse>(res)).toEqual({ error: 'bad_request', message: MESSAGES.badWindow });
    expect(res.headers.get('Cache-Control')).toBe(COACH_CACHE_CONTROL);
    expect(coachLines()).toEqual([]);
  });

  it('62 days and a single day are fine', async () => {
    expect((await get(coachClientsPath({ from: '2026-09-01', to: '2026-11-01' }))).status).toBe(200);
    expect((await get(coachClientsPath({ from: '2026-10-08', to: '2026-10-08' }))).status).toBe(200);
  });
});

describe('GET /api/coach/clients/:id', () => {
  it('is the client’s own copy with foods: [] and a profile without secrets', async () => {
    const res = await get(coachClientPath(s.anna.id));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe(COACH_CACHE_CONTROL);
    const body = await json<CoachClientResponse>(res);
    const own = await json<AppData>(await s.call(API.data, { cookie: annaCookie }));
    expect(own.foods).toHaveLength(1);
    expect(body.data).toEqual({ ...own, foods: [], deletedSessions: [] });
    expect(Object.keys(body.client).sort()).toEqual(['createdAt', 'id', 'lastSeenAt', 'status', 'username']);
    expect(body.client).toMatchObject({ id: s.anna.id, username: 'anna', status: 'active' });
    expect(secretKeysIn(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toMatch(/web\.push\.apple\.com|p256dh/);
    expect(coachLines()).toEqual([`coach: admin ${s.admin.id} read client ${s.anna.id}`]);
  });

  it('a pending account (no password yet) reads as pending', async () => {
    const nova = s.users.create({ username: 'nova', role: 'user', passwordHash: null, now: s.clock.now });
    const body = await json<CoachClientResponse>(await get(coachClientPath(nova.id)));
    expect(body.client.status).toBe('pending');
    expect(body.client.lastSeenAt).toBeNull();
  });
});

describe('photos', () => {
  it('anna’s photo via her path: 200, equal bytes, image headers', async () => {
    for (const [path, size] of [
      [coachPhotoUrl(s.anna.id, annaPhoto), 2000],
      [coachPhotoThumbUrl(s.anna.id, annaPhoto), 200],
    ] as const) {
      const res = await get(path);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('Content-Type')).toBe('image/jpeg');
      expect(res.headers.get('Cache-Control')).toBe(COACH_CACHE_CONTROL);
      expect(res.headers.get('Vary')).toBe('Cookie');
      expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.length).toBe(size);
      const own = await s.call(size === 2000 ? photoUrl(annaPhoto) : `${photoUrl(annaPhoto)}/thumb`, {
        cookie: annaCookie,
      });
      expect(bytes.equals(Buffer.from(await own.arrayBuffer()))).toBe(true);
    }
    expect(coachLines()).toEqual([
      `coach: admin ${s.admin.id} viewed a photo of client ${s.anna.id}`,
      `coach: admin ${s.admin.id} viewed a photo of client ${s.anna.id}`,
    ]);
  });

  it('the photo matrix', async () => {
    // anna's photo through olya's path; the admin's own photo through anna's path: not theirs → 404.
    expect((await get(coachPhotoUrl(olya.id, annaPhoto))).status).toBe(404);
    expect((await get(coachPhotoThumbUrl(olya.id, annaPhoto))).status).toBe(404);
    expect((await get(coachPhotoUrl(s.anna.id, adminPhoto))).status).toBe(404);
    expect((await get(coachPhotoUrl(s.anna.id, olyaPhoto))).status).toBe(404);
    // olya's photo through olya's path.
    const olyas = await get(coachPhotoUrl(olya.id, olyaPhoto));
    expect(olyas.status).toBe(200);
    expect(Buffer.from(await olyas.arrayBuffer()).length).toBe(1500);
    // A malformed photo id is a 400 before anything else (even for a non-client id).
    for (const id of [s.anna.id, s.admin.id, MALFORMED_ID]) {
      const bad = await get(coachPhotoUrl(id, MALFORMED_PHOTO));
      expect(bad.status).toBe(400);
      expect(await json<ErrorResponse>(bad)).toEqual({ error: 'bad_request', message: MESSAGES.badPhotoId });
      expect(bad.headers.get('Cache-Control')).toBe(COACH_CACHE_CONTROL);
    }
    // The ordinary photo route keeps its owner check: olya cannot read anna's photo, nor can the admin.
    expect((await s.call(photoUrl(annaPhoto), { cookie: olya.cookie })).status).toBe(404);
    expect((await s.call(photoUrl(annaPhoto), { cookie: adminCookie })).status).toBe(404);
    // A user on the coach photo route: 403.
    expect((await get(coachPhotoUrl(s.anna.id, annaPhoto), olya.cookie)).status).toBe(403);
    expect((await get(coachPhotoUrl(s.anna.id, annaPhoto), annaCookie)).status).toBe(403);

    const logged = coachLines();
    expect(logged).toContain(`coach: admin ${s.admin.id} found no such photo of client ${olya.id}`);
    expect(logged).toContain(`coach: admin ${s.admin.id} found no such photo of client ${s.anna.id}`);
    expect(logged).toContain(`coach: admin ${s.admin.id} viewed a photo of client ${olya.id}`);
    for (const line of logged) {
      for (const id of [annaPhoto, olyaPhoto, adminPhoto]) expect(line).not.toContain(id);
    }
  });

  it('a missing file of an owned photo is a 404', async () => {
    rmSync(join(photosDir, `${annaPhoto}_t.jpg`));
    expect((await get(coachPhotoThumbUrl(s.anna.id, annaPhoto))).status).toBe(404);
    expect((await get(coachPhotoUrl(s.anna.id, annaPhoto))).status).toBe(200);
  });
});

describe('roles act at once', () => {
  it('promote anna → 404; demote another admin → listed; demote the caller → 403', async () => {
    const boss = await s.createUser('boss', 'admin');
    expect((await get(coachClientPath(s.anna.id))).status).toBe(200);
    expect((await get(coachClientPath(boss.id))).status).toBe(404);

    const promote = await s.call(API.adminSetRole, {
      cookie: adminCookie,
      body: { userId: s.anna.id, role: 'admin' },
    });
    expect(promote.status).toBe(200);
    expect((await get(coachClientPath(s.anna.id))).status).toBe(404);
    const afterPromote = await json<CoachClientsResponse>(await get(coachClientsPath(WINDOW)));
    expect(afterPromote.clients.map((c) => c.client.username)).toEqual(['olya']);

    const demote = await s.call(API.adminSetRole, {
      cookie: adminCookie,
      body: { userId: boss.id, role: 'user' },
    });
    expect(demote.status).toBe(200);
    expect((await get(coachClientPath(boss.id))).status).toBe(200);
    const afterDemote = await json<CoachClientsResponse>(await get(coachClientsPath(WINDOW)));
    expect(afterDemote.clients.map((c) => c.client.username).sort()).toEqual(['boss', 'olya']);

    // The caller loses the role (another admin, anna, remains): the very next coach request is a 403.
    s.users.setRole(s.admin.id, 'user');
    for (const path of pathsFor(olya.id, olyaPhoto)) expect((await get(path)).status, path).toBe(403);
  });
});

describe('the client’s activity', () => {
  it('coach reads never touch the client’s last_seen_at', async () => {
    const lastSeen = (id: UserId) => s.users.byId(id)?.lastSeenAt;
    const before = lastSeen(s.anna.id);
    expect(before).not.toBeNull();
    s.clock.now += LAST_SEEN_EVERY_MS * 3;
    expect((await get(coachClientsPath(WINDOW))).status).toBe(200);
    expect((await get(coachClientPath(s.anna.id))).status).toBe(200);
    expect((await get(coachPhotoUrl(s.anna.id, annaPhoto))).status).toBe(200);
    expect(lastSeen(s.anna.id)).toBe(before);
    // Only the admin's own activity moved.
    expect(lastSeen(s.admin.id)).toBe(s.clock.now);
  });
});
