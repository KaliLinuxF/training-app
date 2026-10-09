/**
 * Moves a running app onto a freshly deployed version.
 *
 * `sw.ts` lets a new worker take over at once (skipWaiting + clientsClaim) and drops the old
 * precache, but an open page keeps running the bundle it loaded. iOS resumes a home-screen app
 * from memory instead of relaunching it, so without a reload an old client could keep talking to
 * a newer server for days. When a new worker takes over a page that already had one, the page
 * reloads once: the next time the app returns to the foreground with nothing in progress.
 */
import { useDataStore } from '@/store/data';
import { useUiStore } from '@/store/ui';

/** No second automatic reload within this time, even if versions keep changing (no reload loops). */
export const RELOAD_COOLDOWN_MS = 5 * 60_000;
/** sessionStorage: when this app instance last reloaded itself for an update (survives the reload). */
export const RELOADED_AT_KEY = 'legko.updateReloadAt';

type KeyValueStore = Pick<Storage, 'getItem' | 'setItem'>;

export interface UpdateReloadEnv {
  /** `navigator.serviceWorker`: who controls the page now, and when that changes. */
  serviceWorker: {
    readonly controller: object | null;
    addEventListener(type: 'controllerchange', listener: () => void): void;
  };
  document: {
    readonly visibilityState: DocumentVisibilityState;
    addEventListener(type: 'visibilitychange', listener: () => void): void;
  };
  /** Whether reloading now would lose nothing. Default: {@link appIsIdle}. */
  isIdle?: () => boolean;
  /** Default: `location.reload()`. */
  reload?: () => void;
  /** Default: sessionStorage (when the browser allows it). */
  storage?: KeyValueStore | null;
  now?: () => number;
}

export function reloadOnUpdate(env: UpdateReloadEnv): void {
  const {
    serviceWorker,
    document: doc,
    isIdle = appIsIdle,
    reload = () => location.reload(),
    storage = sessionStore(),
    now = Date.now,
  } = env;
  // The very first install also fires `controllerchange` (clientsClaim): that page is already current.
  let controlled = serviceWorker.controller !== null;
  let updateReady = false;
  let reloading = false;

  serviceWorker.addEventListener('controllerchange', () => {
    if (controlled) updateReady = true;
    controlled = true;
  });

  doc.addEventListener('visibilitychange', () => {
    if (doc.visibilityState !== 'visible' || !updateReady || reloading) return;
    if (!isIdle() || reloadedRecently(storage, now())) return; // try again on the next return
    reloading = true;
    try {
      storage?.setItem(RELOADED_AT_KEY, String(now()));
    } catch {
      // storage full or blocked: the per-page `reloading` flag still makes this one-shot
    }
    reload();
  });
}

/** Nothing would be lost by a reload: no sheet or dialog open, no unsent changes, no field in use. */
export function appIsIdle(): boolean {
  const { sheet, confirm } = useUiStore.getState();
  if (sheet !== null || confirm !== null) return false;
  if (useDataStore.getState().sync.pending > 0) return false;
  return !isEditing(document.activeElement);
}

/** A focused text field, select or editable region (the user may come back to finish typing). */
export function isEditing(el: Element | null): boolean {
  return (
    el !== null && el.matches('input, textarea, select, [contenteditable]:not([contenteditable="false"])')
  );
}

function reloadedRecently(storage: KeyValueStore | null, now: number): boolean {
  let raw: string | null;
  try {
    raw = storage?.getItem(RELOADED_AT_KEY) ?? null;
  } catch {
    return false;
  }
  const at = Number(raw);
  return raw !== null && Number.isFinite(at) && now - at >= 0 && now - at < RELOAD_COOLDOWN_MS;
}

function sessionStore(): KeyValueStore | null {
  try {
    return window.sessionStorage;
  } catch {
    return null; // access throws when site data is blocked
  }
}
