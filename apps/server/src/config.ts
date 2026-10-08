import { resolve } from 'node:path';
import { isLogLevel, type LogLevel } from './logger';

export interface VapidEnv {
  subject: string;
  /** Both set or both null (keys are then generated and kept in the database). */
  publicKey: string | null;
  privateKey: string | null;
}

export interface Config {
  port: number;
  /** Absolute path; holds `legko.db` and `backups/`. */
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
  /** Development only: password applied at start-up when none is set yet. */
  devPassword: string | null;
}

export const DEFAULT_PUBLIC_ORIGIN = 'https://fit.triple-a.dev';

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
    // Never honoured in production, even if the variable leaks into the environment.
    devPassword: production ? null : (env.DEV_PASSWORD ?? null) || null,
  };
}
