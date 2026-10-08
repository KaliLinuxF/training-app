// Bundles the server into self-contained ESM files: dist/index.js (server) and dist/cli.js.
// Every dependency (hono, web-push, zod, @legko/shared, …) is inlined, so the runtime image
// needs no node_modules — only Node 24 and its built-ins.
import { build } from 'esbuild';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));

await rm(join(root, 'dist'), { recursive: true, force: true });

const result = await build({
  absWorkingDir: root,
  entryPoints: { index: 'src/index.ts', cli: 'src/cli.ts' },
  outdir: 'dist',
  bundle: true,
  packages: 'bundle',
  platform: 'node',
  format: 'esm',
  target: 'node24',
  sourcemap: true,
  splitting: false,
  legalComments: 'eof',
  // CommonJS dependencies (web-push and friends) call `require` for Node built-ins.
  banner: {
    js: "import { createRequire as __legkoCreateRequire } from 'node:module';\nconst require = __legkoCreateRequire(import.meta.url);",
  },
  define: { __LEGKO_VERSION__: JSON.stringify(pkg.version) },
  metafile: true,
  logLevel: 'warning',
});

// Keeps the bundles ESM once dist/ is copied out of the workspace (e.g. /app/server in the image).
await writeFile(join(root, 'dist', 'package.json'), `${JSON.stringify({ type: 'module' }, null, 2)}\n`);

const outputs = Object.entries(result.metafile.outputs)
  .filter(([file]) => file.endsWith('.js'))
  .map(([file, info]) => `${file} ${(info.bytes / 1024).toFixed(0)} KiB`);
console.log(`built @legko/server ${pkg.version}:\n  ${outputs.join('\n  ')}`);
