/**
 * Navigation helpers of «Клієнти» (docs/coach-cabinet.md §5.1).
 *
 * Every parameter change on `/coach` (q, sort, dir, show, days) and on `/coach/<id>` (tab, days, period, date, the
 * «Історія калорій» rows of the Прогрес tab, «Відкрити день →») replaces the entry **keeping `history.state`**:
 * wouter's `navigate(to, { replace: true })` without `state` writes `null` and would erase the `legkoFrom` stamp of
 * the list link, so «‹ Клієнти» would no longer pop back to the list with its filters.
 */
import { coachPhotoThumbUrl, coachPhotoUrl } from '@legko/shared';
import { useCallback } from 'react';
import { useLocation } from 'wouter';
import type { PhotoUrls } from '@/lib/photoUrls';

/** The list route. */
export const COACH_ROOT = '/coach';

/** `/coach/<id>` (the id is a 32-hex account id; encoded anyway). */
export const clientHref = (id: string): string => `${COACH_ROOT}/${encodeURIComponent(id)}`;

/** `(href) => navigate(href, { replace: true, state: history.state })`: a param change that keeps the back stamp. */
export function useReplaceParams(): (href: string) => void {
  const [, navigate] = useLocation();
  return useCallback(
    (href: string) => navigate(href, { replace: true, state: window.history.state as unknown }),
    [navigate],
  );
}

/** A client's photos through the admin-scoped coach route (never `/api/photos/…`). */
export function coachPhotoUrls(clientId: string): PhotoUrls {
  return Object.freeze({
    thumb: (photoId: string) => coachPhotoThumbUrl(clientId, photoId),
    full: (photoId: string) => coachPhotoUrl(clientId, photoId),
  });
}
