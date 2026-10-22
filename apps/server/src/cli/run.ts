import { existsSync } from 'node:fs';
import { dirname } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import {
  DEFAULT_AI_LIMITS,
  INVITE_NOTE_MAX,
  MAX_PENDING_INVITES,
  usernameKey,
  zonedNow,
  type UserRole,
} from '@legko/shared';
import {
  AccountDisabled,
  AccountError,
  AlreadyAdmin,
  createAccountService,
  ExistsAsUser,
  InvalidUsername,
  LastAdmin,
  TooManyInvites,
  UsernameTaken,
  UserNotFound,
  WeakPassword,
  type AccountService,
} from '../auth/accounts';
import { createScryptGate, DEFAULT_SCRYPT, type ScryptParams } from '../auth/password';
import { createSessionStore } from '../auth/sessions';
import { BACKUP_TIMEZONE, backupsDir } from '../backup';
import { ConfigError, loadConfig, resolveDataDir } from '../config';
import {
  downgradeSchemaV3,
  downgradeSchemaV4,
  downgradeSchemaV5,
  DowngradeRefused,
  DOWNGRADE_V4_FROM,
  DOWNGRADE_V5_FROM,
  type DowngradeReport,
  type DowngradeV5Report,
  type UserCounts,
} from '../db/downgrade';
import { MIGRATIONS, schemaVersion } from '../db/migrations';
import { databasePath, openDatabase, openExistingDatabase } from '../db/open';
import type { Database } from '../db/sqlite';
import { createTokenRepo, type TokenRepo } from '../db/tokens';
import { createUserRepo, type UserRepo, type UserRow } from '../db/users';
import { createFoodBudget } from '../food/budget';
import { createLogger, type Logger } from '../logger';
import { createSubscriptionRepo } from '../push/subscriptions';
import { PromptCancelled, promptHidden, readFirstLine } from './prompt';

export interface CliIo {
  env: Record<string, string | undefined>;
  cwd: string;
  stdin: Readable;
  stdout: Writable;
  stderr: Writable;
  /** Interactive terminal for the hidden prompt; omitted when stdin is not a TTY. */
  tty?: NodeJS.ReadStream;
  /** Tests use cheap scrypt parameters. */
  scrypt?: ScryptParams;
  /** Clock for links, listings and snapshot file names; default the real one. */
  now?: () => Date;
}

export const USAGE = `Usage: node dist/cli.js <command> [options]

Accounts (docs/multi-user.md §7):
  create-admin <username>                  creates an admin WITHOUT a password and prints a one-time setup
                                           link (24 h): open it in a browser and choose the password there
  create-invite [--admin] [--note <text>]  prints a one-time invite link (7 days); role user, admin with --admin
  reset-password-link <username>           prints a one-time password link for that account (24 h; a setup
                                           link when it has no password yet); older pending ones are revoked
  set-password <username> [--stdin]        prompts twice (hidden input), or reads the first line of stdin;
                                           signs that account out on every device
  set-role <username> <admin|user>         never removes the last usable admin; a demotion signs the account
                                           out and revokes the links it created
  rename-user <old> <new>                  sessions are kept
  list-users                               username, role, status, created, last activity, AI estimates today
  list-links                               pending invite / reset / setup links (never the links themselves)
  revoke-links --by <username> | --all     revokes the pending links that account created, or every one

Rollback:
  downgrade-schema [--keep <username>] [--drop-others]
      Stop the app first. Saves backups/legko-pre-down-v<N>-<date>.db, then
      v5 → v4 (the build before workouts and steps): drops every exercise, workout, workout session and steps
        entry (prints the counts per account); every account and all other data stay; --keep and
        --drop-others are refused;
      v4 → v3 (the build before accounts): keeps ONE account (--keep, or the only one) with its password,
        sessions, settings, data and photos; refused while another account owns data unless --drop-others
        (drops it and prints the counts); invites, reset links and AI counts go;
      v3 → v2 (the build before meals): drops the meal structure and the macros; every day keeps its food
        text, kcal and photos.
      Run it only when deploy.sh status shows a previous image from before that release (one step per run).
      Then run deploy.sh rollback — and no other command of this build in between.

The account commands never migrate an existing database: they refuse one at an older schema (the server migrates
it on its first start). Only a missing or empty database is created, for a first install.

Links use PUBLIC_ORIGIN (default https://fit.triple-a.dev) and are printed to stdout only.
Every command uses DATA_DIR (default /data in production, ./data otherwise).
`;

/** Exit codes: 0 ok, 1 refused / failed, 2 usage. */
type ExitCode = number;

class UsageError extends Error {
  override name = 'UsageError';
}

/** A refusal with a message for the operator (exit 1). */
class Refused extends Error {
  override name = 'Refused';
}

// ── Arguments ─────────────────────────────────────────────────────────────────────────────────────────────────────

type OptionSpec = Record<string, 'flag' | 'value'>;

interface ParsedArgs {
  positional: string[];
  options: Map<string, string | true>;
}

function parseArgs(args: readonly string[], spec: OptionSpec = {}): ParsedArgs {
  const positional: string[] = [];
  const options = new Map<string, string | true>();
  for (let i = 0; i < args.length; i++) {
    const arg = args[i] ?? '';
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const kind = spec[arg];
    if (!kind) throw new UsageError(`Unknown option: ${arg}`);
    if (options.has(arg)) throw new UsageError(`Repeated option: ${arg}`);
    if (kind === 'flag') {
      options.set(arg, true);
      continue;
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) throw new UsageError(`${arg} needs a value`);
    options.set(arg, value);
    i++;
  }
  return { positional, options };
}

function exactly(parsed: ParsedArgs, count: number, usage: string): string[] {
  if (parsed.positional.length !== count) throw new UsageError(`Usage: ${usage}`);
  return parsed.positional;
}

const valueOf = (parsed: ParsedArgs, name: string): string | undefined => {
  const v = parsed.options.get(name);
  return typeof v === 'string' ? v : undefined;
};

// ── Output helpers ────────────────────────────────────────────────────────────────────────────────────────────────

/** `2026-10-23 12:00` on the Kyiv clock (like the backups' dates). */
function kyivTime(ms: number): string {
  const z = zonedNow(BACKUP_TIMEZONE, new Date(ms));
  return `${z.date} ${z.hm}`;
}

const orDash = (ms: number | null): string => (ms === null ? '—' : kyivTime(ms));

/** Notes are typed by admins: no control characters reach the operator's terminal. */
// eslint-disable-next-line no-control-regex
const printable = (s: string): string => s.replace(/[\u0000-\u001f\u007f-\u009f]/g, ' ');

function table(rows: readonly (readonly string[])[]): string {
  const widths = (rows[0] ?? []).map((_, i) => Math.max(...rows.map((r) => (r[i] ?? '').length)));
  return rows
    .map((row) =>
      row
        .map((cell, i) => (i === row.length - 1 ? cell : cell.padEnd(widths[i] ?? 0)))
        .join('  ')
        .trimEnd(),
    )
    .join('\n')
    .concat('\n');
}

const statusOf = (u: UserRow): string =>
  u.disabledAt !== null ? 'disabled' : u.passwordHash === null ? 'no password' : 'active';

function accountErrorMessage(err: unknown): string | null {
  if (err instanceof UsernameTaken) return 'That username is already taken.';
  if (!(err instanceof AccountError)) return null;
  if (err instanceof InvalidUsername) {
    if (err.problem === 'reserved') return 'That username is reserved.';
    if (err.problem === 'length') return 'Usernames are 3–32 characters.';
    return 'Usernames use Latin letters, digits, dot, _ or - (with at least one letter or digit).';
  }
  if (err instanceof WeakPassword) return `${err.problem}.`;
  if (err instanceof UserNotFound) return 'No such user.';
  if (err instanceof LastAdmin)
    return 'Refused: that is the last usable admin. Make another account an admin first.';
  if (err instanceof AccountDisabled) return 'That account is disabled: enable it in «Користувачі» first.';
  if (err instanceof TooManyInvites)
    return `Refused: at most ${MAX_PENDING_INVITES} pending invites. Revoke old ones first (list-links, revoke-links).`;
  return err.message;
}

// ── Database context ──────────────────────────────────────────────────────────────────────────────────────────────

interface Context {
  io: CliIo;
  db: Database;
  users: UserRepo;
  tokens: TokenRepo;
  accounts: AccountService;
  /** Epoch ms of this run. */
  now: number;
}

const clockOf = (io: CliIo): (() => Date) => io.now ?? (() => new Date());

/**
 * The database for the account commands. A file at this build's schema opens as it is; a missing or empty (v0) file
 * is created and migrated, as on a first install before the server's first start. An OLDER schema is refused without
 * touching it: only the server migrates an existing database. Otherwise a check such as `list-users` run between
 * `downgrade-schema` and `deploy.sh rollback` would migrate the file straight back to v4 (the previous image then
 * refuses to start) and rewrite that day's `legko-pre-v4-<date>.db`. A newer schema fails in `openDatabase`.
 */
function openForAccounts(file: string, clock: () => Date, logger: Logger): Database {
  if (existsSync(file)) {
    const probe = openExistingDatabase(file);
    let version: number;
    try {
      version = schemaVersion(probe);
    } finally {
      probe.close();
    }
    if (version > 0 && version < MIGRATIONS.length) {
      throw new Refused(
        `Database is at schema v${version}; this CLI needs v${MIGRATIONS.length}. Nothing was changed.\n` +
          'Start the server of this build once to migrate it — or, if you are rolling back, finish with ' +
          'deploy/deploy.sh rollback and use the previous image’s CLI.',
      );
    }
  }
  return openDatabase(file, { now: clock, logger });
}

/**
 * Opens the database the server uses (see `openForAccounts`); safe while the server runs (WAL, 5 s busy timeout).
 * Nothing is logged: the operator sees stdout / stderr only.
 */
async function withAccounts(
  io: CliIo,
  run: (ctx: Context) => Promise<ExitCode> | ExitCode,
): Promise<ExitCode> {
  const clock = clockOf(io);
  const stderrLogger = createLogger('info', (line) => io.stderr.write(`${line}\n`));
  const db = openForAccounts(databasePath(resolveDataDir(io.env, io.cwd)), clock, stderrLogger);
  try {
    const users = createUserRepo(db);
    const tokens = createTokenRepo(db);
    const accounts = createAccountService({
      db,
      users,
      tokens,
      sessions: createSessionStore(db),
      subscriptions: createSubscriptionRepo(db),
      scrypt: io.scrypt ?? DEFAULT_SCRYPT,
      gate: createScryptGate(),
    });
    return await run({ io, db, users, tokens, accounts, now: clock().getTime() });
  } finally {
    db.close();
  }
}

function requireUser(ctx: Context, username: string): UserRow {
  const user = ctx.users.byKey(usernameKey(username));
  if (!user) throw new Refused(`No user named ${printable(username)}.`);
  return user;
}

/** `PUBLIC_ORIGIN` as the server sees it (compose sets https://fit.triple-a.dev). */
const publicOrigin = (io: CliIo): string => loadConfig(io.env, io.cwd).publicOrigin;

// ── Commands ──────────────────────────────────────────────────────────────────────────────────────────────────────

function createAdmin(ctx: Context, args: readonly string[]): ExitCode {
  const [name = ''] = exactly(parseArgs(args), 1, 'create-admin <username>');
  // Before anything is created: a configuration error must not leave an admin whose link nobody saw.
  const origin = publicOrigin(ctx.io);
  let created;
  try {
    created = ctx.accounts.createAdmin(name, ctx.now);
  } catch (err) {
    if (err instanceof AlreadyAdmin) {
      throw new Refused(
        `User ${err.username} already exists (admin). For a new password link: reset-password-link ${err.username}`,
      );
    }
    if (err instanceof ExistsAsUser) {
      throw new Refused(`User ${err.username} exists as a regular user — pick another name`);
    }
    throw err;
  }
  const { user, path, expiresAt } = created;
  ctx.io.stdout.write(
    `Admin account ${user.username} created, without a password.\n` +
      `One-time setup link (single use, valid until ${kyivTime(expiresAt)} Kyiv time):\n` +
      `${origin}${path}\n` +
      `Open it in a browser and choose the password there. If it expires: reset-password-link ${user.username}\n`,
  );
  return 0;
}

function createInvite(ctx: Context, args: readonly string[]): ExitCode {
  const parsed = parseArgs(args, { '--admin': 'flag', '--note': 'value' });
  exactly(parsed, 0, 'create-invite [--admin] [--note <text>]');
  const note = (valueOf(parsed, '--note') ?? '').trim();
  if (note.length > INVITE_NOTE_MAX) throw new UsageError(`--note is at most ${INVITE_NOTE_MAX} characters`);
  const role: UserRole = parsed.options.has('--admin') ? 'admin' : 'user';
  const origin = publicOrigin(ctx.io);
  const { path, expiresAt } = ctx.accounts.createInviteLink({ role, note, createdBy: null, now: ctx.now });
  ctx.io.stdout.write(
    `Invite for a new ${role === 'admin' ? 'ADMIN' : 'user'} account${note ? ` (${printable(note)})` : ''} — ` +
      `single use, valid until ${kyivTime(expiresAt)} Kyiv time:\n${origin}${path}\n`,
  );
  return 0;
}

function resetPasswordLink(ctx: Context, args: readonly string[]): ExitCode {
  const [name = ''] = exactly(parseArgs(args), 1, 'reset-password-link <username>');
  const target = requireUser(ctx, name);
  const origin = publicOrigin(ctx.io);
  const { path, expiresAt, purpose, user } = ctx.accounts.createResetLink({
    userId: target.id,
    createdBy: null,
    now: ctx.now,
  });
  ctx.io.stdout.write(
    `${purpose === 'setup' ? 'Setup' : 'Password reset'} link for ${user.username} ` +
      `(single use, valid until ${kyivTime(expiresAt)} Kyiv time; older pending links for this account were revoked):\n` +
      `${origin}${path}\n` +
      `Completing it signs ${user.username} out on every device.\n`,
  );
  return 0;
}

async function readPassword(username: string, useStdin: boolean, io: CliIo): Promise<string> {
  if (useStdin) return readFirstLine(io.stdin);
  if (!io.tty) throw new UsageError('stdin is not a terminal: pipe the password and pass --stdin');
  const first = await promptHidden(`New password for ${username}: `, io.tty, io.stdout);
  const second = await promptHidden('Repeat password: ', io.tty, io.stdout);
  if (first !== second) throw new Refused('Passwords do not match');
  return first;
}

async function setPassword(ctx: Context, args: readonly string[]): Promise<ExitCode> {
  const parsed = parseArgs(args, { '--stdin': 'flag' });
  const [name = ''] = exactly(parsed, 1, 'set-password <username> [--stdin]');
  // Unknown names are refused before anyone types a password.
  const target = requireUser(ctx, name);
  const password = await readPassword(target.username, parsed.options.has('--stdin'), ctx.io);
  const user = await ctx.accounts.cliSetPassword(target.username, password, ctx.now);
  ctx.io.stdout.write(
    `Password saved for ${user.username}. All of its sessions were revoked` +
      `${user.role === 'admin' ? ', and so were the pending links it created' : ''}.\n`,
  );
  return 0;
}

function setRole(ctx: Context, args: readonly string[]): ExitCode {
  const [name = '', role = ''] = exactly(parseArgs(args), 2, 'set-role <username> <admin|user>');
  if (role !== 'admin' && role !== 'user') throw new UsageError('Usage: set-role <username> <admin|user>');
  const target = requireUser(ctx, name);
  if (target.role === role) {
    ctx.io.stdout.write(`${target.username} already has role ${role}. Nothing changed.\n`);
    return 0;
  }
  ctx.accounts.setRole(null, target.id, role, ctx.now);
  ctx.io.stdout.write(
    role === 'admin'
      ? `${target.username} is now an admin.\n`
      : `${target.username} is now a regular user. Its sessions were revoked, and so were the pending links it created.\n`,
  );
  return 0;
}

function renameUser(ctx: Context, args: readonly string[]): ExitCode {
  const [from = '', to = ''] = exactly(parseArgs(args), 2, 'rename-user <old> <new>');
  const target = requireUser(ctx, from);
  const renamed = ctx.accounts.renameUser(target.id, to);
  ctx.io.stdout.write(
    `Renamed ${target.username} → ${renamed.username}. Sessions are kept; sign in with the new name from now on.\n`,
  );
  return 0;
}

function listUsers(ctx: Context, args: readonly string[]): ExitCode {
  exactly(parseArgs(args), 0, 'list-users');
  const all = ctx.users.list();
  if (all.length === 0) {
    ctx.io.stdout.write('No accounts yet. Create the admin: create-admin <username>\n');
    return 0;
  }
  // Counts only; the limits do not matter for a usage listing.
  const usage = createFoodBudget(ctx.db, DEFAULT_AI_LIMITS).usage(ctx.now);
  const rows = all.map((u) => [
    u.username,
    u.role,
    statusOf(u),
    kyivTime(u.createdAt),
    orDash(u.lastSeenAt),
    String(usage.byUser.get(u.id)?.today ?? 0),
  ]);
  ctx.io.stdout.write(
    table([['username', 'role', 'status', 'created', 'last activity', 'AI today'], ...rows]) +
      'Times are Kyiv time.\n',
  );
  return 0;
}

function listLinks(ctx: Context, args: readonly string[]): ExitCode {
  exactly(parseArgs(args), 0, 'list-links');
  const links = ctx.tokens.listPending(ctx.now);
  if (links.length === 0) {
    ctx.io.stdout.write('No pending links.\n');
    return 0;
  }
  const rows = links.map((l) => [
    l.id,
    l.kind,
    l.role ?? '—',
    l.forUsername ?? '—',
    l.createdBy ?? 'cli',
    kyivTime(l.expiresAt),
    l.note ? printable(l.note) : '—',
  ]);
  ctx.io.stdout.write(
    table([['id', 'kind', 'role', 'for', 'created by', 'expires (Kyiv)', 'note'], ...rows]) +
      'The links themselves are never stored: make a new one when it is lost (revoke-links to cancel these).\n',
  );
  return 0;
}

function revokeLinks(ctx: Context, args: readonly string[]): ExitCode {
  const parsed = parseArgs(args, { '--by': 'value', '--all': 'flag' });
  exactly(parsed, 0, 'revoke-links --by <username> | --all');
  const by = valueOf(parsed, '--by');
  const all = parsed.options.has('--all');
  if ((by === undefined) === !all)
    throw new UsageError('Usage: revoke-links --by <username> | --all (exactly one)');
  if (by !== undefined) {
    const creator = requireUser(ctx, by);
    const count = ctx.tokens.revokeCreatedBy(creator.id, ctx.now);
    ctx.io.stdout.write(`Revoked ${count} pending link(s) created by ${creator.username}.\n`);
  } else {
    const count = ctx.tokens.revokeAll(ctx.now);
    ctx.io.stdout.write(`Revoked ${count} pending link(s).\n`);
  }
  return 0;
}

// ── downgrade-schema ──────────────────────────────────────────────────────────────────────────────────────────────

const describeCounts = (u: UserCounts): string =>
  `${u.username}: ${Object.entries(u.counts)
    .map(([table, n]) => `${table} ${n}`)
    .join(', ')}`;

function printV4Report(io: CliIo, file: string, report: DowngradeReport): void {
  const kept = report.kept
    ? `Kept: ${report.kept.username} — password, sessions, settings, data and photos (a re-upgrade gives it the same account id).\n`
    : 'Kept: no account (the database had none).\n';
  const dropped = report.dropped.length
    ? `Dropped accounts (rows per table):\n${report.dropped.map((u) => `  ${describeCounts(u)}`).join('\n')}\n`
    : 'Dropped accounts: none.\n';
  io.stdout.write(
    `Schema downgraded to v3 (${file}).\n` +
      `Saved first: ${report.snapshot}\n` +
      kept +
      dropped +
      'Also dropped: every invite and reset link, the per-account AI counts and the AI limits saved in «Користувачі».\n' +
      'Next: deploy/deploy.sh rollback. (Run downgrade-schema again only to go back further, to the build before meals.)\n',
  );
}

function printV5Report(io: CliIo, file: string, report: DowngradeV5Report): void {
  const lines = report.dropped.length
    ? report.dropped
        .map(
          (u) =>
            `  ${u.username}: exercises ${u.counts.exercises}, workouts ${u.counts.workouts}, ` +
            `sessions ${u.counts.workout_sessions}, steps ${u.counts.steps}`,
        )
        .join('\n')
    : '  (no accounts)';
  io.stdout.write(
    `Schema downgraded to v4 (${file}).\n` +
      `Saved first: ${report.snapshot}\n` +
      `Dropped (rows per account):\n${lines}\n` +
      'Kept: every account, its days (with the workout marks and types), weigh-ins, measurements, meals, photos and settings.\n' +
      'Next: deploy/deploy.sh rollback. (Run downgrade-schema again only to go back further, to the build before accounts.)\n',
  );
}

/**
 * Rollback helper (DEPLOY.md): opens the database WITHOUT migrating. v5 → v4 (`downgradeSchemaV5`), v4 → v3
 * (`downgradeSchemaV4`), or v3 → v2;
 * anything else is refused. Each saves a snapshot first and runs in one transaction.
 */
function downgradeSchema(io: CliIo, args: readonly string[]): ExitCode {
  const parsed = parseArgs(args, { '--keep': 'value', '--drop-others': 'flag' });
  exactly(parsed, 0, 'downgrade-schema [--keep <username>] [--drop-others]');
  const keep = valueOf(parsed, '--keep');
  const dropOthers = parsed.options.has('--drop-others');
  const file = databasePath(resolveDataDir(io.env, io.cwd));
  const db = openExistingDatabase(file);
  try {
    const date = zonedNow(BACKUP_TIMEZONE, clockOf(io)()).date;
    const backups = backupsDir(dirname(file));
    const version = schemaVersion(db);
    if (version === DOWNGRADE_V5_FROM) {
      if (keep !== undefined || dropOthers) {
        throw new Refused(
          `--keep and --drop-others only apply to a schema v4 database; this one is v${version}. Nothing was changed.\n` +
            'Run downgrade-schema without them first (v5 → v4 keeps every account).',
        );
      }
      printV5Report(io, file, downgradeSchemaV5(db, backups, date));
      return 0;
    }
    if (version === DOWNGRADE_V4_FROM) {
      printV4Report(io, file, downgradeSchemaV4(db, backups, date, { keep, dropOthers }));
      return 0;
    }
    // Re-running the v4 command line on the v3 result must not silently go one step further.
    if (keep !== undefined || dropOthers) {
      throw new Refused(
        `--keep and --drop-others only apply to a schema v4 database; this one is v${version}. Nothing was changed.`,
      );
    }
    const snapshot = downgradeSchemaV3(db, backups, date);
    io.stdout.write(
      `Schema downgraded to v2 (${file}).\n` +
        `Saved first: ${snapshot}\n` +
        'Dropped: the meal structure of each day (days.meals) and all protein / fat / carbs values.\n' +
        'Kept: every day’s food text, kcal and photos, and everything else.\n' +
        'Next: deploy/deploy.sh rollback.\n',
    );
    return 0;
  } catch (err) {
    if (err instanceof DowngradeRefused) throw new Refused(err.message);
    throw err;
  } finally {
    db.close();
  }
}

// ── Dispatch ──────────────────────────────────────────────────────────────────────────────────────────────────────

const ACCOUNT_COMMANDS: Record<
  string,
  (ctx: Context, args: readonly string[]) => Promise<ExitCode> | ExitCode
> = {
  'create-admin': createAdmin,
  'create-invite': createInvite,
  'reset-password-link': resetPasswordLink,
  'set-password': setPassword,
  'set-role': setRole,
  'rename-user': renameUser,
  'list-users': listUsers,
  'list-links': listLinks,
  'revoke-links': revokeLinks,
};

const isHelp = (command: string | undefined): boolean =>
  command === undefined || command === 'help' || command === '--help' || command === '-h';

/** Returns the process exit code. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<ExitCode> {
  const [command, ...args] = argv;
  if (isHelp(command)) {
    io.stdout.write(USAGE);
    return 0;
  }
  const accountCommand = command ? ACCOUNT_COMMANDS[command] : undefined;
  if (!accountCommand && command !== 'downgrade-schema') {
    io.stderr.write(`Unknown command: ${printable(command ?? '')}\n\n${USAGE}`);
    return 2;
  }
  try {
    if (accountCommand) return await withAccounts(io, (ctx) => accountCommand(ctx, args));
    return downgradeSchema(io, args);
  } catch (err) {
    if (err instanceof UsageError) {
      io.stderr.write(`${err.message}\n\n${USAGE}`);
      return 2;
    }
    if (err instanceof PromptCancelled) {
      io.stderr.write('Cancelled\n');
      return 130;
    }
    const message =
      err instanceof Refused
        ? err.message
        : err instanceof ConfigError
          ? `Configuration error: ${err.message}`
          : (accountErrorMessage(err) ?? `Error: ${err instanceof Error ? err.message : String(err)}`);
    io.stderr.write(`${message}\n`);
    return 1;
  }
}
