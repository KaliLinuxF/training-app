import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { initialSyncState } from '@/store/state';
import { useDataStore } from '@/store/data';
import { ui, useUiStore } from '@/store/ui';
import { appIsIdle, isEditing, RELOAD_COOLDOWN_MS, RELOADED_AT_KEY, reloadOnUpdate } from './update';

/** `navigator.serviceWorker` stand-in: a controller and the `controllerchange` event. */
class FakeContainer extends EventTarget {
  constructor(public controller: object | null) {
    super();
  }
  takeOver(): void {
    this.controller = {};
    this.dispatchEvent(new Event('controllerchange'));
  }
}

/** `document` stand-in whose visibility the test flips. */
class FakeDocument extends EventTarget {
  visibilityState: DocumentVisibilityState = 'visible';
  hide(): void {
    this.visibilityState = 'hidden';
    this.dispatchEvent(new Event('visibilitychange'));
  }
  show(): void {
    this.visibilityState = 'visible';
    this.dispatchEvent(new Event('visibilitychange'));
  }
  /** Leaves the app and comes back. */
  returnToApp(): void {
    this.hide();
    this.show();
  }
}

class MemoryStorage {
  map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

interface Setup {
  controlled?: boolean;
  idle?: boolean;
  storage?: MemoryStorage | null;
}

function setup({ controlled = true, idle = true, storage = new MemoryStorage() }: Setup = {}) {
  const sw = new FakeContainer(controlled ? {} : null);
  const doc = new FakeDocument();
  const reload = vi.fn();
  let clock = 1_000_000;
  const state = { idle };
  reloadOnUpdate({
    serviceWorker: sw,
    document: doc,
    isIdle: () => state.idle,
    reload,
    storage,
    now: () => clock,
  });
  return {
    sw,
    doc,
    reload,
    state,
    storage,
    advance(ms: number) {
      clock += ms;
    },
  };
}

describe('reloadOnUpdate', () => {
  it('reloads once on the next return to the app after a new version took over', () => {
    const t = setup();
    t.sw.takeOver();
    expect(t.reload).not.toHaveBeenCalled(); // never in the middle of using the app

    t.doc.returnToApp();
    expect(t.reload).toHaveBeenCalledTimes(1);

    t.doc.returnToApp();
    t.doc.returnToApp();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('also reloads when the update landed while the app was in the background', () => {
    const t = setup();
    t.doc.hide();
    t.sw.takeOver();
    expect(t.reload).not.toHaveBeenCalled();
    t.doc.show();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a page the first install just took control of', () => {
    const t = setup({ controlled: false });
    t.sw.takeOver(); // clientsClaim on the first visit
    t.doc.returnToApp();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('reloads for a later update of a page that started without a worker', () => {
    const t = setup({ controlled: false });
    t.sw.takeOver(); // first install
    t.sw.takeOver(); // a deploy while the app stayed open
    t.doc.returnToApp();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('does nothing without an update', () => {
    const t = setup();
    t.doc.returnToApp();
    t.doc.returnToApp();
    expect(t.reload).not.toHaveBeenCalled();
  });

  it('waits while something is in progress and reloads on a later quiet return', () => {
    const t = setup({ idle: false });
    t.sw.takeOver();
    t.doc.returnToApp();
    expect(t.reload).not.toHaveBeenCalled();

    t.state.idle = true;
    t.doc.returnToApp();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });

  it('remembers the reload so the next page does not reload again right away', () => {
    const storage = new MemoryStorage();
    const first = setup({ storage });
    first.sw.takeOver();
    first.doc.returnToApp();
    expect(first.reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem(RELOADED_AT_KEY)).toBe('1000000');

    // The reloaded page (same clock): another version takes over at once — no second reload yet.
    const second = setup({ storage });
    second.sw.takeOver();
    second.doc.returnToApp();
    expect(second.reload).not.toHaveBeenCalled();

    second.advance(RELOAD_COOLDOWN_MS);
    second.doc.returnToApp();
    expect(second.reload).toHaveBeenCalledTimes(1);
  });

  it('still reloads only once when storage is unavailable or throws', () => {
    const none = setup({ storage: null });
    none.sw.takeOver();
    none.doc.returnToApp();
    none.doc.returnToApp();
    expect(none.reload).toHaveBeenCalledTimes(1);

    const broken = new MemoryStorage();
    broken.getItem = () => {
      throw new DOMException('blocked', 'SecurityError');
    };
    broken.setItem = () => {
      throw new DOMException('full', 'QuotaExceededError');
    };
    const t = setup({ storage: broken });
    t.sw.takeOver();
    t.doc.returnToApp();
    t.doc.returnToApp();
    expect(t.reload).toHaveBeenCalledTimes(1);
  });
});

describe('appIsIdle', () => {
  beforeEach(() => {
    useUiStore.setState({ sheet: null, toast: null, confirm: null });
    useDataStore.setState({ sync: { ...initialSyncState(), pending: 0 } });
    document.body.innerHTML = '';
  });

  afterEach(() => {
    useUiStore.getState().confirm?.resolve(false);
    useUiStore.setState({ sheet: null, toast: null, confirm: null });
    document.body.innerHTML = '';
  });

  it('is idle on a plain screen with everything sent', () => {
    expect(appIsIdle()).toBe(true);
  });

  it('is busy while a sheet is open', () => {
    ui.openSheet('2026-10-09', 'day');
    expect(appIsIdle()).toBe(false);
  });

  it('is busy while a confirmation is open', () => {
    void ui.confirm({ title: 'Видалити запис?' });
    expect(appIsIdle()).toBe(false);
  });

  it('is busy while changes wait in the outbox', () => {
    useDataStore.setState({ sync: { ...initialSyncState(), pending: 2 } });
    expect(appIsIdle()).toBe(false);
  });

  it('is busy while a text field has focus', () => {
    document.body.innerHTML = '<input id="f" />';
    document.getElementById('f')!.focus();
    expect(appIsIdle()).toBe(false);
  });
});

describe('isEditing', () => {
  const el = (html: string): Element => {
    const box = document.createElement('div');
    box.innerHTML = html;
    return box.firstElementChild!;
  };

  it('treats text fields and editable regions as editing', () => {
    expect(isEditing(el('<input type="text" />'))).toBe(true);
    expect(isEditing(el('<textarea></textarea>'))).toBe(true);
    expect(isEditing(el('<select></select>'))).toBe(true);
    expect(isEditing(el('<div contenteditable="true"></div>'))).toBe(true);
  });

  it('does not treat buttons, plain elements or nothing as editing', () => {
    expect(isEditing(el('<button>Зберегти</button>'))).toBe(false);
    expect(isEditing(el('<div contenteditable="false"></div>'))).toBe(false);
    expect(isEditing(document.body)).toBe(false);
    expect(isEditing(null)).toBe(false);
  });
});
