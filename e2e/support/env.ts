/** Constants shared by the Playwright config and the tests (no imports: the config loads this). */

export const PORT = 3399;
export const BASE_URL = `http://127.0.0.1:${PORT}`;

/**
 * Local test accounts, created by the e2e server's dev bootstrap (development mode only) from `DEV_USERNAME` /
 * `DEV_PASSWORD` (the ordinary user «anna», the legacy owner) and `DEV_ADMIN_USERNAME` / `DEV_ADMIN_PASSWORD` (the
 * one admin). Specs never change the password, name, role or state of either: use `createUser()` for that.
 */
export const USERNAME = 'anna';
export const PASSWORD = 'e2e-pass';
export const ADMIN_USERNAME = 'admin';
export const ADMIN_PASSWORD = 'e2e-admin-pass';

export const TIMEZONE = 'Europe/Kyiv';

/**
 * The browser clock starts here and keeps running (`page.clock.install`): Wednesday,
 * 14 October 2026, 10:00 in Kyiv. Every date in the tests is relative to it, so results do not
 * depend on the day the suite runs.
 */
export const FIXED_NOW = new Date('2026-10-14T10:00:00+03:00');
export const TODAY = '2026-10-14';
