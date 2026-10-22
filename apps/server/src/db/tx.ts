import type { Database } from './sqlite';

/** Runs `fn` inside `BEGIN IMMEDIATE … COMMIT`; rolls back and rethrows on any error. */
export function transaction<T>(db: Database, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw err;
  }
}

/**
 * `fn` as one atomic unit: inside the caller's transaction when one is open (so a repository method can be composed
 * into a larger `BEGIN IMMEDIATE`), otherwise in its own `transaction()`.
 */
export function atomic<T>(db: Database, fn: () => T): T {
  return db.isTransaction ? fn() : transaction(db, fn);
}
