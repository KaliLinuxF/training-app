/**
 * The suite's `test`: every test gets a fixed, running browser clock, freshly imported server
 * data and (unless it opts out) a logged-in browser context. Tests are therefore independent of
 * each other and of the day the suite runs.
 *
 *   test.use({ seed: 'empty' })   // brand-new account (setup sheet opens by itself)
 *   test.use({ authed: false })   // start on the login screen
 */
import { test as base, expect } from '@playwright/test';
import { seedData, type SeedName } from '../fixtures/data';
import { App } from './app';
import { BASE_URL, FIXED_NOW } from './env';
import { loginContext, ServerApi } from './server';

export interface SuiteOptions {
  /** Data imported into the server before the test (`null` keeps whatever is there). */
  seed: SeedName | null;
  /** Log the browser context in through the API before the test. */
  authed: boolean;
}

interface SuiteFixtures {
  app: App;
}

interface WorkerFixtures {
  /** An API client logged in once per worker; used to seed and to inspect the server. */
  server: ServerApi;
}

export const test = base.extend<SuiteOptions & SuiteFixtures, WorkerFixtures>({
  seed: ['demo', { option: true }],
  authed: [true, { option: true }],

  server: [
    async ({ playwright }, use) => {
      const request = await playwright.request.newContext({ baseURL: BASE_URL });
      const server = new ServerApi(request);
      await server.login();
      await use(server);
      await request.dispose();
    },
    { scope: 'worker' },
  ],

  page: async ({ page, seed, authed, server }, use) => {
    // Time keeps flowing from FIXED_NOW, so timers, debounce and backoff behave normally.
    await page.clock.install({ time: FIXED_NOW });
    if (seed) await server.importData(seedData(seed));
    if (authed) await loginContext(page.context());
    await use(page);
  },

  app: async ({ page }, use) => {
    await use(new App(page));
  },
});

export { expect };
