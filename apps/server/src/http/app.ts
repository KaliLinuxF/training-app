import { Hono } from 'hono';
import { createLoginLimiter, kvFailureLog, type RateLimiter } from '../auth/rateLimit';
import { createSessionStore } from '../auth/sessions';
import { DEFAULT_FOOD_DAILY_LIMIT, type Config } from '../config';
import { createDataRepo } from '../db/data';
import type { Database } from '../db/sqlite';
import { createFoodBudget } from '../food/budget';
import type { FoodEstimator } from '../food/estimator';
import { silentLogger, type Logger } from '../logger';
import { createPhotoStore } from '../photos/store';
import type { PushService } from '../push/service';
import { isApiPath, serveWebApp } from '../static';
import { APP_VERSION } from '../version';
import { apiError, MESSAGES } from './errors';
import { mutationGuard } from './middleware/mutationGuard';
import { requestLog } from './middleware/requestLog';
import { requireAuth } from './middleware/requireAuth';
import { noStore, securityHeaders } from './middleware/securityHeaders';
import { registerAuthRoutes } from './routes/auth';
import { registerDataRoutes } from './routes/data';
import type { RouteDeps } from './routes/deps';
import { registerFoodRoutes } from './routes/food';
import { registerHealthRoutes } from './routes/health';
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
  /** AI calorie estimate. No estimator (no ANTHROPIC_API_KEY): status `enabled: false`, estimate 503. */
  food?: { estimator: FoodEstimator | null; dailyLimit?: number };
  /** Injectable clock, epoch ms. */
  now?: () => number;
  /** Default: per-address and global login throttle, the global part persisted in `kv`. */
  loginLimiter?: RateLimiter;
  version?: string;
}

export function createApp(deps: AppDeps): Hono<AppEnv> {
  const { db, config, logger = silentLogger, push = null, now = Date.now, version = APP_VERSION } = deps;
  const sessions = createSessionStore(db);
  const routeDeps: RouteDeps = {
    db,
    data: createDataRepo(db, now, logger),
    sessions,
    push,
    photos: createPhotoStore(db, deps.photosDir, now),
    food: {
      estimator: deps.food?.estimator ?? null,
      budget: createFoodBudget(db, deps.food?.dailyLimit ?? DEFAULT_FOOD_DAILY_LIMIT),
    },
    logger,
    now,
    loginLimiter: deps.loginLimiter ?? createLoginLimiter({ log: kvFailureLog(db), logger }),
    auth: requireAuth({ sessions, now, secureCookie: config.production }),
    secureCookie: config.production,
    trustProxy: config.trustProxy,
    version,
  };

  const app = new Hono<AppEnv>();
  app.use(requestLog(logger));
  app.use(securityHeaders({ hsts: config.production }));
  app.use('/api/*', noStore);
  app.use('/api/*', mutationGuard(config));
  // Body size caps are per route, behind the session check: see http/bodyLimit.ts.

  registerHealthRoutes(app, routeDeps);
  registerAuthRoutes(app, routeDeps);
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
