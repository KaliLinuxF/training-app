import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';
import { AppRoutes } from '@/App';
import type { PushStatus } from '@/lib/push';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { sampleData, settle } from '@/store/test-utils';
import { installMatchMedia } from '@/ui/internal/testing';

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
