import { dirname } from 'node:path';
import type { Readable, Writable } from 'node:stream';
import { zonedNow } from '@legko/shared';
import { passwordProblem, setPassword, type ScryptParams } from '../auth/password';
import { BACKUP_TIMEZONE, backupsDir } from '../backup';
import { resolveDataDir } from '../config';
import { downgradeSchemaV3, DowngradeRefused } from '../db/downgrade';
import { databasePath, openDatabase, openExistingDatabase } from '../db/open';
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
  /** Clock for snapshot file names; default the real one. */
  now?: () => Date;
}

const USAGE = `Usage:
  node dist/cli.js set-password           prompts twice (hidden input)
  node dist/cli.js set-password --stdin   reads the password from the first line of stdin
  node dist/cli.js downgrade-schema       schema v3 → v2, before rolling back to the build without meals

set-password sets the single login password and signs out every device.
downgrade-schema (stop the app first) saves backups/legko-pre-down-v3-<date>.db, then drops the meal
structure and the macros; every day keeps its food text, kcal and photos. Then run deploy.sh rollback.
Both use DATA_DIR (default /data in production, ./data otherwise).
`;

async function readPassword(args: readonly string[], io: CliIo): Promise<string | number> {
  if (args.includes('--stdin')) return readFirstLine(io.stdin);
  if (!io.tty) {
    io.stderr.write('stdin is not a terminal: pipe the password and pass --stdin\n');
    return 2;
  }
  const first = await promptHidden('New password: ', io.tty, io.stdout);
  const second = await promptHidden('Repeat password: ', io.tty, io.stdout);
  if (first !== second) {
    io.stderr.write('Passwords do not match\n');
    return 1;
  }
  return first;
}

async function setPasswordCommand(args: readonly string[], io: CliIo): Promise<number> {
  const unknown = args.filter((a) => a !== '--stdin');
  if (unknown.length) {
    io.stderr.write(`Unknown option: ${unknown.join(' ')}\n\n${USAGE}`);
    return 2;
  }
  const password = await readPassword(args, io);
  if (typeof password === 'number') return password;
  const problem = passwordProblem(password);
  if (problem) {
    io.stderr.write(`${problem}\n`);
    return 1;
  }

  const file = databasePath(resolveDataDir(io.env, io.cwd));
  const db = openDatabase(file);
  try {
    await setPassword(db, password, io.scrypt);
  } finally {
    db.close();
  }
  io.stdout.write(`Password saved (${file}). All sessions were revoked.\n`);
  return 0;
}

/**
 * Rollback helper (DEPLOY.md): opens the database WITHOUT migrating, refuses unless it is at schema v3, saves a
 * snapshot, then drops the v3 columns in one transaction.
 */
function downgradeSchemaCommand(args: readonly string[], io: CliIo): number {
  if (args.length) {
    io.stderr.write(`Unknown option: ${args.join(' ')}\n\n${USAGE}`);
    return 2;
  }
  const file = databasePath(resolveDataDir(io.env, io.cwd));
  const db = openExistingDatabase(file);
  try {
    const date = zonedNow(BACKUP_TIMEZONE, (io.now ?? (() => new Date()))()).date;
    const snapshot = downgradeSchemaV3(db, backupsDir(dirname(file)), date);
    io.stdout.write(
      `Schema downgraded to v2 (${file}).\n` +
        `Saved first: ${snapshot}\n` +
        'Dropped: the meal structure of each day (days.meals) and all protein / fat / carbs values.\n' +
        'Kept: every day’s food text, kcal and photos, and everything else.\n' +
        'Next: deploy/deploy.sh rollback.\n',
    );
    return 0;
  } catch (err) {
    if (err instanceof DowngradeRefused) {
      io.stderr.write(`${err.message}\n`);
      return 1;
    }
    throw err;
  } finally {
    db.close();
  }
}

/** Returns the process exit code. */
export async function runCli(argv: readonly string[], io: CliIo): Promise<number> {
  const [command, ...args] = argv;
  try {
    if (command === 'set-password') return await setPasswordCommand(args, io);
    if (command === 'downgrade-schema') return downgradeSchemaCommand(args, io);
  } catch (err) {
    if (err instanceof PromptCancelled) {
      io.stderr.write('Cancelled\n');
      return 130;
    }
    io.stderr.write(`Error: ${err instanceof Error ? err.message : String(err)}\n`);
    return 1;
  }
  const help = command === undefined || command === 'help' || command === '--help' || command === '-h';
  (help ? io.stdout : io.stderr).write(USAGE);
  return help ? 0 : 2;
}
