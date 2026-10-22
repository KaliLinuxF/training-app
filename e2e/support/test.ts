/**
 * The suite's `test`: every test gets a fixed, running browser clock, freshly imported server
 * data and (unless it opts out) a logged-in browser context. Tests are therefore independent of
 * each other and of the day the suite runs.
 *
 *   test.use({ seed: 'empty' })      // brand-new account (setup sheet opens by itself)
 *   test.use({ authed: false })      // start on the login screen
 *   test.use({ account: 'admin' })   // seed and log in as the admin instead of anna
 *
 * After every test, every pending invite is revoked (workers = 1, so nothing else is running), so the
 * pending-invite cap never fills up and no link outlives its test.
 */
import { test as base, expect } from '@playwright/test';
import { seedData, type SeedName } from '../fixtures/data';
import { App } from './app';
import { BASE_URL, FIXED_NOW } from './env';
import { ADMIN, loginContext, ServerApi, USER } from './server';

/** Which built-in account a test runs as: anna (`'user'`) or the admin. */
export type Account = 'user' | 'admin';

export interface SuiteOptions {
  /** Data imported into the account under test before the test (`null` keeps whatever is there). */
  seed: SeedName | null;
  /** Log the browser context in through the API (as the account under test) before the test. */
  authed: boolean;
  /** The account under test: seeded and logged in as (default anna). */
  account: Account;
}

interface SuiteFixtures {
  app: App;
  /** Auto: revokes every pending invite after each test. */
  pendingInvitesCleanup: void;
}

interface WorkerFixtures {
  /** An API client logged in once per worker as anna (`USER`); used to seed and to inspect the server. */
  server: ServerApi;
  /** An API client logged in once per worker as the admin (`ADMIN`). */
  admin: ServerApi;
}

export const test = base.extend<SuiteOptions & SuiteFixtures, WorkerFixtures>({
  seed: ['demo', { option: true }],
  authed: [true, { option: true }],
  account: ['user', { option: true }],

  server: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext({ baseURL: BASE_URL });
      const server = new ServerApi(request, USER);
      await server.login();
      await use(server);
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  admin: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext({ baseURL: BASE_URL });
      const admin = new ServerApi(request, ADMIN);
      await admin.login();
      await use(admin);
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  pendingInvitesCleanup: [
    async ({ admin }, use) => {
      await use();
      await admin.revokePendingInvites();
    },
    { auto: true },
  ],

  page: async ({ page, seed, authed, account, server, admin }, use) => {
    // Time keeps flowing from FIXED_NOW, so timers, debounce and backoff behave normally.
    await page.clock.install({ time: FIXED_NOW });
    const api = account === 'admin' ? admin : server;
    if (seed) await api.importData(seedData(seed));
    if (authed) await loginContext(page.context(), api.creds);
    await use(page);
  },

  app: async ({ page }, use) => {
    await use(new App(page));
  },
});

export { expect };
