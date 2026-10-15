import { join } from 'node:path';
import type { ISODate } from '@legko/shared';
import { preDowngradeBackupName, writeSnapshot } from '../backup';
import { MIGRATIONS, schemaVersion } from './migrations';
import type { Database } from './sqlite';
import { transaction } from './tx';

/**
 * Schema v3 → v2, for a rollback to the build before meals (DEPLOY.md): drops exactly the columns migration v3
 * added. Every day keeps its derived food text, kcal and first 12 photos (`days.food` / `kcal` / `photos` are
 * always written); the meal structure and all macros are lost. Do NOT just lower `user_version`: the v3
 * `ADD COLUMN` would then fail on the next upgrade, and a stale `meals` JSON would override newer food.
 */
export const DOWNGRADE_V3_SQL = `
  ALTER TABLE days DROP COLUMN meals;
  ALTER TABLE foods DROP COLUMN protein;
  ALTER TABLE foods DROP COLUMN fat;
  ALTER TABLE foods DROP COLUMN carbs;
  PRAGMA user_version = 2;
`;

export const DOWNGRADE_FROM = 3;

/** Thrown when the database is not at schema v3 (nothing was changed). */
export class DowngradeRefused extends Error {
  override name = 'DowngradeRefused';
}

/**
 * Writes `<backups>/legko-pre-down-v3-<date>.db`, then downgrades in one transaction.
 * Returns the snapshot path. Throws `DowngradeRefused` unless `user_version` is 3.
 */
export function downgradeSchemaV3(db: Database, backups: string, date: ISODate): string {
  const version = schemaVersion(db);
  if (version !== DOWNGRADE_FROM) {
    throw new DowngradeRefused(
      `downgrade-schema only works on schema v${DOWNGRADE_FROM}; this database is v${version}` +
        (version > MIGRATIONS.length ? ' (from a newer build)' : '') +
        '. Nothing was changed.',
    );
  }
  const snapshot = writeSnapshot(db, join(backups, preDowngradeBackupName(DOWNGRADE_FROM, date)));
  transaction(db, () => db.exec(DOWNGRADE_V3_SQL));
  return snapshot;
}
