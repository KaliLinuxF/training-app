import { photoIdSchema } from '@legko/shared';
import type { Context, Hono } from 'hono';
import type { PhotoVariant } from '../../photos/store';
import { apiError, badRequest, MESSAGES } from '../errors';
import type { AppEnv } from '../types';
import type { RouteDeps } from './deps';

/** Same paths as `photoUrl()` / `photoThumbUrl()` in @legko/shared. */
export const PHOTO_ROUTES = { full: '/api/photos/:id', thumb: '/api/photos/:id/thumb' } as const;

/** Photos never change once stored (new photo = new id); `private` keeps them out of shared caches. */
export const PHOTO_CACHE_CONTROL = 'private, max-age=31536000, immutable';

export function registerPhotoRoutes(app: Hono<AppEnv>, { auth, photos }: RouteDeps): void {
  const serve = (variant: PhotoVariant) => async (c: Context<AppEnv>) => {
    const id = photoIdSchema.safeParse(c.req.param('id'));
    if (!id.success) return badRequest(c, MESSAGES.badPhotoId);
    const bytes = await photos.read(id.data, variant);
    if (!bytes) return apiError(c, 404, 'not_found', MESSAGES.notFound);
    c.header('Content-Type', 'image/jpeg');
    c.header('Cache-Control', PHOTO_CACHE_CONTROL);
    c.header('X-Content-Type-Options', 'nosniff');
    return c.body(bytes);
  };

  app.get(PHOTO_ROUTES.full, auth, serve('full'));
  app.get(PHOTO_ROUTES.thumb, auth, serve('thumb'));
}
