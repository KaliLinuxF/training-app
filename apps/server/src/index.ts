import './warnings';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve, type ServerType } from '@hono/node-server';
import { zonedNow, type AiLimits, type ISODate } from '@legko/shared';
import { applyDevUsers } from './auth/devUsers';
import { createSessionStore } from './auth/sessions';
import { BACKUP_TIMEZONE, backupsDir, createBackupJob } from './backup';
import { ConfigError, loadConfig, type Config } from './config';
import { createDataRepos } from './db/data';
import { databasePath, openDatabase } from './db/open';
import type { Database } from './db/sqlite';
import { createTokenRepo } from './db/tokens';
import { createUserRepo, isUsableAdmin } from './db/users';
import { createFoodBudget, type FoodBudget } from './food/budget';
import { createClaudeEstimator } from './food/claude';
import type { FoodEstimator } from './food/estimator';
import { createApp } from './http/app';
import { createLogger, type Logger } from './logger';
import { combineLoops, startLoop, type Loop } from './loop';
import { createPhotoGcJob } from './photos/gc';
import { createPhotoStore, photosDir } from './photos/store';
import { createPushService, type PushService } from './push/service';
import { createWebPushTransport } from './push/transport';
import { loadVapidKeys } from './push/vapid';
import { createReminderLog } from './reminders/log';
import { createReminderRound, runReminderTick } from './reminders/runner';
import { APP_VERSION } from './version';

const TICK_MS = 30_000;
const PURGE_EVERY_MS = 3600_000;
const SHUTDOWN_GRACE_MS = 5_000;

/** How to run the CLI from where this build lives (bundle: sibling cli.js; dev: tsx). */
function cliHint(): string {
  const here = fileURLToPath(import.meta.url);
  return here.endsWith('.ts') ? 'pnpm --filter @legko/server cli' : `node ${join(dirname(here), 'cli.js')}`;
}

/** Start-up hints about the accounts (counts only: no names, no hashes). */
function logAccounts(db: Database, logger: Logger): void {
  const users = createUserRepo(db);
  if (users.count() === 0) {
    logger.info(`No accounts yet: run ${cliHint()} create-admin <name>`);
    return;
  }
  const admins = users.list().filter((u) => u.role === 'admin');
  if (admins.length === 0) {
    logger.info(`No admin account: run ${cliHint()} create-admin <name>`);
  } else if (!admins.some(isUsableAdmin)) {
    logger.info(
      `No usable admin account (no password yet or disabled): run ${cliHint()} reset-password-link <name>`,
    );
  }
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

/** The configured defaults (`FOOD_USER_DAILY_LIMIT`, `FOOD_DAILY_LIMIT`); limits an admin saved win over them. */
const configuredLimits = (config: Config): AiLimits => ({
  perUser: config.foodAi.userDailyLimit,
  global: config.foodAi.dailyLimit,
});

/** Where the limits in force come from, for the start-up line (§5.5). */
function limitsSourceOf(budget: FoodBudget, config: Config): 'kv.ai_limits' | 'env' | 'defaults' {
  if (budget.limitsSource() === 'kv') return 'kv.ai_limits';
  const { sources } = config.foodAi;
  return sources.dailyLimit === 'env' || sources.userDailyLimit === 'env' ? 'env' : 'defaults';
}

function initFoodAi(db: Database, config: Config, logger: Logger): FoodEstimator | null {
  const { apiKey, model, dailyLimit } = config.foodAi;
  if (!apiKey || dailyLimit === 0) {
    logger.info(
      `AI calorie estimate disabled (${apiKey ? 'FOOD_DAILY_LIMIT=0' : 'ANTHROPIC_API_KEY is not set'})`,
    );
    return null;
  }
  const budget = createFoodBudget(db, configuredLimits(config));
  const limits = budget.limits();
  logger.info(
    `AI calorie estimate enabled (model ${model}, per user ${limits.perUser}, global ${limits.global}; ` +
      `limits from ${limitsSourceOf(budget, config)})`,
  );
  return createClaudeEstimator({ apiKey, model, logger });
}

/** Prefixes one user's reminder lines with their id (never a name or content). */
function userLogger(logger: Logger, id: string): Logger {
  const tag = (m: string) => `user ${id}: ${m}`;
  return {
    debug: (m) => logger.debug(tag(m)),
    info: (m) => logger.info(tag(m)),
    warn: (m) => logger.warn(tag(m)),
    error: (m, err) => logger.error(tag(m), err),
  };
}

/**
 * Two independent 30-second loops: reminders (per user), and the daily backup, photo clean-up, AI usage pruning and
 * session / link clean-up. A slow push service can delay the next reminder round, never the maintenance jobs.
 */
function startScheduler(db: Database, config: Config, logger: Logger, push: PushService | null): Loop {
  const backups = createBackupJob({ db, dir: backupsDir(config.dataDir), logger });
  backups.atStartup(new Date());
  const photoGc = createPhotoGcJob({
    photos: createPhotoStore(db, photosDir(config.dataDir), Date.now, logger),
    logger,
  });
  const data = createDataRepos(db, Date.now, logger);
  const reminderLogs = createReminderLog(db);
  const budget = createFoodBudget(db, configuredLimits(config));
  const sessions = createSessionStore(db);
  const tokens = createTokenRepo(db, logger);
  let lastPurge = 0;
  let lastPruneDay: ISODate | null = null;

  const guarded = async (name: string, fn: () => Promise<unknown> | unknown): Promise<void> => {
    try {
      await fn();
    } catch (err) {
      logger.error(`${name} failed`, err);
    }
  };

  /**
   * Each recipient in turn, with only their own settings, rows, log and devices; one failure stops nobody else, and a
   * user whose push service does not answer holds the others up for at most `USER_TICK_TIMEOUT_MS`.
   */
  const round = createReminderRound({ logger });
  const reminders = (service: PushService, now: Date): Promise<void> =>
    round(service.recipients(), (id) =>
      runReminderTick(
        {
          data: data.forUser(id),
          log: reminderLogs.forUser(id),
          push: service.forUser(id),
          logger: userLogger(logger, id),
        },
        now,
      ),
    );

  const reminderLoop = startLoop({
    name: 'reminders',
    intervalMs: TICK_MS,
    logger,
    task: async (now) => {
      if (push) await guarded('reminders', () => reminders(push, now));
    },
  });

  const maintenanceLoop = startLoop({
    name: 'maintenance',
    intervalMs: TICK_MS,
    logger,
    task: async (now) => {
      await guarded('backup', () => backups.tick(now));
      await guarded('photo gc', () => photoGc.tick(now));
      const today = zonedNow(BACKUP_TIMEZONE, now).date;
      if (today !== lastPruneDay) {
        lastPruneDay = today;
        await guarded('ai usage prune', () => {
          const pruned = budget.prune(now.getTime());
          if (pruned) logger.info(`ai usage: pruned ${pruned} old per-user count(s)`);
        });
      }
      if (now.getTime() - lastPurge >= PURGE_EVERY_MS) {
        lastPurge = now.getTime();
        await guarded('session purge', () => sessions.purgeExpired(now.getTime()));
        await guarded('link purge', () => tokens.purge(now.getTime()));
      }
    },
  });

  return combineLoops([reminderLoop, maintenanceLoop]);
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
    `Home Fit server ${APP_VERSION} (${config.production ? 'production' : 'development'}), database ${file}`,
  );

  const db = openDatabase(file, { logger });
  // `config.devUsers` is always empty in production (see loadConfig).
  await applyDevUsers(db, config, logger);
  logAccounts(db, logger);
  if (!config.staticDir) logger.info('STATIC_DIR is not set: serving the API only');

  const push = initPush(db, config, logger);
  const food = { estimator: initFoodAi(db, config, logger), limits: configuredLimits(config) };
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
