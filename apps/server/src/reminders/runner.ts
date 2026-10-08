import type { DataRepo } from '../db/data';
import { silentLogger, type Logger } from '../logger';
import { REMINDER_MESSAGES } from '../push/messages';
import type { PushService } from '../push/service';
import type { ReminderLog } from './log';
import { planReminders, type PlannedReminder } from './schedule';

export interface ReminderRunnerDeps {
  data: Pick<DataRepo, 'settings' | 'isDone'>;
  log: ReminderLog;
  push: Pick<PushService, 'sendToAll'>;
  logger?: Logger;
}

export type TickOutcome = PlannedReminder & { result: 'sent' | 'skipped' | 'retry'; delivered: number };

/**
 * One scheduler tick: sends every due reminder that was not handled today, then logs it.
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
    const summary = await push.sendToAll(REMINDER_MESSAGES[item.kind]);
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
