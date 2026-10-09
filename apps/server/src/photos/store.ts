import { randomBytes } from 'node:crypto';
import { readdirSync, rmSync, statSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ISODate } from '@legko/shared';
import { text } from '../db/rows';
import type { Database } from '../db/sqlite';
import { transaction } from '../db/tx';

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

export interface PhotoStore {
  readonly dir: string;
  /** Writes both files atomically, then records the photo. Returns its new id. */
  save(photo: PhotoUpload, date: ISODate): Promise<string>;
  /** File contents, or null when there is no such photo. `id` must already be validated. */
  read(id: string, variant: PhotoVariant): Promise<Uint8Array<ArrayBuffer> | null>;
  /**
   * Deletes photos (rows and files) that no day references and that are older than the grace
   * period, plus stray files without a row (interrupted saves). Returns the removed ids/files.
   */
  collectGarbage(now: number): { photos: string[]; strayFiles: string[] };
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

export function createPhotoStore(db: Database, dir: string, now: () => number = Date.now): PhotoStore {
  const q = {
    insert: db.prepare(
      'INSERT INTO photos (id, date, created_at, bytes, thumb_bytes) VALUES (?, ?, ?, ?, ?)',
    ),
    exists: db.prepare('SELECT 1 AS found FROM photos WHERE id = ?'),
    unreferencedBefore: db.prepare(
      `SELECT id FROM photos p WHERE p.created_at < ?
         AND NOT EXISTS (SELECT 1 FROM days d, json_each(d.photos) j WHERE j.value = p.id)`,
    ),
    delete: db.prepare('DELETE FROM photos WHERE id = ?'),
  };
  const fileOf = (id: string, variant: PhotoVariant): string => join(dir, photoFileName(id, variant));

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

  return {
    dir,

    async save(photo, date) {
      await mkdir(dir, { recursive: true });
      const id = newPhotoId();
      // Files first: a crash leaves stray files (collected later), never a row without files.
      await writeAtomically(fileOf(id, 'full'), photo.full);
      await writeAtomically(fileOf(id, 'thumb'), photo.thumb);
      q.insert.run(id, date, now(), photo.full.length, photo.thumb.length);
      return id;
    },

    async read(id, variant) {
      try {
        return await readFile(fileOf(id, variant));
      } catch (err) {
        if (isMissingFile(err)) return null;
        throw err;
      }
    },

    collectGarbage(at) {
      const cutoff = at - PHOTO_GC_GRACE_MS;
      const photos = transaction(db, () => {
        const ids = q.unreferencedBefore.all(cutoff).map((row) => text(row, 'id'));
        for (const id of ids) q.delete.run(id);
        return ids;
      });
      for (const id of photos) {
        rmSync(fileOf(id, 'full'), { force: true });
        rmSync(fileOf(id, 'thumb'), { force: true });
      }
      return { photos, strayFiles: removeStrayFiles(cutoff) };
    },
  };
}
