import './warnings';
import { runCli } from './cli/run';

const code = await runCli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  stdin: process.stdin,
  stdout: process.stdout,
  stderr: process.stderr,
  ...(process.stdin.isTTY ? { tty: process.stdin } : {}),
});
process.exitCode = code;
