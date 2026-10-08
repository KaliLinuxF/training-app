import { API } from '@legko/shared';
import type { MiddlewareHandler } from 'hono';
import type { Logger } from '../../logger';

/** One line per request: method, path (no query), status, duration. Never bodies or headers. */
export function requestLog(logger: Logger): MiddlewareHandler {
  return async (c, next) => {
    const start = performance.now();
    await next();
    const line = `${c.req.method} ${c.req.path} ${c.res.status} ${Math.round(performance.now() - start)}ms`;
    // The Docker health check polls every few seconds; keep it out of the default log level.
    if (c.req.path === API.health) logger.debug(line);
    else logger.info(line);
  };
}
