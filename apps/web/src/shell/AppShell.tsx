import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useIsDesktop } from '@/lib/platform';
import { useToday } from '@/lib/useToday';
import { SheetHost } from '@/sheets/SheetHost';
import { ui, useSheet } from '@/store/ui';
import { ConfirmHost, cx, Toast } from '@/ui';
import { Sidebar } from './Sidebar';
import { SyncWatcher } from './SyncWatcher';
import { TabBar } from './TabBar';
import s from './AppShell.module.css';

/**
 * Page chrome: mobile column + floating tab bar, or desktop container + sidebar;
 * plus the toast and the sheet host. Screens render inside <main>.
 */
export function AppShell({ children }: { children: ReactNode }) {
  const isDesktop = useIsDesktop();
  const [location] = useLocation();
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

  // «+» / «+ Записати день»: «Що записати?» for today (its rows swap the same sheet to the short forms).
  const openRecord = () => ui.openSheet(today, 'menu');

  return (
    <div className={cx(s.root, isDesktop ? s.desktop : s.mobile)}>
      {isDesktop && <Sidebar location={location} onRecord={openRecord} recordOpen={recordOpen} />}
      <main className={s.main}>{children}</main>
      {!isDesktop && <TabBar location={location} onRecord={openRecord} recordOpen={recordOpen} />}
      <Toast />
      <SyncWatcher />
      <SheetHost />
      <ConfirmHost />
    </div>
  );
}
