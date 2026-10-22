import {
  digestDay,
  digestSession,
  scheduleOf,
  type CoachClient,
  type CoachClientItem,
  type CoachClientResponse,
  type CoachClientStatus,
  type CoachWindow,
} from '@legko/shared';
import type { ClientId, DataReaders } from '../db/data';
import type { AuthedUser, UserRepo, UserRow } from '../db/users';
import type { Logger } from '../logger';
import type { PhotoReaders, PhotoVariant } from '../photos/store';

/**
 * The admin as a coach (docs/coach-cabinet.md §2.4): read-only access to the records of every `role = 'user'`
 * account. This module holds only reader objects (no write method exists on them), contains no SQL and never
 * reaches a `DataRepo` / `UserPhotos` (coach lint). Admins are never clients — the caller included.
 */

/** The actor is not an admin (the routes already answer 403 before this; defence in depth). */
export class NotCoach extends Error {
  override name = 'NotCoach';
  constructor() {
    super('Only an admin can read client records');
  }
}

export interface CoachAccess {
  /**
   * Every client (role user, any status), in `users.list()` order, with its digest for `window`. Logs one line
   * naming every client read, by id.
   */
  list(actor: AuthedUser, window: CoachWindow): CoachClientItem[];
  /** One client's profile + full copy (`foods: []`, no session tombstones), or null when `rawId` is not a client. Logs one line. */
  detail(actor: AuthedUser, rawId: string): CoachClientResponse | null;
  /**
   * A photo of that client: bytes, null when the photo is not theirs / missing, or 'no_client' when `rawId` is not
   * a client. `photoId` is already validated by the route. Logs one line.
   */
  photo(
    actor: AuthedUser,
    rawId: string,
    photoId: string,
    variant: PhotoVariant,
  ): Promise<Uint8Array<ArrayBuffer> | null | 'no_client'>;
}

export interface CoachAccessDeps {
  users: Pick<UserRepo, 'byId' | 'list'>;
  data: DataReaders;
  photos: PhotoReaders;
  logger: Logger;
}

const USER_ID_RE = /^[0-9a-f]{32}$/;

/** Throws `NotCoach` unless the actor is an admin. The first statement of every access method. */
function assertCoach(actor: AuthedUser): void {
  if (actor.role !== 'admin') throw new NotCoach();
}

/** The ONLY place a `ClientId` is minted; callers checked `row.role === 'user'` first. */
function asClient(row: UserRow): ClientId {
  return row.id as ClientId;
}

/**
 * `rawId` as a client: an existing account with role 'user', else null (malformed, unknown, any admin — the actor
 * included). Throws `NotCoach` for a non-admin actor before looking anything up. Exported for unit tests.
 */
export function resolveClient(
  users: Pick<UserRepo, 'byId'>,
  actor: AuthedUser,
  rawId: string,
): { id: ClientId; row: UserRow } | null {
  assertCoach(actor);
  const row = users.byId(rawId);
  if (!row || row.role !== 'user') return null;
  return { id: asClient(row), row };
}

const statusOf = (row: UserRow): CoachClientStatus =>
  row.disabledAt !== null ? 'disabled' : row.passwordHash === null ? 'pending' : 'active';

/** What the coach sees of an account: never a hash, a session, a token, a subscription or an invite. */
const profile = (row: UserRow): CoachClient => ({
  id: row.id,
  username: row.username,
  status: statusOf(row),
  createdAt: row.createdAt,
  lastSeenAt: row.lastSeenAt,
});

/** The raw id for the log: echoed only when it has the shape of a user id. */
const loggedId = (rawId: string): string => (USER_ID_RE.test(rawId) ? rawId : 'a malformed id');

export function createCoachAccess({ users, data, photos, logger }: CoachAccessDeps): CoachAccess {
  const log = (actor: AuthedUser, what: string): void => logger.info(`coach: admin ${actor.id} ${what}`);

  /** The client behind `rawId`, or null after logging the refusal. */
  function clientOrRefuse(actor: AuthedUser, rawId: string): { id: ClientId; row: UserRow } | null {
    const client = resolveClient(users, actor, rawId);
    if (!client) log(actor, `was refused ${loggedId(rawId)}`);
    return client;
  }

  return {
    list(actor, window) {
      assertCoach(actor);
      const items = users
        .list()
        .filter((row) => row.role === 'user')
        .map((row): CoachClientItem => {
          const reader = data.readerFor(asClient(row));
          const { first, last } = reader.recordSpan(window.to);
          const weights = reader.weights();
          return {
            client: profile(row),
            settings: reader.settings(),
            weights,
            measures: reader.measures(),
            days: reader.daysBetween(window.from, window.to).map(({ date, entry }) => digestDay(date, entry)),
            firstRecord: first,
            lastRecord: last,
            steps: reader.stepsBetween(window.from, window.to),
            sessions: reader.sessionsBetween(window.from, window.to).map((s) => digestSession(s, weights)),
            schedule: scheduleOf(reader.workouts()),
          };
        });
      // Which clients were read, by id only (never a name or content): the list is the widest read.
      const ids = items.length > 0 ? items.map((item) => item.client.id).join(',') : 'none';
      log(actor, `listed ${items.length} clients ${window.from}..${window.to}: ${ids}`);
      return items;
    },

    detail(actor, rawId) {
      assertCoach(actor);
      const client = clientOrRefuse(actor, rawId);
      if (!client) return null;
      const copy = data.readerFor(client.id).read();
      log(actor, `read client ${client.id}`);
      return { client: profile(client.row), data: { ...copy, foods: [], deletedSessions: [] } };
    },

    async photo(actor, rawId, photoId, variant) {
      assertCoach(actor);
      const client = clientOrRefuse(actor, rawId);
      if (!client) return 'no_client';
      const bytes = await photos.readerFor(client.id).read(photoId, variant);
      log(
        actor,
        bytes === null
          ? `found no such photo of client ${client.id}`
          : `viewed a photo of client ${client.id}`,
      );
      return bytes;
    },
  };
}
