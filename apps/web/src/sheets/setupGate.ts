/**
 * When to show the first-run setup sheet by itself: once per app session, for a brand-new
 * account (not onboarded, no weigh-ins and no day records). An older account that simply
 * predates the flag is marked as onboarded silently.
 */
import type { AppData } from '@legko/shared';
import type { SyncState } from '@/store/data';

export type SetupGateAction = 'open' | 'mark-onboarded' | 'none';

/** sessionStorage key: the setup sheet was already offered in this app session. */
export const SETUP_SHOWN_KEY = 'legko.setupShown';

/**
 * Data is trustworthy enough to decide: loaded, and either the server copy arrived or the
 * server cannot be reached (offline / failing), in which case the device copy is all we have.
 */
export const syncSettled = (sync: SyncState): boolean =>
  sync.loaded && (sync.lastSyncedAt !== null || !sync.online || sync.error !== null);

export function setupGateAction(data: AppData, settled: boolean, shownThisSession: boolean): SetupGateAction {
  if (!settled || data.settings.onboarded) return 'none';
  const hasData = data.weights.length > 0 || Object.keys(data.days).length > 0;
  if (hasData) return 'mark-onboarded';
  return shownThisSession ? 'none' : 'open';
}

/** In-memory copy, so a blocked sessionStorage still means «once» within this page. */
let shownInPage = false;

export function readSetupShown(): boolean {
  if (shownInPage) return true;
  try {
    return window.sessionStorage.getItem(SETUP_SHOWN_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeSetupShown(): void {
  shownInPage = true;
  try {
    window.sessionStorage.setItem(SETUP_SHOWN_KEY, '1');
  } catch {
    // Storage blocked: the in-page flag still applies; after a reload it may be offered again.
  }
}

/** Test hook: forget the in-page flag (sessionStorage is cleared by the test itself). */
export function resetSetupShownForTests(): void {
  shownInPage = false;
}
