import { coachWindowSchema, photoIdSchema } from '@legko/shared';
import type { Context, Hono } from 'hono';
import { NotCoach, type CoachAccess } from '../../coach/access';
import type { PhotoVariant } from '../../photos/store';
import { apiError, badRequest, MESSAGES } from '../errors';
import { currentUser, type AppEnv } from '../types';
import type { RouteDeps } from './deps';

/**
 * «Клієнти»: the admin reads every role-'user' account's records, READ ONLY (docs/coach-cabinet.md §2.5, §3.2).
 * Every route is `app.get` behind `auth` + `admin`; nothing here can write (coach lint + the route-table test).
 * Hono serves HEAD through these GET routes: the handlers answer it with 405 before reading or logging anything.
 */
export const COACH_ROUTES = {
  clients: '/api/coach/clients',
  client: '/api/coach/clients/:id',
  photo: '/api/coach/clients/:id/photos/:photoId',
  thumb: '/api/coach/clients/:id/photos/:photoId/thumb',
} as const;

/** Another person's records: never kept by the browser or any cache (C9). */
export const COACH_CACHE_CONTROL = 'private, no-store';

type Handler = (c: Context<AppEnv>) => Promise<Response> | Response;

const privateNoStore = (c: Context<AppEnv>): void => {
  c.header('Cache-Control', COACH_CACHE_CONTROL);
};

/**
 * The common frame: `private, no-store` on every answer (set before the response is built), HEAD → 405 with
 * `Allow: GET` (nothing read, nothing logged), NotCoach → 403.
 */
const coachHandler =
  (handle: Handler): Handler =>
  async (c) => {
    privateNoStore(c);
    if (c.req.method === 'HEAD') {
      c.header('Allow', 'GET');
      return c.body(null, 405);
    }
    try {
      return await handle(c);
    } catch (err) {
      if (err instanceof NotCoach) return apiError(c, 403, 'forbidden', MESSAGES.forbidden);
      throw err;
    }
  };

export function registerCoachRoutes(
  app: Hono<AppEnv>,
  deps: Pick<RouteDeps, 'auth' | 'admin'>,
  coach: CoachAccess,
): void {
  const { auth, admin } = deps;

  const list = coachHandler((c) => {
    const window = coachWindowSchema.safeParse({ from: c.req.query('from'), to: c.req.query('to') });
    if (!window.success) return badRequest(c, MESSAGES.badWindow);
    const clients = coach.list(currentUser(c), window.data);
    return c.json({ from: window.data.from, to: window.data.to, clients });
  });

  const detail = coachHandler((c) => {
    const found = coach.detail(currentUser(c), c.req.param('id') ?? '');
    if (!found) return apiError(c, 404, 'not_found', MESSAGES.notFound);
    return c.json(found);
  });

  const photo = (variant: PhotoVariant): Handler =>
    coachHandler(async (c) => {
      const photoId = photoIdSchema.safeParse(c.req.param('photoId'));
      if (!photoId.success) return badRequest(c, MESSAGES.badPhotoId);
      const bytes = await coach.photo(currentUser(c), c.req.param('id') ?? '', photoId.data, variant);
      if (bytes === null || bytes === 'no_client') return apiError(c, 404, 'not_found', MESSAGES.notFound);
      c.header('Content-Type', 'image/jpeg');
      c.header('Vary', 'Cookie');
      c.header('X-Content-Type-Options', 'nosniff');
      return c.body(bytes);
    });

  app.get(COACH_ROUTES.clients, auth, admin, list);
  app.get(COACH_ROUTES.client, auth, admin, detail);
  app.get(COACH_ROUTES.photo, auth, admin, photo('full'));
  app.get(COACH_ROUTES.thumb, auth, admin, photo('thumb'));
}
