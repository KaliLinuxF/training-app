/**
 * Workouts and steps on the real bundle, API level (docs/workouts-steps-rebrand.md §7): another account can never
 * read or change anna's exercises, workouts, sessions or steps — even with exactly her ids and dates —, the merge
 * rules hold over HTTP (W13), and the coach reads them read-only.
 *
 * Rules (docs/multi-user.md §11.2): anna and admin only read here (anna's data is re-seeded per test); every other
 * account is a throwaway one, disposed in `afterEach`.
 */
import type { APIResponse } from '@playwright/test';
import { coachClientPath, type AppData, type CoachClientResponse, type Op } from '../packages/shared/src/index';
import { e2eSession, training } from './fixtures/data';
import { getCoachClient, getCoachClients, sendToCoach } from './support/coachApi';
import { TODAY } from './support/env';
import { createUser, sessionOf, type TestUser } from './support/server';
import { expect, test } from './support/test';

async function expectStatus(res: APIResponse, status: number): Promise<void> {
  expect(res.status(), `${res.url()}: ${await res.text()}`).toBe(status);
}

const pick = (d: AppData) => ({
  exercises: d.exercises,
  workouts: d.workouts,
  sessions: d.sessions,
  steps: d.steps,
  deletedSessions: d.deletedSessions,
  stepsGoal: d.settings.stepsGoal,
});

test.describe('workouts and steps API', () => {
  test.skip(({ isMobile }) => !isMobile, 'API level: runs once, in the iphone project');
  let other: TestUser | null = null;
  test.beforeEach(async ({ server, admin, playwright }) => {
    // API-only tests never touch `page`, so the suite's seeding does not run: import anna's data here.
    await server.importData(training());
    other = await createUser(playwright, admin);
  });
  test.afterEach(async () => {
    await other?.dispose();
    other = null;
  });
  const b = (): TestUser => {
    if (!other) throw new Error('no second account');
    return other;
  };

  test('B starts with none of anna’s workouts or steps; B’s ops with her ids stay B’s own', async ({ server }) => {
    const anna = await server.getData();
    expect(pick(anna)).toMatchObject(pick(training()));
    const [workout] = anna.workouts;
    const [exercise] = anna.exercises;
    const [session, second] = anna.sessions;
    const [steps] = anna.steps;
    if (!workout || !exercise || !session || !second || !steps) throw new Error('training seed missing');

    const fresh = await b().api.getData();
    expect(pick(fresh)).toEqual({ exercises: [], workouts: [], sessions: [], steps: [], deletedSessions: [], stepsGoal: null });

    const ops: Op[] = [
      { kind: 'exercise.put', value: { ...exercise, name: 'Вправа B' } },
      { kind: 'exercise.delete', id: exercise.id },
      { kind: 'workout.put', value: { ...workout, name: 'Тренування B', days: [0] } },
      { kind: 'workout.delete', id: workout.id },
      { kind: 'session.delete', id: session.id },
      { kind: 'session.put', value: { ...second, name: 'Сесія B', rev: second.rev + 10 } },
      { kind: 'steps.delete', date: steps.date },
      { kind: 'steps.put', date: TODAY, steps: 321 },
      { kind: 'settings.put', value: { ...fresh.settings, stepsGoal: 12_000 } },
    ];
    await expectStatus(await b().api.sendOps(ops), 200);

    // anna: exactly as before, everywhere.
    expect(await server.getData()).toEqual(anna);
    expect(await server.exportData()).toEqual(anna);

    // B: only what B wrote.
    const own = await b().api.getData();
    expect(own.exercises).toEqual([]);
    expect(own.workouts).toEqual([]);
    expect(own.sessions.map((s) => [s.id, s.name])).toEqual([[second.id, 'Сесія B']]);
    expect(own.deletedSessions).toEqual([session.id]);
    expect(own.steps).toEqual([{ date: TODAY, steps: 321 }]);
    expect(own.settings.stepsGoal).toBe(12_000);
    const text = JSON.stringify(own);
    for (const secret of [workout.name, exercise.name, String(steps.steps)]) expect(text).not.toContain(secret);
    // anna's tombstones never block B: B can still write a session with an id anna deleted.
    await expectStatus(await server.sendOps([{ kind: 'session.delete', id: 'annaOnlyGone1' }]), 200);
    await expectStatus(
      await b().api.sendOps([{ kind: 'session.put', value: e2eSession({ id: 'annaOnlyGone1' }) }]),
      200,
    );
    expect(sessionOf(await b().api.getData(), 'annaOnlyGone1')).toBeDefined();
    expect(sessionOf(await server.getData(), 'annaOnlyGone1')).toBeUndefined();
  });

  test('B’s import with anna’s ids replaces only B’s data', async ({ server }) => {
    const anna = await server.getData();
    await b().api.importData({ ...training(), settings: { ...training().settings, goal: 77 } });
    expect(await server.getData()).toEqual(anna);
    expect(pick(await b().api.getData())).toEqual(pick(training()));
    await b().api.importData({ ...training(), workouts: [], sessions: [], steps: [] });
    expect(await server.getData()).toEqual(anna);
  });

  test('merge rules over HTTP: a lower rev or an active put never wins over a done session; a deleted id stays deleted', async ({
    server,
  }) => {
    const s = e2eSession({ id: 'e2eMerge00001' });
    const done = { ...s, status: 'done' as const, rev: 4, durationSec: 1800, finishedAt: s.createdAt + 1_800_000 };
    await expectStatus(await server.sendOps([{ kind: 'session.put', value: { ...s, rev: 3 } }]), 200);
    await expectStatus(await server.sendOps([{ kind: 'session.put', value: done }]), 200);
    await expectStatus(await server.sendOps([{ kind: 'session.put', value: { ...s, rev: 3 } }]), 200);
    expect(sessionOf(await server.getData(), s.id)).toMatchObject({ status: 'done', rev: 4 });
    await expectStatus(await server.sendOps([{ kind: 'session.put', value: { ...done, rev: 2, name: 'Старе' } }]), 200);
    expect(sessionOf(await server.getData(), s.id)?.name).toBe(s.name);

    await expectStatus(await server.sendOps([{ kind: 'session.delete', id: s.id }]), 200);
    await expectStatus(await server.sendOps([{ kind: 'session.put', value: { ...done, rev: 99 } }]), 200);
    const after = await server.getData();
    expect(sessionOf(after, s.id)).toBeUndefined();
    expect(after.deletedSessions).toContain(s.id);
  });

  test('invalid ops are refused as a whole: a lib.* own exercise, 0 steps, a negative duration', async ({ server }) => {
    const before = await server.getData();
    const bad: Op[][] = [
      [
        {
          kind: 'exercise.put',
          value: { id: 'lib.plank', name: 'Планка', kind: 'time', primary: ['abs'], secondary: [], equipment: 'bodyweight', met: 3 },
        },
      ],
      [{ kind: 'steps.put', date: TODAY, steps: 0 }],
      [{ kind: 'session.put', value: e2eSession({ durationSec: -1 }) }],
    ];
    for (const ops of bad) {
      await expectStatus(await server.sendOps([{ kind: 'steps.put', date: TODAY, steps: 5000 }, ...ops]), 400);
    }
    expect(await server.getData()).toEqual(before);
  });

  test('the coach reads anna’s workouts read-only; B (not an admin) is refused', async ({ admin, server }) => {
    const anna = await server.getData();
    const res = await getCoachClient(admin, server.id);
    await expectStatus(res, 200);
    const detail = (await res.json()) as CoachClientResponse;
    expect(pick(detail.data)).toEqual({ ...pick(anna), deletedSessions: [] });
    const list = await getCoachClients(admin);
    await expectStatus(list, 200);

    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE'] as const) {
      await expectStatus(await sendToCoach(admin, method, coachClientPath(server.id)), 404);
    }
    await expectStatus(await getCoachClient(b().api, server.id), 403);
    await expectStatus(await getCoachClients(b().api), 403);
    expect(await server.getData()).toEqual(anna);
  });
});
