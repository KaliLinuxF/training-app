import { randomBytes } from 'node:crypto';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ISODate } from '@legko/shared';
import { num, text } from '../db/rows';
import type { Database } from '../db/sqlite';
import { transaction } from '../db/tx';
import type { UserId } from '../db/users';
import { silentLogger, type Logger } from '../logger';

/** Decoded size limits (the client downscales to ≤ 1280 px / ≤ 320 px JPEGs, far below these). */
export const PHOTO_MAX_BYTES = 2 * 1024 * 1024;
export const THUMB_MAX_BYTES = 300 * 1024;
/** Unreferenced photos survive this long: the estimate is stored before the day that uses it. */
export const PHOTO_GC_GRACE_MS = 24 * 3600_000;

export type PhotoVariant = 'full' | 'thumb';

export const photosDir = (dataDir: string): string => join(dataDir, 'photos');

/** 22-character base64url id (128 random bits) — matches `photoIdSchema`. */
export const newPhotoId = (): string => randomBytes(16).toString('base64url');

export const photoFileName = (id: string, variant: PhotoVariant): string =>
  variant === 'full' ? `${id}.jpg` : `${id}_t.jpg`;

/** Every JPEG starts with an SOI marker followed by another marker: FF D8 FF. */
export const isJpeg = (bytes: Uint8Array): boolean =>
  bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

export interface PhotoUpload {
  full: Buffer;
  thumb: Buffer;
}

export type DecodedUpload =
  { ok: true; photo: PhotoUpload } | { ok: false; problem: 'not_jpeg' | 'too_large' };

/** Base64 (already charset-checked by the request schema) → JPEG bytes within the size limits. */
export function decodeUpload(image: { full: string; thumb: string }): DecodedUpload {
  const full = Buffer.from(image.full, 'base64');
  const thumb = Buffer.from(image.thumb, 'base64');
  if (!isJpeg(full) || !isJpeg(thumb)) return { ok: false, problem: 'not_jpeg' };
  if (full.length > PHOTO_MAX_BYTES || thumb.length > THUMB_MAX_BYTES)
    return { ok: false, problem: 'too_large' };
  return { ok: true, photo: { full, thumb } };
}

/** One user's photos: they can store new ones and read their own only (D13). */
export interface UserPhotos {
  /** Writes both files atomically, then records the photo as this user's. Returns its new id. */
  save(photo: PhotoUpload, date: ISODate): Promise<string>;
  /**
   * File contents, or null when there is no such photo OR it belongs to someone else (the route answers 404 either
   * way: no existence oracle). `id` must already be validated.
   */
  read(id: string, variant: PhotoVariant): Promise<Uint8Array<ArrayBuffer> | null>;
}

export interface GarbageReport {
  photos: string[];
  strayFiles: string[];
  /** Accounts whose photos were all kept this run because one of their days has unreadable meal data. */
  skippedUsers: number;
}

export interface PhotoStore {
  readonly dir: string;
  forUser(id: UserId): UserPhotos;
  /**
   * Deletes photos (rows and files) that no day and no meal OF THEIR OWNER references and that are older than the
   * grace period, plus stray files without a row (interrupted saves, a crash during a user delete). An owner with an
   * unreadable meal row keeps every photo until it is rewritten (D14); other owners are collected as usual.
   */
  collectGarbage(now: number): GarbageReport;
  /** Removes the files of photos whose rows are already gone (after a user delete commits). */
  removeFiles(ids: readonly string[]): void;
}

async function writeAtomically(file: string, bytes: Uint8Array): Promise<void> {
  const tmp = `${file}.${randomBytes(6).toString('hex')}.tmp`;
  try {
    await writeFile(tmp, bytes);
    await rename(tmp, file);
  } catch (err) {
    await rm(tmp, { force: true });
    throw err;
  }
}

const isMissingFile = (err: unknown): boolean =>
  err instanceof Error && 'code' in err && (err.code === 'ENOENT' || err.code === 'ENOTDIR');

/** Files this store writes: `<id>.jpg`, `<id>_t.jpg` and their `.<hex>.tmp` siblings. */
const OWN_FILE = /^([A-Za-z0-9_-]{16,42})\.jpg(?:\.[0-9a-f]{12}\.tmp)?$/;

/** Photo ids an own file can belong to (an id may itself end in `_t`). */
function candidateIds(stem: string): string[] {
  return stem.endsWith('_t') ? [stem, stem.slice(0, -2)] : [stem];
}

export function createPhotoStore(
  db: Database,
  dir: string,
  now: () => number = Date.now,
  logger: Logger = silentLogger,
): PhotoStore {
  const q = {
    insert: db.prepare(
      'INSERT INTO photos (id, user_id, date, created_at, bytes, thumb_bytes) VALUES (?, ?, ?, ?, ?, ?)',
    ),
    owned: db.prepare('SELECT 1 AS found FROM photos WHERE id = ? AND user_id = ?'),
    // Global on purpose: a file without ANY row is a stray (whoever it belonged to).
    exists: db.prepare('SELECT 1 AS found FROM photos WHERE id = ?'),
    // Accounts with a meal list SQLite cannot read: their photos could look unreferenced (a count, no content).
    corruptOwners: db.prepare(
      'SELECT COUNT(DISTINCT user_id) AS n FROM days WHERE meals IS NOT NULL AND NOT json_valid(meals)',
    ),
    // Referenced = in a day's (derived) photo list or in any meal's photos, of the photo's OWNER only. `json_each`
    // throws on malformed JSON, hence the json_valid guard; an owner with such a row keeps everything (D14).
    unreferencedBefore: db.prepare(
      `SELECT p.id, p.user_id FROM photos p WHERE p.created_at < ?
         AND NOT EXISTS (SELECT 1 FROM days d WHERE d.user_id = p.user_id
                           AND d.meals IS NOT NULL AND NOT json_valid(d.meals))
         AND NOT EXISTS (SELECT 1 FROM days d, json_each(d.photos) j
                         WHERE d.user_id = p.user_id AND j.value = p.id)
         AND NOT EXISTS (SELECT 1 FROM days d,
                           json_each(CASE WHEN json_valid(d.meals) THEN d.meals ELSE '[]' END) m,
                           json_each(m.value, '$.photos') j
                         WHERE d.user_id = p.user_id AND j.value = p.id)`,
    ),
    delete: db.prepare('DELETE FROM photos WHERE id = ? AND user_id = ?'),
  };
  const fileOf = (id: string, variant: PhotoVariant): string => join(dir, photoFileName(id, variant));

  function removeFiles(ids: readonly string[]): void {
    for (const id of ids) {
      rmSync(fileOf(id, 'full'), { force: true });
      rmSync(fileOf(id, 'thumb'), { force: true });
    }
  }

  function removeStrayFiles(cutoff: number): string[] {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch (err) {
      if (isMissingFile(err)) return [];
      throw err;
    }
    const removed: string[] = [];
    for (const name of names) {
      const stem = OWN_FILE.exec(name)?.[1];
      if (!stem || candidateIds(stem).some((id) => q.exists.get(id) !== undefined)) continue;
      const file = join(dir, name);
      const stat = statSync(file, { throwIfNoEntry: false });
      if (!stat?.isFile() || stat.mtimeMs >= cutoff) continue;
      rmSync(file, { force: true });
      removed.push(name);
    }
    return removed;
  }

  function forUser(userId: UserId): UserPhotos {
    return {
      async save(photo, date) {
        await mkdir(dir, { recursive: true });
        const id = newPhotoId();
        // Files first: a crash leaves stray files (collected later), never a row without files.
        await writeAtomically(fileOf(id, 'full'), photo.full);
        await writeAtomically(fileOf(id, 'thumb'), photo.thumb);
        q.insert.run(id, userId, date, now(), photo.full.length, photo.thumb.length);
        return id;
      },

      async read(id, variant) {
        if (q.owned.get(id, userId) === undefined) return null;
        try {
          return await readFile(fileOf(id, variant));
        } catch (err) {
          if (isMissingFile(err)) return null;
          throw err;
        }
      },
    };
  }

  return {
    dir,
    forUser,
    removeFiles,

    collectGarbage(at) {
      const cutoff = at - PHOTO_GC_GRACE_MS;
      const { photos, skippedUsers } = transaction(db, () => {
        const skipped = num(q.corruptOwners.get() ?? { n: 0 }, 'n');
        const candidates = q.unreferencedBefore
          .all(cutoff)
          .map((row) => ({ id: text(row, 'id'), owner: text(row, 'user_id') }));
        const deleted: string[] = [];
        for (const { id, owner } of candidates) {
          if (Number(q.delete.run(id, owner).changes) === 1) deleted.push(id);
        }
        return { photos: deleted, skippedUsers: skipped };
      });
      if (skippedUsers > 0) {
        logger.warn(`photo gc: kept the photos of ${skippedUsers} account(s) with unreadable meal data`);
      }
      removeFiles(photos);
      return { photos, strayFiles: removeStrayFiles(cutoff), skippedUsers };
    },
  };
}
