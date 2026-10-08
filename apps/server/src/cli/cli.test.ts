import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough, Readable } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { getPasswordHash, verifyPassword } from '../auth/password';
import { createSessionStore } from '../auth/sessions';
import { databasePath, openDatabase } from '../db/open';
import { readFirstLine } from './prompt';
import { runCli, type CliIo } from './run';

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'legko-cli-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

function io(stdinText: string): CliIo & { out: () => string; err: () => string } {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  let out = '';
  let err = '';
  stdout.on('data', (c: Buffer) => (out += c.toString()));
  stderr.on('data', (c: Buffer) => (err += c.toString()));
  return {
    env: { DATA_DIR: dir },
    cwd: dir,
    stdin: Readable.from([Buffer.from(stdinText)]),
    stdout,
    stderr,
    scrypt: { N: 1024, r: 8, p: 1 },
    out: () => out,
    err: () => err,
  };
}

describe('cli set-password', () => {
  it('reads the first line of stdin, stores the hash and revokes sessions', async () => {
    const db = openDatabase(databasePath(dir));
    const token = createSessionStore(db).create(Date.now());
    db.close();

    const term = io('нове-довге-гасло\r\nignored second line\n');
    expect(await runCli(['set-password', '--stdin'], term)).toBe(0);
    expect(term.out()).toContain('All sessions were revoked');

    const check = openDatabase(databasePath(dir));
    try {
      expect(await verifyPassword('нове-довге-гасло', getPasswordHash(check) ?? '')).toBe(true);
      expect(createSessionStore(check).check(token, Date.now())).toBeNull();
    } finally {
      check.close();
    }
  });

  it('rejects short passwords', async () => {
    const term = io('short\n');
    expect(await runCli(['set-password', '--stdin'], term)).toBe(1);
    expect(term.err()).toMatch(/at least 8/);
  });

  it('needs --stdin when there is no terminal', async () => {
    const term = io('whatever-password\n');
    expect(await runCli(['set-password'], term)).toBe(2);
    expect(term.err()).toMatch(/--stdin/);
  });

  it('prints usage for unknown commands and options', async () => {
    const a = io('');
    expect(await runCli(['nope'], a)).toBe(2);
    expect(a.err()).toContain('Usage');
    const b = io('');
    expect(await runCli(['set-password', '--force'], b)).toBe(2);
    const c = io('');
    expect(await runCli(['--help'], c)).toBe(0);
    expect(c.out()).toContain('set-password');
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
