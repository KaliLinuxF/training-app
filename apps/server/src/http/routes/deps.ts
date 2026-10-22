import type { MiddlewareHandler } from 'hono';
import type { AccountService } from '../../auth/accounts';
import type { ScryptGate, ScryptParams } from '../../auth/password';
import type { RateLimiter } from '../../auth/rateLimit';
import type { SessionStore } from '../../auth/sessions';
import type { DataRepos } from '../../db/data';
import type { Database } from '../../db/sqlite';
import type { TokenRepo } from '../../db/tokens';
import type { UserRepo } from '../../db/users';
import type { FoodBudget } from '../../food/budget';
import type { FoodEstimator } from '../../food/estimator';
import type { Logger } from '../../logger';
import type { PhotoStore } from '../../photos/store';
import type { PushService } from '../../push/service';
import type { SubscriptionRepo } from '../../push/subscriptions';
import type { AppEnv } from '../types';

/**
 * Everything route modules need; assembled once by `createApp`. Per-user state is only reachable through
 * `forUser(currentUser(c).id)` (`data`, `photos`, `subscriptions`, `food.budget`): there is no unscoped data repo here
 * (docs/multi-user.md §4).
 */
export interface RouteDeps {
  /** Only for the health check; routes never write SQL themselves. */
  db: Database;
  users: UserRepo;
  tokens: TokenRepo;
  accounts: AccountService;
  sessions: SessionStore;
  data: DataRepos;
  photos: PhotoStore;
  push: PushService | null;
  subscriptions: SubscriptionRepo;
  /** `estimator` is null when the AI estimate is disabled (no ANTHROPIC_API_KEY). */
  food: { estimator: FoodEstimator | null; budget: FoodBudget };
  logger: Logger;
  now: () => number;
  /** Per client address + the persistent global cap (login). */
  loginLimiter: RateLimiter;
  /** Per username key (login). */
  usernameLimiter: RateLimiter;
  /** Successful logins, keyed `name:<username key>` and `addr:<addressKey(ip)>` (login). */
  loginSuccessLimiter: RateLimiter;
  /** Per client address (the four public link endpoints; the routes key it by `addressKey`, IPv6 per /64). */
  linkLimiter: RateLimiter;
  /** Per user id: wrong current passwords on `/api/account/*`. */
  passwordLimiter: RateLimiter;
  /** Per user id: every attempt on `/api/account/*`. */
  accountChangeLimiter: RateLimiter;
  /** Session check for protected routes (sets `c.var.user`). */
  auth: MiddlewareHandler<AppEnv>;
  /** After `auth`: 403 unless the user is an admin. */
  admin: MiddlewareHandler<AppEnv>;
  secureCookie: boolean;
  trustProxy: boolean;
  publicOrigin: string;
  scrypt: ScryptParams;
  scryptGate: ScryptGate;
  version: string;
}
