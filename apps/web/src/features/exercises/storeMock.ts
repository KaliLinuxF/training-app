/**
 * Test-only: the real `@/store/data` actions over an in-memory store. `commitOps` keeps the real contract (all or
 * nothing, validated, applied with the shared reducer) and records every batch.
 *
 *   vi.mock('@/store/sync', async (original) => (await import('./storeMock')).syncModule(original));
 */
import { applyOps, opSchema, type AppData, type Op } from '@legko/shared';
import type * as SyncModule from '@/store/sync';

export const committed: { batches: Op[][] } = { batches: [] };

export async function syncModule(importOriginal: <T>() => Promise<T>): Promise<typeof SyncModule> {
  const actual = await importOriginal<typeof SyncModule>();
  const { useDataStore } = await import('@/store/state');
  return {
    ...actual,
    commitOps: (ops: readonly Op[]): boolean => {
      if (!ops.every((op) => opSchema.safeParse(op).success)) return false;
      const parsed = ops.map((op) => opSchema.parse(op));
      committed.batches.push(parsed);
      useDataStore.setState((s) => ({ data: applyOps(s.data, parsed) }));
      return true;
    },
  };
}

/** Replaces the store's data and forgets the recorded batches. */
export async function seedStore(data: AppData): Promise<void> {
  const { useDataStore } = await import('@/store/state');
  committed.batches = [];
  useDataStore.setState({ data });
}

export const lastBatch = (): Op[] => committed.batches.at(-1) ?? [];
