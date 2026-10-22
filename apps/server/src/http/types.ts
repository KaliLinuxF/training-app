import type { HttpBindings } from '@hono/node-server';
import type { Context } from 'hono';
import type { AuthedUser } from '../db/users';

/** Bindings are absent when the app is driven through `app.request()` in tests. */
export interface AppEnv {
  Bindings: Partial<HttpBindings>;
  /** Set by `requireAuth` (docs/multi-user.md §3.3). */
  Variables: {
    user: AuthedUser;
    /** SHA-256 of the request's session token. */
    sessionHash: string;
  };
}

/**
 * The signed-in user of a route behind `requireAuth`. Throws when the route forgot the middleware, so a missing scope
 * fails loudly (500) instead of acting for nobody — or everybody.
 */
export function currentUser(c: Context<AppEnv>): AuthedUser {
  const user = c.get('user') as AuthedUser | undefined;
  if (!user) throw new Error('route is missing requireAuth');
  return user;
}

/** The request's session hash (behind `requireAuth`). */
export function currentSessionHash(c: Context<AppEnv>): string {
  const hash = c.get('sessionHash') as string | undefined;
  if (!hash) throw new Error('route is missing requireAuth');
  return hash;
}
