import { emptyData, type AppData } from '@legko/shared';
import { cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useAuthStore } from '@/auth/auth';
import { useDataStore } from '@/store/data';
import { initialSyncState, type SyncState } from '@/store/state';
import { sessionUser } from '@/store/test-utils';
import { useUiStore } from '@/store/ui';
import { useSetupAutoOpen } from './useSetupAutoOpen';
import {
  readSetupShown,
  resetSetupShownForTests,
  SETUP_SHOWN_KEY,
  setupGateAction,
  syncSettled,
  writeSetupShown,
} from './setupGate';

vi.mock('idb-keyval', async () => (await import('@/store/test-utils')).fakeIdb());

const fresh = (): AppData => emptyData();

describe('setupGateAction', () => {
  it('opens the setup once for a brand-new account', () => {
    expect(setupGateAction(fresh(), true, false)).toBe('open');
    expect(setupGateAction(fresh(), true, true)).toBe('none');
  });

  it('waits until the data is settled', () => {
    expect(setupGateAction(fresh(), false, false)).toBe('none');
  });

  it('does nothing once onboarded', () => {
    const data = fresh();
    data.settings.onboarded = true;
    expect(setupGateAction(data, true, false)).toBe('none');
  });

  it('silently marks an account with weigh-ins or days as onboarded', () => {
    const withWeight = fresh();
    withWeight.weights = [{ date: '2026-10-05', kg: 65 }];
    expect(setupGateAction(withWeight, true, false)).toBe('mark-onboarded');
    expect(setupGateAction(withWeight, true, true)).toBe('mark-onboarded');

    const withDay = fresh();
    withDay.days['2026-10-05'] = { food: 'Борщ', kcal: null, trained: null, types: [], notes: '' };
    expect(setupGateAction(withDay, true, false)).toBe('mark-onboarded');
  });

  it('never opens by itself for an admin, nor marks the admin’s account (D23)', () => {
    expect(setupGateAction(fresh(), true, false, 'admin')).toBe('none');
    const withWeight = fresh();
    withWeight.weights = [{ date: '2026-10-05', kg: 65 }];
    expect(setupGateAction(withWeight, true, false, 'admin')).toBe('none');
    // An ordinary account still gets it.
    expect(setupGateAction(fresh(), true, false, 'user')).toBe('open');
  });
});

describe('syncSettled', () => {
  const sync = (patch: Partial<SyncState>): SyncState => ({ ...initialSyncState(), online: true, ...patch });

  it('needs loaded data plus the server copy, or no way to get it', () => {
    expect(syncSettled(sync({ loaded: false }))).toBe(false);
    expect(syncSettled(sync({ loaded: true }))).toBe(false);
    expect(syncSettled(sync({ loaded: true, lastSyncedAt: 1 }))).toBe(true);
    expect(syncSettled(sync({ loaded: true, online: false }))).toBe(true);
    expect(syncSettled(sync({ loaded: true, error: 'x' }))).toBe(true);
  });
});

describe('session flag', () => {
  afterEach(() => {
    sessionStorage.clear();
    resetSetupShownForTests();
  });

  it('is remembered in sessionStorage', () => {
    expect(readSetupShown()).toBe(false);
    writeSetupShown();
    expect(sessionStorage.getItem(SETUP_SHOWN_KEY)).toBe('1');
    expect(readSetupShown()).toBe(true);
  });

  it('still holds within the page when storage is cleared or blocked', () => {
    writeSetupShown();
    sessionStorage.clear();
    expect(readSetupShown()).toBe(true);
  });
});

describe('useSetupAutoOpen', () => {
  afterEach(() => {
    cleanup();
    sessionStorage.clear();
    resetSetupShownForTests();
    useUiStore.setState({ sheet: null });
    useAuthStore.setState({ status: 'checking', offline: false, user: null });
  });

  function settledFreshAccount(role: 'admin' | 'user') {
    useAuthStore.setState({ status: 'authed', offline: false, user: sessionUser({ role }) });
    useDataStore.setState({
      data: fresh(),
      sync: { ...initialSyncState(), loaded: true, online: true, lastSyncedAt: 1 },
    });
  }

  it('offers «Перші кроки» to a new ordinary account', () => {
    settledFreshAccount('user');
    renderHook(() => useSetupAutoOpen());
    expect(useUiStore.getState().sheet?.mode).toBe('setup');
  });

  it('leaves a new admin account alone (the Home banner still offers it)', () => {
    settledFreshAccount('admin');
    renderHook(() => useSetupAutoOpen());
    expect(useUiStore.getState().sheet).toBeNull();
    expect(readSetupShown()).toBe(false);
  });
});
