import { isIPv4, isIPv6 } from 'node:net';
import { getKv, KV, setKv } from '../db/kv';
import type { Database } from '../db/sqlite';
import { silentLogger, type Logger } from '../logger';

export interface RateLimitDecision {
  limited: boolean;
  /** Seconds until the next attempt is allowed (0 when not limited). */
  retryAfter: number;
}

export interface RateLimiter {
  check(key: string, now: number): RateLimitDecision;
  fail(key: string, now: number): void;
  reset(key: string): void;
}

export interface RateLimiterOptions {
  maxFailures: number;
  windowMs: number;
  /** Upper bound on tracked keys so a flood of addresses cannot grow memory without limit. */
  maxKeys?: number;
}

/** Per client address (an IPv6 address counts as its /64). */
export const LOGIN_RATE_LIMIT: RateLimiterOptions = { maxFailures: 5, windowMs: 15 * 60_000 };

/**
 * Failed logins from all addresses together. Many addresses (a botnet, an IPv6 range) then still
 * get a fixed number of guesses in total; while the cap holds, every login answers 429.
 */
export const LOGIN_GLOBAL_LIMIT: Pick<RateLimiterOptions, 'maxFailures' | 'windowMs'> = {
  maxFailures: 20,
  windowMs: 15 * 60_000,
};

const NOT_LIMITED: RateLimitDecision = { limited: false, retryAfter: 0 };

/** Limited when `times` (ascending, all within the window) holds `maxFailures` entries. */
function decide(
  times: readonly number[],
  maxFailures: number,
  windowMs: number,
  now: number,
): RateLimitDecision {
  if (times.length < maxFailures) return NOT_LIMITED;
  const oldestRelevant = times[times.length - maxFailures] ?? now;
  return { limited: true, retryAfter: Math.max(1, Math.ceil((oldestRelevant + windowMs - now) / 1000)) };
}

/** Sliding-window failure counter: `maxFailures` failures within `windowMs` block further attempts. */
export function createRateLimiter({
  maxFailures,
  windowMs,
  maxKeys = 10_000,
}: RateLimiterOptions): RateLimiter {
  const failures = new Map<string, number[]>();

  const recent = (key: string, now: number): number[] => {
    const list = (failures.get(key) ?? []).filter((t) => now - t < windowMs);
    if (list.length) failures.set(key, list);
    else failures.delete(key);
    return list;
  };

  const evictStale = (now: number): void => {
    for (const key of failures.keys()) recent(key, now);
    // Still too many: drop the oldest-inserted keys.
    for (const key of failures.keys()) {
      if (failures.size < maxKeys) break;
      failures.delete(key);
    }
  };

  return {
    check: (key, now) => decide(recent(key, now), maxFailures, windowMs, now),
    fail(key, now) {
      if (!failures.has(key) && failures.size >= maxKeys) evictStale(now);
      failures.set(key, [...recent(key, now), now]);
    },
    reset(key) {
      failures.delete(key);
    },
  };
}

/** Parses an IPv6 address (with optional embedded IPv4 tail) into its eight 16-bit groups. */
function ipv6Groups(address: string): number[] {
  let text = address;
  const v4 = /(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(text);
  if (v4) {
    const [a, b, c, d] = v4.slice(1).map(Number) as [number, number, number, number];
    text = `${text.slice(0, v4.index)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', tail] = text.split('::');
  const parts = (s: string): string[] => (s ? s.split(':') : []);
  const groups =
    tail === undefined
      ? parts(head)
      : [
          ...parts(head),
          ...Array<string>(8 - parts(head).length - parts(tail).length).fill('0'),
          ...parts(tail),
        ];
  return groups.map((g) => parseInt(g, 16));
}

/**
 * Rate-limit key of a client address: IPv4 as is (also when IPv4-mapped, `::ffff:1.2.3.4`), IPv6 by
 * its /64 — one subscriber usually holds a whole /64, so per-address counting would be useless.
 */
export function addressKey(ip: string): string {
  const address =
    ip
      .trim()
      .replace(/^\[(.*)\]$/, '$1')
      .split('%')[0] ?? '';
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(address);
  if (mapped?.[1] && isIPv4(mapped[1])) return mapped[1];
  if (!isIPv6(address)) return address || ip;
  const prefix = ipv6Groups(address)
    .slice(0, 4)
    .map((g) => g.toString(16))
    .join(':');
  return `${prefix}::/64`;
}

/** Where the global failure times live between restarts. */
export interface FailureLog {
  load(): number[];
  save(times: readonly number[]): void;
}

export function memoryFailureLog(): FailureLog {
  let saved: number[] = [];
  return {
    load: () => [...saved],
    save: (times) => {
      saved = [...times];
    },
  };
}

/** `kv.login_failures`: a restart (or a crash forced by a flood) must not hand out fresh guesses. */
export function kvFailureLog(db: Database): FailureLog {
  return {
    load() {
      try {
        const parsed: unknown = JSON.parse(getKv(db, KV.loginFailures) ?? '[]');
        return Array.isArray(parsed) ? parsed.filter((t): t is number => Number.isFinite(t)) : [];
      } catch {
        return [];
      }
    },
    save: (times) => setKv(db, KV.loginFailures, JSON.stringify(times)),
  };
}

export interface LoginLimiterOptions {
  perAddress?: RateLimiterOptions;
  global?: Pick<RateLimiterOptions, 'maxFailures' | 'windowMs'>;
  /** Default: in memory only. */
  log?: FailureLog;
  logger?: Logger;
}

/**
 * Login throttle keyed by client IP: `perAddress` failures per address (IPv6 per /64, in memory)
 * plus `global` failures across all addresses, kept in `log` (read on every call, so clearing the
 * stored record takes effect at once). `reset` is called after a successful login: it clears the
 * address and takes back the attempt that login had counted globally.
 */
export function createLoginLimiter({
  perAddress = LOGIN_RATE_LIMIT,
  global = LOGIN_GLOBAL_LIMIT,
  log = memoryFailureLog(),
  logger = silentLogger,
}: LoginLimiterOptions = {}): RateLimiter {
  const byAddress = createRateLimiter(perAddress);
  const { maxFailures, windowMs } = global;
  // Entries dated in the future (clock moved back) count until they are a window old.
  const inWindow = (t: number, now: number): boolean => Math.abs(now - t) < windowMs;
  let warnedAt = -Infinity;

  /** Global failures still inside the window, oldest first; only the newest `maxFailures` matter. */
  const recent = (now: number): number[] => {
    const stored = log.load();
    const kept = stored
      .filter((t) => inWindow(t, now))
      .sort((a, b) => a - b)
      .slice(-maxFailures);
    if (kept.length !== stored.length) log.save(kept);
    return kept;
  };

  return {
    check(ip, now) {
      const own = byAddress.check(addressKey(ip), now);
      return own.limited ? own : decide(recent(now), maxFailures, windowMs, now);
    },
    fail(ip, now) {
      byAddress.fail(addressKey(ip), now);
      const times = [...recent(now), now].slice(-maxFailures);
      log.save(times);
      if (times.length === maxFailures && now - warnedAt >= windowMs) {
        warnedAt = now;
        logger.warn(
          `${maxFailures} failed logins within ${windowMs / 60_000} min from all addresses: ` +
            'every login is refused until they age out',
        );
      }
    },
    reset(ip) {
      byAddress.reset(addressKey(ip));
      const times = log.load().sort((a, b) => a - b);
      if (times.length) log.save(times.slice(0, -1));
    },
  };
}
