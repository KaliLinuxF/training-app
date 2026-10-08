/** Replaced by esbuild `define` at build time; absent under tsx / vitest. */
declare const __LEGKO_VERSION__: string | undefined;

const built = typeof __LEGKO_VERSION__ === 'string' ? __LEGKO_VERSION__ : 'dev';

/** Reported by `GET /api/health`. `APP_VERSION` (e.g. a git sha from the deploy script) wins. */
export const APP_VERSION: string = process.env.APP_VERSION?.trim() || built;
