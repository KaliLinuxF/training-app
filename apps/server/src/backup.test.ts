import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  backupFileName,
  createBackupJob,
  numberedSnapshotName,
  pruneBackups,
  writeBackup,
  writeSnapshotOnce,
} from './backup';
import { createDataRepos, type DataRepo } from './db/data';
import { openDatabase } from './db/open';
import { sqlite, type Database } from './db/sqlite';
import { createUserRepo } from './db/users';
import { createLogger, type Logger } from './logger';

let dir: string;
let db: Database;
/** One account's data (backups hold the whole database). */
let repo: DataRepo;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legko-backup-'));
  db = openDatabase(':memory:');
  const anna = createUserRepo(db).create({ username: 'anna', role: 'user', passwordHash: null, now: 0 }).id;
  repo = createDataRepos(db).forUser(anna);
  repo.apply([{ kind: 'weight.put', date: '2026-10-10', kg: 65.4 }]);
});

afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

function captureLogger(): Logger & { lines: string[] } {
  const lines: string[] = [];
  return Object.assign(
    createLogger('debug', (line) => lines.push(line)),
    { lines },
  );
}

describe('writeBackup', () => {
  it('writes a consistent copy of the database', () => {
    const file = writeBackup(db, join(dir, 'backups'), '2026-10-10');
    expect(file.endsWith(backupFileName('2026-10-10'))).toBe(true);
    const copy = new (sqlite().DatabaseSync)(file, { readOnly: true });
    try {
      expect(copy.prepare('SELECT kg FROM weights').get()).toEqual({ kg: 65.4 });
    } finally {
      copy.close();
    }
  });

  it('replaces an existing backup for the same date', () => {
    writeBackup(db, dir, '2026-10-10');
    repo.apply([{ kind: 'weight.put', date: '2026-10-11', kg: 65 }]);
    const file = writeBackup(db, dir, '2026-10-10');
    const copy = new (sqlite().DatabaseSync)(file, { readOnly: true });
    try {
      expect(copy.prepare('SELECT COUNT(*) AS n FROM weights').get()).toEqual({ n: 2 });
    } finally {
      copy.close();
    }
    expect(readdirSync(dir)).toEqual(['legko-2026-10-10.db']);
  });
});

describe('writeSnapshotOnce (pre-migration / pre-downgrade snapshots)', () => {
  const weights = (file: string): number => {
    const copy = new (sqlite().DatabaseSync)(file, { readOnly: true });
    try {
      return Number(copy.prepare('SELECT COUNT(*) AS n FROM weights').get()?.n);
    } finally {
      copy.close();
    }
  };

  it('never replaces an existing file: later copies get -2, -3, … and the first stays as it was', () => {
    const name = join(dir, 'backups', 'legko-pre-v4-2026-10-22.db');
    expect(writeSnapshotOnce(db, name)).toBe(name);
    const firstBytes = readFileSync(name);
    repo.apply([{ kind: 'weight.put', date: '2026-10-11', kg: 65 }]);
    expect(writeSnapshotOnce(db, name)).toBe(join(dir, 'backups', 'legko-pre-v4-2026-10-22-2.db'));
    repo.apply([{ kind: 'weight.put', date: '2026-10-12', kg: 64.8 }]);
    expect(writeSnapshotOnce(db, name)).toBe(join(dir, 'backups', 'legko-pre-v4-2026-10-22-3.db'));

    expect(readFileSync(name).equals(firstBytes)).toBe(true);
    expect(weights(name)).toBe(1);
    expect(weights(numberedSnapshotName(name, 2))).toBe(2);
    expect(weights(numberedSnapshotName(name, 3))).toBe(3);
    // No temp file is left behind.
    expect(readdirSync(join(dir, 'backups')).sort()).toEqual([
      'legko-pre-v4-2026-10-22-2.db',
      'legko-pre-v4-2026-10-22-3.db',
      'legko-pre-v4-2026-10-22.db',
    ]);
  });

  it('fills the first free number and keeps the copies out of the daily prune', () => {
    const name = join(dir, 'legko-pre-down-v4-2026-10-22.db');
    writeFileSync(name, 'not mine');
    writeFileSync(numberedSnapshotName(name, 2), 'not mine either');
    expect(writeSnapshotOnce(db, name)).toBe(join(dir, 'legko-pre-down-v4-2026-10-22-3.db'));
    expect(readFileSync(name, 'utf8')).toBe('not mine');
    expect(pruneBackups(dir, 0)).toEqual([]);
    expect(readdirSync(dir)).toHaveLength(3);
  });

  it('numbers names', () => {
    expect(numberedSnapshotName('/b/legko-pre-v4-2026-10-22.db', 1)).toBe('/b/legko-pre-v4-2026-10-22.db');
    expect(numberedSnapshotName('/b/legko-pre-v4-2026-10-22.db', 2)).toBe('/b/legko-pre-v4-2026-10-22-2.db');
    expect(numberedSnapshotName('/b/snapshot', 3)).toBe('/b/snapshot-3');
  });
});

describe('pruneBackups', () => {
  it('keeps the newest 30 backups and leaves other files alone', () => {
    const names = Array.from({ length: 35 }, (_, i) =>
      backupFileName(`2026-09-${String(i + 1).padStart(2, '0')}`),
    );
    // September has 30 days, so use two months worth of names.
    const all = [
      ...names.slice(0, 30),
      ...['2026-10-01', '2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05'].map(backupFileName),
    ];
    for (const n of all) writeFileSync(join(dir, n), '');
    writeFileSync(join(dir, 'notes.txt'), 'keep me');
    writeFileSync(join(dir, 'legko-2026-10-06.db.tmp'), '');

    const removed = pruneBackups(dir, 30);
    expect(removed.sort()).toEqual(
      ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05'].map(backupFileName),
    );
    const left = readdirSync(dir);
    expect(left).toHaveLength(31);
    expect(left).toContain('notes.txt');
    expect(left).toContain('legko-2026-10-05.db');
    expect(left).not.toContain('legko-2026-10-06.db.tmp');
  });

  it('copes with a missing directory', () => {
    expect(pruneBackups(join(dir, 'nope'))).toEqual([]);
  });
});

describe('createBackupJob', () => {
  // 2026-10-10 03:30 Kyiv (EEST) = 00:30 UTC.
  const slot = Date.UTC(2026, 9, 10, 0, 30);

  it('backs up at start-up when today’s file is missing', () => {
    const logger = captureLogger();
    const job = createBackupJob({ db, dir, logger });
    job.atStartup(new Date(slot - 3600_000));
    expect(existsSync(join(dir, 'legko-2026-10-10.db'))).toBe(true);
    expect(logger.lines.filter((l) => l.includes('backup (start-up)'))).toHaveLength(1);

    // Restarted later the same day: the file exists, nothing to do.
    const again = captureLogger();
    createBackupJob({ db, dir, logger: again }).atStartup(new Date(slot + 3600_000));
    expect(again.lines).toEqual([]);
  });

  it('runs once a day at 03:30 Kyiv time', () => {
    const logger = captureLogger();
    const job = createBackupJob({ db, dir, logger });
    job.atStartup(new Date(slot - 2 * 3600_000)); // 01:30, creates today's file
    job.tick(new Date(slot - 60_000)); // 03:29 → too early
    job.tick(new Date(slot)); // 03:30 → daily backup (refreshes today's file)
    job.tick(new Date(slot + 30_000));
    job.tick(new Date(slot + 12 * 3600_000));
    const daily = () => logger.lines.filter((l) => l.includes('backup (daily)')).length;
    expect(daily()).toBe(1);

    job.tick(new Date(slot + 24 * 3600_000)); // next day
    expect(daily()).toBe(2);
    expect(existsSync(join(dir, 'legko-2026-10-11.db'))).toBe(true);
  });

  it('a start after 03:30 counts as today’s run', () => {
    const logger = captureLogger();
    const job = createBackupJob({ db, dir, logger });
    job.atStartup(new Date(slot + 3600_000));
    job.tick(new Date(slot + 3600_000 + 30_000));
    expect(logger.lines.filter((l) => l.includes('backup (')).length).toBe(1);
  });

  it('logs failures instead of throwing', () => {
    const logger = captureLogger();
    const blocker = join(dir, 'file');
    writeFileSync(blocker, '');
    const job = createBackupJob({ db, dir: join(blocker, 'backups'), logger });
    expect(() => job.atStartup(new Date(slot))).not.toThrow();
    expect(logger.lines.some((l) => l.includes('backup failed'))).toBe(true);
  });

  it('prunes old backups after each run', () => {
    mkdirSync(dir, { recursive: true });
    for (let d = 1; d <= 30; d++)
      writeFileSync(join(dir, backupFileName(`2026-09-${String(d).padStart(2, '0')}`)), '');
    createBackupJob({ db, dir }).atStartup(new Date(slot));
    const files = readdirSync(dir);
    expect(files).toHaveLength(30);
    expect(files).not.toContain('legko-2026-09-01.db');
    expect(files).toContain('legko-2026-10-10.db');
  });
});
