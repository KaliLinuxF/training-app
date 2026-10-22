import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AppRoutes } from '@/App';
import { useAuthStore } from '@/auth/auth';
import { api } from '@/lib/api';
import type { PushStatus } from '@/lib/push';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { sampleData, sessionUser, settle } from '@/store/test-utils';
import { installMatchMedia } from '@/ui/internal/testing';
import { resetAdminOverview } from './users/adminOverview';

const mocks = vi.hoisted(() => ({
  push: {
    getPushStatus: vi.fn<() => Promise<PushStatus>>(),
    enablePush: vi.fn<() => Promise<PushStatus>>(),
    disablePush: vi.fn<() => Promise<void>>(),
    sendTestPush: vi.fn<() => Promise<number>>(),
    syncPushSubscription: vi.fn<() => Promise<void>>(),
  },
}));

vi.mock('@/lib/push', () => mocks.push);
vi.mock('idb-keyval', async () => (await import('@/store/test-utils')).fakeIdb());

async function renderAt(path: string) {
  const memory = memoryLocation({ path, record: true });
  render(
    <Router hook={memory.hook}>
      <AppRoutes />
    </Router>,
  );
  await act(settle);
  return memory;
}

beforeEach(() => {
  installMatchMedia();
  mocks.push.getPushStatus.mockReset().mockResolvedValue('enabled');
  useDataStore.setState({ data: sampleData(), sync: { ...initialSyncState(), loaded: true, online: true } });
  useAuthStore.setState({ status: 'authed', offline: false, user: sessionUser() });
  resetAdminOverview();
  // Nothing in these tests may reach the network.
  vi.spyOn(api, 'foodStatus').mockReturnValue(new Promise(() => undefined));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('settings routes (App.tsx)', () => {
  it('renders the list at /settings and a section at /settings/:section', async () => {
    await renderAt('/settings');
    expect(screen.getByRole('navigation', { name: 'Розділи налаштувань' })).toBeTruthy();
    cleanup();
    await renderAt('/settings/goals');
    expect(screen.getByRole('heading', { level: 1, name: 'Цілі' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Цілі: білки, жири, вуглеводи' })).toBeTruthy();
  });

  it('renders «Прийоми їжі» at /settings/meals', async () => {
    const memory = await renderAt('/settings/meals');
    expect(memory.history).toEqual(['/settings/meals']);
    expect(screen.getByRole('heading', { level: 1, name: 'Прийоми їжі' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Мої прийоми їжі' })).toBeTruthy();
  });

  it('still sends unknown sections back to the list', async () => {
    for (const path of ['/settings/Meals', '/settings/food', '/settings/meal']) {
      const memory = await renderAt(path);
      expect(memory.history, path).toEqual(['/settings']);
      expect(screen.getByRole('navigation', { name: 'Розділи налаштувань' })).toBeTruthy();
      cleanup();
    }
  });

  it('renders «Акаунт» at /settings/account for everyone', async () => {
    const memory = await renderAt('/settings/account');
    expect(memory.history).toEqual(['/settings/account']);
    expect(screen.getByRole('heading', { level: 1, name: 'Акаунт' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Профіль' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Вийти' })).toBeTruthy();
  });

  it('sends a user (and a device whose account is not known yet) from /settings/users back to the list', async () => {
    const overview = vi.spyOn(api.admin, 'overview');
    for (const user of [sessionUser({ role: 'user' }), null]) {
      useAuthStore.setState({ user });
      const memory = await renderAt('/settings/users');
      expect(memory.history, String(user?.role)).toEqual(['/settings']);
      expect(screen.getByRole('navigation', { name: 'Розділи налаштувань' })).toBeTruthy();
      expect(screen.queryByRole('link', { name: /^Користувачі/ })).toBeNull();
      cleanup();
    }
    expect(overview).not.toHaveBeenCalled();
  });

  it('opens /settings/users for an admin', async () => {
    useAuthStore.setState({ user: sessionUser({ username: 'admin', role: 'admin' }) });
    const overview = vi.spyOn(api.admin, 'overview').mockReturnValue(new Promise(() => undefined));
    const memory = await renderAt('/settings/users');
    expect(memory.history).toEqual(['/settings/users']);
    expect(screen.getByRole('heading', { level: 1, name: 'Користувачі' })).toBeTruthy();
    expect(screen.getByRole('region', { name: 'Запросити людину' })).toBeTruthy();
    expect(overview).toHaveBeenCalledTimes(1);
  });

  it('redirects the old /reminders (bookmarks, delivered test notifications) to /settings/reminders', async () => {
    for (const path of ['/reminders', '/reminders/']) {
      const memory = await renderAt(path);
      expect(memory.history, path).toEqual(['/settings/reminders']);
      expect(screen.getByRole('region', { name: 'Сповіщення на телефон' })).toBeTruthy();
      cleanup();
    }
  });
});
