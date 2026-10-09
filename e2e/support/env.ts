/** Constants shared by the Playwright config and the tests (no imports: the config loads this). */

export const PORT = 3399;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/** Local test credential: the e2e server applies it as `DEV_PASSWORD` (development mode only). */
export const PASSWORD = 'e2e-pass';

export const TIMEZONE = 'Europe/Kyiv';

/**
 * The browser clock starts here and keeps running (`page.clock.install`): Wednesday,
 * 14 October 2026, 10:00 in Kyiv. Every date in the tests is relative to it, so results do not
 * depend on the day the suite runs.
 */
export const FIXED_NOW = new Date('2026-10-14T10:00:00+03:00');
export const TODAY = '2026-10-14';
