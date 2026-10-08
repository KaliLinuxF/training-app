import { API, type HealthResponse } from '@legko/shared';
import type { Hono } from 'hono';
import type { AppEnv } from '../types';
import type { RouteDeps } from './deps';

/** Unauthenticated; used by the Docker health check. Fails (500) when the database is unusable. */
export function registerHealthRoutes(app: Hono<AppEnv>, { db, version }: RouteDeps): void {
  app.get(API.health, (c) => {
    db.prepare('SELECT 1').get();
    const body: HealthResponse = { ok: true, version };
    return c.json(body);
  });
}
