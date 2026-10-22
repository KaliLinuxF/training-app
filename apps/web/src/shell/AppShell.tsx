import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useCurrentUser } from '@/auth/auth';
import { useIsDesktop } from '@/lib/platform';
import { useToday } from '@/lib/useToday';
import { SheetHost } from '@/sheets/SheetHost';
import { ui, useSheet } from '@/store/ui';
import { ConfirmHost, cx, Toast } from '@/ui';
import { isWidePage, navItems } from './nav';
import { Sidebar } from './Sidebar';
import { SyncWatcher } from './SyncWatcher';
import { TabBar } from './TabBar';
import s from './AppShell.module.css';

/**
 * Page chrome: mobile column + floating tab bar, or desktop container + sidebar;
 * plus the toast and the sheet host. Screens render inside <main>. An admin also gets «Клієнти» in the navigation
 * (`navItems`), and the coach pages (`/coach`, `/coach/<id>`) use a wider desktop container (up to 1440px).
 */
export function AppShell({ children }: { children: ReactNode }) {
  const isDesktop = useIsDesktop();
  const [location] = useLocation();
  const isAdmin = useCurrentUser()?.role === 'admin';
  const today = useToday();
  const recordOpen = useSheet()?.mode === 'menu';

  // Every section starts at the top, like switching tabs in a native app.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  // Phone shell: <html data-shell="phone"> gives the page its scroll-padding (AppShell.module.css), so keyboard
  // focus and scrollIntoView stop above the floating tab bar instead of under it. Desktop keeps the default.
  useEffect(() => {
    if (isDesktop) return;
    const root = document.documentElement;
    root.dataset.shell = 'phone';
    return () => {
      delete root.dataset.shell;
    };
  }, [isDesktop]);

  // «+» / «+ Записати день»: «Що записати?» for today (its rows swap the same sheet to the short forms). Not on the
  // coach's read-only pages: next to a client's name it would read as «record into this client's day», while it
  // writes into the admin's own diary.
  const coachPage = isWidePage(location);
  const openRecord = coachPage ? undefined : () => ui.openSheet(today, 'menu');

  return (
    <div className={cx(s.root, isDesktop ? s.desktop : s.mobile, isDesktop && coachPage && s.wide)}>
      {isDesktop && (
        <Sidebar
          location={location}
          items={navItems(isAdmin, 'sidebar')}
          onRecord={openRecord}
          recordOpen={recordOpen}
        />
      )}
      <main className={s.main}>{children}</main>
      {!isDesktop && (
        <TabBar
          location={location}
          items={navItems(isAdmin, 'tabbar')}
          onRecord={openRecord}
          recordOpen={recordOpen}
        />
      )}
      <Toast />
      <SyncWatcher />
      <SheetHost />
      <ConfirmHost />
    </div>
  );
}
