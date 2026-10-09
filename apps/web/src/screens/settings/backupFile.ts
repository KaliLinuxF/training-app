/**
 * Saving the JSON backup on this device.
 *
 * A plain `<a href="/api/export" download>` works in every browser except the installed iPhone
 * app: there WebKit opens the file in a viewer with no way back into the app until it is
 * force-quit (WebKit bug 290847). The installed iPhone app therefore hands the file to the share
 * sheet instead («Зберегти у Файли»), built from the data on the device.
 */
import type { AppData, ISODate } from '@legko/shared';
import { isIOS, isStandalone } from '@/lib/platform';

/** What this device offers for saving a file. Read once per screen; tests replace it. */
export interface ShareHost {
  /** Running as the installed iPhone / iPad app (home-screen icon). */
  iosApp: boolean;
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data?: ShareData) => boolean;
}

/** Seam for tests: `vi.spyOn(backupDevice, 'host')`. */
export const backupDevice = {
  host(): ShareHost {
    const nav = typeof navigator === 'undefined' ? undefined : navigator;
    return {
      iosApp: isIOS() && isStandalone(),
      share: typeof nav?.share === 'function' ? (data) => nav.share(data) : undefined,
      canShare: typeof nav?.canShare === 'function' ? (data) => nav.canShare(data) : undefined,
    };
  },
};

/**
 * - `link`        — the server's file through `<a download>` (browsers, desktop, Android)
 * - `share`       — the installed iPhone app: the file goes to the share sheet
 * - `unavailable` — the installed iPhone app on an iOS without file sharing (before iOS 15)
 */
export type BackupSaveMode = 'link' | 'share' | 'unavailable';

export function backupSaveMode(host: ShareHost): BackupSaveMode {
  if (!host.iosApp) return 'link';
  return host.share && host.canShare ? 'share' : 'unavailable';
}

/** «legko-2026-10-14.json», like the server's export. */
export function backupFileName(today: ISODate): string {
  return `legko-${today}.json`;
}

/** The same text as `GET /api/export`. */
export function backupJson(data: AppData): string {
  return JSON.stringify(data, null, 2);
}

/** JSON first; plain text in case a share target only accepts that (the name keeps `.json`). */
const FILE_TYPES = ['application/json', 'text/plain'] as const;

/** The backup as a file the share sheet accepts, or `null` when it takes none of the types. */
export function backupFile(data: AppData, today: ISODate, host: ShareHost): File | null {
  const text = backupJson(data);
  const name = backupFileName(today);
  for (const type of FILE_TYPES) {
    const file = new File([text], name, { type });
    if (host.canShare?.({ files: [file] })) return file;
  }
  return null;
}

/**
 * - `shared`    — the share sheet finished (e.g. saved to Files)
 * - `cancelled` — she closed the share sheet (or one is already open)
 * - `needs-tap` — iOS refused because the tap is too long ago (after waiting for the sync)
 * - `failed`    — anything else
 */
export type ShareOutcome = 'shared' | 'cancelled' | 'needs-tap' | 'failed';

/**
 * Opens the share sheet with `file`. `share()` is called synchronously, before anything is
 * awaited: iOS only allows it while it is still handling the tap.
 */
export function shareFile(file: File, host: ShareHost): Promise<ShareOutcome> {
  if (!host.share) return Promise.resolve('failed');
  let shared: Promise<void>;
  try {
    shared = host.share({ files: [file] });
  } catch (err) {
    return Promise.resolve(shareOutcome(err));
  }
  return shared.then(() => 'shared' as const, shareOutcome);
}

function shareOutcome(err: unknown): ShareOutcome {
  const name = typeof err === 'object' && err !== null && 'name' in err ? err.name : '';
  if (name === 'AbortError' || name === 'InvalidStateError') return 'cancelled';
  if (name === 'NotAllowedError') return 'needs-tap';
  return 'failed';
}
