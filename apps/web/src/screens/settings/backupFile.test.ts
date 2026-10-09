import { emptyData } from '@legko/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sampleData } from '@/store/test-utils';
import { installMatchMedia } from '@/ui/internal/testing';
import {
  backupDevice,
  backupFile,
  backupFileName,
  backupJson,
  backupSaveMode,
  shareFile,
  type ShareHost,
} from './backupFile';
import { parseBackup } from './model';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

const host = (patch: Partial<ShareHost> = {}): ShareHost => ({
  iosApp: true,
  share: vi.fn<(data: ShareData) => Promise<void>>().mockResolvedValue(undefined),
  canShare: vi.fn<(data?: ShareData) => boolean>().mockReturnValue(true),
  ...patch,
});

const named = (name: string) => Object.assign(new Error(name), { name });

function readFile(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
  delete (navigator as Navigator & { standalone?: boolean }).standalone;
});

describe('backupSaveMode', () => {
  it('keeps the download link everywhere but the installed iPhone app', () => {
    expect(backupSaveMode({ iosApp: false })).toBe('link');
    expect(backupSaveMode(host({ iosApp: false }))).toBe('link');
  });

  it('uses the share sheet in the installed iPhone app, when it can share files', () => {
    expect(backupSaveMode(host())).toBe('share');
    expect(backupSaveMode({ iosApp: true })).toBe('unavailable');
    expect(backupSaveMode(host({ canShare: undefined }))).toBe('unavailable');
  });
});

describe('the backup file', () => {
  it('is named like the server export', () => {
    expect(backupFileName('2026-10-14')).toBe('legko-2026-10-14.json');
  });

  it('holds the same JSON as the server export, which restores again', () => {
    const data = sampleData({ weights: [{ date: '2026-10-05', kg: 65.4 }] });
    const text = backupJson(data);
    expect(text).toBe(JSON.stringify(data, null, 2));
    expect(parseBackup(text)).toEqual(data);
  });

  it('is JSON when the share sheet takes it', async () => {
    const h = host();
    const file = backupFile(emptyData(), '2026-10-14', h);
    expect(file?.name).toBe('legko-2026-10-14.json');
    expect(file?.type).toBe('application/json');
    expect(h.canShare).toHaveBeenCalledWith({ files: [file] });
    expect(parseBackup(await readFile(file as File))).toEqual(emptyData());
  });

  it('falls back to plain text, keeping the .json name, and gives up when nothing is accepted', () => {
    const textOnly = host({ canShare: (data) => data?.files?.[0]?.type === 'text/plain' });
    const file = backupFile(emptyData(), '2026-10-14', textOnly);
    expect(file?.type).toBe('text/plain');
    expect(file?.name).toBe('legko-2026-10-14.json');
    expect(backupFile(emptyData(), '2026-10-14', host({ canShare: () => false }))).toBeNull();
  });
});

describe('shareFile', () => {
  const file = new File(['{}'], 'legko-2026-10-14.json', { type: 'application/json' });

  it('opens the share sheet synchronously, inside the tap', async () => {
    const h = host();
    const outcome = shareFile(file, h);
    expect(h.share).toHaveBeenCalledWith({ files: [file] });
    await expect(outcome).resolves.toBe('shared');
  });

  it('tells a cancelled sheet, a stale tap and a failure apart', async () => {
    const rejecting = (err: unknown) => host({ share: () => Promise.reject(err) });
    await expect(shareFile(file, rejecting(named('AbortError')))).resolves.toBe('cancelled');
    await expect(shareFile(file, rejecting(new DOMException('busy', 'InvalidStateError')))).resolves.toBe(
      'cancelled',
    );
    await expect(shareFile(file, rejecting(new DOMException('no gesture', 'NotAllowedError')))).resolves.toBe(
      'needs-tap',
    );
    await expect(shareFile(file, rejecting(new TypeError('bad data')))).resolves.toBe('failed');
    await expect(shareFile(file, rejecting('weird'))).resolves.toBe('failed');
  });

  it('survives a share() that throws instead of rejecting, or is missing', async () => {
    const throwing = host({
      share: () => {
        throw named('NotAllowedError');
      },
    });
    await expect(shareFile(file, throwing)).resolves.toBe('needs-tap');
    await expect(shareFile(file, { iosApp: true })).resolves.toBe('failed');
  });
});

describe('backupDevice.host', () => {
  it('is not the iPhone app in a desktop browser without Web Share', () => {
    installMatchMedia();
    const h = backupDevice.host();
    expect(h.iosApp).toBe(false);
    expect(backupSaveMode(h)).toBe('link');
  });

  it('detects the installed iPhone app and calls the browser share API on navigator', async () => {
    installMatchMedia();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    Object.defineProperty(navigator, 'standalone', { value: true, configurable: true });
    const calls: unknown[] = [];
    const share = vi.fn(function (this: unknown) {
      calls.push(this);
      return Promise.resolve();
    });
    const canShare = vi.fn(() => true);
    Object.assign(navigator, { share, canShare });
    try {
      const h = backupDevice.host();
      expect(h.iosApp).toBe(true);
      expect(backupSaveMode(h)).toBe('share');
      const file = backupFile(emptyData(), '2026-10-14', h);
      expect(canShare).toHaveBeenCalledTimes(1);
      await expect(shareFile(file as File, h)).resolves.toBe('shared');
      expect(calls).toEqual([navigator]);
    } finally {
      Reflect.deleteProperty(navigator, 'share');
      Reflect.deleteProperty(navigator, 'canShare');
    }
  });

  it('is still the iPhone browser (not the app) in a Safari tab', () => {
    installMatchMedia();
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue(IPHONE_UA);
    expect(backupDevice.host().iosApp).toBe(false);
  });
});
