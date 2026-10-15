import { existsSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { photoIdSchema } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDataRepo } from '../db/data';
import { openDatabase } from '../db/open';
import type { Database } from '../db/sqlite';
import { createLogger } from '../logger';
import { createPhotoGcJob } from './gc';
import {
  createPhotoStore,
  decodeUpload,
  isJpeg,
  newPhotoId,
  PHOTO_GC_GRACE_MS,
  PHOTO_MAX_BYTES,
  THUMB_MAX_BYTES,
  type PhotoStore,
} from './store';

const HOUR = 3600_000;
const T0 = Date.UTC(2026, 9, 9, 9, 0);

/** Bytes that pass the JPEG magic check (content is irrelevant to the store). */
const fakeJpeg = (size: number, fill = 7): Buffer => {
  const b = Buffer.alloc(size, fill);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

const b64 = (b: Buffer): string => b.toString('base64');

describe('photo ids and uploads', () => {
  it('generates 22-character base64url ids accepted by photoIdSchema', () => {
    const ids = new Set(Array.from({ length: 200 }, newPhotoId));
    expect(ids.size).toBe(200);
    for (const id of ids) {
      expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
      expect(photoIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it('recognises JPEG magic bytes', () => {
    expect(isJpeg(fakeJpeg(10))).toBe(true);
    expect(isJpeg(Buffer.from([0xff, 0xd8]))).toBe(false);
    expect(isJpeg(Buffer.from('\x89PNG\r\n\x1a\n', 'latin1'))).toBe(false);
  });

  it('decodes base64 and enforces format and decoded sizes', () => {
    const ok = decodeUpload({ full: b64(fakeJpeg(1000)), thumb: b64(fakeJpeg(100)) });
    expect(ok.ok && ok.photo.full.length === 1000 && ok.photo.thumb.length === 100).toBe(true);
    const png = Buffer.from('\x89PNG\r\n\x1a\n0000000000', 'latin1');
    expect(decodeUpload({ full: b64(png), thumb: b64(fakeJpeg(100)) })).toEqual({
      ok: false,
      problem: 'not_jpeg',
    });
    expect(decodeUpload({ full: b64(fakeJpeg(100)), thumb: b64(png) })).toEqual({
      ok: false,
      problem: 'not_jpeg',
    });
    expect(decodeUpload({ full: b64(fakeJpeg(PHOTO_MAX_BYTES + 1)), thumb: b64(fakeJpeg(100)) })).toEqual({
      ok: false,
      problem: 'too_large',
    });
    expect(decodeUpload({ full: b64(fakeJpeg(100)), thumb: b64(fakeJpeg(THUMB_MAX_BYTES + 1)) })).toEqual({
      ok: false,
      problem: 'too_large',
    });
    expect(
      decodeUpload({ full: b64(fakeJpeg(PHOTO_MAX_BYTES)), thumb: b64(fakeJpeg(THUMB_MAX_BYTES)) }).ok,
    ).toBe(true);
  });
});

describe('photo store', () => {
  let root: string;
  let dir: string;
  let db: Database;
  let clock: number;
  let store: PhotoStore;

  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'legko-photos-'));
    dir = join(root, 'photos');
    db = openDatabase(':memory:');
    clock = T0;
    store = createPhotoStore(db, dir, () => clock);
  });

  afterEach(() => {
    db.close();
    rmSync(root, { recursive: true, force: true });
  });

  const save = (size = 500) => store.save({ full: fakeJpeg(size, 1), thumb: fakeJpeg(50, 2) }, '2026-10-09');

  /** Makes a file look as old as `ms` before T0 (the GC compares mtimes for stray files). */
  const age = (name: string, ms: number): void => {
    const t = new Date(T0 - ms);
    utimesSync(join(dir, name), t, t);
  };

  it('creates the directory lazily and writes both files atomically', async () => {
    expect(existsSync(dir)).toBe(false);
    const id = await save(500);
    expect(readdirSync(dir).sort()).toEqual([`${id}.jpg`, `${id}_t.jpg`].sort());
    expect((await store.read(id, 'full'))?.length).toBe(500);
    expect((await store.read(id, 'thumb'))?.length).toBe(50);
    expect(db.prepare('SELECT id, date, created_at, bytes, thumb_bytes FROM photos').get()).toEqual({
      id,
      date: '2026-10-09',
      created_at: T0,
      bytes: 500,
      thumb_bytes: 50,
    });
  });

  it('returns null for unknown photos', async () => {
    expect(await store.read(newPhotoId(), 'full')).toBeNull();
    await save();
    expect(await store.read(newPhotoId(), 'thumb')).toBeNull();
  });

  it('GC: deletes unreferenced photos older than 24 h, keeps referenced and young ones', async () => {
    const repo = createDataRepo(db);
    const oldUnused = await save();
    const oldUsed = await save();
    clock = T0 + 23 * HOUR;
    const youngUnused = await save();
    repo.apply([
      {
        kind: 'day.put',
        date: '2026-10-09',
        value: { food: 'Борщ', kcal: null, trained: null, types: [], notes: '', photos: [oldUsed] },
      },
    ]);

    const result = store.collectGarbage(T0 + PHOTO_GC_GRACE_MS + 1);
    expect(result).toEqual({ photos: [oldUnused], strayFiles: [] });
    expect(await store.read(oldUnused, 'full')).toBeNull();
    expect(await store.read(oldUnused, 'thumb')).toBeNull();
    expect(await store.read(oldUsed, 'full')).not.toBeNull();
    expect(await store.read(youngUnused, 'thumb')).not.toBeNull();
    const ids = db
      .prepare('SELECT id FROM photos ORDER BY id')
      .all()
      .map((r) => r.id);
    expect(ids).toEqual([oldUsed, youngUnused].sort());

    // Once the day drops the photo, it goes too (a day later).
    repo.apply([{ kind: 'day.delete', date: '2026-10-09' }]);
    expect(store.collectGarbage(T0 + 2 * PHOTO_GC_GRACE_MS).photos.sort()).toEqual(
      [oldUsed, youngUnused].sort(),
    );
    expect(readdirSync(dir)).toEqual([]);
  });

  it('GC: keeps a photo referenced only by a meal, collects an unreferenced old one', async () => {
    const repo = createDataRepo(db);
    const mealOnly = await save();
    const unused = await save();
    // 13 photos over two meals: the derived day list holds the first 12 only.
    const many = await Promise.all(Array.from({ length: 12 }, () => save()));
    const meal = (id: string, time: string, photos: string[]) => ({
      kind: 'meal.put' as const,
      date: '2026-10-09',
      value: {
        id,
        type: 'Обід',
        time,
        text: 'Борщ',
        kcal: 500,
        protein: null,
        fat: null,
        carbs: null,
        photos,
      },
    });
    repo.apply([meal('m1', '08:00', many), meal('m2', '13:00', [mealOnly])]);
    expect(repo.read().days['2026-10-09']?.photos).toEqual(many);

    const result = store.collectGarbage(T0 + PHOTO_GC_GRACE_MS + 1);
    expect(result).toEqual({ photos: [unused], strayFiles: [] });
    expect(await store.read(mealOnly, 'full')).not.toBeNull();
  });

  it('GC: skips the whole run while a day has unreadable meal data', async () => {
    const lines: string[] = [];
    const logged = createPhotoStore(
      db,
      dir,
      () => clock,
      createLogger('warn', (line) => lines.push(line)),
    );
    const repo = createDataRepo(db);
    const unused = await save();
    const stray = `${newPhotoId()}.jpg`;
    writeFileSync(join(dir, stray), 'x');
    age(stray, 2 * PHOTO_GC_GRACE_MS);
    repo.apply([
      {
        kind: 'meal.put',
        date: '2026-10-09',
        value: {
          id: 'm1',
          type: '',
          time: null,
          text: 'Борщ',
          kcal: null,
          protein: null,
          fat: null,
          carbs: null,
        },
      },
    ]);
    db.prepare('UPDATE days SET meals = ?').run('[{"id": "m1", "photos": ["broken"');

    expect(logged.collectGarbage(T0 + 2 * PHOTO_GC_GRACE_MS)).toEqual({ photos: [], strayFiles: [] });
    expect(await store.read(unused, 'full')).not.toBeNull();
    expect(readdirSync(dir)).toContain(stray);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('photo gc: skipped');

    // Once the row is rewritten, collection resumes.
    repo.apply([{ kind: 'meal.delete', date: '2026-10-09', id: 'legacy' }]);
    expect(logged.collectGarbage(T0 + 2 * PHOTO_GC_GRACE_MS)).toEqual({
      photos: [unused],
      strayFiles: [stray],
    });
  });

  it('GC: removes old stray files of interrupted saves, nothing else', async () => {
    const kept = await save();
    const strayId = newPhotoId();
    const files = {
      stray: `${strayId}.jpg`,
      strayTmp: `${strayId}_t.jpg.0123456789ab.tmp`,
      young: `${newPhotoId()}.jpg`,
      foreign: 'notes.txt',
    };
    for (const name of Object.values(files)) writeFileSync(join(dir, name), 'x');
    for (const name of [files.stray, files.strayTmp, files.foreign, `${kept}.jpg`, `${kept}_t.jpg`]) {
      age(name, 2 * PHOTO_GC_GRACE_MS);
    }
    age(files.young, 0);

    const result = store.collectGarbage(T0 + 1);
    expect(result.photos).toEqual([]);
    expect(result.strayFiles.sort()).toEqual([files.stray, files.strayTmp].sort());
    expect(readdirSync(dir).sort()).toEqual(
      [`${kept}.jpg`, `${kept}_t.jpg`, files.young, files.foreign].sort(),
    );
  });

  it('GC tolerates a missing directory', () => {
    expect(store.collectGarbage(T0)).toEqual({ photos: [], strayFiles: [] });
  });
});

describe('photo GC job', () => {
  it('runs once a day after 03:40 Kyiv time and logs what it removed', () => {
    const calls: number[] = [];
    const lines: string[] = [];
    const job = createPhotoGcJob({
      photos: {
        dir: '',
        save: () => Promise.reject(new Error('unused')),
        read: () => Promise.resolve(null),
        collectGarbage: (now) => {
          calls.push(now);
          return { photos: calls.length === 1 ? ['a', 'b'] : [], strayFiles: [] };
        },
      },
      logger: createLogger('info', (line) => lines.push(line)),
    });
    // 2026-10-09 is in summer time: Kyiv = UTC+3.
    job.tick(new Date(Date.UTC(2026, 9, 9, 0, 39)));
    expect(calls).toHaveLength(0);
    job.tick(new Date(Date.UTC(2026, 9, 9, 0, 40)));
    job.tick(new Date(Date.UTC(2026, 9, 9, 12, 0)));
    expect(calls).toHaveLength(1);
    job.tick(new Date(Date.UTC(2026, 9, 10, 1, 0)));
    expect(calls).toHaveLength(2);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('photo gc: removed 2 unused photo(s)');
  });
});
