/**
 * The browser bits the auth layer touches besides the API: navigation, the cross-tab channel, the clock and
 * sessionStorage. Tests swap them with `setAuthEnv`.
 */

/** The subset of `BroadcastChannel` the auth layer uses. */
export interface AuthChannel {
  postMessage(message: unknown): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
}

export interface AuthEnv {
  /** Full navigation replacing the current history entry (`location.replace`). */
  replace(url: string): void;
  /** `location.reload()`. */
  reload(): void;
  /** A channel named `name` shared by this browser's tabs, or null when the browser has none. */
  openChannel(name: string): AuthChannel | null;
  now(): number;
  /** sessionStorage, or null when blocked. */
  session(): Storage | null;
}

function openBroadcastChannel(name: string): AuthChannel | null {
  if (typeof BroadcastChannel !== 'function') return null;
  const channel = new BroadcastChannel(name);
  // Node (unit tests) keeps the process alive while a channel is open; browsers have no `unref`.
  (channel as unknown as { unref?: () => void }).unref?.();
  return channel;
}

function sessionStore(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

const browserEnv: AuthEnv = {
  replace: (url) => window.location.replace(url),
  reload: () => window.location.reload(),
  openChannel: openBroadcastChannel,
  now: () => Date.now(),
  session: sessionStore,
};

let current: AuthEnv = browserEnv;
const listeners = new Set<() => void>();

export const authEnv = (): AuthEnv => current;

/** Test hook: replaces parts of the environment; returns a function that restores the previous one. */
export function setAuthEnv(patch: Partial<AuthEnv>): () => void {
  const previous = current;
  current = { ...current, ...patch };
  for (const listener of listeners) listener();
  return () => {
    current = previous;
    for (const listener of listeners) listener();
  };
}

/** Called whenever the environment is swapped (the auth layer drops its cached channel). */
export function onAuthEnvChange(listener: () => void): void {
  listeners.add(listener);
}
