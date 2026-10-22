import {
  API,
  appDataSchema,
  MAX_OPS_PER_REQUEST,
  opSchema,
  zonedNow,
  type OkResponse,
  type Op,
  type OpsResponse,
} from '@legko/shared';
import type { Hono } from 'hono';
import { BODY_LIMITS, limitBody } from '../bodyLimit';
import { apiError, badRequest, describeIssue, MESSAGES, readJson } from '../errors';
import { currentUser, type AppEnv } from '../types';
import type { RouteDeps } from './deps';

const OK: OkResponse = { ok: true };

/** The `ops` array of `{ ops: [...] }` when its length is within limits. */
function opsArray(body: unknown): unknown[] | null {
  if (typeof body !== 'object' || body === null || !('ops' in body)) return null;
  const { ops } = body;
  return Array.isArray(ops) && ops.length >= 1 && ops.length <= MAX_OPS_PER_REQUEST ? ops : null;
}

/**
 * The signed-in user's own `AppData` (docs/multi-user.md §5.1). Every handler works on
 * `data.forUser(currentUser(c).id)`; the `X-Legko-User` rule (409 `user_mismatch`, D11) is enforced by `auth` before
 * a handler runs.
 */
export function registerDataRoutes(app: Hono<AppEnv>, { data, auth, now }: RouteDeps): void {
  app.get(API.data, auth, (c) => c.json(data.forUser(currentUser(c).id).read()));

  app.post(API.ops, auth, limitBody(BODY_LIMITS.bulk), async (c) => {
    const repo = data.forUser(currentUser(c).id);
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const raw = opsArray(body.value);
    if (!raw) return badRequest(c, `Очікується { ops: [...] } з 1–${MAX_OPS_PER_REQUEST} операцій`);

    // Validate everything first: one bad op rejects the whole batch, nothing is applied.
    const ops: Op[] = [];
    for (const [index, candidate] of raw.entries()) {
      const parsed = opSchema.safeParse(candidate);
      if (!parsed.success) {
        return apiError(c, 400, 'invalid_op', `Операція №${index}: ${describeIssue(parsed.error)}`, {
          index,
        });
      }
      ops.push(parsed.data);
    }
    repo.apply(ops);
    const res: OpsResponse = { ok: true, applied: ops.length };
    return c.json(res);
  });

  // A plain download link (no X-Legko-User needed): only ever this user's data.
  app.get(API.export, auth, (c) => {
    const snapshot = data.forUser(currentUser(c).id).read();
    const date = zonedNow(snapshot.settings.timezone, new Date(now())).date;
    c.header('Content-Disposition', `attachment; filename="legko-${date}.json"`);
    c.header('Content-Type', 'application/json; charset=utf-8');
    return c.body(JSON.stringify(snapshot, null, 2));
  });

  // Replaces this user's data only; nobody else's rows are touched.
  app.post(API.import, auth, limitBody(BODY_LIMITS.bulk), async (c) => {
    const repo = data.forUser(currentUser(c).id);
    const body = await readJson(c);
    if (!body) return badRequest(c, MESSAGES.badJson);
    const parsed = appDataSchema.safeParse(body.value);
    if (!parsed.success) return badRequest(c, describeIssue(parsed.error));
    repo.replaceAll(parsed.data);
    return c.json(OK);
  });
}
