import { photoThumbUrl, photoUrl } from '@legko/shared';
import { createContext, useContext, type ReactNode } from 'react';

/** Where the food photos of the records on screen are served from. */
export interface PhotoUrls {
  /** Small cached preview (strip, viewer placeholder). */
  thumb(id: string): string;
  /** The full photo (viewer). */
  full(id: string): string;
}

/** Her own photos (`/api/photos/<id>[/thumb]`): the default everywhere in the client app. */
export const OWN_PHOTO_URLS: PhotoUrls = Object.freeze({ thumb: photoThumbUrl, full: photoUrl });

const PhotoUrlsContext = createContext<PhotoUrls>(OWN_PHOTO_URLS);

/**
 * Serves the photos of the subtree from elsewhere (the coach's read-only view of a client uses the admin-scoped
 * photo route). Pass a stable `value` (module constant or memoized) so the photo components do not re-render.
 */
export function PhotoUrlsProvider({ value, children }: { value: PhotoUrls; children: ReactNode }) {
  return <PhotoUrlsContext value={value}>{children}</PhotoUrlsContext>;
}

/** Photo URLs of the nearest provider, `OWN_PHOTO_URLS` without one. */
export function usePhotoUrls(): PhotoUrls {
  return useContext(PhotoUrlsContext);
}
