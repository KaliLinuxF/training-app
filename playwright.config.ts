/**
 * End-to-end tests for «Легко»: the real server bundle (apps/server/dist) serving the built web
 * app (apps/web/dist) on a throw-away database, driven by the system Chrome (or Edge).
 *
 *   pnpm e2e            build everything, then run the suite
 *   pnpm e2e:run        run against the existing build (faster when only tests changed)
 *   pnpm e2e:visual     only the screenshot pass (e2e/__screenshots__/)
 *
 * See e2e/README.md for details.
 */
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, devices, type PlaywrightTestConfig } from '@playwright/test';
import { BASE_URL, PASSWORD, PORT, TIMEZONE } from './e2e/support/env';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const SERVER_BUNDLE = resolve(ROOT, 'apps/server/dist/index.js');
const WEB_DIST = resolve(ROOT, 'apps/web/dist');

// Test-side date maths (demo data, expected labels) run in the same zone as the browser.
process.env.TZ = TIMEZONE;

for (const [what, path] of [
  ['server bundle', SERVER_BUNDLE],
  ['web build', join(WEB_DIST, 'index.html')],
] as const) {
  if (!existsSync(path))
    throw new Error(
      `E2E: the ${what} is missing (${path}). Run \`pnpm e2e\` (builds first) or \`pnpm -r build\`.`,
    );
}

/**
 * One fresh database per run. The config is evaluated again in every worker; they inherit the
 * directory through the environment instead of creating their own.
 */
function dataDir(): string {
  process.env.LEGKO_E2E_DATA_DIR ??= mkdtempSync(join(tmpdir(), 'legko-e2e-'));
  return process.env.LEGKO_E2E_DATA_DIR;
}

/** System browser: Chrome when installed, otherwise Edge (override with E2E_CHANNEL). */
function browserChannel(): string {
  if (process.env.E2E_CHANNEL) return process.env.E2E_CHANNEL;
  const candidates = [
    process.env.PROGRAMFILES && join(process.env.PROGRAMFILES, 'Google/Chrome/Application/chrome.exe'),
    process.env['PROGRAMFILES(X86)'] &&
      join(process.env['PROGRAMFILES(X86)'], 'Google/Chrome/Application/chrome.exe'),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'Google/Chrome/Application/chrome.exe'),
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ];
  return candidates.some((p) => p && existsSync(p)) ? 'chrome' : 'msedge';
}

type ProjectUse = NonNullable<PlaywrightTestConfig['use']>;

const common: ProjectUse = {
  browserName: 'chromium',
  channel: browserChannel(),
  baseURL: BASE_URL,
  locale: 'uk-UA',
  timezoneId: TIMEZONE,
  // Sheets / toasts animate; the app honours reduced motion, which keeps screenshots crisp.
  reducedMotion: 'reduce',
  // page.route() cannot see requests a service worker handles; the offline/PWA tests opt back in.
  serviceWorkers: 'block',
  trace: 'retain-on-failure',
  screenshot: 'only-on-failure',
};

export default defineConfig({
  testDir: 'e2e',
  outputDir: 'test-results',
  // One server and one database for the whole run: tests reset the data themselves.
  workers: 1,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 45_000,
  expect: { timeout: 8_000 },
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report' }]],
  projects: [
    {
      name: 'iphone',
      use: {
        ...common,
        viewport: { width: 390, height: 844 },
        screen: { width: 390, height: 844 },
        deviceScaleFactor: 3,
        isMobile: true,
        hasTouch: true,
        userAgent: devices['iPhone 14'].userAgent,
        // Chrome turns a horizontal touch swipe into «history back»; iOS only does that from the
        // screen edge (and not at all in the installed app), so keep it out of the swipe tests.
        launchOptions: { args: ['--disable-features=OverscrollHistoryNavigation'] },
      },
    },
    {
      name: 'desktop',
      use: {
        ...common,
        viewport: { width: 1280, height: 800 },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: `node "${SERVER_BUNDLE}"`,
    url: `${BASE_URL}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    stdout: 'ignore',
    stderr: 'pipe',
    env: {
      ...(process.env as Record<string, string>),
      PORT: String(PORT),
      STATIC_DIR: WEB_DIST,
      DATA_DIR: dataDir(),
      NODE_ENV: 'development',
      // Local test credential, applied by the server on first start (development only).
      DEV_PASSWORD: PASSWORD,
      LOG_LEVEL: 'warn',
      // The AI endpoints are mocked in the browser; never call the real model from tests.
      ANTHROPIC_API_KEY: '',
      TRUST_PROXY: '',
    },
  },
});
