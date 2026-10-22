import { defaultSettings, type Settings } from '@legko/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeTransport, type FakeTransport } from '../../test/helpers';
import { createDataRepos, type DataRepo, type DataRepos } from '../db/data';
import { openDatabase } from '../db/open';
import type { Database } from '../db/sqlite';
import { createUserRepo, type UserId, type UserRepo } from '../db/users';
import { createPushService, type PushService } from '../push/service';
import { createReminderLog, type ReminderLog, type ReminderLogs } from './log';
import { combineLoops, startLoop } from '../loop';
import { silentLogger, type Logger } from '../logger';
import { createReminderRound, runReminderTick, type ReminderRound, type ReminderRunnerDeps } from './runner';

// Monday 2026-10-12 08:00 Kyiv.
const WEIGH_AT = new Date(Date.UTC(2026, 9, 12, 5, 0));
const TODAY = '2026-10-12';

let db: Database;
let users: UserRepo;
let repos: DataRepos;
let logs: ReminderLogs;
let transport: FakeTransport;
let push: PushService;
let anna: UserId;
let data: DataRepo;
let log: ReminderLog;
let deps: ReminderRunnerDeps;

const depsFor = (id: UserId): ReminderRunnerDeps => ({
  data: repos.forUser(id),
  log: logs.forUser(id),
  push: push.forUser(id),
});

function saveSettings(repo: DataRepo, patch: Partial<Settings['rem']>, timezone = 'Europe/Kyiv'): void {
  const base = defaultSettings();
  const rem = {
    workout: { ...base.rem.workout, on: false },
    weigh: { ...base.rem.weigh, on: false },
    measure: { ...base.rem.measure, on: false },
    ...patch,
  };
  repo.apply([{ kind: 'settings.put', value: { ...base, rem, timezone } }]);
}

const endpoint = (name: string) => `https://push.example/${name}`;
const subscribe = (id: UserId, name: string): void => {
  push.forUser(id).subscribe({ endpoint: endpoint(name), p256dh: `p-${name}`, auth: `a-${name}` }, null);
};

beforeEach(() => {
  db = openDatabase(':memory:');
  users = createUserRepo(db);
  repos = createDataRepos(db);
  logs = createReminderLog(db);
  transport = fakeTransport();
  push = createPushService({ db, transport, publicKey: 'k' });
  anna = users.create({ username: 'anna', role: 'user', passwordHash: null, now: 0, legacyOwner: true }).id;
  data = repos.forUser(anna);
  log = logs.forUser(anna);
  subscribe(anna, 'a');
  deps = depsFor(anna);
  saveSettings(data, { weigh: { on: true, day: 1, time: '08:00' } });
});

describe('runReminderTick', () => {
  it('sends a due reminder once and logs it', async () => {
    const outcomes = await runReminderTick(deps, WEIGH_AT);
    expect(outcomes).toEqual([{ kind: 'weigh', date: TODAY, action: 'send', result: 'sent', delivered: 1 }]);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]?.payload).toEqual({
      title: 'Контрольне зважування ⚖️',
      body: 'Найточніше — зранку, натщесерце',
      url: '/?sheet=weight',
      tag: 'weigh',
    });
    expect(log.has('weigh', TODAY)).toBe(true);

    expect(await runReminderTick(deps, new Date(WEIGH_AT.getTime() + 30_000))).toEqual([]);
    expect(transport.sent).toHaveLength(1);
  });

  it('does nothing outside the window', async () => {
    expect(await runReminderTick(deps, new Date(WEIGH_AT.getTime() - 60_000))).toEqual([]);
    expect(await runReminderTick(deps, new Date(WEIGH_AT.getTime() + 15 * 60_000))).toEqual([]);
    expect(transport.sent).toHaveLength(0);
  });

  it('skips and logs when the weigh-in already exists for today', async () => {
    data.apply([{ kind: 'weight.put', date: TODAY, kg: 65.4 }]);
    const outcomes = await runReminderTick(deps, WEIGH_AT);
    expect(outcomes.map((o) => o.result)).toEqual(['skipped']);
    expect(transport.sent).toHaveLength(0);
    expect(log.has('weigh', TODAY)).toBe(true);
  });

  it('skips measurements already recorded today', async () => {
    saveSettings(data, { measure: { on: true, day: 1, time: '08:00' } });
    data.apply([{ kind: 'measure.put', date: TODAY, value: { chest: null, waist: 70, hips: null } }]);
    expect((await runReminderTick(deps, WEIGH_AT)).map((o) => o.result)).toEqual(['skipped']);
  });

  it('skips the workout reminder once the day has a workout mark (yes or no)', async () => {
    saveSettings(data, { workout: { on: true, days: [1], time: '08:00' } });
    data.apply([
      {
        kind: 'day.put',
        date: TODAY,
        value: { food: 'Омлет', kcal: null, trained: null, types: [], notes: '' },
      },
    ]);
    expect((await runReminderTick(deps, WEIGH_AT)).map((o) => o.result)).toEqual(['sent']);

    const tuesday = new Date(WEIGH_AT.getTime() + 86_400_000);
    saveSettings(data, { workout: { on: true, days: [2], time: '08:00' } });
    data.apply([
      {
        kind: 'day.put',
        date: '2026-10-13',
        value: { food: '', kcal: null, trained: false, types: [], notes: '' },
      },
    ]);
    expect((await runReminderTick(deps, tuesday)).map((o) => o.result)).toEqual(['skipped']);
  });

  it('retries on the next tick when every delivery failed temporarily', async () => {
    transport.outcomes.set(endpoint('a'), { ok: false, statusCode: null, reason: 'ECONNRESET' });
    expect((await runReminderTick(deps, WEIGH_AT)).map((o) => o.result)).toEqual(['retry']);
    expect(log.has('weigh', TODAY)).toBe(false);

    transport.outcomes.clear();
    expect((await runReminderTick(deps, new Date(WEIGH_AT.getTime() + 30_000))).map((o) => o.result)).toEqual(
      ['sent'],
    );
    expect(log.has('weigh', TODAY)).toBe(true);
  });

  it('logs as handled when there are no devices (nothing to retry)', async () => {
    expect(push.forUser(anna).unsubscribe(endpoint('a'))).toBe(true);
    expect(await runReminderTick(deps, WEIGH_AT)).toEqual([
      { kind: 'weigh', date: TODAY, action: 'send', result: 'sent', delivered: 0 },
    ]);
    expect(log.has('weigh', TODAY)).toBe(true);
  });
});

describe('runReminderTick per user (docs/multi-user.md §5.4)', () => {
  let olya: UserId;

  beforeEach(() => {
    olya = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
    subscribe(olya, 'o1');
    subscribe(olya, 'o2');
  });

  /** One scheduler tick as index.ts runs it: every recipient in turn, with their own deps. */
  const tick = async (now: Date) => {
    const out: Record<string, string[]> = {};
    for (const id of push.recipients()) {
      out[id] = (await runReminderTick(depsFor(id), now)).map((o) => `${o.kind}:${o.result}:${o.delivered}`);
    }
    return out;
  };
  const sentTo = () => transport.sent.map((s) => s.endpoint).sort();

  it('two users in different zones each get only their own reminder, at their own local time', async () => {
    // anna: Monday 08:00 Kyiv (05:00 UTC). olya: Monday 08:00 in New York (12:00 UTC).
    saveSettings(repos.forUser(olya), { weigh: { on: true, day: 1, time: '08:00' } }, 'America/New_York');

    expect(await tick(WEIGH_AT)).toEqual({ [anna]: ['weigh:sent:1'], [olya]: [] });
    expect(sentTo()).toEqual([endpoint('a')]);

    transport.sent.length = 0;
    const newYork8 = new Date(Date.UTC(2026, 9, 12, 12, 0));
    expect(await tick(newYork8)).toEqual({ [anna]: [], [olya]: ['weigh:sent:2'] });
    expect(sentTo()).toEqual([endpoint('o1'), endpoint('o2')]);
  });

  it('isDone reads only that user’s rows: anna’s weigh-in does not silence olya’s reminder', async () => {
    saveSettings(repos.forUser(olya), { weigh: { on: true, day: 1, time: '08:00' } });
    data.apply([{ kind: 'weight.put', date: TODAY, kg: 65.4 }]);

    expect(await tick(WEIGH_AT)).toEqual({ [anna]: ['weigh:skipped:0'], [olya]: ['weigh:sent:2'] });
    expect(sentTo()).toEqual([endpoint('o1'), endpoint('o2')]);
  });

  it('the reminder log is per user: one handled reminder never marks the other’s', async () => {
    saveSettings(repos.forUser(olya), { weigh: { on: true, day: 1, time: '08:00' } });
    await runReminderTick(deps, WEIGH_AT);
    expect(log.has('weigh', TODAY)).toBe(true);
    expect(logs.forUser(olya).has('weigh', TODAY)).toBe(false);

    // Olya's devices still get it on the next tick inside the window; anna's are not sent to again.
    transport.sent.length = 0;
    expect(await tick(new Date(WEIGH_AT.getTime() + 30_000))).toEqual({
      [anna]: [],
      [olya]: ['weigh:sent:2'],
    });
    expect(sentTo()).toEqual([endpoint('o1'), endpoint('o2')]);
    expect(logs.forUser(olya).has('weigh', TODAY)).toBe(true);
  });

  it('a user without reminders on gets nothing; a disabled user is not a recipient', async () => {
    saveSettings(repos.forUser(olya), {});
    expect(await tick(WEIGH_AT)).toEqual({ [anna]: ['weigh:sent:1'], [olya]: [] });
    expect(sentTo()).toEqual([endpoint('a')]);
    users.setDisabled(olya, 1);
    expect(push.recipients()).toEqual([anna]);
  });

  it('a gone endpoint is removed from its owner only', async () => {
    saveSettings(repos.forUser(olya), { weigh: { on: true, day: 1, time: '08:00' } });
    transport.outcomes.set(endpoint('o1'), { ok: false, statusCode: 410, reason: 'HTTP 410' });
    await tick(WEIGH_AT);
    const owners = db
      .prepare('SELECT endpoint, user_id FROM push_subscriptions ORDER BY endpoint')
      .all()
      .map((r) => [r.endpoint, r.user_id]);
    expect(owners).toEqual([
      [endpoint('a'), anna],
      [endpoint('o2'), olya],
    ]);
  });
});

describe('createReminderRound (the scheduler’s per-user loop)', () => {
  let olya: UserId;
  /** Answers anna's pending deliveries (her push service hangs until a test calls these). */
  let release: (() => void)[];
  let hanging: PushService;

  beforeEach(() => {
    olya = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
    subscribe(olya, 'o1');
    saveSettings(repos.forUser(olya), { weigh: { on: true, day: 1, time: '08:00' } });
    release = [];
    hanging = createPushService({
      db,
      publicKey: 'k',
      transport: {
        send(sub, payload, options) {
          if (sub.endpoint !== endpoint('a')) return transport.send(sub, payload, options);
          return new Promise((resolve) => release.push(() => resolve({ ok: true })));
        },
      },
    });
  });

  const recording = () => {
    const lines: string[] = [];
    const logger: Logger = {
      ...silentLogger,
      warn: (m) => lines.push(`warn ${m}`),
      error: (m) => lines.push(`error ${m}`),
    };
    return { lines, logger };
  };

  const roundTick = (round: ReminderRound, now: Date): Promise<void> =>
    round(hanging.recipients(), (id) =>
      runReminderTick({ data: repos.forUser(id), log: logs.forUser(id), push: hanging.forUser(id) }, now),
    );

  it('a push service that never answers holds the others up for at most the timeout and is never sent twice', async () => {
    const { lines, logger } = recording();
    const round = createReminderRound({ timeoutMs: 50, logger });

    await roundTick(round, WEIGH_AT);
    // Olya got hers although anna's delivery is still pending.
    expect(transport.sent.map((s) => s.endpoint)).toEqual([endpoint('o1')]);
    expect(logs.forUser(olya).has('weigh', TODAY)).toBe(true);
    expect(log.has('weigh', TODAY)).toBe(false);
    expect(release).toHaveLength(1);
    expect(lines).toEqual([`warn reminders ${anna}: still running after 50 ms, going on with the others`]);

    // The next tick skips anna while her tick still runs: no second reminder to her device.
    await roundTick(round, new Date(WEIGH_AT.getTime() + 30_000));
    expect(release).toHaveLength(1);
    expect(lines[1]).toBe(`warn reminders ${anna}: the previous tick is still running, skipped`);

    // Once her push service answers, her tick ends and logs it; later ticks have nothing left to send her.
    release[0]?.();
    await expect.poll(() => log.has('weigh', TODAY)).toBe(true);
    await roundTick(round, new Date(WEIGH_AT.getTime() + 60_000));
    expect(release).toHaveLength(1);
    expect(transport.sent).toHaveLength(1);
  });

  it('one user’s failing tick is logged and the others still run', async () => {
    const { lines, logger } = recording();
    const round = createReminderRound({ logger });
    await round([anna, olya], async (id) => {
      if (id === anna) throw new Error('boom');
      await runReminderTick(depsFor(id), WEIGH_AT);
    });
    expect(lines).toEqual([`error reminders ${anna} failed`]);
    expect(logs.forUser(olya).has('weigh', TODAY)).toBe(true);
  });

  it('the maintenance loop (backup, photo clean-up, purges) runs while a reminder round hangs', async () => {
    let finish: () => void = () => undefined;
    const stuck = new Promise<void>((resolve) => (finish = resolve));
    let maintenanceRuns = 0;
    const reminders = startLoop({ name: 'reminders', intervalMs: 60_000, task: () => stuck });
    const maintenance = startLoop({
      name: 'maintenance',
      intervalMs: 60_000,
      task: () => {
        maintenanceRuns++;
      },
    });
    const scheduler = combineLoops([reminders, maintenance]);

    const all = scheduler.runNow();
    // The run the scheduler just started ends although the reminder round does not; later ones run too.
    await maintenance.runNow();
    await maintenance.runNow();
    expect(maintenanceRuns).toBe(2);

    finish();
    await all;
    await scheduler.stop();
  });
});

describe('workout reminder with workouts (schema v5)', () => {
  // Monday 2026-10-12 18:00 in Kyiv.
  const WORKOUT_AT = new Date(Date.UTC(2026, 9, 12, 15, 0));
  const workout = (id: string, name: string, days: (0 | 1 | 2 | 3 | 4 | 5 | 6)[]) => ({
    kind: 'workout.put' as const,
    value: { id, name, days, items: [] },
  });
  const sessionOn = (date: string, status: 'active' | 'done') => ({
    kind: 'session.put' as const,
    value: {
      id: 'session00001',
      date,
      workoutId: null,
      name: 'Вільне тренування',
      createdAt: 1,
      startedAt: 1,
      finishedAt: null,
      durationSec: null,
      status,
      exercises: [],
      notes: '',
      rev: 0,
      deviceId: null,
    },
  });

  beforeEach(() => {
    saveSettings(data, { workout: { on: true, days: [1, 3], time: '18:00' } });
  });

  it('names today’s scheduled workouts (two, then «і ще N»); the url stays the old deep link', async () => {
    data.apply([workout('workout00001', 'Ноги + прес', [1, 3]), workout('workout00002', 'Кардіо', [1])]);
    await runReminderTick(deps, WORKOUT_AT);
    expect(transport.sent[0]?.payload).toEqual({
      title: 'Час тренування 💪',
      body: 'Сьогодні: Ноги + прес, Кардіо',
      url: '/?sheet=day&trained=1',
      tag: 'workout',
    });
    expect(data.workoutNamesOn('2026-10-14')).toEqual(['Ноги + прес']);
    expect(data.workoutNamesOn('2026-10-13')).toEqual([]);
  });

  it('without a scheduled workout the text is the usual one', async () => {
    data.apply([workout('workout00001', 'Верх тіла', [5])]);
    await runReminderTick(deps, WORKOUT_AT);
    expect(transport.sent[0]?.payload).toMatchObject({ body: 'Не забудь відмітити, як пройшло' });
  });

  it('no push while a session of that day exists (active or done); a deleted one does not count', async () => {
    data.apply([sessionOn(TODAY, 'active')]);
    expect(await runReminderTick(deps, WORKOUT_AT)).toEqual([
      { kind: 'workout', date: TODAY, action: 'skip', result: 'skipped', delivered: 0 },
    ]);
    expect(transport.sent).toHaveLength(0);
    expect(data.isDone('workout', TODAY)).toBe(true);
    data.apply([{ kind: 'session.delete', id: 'session00001' }]);
    expect(data.isDone('workout', TODAY)).toBe(false);
    // Another user's session never counts for anna.
    const olya = users.create({ username: 'olya', role: 'user', passwordHash: null, now: 0 }).id;
    repos.forUser(olya).apply([{ ...sessionOn(TODAY, 'done'), value: { ...sessionOn(TODAY, 'done').value, id: 'session00009' } }]);
    expect(data.isDone('workout', TODAY)).toBe(false);
  });
});
