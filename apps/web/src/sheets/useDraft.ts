import { useCallback, useState } from 'react';

interface DraftSession<T> {
  key: number;
  baseline: T;
  draft: T;
}

export interface DraftApi<T> {
  draft: T;
  /** What was loaded when the sheet opened (dirty = draft differs from it). */
  baseline: T;
  /** The draft differs from its baseline. */
  dirty: boolean;
  update: (change: (draft: T) => T) => void;
}

export interface DraftSource<T> {
  /** Builds a fresh session from the store: `baseline` as stored, `draft` with any open patch on top. */
  init: () => { baseline: T; draft: T };
  /** The baseline as the store has it right now (same shape `init` returns). */
  current: T;
  /** Whether two drafts differ (`a` is the baseline). */
  differs: (a: T, b: T) => boolean;
}

/**
 * Sheet draft that re-initialises whenever `key` changes (every `ui.openSheet`, including day
 * navigation) without remounting the sheet itself. A draft she has not touched also follows the
 * store: when the stored record changes underneath (a server refresh with another device's
 * changes), it is rebuilt, so saving never writes back the stale copy. Edited drafts are kept.
 */
export function useDraft<T>(key: number, { init, current, differs }: DraftSource<T>): DraftApi<T> {
  const [session, setSession] = useState<DraftSession<T>>(() => ({ key, ...init() }));
  let active = session;
  const stale =
    session.key === key && !differs(session.baseline, session.draft) && differs(session.baseline, current);
  if (session.key !== key || stale) {
    active = { key, ...init() };
    setSession(active);
  }
  const update = useCallback((change: (draft: T) => T) => {
    setSession((s) => ({ ...s, draft: change(s.draft) }));
  }, []);
  return {
    draft: active.draft,
    baseline: active.baseline,
    dirty: differs(active.baseline, active.draft),
    update,
  };
}
