import { silentLogger, type Logger } from './logger';

export interface Loop {
  /** Runs the task now unless a run is already in flight; resolves when that run ends. */
  runNow(): Promise<void>;
  /** Stops the timer and waits for an in-flight run. */
  stop(): Promise<void>;
}

export interface LoopOptions {
  name: string;
  intervalMs: number;
  task: (now: Date) => Promise<void> | void;
  /** Injectable clock (tests). */
  now?: () => Date;
  logger?: Logger;
}

/** A non-overlapping interval: a slow run (e.g. push delivery) delays, never duplicates, the next one. */
export function startLoop({
  name,
  intervalMs,
  task,
  now = () => new Date(),
  logger = silentLogger,
}: LoopOptions): Loop {
  let inFlight: Promise<void> | null = null;
  let stopped = false;

  const execute = async (): Promise<void> => {
    try {
      await task(now());
    } catch (err) {
      logger.error(`${name} failed`, err);
    }
  };

  const run = (): Promise<void> => {
    if (inFlight) return inFlight;
    if (stopped) return Promise.resolve();
    // `.finally` runs after the assignment below even when the task finishes synchronously.
    const current = execute().finally(() => {
      if (inFlight === current) inFlight = null;
    });
    inFlight = current;
    return current;
  };

  const timer = setInterval(() => void run(), intervalMs);
  timer.unref();

  return {
    runNow: run,
    async stop() {
      stopped = true;
      clearInterval(timer);
      await inFlight;
    },
  };
}
