import { existsSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, join } from 'node:path';
import { DEFAULT_TIMEZONE, minutesOf, zonedNow, type HM, type ISODate } from '@legko/shared';
import type { Database } from './db/sqlite';
import { silentLogger, type Logger } from './logger';

export const BACKUP_KEEP = 30;
export const BACKUP_TIME: HM = '03:30';
/** Backups follow Kyiv time (where the user lives), independent of `settings.timezone`. */
export const BACKUP_TIMEZONE = DEFAULT_TIMEZONE;

const BACKUP_RE = /^legko-\d{4}-\d{2}-\d{2}\.db$/;

export const backupFileName = (date: ISODate): string => `legko-${date}.db`;

export const backupsDir = (dataDir: string): string => join(dataDir, 'backups');

/** Consistent snapshot via `VACUUM INTO`; replaces an existing file for the same date atomically. */
export function writeBackup(db: Database, dir: string, date: ISODate): string {
  mkdirSync(dir, { recursive: true });
  const target = join(dir, backupFileName(date));
  const tmp = `${target}.tmp`;
  rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  renameSync(tmp, target);
  return target;
}

/** Deletes all but the newest `keep` backups (and stray temp files). Returns deleted file names. */
export function pruneBackups(dir: string, keep: number = BACKUP_KEEP): string[] {
  if (!existsSync(dir)) return [];
  const names = readdirSync(dir);
  for (const name of names) if (name.endsWith('.db.tmp')) rmSync(join(dir, name), { force: true });
  const backups = names
    .filter((n) => BACKUP_RE.test(n))
    .sort()
    .reverse();
  const removed = backups.slice(keep);
  for (const name of removed) rmSync(join(dir, name), { force: true });
  return removed;
}

export interface BackupJob {
  /** Backs up when today's file is missing. */
  atStartup(now: Date): void;
  /** Called by the scheduler: backs up once a day at ~03:30 Kyiv time. */
  tick(now: Date): void;
}

export interface BackupJobOptions {
  db: Database;
  dir: string;
  logger?: Logger;
  keep?: number;
  time?: HM;
  timeZone?: string;
}

export function createBackupJob({
  db,
  dir,
  logger = silentLogger,
  keep = BACKUP_KEEP,
  time = BACKUP_TIME,
  timeZone = BACKUP_TIMEZONE,
}: BackupJobOptions): BackupJob {
  const slot = minutesOf(time);
  let lastScheduled: ISODate | null = null;

  const run = (date: ISODate, reason: string): void => {
    try {
      const file = writeBackup(db, dir, date);
      const removed = pruneBackups(dir, keep);
      logger.info(
        `backup (${reason}): ${basename(file)}${removed.length ? `, pruned ${removed.length}` : ''}`,
      );
    } catch (err) {
      logger.error('backup failed', err);
    }
  };

  return {
    atStartup(now) {
      const z = zonedNow(timeZone, now);
      if (!existsSync(join(dir, backupFileName(z.date)))) run(z.date, 'start-up');
      // Started after today's slot: the existing/new file stands in for today's scheduled run.
      if (z.minutes >= slot) lastScheduled = z.date;
    },
    tick(now) {
      const z = zonedNow(timeZone, now);
      if (z.minutes < slot || lastScheduled === z.date) return;
      lastScheduled = z.date;
      run(z.date, 'daily');
    },
  };
}
