import { defaultSettings, type Settings } from '@legko/shared';
import { beforeEach, describe, expect, it } from 'vitest';
import { fakeTransport, type FakeTransport } from '../../test/helpers';
import { createDataRepo, type DataRepo } from '../db/data';
import { openDatabase } from '../db/open';
import type { Database } from '../db/sqlite';
import { createPushService, type PushService } from '../push/service';
import { createReminderLog, type ReminderLog } from './log';
import { runReminderTick, type ReminderRunnerDeps } from './runner';

// Monday 2026-10-12 08:00 Kyiv.
const WEIGH_AT = new Date(Date.UTC(2026, 9, 12, 5, 0));
const TODAY = '2026-10-12';

let db: Database;
let data: DataRepo;
let log: ReminderLog;
let transport: FakeTransport;
let push: PushService;
let deps: ReminderRunnerDeps;

function saveSettings(patch: Partial<Settings['rem']>): void {
  const base = defaultSettings();
  const rem = {
    workout: { ...base.rem.workout, on: false },
    weigh: { ...base.rem.weigh, on: false },
    measure: { ...base.rem.measure, on: false },
    ...patch,
  };
  data.apply([{ kind: 'settings.put', value: { ...base, rem } }]);
}

beforeEach(() => {
  db = openDatabase(':memory:');
  data = createDataRepo(db);
  log = createReminderLog(db);
  transport = fakeTransport();
  push = createPushService({ db, transport, publicKey: 'k' });
  push.subscribe({ endpoint: 'https://push.example/a', p256dh: 'p', auth: 'a' }, null);
  deps = { data, log, push };
  saveSettings({ weigh: { on: true, day: 1, time: '08:00' } });
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
    saveSettings({ measure: { on: true, day: 1, time: '08:00' } });
    data.apply([{ kind: 'measure.put', date: TODAY, value: { chest: null, waist: 70, hips: null } }]);
    expect((await runReminderTick(deps, WEIGH_AT)).map((o) => o.result)).toEqual(['skipped']);
  });

  it('skips the workout reminder once the day has a workout mark (yes or no)', async () => {
    saveSettings({ workout: { on: true, days: [1], time: '08:00' } });
    data.apply([
      {
        kind: 'day.put',
        date: TODAY,
        value: { food: 'Омлет', kcal: null, trained: null, types: [], notes: '' },
      },
    ]);
    expect((await runReminderTick(deps, WEIGH_AT)).map((o) => o.result)).toEqual(['sent']);

    const tuesday = new Date(WEIGH_AT.getTime() + 86_400_000);
    saveSettings({ workout: { on: true, days: [2], time: '08:00' } });
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
    transport.outcomes.set('https://push.example/a', { ok: false, statusCode: null, reason: 'ECONNRESET' });
    expect((await runReminderTick(deps, WEIGH_AT)).map((o) => o.result)).toEqual(['retry']);
    expect(log.has('weigh', TODAY)).toBe(false);

    transport.outcomes.clear();
    expect((await runReminderTick(deps, new Date(WEIGH_AT.getTime() + 30_000))).map((o) => o.result)).toEqual(
      ['sent'],
    );
    expect(log.has('weigh', TODAY)).toBe(true);
  });

  it('logs as handled when there are no devices (nothing to retry)', async () => {
    push.unsubscribe('https://push.example/a');
    expect(await runReminderTick(deps, WEIGH_AT)).toEqual([
      { kind: 'weigh', date: TODAY, action: 'send', result: 'sent', delivered: 0 },
    ]);
    expect(log.has('weigh', TODAY)).toBe(true);
  });
});
