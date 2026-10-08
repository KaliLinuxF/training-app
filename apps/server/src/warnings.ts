/**
 * Silences the `ExperimentalWarning` that some Node 24 releases print when `node:sqlite` is loaded.
 * Every other warning still goes through the original `process.emitWarning`.
 * Imported for its side effect before anything touches `node:sqlite` (see `db/sqlite.ts`).
 */

export function isSqliteExperimentalWarning(warning: string | Error, rest: readonly unknown[]): boolean {
  const message = typeof warning === 'string' ? warning : warning.message;
  return warningType(warning, rest[0]) === 'ExperimentalWarning' && /sqlite/i.test(message);
}

function warningType(warning: string | Error, typeOrOptions: unknown): string | undefined {
  if (warning instanceof Error) return warning.name;
  if (typeof typeOrOptions === 'string') return typeOrOptions;
  if (typeof typeOrOptions === 'object' && typeOrOptions !== null && 'type' in typeOrOptions) {
    return typeof typeOrOptions.type === 'string' ? typeOrOptions.type : undefined;
  }
  return undefined;
}

let installed = false;

export function installWarningFilter(): void {
  if (installed) return;
  installed = true;
  const original = process.emitWarning;
  const filtered = (warning: string | Error, ...rest: unknown[]): void => {
    if (isSqliteExperimentalWarning(warning, rest)) return;
    Reflect.apply(original, process, [warning, ...rest]);
  };
  process.emitWarning = filtered as typeof process.emitWarning;
}

installWarningFilter();
