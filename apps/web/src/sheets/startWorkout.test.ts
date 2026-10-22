import { emptyData, type AppData } from '@legko/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { session, workout } from '@/lib/stats/workouts.testing';
import { useDataStore } from '@/store/data';
import { initialSyncState } from '@/store/state';
import { fakeIdb } from '@/store/test-utils';
import { useUiStore } from '@/store/ui';
import { START_FAILED, startWorkout, switchConfirm } from './startWorkout';

const mocks = vi.hoisted(() => ({
  idb: { getMany: vi.fn(), setMany: vi.fn(), delMany: vi.fn(), keys: vi.fn() },
}));
vi.mock('idb-keyval', () => mocks.idb);

const TODAY = '2026-10-14';
const NOW = Date.UTC(2026, 9, 14, 7);
const clock = () => NOW;

function setData(patch: Partial<AppData>) {
  const data = { ...emptyData(), ...patch };
  data.settings = { ...data.settings, onboarded: true };
  useDataStore.setState({ data, sync: { ...initialSyncState(), online: true, loaded: true, lastSyncedAt: 1 } });
}
const data = () => useDataStore.getState().data;
/** Answers the open question (the shell's ConfirmHost would). */
async function answer(ok: boolean) {
  await vi.waitFor(() => expect(useUiStore.getState().confirm).not.toBeNull());
  useUiStore.getState().confirm?.resolve(ok);
}

beforeEach(() => {
  const idb = fakeIdb();
  mocks.idb.getMany.mockImplementation(idb.getMany);
  mocks.idb.setMany.mockImplementation(idb.setMany);
  mocks.idb.delMany.mockImplementation(idb.delMany);
  mocks.idb.keys.mockImplementation(idb.keys);
  useUiStore.setState({ sheet: null, toast: null, confirm: null });
});
afterEach(() => vi.restoreAllMocks());

describe('startWorkout', () => {
  it('nothing live: starts the workout at once and returns its id', async () => {
    setData({ workouts: [workout()] });
    const id = await startWorkout(TODAY, 'workoutLegs01', clock);
    expect(useUiStore.getState().confirm).toBeNull();
    expect(data().sessions).toHaveLength(1);
    expect(data().sessions[0]).toMatchObject({ id, workoutId: 'workoutLegs01', status: 'active', startedAt: NOW });
  });

  it('the same workout is live: continues it, no question, nothing committed', async () => {
    const live = session({ id: 'liveSession01', status: 'active', startedAt: NOW - 60_000, date: TODAY });
    setData({ workouts: [workout()], sessions: [live] });
    expect(await startWorkout(TODAY, 'workoutLegs01', clock)).toBe('liveSession01');
    expect(useUiStore.getState().confirm).toBeNull();
    expect(data().sessions).toEqual([live]);
  });

  it('another one is live: asks; «Скасувати» keeps it and starts nothing', async () => {
    const live = session({ id: 'liveSession01', status: 'active', startedAt: NOW - 60_000, date: TODAY, workoutId: null, name: 'Вільне тренування' });
    setData({ workouts: [workout()], sessions: [live] });
    const pending = startWorkout(TODAY, 'workoutLegs01', clock);
    await answer(false);
    expect(await pending).toBeNull();
    expect(data().sessions).toEqual([live]);
  });

  it('«Завершити й почати» finishes the live one (its day marked trained) and starts the new one', async () => {
    const live = session({ id: 'liveSession01', status: 'active', startedAt: NOW - 20 * 60_000, date: TODAY, workoutId: null, name: 'Вільне тренування' });
    setData({ workouts: [workout()], sessions: [live] });
    const pending = startWorkout(TODAY, 'workoutLegs01', clock);
    await vi.waitFor(() => expect(useUiStore.getState().confirm?.title).toBe(switchConfirm('Вільне тренування').title));
    expect(useUiStore.getState().confirm?.confirmLabel).toBe('Завершити й почати');
    await answer(true);
    const id = await pending;
    const finished = data().sessions.find((s) => s.id === 'liveSession01');
    expect(finished).toMatchObject({ status: 'done', durationSec: 20 * 60 });
    expect(data().days[TODAY]?.trained).toBe(true);
    expect(data().sessions.find((s) => s.id === id)).toMatchObject({ status: 'active', workoutId: 'workoutLegs01' });
  });

  it('a refused start (unknown workout) returns null and says so', async () => {
    setData({});
    expect(await startWorkout(TODAY, 'missingWorkout1', clock)).toBeNull();
    expect(useUiStore.getState().toast?.text).toBe(START_FAILED);
  });
});
