import { useId, useRef, useState, type ChangeEvent, type MouseEvent } from 'react';
import { api } from '@/lib/api';
import { dataActions, flushNow, useSyncState } from '@/store/data';
import { ui } from '@/store/ui';
import { Button, Card, CardHeader, cx } from '@/ui';
import { BACKUP_COPY, BACKUP_MAX_BYTES, errorText, parseBackup, syncStatus } from './model';
import s from './DataCard.module.css';

const ERROR_MS = 3200;

/** «Дані»: sync status, JSON backup download and restore. */
export function DataCard() {
  const titleId = useId();
  const sync = useSyncState();
  const status = syncStatus(sync);
  const fileRef = useRef<HTMLInputElement>(null);
  const [restoring, setRestoring] = useState(false);
  // Set right before re-clicking the link once pending changes have been flushed.
  const flushed = useRef(false);

  const onDownload = (e: MouseEvent<HTMLAnchorElement>) => {
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
    if (!window.confirm(BACKUP_COPY.confirm)) return;
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
    <Card as="section" aria-labelledby={titleId}>
      <CardHeader
        size="sm"
        title="Дані"
        titleId={titleId}
        subtitle={
          <span className={s.status}>
            <span className={cx(s.dot, s[status.tone])} aria-hidden="true" />
            {status.text}
          </span>
        }
      />
      <div className={s.actions}>
        <a className={s.download} href={api.exportUrl} download onClick={onDownload}>
          Завантажити резервну копію
        </a>
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
