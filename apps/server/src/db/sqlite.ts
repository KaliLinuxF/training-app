import { createRequire } from 'node:module';
import type * as Sqlite from 'node:sqlite';
import '../warnings';

export type Database = Sqlite.DatabaseSync;
export type Row = Record<string, Sqlite.SQLOutputValue>;

const requireBuiltin = createRequire(import.meta.url);
let loaded: typeof Sqlite | undefined;

/**
 * `node:sqlite` is loaded lazily on purpose: a static import would be hoisted above the
 * warning filter in the ESM bundle, so Node could print its ExperimentalWarning first.
 */
export function sqlite(): typeof Sqlite {
  loaded ??= requireBuiltin('node:sqlite') as typeof Sqlite;
  return loaded;
}
