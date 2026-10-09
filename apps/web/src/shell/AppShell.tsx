import { useEffect, type ReactNode } from 'react';
import { useLocation } from 'wouter';
import { useIsDesktop } from '@/lib/platform';
import { useToday } from '@/lib/useToday';
import { SheetHost } from '@/sheets/SheetHost';
import { ui } from '@/store/ui';
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

  // Every section starts at the top, like switching tabs in a native app.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location]);

  const recordToday = () => ui.openSheet(today, 'day');

  return (
    <div className={cx(s.root, isDesktop ? s.desktop : s.mobile)}>
      {isDesktop && <Sidebar location={location} onRecord={recordToday} />}
      <main className={s.main}>{children}</main>
      {!isDesktop && <TabBar location={location} onRecord={recordToday} />}
      <Toast />
      <SyncWatcher />
      <SheetHost />
      <ConfirmHost />
    </div>
  );
}
