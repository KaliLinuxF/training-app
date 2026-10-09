import { emptyData, type AppData } from '@legko/shared';
import { afterEach, describe, expect, it } from 'vitest';
import { initialSyncState, type SyncState } from '@/store/state';
import {
  readSetupShown,
  resetSetupShownForTests,
  SETUP_SHOWN_KEY,
  setupGateAction,
  syncSettled,
  writeSetupShown,
} from './setupGate';

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
