import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Coach lint (docs/coach-cabinet.md §2.6 rules 1–4): the read-only coach path stays read-only and stays where it is.
 * The type system is the first layer (readers are not on `RouteDeps`, `ClientId` is a brand); this text lint is the
 * second; the runtime route-table test in `test/coach.test.ts` is the third. Rule 5 (reader key lists, frozen) is
 * checked at runtime in `access.test.ts`, `db/data-reader.test.ts` and `photos/store.test.ts`.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

interface Source {
  /** Relative to `apps/server/src`, forward slashes. */
  file: string;
  source: string;
}

const ROUTES_FILE = 'http/routes/coach.ts';
const ACCESS_FILE = 'coach/access.ts';
const APP_FILE = 'http/app.ts';
const DEPS_FILE = 'http/routes/deps.ts';

const READER_FILES: ReadonlySet<string> = new Set(['db/data.ts', 'photos/store.ts', ACCESS_FILE]);
const COACH_TYPE_FILES = (file: string): boolean =>
  file === APP_FILE || file === ROUTES_FILE || file.startsWith('coach/');

const NON_GET = /\.(post|put|patch|delete|all|on|use|route|mount)\(/;
const APP_GET = /\bapp\.get\(/g;
const FORBIDDEN_IN_ACCESS = ['.forUser(', '.apply(', '.replaceAll(', '.setTimezone(', '.save('] as const;
const SQL_WORD = /\b(SELECT|INSERT|UPDATE|DELETE|REPLACE)\b/;

const collapse = (s: string): string => s.replace(/\s+/g, ' ').trim();

/** The parameter list of `registerCoachRoutes` (whitespace collapsed, trailing comma dropped), or null. */
function registerParams(source: string): string | null {
  const m = /export function registerCoachRoutes\(([^)]*)\)/.exec(source);
  return m?.[1] === undefined ? null : collapse(m[1]).replace(/,$/, '');
}

/** String / template literals of a source (template interpolations shown as `${…}`). */
function stringLiterals(file: string, source: string): string[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) out.push(node.text);
    else if (ts.isTemplateExpression(node)) {
      out.push(node.head.text + node.templateSpans.map((s) => `\${…}${s.literal.text}`).join(''));
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

/** Import declarations that bring in the `CoachAccess` type (or value) by that exact name. */
const importsCoachAccess = (source: string): boolean =>
  (source.match(/\bimport\b[^;]*?\bfrom\s+['"][^'"]+['"]/gs) ?? []).some((decl) =>
    /\bCoachAccess\b/.test(decl),
  );

/** Every problem the coach lint finds in `files`; [] = clean. */
export function coachLint(files: readonly Source[]): string[] {
  const problems: string[] = [];
  const byName = new Map(files.map((f) => [f.file, f.source]));

  const routes = byName.get(ROUTES_FILE);
  if (routes === undefined) problems.push(`${ROUTES_FILE} is missing`);
  else {
    const write = NON_GET.exec(routes);
    if (write) problems.push(`${ROUTES_FILE}: «${write[0]}» registers or calls something other than GET`);
    const gets = routes.match(APP_GET)?.length ?? 0;
    if (gets < 4) problems.push(`${ROUTES_FILE}: ${gets} app.get( calls, expected at least 4`);
    const params = registerParams(routes);
    const expected = "app: Hono<AppEnv>, deps: Pick<RouteDeps, 'auth' | 'admin'>, coach: CoachAccess";
    if (params !== expected) {
      problems.push(`${ROUTES_FILE}: registerCoachRoutes(${params ?? '?'}) — expected (${expected})`);
    }
  }

  const access = byName.get(ACCESS_FILE);
  if (access === undefined) problems.push(`${ACCESS_FILE} is missing`);
  else {
    for (const call of FORBIDDEN_IN_ACCESS) {
      if (access.includes(call)) problems.push(`${ACCESS_FILE}: calls ${call} (a write path)`);
    }
    for (const literal of stringLiterals(ACCESS_FILE, access)) {
      if (SQL_WORD.test(literal))
        problems.push(`${ACCESS_FILE}: SQL literal «${collapse(literal).slice(0, 60)}»`);
    }
  }

  const deps = byName.get(DEPS_FILE);
  if (deps !== undefined && (/coach/i.test(deps) || /reader/i.test(deps))) {
    problems.push(`${DEPS_FILE}: mentions coach / Reader (RouteDeps must not carry the coach path)`);
  }

  for (const { file, source } of files) {
    if (/\breaderFor\b/.test(source) && !READER_FILES.has(file)) problems.push(`${file}: uses readerFor`);
    if (/\.readers\b/.test(source) && file !== APP_FILE) problems.push(`${file}: uses .readers`);
    if (/\bas ClientId\b/.test(source) && file !== ACCESS_FILE) problems.push(`${file}: mints a ClientId`);
    if (file !== APP_FILE) {
      if (/(?<!function )\bcreateCoachAccess\(/.test(source))
        problems.push(`${file}: calls createCoachAccess(`);
      if (/(?<!function )\bregisterCoachRoutes\(/.test(source)) {
        problems.push(`${file}: calls registerCoachRoutes(`);
      }
    }
    if (!COACH_TYPE_FILES(file) && importsCoachAccess(source)) problems.push(`${file}: imports CoachAccess`);
  }
  return problems;
}

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...sourceFiles(path));
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts') && !entry.name.endsWith('.d.ts'))
      out.push(path);
  }
  return out;
}

const serverSources = (): Source[] =>
  sourceFiles(SRC).map((path) => ({
    file: relative(SRC, path).split(sep).join('/'),
    source: readFileSync(path, 'utf8'),
  }));

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────────────────────

describe('coach lint: the server sources', () => {
  it('finds nothing', () => {
    const files = serverSources();
    expect(files.map((f) => f.file)).toEqual(
      expect.arrayContaining([ROUTES_FILE, ACCESS_FILE, APP_FILE, DEPS_FILE]),
    );
    expect(coachLint(files)).toEqual([]);
  });

  it('only http/app.ts wires the coach path', () => {
    const app = serverSources().find((f) => f.file === APP_FILE)?.source ?? '';
    expect(app).toMatch(
      /createCoachAccess\(\{[^}]*data: dataAccess\.readers,[^}]*photos: photoAccess\.readers/s,
    );
    expect(app).toContain(
      'registerCoachRoutes(app, { auth: routeDeps.auth, admin: routeDeps.admin }, coach)',
    );
    expect(app).toContain('data: dataAccess.repos,');
  });
});

describe('coach lint: self-test', () => {
  const clean = (): Source[] => serverSources();
  const patched = (file: string, edit: (source: string) => string): Source[] =>
    clean().map((f) => (f.file === file ? { file, source: edit(f.source) } : f));
  const add = (file: string, source: string): Source[] => [...clean(), { file, source }];

  it.each([
    ['app.post(', `app.post('/api/coach/x', h);`],
    ['a chained .delete(', `app.get('/a', h).delete('/a', h);`],
    ['app.on(', `app.on('PATCH', '/api/coach/x', h);`],
    ['app.all(', `app.all('/api/coach/*', h);`],
    ['app.use(', `app.use('/api/coach/*', h);`],
    ['app.route(', `app.route('/api/coach', sub);`],
  ])('refuses %s in routes/coach.ts', (_name, line) => {
    expect(coachLint(patched(ROUTES_FILE, (s) => `${s}\n${line}\n`)).join('\n')).toContain(ROUTES_FILE);
  });

  it('refuses fewer than 4 app.get( and changed parameters', () => {
    const fewer = patched(ROUTES_FILE, (s) =>
      s.replace('app.get(COACH_ROUTES.thumb', 'void (COACH_ROUTES.thumb'),
    );
    expect(coachLint(fewer).join('\n')).toContain('3 app.get(');
    const wider = patched(ROUTES_FILE, (s) =>
      s.replace(
        "deps: Pick<RouteDeps, 'auth' | 'admin'>",
        "deps: Pick<RouteDeps, 'auth' | 'admin' | 'data'>",
      ),
    );
    expect(coachLint(wider).join('\n')).toContain('registerCoachRoutes(');
    const whole = patched(ROUTES_FILE, (s) =>
      s.replace("deps: Pick<RouteDeps, 'auth' | 'admin'>", 'deps: RouteDeps'),
    );
    expect(coachLint(whole).join('\n')).toContain('registerCoachRoutes(');
  });

  it('refuses readerFor, .readers and `as ClientId` outside their files', () => {
    expect(coachLint(add('http/routes/data.ts', 'x.readerFor(id);'))).toEqual([
      'http/routes/data.ts: uses readerFor',
    ]);
    expect(coachLint(add('http/routes/x.ts', 'const { readerFor } = r;'))).toEqual([
      'http/routes/x.ts: uses readerFor',
    ]);
    expect(coachLint(add('cli/x.ts', 'const r = access.readers;'))).toEqual(['cli/x.ts: uses .readers']);
    expect(coachLint(add('http/routes/x.ts', 'const c = id as ClientId;'))).toEqual([
      'http/routes/x.ts: mints a ClientId',
    ]);
  });

  it('refuses wiring the coach path anywhere but http/app.ts', () => {
    expect(coachLint(add('http/routes/x.ts', 'createCoachAccess({});'))).toEqual([
      'http/routes/x.ts: calls createCoachAccess(',
    ]);
    expect(coachLint(add('index.ts', 'registerCoachRoutes(app, deps, c);'))).toEqual([
      'index.ts: calls registerCoachRoutes(',
    ]);
    expect(
      coachLint(add('http/routes/x.ts', "import type { CoachAccess } from '../../coach/access';")),
    ).toEqual(['http/routes/x.ts: imports CoachAccess']);
    expect(
      coachLint(
        add('http/routes/y.ts', "import {\n  NotCoach,\n  type CoachAccess,\n} from '../../coach/access';"),
      ),
    ).toEqual(['http/routes/y.ts: imports CoachAccess']);
    expect(coachLint(add('coach/other.ts', "import type { CoachAccess } from './access';"))).toEqual([]);
  });

  it('refuses coach / Reader in routes/deps.ts', () => {
    expect(coachLint(patched(DEPS_FILE, (s) => `${s}\n// coach: CoachAccess`))).toHaveLength(1);
    expect(coachLint(patched(DEPS_FILE, (s) => `${s}\ntype X = DataReaders;`))).toHaveLength(1);
  });

  it.each(FORBIDDEN_IN_ACCESS)('refuses %s in coach/access.ts', (call) => {
    expect(coachLint(patched(ACCESS_FILE, (s) => `${s}\nx${call}y);`))).toEqual([
      `${ACCESS_FILE}: calls ${call} (a write path)`,
    ]);
  });

  it('refuses an SQL literal in coach/access.ts', () => {
    const problems = coachLint(patched(ACCESS_FILE, (s) => `${s}\nconst q = 'SELECT * FROM days';`));
    expect(problems).toEqual([`${ACCESS_FILE}: SQL literal «SELECT * FROM days»`]);
    expect(coachLint(patched(ACCESS_FILE, (s) => `${s}\nconst q = \`DELETE FROM \${t}\`;`))).toHaveLength(1);
  });
});
