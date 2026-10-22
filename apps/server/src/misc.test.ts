import { resolve, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConfigError, DEFAULT_PUBLIC_ORIGIN, loadConfig, resolveDataDir } from './config';
import { createLogger } from './logger';
import { startLoop } from './loop';
import { isValidVapidKeyPair, loadVapidKeys } from './push/vapid';
import { openDatabase } from './db/open';
import { cacheControlFor, resolveStaticPath } from './static';
import { isSqliteExperimentalWarning } from './warnings';

describe('loadConfig', () => {
  const cwd = resolve('/srv/app');

  it('has sensible development defaults', () => {
    const c = loadConfig({}, cwd);
    expect(c).toMatchObject({
      port: 3000,
      dataDir: resolve(cwd, 'data'),
      staticDir: null,
      publicOrigin: DEFAULT_PUBLIC_ORIGIN,
      production: false,
      trustProxy: false,
      logLevel: 'info',
      devUsers: [],
      vapid: { subject: DEFAULT_PUBLIC_ORIGIN, publicKey: null, privateKey: null },
      foodAi: {
        apiKey: null,
        model: 'claude-opus-5-5',
        dailyLimit: 150,
        userDailyLimit: 40,
        sources: { dailyLimit: 'default', userDailyLimit: 'default' },
      },
    });
  });

  it('reads the AI calorie estimate settings', () => {
    const c = loadConfig(
      { ANTHROPIC_API_KEY: ' sk-ant-test ', FOOD_AI_MODEL: 'claude-sonnet-5-5', FOOD_DAILY_LIMIT: '10' },
      cwd,
    );
    expect(c.foodAi).toEqual({
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-5-5',
      dailyLimit: 10,
      userDailyLimit: 40,
      sources: { dailyLimit: 'env', userDailyLimit: 'default' },
    });
    expect(loadConfig({ ANTHROPIC_API_KEY: '  ' }, cwd).foodAi.apiKey).toBeNull();
    expect(loadConfig({ FOOD_DAILY_LIMIT: '0' }, cwd).foodAi.dailyLimit).toBe(0);
  });

  it('FOOD_DAILY_LIMIT is the global ceiling (default 150), FOOD_USER_DAILY_LIMIT the per-user one (default 40)', () => {
    const c = loadConfig({ FOOD_DAILY_LIMIT: '10000', FOOD_USER_DAILY_LIMIT: '1000' }, cwd).foodAi;
    expect(c).toMatchObject({
      dailyLimit: 10_000,
      userDailyLimit: 1000,
      sources: { dailyLimit: 'env', userDailyLimit: 'env' },
    });
    expect(loadConfig({ FOOD_USER_DAILY_LIMIT: '0' }, cwd).foodAi.userDailyLimit).toBe(0);
    expect(loadConfig({}, cwd).foodAi).toMatchObject({ dailyLimit: 150, userDailyLimit: 40 });
  });

  it('reads the environment', () => {
    const c = loadConfig(
      {
        NODE_ENV: 'production',
        PORT: '8080',
        STATIC_DIR: '/app/public',
        PUBLIC_ORIGIN: 'https://fit.triple-a.dev/',
        TRUST_PROXY: '1',
        LOG_LEVEL: 'WARN',
        VAPID_SUBJECT: 'mailto:me@example.com',
      },
      cwd,
    );
    expect(c).toMatchObject({
      port: 8080,
      dataDir: resolve('/data'),
      staticDir: resolve('/app/public'),
      publicOrigin: 'https://fit.triple-a.dev',
      production: true,
      trustProxy: true,
      logLevel: 'warn',
      vapid: { subject: 'mailto:me@example.com' },
    });
  });

  it('builds the dev accounts from DEV_* only outside production', () => {
    expect(loadConfig({ DEV_PASSWORD: 'dev-password' }, cwd).devUsers).toEqual([
      { username: 'anna', password: 'dev-password', role: 'user' },
    ]);
    expect(
      loadConfig(
        {
          DEV_USERNAME: 'olya',
          DEV_PASSWORD: 'dev-password',
          DEV_ADMIN_USERNAME: 'boss',
          DEV_ADMIN_PASSWORD: 'dev-admin-password',
        },
        cwd,
      ).devUsers,
    ).toEqual([
      { username: 'olya', password: 'dev-password', role: 'user' },
      { username: 'boss', password: 'dev-admin-password', role: 'admin' },
    ]);
    expect(loadConfig({ DEV_ADMIN_PASSWORD: 'x' }, cwd).devUsers).toEqual([
      { username: 'admin', password: 'x', role: 'admin' },
    ]);
    expect(
      loadConfig({ DEV_PASSWORD: 'dev-password', DEV_ADMIN_PASSWORD: 'x', NODE_ENV: 'production' }, cwd)
        .devUsers,
    ).toEqual([]);
    expect(loadConfig({}, cwd).devUsers).toEqual([]);
  });

  it.each([
    [{ PORT: 'abc' }],
    [{ PORT: '70000' }],
    [{ PUBLIC_ORIGIN: 'fit.triple-a.dev' }],
    [{ LOG_LEVEL: 'loud' }],
    [{ VAPID_PUBLIC_KEY: 'only-one' }],
    [{ VAPID_SUBJECT: 'http://insecure.example' }],
    [{ FOOD_DAILY_LIMIT: 'many' }],
    [{ FOOD_DAILY_LIMIT: '-1' }],
    [{ FOOD_DAILY_LIMIT: '2.5' }],
    [{ FOOD_DAILY_LIMIT: '10001' }],
    [{ FOOD_USER_DAILY_LIMIT: '1001' }],
    [{ FOOD_USER_DAILY_LIMIT: '-1' }],
    [{ FOOD_USER_DAILY_LIMIT: 'lots' }],
  ])('rejects %o', (env) => {
    expect(() => loadConfig(env, cwd)).toThrow(ConfigError);
  });

  it('falls back to the production origin as VAPID subject for an http PUBLIC_ORIGIN', () => {
    const c = loadConfig({ PUBLIC_ORIGIN: 'http://localhost:3000' }, cwd);
    expect(c.publicOrigin).toBe('http://localhost:3000');
    expect(c.vapid.subject).toBe(DEFAULT_PUBLIC_ORIGIN);
  });

  it('resolves DATA_DIR against the working directory', () => {
    expect(resolveDataDir({ DATA_DIR: 'var/db' }, cwd)).toBe(resolve(cwd, 'var/db'));
  });
});

describe('warning filter', () => {
  it('matches only the SQLite experimental warning', () => {
    expect(
      isSqliteExperimentalWarning('SQLite is an experimental feature and might change at any time', [
        'ExperimentalWarning',
      ]),
    ).toBe(true);
    expect(
      isSqliteExperimentalWarning('SQLite is an experimental feature', [{ type: 'ExperimentalWarning' }]),
    ).toBe(true);
    expect(isSqliteExperimentalWarning('Fetch is experimental', ['ExperimentalWarning'])).toBe(false);
    expect(isSqliteExperimentalWarning('SQLite something', ['DeprecationWarning'])).toBe(false);
    expect(isSqliteExperimentalWarning(new Error('boom'), [])).toBe(false);
  });
});

describe('logger', () => {
  it('filters by level', () => {
    const lines: string[] = [];
    const log = createLogger('warn', (l) => lines.push(l));
    log.info('hidden');
    log.warn('shown');
    log.error('failed', new Error('why'));
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatch(/WARN {2}shown$/);
    expect(lines[1]).toContain('failed: Error: why');
  });
});

describe('startLoop', () => {
  it('passes the injected clock and never overlaps runs', async () => {
    const seen: number[] = [];
    let release: () => void = () => undefined;
    const loop = startLoop({
      name: 'test',
      intervalMs: 60_000,
      now: () => new Date(42),
      task: (now) =>
        new Promise<void>((done) => {
          seen.push(now.getTime());
          release = done;
        }),
    });
    const first = loop.runNow();
    const second = loop.runNow();
    expect(second).toBe(first);
    release();
    await first;
    expect(seen).toEqual([42]);
    await loop.stop();
    await loop.runNow();
    expect(seen).toEqual([42]);
  });

  it('logs task errors and keeps going', async () => {
    const lines: string[] = [];
    const loop = startLoop({
      name: 'flaky',
      intervalMs: 60_000,
      logger: createLogger('debug', (l) => lines.push(l)),
      task: () => {
        throw new Error('nope');
      },
    });
    await loop.runNow();
    await loop.runNow();
    expect(lines.filter((l) => l.includes('flaky failed'))).toHaveLength(2);
    await loop.stop();
  });
});

describe('VAPID keys', () => {
  it('generates once and then reuses the stored pair', () => {
    const db = openDatabase(':memory:');
    const first = loadVapidKeys(db, { publicKey: null, privateKey: null });
    expect(first.source).toBe('generated');
    expect(isValidVapidKeyPair(first.keys)).toBe(true);
    const second = loadVapidKeys(db, { publicKey: null, privateKey: null });
    expect(second).toEqual({ keys: first.keys, source: 'database' });
  });

  it('prefers env keys and validates them', () => {
    const db = openDatabase(':memory:');
    const generated = loadVapidKeys(openDatabase(':memory:'), { publicKey: null, privateKey: null }).keys;
    expect(loadVapidKeys(db, generated)).toEqual({ keys: generated, source: 'env' });
    expect(() => loadVapidKeys(db, { publicKey: 'abc', privateKey: 'def' })).toThrow(/not valid/);
  });
});

describe('static path resolution', () => {
  const root = resolve('/srv/web');

  it('maps URL paths inside the root', () => {
    expect(resolveStaticPath(root, '/')).toBe(`${root}${sep}index.html`);
    expect(resolveStaticPath(root, '/assets/a-1.js')).toBe(resolve(root, 'assets', 'a-1.js'));
    expect(resolveStaticPath(root, '/%D0%BB.png')).toBe(resolve(root, 'л.png'));
    expect(resolveStaticPath(root, '/.well-known/x')).toBe(resolve(root, '.well-known', 'x'));
  });

  it('refuses traversal, dotfiles and odd encodings', () => {
    for (const p of ['/../etc/passwd', '/a/%2e%2e/%2e%2e/x', '/.env', '/a\\..\\b', '/%E0%A4%A', '/a%00b']) {
      expect(resolveStaticPath(root, p), p).toBeNull();
    }
  });

  it('chooses cache headers', () => {
    expect(cacheControlFor('/assets/index-abc.js')).toContain('immutable');
    expect(cacheControlFor('/sw.js')).toBe('no-cache');
    expect(cacheControlFor('/index.html')).toBe('no-cache');
    expect(cacheControlFor('/manifest.webmanifest')).toBe('no-cache');
  });
});
