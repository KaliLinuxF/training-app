import type { MiddlewareHandler } from 'hono';
import type { RateLimiter } from '../../auth/rateLimit';
import type { SessionStore } from '../../auth/sessions';
import type { DataRepo } from '../../db/data';
import type { Database } from '../../db/sqlite';
import type { Logger } from '../../logger';
import type { PushService } from '../../push/service';
import type { AppEnv } from '../types';

/** Everything route modules need; assembled once by `createApp`. */
export interface RouteDeps {
  db: Database;
  data: DataRepo;
  sessions: SessionStore;
  push: PushService | null;
  logger: Logger;
  now: () => number;
  loginLimiter: RateLimiter;
  /** Session check for protected routes. */
  auth: MiddlewareHandler<AppEnv>;
  secureCookie: boolean;
  trustProxy: boolean;
  version: string;
}
