import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { coachItemFromData, defaultSettings, type CoachWindow, type Op } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDataAccess, type DataReaders, type DataRepos } from '../db/data';
import { openDatabase } from '../db/open';
import type { Database } from '../db/sqlite';
import { authedUser, createUserRepo, type AuthedUser, type UserRepo, type UserRow } from '../db/users';
import type { Logger } from '../logger';
import { createPhotoAccess, type PhotoReaders, type PhotoStore } from '../photos/store';
import { createCoachAccess, NotCoach, resolveClient, type CoachAccess } from './access';

/** docs/coach-cabinet.md §2.4, C10, §8.1 «access». */

const T0 = Date.UTC(2026, 9, 9, 9, 0);
const WINDOW: CoachWindow = { from: '2026-09-11', to: '2026-10-15' };
const NOTE = 'SECRET-NOTE-текст';
const MEAL_TEXT = 'SECRET-MEAL-сирники';
const UNKNOWN_ID = 'f'.repeat(32);

const fakeJpeg = (size: number, fill = 7): Buffer => {
  const b = Buffer.alloc(size, fill);
  b.set([0xff, 0xd8, 0xff, 0xe0]);
  return b;
};

interface Spied {
  users: Pick<UserRepo, 'byId' | 'list'> & { byId: ReturnType<typeof vi.fn>; list: ReturnType<typeof vi.fn> };
  data: DataReaders & { readerFor: ReturnType<typeof vi.fn> };
  photos: PhotoReaders & { readerFor: ReturnType<typeof vi.fn> };
}

let root: string;
let db: Database;
let users: UserRepo;
let repos: DataRepos;
let store: PhotoStore;
let spied: Spied;
let lines: string[];
let access: CoachAccess;
let admin: UserRow;
let admin2: UserRow;
let anna: UserRow;
let pending: UserRow;
let disabled: UserRow;
let annaPhoto: string;
let adminPhoto: string;

const actor = (row: UserRow): AuthedUser => authedUser(row);

const capturing = (out: string[]): Logger => ({
  debug: (m) => out.push(m),
  info: (m) => out.push(m),
  warn: (m) => out.push(m),
  error: (m) => out.push(m),
});

beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), 'legko-coach-'));
  db = openDatabase(':memory:');
  users = createUserRepo(db);
  admin = users.create({ username: 'admin', role: 'admin', passwordHash: 'h', now: T0 });
  anna = users.create({ username: 'anna', role: 'user', passwordHash: 'h', now: T0 + 1 });
  admin2 = users.create({ username: 'boss', role: 'admin', passwordHash: 'h', now: T0 + 2 });
  pending = users.create({ username: 'nova', role: 'user', passwordHash: null, now: T0 + 3 });
  const off = users.create({ username: 'olya', role: 'user', passwordHash: 'h', now: T0 + 4 });
  users.setDisabled(off.id, T0 + 5);
  users.touch(anna.id, T0 + 6);
  anna = users.byId(anna.id)!;
  disabled = users.byId(off.id)!;

  const dataAccess = createDataAccess(db, () => T0);
  const photoAccess = createPhotoAccess(db, join(root, 'photos'), () => T0);
  repos = dataAccess.repos;
  store = photoAccess.store;

  annaPhoto = await store
    .forUser(anna.id)
    .save({ full: fakeJpeg(500, 1), thumb: fakeJpeg(50, 2) }, '2026-10-08');
  adminPhoto = await store
    .forUser(admin.id)
    .save({ full: fakeJpeg(400, 3), thumb: fakeJpeg(40, 4) }, '2026-10-08');
  const annaOps: Op[] = [
    {
      kind: 'meal.put',
      date: '2026-10-08',
      value: {
        id: 'breakfast001',
        type: 'Сніданок',
        time: '08:30',
        text: MEAL_TEXT,
        kcal: 420,
        protein: 27,
        fat: 11,
        carbs: 36,
        photos: [annaPhoto],
      },
    },
    { kind: 'day.meta', date: '2026-10-08', value: { trained: true, types: ['Кардіо'], notes: NOTE } },
    {
      kind: 'day.put',
      date: '2026-08-01',
      value: { food: 'Давно', kcal: 1500, trained: null, types: [], notes: '' },
    },
    { kind: 'weight.put', date: '2026-08-02', kg: 70 },
    { kind: 'weight.put', date: '2026-10-05', kg: 68.4 },
    { kind: 'measure.put', date: '2026-10-05', value: { chest: 90, waist: 70, hips: 98 } },
    { kind: 'weight.put', date: '2026-10-20', kg: 67 },
    { kind: 'food.use', date: '2026-10-08', value: { name: 'Сирники', portion: '2 шт', kcal: 300 } },
    { kind: 'settings.put', value: { ...defaultSettings(), goal: 60, timezone: 'Europe/Warsaw' } },
  ];
  repos.forUser(anna.id).apply(annaOps);
  repos
    .forUser(admin.id)
    .apply([
      {
        kind: 'day.put',
        date: '2026-10-08',
        value: { food: 'Адмінське', kcal: 1, trained: null, types: [], notes: 'A' },
      },
    ]);

  spied = {
    users: { byId: vi.fn(users.byId), list: vi.fn(users.list) },
    data: { readerFor: vi.fn(dataAccess.readers.readerFor) },
    photos: { readerFor: vi.fn(photoAccess.readers.readerFor) },
  };
  lines = [];
  access = createCoachAccess({ ...spied, logger: capturing(lines) });
});

afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

const touchedNothing = (): void => {
  expect(spied.users.byId).not.toHaveBeenCalled();
  expect(spied.users.list).not.toHaveBeenCalled();
  expect(spied.data.readerFor).not.toHaveBeenCalled();
  expect(spied.photos.readerFor).not.toHaveBeenCalled();
};

describe('a non-admin actor', () => {
  it('list / detail / photo throw NotCoach before any lookup or read', async () => {
    const user = actor(anna);
    expect(() => access.list(user, WINDOW)).toThrow(NotCoach);
    expect(() => access.detail(user, anna.id)).toThrow(NotCoach);
    expect(() => access.detail(user, pending.id)).toThrow(NotCoach);
    await expect(access.photo(user, anna.id, annaPhoto, 'full')).rejects.toThrow(NotCoach);
    await expect(access.photo(user, pending.id, annaPhoto, 'thumb')).rejects.toThrow(NotCoach);
    expect(() => resolveClient(spied.users, user, anna.id)).toThrow(NotCoach);
    touchedNothing();
    expect(lines).toEqual([]);
  });

  it('a demoted admin is refused at once (the role on the actor is what counts)', () => {
    expect(() => access.list({ ...actor(admin), role: 'user' }, WINDOW)).toThrow(NotCoach);
    touchedNothing();
  });
});

describe('resolveClient', () => {
  it('only an existing role-user account is a client', () => {
    const me = actor(admin);
    expect(resolveClient(users, me, anna.id)).toEqual({ id: anna.id, row: anna });
    expect(resolveClient(users, me, pending.id)?.row.username).toBe('nova');
    expect(resolveClient(users, me, disabled.id)?.row.username).toBe('olya');
    expect(resolveClient(users, me, admin.id)).toBeNull(); // self
    expect(resolveClient(users, me, admin2.id)).toBeNull(); // another admin
    expect(resolveClient(users, me, UNKNOWN_ID)).toBeNull();
    expect(resolveClient(users, me, 'not-an-id')).toBeNull();
    expect(resolveClient(users, me, anna.id.toUpperCase())).toBeNull();
    expect(resolveClient(users, me, '')).toBeNull();
  });
});

describe('list', () => {
  it('lists every role-user account (pending and disabled with their status), never an admin', () => {
    const items = access.list(actor(admin), WINDOW);
    expect(items.map((i) => [i.client.username, i.client.status])).toEqual([
      ['anna', 'active'],
      ['nova', 'pending'],
      ['olya', 'disabled'],
    ]);
    expect(JSON.stringify(items)).not.toContain('Адмінське');
    expect(spied.data.readerFor.mock.calls.map(([id]) => id)).toEqual([anna.id, pending.id, disabled.id]);
  });

  it('an item equals what coachItemFromData builds from the full copy', () => {
    const [item] = access.list(actor(admin), WINDOW);
    const { foods: _foods, ...copy } = repos.forUser(anna.id).read();
    const client = {
      id: anna.id,
      username: 'anna',
      status: 'active' as const,
      createdAt: T0 + 1,
      lastSeenAt: T0 + 6,
    };
    expect(item).toEqual(coachItemFromData(client, { ...copy, foods: [] }, WINDOW));
    // Window only for days; weights / measures all; the span ignores the 10-20 weigh-in after `to`.
    expect(item?.days.map((d) => d.date)).toEqual(['2026-10-08']);
    expect(item?.days[0]).toMatchObject({ kcal: 420, trained: true, meals: 1 });
    expect(item?.weights.map((w) => w.date)).toEqual(['2026-08-02', '2026-10-05', '2026-10-20']);
    expect(item?.firstRecord).toBe('2026-08-01');
    expect(item?.lastRecord).toBe('2026-10-08');
    expect(JSON.stringify(item)).not.toContain(MEAL_TEXT);
    expect(JSON.stringify(item)).not.toContain(NOTE);
    expect(JSON.stringify(item)).not.toContain(annaPhoto);
  });

  it('the profile has exactly id, username, status, createdAt, lastSeenAt', () => {
    for (const item of access.list(actor(admin), WINDOW)) {
      expect(Object.keys(item.client).sort()).toEqual([
        'createdAt',
        'id',
        'lastSeenAt',
        'status',
        'username',
      ]);
    }
  });

  it('logs one line with the count, the window and the id of every client read (no names, no content)', () => {
    access.list(actor(admin), WINDOW);
    expect(lines).toEqual([
      `coach: admin ${admin.id} listed 3 clients 2026-09-11..2026-10-15: ${anna.id},${pending.id},${disabled.id}`,
    ]);
    const text = lines.join('\n');
    for (const content of ['anna', 'nova', 'olya', admin2.id, MEAL_TEXT, NOTE, annaPhoto]) {
      expect(text).not.toContain(content);
    }
  });

  it('with no clients the line says «none»', () => {
    const onlyAdmins = createCoachAccess({
      ...spied,
      users: { byId: users.byId, list: () => users.list().filter((row) => row.role === 'admin') },
      logger: capturing(lines),
    });
    expect(onlyAdmins.list(actor(admin), WINDOW)).toEqual([]);
    expect(lines).toEqual([`coach: admin ${admin.id} listed 0 clients 2026-09-11..2026-10-15: none`]);
    expect(spied.data.readerFor).not.toHaveBeenCalled();
  });
});

describe('detail', () => {
  it('is the profile + the full copy with foods: []', () => {
    const found = access.detail(actor(admin), anna.id);
    const full = repos.forUser(anna.id).read();
    expect(full.foods).toHaveLength(1);
    expect(found).toEqual({
      client: { id: anna.id, username: 'anna', status: 'active', createdAt: T0 + 1, lastSeenAt: T0 + 6 },
      data: { ...full, foods: [] },
    });
    expect(Object.keys(found!.client).sort()).toEqual([
      'createdAt',
      'id',
      'lastSeenAt',
      'status',
      'username',
    ]);
    expect(lines).toEqual([`coach: admin ${admin.id} read client ${anna.id}`]);
  });

  it('null for self, another admin, unknown and malformed ids; each refusal is logged', () => {
    const me = actor(admin);
    expect(access.detail(me, admin.id)).toBeNull();
    expect(access.detail(me, admin2.id)).toBeNull();
    expect(access.detail(me, UNKNOWN_ID)).toBeNull();
    expect(access.detail(me, '../etc/passwd')).toBeNull();
    expect(spied.data.readerFor).not.toHaveBeenCalled();
    expect(lines).toEqual([
      `coach: admin ${admin.id} was refused ${admin.id}`,
      `coach: admin ${admin.id} was refused ${admin2.id}`,
      `coach: admin ${admin.id} was refused ${UNKNOWN_ID}`,
      `coach: admin ${admin.id} was refused a malformed id`,
    ]);
  });

  it('pending and disabled clients can be read', () => {
    expect(access.detail(actor(admin), pending.id)?.client.status).toBe('pending');
    expect(access.detail(actor(admin2), disabled.id)?.client.status).toBe('disabled');
  });
});

describe('photo', () => {
  it('serves a photo the client owns and logs «viewed a photo»', async () => {
    const full = await access.photo(actor(admin), anna.id, annaPhoto, 'full');
    const thumb = await access.photo(actor(admin), anna.id, annaPhoto, 'thumb');
    expect(full).toBeInstanceOf(Uint8Array);
    expect((full as Uint8Array).length).toBe(500);
    expect((thumb as Uint8Array).length).toBe(50);
    expect(lines).toEqual([
      `coach: admin ${admin.id} viewed a photo of client ${anna.id}`,
      `coach: admin ${admin.id} viewed a photo of client ${anna.id}`,
    ]);
  });

  it('null for a photo the client does not own or that does not exist; «found no such photo», no photo id', async () => {
    expect(await access.photo(actor(admin), anna.id, adminPhoto, 'full')).toBeNull();
    expect(await access.photo(actor(admin), pending.id, annaPhoto, 'thumb')).toBeNull();
    expect(lines).toEqual([
      `coach: admin ${admin.id} found no such photo of client ${anna.id}`,
      `coach: admin ${admin.id} found no such photo of client ${pending.id}`,
    ]);
    for (const line of lines) {
      expect(line).not.toContain(adminPhoto);
      expect(line).not.toContain(annaPhoto);
    }
  });

  it("'no_client' for an admin (self included), unknown or malformed id; nothing read", async () => {
    const me = actor(admin);
    expect(await access.photo(me, admin.id, adminPhoto, 'full')).toBe('no_client');
    expect(await access.photo(me, admin2.id, adminPhoto, 'full')).toBe('no_client');
    expect(await access.photo(me, UNKNOWN_ID, annaPhoto, 'full')).toBe('no_client');
    expect(await access.photo(me, 'x', annaPhoto, 'full')).toBe('no_client');
    expect(spied.photos.readerFor).not.toHaveBeenCalled();
    expect(lines).toEqual([
      `coach: admin ${admin.id} was refused ${admin.id}`,
      `coach: admin ${admin.id} was refused ${admin2.id}`,
      `coach: admin ${admin.id} was refused ${UNKNOWN_ID}`,
      `coach: admin ${admin.id} was refused a malformed id`,
    ]);
  });
});

describe('log content', () => {
  it('never contains note, meal, food or photo content', async () => {
    const me = actor(admin);
    access.list(me, WINDOW);
    access.detail(me, anna.id);
    await access.photo(me, anna.id, annaPhoto, 'full');
    await access.photo(me, anna.id, adminPhoto, 'thumb');
    access.detail(me, 'garbage<script>');
    expect(lines).toHaveLength(5);
    const all = lines.join('\n');
    for (const secret of [
      NOTE,
      MEAL_TEXT,
      'Сирники',
      'Сніданок',
      'Europe/Warsaw',
      '68.4',
      annaPhoto,
      'garbage',
    ]) {
      expect(all).not.toContain(secret);
    }
    for (const line of lines) expect(line).toMatch(/^coach: admin [0-9a-f]{32} /);
  });
});

describe('readers handed to access', () => {
  it('the data reader has only read methods and is frozen; the photo reader only `read`', () => {
    access.detail(actor(admin), anna.id);
    access.list(actor(admin), WINDOW);
    for (const result of spied.data.readerFor.mock.results) {
      const reader = result.value as object;
      expect(Object.keys(reader).sort()).toEqual([
        'daysBetween',
        'measures',
        'read',
        'recordSpan',
        'settings',
        'weights',
      ]);
      expect(Object.isFrozen(reader)).toBe(true);
    }
  });

  it('the photo reader has only `read` and is frozen', async () => {
    await access.photo(actor(admin), anna.id, annaPhoto, 'full');
    const reader = spied.photos.readerFor.mock.results[0]?.value as object;
    expect(Object.keys(reader)).toEqual(['read']);
    expect(Object.isFrozen(reader)).toBe(true);
  });
});
