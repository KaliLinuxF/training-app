import type { MiddlewareHandler } from 'hono';
import type { RateLimiter } from '../../auth/rateLimit';
import type { SessionStore } from '../../auth/sessions';
import type { DataRepo } from '../../db/data';
import type { Database } from '../../db/sqlite';
import type { FoodBudget } from '../../food/budget';
import type { FoodEstimator } from '../../food/estimator';
import type { Logger } from '../../logger';
import type { PhotoStore } from '../../photos/store';
import type { PushService } from '../../push/service';
import type { AppEnv } from '../types';

/** Everything route modules need; assembled once by `createApp`. */
export interface RouteDeps {
  db: Database;
  data: DataRepo;
  sessions: SessionStore;
  push: PushService | null;
  photos: PhotoStore;
  /** `estimator` is null when the AI estimate is disabled (no ANTHROPIC_API_KEY). */
  food: { estimator: FoodEstimator | null; budget: FoodBudget };
  logger: Logger;
  now: () => number;
  loginLimiter: RateLimiter;
  /** Session check for protected routes. */
  auth: MiddlewareHandler<AppEnv>;
  secureCookie: boolean;
  trustProxy: boolean;
  version: string;
}
