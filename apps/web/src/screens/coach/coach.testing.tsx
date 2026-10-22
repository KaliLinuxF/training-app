/** Render helpers of the «Клієнти» component tests (imported by `*.test.tsx` only). */
import type { CoachClientResponse, CoachClientsResponse } from '@legko/shared';
import { act, render } from '@testing-library/react';
import type { ReactNode } from 'react';
import { Router } from 'wouter';
import { vi } from 'vitest';
import { useAuthStore } from '@/auth/auth';
import { api } from '@/lib/api';
import { DESKTOP_QUERY } from '@/lib/platform';
import { installMatchMedia } from '@/ui/internal/testing';
import { account, NOW } from './coach.fixtures';

/** Signs in an admin / a user (null = the account is not known yet). */
export function signIn(role: 'admin' | 'user' | null): void {
  useAuthStore.setState({ status: role ? 'authed' : 'checking', offline: false, user: role ? account(role) : null });
}

/** The browser clock at the fixtures' NOW (only `Date`: promises and timers stay real). */
export function freezeClock(now: Date = NOW): void {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now);
}

export function desktop(on: boolean): void {
  installMatchMedia(on ? (query) => query === DESKTOP_QUERY : () => false);
}

/** Puts the browser at `path` with `state` (the entry the page is opened on). */
export function at(path: string, state: unknown = null): void {
  window.history.replaceState(state, '', path);
}

/** Renders `ui` under wouter's browser location (jsdom's real `history`). */
export function renderPage(ui: ReactNode) {
  return render(<Router>{ui}</Router>);
}

/** Lets the mocked requests answer and React commit. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

export const mockClients = (payload: CoachClientsResponse) =>
  vi.spyOn(api.coach, 'clients').mockResolvedValue(payload);

export const mockClient = (payload: CoachClientResponse) =>
  vi.spyOn(api.coach, 'client').mockResolvedValue(payload);

export const location = (): string => `${window.location.pathname}${window.location.search}`;
