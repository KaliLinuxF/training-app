export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'silent'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export interface Logger {
  debug(message: string): void;
  info(message: string): void;
  warn(message: string): void;
  error(message: string, err?: unknown): void;
}

type Sink = (line: string, level: Exclude<LogLevel, 'silent'>) => void;

const rank: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const defaultSink: Sink = (line, level) => {
  if (level === 'warn' || level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
};

export const isLogLevel = (s: string): s is LogLevel => (LOG_LEVELS as readonly string[]).includes(s);

/** Plain one-line logs (Docker adds its own metadata). Callers never pass secrets or bodies. */
export function createLogger(level: LogLevel = 'info', sink: Sink = defaultSink): Logger {
  const emit = (lvl: Exclude<LogLevel, 'silent'>, message: string): void => {
    if (rank[lvl] < rank[level]) return;
    sink(`${new Date().toISOString()} ${lvl.toUpperCase().padEnd(5)} ${message}`, lvl);
  };
  return {
    debug: (m) => emit('debug', m),
    info: (m) => emit('info', m),
    warn: (m) => emit('warn', m),
    error: (m, err) => emit('error', err === undefined ? m : `${m}: ${describeError(err)}`),
  };
}

export const silentLogger: Logger = createLogger('silent');

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.stack ?? `${err.name}: ${err.message}`;
  return String(err);
}
