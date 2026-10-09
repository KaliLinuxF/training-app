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
  update: (change: (draft: T) => T) => void;
}

/**
 * Sheet draft that re-initialises whenever `key` changes (every `ui.openSheet`, including
 * day navigation) without remounting the sheet itself.
 */
export function useDraft<T>(key: number, init: () => { baseline: T; draft: T }): DraftApi<T> {
  const [session, setSession] = useState<DraftSession<T>>(() => ({ key, ...init() }));
  let current = session;
  if (session.key !== key) {
    current = { key, ...init() };
    setSession(current);
  }
  const update = useCallback((change: (draft: T) => T) => {
    setSession((s) => ({ ...s, draft: change(s.draft) }));
  }, []);
  return { draft: current.draft, baseline: current.baseline, update };
}
