import { useEffect, useEffectEvent } from 'react';
import { useLocation, useSearch } from 'wouter';
import { useToday } from '@/lib/useToday';
import { ui } from '@/store/ui';
import { hasDeepLinkParams, parseSheetDeepLink, urlWithoutDeepLink } from './deepLinks';
import { replaceOpenSheet } from './useSheetGuard';

/**
 * Opens the sheet named in `?sheet=…` for today and cleans the URL. Runs on the first render and
 * whenever the query changes while mounted (the service worker navigates the running app after
 * a notification tap). An open sheet with unsaved changes asks before it is replaced.
 */
export function useSheetDeepLinks(): void {
  const search = useSearch();
  const [pathname, navigate] = useLocation();
  const today = useToday();

  const handle = useEffectEvent((query: string) => {
    if (!hasDeepLinkParams(query)) return;
    const link = parseSheetDeepLink(query);
    navigate(urlWithoutDeepLink(pathname, query), { replace: true });
    if (link) replaceOpenSheet(() => ui.openSheet(today, link.mode, link.patch));
  });

  useEffect(() => {
    handle(search);
  }, [search]);
}
