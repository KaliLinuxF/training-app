import './warnings';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import { hasPassword, setPassword } from './auth/password';
import { createSessionStore } from './auth/sessions';
import { backupsDir, createBackupJob } from './backup';
import { ConfigError, loadConfig, type Config } from './config';
import { createDataRepo } from './db/data';
import { databasePath, openDatabase } from './db/open';
import type { Database } from './db/sqlite';
import { createClaudeEstimator } from './food/claude';
import type { FoodEstimator } from './food/estimator';
import { createApp } from './http/app';
import { createLogger, type Logger } from './logger';
import { startLoop, type Loop } from './loop';
import { createPhotoGcJob } from './photos/gc';
import { createPhotoStore, photosDir } from './photos/store';
import { createPushService, type PushService } from './push/service';
import { createWebPushTransport } from './push/transport';
import { loadVapidKeys } from './push/vapid';
import { createReminderLog } from './reminders/log';
import { runReminderTick } from './reminders/runner';
import { APP_VERSION } from './version';

const TICK_MS = 30_000;
const SESSION_PURGE_MS = 3600_000;
const SHUTDOWN_GRACE_MS = 5_000;

/** How to run the CLI from where this build lives (bundle: sibling cli.js; dev: tsx). */
function setPasswordHint(): string {
  const here = fileURLToPath(import.meta.url);
  return here.endsWith('.ts')
    ? 'pnpm --filter @legko/server set-password'
    : `node ${join(dirname(here), 'cli.js')} set-password`;
}

async function applyDevPassword(db: Database, config: Config, logger: Logger): Promise<void> {
  // `devPassword` is always null in production (see loadConfig).
  if (!config.devPassword || hasPassword(db)) return;
  await setPassword(db, config.devPassword);
  logger.warn('DEV_PASSWORD applied as the login password (development only)');
}

function initPush(db: Database, config: Config, logger: Logger): PushService | null {
  try {
    const { keys, source } = loadVapidKeys(db, config.vapid);
    logger.info(`web push ready (VAPID keys: ${source}, subject ${config.vapid.subject})`);
    const transport = createWebPushTransport({ ...keys, subject: config.vapid.subject });
    return createPushService({ db, transport, publicKey: keys.publicKey, logger });
  } catch (err) {
    logger.error('web push disabled', err);
    return null;
  }
}

function initFoodAi(config: Config, logger: Logger): FoodEstimator | null {
  const { apiKey, model, dailyLimit } = config.foodAi;
  if (!apiKey || dailyLimit === 0) {
    logger.info(
      `AI calorie estimate disabled (${apiKey ? 'FOOD_DAILY_LIMIT=0' : 'ANTHROPIC_API_KEY is not set'})`,
    );
    return null;
  }
  logger.info(`AI calorie estimate enabled (model ${model}, ${dailyLimit} per day)`);
  return createClaudeEstimator({ apiKey, model, logger });
}

/** Reminders, daily backup, photo clean-up and session clean-up share one 30-second tick. */
function startScheduler(db: Database, config: Config, logger: Logger, push: PushService | null): Loop {
  const backups = createBackupJob({ db, dir: backupsDir(config.dataDir), logger });
  backups.atStartup(new Date());
  const photoGc = createPhotoGcJob({ photos: createPhotoStore(db, photosDir(config.dataDir)), logger });
  const reminderDeps = push
    ? { data: createDataRepo(db, Date.now, logger), log: createReminderLog(db), push, logger }
    : null;
  const sessions = createSessionStore(db);
  let lastPurge = 0;

  const guarded = async (name: string, fn: () => Promise<unknown> | unknown): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      logger.error(`${name} failed`, err);
    }
  };

  return startLoop({
    name: 'scheduler',
    intervalMs: TICK_MS,
    logger,
    task: async (now) => {
      if (reminderDeps) await guarded('reminders', () => runReminderTick(reminderDeps, now));
      await guarded('backup', () => backups.tick(now));
      await guarded('photo gc', () => photoGc.tick(now));
      if (now.getTime() - lastPurge >= SESSION_PURGE_MS) {
        lastPurge = now.getTime();
        await guarded('session purge', () => sessions.purgeExpired(now.getTime()));
      }
    },
  });
}

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve) => {
    const force = setTimeout(() => {
      if ('closeAllConnections' in server) server.closeAllConnections();
      resolve();
    }, SHUTDOWN_GRACE_MS);
    force.unref();
    server.close(() => {
      clearTimeout(force);
      resolve();
    });
    if ('closeIdleConnections' in server) server.closeIdleConnections();
  });
}

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const file = databasePath(config.dataDir);
  logger.info(
    `Легко server ${APP_VERSION} (${config.production ? 'production' : 'development'}), database ${file}`,
  );

  const db = openDatabase(file);
  await applyDevPassword(db, config, logger);
  if (!hasPassword(db)) logger.warn(`No password is set: every login fails. Run: ${setPasswordHint()}`);
  if (!config.staticDir) logger.info('STATIC_DIR is not set: serving the API only');

  const push = initPush(db, config, logger);
  const food = { estimator: initFoodAi(config, logger), dailyLimit: config.foodAi.dailyLimit };
  const app = createApp({ db, config, logger, push, photosDir: photosDir(config.dataDir), food });
  const scheduler = startScheduler(db, config, logger, push);
  void scheduler.runNow();

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(`listening on port ${info.port}`);
  });

  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    logger.info(`${signal} received, shutting down`);
    await scheduler.stop();
    await closeServer(server);
    db.close();
    logger.info('stopped');
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((err: unknown) => {
  const message = err instanceof ConfigError ? `Configuration error: ${err.message}` : err;
  console.error(message);
  process.exit(1);
});
