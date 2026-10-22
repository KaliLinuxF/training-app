import { existsSync, linkSync, mkdirSync, readdirSync, renameSync, rmSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
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

/**
 * Snapshot taken by `openDatabase` right before it migrates an existing database to schema `target`
 * (`legko-pre-v3-2026-10-15.db`). Not matched by the daily pattern, so `pruneBackups` never deletes it. Written once
 * (`writeSnapshotOnce`): a second migration on the same date keeps it and writes `…-2.db`.
 */
export const preMigrationBackupName = (target: number, date: ISODate): string =>
  `legko-pre-v${target}-${date}.db`;

/**
 * Snapshot taken by `downgrade-schema` before it lowers schema `from` (`legko-pre-down-v3-2026-10-15.db`); like the
 * pre-migration snapshot it is never replaced (a second same-day downgrade writes `…-2.db`).
 */
export const preDowngradeBackupName = (from: number, date: ISODate): string =>
  `legko-pre-down-v${from}-${date}.db`;

/** Consistent snapshot of `db` into `file` via `VACUUM INTO` (tmp + rename: atomic, replaces an older file). */
export function writeSnapshot(db: Database, file: string): string {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  renameSync(tmp, file);
  return file;
}

/**
 * The `n`-th copy's name for a snapshot `file`: the file itself for 1, then `legko-pre-v4-2026-10-22-2.db`, `-3.db`, …
 * (never matched by the daily pattern, so `pruneBackups` keeps them too).
 */
export const numberedSnapshotName = (file: string, n: number): string =>
  n <= 1 ? file : file.replace(/(\.db)?$/, `-${n}$1`);

const MAX_SNAPSHOT_COPIES = 1000;

const errorCode = (err: unknown): string | undefined =>
  err instanceof Error && 'code' in err && typeof err.code === 'string' ? err.code : undefined;

/**
 * Like `writeSnapshot`, but NEVER replaces an existing file: the pre-migration and pre-downgrade snapshots are rollback
 * sources, so the first copy of a day must survive a second migration or downgrade on the same Kyiv date. When `file`
 * exists the copy goes to the first free `numberedSnapshotName(file, 2…)`. The copy is written to a temp file and then
 * hard-linked into place (a link fails instead of replacing); where hard links are not supported, the free name is
 * taken with a rename. Returns the path written.
 */
export function writeSnapshotOnce(db: Database, file: string): string {
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  rmSync(tmp, { force: true });
  db.prepare('VACUUM INTO ?').run(tmp);
  try {
    for (let n = 1; n <= MAX_SNAPSHOT_COPIES; n++) {
      const target = numberedSnapshotName(file, n);
      if (existsSync(target)) continue;
      try {
        linkSync(tmp, target);
        return target;
      } catch (err) {
        if (errorCode(err) === 'EEXIST') continue;
        renameSync(tmp, target);
        return target;
      }
    }
    throw new Error(`${MAX_SNAPSHOT_COPIES} snapshots named like ${basename(file)} already exist`);
  } finally {
    rmSync(tmp, { force: true });
  }
}

/** Consistent snapshot via `VACUUM INTO`; replaces an existing file for the same date atomically. */
export function writeBackup(db: Database, dir: string, date: ISODate): string {
  return writeSnapshot(db, join(dir, backupFileName(date)));
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
