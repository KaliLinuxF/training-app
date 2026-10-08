import type { Row } from './sqlite';

/** Typed column readers: the schema guarantees the types, these turn a corrupt row into a clear error. */

export function text(row: Row, column: string): string {
  const v = row[column];
  if (typeof v !== 'string') throw new TypeError(`Column ${column}: expected TEXT`);
  return v;
}

export function textOrNull(row: Row, column: string): string | null {
  const v = row[column];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'string') throw new TypeError(`Column ${column}: expected TEXT`);
  return v;
}

export function num(row: Row, column: string): number {
  const v = row[column];
  if (typeof v !== 'number') throw new TypeError(`Column ${column}: expected a number`);
  return v;
}

export function numOrNull(row: Row, column: string): number | null {
  const v = row[column];
  if (v === null || v === undefined) return null;
  if (typeof v !== 'number') throw new TypeError(`Column ${column}: expected a number`);
  return v;
}
