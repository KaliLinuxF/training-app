import type { ReactNode } from 'react';
import { SheetHost } from '@/sheets/SheetHost';

/**
 * Page chrome: mobile tab bar / desktop sidebar, main column, sheet host, toast.
 * Phase-0 stub. Implemented by the UI-kit task.
 */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <>
      <main>{children}</main>
      <SheetHost />
    </>
  );
}
