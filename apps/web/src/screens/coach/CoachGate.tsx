import type { ReactNode } from 'react';
import { Redirect } from 'wouter';
import { useCurrentUser } from '@/auth/auth';

/**
 * «Клієнти» is for admins only (docs/coach-cabinet.md §5.1): nothing while the account is not known yet (AuthGate
 * is still deciding), home for everyone else. The server refuses the coach API to non-admins anyway (403).
 */
export function CoachGate({ children }: { children: ReactNode }) {
  const user = useCurrentUser();
  if (user === null) return null;
  if (user.role !== 'admin') return <Redirect to="/" replace />;
  return <>{children}</>;
}
