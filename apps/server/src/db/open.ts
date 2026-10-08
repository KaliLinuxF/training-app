import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrate } from './migrations';
import { sqlite, type Database } from './sqlite';

export const DB_FILE_NAME = 'legko.db';

export const databasePath = (dataDir: string): string => join(dataDir, DB_FILE_NAME);

/** Opens (creating if needed) the database in WAL mode and brings the schema up to date. */
export function openDatabase(file: string): Database {
  const inMemory = file === ':memory:';
  if (!inMemory) mkdirSync(dirname(file), { recursive: true });
  const { DatabaseSync } = sqlite();
  const db = new DatabaseSync(file, { timeout: 5000, enableForeignKeyConstraints: true });
  try {
    if (!inMemory) db.exec('PRAGMA journal_mode = WAL');
    db.exec('PRAGMA synchronous = NORMAL');
    migrate(db);
  } catch (err) {
    db.close();
    throw err;
  }
  return db;
}
