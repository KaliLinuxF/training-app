import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { API, DEFAULT_AI_LIMITS, MAX_PENDING_INVITES, type UserRole } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createScryptGate, hashPassword, verifyPassword } from '../auth/password';
import { createSessionStore } from '../auth/sessions';
import { createDataRepos } from '../db/data';
import { migrate, MIGRATIONS, schemaVersion } from '../db/migrations';
import { databasePath, openDatabase } from '../db/open';
import { sqlite, type Database } from '../db/sqlite';
import { createTokenRepo, hashToken, type TokenRepo } from '../db/tokens';
import { createUserRepo, type UserId, type UserRepo } from '../db/users';
import { createFoodBudget } from '../food/budget';
import { createApp } from '../http/app';
import { readFirstLine } from './prompt';
import { runCli, USAGE, type CliIo } from './run';

const SCRYPT = { N: 1024, r: 8, p: 1 };
/** 12:00 in Kyiv. */
const AT = new Date('2026-10-22T09:00:00Z');
const PASSWORD = 'correct horse battery';
const TOKEN_IN = /#([A-Za-z0-9_-]{43})\b/;

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legko-cli-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

interface RunResult {
  code: number;
  out: string;
  err: string;
}

async function run(
  argv: readonly string[],
  { stdin = '', env = {} }: { stdin?: string; env?: Record<string, string> } = {},
): Promise<RunResult> {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (c: Buffer) => (out += c.toString()));
  stderr.on('data', (c: Buffer) => (err += c.toString()));
  const io: CliIo = {
    env: { DATA_DIR: dir, ...env },
    cwd: dir,
    stdin: Readable.from([Buffer.from(stdin)]),
    stdout,
    stderr,
    scrypt: SCRYPT,
    now: () => AT,
  };
  const code = await runCli(argv, io);
  return { code, out, err };
}

interface Repos {
  db: Database;
  users: UserRepo;
  tokens: TokenRepo;
}

/** Opens the CLI's database file (migrated), runs `fn`, closes it. */
async function withDb<T>(fn: (repos: Repos) => Promise<T> | T): Promise<T> {
  const db = openDatabase(databasePath(dir), { now: () => AT });
  try {
    return await fn({ db, users: createUserRepo(db), tokens: createTokenRepo(db) });
  } finally {
    db.close();
  }
}

const hash = (password: string) => hashPassword(password, SCRYPT, createScryptGate());

async function addUser(
  users: UserRepo,
  username: string,
  role: UserRole = 'user',
  password: string | null = PASSWORD,
): Promise<UserId> {
  const passwordHash = password === null ? null : await hash(password);
  return users.create({ username, role, passwordHash, now: AT.getTime() - 86_400_000 }).id;
}

const tokenOf = (out: string): string => TOKEN_IN.exec(out)?.[1] ?? '';

/** The real app on the CLI's database file, as the server would run it. */
function appOn(db: Database) {
  const app = createApp({
    db,
    config: {
      production: false,
      publicOrigin: 'https://fit.triple-a.dev',
      trustProxy: false,
      staticDir: null,
    },
    photosDir: join(dir, 'photos'),
    now: () => AT.getTime(),
    scrypt: SCRYPT,
    scryptGate: createScryptGate(),
  });
  const post = (path: string, body: unknown, cookie?: string) =>
    Promise.resolve(
      app.request(path, {
        method: 'POST',
        headers: {
          Origin: 'http://localhost',
          'Content-Type': 'application/json',
          ...(cookie ? { Cookie: cookie } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const get = (path: string, cookie: string) =>
    Promise.resolve(app.request(path, { headers: { Cookie: cookie } }));
  return { post, get };
}

const cookieOf = (res: Response): string =>
  res.headers
    .getSetCookie()
    .map((h) => h.split(';')[0] ?? '')
    .find((p) => p.startsWith('sid=') && p.length > 4) ?? '';

describe('cli create-admin', () => {
  it('creates an admin without a password and prints a setup link (PUBLIC_ORIGIN) that works through the app', async () => {
    const result = await run(['create-admin', 'admin'], { env: { PUBLIC_ORIGIN: 'https://legko.test' } });
    expect(result.code).toBe(0);
    expect(result.err).toBe('');
    expect(result.out).toMatch(/^Admin account admin created, without a password\.\n/);
    expect(result.out).toMatch(/\nhttps:\/\/legko\.test\/reset#[A-Za-z0-9_-]{43}\n/);
    expect(result.out).toContain('valid until 2026-10-23 12:00 Kyiv time');
    expect(result.out).toContain('If it expires: reset-password-link admin');
    const token = tokenOf(result.out);

    await withDb(async ({ db, users, tokens }) => {
      const admin = users.byKey('admin');
      expect(admin).toMatchObject({ role: 'admin', passwordHash: null });
      expect(tokens.listPending(AT.getTime())).toMatchObject([
        { kind: 'setup', forUsername: 'admin', createdBy: null },
      ]);

      const { post, get } = appOn(db);
      const check = await post(API.resetCheck, { token });
      expect(check.status).toBe(200);
      expect(await check.json()).toMatchObject({ ok: true, username: 'admin', purpose: 'setup' });

      const done = await post(API.resetComplete, { token, password: 'the owner’s own password' });
      expect(done.status).toBe(200);
      expect(await done.json()).toMatchObject({ ok: true, user: { username: 'admin', role: 'admin' } });
      const overview = await get(API.adminUsers, cookieOf(done));
      expect(overview.status).toBe(200);

      // Single use.
      const again = await post(API.resetComplete, { token, password: 'someone else’s password' });
      expect(again.status).toBe(410);
      expect(await again.json()).toMatchObject({ error: 'link_invalid', reason: 'used' });
    });
  });

  it('refuses an existing admin (any case), naming its role and the reset command; no link is made', async () => {
    await withDb(({ users }) => addUser(users, 'admin', 'admin'));
    for (const name of ['admin', 'ADMIN']) {
      const result = await run(['create-admin', name]);
      expect(result.code).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toBe(
        'User admin already exists (admin). For a new password link: reset-password-link admin\n',
      );
    }
    await withDb(({ tokens }) => expect(tokens.listPending(AT.getTime())).toEqual([]));
  });

  it('refuses a regular user’s name without suggesting a reset link', async () => {
    await withDb(({ users }) => addUser(users, 'anna'));
    const result = await run(['create-admin', 'anna']);
    expect(result.code).toBe(1);
    expect(result.err).toBe('User anna exists as a regular user — pick another name\n');
    expect(result.err).not.toContain('reset-password-link');
    await withDb(({ users, tokens }) => {
      expect(users.byKey('anna')?.role).toBe('user');
      expect(tokens.listPending(AT.getTime())).toEqual([]);
    });
  });

  it('validates the name and the arguments', async () => {
    expect(await run(['create-admin', 'legko'])).toMatchObject({
      code: 1,
      err: 'That username is reserved.\n',
    });
    expect((await run(['create-admin', 'ab'])).err).toBe('Usernames are 3–32 characters.\n');
    expect((await run(['create-admin', 'ad min'])).code).toBe(1);
    expect((await run(['create-admin'])).code).toBe(2);
    expect((await run(['create-admin', 'a1', 'b2'])).code).toBe(2);
    await withDb(({ users }) => expect(users.count()).toBe(0));
  });
});

describe('cli create-invite', () => {
  it('prints a 7-day invite link for a regular user, made by the CLI', async () => {
    const result = await run(['create-invite']);
    expect(result.code).toBe(0);
    // Seven days later on the Kyiv clock, across the switch to winter time (25 October).
    expect(result.out).toMatch(
      /^Invite for a new user account — single use, valid until 2026-10-29 11:00 Kyiv time:\n/,
    );
    expect(result.out).toMatch(/\nhttps:\/\/fit\.triple-a\.dev\/invite#[A-Za-z0-9_-]{43}\n$/);
    await withDb(({ tokens }) => {
      const check = tokens.checkInvite(tokenOf(result.out), AT.getTime());
      expect(check).toMatchObject({ ok: true, link: { role: 'user', createdBy: null, note: '' } });
    });
  });

  it('--admin --note makes an admin invite with a note; the link registers an admin through the app', async () => {
    const result = await run(['create-invite', '--admin', '--note', '  для Олі  ']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Invite for a new ADMIN account (для Олі)');
    await withDb(async ({ db, tokens, users }) => {
      const token = tokenOf(result.out);
      expect(tokens.checkInvite(token, AT.getTime())).toMatchObject({
        ok: true,
        link: { role: 'admin', note: 'для Олі' },
      });
      const { post } = appOn(db);
      const res = await post(API.inviteAccept, { token, username: 'olya', password: 'olya-password' });
      expect(res.status).toBe(200);
      expect(users.byKey('olya')?.role).toBe('admin');
    });
  });

  it('validates its options and the pending-invite cap', async () => {
    expect((await run(['create-invite', '--note', 'x'.repeat(61)])).code).toBe(2);
    expect((await run(['create-invite', '--note'])).code).toBe(2);
    expect((await run(['create-invite', '--role', 'admin'])).code).toBe(2);
    expect((await run(['create-invite', 'olya'])).code).toBe(2);
    await withDb(({ tokens }) => {
      for (let i = 0; i < MAX_PENDING_INVITES; i++) {
        tokens.createInvite({ role: 'user', note: '', createdBy: null, now: AT.getTime() });
      }
    });
    const full = await run(['create-invite']);
    expect(full.code).toBe(1);
    expect(full.err).toContain(`at most ${MAX_PENDING_INVITES} pending invites`);
    expect(full.out).toBe('');
  });
});

describe('cli reset-password-link', () => {
  it('prints a reset link; a new one revokes the older pending one', async () => {
    await withDb(({ users }) => addUser(users, 'anna'));
    const first = await run(['reset-password-link', 'Anna']);
    expect(first.code).toBe(0);
    expect(first.out).toMatch(
      /^Password reset link for anna \(single use, valid until 2026-10-23 12:00 Kyiv time/,
    );
    expect(first.out).toMatch(/\nhttps:\/\/fit\.triple-a\.dev\/reset#[A-Za-z0-9_-]{43}\n/);
    const second = await run(['reset-password-link', 'anna']);
    await withDb(({ tokens }) => {
      expect(tokens.checkReset(tokenOf(first.out), AT.getTime())).toEqual({ ok: false, reason: 'revoked' });
      expect(tokens.checkReset(tokenOf(second.out), AT.getTime())).toMatchObject({
        ok: true,
        link: { purpose: 'reset', createdBy: null },
      });
    });
  });

  it('works for an admin, and is a setup link for an account without a password', async () => {
    await withDb(async ({ users }) => {
      await addUser(users, 'admin', 'admin');
      await addUser(users, 'boss', 'admin', null);
    });
    expect((await run(['reset-password-link', 'admin'])).out).toMatch(/^Password reset link for admin/);
    expect((await run(['reset-password-link', 'boss'])).out).toMatch(/^Setup link for boss/);
  });

  it('refuses unknown and disabled accounts', async () => {
    await withDb(async ({ users }) => {
      users.setDisabled(await addUser(users, 'olya'), AT.getTime());
    });
    expect(await run(['reset-password-link', 'ghost'])).toMatchObject({
      code: 1,
      err: 'No user named ghost.\n',
    });
    expect((await run(['reset-password-link', 'olya'])).err).toContain('disabled');
    expect((await run(['reset-password-link'])).code).toBe(2);
    await withDb(({ tokens }) => expect(tokens.listPending(AT.getTime())).toEqual([]));
  });
});

describe('cli set-password', () => {
  it('reads the first line of stdin, stores the hash (via cli) and revokes that user’s sessions only', async () => {
    const { annaSession, adminSession } = await withDb(async ({ db, users }) => {
      const sessions = createSessionStore(db);
      const anna = await addUser(users, 'anna');
      const admin = await addUser(users, 'admin', 'admin');
      return {
        annaSession: sessions.create(anna, AT.getTime()),
        adminSession: sessions.create(admin, AT.getTime()),
      };
    });

    const result = await run(['set-password', 'anna', '--stdin'], { stdin: 'нове-довге-гасло\r\nignored\n' });
    expect(result.code).toBe(0);
    expect(result.out).toBe('Password saved for anna. All of its sessions were revoked.\n');

    await withDb(async ({ db, users }) => {
      const anna = users.byKey('anna');
      expect(await verifyPassword('нове-довге-гасло', anna?.passwordHash ?? '')).toBe(true);
      expect(anna?.passwordChangedVia).toBe('cli');
      const sessions = createSessionStore(db);
      expect(sessions.check(annaSession, AT.getTime())).toBeNull();
      expect(sessions.check(adminSession, AT.getTime())?.user.username).toBe('admin');
    });
  });

  it('for an admin it also revokes the pending links that admin created (D27)', async () => {
    const token = await withDb(async ({ users, tokens }) => {
      const admin = await addUser(users, 'admin', 'admin');
      return tokens.createInvite({ role: 'user', note: '', createdBy: admin, now: AT.getTime() }).token;
    });
    const result = await run(['set-password', 'admin', '--stdin'], { stdin: 'a-brand-new-password\n' });
    expect(result.out).toContain('and so were the pending links it created');
    await withDb(({ tokens }) =>
      expect(tokens.checkInvite(token, AT.getTime())).toEqual({ ok: false, reason: 'revoked' }),
    );
  });

  it('refuses a missing username (usage), an unknown user, a short password and a missing terminal', async () => {
    await withDb(({ users }) => addUser(users, 'anna'));
    const noName = await run(['set-password', '--stdin'], { stdin: 'whatever-password\n' });
    expect(noName.code).toBe(2);
    expect(noName.err).toContain('Usage: set-password <username> [--stdin]');
    expect(await run(['set-password', 'ghost', '--stdin'], { stdin: 'whatever-password\n' })).toMatchObject({
      code: 1,
      err: 'No user named ghost.\n',
    });
    const short = await run(['set-password', 'anna', '--stdin'], { stdin: 'short\n' });
    expect(short.code).toBe(1);
    expect(short.err).toMatch(/at least 8/);
    const noTty = await run(['set-password', 'anna'], { stdin: 'whatever-password\n' });
    expect(noTty.code).toBe(2);
    expect(noTty.err).toMatch(/--stdin/);
    expect((await run(['set-password', 'anna', '--force'])).code).toBe(2);
    await withDb(async ({ users }) =>
      expect(await verifyPassword(PASSWORD, users.byKey('anna')?.passwordHash ?? '')).toBe(true),
    );
  });
});

describe('cli set-role', () => {
  it('promotes and demotes; a demotion signs the account out and revokes the links it created', async () => {
    const { session, token } = await withDb(async ({ db, users, tokens }) => {
      await addUser(users, 'admin', 'admin');
      const anna = await addUser(users, 'anna');
      return {
        session: createSessionStore(db).create(anna, AT.getTime()),
        token: tokens.createInvite({ role: 'user', note: '', createdBy: anna, now: AT.getTime() }).token,
      };
    });
    expect(await run(['set-role', 'anna', 'admin'])).toMatchObject({
      code: 0,
      out: 'anna is now an admin.\n',
    });
    expect((await run(['set-role', 'anna', 'admin'])).out).toBe(
      'anna already has role admin. Nothing changed.\n',
    );
    const demoted = await run(['set-role', 'anna', 'user']);
    expect(demoted.code).toBe(0);
    expect(demoted.out).toContain('anna is now a regular user. Its sessions were revoked');
    await withDb(({ db, users, tokens }) => {
      expect(users.byKey('anna')?.role).toBe('user');
      expect(createSessionStore(db).check(session, AT.getTime())).toBeNull();
      expect(tokens.checkInvite(token, AT.getTime())).toEqual({ ok: false, reason: 'revoked' });
    });
  });

  it('never removes the last usable admin', async () => {
    await withDb(async ({ users }) => {
      await addUser(users, 'admin', 'admin');
      await addUser(users, 'pending', 'admin', null);
    });
    const result = await run(['set-role', 'admin', 'user']);
    expect(result.code).toBe(1);
    expect(result.err).toContain('last usable admin');
    await withDb(({ users }) => expect(users.byKey('admin')?.role).toBe('admin'));
  });

  it('validates its arguments', async () => {
    await withDb(({ users }) => addUser(users, 'anna'));
    expect((await run(['set-role', 'anna', 'root'])).code).toBe(2);
    expect((await run(['set-role', 'anna'])).code).toBe(2);
    expect((await run(['set-role', 'ghost', 'admin'])).code).toBe(1);
  });
});

describe('cli rename-user', () => {
  it('renames, keeping the sessions; refuses taken names and the reserved alias', async () => {
    const session = await withDb(async ({ db, users }) => {
      const anna = await addUser(users, 'anna');
      await addUser(users, 'olya');
      return createSessionStore(db).create(anna, AT.getTime());
    });
    const result = await run(['rename-user', 'anna', 'Anna.K']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Renamed anna → Anna.K. Sessions are kept');
    await withDb(({ db, users }) => {
      expect(users.byKey('anna.k')?.username).toBe('Anna.K');
      expect(createSessionStore(db).check(session, AT.getTime())?.user.username).toBe('Anna.K');
    });

    expect(await run(['rename-user', 'anna.k', 'OLYA'])).toMatchObject({
      code: 1,
      err: 'That username is already taken.\n',
    });
    expect((await run(['rename-user', 'anna.k', 'legko'])).err).toBe('That username is reserved.\n');
    expect((await run(['rename-user', 'ghost', 'ghost2'])).code).toBe(1);
    expect((await run(['rename-user', 'anna.k'])).code).toBe(2);
    // The CLI may use the reserved «admin» (D2).
    expect((await run(['rename-user', 'olya', 'admin'])).code).toBe(0);
  });
});

describe('cli list-users and list-links', () => {
  it('list-users shows names, roles, status, dates and AI today — never hashes or tokens', async () => {
    const { session } = await withDb(async ({ db, users }) => {
      const anna = await addUser(users, 'anna');
      await addUser(users, 'admin', 'admin', null);
      users.setDisabled(await addUser(users, 'olya'), AT.getTime());
      users.touch(anna, AT.getTime() - 3600_000);
      const budget = createFoodBudget(db, DEFAULT_AI_LIMITS).forUser(anna);
      for (let i = 0; i < 3; i++) budget.tryConsume(AT.getTime());
      return { session: createSessionStore(db).create(anna, AT.getTime()) };
    });
    const result = await run(['list-users']);
    expect(result.code).toBe(0);
    const lines = result.out.split('\n');
    expect(lines[0]).toMatch(/^username\s+role\s+status\s+created\s+last activity\s+AI today$/);
    expect(lines.find((l) => l.startsWith('anna'))).toMatch(
      /^anna\s+user\s+active\s+2026-10-21 12:00\s+2026-10-22 11:00\s+3$/,
    );
    expect(lines.find((l) => l.startsWith('admin'))).toMatch(
      /^admin\s+admin\s+no password\s+2026-10-21 12:00\s+—\s+0$/,
    );
    expect(lines.find((l) => l.startsWith('olya'))).toMatch(/^olya\s+user\s+disabled\s/);
    expect(result.out).not.toContain('scrypt');
    expect(result.out).not.toContain(session);
    expect(result.out).not.toContain(hashToken(session));
  });

  it('list-links shows pending links with who made them — never tokens or their hashes', async () => {
    const made = await withDb(async ({ users, tokens }) => {
      const admin = await addUser(users, 'admin', 'admin');
      const anna = await addUser(users, 'anna');
      const invite = tokens.createInvite({
        role: 'user',
        note: 'для\u001b[31m Олі',
        createdBy: null,
        now: AT.getTime(),
      });
      const reset = tokens.createReset({
        userId: anna,
        purpose: 'reset',
        createdBy: admin,
        now: AT.getTime() + 1,
      });
      return { invite, reset };
    });
    const result = await run(['list-links']);
    expect(result.code).toBe(0);
    const lines = result.out.split('\n');
    expect(lines[0]).toMatch(/^id\s+kind\s+role\s+for\s+created by\s+expires \(Kyiv\)\s+note$/);
    expect(lines[1]).toMatch(
      new RegExp(
        `^${made.invite.invite.id}\\s+invite\\s+user\\s+—\\s+cli\\s+2026-10-29 11:00\\s+для \\[31m Олі$`,
      ),
    );
    expect(lines[2]).toMatch(
      new RegExp(`^${made.reset.reset.id}\\s+reset\\s+—\\s+anna\\s+admin\\s+2026-10-23 12:00\\s+—$`),
    );
    for (const token of [made.invite.token, made.reset.token]) {
      expect(result.out).not.toContain(token);
      expect(result.out).not.toContain(hashToken(token));
    }
    expect(result.out).not.toContain('\u001b');
  });

  it('empty listings say so', async () => {
    expect((await run(['list-users'])).out).toBe(
      'No accounts yet. Create the admin: create-admin <username>\n',
    );
    expect((await run(['list-links'])).out).toBe('No pending links.\n');
    expect((await run(['list-users', 'extra'])).code).toBe(2);
  });
});

describe('cli revoke-links', () => {
  it('--by revokes what that account created; --all revokes everything left', async () => {
    const made = await withDb(async ({ users, tokens }) => {
      const admin = await addUser(users, 'admin', 'admin');
      const anna = await addUser(users, 'anna');
      const now = AT.getTime();
      return {
        byAdmin: [
          tokens.createInvite({ role: 'user', note: '', createdBy: admin, now }).token,
          tokens.createReset({ userId: anna, purpose: 'reset', createdBy: admin, now }).token,
        ],
        byCli: tokens.createInvite({ role: 'admin', note: '', createdBy: null, now }).token,
      };
    });
    expect(await run(['revoke-links', '--by', 'admin'])).toMatchObject({
      code: 0,
      out: 'Revoked 2 pending link(s) created by admin.\n',
    });
    await withDb(({ tokens }) => {
      expect(tokens.checkInvite(made.byAdmin[0] ?? '', AT.getTime())).toEqual({
        ok: false,
        reason: 'revoked',
      });
      expect(tokens.checkReset(made.byAdmin[1] ?? '', AT.getTime())).toEqual({
        ok: false,
        reason: 'revoked',
      });
      expect(tokens.checkInvite(made.byCli, AT.getTime()).ok).toBe(true);
    });
    expect((await run(['revoke-links', '--all'])).out).toBe('Revoked 1 pending link(s).\n');
    expect((await run(['revoke-links', '--all'])).out).toBe('Revoked 0 pending link(s).\n');
    await withDb(({ tokens }) => expect(tokens.listPending(AT.getTime())).toEqual([]));
  });

  it('needs exactly one of --by / --all', async () => {
    await withDb(({ users }) => addUser(users, 'admin', 'admin'));
    expect((await run(['revoke-links'])).code).toBe(2);
    expect((await run(['revoke-links', '--all', '--by', 'admin'])).code).toBe(2);
    expect((await run(['revoke-links', '--by'])).code).toBe(2);
    expect(await run(['revoke-links', '--by', 'ghost'])).toMatchObject({
      code: 1,
      err: 'No user named ghost.\n',
    });
  });
});

describe('cli downgrade-schema', () => {
  const D = '2026-10-10';
  const columns = (db: Database, table: string): unknown[] =>
    db
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((c) => c.name);
  const openRaw = (file: string) => new (sqlite().DatabaseSync)(file);
  const withRaw = <T>(fn: (db: Database) => T): T => {
    const db = openRaw(databasePath(dir));
    try {
      return fn(db);
    } finally {
      db.close();
    }
  };
  const backups = (): string[] =>
    existsSync(join(dir, 'backups')) ? readdirSync(join(dir, 'backups')).sort() : [];

  it('one account: v4 → v3 keeps it, v3 → v2 drops the meals; a re-upgrade brings anna back with the same id', async () => {
    const { annaId, before } = await withDb(async ({ db, users }) => {
      const id = await addUser(users, 'anna');
      const repo = createDataRepos(db).forUser(id);
      repo.apply([
        {
          kind: 'day.put',
          date: D,
          value: { food: 'Борщ', kcal: 500, trained: true, types: ['Кардіо'], notes: 'n' },
        },
        {
          kind: 'meal.put',
          date: D,
          value: {
            id: 'breakfast001',
            type: 'Сніданок',
            time: '08:30',
            text: 'Тост',
            kcal: 300,
            protein: 20,
            fat: 10,
            carbs: 30,
            photos: ['AAAAAAAAAAAAAAAAAAAAAA'],
          },
        },
        { kind: 'food.use', date: D, value: { name: 'Тост', portion: '2 шт', kcal: 300, protein: 20 } },
      ]);
      return { annaId: id, before: repo.read().days[D] };
    });

    const v3 = await run(['downgrade-schema']);
    expect(v3.code).toBe(0);
    expect(v3.out).toContain('Schema downgraded to v3');
    expect(v3.out).toContain('Kept: anna');
    expect(v3.out).toContain('Dropped accounts: none.');
    expect(v3.out).toContain('Next: deploy/deploy.sh rollback.');
    expect(backups()).toEqual(['legko-pre-down-v4-2026-10-22.db']);
    withRaw((db) => {
      const kv = (key: string) => db.prepare('SELECT value FROM kv WHERE key = ?').get(key)?.value;
      expect(schemaVersion(db)).toBe(3);
      expect(kv('password_hash')).toMatch(/^scrypt\$/);
      expect(JSON.parse(String(kv('legacy_user')))).toMatchObject({ id: annaId, username: 'anna' });
      expect(columns(db, 'days')).toContain('meals');
      expect(columns(db, 'days')).not.toContain('user_id');
    });

    const v2 = await run(['downgrade-schema']);
    expect(v2.code).toBe(0);
    expect(v2.out).toContain('Schema downgraded to v2');
    expect(v2.out).toMatch(/Dropped: the meal structure .* protein \/ fat \/ carbs/);
    expect(backups()).toEqual(['legko-pre-down-v3-2026-10-22.db', 'legko-pre-down-v4-2026-10-22.db']);
    withRaw((db) => {
      expect(schemaVersion(db)).toBe(2);
      expect(columns(db, 'days')).not.toContain('meals');
      expect(columns(db, 'foods')).not.toContain('protein');
      expect(db.prepare('SELECT food, kcal, trained, notes, photos FROM days').get()).toEqual({
        food: before?.food,
        kcal: 800,
        trained: 1,
        notes: 'n',
        photos: '["AAAAAAAAAAAAAAAAAAAAAA"]',
      });
    });

    // Upgrading again re-adds everything: the same account id, the day as a legacy day with the same food.
    await withDb(({ db, users }) => {
      expect(schemaVersion(db)).toBe(MIGRATIONS.length);
      expect(users.legacyOwner()?.id).toBe(annaId);
      expect(createDataRepos(db).forUser(annaId).read().days[D]).toEqual({
        food: before?.food,
        kcal: 800,
        trained: true,
        types: ['Кардіо'],
        notes: 'n',
        photos: ['AAAAAAAAAAAAAAAAAAAAAA'],
      });
    });
  });

  it('several accounts: refuses with per-user counts until --keep and --drop-others, then prints what was dropped', async () => {
    await withDb(async ({ db, users }) => {
      const data = createDataRepos(db);
      const anna = await addUser(users, 'anna');
      const olya = await addUser(users, 'olya');
      await addUser(users, 'admin', 'admin');
      data.forUser(anna).apply([{ kind: 'weight.put', date: D, kg: 65 }]);
      data.forUser(olya).apply([
        { kind: 'day.put', date: D, value: { food: 'Каша', kcal: 300, trained: null, types: [], notes: '' } },
        {
          kind: 'day.put',
          date: '2026-10-11',
          value: { food: 'Суп', kcal: 300, trained: null, types: [], notes: '' },
        },
        { kind: 'weight.put', date: D, kg: 70 },
      ]);
    });

    const ambiguous = await run(['downgrade-schema']);
    expect(ambiguous.code).toBe(1);
    expect(ambiguous.err).toMatch(/There are 3 accounts .*pass --keep <username>.*Nothing was changed/s);

    const blocked = await run(['downgrade-schema', '--keep', 'anna']);
    expect(blocked.code).toBe(1);
    expect(blocked.err).toContain('olya: days 2, weights 1, measures 0, foods 0, photos 0');
    expect(blocked.err).not.toMatch(/^\s+admin:/m);
    expect(blocked.err).toContain('--drop-others');
    expect(blocked.err).toContain('Nothing was changed');
    expect(backups()).toEqual([]);
    withRaw((db) => expect(schemaVersion(db)).toBe(4));

    const dropped = await run(['downgrade-schema', '--keep', 'anna', '--drop-others']);
    expect(dropped.code).toBe(0);
    expect(dropped.out).toContain('Kept: anna');
    expect(dropped.out).toContain(
      '  olya: days 2, weights 1, measures 0, foods 0, photos 0, user_settings 0, push_subscriptions 0',
    );
    expect(dropped.out).toContain('  admin: days 0, weights 0');
    withRaw((db) => {
      expect(schemaVersion(db)).toBe(3);
      expect(db.prepare('SELECT COUNT(*) AS n FROM days').get()).toEqual({ n: 0 });
      expect(db.prepare('SELECT date, kg FROM weights').all()).toEqual([{ date: D, kg: 65 }]);
    });

    // The same command line again must not go one step further.
    const repeated = await run(['downgrade-schema', '--keep', 'anna']);
    expect(repeated.code).toBe(1);
    expect(repeated.err).toBe(
      '--keep and --drop-others only apply to a schema v4 database; this one is v3. Nothing was changed.\n',
    );
    withRaw((db) => expect(schemaVersion(db)).toBe(3));

    expect((await run(['downgrade-schema'])).out).toContain('Schema downgraded to v2');
  });

  it('refuses a database that is neither v4 nor v3, changing nothing', async () => {
    const v2 = openRaw(databasePath(dir));
    migrate(v2, MIGRATIONS.slice(0, 2));
    v2.close();
    const result = await run(['downgrade-schema']);
    expect(result.code).toBe(1);
    expect(result.err).toMatch(/only works on schema v3; this database is v2\. Nothing was changed/);
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    withRaw((db) => expect(schemaVersion(db)).toBe(2));
  });

  it('fails clearly without a database and rejects unknown options', async () => {
    const missing = await run(['downgrade-schema']);
    expect(missing.code).toBe(1);
    expect(missing.err).toMatch(/No database at/);
    expect(existsSync(databasePath(dir))).toBe(false);
    const extra = await run(['downgrade-schema', '--force']);
    expect(extra.code).toBe(2);
    expect(extra.err).toContain('Usage');
    expect((await run(['downgrade-schema', '--keep'])).code).toBe(2);
  });
});

describe('cli usage', () => {
  it('lists every command and the rollback rule; unknown commands are usage errors', async () => {
    const help = await run(['help']);
    expect(help.code).toBe(0);
    for (const command of [
      'create-admin <username>',
      'create-invite [--admin] [--note <text>]',
      'reset-password-link <username>',
      'set-password <username> [--stdin]',
      'set-role <username> <admin|user>',
      'rename-user <old> <new>',
      'list-users',
      'list-links',
      'revoke-links --by <username> | --all',
      'downgrade-schema [--keep <username>] [--drop-others]',
    ]) {
      expect(help.out).toContain(command);
    }
    expect(USAGE).toContain(
      'Run it only when deploy.sh status shows a previous image from before the users release.',
    );
    expect((await run(['--help'])).code).toBe(0);
    expect((await run([])).out).toBe(USAGE);
    const unknown = await run(['nope']);
    expect(unknown.code).toBe(2);
    expect(unknown.err).toContain('Unknown command: nope');
    // Nothing touched the data directory.
    expect(existsSync(databasePath(dir))).toBe(false);
  });

  it('account commands never migrate an older database: refused, nothing changed, no snapshot written', async () => {
    const v3 = new (sqlite().DatabaseSync)(databasePath(dir));
    migrate(v3, MIGRATIONS.slice(0, 3));
    v3.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('password_hash', await hash(PASSWORD));
    v3.close();
    const before = readFileSync(databasePath(dir));

    for (const argv of [['list-users'], ['list-links'], ['create-admin', 'admin'], ['create-invite']]) {
      const result = await run(argv);
      expect(result.code, argv.join(' ')).toBe(1);
      expect(result.out).toBe('');
      expect(result.err).toContain('Database is at schema v3; this CLI needs v4. Nothing was changed.');
      expect(result.err).toContain('Start the server of this build once to migrate it');
      expect(result.err).toContain('deploy/deploy.sh rollback');
    }
    expect(existsSync(join(dir, 'backups'))).toBe(false);
    const raw = new (sqlite().DatabaseSync)(databasePath(dir));
    try {
      expect(schemaVersion(raw)).toBe(3);
      expect(raw.prepare('SELECT value FROM kv WHERE key = ?').get('password_hash')?.value).toMatch(
        /^scrypt\$/,
      );
    } finally {
      raw.close();
    }
    expect(readFileSync(databasePath(dir)).equals(before)).toBe(true);
  });

  it('a missing or empty (v0) database is created and migrated for a first install', async () => {
    const missing = await run(['list-users']);
    expect(missing.code).toBe(0);
    expect(missing.out).toContain('No accounts yet');

    rmSync(dir, { recursive: true, force: true });
    mkdirSync(dir);
    const empty = new (sqlite().DatabaseSync)(databasePath(dir));
    expect(schemaVersion(empty)).toBe(0);
    empty.close();
    const result = await run(['create-admin', 'admin']);
    expect(result.code).toBe(0);
    expect(result.out).toContain('Admin account admin created');
    // Nothing to keep from an empty file.
    expect(existsSync(join(dir, 'backups'))).toBe(false);
  });

  it('between downgrade-schema and the rollback, other commands of this build change nothing', async () => {
    // A v3 installation the server of this build migrated (with its pre-v4 snapshot).
    const v3 = new (sqlite().DatabaseSync)(databasePath(dir));
    migrate(v3, MIGRATIONS.slice(0, 3));
    v3.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('password_hash', await hash(PASSWORD));
    v3.close();
    openDatabase(databasePath(dir), { now: () => AT }).close();
    const snapshot = join(dir, 'backups', 'legko-pre-v4-2026-10-22.db');
    const snapshotBytes = readFileSync(snapshot);
    const snapshotMtime = statSync(snapshot).mtimeMs;

    const down = await run(['downgrade-schema', '--keep', 'anna']);
    expect(down.code).toBe(0);
    const after = readFileSync(databasePath(dir));

    for (const argv of [['list-users'], ['list-links'], ['reset-password-link', 'anna']]) {
      const result = await run(argv);
      expect(result.code, argv.join(' ')).toBe(1);
      expect(result.err).toContain('Database is at schema v3');
      expect(result.err).not.toContain('saved legko-pre-v4');
    }
    const raw = new (sqlite().DatabaseSync)(databasePath(dir));
    try {
      expect(schemaVersion(raw)).toBe(3);
    } finally {
      raw.close();
    }
    expect(readFileSync(databasePath(dir)).equals(after)).toBe(true);
    expect(readdirSync(join(dir, 'backups')).sort()).toEqual([
      'legko-pre-down-v4-2026-10-22.db',
      'legko-pre-v4-2026-10-22.db',
    ]);
    // The rollback's fallback file still holds the state from before the release.
    expect(readFileSync(snapshot).equals(snapshotBytes)).toBe(true);
    expect(statSync(snapshot).mtimeMs).toBe(snapshotMtime);
  });

  it('USAGE says not to run other commands between downgrade-schema and the rollback', () => {
    expect(USAGE).toContain('Then run deploy.sh rollback — and no other command of this build in between.');
    expect(USAGE).toContain('The account commands never migrate an existing database');
  });
});

describe('readFirstLine', () => {
  it('handles chunks split inside a multi-byte character', async () => {
    const bytes = Buffer.from('гасло\nrest');
    const stream = Readable.from([bytes.subarray(0, 3), bytes.subarray(3)]);
    expect(await readFirstLine(stream)).toBe('гасло');
  });

  it('returns everything when there is no newline', async () => {
    expect(await readFirstLine(Readable.from([Buffer.from('no-newline')]))).toBe('no-newline');
  });
});
