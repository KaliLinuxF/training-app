import { useRef, useState, type ChangeEvent } from 'react';
import { dataActions, useSyncState } from '@/store/data';
import { ui } from '@/store/ui';
import { Button, Card } from '@/ui';
import { BackupDownload } from './BackupDownload';
import { BACKUP_COPY, BACKUP_MAX_BYTES, errorText, parseBackup, RESTORE_CONFIRM, syncStatus } from './model';
import { SyncDot } from './SyncDot';
import s from './DataCard.module.css';

const ERROR_MS = 3200;

/** «Дані» (Налаштування → Дані і копія): sync status, JSON backup download and restore. */
export function DataCard() {
  const sync = useSyncState();
  const status = syncStatus(sync);
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);

  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const input = e.currentTarget;
    const file = input.files?.[0];
    // Allow picking the same file again later.
    input.value = '';
    if (file) void restore(file);
  };

  const restore = async (file: File) => {
    if (file.size > BACKUP_MAX_BYTES) {
      ui.flash(BACKUP_COPY.tooLarge, ERROR_MS);
      return;
    }
    const data = parseBackup(await readText(file).catch(() => ''));
    if (!data) {
      ui.flash(BACKUP_COPY.invalid, ERROR_MS);
      return;
    }
    if (!(await ui.confirm(RESTORE_CONFIRM))) return;
    setRestoring(true);
    try {
      await dataActions.importAll(data);
      ui.flash(BACKUP_COPY.restored);
    } catch (err) {
      ui.flash(errorText(err, BACKUP_COPY.restoreFailed), ERROR_MS);
    } finally {
      setRestoring(false);
    }
  };

  return (
    <Card as="section" aria-label="Дані">
      <p className={s.status} aria-live="polite">
        <SyncDot tone={status.tone} />
        {status.text}
      </p>
      <div className={s.actions}>
        <BackupDownload />
        <Button variant="outline" fullWidth disabled={restoring} onClick={() => fileRef.current?.click()}>
          {restoring ? 'Відновлюю…' : 'Відновити з копії'}
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          className={s.file}
          tabIndex={-1}
          aria-hidden="true"
          onChange={onFile}
        />
      </div>
      <p className={s.note}>Фото їжі зберігаються на сервері й не входять у файл копії</p>
    </Card>
  );
}

function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error ?? new Error('read failed'));
    reader.readAsText(file);
  });
}
