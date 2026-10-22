import { photoIdSchema } from '@legko/shared';
import type { Context, Hono } from 'hono';
import type { PhotoVariant } from '../../photos/store';
import { apiError, badRequest, MESSAGES } from '../errors';
import { currentUser, type AppEnv } from '../types';
import type { RouteDeps } from './deps';

/** Same paths as `photoUrl()` / `photoThumbUrl()` in @legko/shared. */
export const PHOTO_ROUTES = { full: '/api/photos/:id', thumb: '/api/photos/:id/thumb' } as const;

/** Photos never change once stored (new photo = new id); `private` keeps them out of shared caches. */
export const PHOTO_CACHE_CONTROL = 'private, max-age=31536000, immutable';

/**
 * The browser keeps a photo only for the session cookie that fetched it: after a logout or a switch to another account
 * on the same device the request reaches the server again and passes the owner check (another account's photo is a
 * 404), while the same session still sees its photos offline. No `ETag` / `Last-Modified` on purpose: a browser
 * that revalidates on a cookie mismatch then sends a full request, never a conditional one a 304 could answer.
 */
export const PHOTO_VARY = 'Cookie';

export function registerPhotoRoutes(app: Hono<AppEnv>, { auth, photos }: RouteDeps): void {
  const serve = (variant: PhotoVariant) => async (c: Context<AppEnv>) => {
    const id = photoIdSchema.safeParse(c.req.param('id'));
    if (!id.success) return badRequest(c, MESSAGES.badPhotoId);
    // Another user's photo reads as missing: same 404, no existence oracle (D13).
    const bytes = await photos.forUser(currentUser(c).id).read(id.data, variant);
    if (!bytes) return apiError(c, 404, 'not_found', MESSAGES.notFound);
    c.header('Content-Type', 'image/jpeg');
    c.header('Cache-Control', PHOTO_CACHE_CONTROL);
    c.header('Vary', PHOTO_VARY);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(bytes);
  };

  app.get(PHOTO_ROUTES.full, auth, serve('full'));
  app.get(PHOTO_ROUTES.thumb, auth, serve('thumb'));
}
