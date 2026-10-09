import { useRef, useState, type MouseEvent } from 'react';
import { api } from '@/lib/api';
import { useToday } from '@/lib/useToday';
import { flushNow, getAppData, useSyncState } from '@/store/data';
import { ui } from '@/store/ui';
import { Button } from '@/ui';
import { backupDevice, backupFile, backupSaveMode, shareFile, type ShareHost } from './backupFile';
import { BACKUP_COPY } from './model';
import s from './BackupDownload.module.css';

const ERROR_MS = 3200;
const LABEL = 'Завантажити резервну копію';

/**
 * «Завантажити резервну копію»: the server's file through a download link, or — in the installed
 * iPhone app, where a download traps the app — the share sheet («Зберегти у Файли»).
 */
export function BackupDownload() {
  // Whether this is the installed app does not change while the screen is open.
  const [host] = useState(() => backupDevice.host());
  const mode = backupSaveMode(host);
  return mode === 'link' ? <BackupLink /> : <BackupShare host={host} canShare={mode === 'share'} />;
}

function BackupLink() {
  const sync = useSyncState();
  // Set right before re-clicking the link once pending changes have been flushed.
  const flushed = useRef(false);

  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (flushed.current) {
      flushed.current = false;
      return;
    }
    if (!sync.online) {
      e.preventDefault();
      ui.flash(BACKUP_COPY.offline, ERROR_MS);
      return;
    }
    if (sync.pending === 0) return;
    // The file comes from the server: send what is still queued first so the copy is complete.
    e.preventDefault();
    const link = e.currentTarget;
    flushNow().then(
      (ok) => {
        if (!ok) {
          ui.flash(BACKUP_COPY.notSynced, ERROR_MS);
          return;
        }
        flushed.current = true;
        link.click();
      },
      () => ui.flash(BACKUP_COPY.notSynced, ERROR_MS),
    );
  };

  return (
    <a className={s.download} href={api.exportUrl} download onClick={onClick}>
      {LABEL}
    </a>
  );
}

/**
 * - `idle`      — «Завантажити резервну копію»
 * - `preparing` — sending queued changes first, so the copy is complete
 * - `ready`     — iOS refused the share sheet after that wait; the next tap opens it
 */
type ShareStep = 'idle' | 'preparing' | 'ready';

function BackupShare({ host, canShare }: { host: ShareHost; canShare: boolean }) {
  const sync = useSyncState();
  const today = useToday();
  const [step, setStep] = useState<ShareStep>('idle');
  // A change made after the copy was prepared sends the next tap through the sync again.
  const ready = step === 'ready' && sync.pending === 0;

  /** Must run inside the tap (or right after a short wait): iOS needs the user gesture. */
  const openShareSheet = () => {
    setStep('idle');
    // With nothing queued, the device copy is what the server has.
    const file = backupFile(getAppData(), today, host);
    if (!file) {
      ui.flash(BACKUP_COPY.shareFailed, ERROR_MS);
      return;
    }
    void shareFile(file, host).then((outcome) => {
      if (outcome === 'needs-tap') {
        setStep('ready');
        ui.flash(BACKUP_COPY.tapAgain, ERROR_MS);
      } else if (outcome === 'failed') {
        ui.flash(BACKUP_COPY.shareFailed, ERROR_MS);
      }
    });
  };

  const notSynced = () => {
    setStep('idle');
    ui.flash(BACKUP_COPY.notSynced, ERROR_MS);
  };

  const onClick = () => {
    if (!canShare) {
      ui.flash(BACKUP_COPY.safariOnly, ERROR_MS);
      return;
    }
    if (!sync.online) {
      ui.flash(BACKUP_COPY.offline, ERROR_MS);
      return;
    }
    if (sync.loaded && sync.pending === 0) {
      openShareSheet();
      return;
    }
    setStep('preparing');
    // Usually quick enough for iOS to still count the tap; otherwise the share asks for another one.
    flushNow().then((ok) => (ok ? openShareSheet() : notSynced()), notSynced);
  };

  return (
    <Button variant="outline" fullWidth disabled={step === 'preparing'} onClick={onClick}>
      {step === 'preparing' ? 'Готую копію…' : ready ? 'Поділитися файлом' : LABEL}
    </Button>
  );
}
