import { resolve } from 'node:path';
import { DEFAULT_AI_LIMITS, type UserRole } from '@legko/shared';
import { isLogLevel, type LogLevel } from './logger';

export interface VapidEnv {
  subject: string;
  /** Both set or both null (keys are then generated and kept in the database). */
  publicKey: string | null;
  privateKey: string | null;
}

/** Where a configured value came from (logged at start-up next to the effective AI limits). */
export type ValueSource = 'env' | 'default';

/** AI calorie estimate (SPEC §3.7, docs/multi-user.md §5.3). */
export interface FoodAiEnv {
  /** `ANTHROPIC_API_KEY`; null disables the feature (the UI hides it). Never log it. */
  apiKey: string | null;
  /** `FOOD_AI_MODEL`. */
  model: string;
  /**
   * `FOOD_DAILY_LIMIT`: the GLOBAL ceiling — model calls for everybody together per Kyiv day (default 150; 0 turns
   * AI off). Limits an admin saved (`kv.ai_limits`) win over it.
   */
  dailyLimit: number;
  /** `FOOD_USER_DAILY_LIMIT`: model calls per user per Kyiv day (default 40). */
  userDailyLimit: number;
  sources: { dailyLimit: ValueSource; userDailyLimit: ValueSource };
}

/** A development account applied at start-up (`auth/devUsers.ts`). */
export interface DevUser {
  username: string;
  password: string;
  role: UserRole;
}

export interface Config {
  port: number;
  /** Absolute path; holds `legko.db`, `backups/` and `photos/`. */
  dataDir: string;
  /** Absolute path of the built web app, or null (dev: Vite serves the UI). */
  staticDir: string | null;
  /** Canonical origin, e.g. `https://fit.triple-a.dev` (no trailing slash). */
  publicOrigin: string;
  production: boolean;
  /** Behind Caddy: trust `X-Forwarded-For/-Host/-Proto`. */
  trustProxy: boolean;
  vapid: VapidEnv;
  logLevel: LogLevel;
  /**
   * Development only (always empty in production): `DEV_USERNAME` (default anna, role user) with `DEV_PASSWORD`, and
   * `DEV_ADMIN_USERNAME` (default admin, role admin) with `DEV_ADMIN_PASSWORD`; an entry exists only when its
   * password is set.
   */
  devUsers: DevUser[];
  foodAi: FoodAiEnv;
}

export const DEFAULT_PUBLIC_ORIGIN = 'https://fit.triple-a.dev';
export const DEFAULT_FOOD_AI_MODEL = 'claude-opus-5-5';
/** Global ceiling per Kyiv day (`FOOD_DAILY_LIMIT`). */
export const DEFAULT_FOOD_DAILY_LIMIT = DEFAULT_AI_LIMITS.global;
/** Per user per Kyiv day (`FOOD_USER_DAILY_LIMIT`). */
export const DEFAULT_FOOD_USER_DAILY_LIMIT = DEFAULT_AI_LIMITS.perUser;
export const DEFAULT_DEV_USERNAME = 'anna';
export const DEFAULT_DEV_ADMIN_USERNAME = 'admin';

export class ConfigError extends Error {
  override name = 'ConfigError';
}

type Env = Record<string, string | undefined>;

const value = (env: Env, key: string): string | undefined => {
  const v = env[key]?.trim();
  return v ? v : undefined;
};

export const isProduction = (env: Env): boolean => value(env, 'NODE_ENV') === 'production';

/** `DATA_DIR`, defaulting to `/data` in production and `./data` (from the cwd) otherwise. */
export function resolveDataDir(env: Env = process.env, cwd: string = process.cwd()): string {
  return resolve(cwd, value(env, 'DATA_DIR') ?? (isProduction(env) ? '/data' : './data'));
}

function parsePort(raw: string | undefined): number {
  if (raw === undefined) return 3000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new ConfigError(`PORT must be 1–65535, got "${raw}"`);
  return port;
}

function parseOrigin(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ConfigError(`PUBLIC_ORIGIN must be an absolute URL, got "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:')
    throw new ConfigError('PUBLIC_ORIGIN must be http(s)');
  return url.origin;
}

const isVapidSubject = (s: string): boolean => /^(https:|mailto:)/.test(s);

function parseVapid(env: Env, publicOrigin: string): VapidEnv {
  const explicit = value(env, 'VAPID_SUBJECT');
  if (explicit !== undefined && !isVapidSubject(explicit)) {
    throw new ConfigError('VAPID_SUBJECT must be an https: URL or a mailto: address');
  }
  // Push services reject http/localhost subjects, so a dev origin falls back to the real one.
  const subject = explicit ?? (isVapidSubject(publicOrigin) ? publicOrigin : DEFAULT_PUBLIC_ORIGIN);
  const publicKey = value(env, 'VAPID_PUBLIC_KEY') ?? null;
  const privateKey = value(env, 'VAPID_PRIVATE_KEY') ?? null;
  if ((publicKey === null) !== (privateKey === null)) {
    throw new ConfigError('Set both VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY, or neither');
  }
  return { subject, publicKey, privateKey };
}

function parseLogLevel(raw: string | undefined): LogLevel {
  if (raw === undefined) return 'info';
  const level = raw.toLowerCase();
  if (!isLogLevel(level))
    throw new ConfigError(`LOG_LEVEL must be debug|info|warn|error|silent, got "${raw}"`);
  return level;
}

function parseLimit(
  name: string,
  raw: string | undefined,
  fallback: number,
  max: number,
): { value: number; source: ValueSource } {
  if (raw === undefined) return { value: fallback, source: 'default' };
  const limit = Number(raw);
  if (!Number.isInteger(limit) || limit < 0 || limit > max)
    throw new ConfigError(`${name} must be an integer 0–${max}, got "${raw}"`);
  return { value: limit, source: 'env' };
}

function parseFoodAi(env: Env): FoodAiEnv {
  const global = parseLimit(
    'FOOD_DAILY_LIMIT',
    value(env, 'FOOD_DAILY_LIMIT'),
    DEFAULT_FOOD_DAILY_LIMIT,
    10_000,
  );
  const perUser = parseLimit(
    'FOOD_USER_DAILY_LIMIT',
    value(env, 'FOOD_USER_DAILY_LIMIT'),
    DEFAULT_FOOD_USER_DAILY_LIMIT,
    1000,
  );
  return {
    apiKey: value(env, 'ANTHROPIC_API_KEY') ?? null,
    model: value(env, 'FOOD_AI_MODEL') ?? DEFAULT_FOOD_AI_MODEL,
    dailyLimit: global.value,
    userDailyLimit: perUser.value,
    sources: { dailyLimit: global.source, userDailyLimit: perUser.source },
  };
}

/** Never honoured in production, even if the variables leak into the environment. */
function parseDevUsers(env: Env, production: boolean): DevUser[] {
  if (production) return [];
  const users: DevUser[] = [];
  const password = env.DEV_PASSWORD || null;
  if (password) {
    users.push({ username: value(env, 'DEV_USERNAME') ?? DEFAULT_DEV_USERNAME, password, role: 'user' });
  }
  const adminPassword = env.DEV_ADMIN_PASSWORD || null;
  if (adminPassword) {
    users.push({
      username: value(env, 'DEV_ADMIN_USERNAME') ?? DEFAULT_DEV_ADMIN_USERNAME,
      password: adminPassword,
      role: 'admin',
    });
  }
  return users;
}

const truthy = (raw: string | undefined): boolean => raw === '1' || raw?.toLowerCase() === 'true';

export function loadConfig(env: Env = process.env, cwd: string = process.cwd()): Config {
  const production = isProduction(env);
  const publicOrigin = parseOrigin(value(env, 'PUBLIC_ORIGIN') ?? DEFAULT_PUBLIC_ORIGIN);
  const staticDir = value(env, 'STATIC_DIR');
  return {
    port: parsePort(value(env, 'PORT')),
    dataDir: resolveDataDir(env, cwd),
    staticDir: staticDir ? resolve(cwd, staticDir) : null,
    publicOrigin,
    production,
    trustProxy: truthy(value(env, 'TRUST_PROXY')),
    vapid: parseVapid(env, publicOrigin),
    logLevel: parseLogLevel(value(env, 'LOG_LEVEL')),
    devUsers: parseDevUsers(env, production),
    foodAi: parseFoodAi(env),
  };
}
