import { existsSync, mkdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { zonedNow } from '@legko/shared';
import { BACKUP_TIMEZONE, backupsDir, preMigrationBackupName, writeSnapshotOnce } from '../backup';
import { silentLogger, type Logger } from '../logger';
import { migrate, MIGRATIONS, schemaVersion } from './migrations';
import { sqlite, type Database } from './sqlite';

export const DB_FILE_NAME = 'legko.db';

export const databasePath = (dataDir: string): string => join(dataDir, DB_FILE_NAME);

export interface OpenDatabaseOptions {
  /** Clock for the pre-migration snapshot's file name (Kyiv date, like the daily backups). */
  now?: () => Date;
  logger?: Logger;
}

/**
 * Before an existing file database is migrated, keeps a copy of it as it was:
 * `<dir>/backups/legko-pre-v<target>-<date>.db`. The daily start-up backup is taken after migrating, so this is
 * the copy a rollback to the previous build can use. Fresh (v0) and up-to-date databases are left alone. An existing
 * snapshot is never replaced: a second migration on the same date (after a downgrade) writes `…-2.db` next to it.
 */
function snapshotBeforeMigrating(db: Database, file: string, now: Date): string | null {
  const version = schemaVersion(db);
  if (version === 0 || version >= MIGRATIONS.length) return null;
  const date = zonedNow(BACKUP_TIMEZONE, now).date;
  return writeSnapshotOnce(
    db,
    join(backupsDir(dirname(file)), preMigrationBackupName(MIGRATIONS.length, date)),
  );
}

/** Opens (creating if needed) the database in WAL mode and brings the schema up to date. */
export function openDatabase(file: string, options: OpenDatabaseOptions = {}): Database {
  const { now = () => new Date(), logger = silentLogger } = options;
  const inMemory = file === ':memory:';
  if (!inMemory) mkdirSync(dirname(file), { recursive: true });
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(file, { timeout: 5000, enableForeignKeyConstraints: true });
  try {
    if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    if (!inMemory) {
      const from = schemaVersion(db);
      const snapshot = snapshotBeforeMigrating(db, file, now());
      if (snapshot)
        logger.info(`database schema v${from} → v${MIGRATIONS.length}: saved ${basename(snapshot)} first`);
    }
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}

/** Opens an existing database file exactly as it is (no migrations): for maintenance commands. */
export function openExistingDatabase(file: string): Database {
  if (!existsSync(file)) throw new Error(`No database at ${file}`);
  const { DatabaseSync } = sqlite();
  return new DatabaseSync(file, { timeout: 5000, enableForeignKeyConstraints: true });
}
