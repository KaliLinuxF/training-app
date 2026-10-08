import type { ReactNode } from 'react';

/**
 * Shows the login screen until there is a session, then renders the app and starts data sync.
 * Phase-0 stub: always renders the app. Implemented by the data-layer task.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  return <>{children}</>;
}
