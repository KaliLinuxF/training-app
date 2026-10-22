import type { DataRepo } from '../db/data';
import { silentLogger, type Logger } from '../logger';
import { REMINDER_MESSAGES, workoutReminder } from '../push/messages';
import type { UserPush } from '../push/service';
import type { ReminderLog } from './log';
import { planReminders, type PlannedReminder } from './schedule';

/**
 * ONE user's view (docs/multi-user.md §5.4): their settings (`rem`, `timezone`) and rows, their reminder log and
 * their devices — the scheduler builds these with `forUser(id)` for each recipient.
 */
export interface ReminderRunnerDeps {
  data: Pick<DataRepo, 'settings' | 'isDone' | 'workoutNamesOn'>;
  log: ReminderLog;
  push: Pick<UserPush, 'send'>;
  logger?: Logger;
}

export type TickOutcome = PlannedReminder & { result: 'sent' | 'skipped' | 'retry'; delivered: number };

/** How long one user's tick may hold up the others (push deliveries settle within 20 s each, in parallel). */
export const USER_TICK_TIMEOUT_MS = 30_000;

export interface ReminderRoundOptions {
  timeoutMs?: number;
  logger?: Logger;
}

/** Runs `tick(id)` for each recipient of one scheduler tick. */
export type ReminderRound = <Id extends string>(
  ids: readonly Id[],
  tick: (id: Id) => Promise<unknown>,
) => Promise<void>;

/**
 * The scheduler's per-user loop: each recipient in turn, with only their own settings, rows, log and devices. One
 * user's failure is logged and stops nobody else; a tick still running after `timeoutMs` is left to finish on its own
 * while the others go on, and that user is skipped until it ends (so a slow push service never sends one reminder
 * twice).
 */
export function createReminderRound({
  timeoutMs = USER_TICK_TIMEOUT_MS,
  logger = silentLogger,
}: ReminderRoundOptions = {}): ReminderRound {
  const running = new Set<string>();

  return async (ids, tick) => {
    for (const id of ids) {
      if (running.has(id)) {
        logger.warn(`reminders ${id}: the previous tick is still running, skipped`);
        continue;
      }
      running.add(id);
      const run = (async () => {
        try {
          await tick(id);
        } catch (err) {
          logger.error(`reminders ${id} failed`, err);
        } finally {
          running.delete(id);
        }
      })();
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<'late'>((resolve) => {
        timer = setTimeout(() => resolve('late'), timeoutMs);
        timer.unref();
      });
      const outcome = await Promise.race([run.then(() => 'done' as const), late]);
      clearTimeout(timer);
      if (outcome === 'late')
        logger.warn(`reminders ${id}: still running after ${timeoutMs} ms, going on with the others`);
    }
  };
}

/**
 * One scheduler tick for one user: sends every due reminder that was not handled today, then logs it.
 * When every delivery failed for a retryable reason the reminder is not logged, so the next
 * tick (still inside the 15-minute window) tries again.
 */
export async function runReminderTick(deps: ReminderRunnerDeps, now: Date): Promise<TickOutcome[]> {
  const { data, log, push, logger = silentLogger } = deps;
  const plan = planReminders({
    settings: data.settings(),
    now,
    handled: (kind, date) => log.has(kind, date),
    done: (kind, date) => data.isDone(kind, date),
  });

  const outcomes: TickOutcome[] = [];
  for (const item of plan) {
    if (item.action === 'skip') {
      log.record(item.kind, item.date, 'skipped', 0, now.getTime());
      logger.info(`reminder ${item.kind} ${item.date}: already done, skipped`);
      outcomes.push({ ...item, result: 'skipped', delivered: 0 });
      continue;
    }
    const message =
      item.kind === 'workout' ? workoutReminder(data.workoutNamesOn(item.date)) : REMINDER_MESSAGES[item.kind];
    const summary = await push.send(message);
    if (
      summary.attempted > 0 &&
      summary.sent === 0 &&
      summary.retryable === summary.failed &&
      summary.failed > 0
    ) {
      logger.warn(`reminder ${item.kind} ${item.date}: all deliveries failed, will retry`);
      outcomes.push({ ...item, result: 'retry', delivered: 0 });
      continue;
    }
    log.record(item.kind, item.date, 'sent', summary.sent, now.getTime());
    logger.info(`reminder ${item.kind} ${item.date}: sent to ${summary.sent}/${summary.attempted}`);
    outcomes.push({ ...item, result: 'sent', delivered: summary.sent });
  }
  return outcomes;
}
