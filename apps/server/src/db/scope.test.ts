import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

/**
 * Scope lint (docs/multi-user.md §4 item 4): every SQL statement in the server's source that touches a per-user table
 * must be scoped to one user, or carry an allowlist entry (file + exact substring + reason). Each query block — the
 * statement itself, every subquery, every CTE, the SELECT of an INSERT … SELECT — is checked on its own:
 *
 * - a block that reads, updates or deletes a per-user table needs a bound `[alias.]user_id = ?` (or `:name` /
 *   `$name`) predicate in ITS OWN `WHERE`, or in the `ON` of an inner join (of a LEFT JOIN only when the per-user
 *   table is the joined one). The predicate must be a whole conjunct: never in a SET list, a select list or ORDER BY,
 *   never next to an `OR` at its level (`a OR user_id = ?`, `x AND (user_id = ? OR y)`), never under `NOT`, inside
 *   `CASE`, a function call or a BETWEEN, and a predicate inside a subquery does not scope the outer block;
 * - an INSERT into a per-user table needs `user_id` in its column list; an upsert whose conflict key lacks `user_id`
 *   (a global key: photos.id, push endpoints, token hashes) needs `WHERE … user_id = excluded.user_id` (or a bound
 *   value) in its DO UPDATE, and REPLACE on such a table is refused (it deletes whichever row holds the key);
 * - a statement naming two or more per-user tables, joining one table to itself, or with an interpolated table name
 *   always needs an entry.
 *
 * Entries that match nothing, or only statements that pass on their own, fail: the list never keeps stale exemptions.
 */

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..');

const PER_USER_TABLES = [
  'days',
  'weights',
  'measures',
  'foods',
  'photos',
  'push_subscriptions',
  'reminder_log',
  'user_settings',
  'ai_usage',
  'sessions',
  'password_resets',
  // schema v5: keys start with user_id (not in GLOBAL_KEY_TABLES)
  'exercises',
  'workouts',
  'workout_sessions',
  'steps',
] as const;

/** Per-user tables whose key does not start with user_id: an upsert / REPLACE on that key can reach another user's row. */
const GLOBAL_KEY_TABLES: ReadonlySet<string> = new Set([
  'photos',
  'push_subscriptions',
  'sessions',
  'password_resets',
]);

interface AllowEntry {
  /** Relative to `apps/server/src`, forward slashes. */
  file: string;
  /** Exact substring of the statement (comments stripped, whitespace collapsed). */
  match: string;
  reason: string;
}

const V4_ATTACH = 'v4 migration: attaches every row of the single-user v3 table to the legacy owner (D1)';

const ALLOWLIST: readonly AllowEntry[] = [
  // Schema history: DDL is never checked; these are the data statements of the v4 rebuild.
  {
    file: 'db/migrations.ts',
    match: 'INSERT INTO users (id, username, username_key, password_hash, role, created_at, legacy_owner)',
    reason: 'v4 migration: creates the legacy owner from the single-user v3 data (no users exist yet)',
  },
  {
    file: 'db/migrations.ts',
    match:
      'INSERT INTO sessions_v4 (user_id, token_hash, created_at, renewed_at, expires_at, legacy) SELECT (SELECT id FROM users WHERE legacy_owner = 1), token_hash, created_at, renewed_at, expires_at, 1 FROM sessions',
    reason: V4_ATTACH,
  },
  {
    file: 'db/migrations.ts',
    match:
      'INSERT INTO days_v4 (user_id, date, food, kcal, trained, types, notes, updated_at, photos, meals) SELECT (SELECT id FROM users WHERE legacy_owner = 1), date, food, kcal, trained, types, notes, updated_at, photos, meals FROM days',
    reason: V4_ATTACH,
  },
  {
    file: 'db/migrations.ts',
    match:
      'INSERT INTO weights_v4 (user_id, date, kg, updated_at) SELECT (SELECT id FROM users WHERE legacy_owner = 1), date, kg, updated_at FROM weights',
    reason: V4_ATTACH,
  },
  {
    file: 'db/migrations.ts',
    match:
      'INSERT INTO measures_v4 (user_id, date, chest, waist, hips, updated_at) SELECT (SELECT id FROM users WHERE legacy_owner = 1), date, chest, waist, hips, updated_at FROM measures',
    reason: V4_ATTACH,
  },
  {
    file: 'db/migrations.ts',
    match:
      'INSERT INTO foods_v4 (user_id, key, position, name, portion, kcal, count, last_used, protein, fat, carbs) SELECT (SELECT id FROM users WHERE legacy_owner = 1), key, position, name, portion, kcal, count, last_used, protein, fat, carbs FROM foods',
    reason: V4_ATTACH,
  },
  {
    file: 'db/migrations.ts',
    match:
      'INSERT INTO photos_v4 (user_id, id, date, created_at, bytes, thumb_bytes) SELECT (SELECT id FROM users WHERE legacy_owner = 1), id, date, created_at, bytes, thumb_bytes FROM photos',
    reason: V4_ATTACH,
  },
  {
    file: 'db/migrations.ts',
    match:
      'INSERT INTO push_subscriptions_v4 (user_id, endpoint, p256dh, auth, user_agent, created_at, last_ok_at) SELECT (SELECT id FROM users WHERE legacy_owner = 1), endpoint, p256dh, auth, user_agent, created_at, last_ok_at FROM push_subscriptions',
    reason: V4_ATTACH,
  },
  {
    file: 'db/migrations.ts',
    match:
      'INSERT INTO reminder_log_v4 (user_id, kind, date, status, sent, created_at) SELECT (SELECT id FROM users WHERE legacy_owner = 1), kind, date, status, sent, created_at FROM reminder_log',
    reason: V4_ATTACH,
  },
  // Sessions are found by the secret token's hash: the token is the scope.
  {
    file: 'auth/sessions.ts',
    match: 'FROM sessions s JOIN users u ON u.id = s.user_id',
    reason: 'session lookup by token_hash (the token is the secret); returns that session’s own user',
  },
  {
    file: 'auth/sessions.ts',
    match: 'UPDATE sessions SET renewed_at = ?, expires_at = ? WHERE token_hash = ?',
    reason: 'sliding renewal of the session identified by its token hash',
  },
  {
    file: 'auth/sessions.ts',
    match: 'UPDATE sessions SET legacy = 0 WHERE token_hash = ?',
    reason: 'clears the legacy flag of the session identified by its token hash (D11)',
  },
  {
    file: 'auth/sessions.ts',
    match: 'DELETE FROM sessions WHERE token_hash = ?',
    reason: 'logout / expiry / disabled user: removes the session identified by its token hash',
  },
  {
    file: 'auth/sessions.ts',
    match: 'DELETE FROM sessions WHERE expires_at <= ?',
    reason: 'hourly purge of expired sessions (no data, any user)',
  },
  // One-time links: looked up and consumed by the token's hash; revoked / purged across users by design.
  {
    file: 'db/tokens.ts',
    match: 'FROM password_resets WHERE token_hash = ?',
    reason: 'reset link lookup by token_hash (the token is the secret)',
  },
  {
    file: 'db/tokens.ts',
    match: 'UPDATE password_resets SET used_at = ? WHERE token_hash = ?',
    reason: 'consumes the reset link identified by its token hash',
  },
  {
    file: 'db/tokens.ts',
    match: 'UPDATE password_resets SET revoked_at = ? WHERE created_by = ?',
    reason: 'D27: revokes the reset links an admin CREATED (scoped by creator, not owner)',
  },
  {
    file: 'db/tokens.ts',
    match:
      'UPDATE password_resets SET revoked_at = ? WHERE used_at IS NULL AND revoked_at IS NULL AND expires_at > ?',
    reason: 'CLI revoke-links --all: revokes every pending link',
  },
  {
    file: 'db/tokens.ts',
    match: 'FROM password_resets r JOIN users t ON t.id = r.user_id',
    reason: 'CLI list-links: pending reset links with their target username (ids and dates only, no tokens)',
  },
  {
    file: 'db/tokens.ts',
    match: 'DELETE FROM password_resets WHERE used_at < ? OR revoked_at < ? OR expires_at < ?',
    reason: 'purge of links used, revoked or expired more than 30 days ago',
  },
  // AI budget: counts only.
  {
    file: 'food/budget.ts',
    match: 'FROM ai_usage WHERE date >= ? AND date <= ? GROUP BY user_id',
    reason: 'admin overview: per-user estimate counts (numbers, no content)',
  },
  {
    file: 'food/budget.ts',
    match: 'DELETE FROM ai_usage WHERE date < ?',
    reason: 'prune of per-user counts older than 90 days',
  },
  // Photos: the global stray-file scan and the owner-correlated GC.
  {
    file: 'photos/store.ts',
    match: 'SELECT 1 AS found FROM photos WHERE id = ?',
    reason: 'stray-file scan: a file is a stray only when NO row (of anyone) has its id',
  },
  {
    file: 'photos/store.ts',
    match: 'SELECT COUNT(DISTINCT user_id) AS n FROM days WHERE meals IS NOT NULL AND NOT json_valid(meals)',
    reason: 'GC warning: how many accounts have unreadable meal data (a count, no content)',
  },
  {
    file: 'photos/store.ts',
    match: 'SELECT p.id, p.user_id FROM photos p WHERE p.created_at < ?',
    reason: 'GC candidates: references counted only from the photo’s OWNER (d.user_id = p.user_id, D14)',
  },
  // Push: endpoints are global keys; D15 lets the same browser subscription move between accounts.
  {
    file: 'push/subscriptions.ts',
    match: 'WHERE push_subscriptions.user_id = excluded.user_id OR push_subscriptions.auth = excluded.auth',
    reason:
      'D15 upsert: an endpoint another account holds moves to the caller only with the subscription’s own auth secret (the same browser); otherwise nothing changes (conflict)',
  },
  {
    file: 'push/subscriptions.ts',
    match: 'DELETE FROM push_subscriptions WHERE endpoint = ? AND (user_id = ? OR auth = ?)',
    reason:
      'D15 unsubscribe: also deletes another account’s row for THIS browser, proven by the subscription’s own auth secret',
  },
  {
    file: 'push/subscriptions.ts',
    match: 'SELECT DISTINCT s.user_id FROM push_subscriptions s JOIN users u ON u.id = s.user_id',
    reason: 'reminder scheduler: which (enabled) users have devices — ids only',
  },
];

// ── A small SQL structure parser (enough for the statements this codebase writes) ─────────────────────────────────────

const SQL_WORD = /\b(SELECT|INSERT|REPLACE|UPDATE|DELETE)\b/;
const CHECKED_KINDS = new Set(['SELECT', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'WITH', 'VALUES']);
const SUBQUERY_STARTS = new Set(['SELECT', 'WITH', 'VALUES']);
const STATEMENT_STARTS = ['SELECT', 'INSERT', 'REPLACE', 'UPDATE', 'DELETE', 'VALUES'];
const JOIN_WORDS = new Set(['NATURAL', 'LEFT', 'RIGHT', 'FULL', 'OUTER', 'INNER', 'CROSS', 'JOIN']);
const STOP_WORDS =
  /^(WHERE|GROUP|ORDER|LIMIT|HAVING|UNION|EXCEPT|INTERSECT|JOIN|LEFT|RIGHT|INNER|CROSS|FULL|OUTER|NATURAL|ON|USING|SET|VALUES|RETURNING|SELECT|WINDOW)$/i;

interface Token {
  kind: 'word' | 'param' | 'literal' | 'op' | 'dynamic';
  text: string;
  upper: string;
}
interface Group {
  kind: 'group';
  items: Item[];
}
type Item = Token | Group;

const TOKEN_RE =
  /'(?:[^']|'')*'|"(?:[^"]|"")*"|`[^`]*`|\$\{…\}|[A-Za-z_][\w$]*|\?\d*|[:@$][A-Za-z_]\w*|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?|<>|<=|>=|!=|==|\|\||->>|->|\S/g;

/** Tokens nested by parentheses. String literals are single tokens, so their content never looks like SQL. */
function parse(sql: string): Item[] {
  const root: Item[] = [];
  const stack: Item[][] = [root];
  for (const m of sql.matchAll(TOKEN_RE)) {
    const raw = m[0];
    const top = stack[stack.length - 1] ?? root;
    if (raw === '(') {
      const group: Group = { kind: 'group', items: [] };
      top.push(group);
      stack.push(group.items);
      continue;
    }
    if (raw === ')') {
      if (stack.length > 1) stack.pop();
      continue;
    }
    let kind: Token['kind'] = 'op';
    let text = raw;
    if (raw.startsWith("'") || /^\d/.test(raw)) kind = 'literal';
    else if (raw.startsWith('"') || raw.startsWith('`')) {
      kind = 'word';
      text = raw.slice(1, -1);
    } else if (raw.startsWith('${')) kind = 'dynamic';
    else if (/^[A-Za-z_]/.test(raw)) kind = 'word';
    else if (/^[?:@$]/.test(raw)) kind = 'param';
    top.push({ kind, text, upper: text.toUpperCase() });
  }
  return root;
}

const isGroup = (item: Item | undefined): item is Group => item?.kind === 'group';
const isWord = (item: Item | undefined, ...words: string[]): item is Token =>
  item !== undefined && item.kind === 'word' && (words.length === 0 || words.includes(item.upper));
const isOp = (item: Item | undefined, op: string): boolean =>
  item !== undefined && item.kind === 'op' && item.text === op;
const firstWord = (items: readonly Item[]): string => {
  const first = items[0];
  return first && first.kind === 'word' ? first.upper : '';
};
const isSubquery = (group: Group): boolean => SUBQUERY_STARTS.has(firstWord(group.items));
const isPerUser = (name: string | null): boolean =>
  name !== null && (PER_USER_TABLES as readonly string[]).includes(name);

/** Index of the first top-level word among `words` at or after `from`, or -1. */
function indexOfWord(items: readonly Item[], words: readonly string[], from = 0): number {
  if (words.length === 0) return -1;
  for (let i = from; i < items.length; i++) if (isWord(items[i], ...words)) return i;
  return -1;
}

/** Index of every top-level `ON CONFLICT`. */
function conflictClauses(items: readonly Item[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < items.length - 1; i++) {
    if (isWord(items[i], 'ON') && isWord(items[i + 1], 'CONFLICT')) out.push(i);
  }
  return out;
}

/** The tokens after the top-level `keyword` up to the first of `terminators` (null when there is no such clause). */
function clauseAfter(items: readonly Item[], keyword: string, terminators: readonly string[]): Item[] | null {
  const start = indexOfWord(items, [keyword]);
  if (start < 0) return null;
  const end = indexOfWord(items, terminators, start + 1);
  return items.slice(start + 1, end < 0 ? items.length : end);
}

/** Name of a table reference at `i` (`t` or `schema.t`, lower-cased) and the index after it. */
function tableAt(items: readonly Item[], i: number): { name: string | null; next: number } {
  const item = items[i];
  if (!isWord(item)) return { name: null, next: i + 1 };
  if (isOp(items[i + 1], '.') && isWord(items[i + 2]))
    return { name: (items[i + 2] as Token).text.toLowerCase(), next: i + 3 };
  return { name: item.text.toLowerCase(), next: i + 1 };
}

/**
 * True when `expr` (one level of a WHERE / ON clause) contains a bound user_id predicate as a whole conjunct: no `OR` at
 * this level, the predicate between ANDs (not a BETWEEN's AND), not under NOT, not inside CASE … END; plain
 * parenthesised sub-expressions are searched the same way, subqueries and function arguments are not.
 */
function conjunctive(expr: readonly Item[], { excluded = false }: { excluded?: boolean } = {}): boolean {
  const visible: boolean[] = [];
  let caseDepth = 0;
  for (const item of expr) {
    if (isWord(item, 'CASE')) caseDepth++;
    visible.push(caseDepth === 0);
    if (isWord(item, 'END') && caseDepth > 0) caseDepth--;
  }
  if (expr.some((item, k) => visible[k] && isWord(item, 'OR'))) return false;

  const isConjunctAnd = (k: number): boolean => {
    if (!visible[k] || !isWord(expr[k], 'AND')) return false;
    for (let m = k - 1; m >= 0; m--) {
      if (!visible[m]) continue;
      if (isWord(expr[m], 'BETWEEN')) return false;
      if (isWord(expr[m], 'AND')) return true;
    }
    return true;
  };
  const startsConjunct = (k: number): boolean => k === 0 || isConjunctAnd(k - 1);
  const endsConjunct = (k: number): boolean => k >= expr.length || isConjunctAnd(k);

  for (let k = 0; k < expr.length; k++) {
    if (!visible[k] || !startsConjunct(k)) continue;
    const item = expr[k];
    if (isGroup(item)) {
      if (!isSubquery(item) && endsConjunct(k + 1) && conjunctive(item.items, { excluded })) return true;
      continue;
    }
    let j = k;
    if (isWord(expr[j]) && isOp(expr[j + 1], '.') && isWord(expr[j + 2], 'USER_ID')) j += 2;
    if (!isWord(expr[j], 'USER_ID') || !(isOp(expr[j + 1], '=') || isOp(expr[j + 1], '=='))) continue;
    const value = expr[j + 2];
    let end = -1;
    if (value?.kind === 'param') end = j + 3;
    else if (
      excluded &&
      isWord(value, 'EXCLUDED') &&
      isOp(expr[j + 3], '.') &&
      isWord(expr[j + 4], 'USER_ID')
    )
      end = j + 5;
    if (end > 0 && endsConjunct(end)) return true;
  }
  return false;
}

type JoinKind = 'first' | 'inner' | 'left' | 'other';
interface Source {
  table: string | null;
  join: JoinKind;
  on: Item[] | null;
}

/** The sources of a FROM clause with how each is joined and its ON expression. */
function parseSources(items: readonly Item[], firstJoin: JoinKind = 'first'): Source[] {
  const sources: Source[] = [];
  const joinStart = (k: number): boolean =>
    isOp(items[k], ',') || (isWord(items[k]) && JOIN_WORDS.has((items[k] as Token).upper));
  let join: JoinKind = firstJoin;
  let i = 0;
  while (i < items.length) {
    let table: string | null = null;
    if (isWord(items[i]) && !isGroup(items[i + 1])) {
      const ref = tableAt(items, i);
      table = ref.name;
      i = ref.next;
    } else {
      // A subquery (checked as its own block), a parenthesised join or a table-valued function `json_each(?)`.
      i += isWord(items[i]) ? 2 : 1;
    }
    let on: Item[] | null = null;
    while (i < items.length && !joinStart(i)) {
      if (isWord(items[i], 'ON')) {
        let end = i + 1;
        while (end < items.length && !joinStart(end)) end++;
        on = items.slice(i + 1, end);
        i = end;
        break;
      }
      i++; // alias, AS, USING (…), INDEXED BY …
    }
    sources.push({ table, join, on });
    if (i >= items.length) break;
    if (isOp(items[i], ',')) {
      join = 'inner';
      i++;
      continue;
    }
    let kind: JoinKind = 'inner';
    while (i < items.length && isWord(items[i]) && JOIN_WORDS.has((items[i] as Token).upper)) {
      const word = (items[i] as Token).upper;
      if (word === 'LEFT') kind = 'left';
      if (word === 'RIGHT' || word === 'FULL') kind = 'other';
      i++;
      if (word === 'JOIN') break;
    }
    join = kind;
  }
  return sources;
}

/** A block reading / changing `sources` is scoped by a conjunct in its WHERE or in a qualifying JOIN … ON. */
function requireScope(sources: readonly Source[], where: Item[] | null, problems: string[]): void {
  const own = sources.filter((s) => isPerUser(s.table));
  if (own.length === 0) return;
  if (own.length >= 2) {
    problems.push(`joins ${own.length} per-user tables (${own.map((s) => s.table).join(', ')})`);
    return;
  }
  const scoped =
    (where !== null && conjunctive(where)) ||
    sources.some(
      (s) =>
        s.on !== null &&
        (s.join === 'inner' || (s.join === 'left' && isPerUser(s.table))) &&
        conjunctive(s.on),
    );
  if (!scoped) {
    problems.push(
      `no bound user_id predicate (a whole AND-conjunct of the WHERE / inner JOIN … ON of the block reading ${own[0]?.table})`,
    );
  }
}

const WHERE_ENDS = ['GROUP', 'ORDER', 'LIMIT', 'HAVING', 'WINDOW', 'RETURNING'];

function checkSelectCore(items: readonly Item[], problems: string[]): void {
  const from = indexOfWord(items, ['FROM']);
  if (from < 0) return;
  const end = indexOfWord(items, ['WHERE', ...WHERE_ENDS], from + 1);
  const sources = parseSources(items.slice(from + 1, end < 0 ? items.length : end));
  requireScope(sources, clauseAfter(items, 'WHERE', WHERE_ENDS), problems);
}

function checkSelect(items: readonly Item[], problems: string[]): void {
  let start = 0;
  for (let i = 0; i <= items.length; i++) {
    if (i < items.length && !isWord(items[i], 'UNION', 'EXCEPT', 'INTERSECT')) continue;
    let part = items.slice(start, i);
    if (isWord(part[0], 'ALL')) part = part.slice(1);
    if (isWord(part[0], 'SELECT')) checkSelectCore(part, problems);
    start = i + 1;
  }
}

function checkInsert(items: readonly Item[], problems: string[]): void {
  const into = indexOfWord(items, ['INTO']);
  if (into < 0) return;
  const { name: table, next } = tableAt(items, into + 1);
  let i = next;
  if (isWord(items[i], 'AS')) i += 2;
  const columns = isGroup(items[i]) ? (items[i] as Group) : null;
  if (columns) i++;
  const conflicts = conflictClauses(items);
  const returning = indexOfWord(items, ['RETURNING'], i);
  const sourceEnd = Math.min(...[conflicts[0] ?? -1, returning, items.length].filter((x) => x >= 0));
  const perUser = isPerUser(table);
  if (perUser) {
    if (!columns?.items.some((c) => isWord(c, 'USER_ID')))
      problems.push('INSERT without user_id in the column list');
    const replace = isWord(items[0], 'REPLACE') || (isWord(items[1], 'OR') && isWord(items[2], 'REPLACE'));
    if (replace && table !== null && GLOBAL_KEY_TABLES.has(table)) {
      problems.push(`REPLACE on ${table} (a global key) can delete another user’s row`);
    }
  }
  // INSERT … SELECT: the SELECT is a block of its own.
  const source = items.slice(i, sourceEnd);
  if (firstWord(source) === 'SELECT' || firstWord(source) === 'WITH') checkLevel(source, problems);

  if (!perUser) return;
  conflicts.forEach((at, n) => {
    let j = at + 2;
    const target = isGroup(items[j]) ? (items[j] as Group) : null;
    if (target) j++;
    const doAt = indexOfWord(items, ['DO'], j);
    if (doAt < 0 || !isWord(items[doAt + 1], 'UPDATE')) return;
    if (target?.items.some((c) => isWord(c, 'USER_ID'))) return;
    const end = Math.min(...[conflicts[n + 1] ?? -1, returning, items.length].filter((x) => x > doAt));
    const where = clauseAfter(items.slice(doAt + 2, end), 'WHERE', []);
    if (where === null || !conjunctive(where, { excluded: true })) {
      problems.push(
        'ON CONFLICT on a key without user_id: its DO UPDATE needs WHERE … user_id = excluded.user_id (or a bound id)',
      );
    }
  });
}

function checkUpdate(items: readonly Item[], problems: string[]): void {
  let i = 1;
  if (isWord(items[1], 'OR')) i = 3;
  const { name: table } = tableAt(items, i);
  const sources: Source[] = [{ table, join: 'first', on: null }];
  const from = indexOfWord(items, ['FROM'], i + 1);
  if (from >= 0) {
    const end = indexOfWord(items, ['WHERE', 'RETURNING', 'ORDER', 'LIMIT'], from + 1);
    sources.push(...parseSources(items.slice(from + 1, end < 0 ? items.length : end), 'inner'));
  }
  requireScope(sources, clauseAfter(items, 'WHERE', ['RETURNING', 'ORDER', 'LIMIT']), problems);
}

function checkDelete(items: readonly Item[], problems: string[]): void {
  const from = indexOfWord(items, ['FROM']);
  if (from < 0) return;
  const { name: table } = tableAt(items, from + 1);
  requireScope(
    [{ table, join: 'first', on: null }],
    clauseAfter(items, 'WHERE', ['RETURNING', 'ORDER', 'LIMIT']),
    problems,
  );
}

/** One level of a statement (no recursion into subqueries: `checkQuery` does that). */
function checkLevel(items: readonly Item[], problems: string[]): void {
  switch (firstWord(items)) {
    case 'WITH': {
      const main = indexOfWord(items, STATEMENT_STARTS, 1);
      if (main > 0) checkLevel(items.slice(main), problems);
      return;
    }
    case 'SELECT':
      return checkSelect(items, problems);
    case 'INSERT':
    case 'REPLACE':
      return checkInsert(items, problems);
    case 'UPDATE':
      return checkUpdate(items, problems);
    case 'DELETE':
      return checkDelete(items, problems);
    default:
      return;
  }
}

/** Every parenthesised subquery below this level (not below another subquery: that one recurses itself). */
function forEachSubquery(items: readonly Item[], fn: (group: Group) => void): void {
  for (const item of items) {
    if (!isGroup(item)) continue;
    if (isSubquery(item)) fn(item);
    else forEachSubquery(item.items, fn);
  }
}

/** Checks a statement and, as blocks of their own, all of its subqueries and CTEs. */
function checkQuery(items: readonly Item[], problems: string[]): void {
  forEachSubquery(items, (sub) => checkQuery(sub.items, problems));
  checkLevel(items, problems);
}

// ── The lint ──────────────────────────────────────────────────────────────────────────────────────────────────────

interface Finding {
  file: string;
  line: number;
  statement: string;
  problem: string;
}

const stripComments = (sql: string): string =>
  sql.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/--[^\n]*/g, ' ');

const normalize = (sql: string): string => sql.replace(/\s+/g, ' ').trim();

const statementsOf = (sql: string): string[] =>
  stripComments(sql)
    .split(';')
    .map(normalize)
    .filter((s) => s.length > 0);

/** Text after `start` up to the end of its FROM list (depth 0), for the comma-separated tables. */
function fromList(sql: string, start: number): string {
  let depth = 0;
  let out = '';
  const rest = sql.slice(start);
  const words = rest.split(/(\s+|[(),])/);
  for (const part of words) {
    if (part === '(') depth++;
    if (part === ')') {
      if (depth === 0) break;
      depth--;
    }
    if (depth === 0 && STOP_WORDS.test(part)) break;
    out += part;
  }
  return out;
}

/** Per-user tables a statement names anywhere (after FROM / INTO / UPDATE / JOIN or in a FROM list), and whether a table name is interpolated. */
function tablesOf(stmt: string): { tables: Set<string>; dynamic: boolean } {
  const tables = new Set<string>();
  let dynamic = /\b(?:FROM|INTO|UPDATE|JOIN)\s+\$\{/i.test(stmt);
  const perUser = (name: string) => (PER_USER_TABLES as readonly string[]).includes(name.toLowerCase());
  for (const m of stmt.matchAll(/\b(?:FROM|INTO|UPDATE|JOIN)\s+([A-Za-z_]\w*)/gi)) {
    if (m[1] && perUser(m[1])) tables.add(m[1].toLowerCase());
  }
  for (const m of stmt.matchAll(/\bFROM\b/gi)) {
    const list = fromList(stmt, (m.index ?? 0) + m[0].length);
    let depth = 0;
    let item = '';
    const items: string[] = [];
    for (const ch of list) {
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) {
        items.push(item);
        item = '';
      } else {
        item += ch;
      }
    }
    items.push(item);
    for (const raw of items) {
      if (raw.trim().startsWith('${')) dynamic = true;
      const name = /^\s*([A-Za-z_]\w*)\s*(?!\()/.exec(raw)?.[1];
      if (name && perUser(name) && !/^\s*[A-Za-z_]\w*\s*\(/.test(raw)) tables.add(name.toLowerCase());
    }
  }
  return { tables, dynamic };
}

/** What is wrong with one statement, or null. */
function problemOf(stmt: string): string | null {
  const kind = /^\(?\s*([A-Za-z]+)/.exec(stmt)?.[1]?.toUpperCase() ?? '';
  if (!CHECKED_KINDS.has(kind)) return null;
  const { tables, dynamic } = tablesOf(stmt);
  if (dynamic) return 'interpolated table name';
  if (tables.size === 0) return null;
  if (tables.size >= 2) return `names ${tables.size} per-user tables (${[...tables].sort().join(', ')})`;
  let items = parse(stmt);
  let first = items[0];
  while (items.length === 1 && isGroup(first)) {
    items = first.items;
    first = items[0];
  }
  const problems: string[] = [];
  checkQuery(items, problems);
  return problems[0] ?? null;
}

/** SQL-looking string / template literals of a TypeScript source (template interpolations shown as `${…}`). */
function sqlLiterals(fileName: string, source: string): { text: string; line: number }[] {
  const sf = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const out: { text: string; line: number }[] = [];
  const visit = (node: ts.Node): void => {
    let text: string | null = null;
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) text = node.text;
    else if (ts.isTemplateExpression(node)) {
      text = node.head.text + node.templateSpans.map((s) => `\${…}${s.literal.text}`).join('');
    }
    if (text !== null && SQL_WORD.test(text)) {
      out.push({ text, line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1 });
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

interface LintResult {
  findings: Finding[];
  /** Entries that match no statement. */
  stale: AllowEntry[];
  /** Entries whose statements all pass without them. */
  unneeded: AllowEntry[];
}

function lint(
  files: readonly { file: string; source: string }[],
  allowlist: readonly AllowEntry[],
): LintResult {
  const used = new Set<AllowEntry>();
  const needed = new Set<AllowEntry>();
  const findings: Finding[] = [];
  for (const { file, source } of files) {
    for (const literal of sqlLiterals(file, source)) {
      for (const statement of statementsOf(literal.text)) {
        const entries = allowlist.filter((e) => e.file === file && statement.includes(normalize(e.match)));
        const problem = problemOf(statement);
        for (const e of entries) {
          used.add(e);
          if (problem) needed.add(e);
        }
        if (problem && !entries.length) findings.push({ file, line: literal.line, statement, problem });
      }
    }
  }
  return {
    findings,
    stale: allowlist.filter((e) => !used.has(e)),
    unneeded: allowlist.filter((e) => used.has(e) && !needed.has(e)),
  };
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

const serverSources = () =>
  sourceFiles(SRC).map((path) => ({
    file: relative(SRC, path).split(sep).join('/'),
    source: readFileSync(path, 'utf8'),
  }));

// ── Tests ─────────────────────────────────────────────────────────────────────────────────────────────────────────

const one = (sql: string, allowlist: readonly AllowEntry[] = []) =>
  lint([{ file: 'x.ts', source: `const q = ${JSON.stringify(sql)};` }], allowlist);
const template = (body: string) =>
  lint([{ file: 'x.ts', source: `const t = 'days'; const q = \`${body}\`;` }], []);

describe('scope lint: self-test', () => {
  it.each([
    ['SELECT date, kg FROM weights ORDER BY user_id', 'no bound user_id predicate'],
    [
      'SELECT d.* FROM days d JOIN photos p ON p.user_id = d.user_id WHERE p.id = ?',
      'names 2 per-user tables',
    ],
    ['SELECT * FROM days -- WHERE user_id = ?', 'no bound user_id predicate'],
    ['SELECT * FROM days /* WHERE user_id = ? */ WHERE date = ?', 'no bound user_id predicate'],
    ['SELECT * FROM days d WHERE d.user_id = d.user_id', 'no bound user_id predicate'],
    ['SELECT user_id FROM foods WHERE key = ?', 'no bound user_id predicate'],
    ['UPDATE photos SET date = ? WHERE id = ?', 'no bound user_id predicate'],
    ['INSERT INTO weights (date, kg, updated_at) VALUES (?, ?, ?)', 'INSERT without user_id'],
    ['INSERT OR IGNORE INTO reminder_log (kind, date) VALUES (?, ?)', 'INSERT without user_id'],
    ['SELECT 1 FROM json_each(?) j, measures m WHERE m.date = j.value', 'no bound user_id predicate'],
    ['DELETE FROM user_settings', 'no bound user_id predicate'],
    // The predicate in the SET list moves every user's row on that date.
    ['UPDATE days SET user_id = ? WHERE date = ?', 'no bound user_id predicate'],
    ['UPDATE days SET food = ? WHERE date = ? RETURNING user_id = ?', 'no bound user_id predicate'],
    // Next to an OR, at the top or inside the group that holds it.
    ['SELECT * FROM days WHERE date = ? OR user_id = ?', 'no bound user_id predicate'],
    ['DELETE FROM photos WHERE user_id = ? OR 1 = 1', 'no bound user_id predicate'],
    ['SELECT * FROM days WHERE user_id = ? AND date = ? OR 1 = 1', 'no bound user_id predicate'],
    [
      'DELETE FROM push_subscriptions WHERE endpoint = ? AND (user_id = ? OR auth = ?)',
      'no bound user_id predicate',
    ],
    // INSERT … SELECT: an unscoped SELECT copies everybody's rows.
    [
      'INSERT INTO days (user_id, date, food) SELECT ?, date, food FROM days WHERE date = ?',
      'no bound user_id predicate',
    ],
    // A predicate only inside a subquery does not scope the outer block (here: everybody's days on anna's dates).
    [
      'SELECT * FROM days WHERE date IN (SELECT date FROM days WHERE user_id = ?)',
      'no bound user_id predicate',
    ],
    [
      'WITH x AS (SELECT date, food FROM days) SELECT * FROM x WHERE user_id = ?',
      'no bound user_id predicate',
    ],
    // Negated, conditional, inside a function or a BETWEEN: not a conjunct.
    ['SELECT * FROM days WHERE NOT user_id = ?', 'no bound user_id predicate'],
    ['SELECT * FROM days WHERE NOT (user_id = ? AND date = ?)', 'no bound user_id predicate'],
    ['SELECT * FROM days WHERE CASE WHEN user_id = ? THEN 1 ELSE 1 END', 'no bound user_id predicate'],
    ['SELECT * FROM days WHERE coalesce(user_id = ?, 1)', 'no bound user_id predicate'],
    ['SELECT * FROM days WHERE date BETWEEN ? AND user_id = ?', 'no bound user_id predicate'],
    ['SELECT * FROM days WHERE user_id = ? IS NULL', 'no bound user_id predicate'],
    // The ON of a LEFT JOIN does not filter the left table.
    ['SELECT d.food FROM days d LEFT JOIN users u ON d.user_id = ?', 'no bound user_id predicate'],
    // One table joined to itself: one alias scoped, the other not.
    [
      'SELECT b.food FROM days a JOIN days b ON b.date = a.date WHERE a.user_id = ?',
      'joins 2 per-user tables',
    ],
    // Global keys: an upsert or REPLACE can reach another user's row.
    [
      'INSERT INTO photos (id, user_id, date) VALUES (?, ?, ?) ON CONFLICT (id) DO UPDATE SET date = excluded.date',
      'ON CONFLICT on a key without user_id',
    ],
    [
      'INSERT INTO photos (id, user_id) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET date = 1 WHERE photos.user_id = excluded.user_id OR 1 = 1',
      'ON CONFLICT on a key without user_id',
    ],
    ['INSERT OR REPLACE INTO photos (id, user_id, date) VALUES (?, ?, ?)', 'REPLACE on photos'],
    ['REPLACE INTO push_subscriptions (endpoint, user_id) VALUES (?, ?)', 'REPLACE on push_subscriptions'],
  ])('flags %s', (sql, problem) => {
    const { findings } = one(sql);
    expect(findings).toHaveLength(1);
    expect(findings[0]?.problem).toContain(problem);
  });

  it('checks every statement of a literal on its own', () => {
    const { findings } = one('DELETE FROM days WHERE user_id = ?; DELETE FROM weights;');
    expect(findings.map((f) => f.statement)).toEqual(['DELETE FROM weights']);
  });

  it('flags an interpolated table name', () => {
    expect(template('SELECT * FROM ${t} WHERE user_id = ?').findings[0]?.problem).toBe(
      'interpolated table name',
    );
  });

  it.each([
    'SELECT date FROM weights WHERE user_id = ? ORDER BY date',
    'SELECT 1 FROM days d WHERE d.user_id = :id AND d.date = ?',
    'SELECT * FROM days WHERE (user_id = ? AND date = ?)',
    'SELECT * FROM days WHERE date = ? AND (user_id = $id)',
    'SELECT * FROM days WHERE user_id = ? AND (date = ? OR date = ?)',
    'SELECT * FROM days WHERE date BETWEEN ? AND ? AND user_id = ?',
    "SELECT * FROM days WHERE food = 'a OR b' AND user_id = ?",
    'UPDATE days SET food = ?, kcal = CASE WHEN kcal IS NULL THEN 0 ELSE kcal END WHERE user_id = ? AND date = ?',
    'DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?',
    'INSERT INTO days (user_id, date) VALUES (?, ?) ON CONFLICT (user_id, date) DO UPDATE SET food = excluded.food',
    'INSERT INTO days (user_id, date, food) SELECT ?, ?, food FROM days WHERE user_id = ? AND date = ?',
    'INSERT INTO days_v3 (date, food) SELECT date, food FROM days WHERE user_id = ?',
    'INSERT OR IGNORE INTO reminder_log (user_id, kind, date) VALUES (?, ?, ?)',
    'INSERT INTO photos (id, user_id) VALUES (?, ?) ON CONFLICT (id) DO UPDATE SET date = 1 WHERE photos.user_id = excluded.user_id',
    'INSERT INTO photos (id, user_id) VALUES (?, ?) ON CONFLICT (id) DO NOTHING',
    'INSERT INTO user_settings (user_id, value) SELECT (SELECT id FROM users WHERE legacy_owner = 1), value FROM kv',
    'SELECT d.date FROM users u JOIN days d ON d.user_id = ? WHERE u.id = ?',
    'SELECT u.id, d.date FROM users u LEFT JOIN days d ON d.user_id = ? AND d.date = ?',
    'WITH mine AS (SELECT date FROM days WHERE user_id = ?) SELECT date FROM mine',
    'SELECT date FROM days WHERE user_id = ? UNION ALL SELECT date FROM days WHERE user_id = ?',
    'DELETE FROM sessions WHERE user_id = ? AND token_hash IN (SELECT token_hash FROM sessions WHERE user_id = ? ORDER BY renewed_at DESC LIMIT -1 OFFSET ?)',
    'SELECT value FROM kv WHERE key = ?',
    'CREATE TABLE days (user_id TEXT REFERENCES users (id) ON DELETE CASCADE)',
    'SELECT id FROM users WHERE username_key = ?',
  ])('passes %s', (sql) => {
    expect(one(sql).findings).toEqual([]);
  });

  it('a compound SELECT needs the predicate in every part', () => {
    const { findings } = one(
      'SELECT date FROM days WHERE user_id = ? UNION SELECT date FROM days WHERE date = ?',
    );
    expect(findings).toHaveLength(1);
  });

  it('a deliberately cross-user statement passes only through a reasoned entry', () => {
    const sql = 'DELETE FROM push_subscriptions WHERE endpoint = ? AND (user_id = ? OR auth = ?)';
    expect(one(sql).findings).toHaveLength(1);
    const entry = { file: 'x.ts', match: sql, reason: 'D15' };
    expect(one(sql, [entry])).toEqual({ findings: [], stale: [], unneeded: [] });
  });

  it('an allowlist entry exempts exactly its statements; an entry that matches nothing is stale', () => {
    const source = `const a = 'SELECT 1 FROM photos WHERE id = ?'; const b = 'SELECT 2 FROM days';`;
    const entry = { file: 'x.ts', match: 'SELECT 1 FROM photos WHERE id = ?', reason: 'test' };
    const staleEntry = { file: 'x.ts', match: 'SELECT nothing', reason: 'test' };
    const wrongFile = { file: 'y.ts', match: 'SELECT 2 FROM days', reason: 'test' };
    const result = lint([{ file: 'x.ts', source }], [entry, staleEntry, wrongFile]);
    expect(result.findings.map((f) => f.statement)).toEqual(['SELECT 2 FROM days']);
    expect(result.stale).toEqual([staleEntry, wrongFile]);
    expect(result.unneeded).toEqual([]);
  });

  it('an entry whose statements all pass on their own is reported as unneeded', () => {
    const entry = { file: 'x.ts', match: 'FROM days WHERE user_id = ?', reason: 'test' };
    const result = one('SELECT date FROM days WHERE user_id = ?', [entry]);
    expect(result).toEqual({ findings: [], stale: [], unneeded: [entry] });
  });
});

describe('scope lint: apps/server/src', () => {
  const { findings, stale, unneeded } = lint(serverSources(), ALLOWLIST);

  it('every statement on a per-user table is scoped to one user or allowlisted', () => {
    expect(findings.map((f) => `${f.file}:${f.line} ${f.problem}: ${f.statement}`)).toEqual([]);
  });

  it('has no stale or unneeded allowlist entries', () => {
    expect(stale).toEqual([]);
    expect(unneeded).toEqual([]);
  });

  it('sees the repositories (the lint is not vacuous)', () => {
    const files = new Set(
      serverSources()
        .filter((f) => sqlLiterals(f.file, f.source).length > 0)
        .map((f) => f.file),
    );
    for (const file of [
      'db/data.ts',
      'db/users.ts',
      'db/tokens.ts',
      'db/downgrade.ts',
      'db/migrations.ts',
      'auth/sessions.ts',
      'photos/store.ts',
      'push/subscriptions.ts',
    ]) {
      expect(files.has(file), file).toBe(true);
    }
  });
});
