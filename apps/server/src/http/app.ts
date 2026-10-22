import type { AiLimits } from '@legko/shared';
import { Hono } from 'hono';
import { createAccountService } from '../auth/accounts';
import { DEFAULT_SCRYPT, defaultScryptGate, type ScryptGate, type ScryptParams } from '../auth/password';
import {
  ACCOUNT_CHANGE_LIMIT,
  createLoginLimiter,
  createRateLimiter,
  kvFailureLog,
  LINK_LIMIT,
  LOGIN_SUCCESS_LIMIT,
  PASSWORD_LIMIT,
  UNLIMITED,
  USERNAME_LIMIT,
  type RateLimiter,
} from '../auth/rateLimit';
import { createSessionStore, MAX_SESSIONS_PER_USER } from '../auth/sessions';
import { DEFAULT_FOOD_DAILY_LIMIT, DEFAULT_FOOD_USER_DAILY_LIMIT, type Config } from '../config';
import { createCoachAccess } from '../coach/access';
import { createDataAccess } from '../db/data';
import type { Database } from '../db/sqlite';
import { createTokenRepo } from '../db/tokens';
import { createUserRepo } from '../db/users';
import { createFoodBudget } from '../food/budget';
import type { FoodEstimator } from '../food/estimator';
import { silentLogger, type Logger } from '../logger';
import { createPhotoAccess } from '../photos/store';
import type { PushService } from '../push/service';
import { createSubscriptionRepo } from '../push/subscriptions';
import { isApiPath, serveWebApp } from '../static';
import { APP_VERSION } from '../version';
import { apiError, MESSAGES } from './errors';
import { mutationGuard } from './middleware/mutationGuard';
import { requestLog } from './middleware/requestLog';
import { requireAdmin, requireAuth } from './middleware/requireAuth';
import { noStore, securityHeaders } from './middleware/securityHeaders';
import { registerAccountRoutes } from './routes/account';
import { registerAdminRoutes } from './routes/admin';
import { registerAuthRoutes } from './routes/auth';
import { registerCoachRoutes } from './routes/coach';
import { registerDataRoutes } from './routes/data';
import type { RouteDeps } from './routes/deps';
import { registerFoodRoutes } from './routes/food';
import { registerHealthRoutes } from './routes/health';
import { registerLinkRoutes } from './routes/links';
import { registerPhotoRoutes } from './routes/photos';
import { registerPushRoutes } from './routes/push';
import type { AppEnv } from './types';

export interface AppDeps {
  db: Database;
  config: Pick<Config, 'production' | 'publicOrigin' | 'trustProxy' | 'staticDir'>;
  logger?: Logger;
  /** Null when Web Push could not be initialised (push routes answer 503 `push_unavailable`). */
  push?: PushService | null;
  /** Food photo files, `${DATA_DIR}/photos` (created on the first upload). */
  photosDir: string;
  /**
   * AI calorie estimate. No estimator (no ANTHROPIC_API_KEY): status `enabled: false`, estimate 503. `limits` are the
   * defaults (config `FOOD_USER_DAILY_LIMIT` / `FOOD_DAILY_LIMIT`); limits an admin saved in `kv.ai_limits` win.
   */
  food?: { estimator: FoodEstimator | null; limits?: AiLimits };
  /** Injectable clock, epoch ms. */
  now?: () => number;
  /** Parameters of new hashes and of the dummy hash; default `DEFAULT_SCRYPT`. */
  scrypt?: ScryptParams;
  /** Default: the app-wide gate (≤ 2 scrypt runs in flight, a queue of 16). */
  scryptGate?: ScryptGate;
  /** Default: per-address and global login throttle, the global part persisted in `kv`. */
  loginLimiter?: RateLimiter;
  usernameLimiter?: RateLimiter;
  /**
   * Successful logins per `name:<key>` and `addr:<address key>`. Default: `LOGIN_SUCCESS_LIMIT` in production, none in
   * development (the e2e suite signs in hundreds of times per run).
   */
  loginSuccessLimiter?: RateLimiter;
  /** Grouped by `addressKey` in the link routes either way. */
  linkLimiter?: RateLimiter;
  passwordLimiter?: RateLimiter;
  accountChangeLimiter?: RateLimiter;
  /**
   * Live sessions kept per user (older ones are dropped when another is created). Default: `MAX_SESSIONS_PER_USER` in
   * production, no cap in development (the e2e worker's long-lived session must survive hundreds of page logins).
   */
  sessionsPerUser?: number | null;
  version?: string;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const {
    db,
    config,
    logger = silentLogger,
    push = null,
    now = Date.now,
    version = APP_VERSION,
    scrypt = DEFAULT_SCRYPT,
    scryptGate = defaultScryptGate,
  } = deps;
  const users = createUserRepo(db);
  const tokens = createTokenRepo(db, logger);
  const sessions = createSessionStore(db, {
    maxPerUser:
      deps.sessionsPerUser === undefined
        ? config.production
          ? MAX_SESSIONS_PER_USER
          : null
        : deps.sessionsPerUser,
  });
  const subscriptions = createSubscriptionRepo(db);
  const photoAccess = createPhotoAccess(db, deps.photosDir, now, logger);
  const photos = photoAccess.store;
  const dataAccess = createDataAccess(db, now, logger);
  const accounts = createAccountService({
    db,
    users,
    tokens,
    sessions,
    subscriptions,
    removePhotoFiles: (ids) => photos.removeFiles(ids),
    logger,
    scrypt,
    gate: scryptGate,
  });
  const routeDeps: RouteDeps = {
    db,
    users,
    tokens,
    accounts,
    sessions,
    data: dataAccess.repos,
    photos,
    push,
    subscriptions,
    food: {
      estimator: deps.food?.estimator ?? null,
      budget: createFoodBudget(
        db,
        deps.food?.limits ?? { perUser: DEFAULT_FOOD_USER_DAILY_LIMIT, global: DEFAULT_FOOD_DAILY_LIMIT },
      ),
    },
    logger,
    now,
    loginLimiter: deps.loginLimiter ?? createLoginLimiter({ log: kvFailureLog(db), logger }),
    usernameLimiter: deps.usernameLimiter ?? createRateLimiter(USERNAME_LIMIT),
    loginSuccessLimiter:
      deps.loginSuccessLimiter ?? (config.production ? createRateLimiter(LOGIN_SUCCESS_LIMIT) : UNLIMITED),
    linkLimiter: deps.linkLimiter ?? createRateLimiter(LINK_LIMIT),
    passwordLimiter: deps.passwordLimiter ?? createRateLimiter(PASSWORD_LIMIT),
    accountChangeLimiter: deps.accountChangeLimiter ?? createRateLimiter(ACCOUNT_CHANGE_LIMIT),
    auth: requireAuth({ sessions, users, now, secureCookie: config.production }),
    admin: requireAdmin,
    secureCookie: config.production,
    trustProxy: config.trustProxy,
    publicOrigin: config.publicOrigin,
    scrypt,
    scryptGate,
    version,
  };
  // The read-only readers go here and nowhere else: not on RouteDeps (docs/coach-cabinet.md §2.1, coach lint).
  const coach = createCoachAccess({
    users,
    data: dataAccess.readers,
    photos: photoAccess.readers,
    logger,
  });

  const app = new Hono<AppEnv>();
  app.use(requestLog(logger));
  app.use(securityHeaders({ hsts: config.production }));
  app.use('/api/*', noStore);
  app.use('/api/*', mutationGuard(config));
  // Body size caps are per route, behind the session check: see http/bodyLimit.ts.

  registerHealthRoutes(app, routeDeps);
  registerAuthRoutes(app, routeDeps);
  registerLinkRoutes(app, routeDeps);
  registerAccountRoutes(app, routeDeps);
  registerAdminRoutes(app, routeDeps);
  registerCoachRoutes(app, { auth: routeDeps.auth, admin: routeDeps.admin }, coach);
  registerDataRoutes(app, routeDeps);
  registerPushRoutes(app, routeDeps);
  registerFoodRoutes(app, routeDeps);
  registerPhotoRoutes(app, routeDeps);

  if (config.staticDir) app.use('*', serveWebApp(config.staticDir));

  app.notFound((c) =>
    isApiPath(c.req.path) ? apiError(c, 404, 'not_found', MESSAGES.notFound) : c.text('Not found', 404),
  );
  app.onError((err, c) => {
    logger.error(`${c.req.method} ${c.req.path} failed`, err);
    return apiError(c, 500, 'internal', MESSAGES.internal);
  });
  return app;
}
